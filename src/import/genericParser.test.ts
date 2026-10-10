import { describe, expect, it } from "vitest";
import { buildTransactionsFromMapping, guessColumnIndex, parseDelimitedText } from "./genericParser";

describe("parseDelimitedText", () => {
  it("parses comma-delimited CSV text", () => {
    const csv = ["Date,Memo,Amount", "01/02/2026,Coffee,4.50"].join("\n");

    expect(parseDelimitedText(csv)).toEqual({
      headers: ["Date", "Memo", "Amount"],
      rows: [["01/02/2026", "Coffee", "4.50"]],
    });
  });

  it("parses tab-delimited pasted data", () => {
    const pasted = ["Date\tMemo\tAmount", "01/02/2026\tCoffee\t4.50"].join("\n");

    expect(parseDelimitedText(pasted)).toEqual({
      headers: ["Date", "Memo", "Amount"],
      rows: [["01/02/2026", "Coffee", "4.50"]],
    });
  });

  it("respects quoted fields containing commas", () => {
    const csv = ["Date,Memo,Amount", '01/02/2026,"Coffee, Inc",4.50'].join("\n");

    expect(parseDelimitedText(csv).rows).toEqual([["01/02/2026", "Coffee, Inc", "4.50"]]);
  });

  it("returns empty headers and rows for blank input", () => {
    expect(parseDelimitedText("")).toEqual({ headers: [], rows: [] });
  });
});

describe("guessColumnIndex", () => {
  it("matches a header containing a keyword, case-insensitively", () => {
    expect(guessColumnIndex(["Transaction Date", "Memo", "Amount"], ["date"])).toBe(0);
    expect(guessColumnIndex(["Transaction Date", "Memo", "Amount"], ["amount", "amt"])).toBe(2);
  });

  it("returns null when nothing matches", () => {
    expect(guessColumnIndex(["Foo", "Bar"], ["date"])).toBeNull();
  });
});

describe("buildTransactionsFromMapping", () => {
  it("maps columns by index regardless of their order", () => {
    const parsed = {
      headers: ["Memo", "Amount", "Date"],
      rows: [["Coffee", "4.50", "01/02/2026"]],
    };

    const transactions = buildTransactionsFromMapping(
      parsed,
      { dateIndex: 2, amountIndex: 1, descriptionIndex: 0 },
      "Venmo",
      "Pasted data",
    );

    expect(transactions).toHaveLength(1);
    expect(transactions[0].id).toEqual(expect.any(String));
    expect(transactions[0]).toMatchObject({
      date: "01/02/2026",
      description: "Coffee",
      cardMember: "",
      accountNumber: "",
      amount: 4.5,
      sourceBank: "Venmo",
      sourceFileName: "Pasted data",
      category: "unclassified",
    });
  });

  it("generates a unique id per transaction, even for repeated bank/file combinations", () => {
    const parsed = {
      headers: ["Date", "Amount", "Description"],
      rows: [
        ["01/02/2026", "4.50", "Coffee"],
        ["01/03/2026", "10.00", "Lunch"],
      ],
    };

    const transactions = buildTransactionsFromMapping(
      parsed,
      { dateIndex: 0, amountIndex: 1, descriptionIndex: 2 },
      "Venmo",
      "Pasted data",
    );

    expect(new Set(transactions.map((transaction) => transaction.id)).size).toBe(transactions.length);
  });

  it("strips currency formatting and treats parens as negative", () => {
    const parsed = {
      headers: ["Date", "Amount", "Description"],
      rows: [
        ["01/02/2026", "$1,234.56", "Paycheck"],
        ["01/03/2026", "(42.10)", "Refund reversal"],
      ],
    };

    const transactions = buildTransactionsFromMapping(
      parsed,
      { dateIndex: 0, amountIndex: 1, descriptionIndex: 2 },
      "Chase",
      "statement.csv",
    );

    expect(transactions[0].amount).toBe(1234.56);
    expect(transactions[1].amount).toBe(-42.1);
  });

  it("skips rows whose amount column doesn't parse", () => {
    const parsed = {
      headers: ["Date", "Amount", "Description"],
      rows: [
        ["01/02/2026", "n/a", "Pending"],
        ["01/03/2026", "10.00", "Lunch"],
      ],
    };

    const transactions = buildTransactionsFromMapping(
      parsed,
      { dateIndex: 0, amountIndex: 1, descriptionIndex: 2 },
      "Chase",
      "statement.csv",
    );

    expect(transactions).toHaveLength(1);
    expect(transactions[0].description).toBe("Lunch");
  });

  it("maps a category column, case-insensitively, when provided", () => {
    const parsed = {
      headers: ["Date", "Amount", "Description", "Category"],
      rows: [["01/02/2026", "10.00", "Lunch", "restaurants"]],
    };

    const transactions = buildTransactionsFromMapping(
      parsed,
      { dateIndex: 0, amountIndex: 1, descriptionIndex: 2, categoryIndex: 3 },
      "Chase",
      "statement.csv",
    );

    expect(transactions[0].category).toBe("restaurants");
  });

  it("falls back to unclassified when no category column is mapped", () => {
    const parsed = {
      headers: ["Date", "Amount", "Description"],
      rows: [["01/02/2026", "10.00", "Lunch"]],
    };

    const transactions = buildTransactionsFromMapping(
      parsed,
      { dateIndex: 0, amountIndex: 1, descriptionIndex: 2 },
      "Chase",
      "statement.csv",
    );

    expect(transactions[0].category).toBe("unclassified");
  });

  it("preserves a category value that isn't one of the known defaults", () => {
    const parsed = {
      headers: ["Date", "Amount", "Description", "Category"],
      rows: [["01/02/2026", "10.00", "Lunch", "Dining"]],
    };

    const transactions = buildTransactionsFromMapping(
      parsed,
      { dateIndex: 0, amountIndex: 1, descriptionIndex: 2, categoryIndex: 3 },
      "Chase",
      "statement.csv",
    );

    expect(transactions[0].category).toBe("Dining");
  });
});
