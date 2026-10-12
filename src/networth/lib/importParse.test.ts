import { describe, expect, it } from "vitest";
import { parseImportAmount, parseMonthHeader, parseNetWorthPaste } from "./importParse";

describe("parseMonthHeader", () => {
  it("parses the common spreadsheet month shapes", () => {
    expect(parseMonthHeader("Dec-22")).toBe("2022-12");
    expect(parseMonthHeader("Jan-23")).toBe("2023-01");
    expect(parseMonthHeader("Dec 2022")).toBe("2022-12");
    expect(parseMonthHeader("December 2022")).toBe("2022-12");
    expect(parseMonthHeader("2022-12")).toBe("2022-12");
    expect(parseMonthHeader("2022/12")).toBe("2022-12");
    expect(parseMonthHeader("12/2022")).toBe("2022-12");
    expect(parseMonthHeader("  Oct-26 ")).toBe("2026-10");
  });

  it("rejects non-months", () => {
    expect(parseMonthHeader("End of Month")).toBeNull();
    expect(parseMonthHeader("Stephen")).toBeNull();
    expect(parseMonthHeader("")).toBeNull();
    expect(parseMonthHeader("Dec-99-22")).toBeNull();
    expect(parseMonthHeader("2022-13")).toBeNull();
    expect(parseMonthHeader("2022-12-31")).toBeNull();
  });
});

describe("parseImportAmount", () => {
  it("strips formatting and handles negatives", () => {
    expect(parseImportAmount("69,570")).toBe(69570);
    expect(parseImportAmount("$1,035,262")).toBe(1035262);
    expect(parseImportAmount("-3,559")).toBe(-3559);
    expect(parseImportAmount("(829)")).toBe(-829);
    expect(parseImportAmount("1200.5")).toBe(1200.5);
  });

  it("treats blank and unparseable cells as null", () => {
    expect(parseImportAmount("")).toBeNull();
    expect(parseImportAmount("   ")).toBeNull();
    expect(parseImportAmount("-")).toBeNull();
    expect(parseImportAmount("n/a")).toBeNull();
  });
});

describe("parseNetWorthPaste", () => {
  // A trimmed version of the user's sheet: three buckets delimited by subtotal rows, a dataless
  // HSA row, credit-card liabilities as negatives, and a Net Worth grand total.
  const SHEET = [
    "End of Month\tDec-22\tJan-23\tFeb-23",
    "Stephen\t69,570\t74,054\t73,685",
    "Rachel\t56,971\t60,739\t61,025",
    "HSA\t\t\t",
    "401k\t126,541\t134,793\t134,710",
    "Schwab\t57,308\t60,854\t58,954",
    "Coinbase\t1,496\t2,061\t2,010",
    "Brokerage\t58,804\t62,915\t60,964",
    "Capital One\t38,426\t44,969\t46,468",
    "BoA\t10,424\t5,726\t11,543",
    "Amex\t-3,559\t-3,323\t-2,187",
    "Prime\t-829\t-857\t-952",
    "Cash\t44,462\t46,515\t54,872",
    "",
    "Net Worth\t229,807\t244,223\t250,546",
  ].join("\n");

  it("reads the month header row", () => {
    const parsed = parseNetWorthPaste(SHEET);
    expect(parsed.months).toEqual([
      { raw: "Dec-22", month: "2022-12" },
      { raw: "Jan-23", month: "2023-01" },
      { raw: "Feb-23", month: "2023-02" },
    ]);
  });

  it("groups accounts under their subtotal bucket", () => {
    const parsed = parseNetWorthPaste(SHEET);
    expect(parsed.accounts.map((account) => [account.label, account.bucket])).toEqual([
      ["Stephen", "401k"],
      ["Rachel", "401k"],
      ["Schwab", "Brokerage"],
      ["Coinbase", "Brokerage"],
      ["Capital One", "Cash"],
      ["BoA", "Cash"],
      ["Amex", "Cash"],
      ["Prime", "Cash"],
    ]);
  });

  it("keeps per-month amounts, including negatives", () => {
    const parsed = parseNetWorthPaste(SHEET);
    const amex = parsed.accounts.find((account) => account.label === "Amex");
    expect(amex?.amounts).toEqual([-3559, -3323, -2187]);
    const stephen = parsed.accounts.find((account) => account.label === "Stephen");
    expect(stephen?.amounts).toEqual([69570, 74054, 73685]);
  });

  it("sets aside subtotals, the total, and dataless rows", () => {
    const parsed = parseNetWorthPaste(SHEET);
    expect(parsed.skipped).toEqual([
      { label: "HSA", reason: "empty" },
      { label: "401k", reason: "subtotal" },
      { label: "Brokerage", reason: "subtotal" },
      { label: "Cash", reason: "subtotal" },
      { label: "Net Worth", reason: "total" },
    ]);
  });

  it("tolerates rounding between accounts and their subtotal", () => {
    const sheet = [
      "Account\tJan-24",
      "A\t100",
      "B\t5,000",
      "Sub\t5,099", // true sum 5,100, off by 1 — still read as a subtotal
    ].join("\n");
    const parsed = parseNetWorthPaste(sheet);
    expect(parsed.accounts.map((account) => [account.label, account.bucket])).toEqual([
      ["A", "Sub"],
      ["B", "Sub"],
    ]);
  });

  it("leaves accounts with no following subtotal ungrouped", () => {
    const sheet = ["Account\tJan-24\tFeb-24", "Checking\t10\t20", "Savings\t30\t40"].join("\n");
    const parsed = parseNetWorthPaste(sheet);
    expect(parsed.accounts.map((account) => [account.label, account.bucket])).toEqual([
      ["Checking", null],
      ["Savings", null],
    ]);
    expect(parsed.skipped).toEqual([]);
  });

  it("returns no months when there is no recognizable header", () => {
    expect(parseNetWorthPaste("just some text\nwith no months")).toEqual({
      months: [],
      accounts: [],
      skipped: [],
    });
    expect(parseNetWorthPaste("")).toEqual({ months: [], accounts: [], skipped: [] });
  });

  it("flags an unparseable month column instead of dropping it", () => {
    const sheet = ["Account\tJan-24\tOops\tMar-24", "Checking\t10\t20\t30"].join("\n");
    const parsed = parseNetWorthPaste(sheet);
    expect(parsed.months).toEqual([
      { raw: "Jan-24", month: "2024-01" },
      { raw: "Oops", month: null },
      { raw: "Mar-24", month: "2024-03" },
    ]);
  });
});
