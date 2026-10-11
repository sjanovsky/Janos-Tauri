import { describe, expect, it } from "vitest";
import { parseCsvText } from "./csvParser";

describe("parseCsvText", () => {
  it("parses AMEX-style CSV rows into transactions", () => {
    const csv = [
      "Date,Description,Card Member,Account #,Amount",
      '07/03/2026,"Coffee, Inc",STEPHEN JANOVSKY,-61005,12.96',
      "07/04/2026,Groceries,STEPHEN JANOVSKY,-61005,-5.00",
    ].join("\n");

    const transactions = parseCsvText(csv, "AMEX", "activity.csv");

    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      date: "07/03/2026",
      description: "Coffee, Inc",
      cardMember: "STEPHEN JANOVSKY",
      accountNumber: "-61005",
      amount: 12.96,
      sourceBank: "AMEX",
      sourceFileName: "activity.csv",
    });
    expect(transactions[1].amount).toBe(-5);
  });
});
