import { describe, expect, it } from "vitest";
import { buildBankSummaries, transactionDateRange, type UploadedFileView } from "./uploads";
import type { ImportedTransaction } from "./csvParser";

function tx(date: string, bank: string): ImportedTransaction {
  return {
    id: `${bank}-${date}`,
    date,
    description: "x",
    cardMember: "",
    accountNumber: "",
    amount: 1,
    sourceBank: bank,
    sourceFileName: "f.csv",
    category: "unclassified",
  };
}

function upload(id: string, bankName: string, dates: string[]): UploadedFileView {
  return {
    id,
    bankName,
    fileName: `${id}.csv`,
    importedAt: "2026-01-01 00:00:00",
    transactions: dates.map((date) => tx(date, bankName)),
  };
}

describe("transactionDateRange", () => {
  it("finds the earliest and latest date regardless of order", () => {
    const range = transactionDateRange([tx("03/05/2026", "A"), tx("01/10/2026", "A"), tx("02/01/2026", "A")]);
    expect(range?.min).toEqual(new Date(2026, 0, 10));
    expect(range?.max).toEqual(new Date(2026, 2, 5));
  });

  it("returns null with no parseable dates", () => {
    expect(transactionDateRange([])).toBeNull();
    expect(transactionDateRange([tx("garbage", "A")])).toBeNull();
  });
});

describe("buildBankSummaries", () => {
  const banks = [
    { id: "1", name: "Chase", logoDataUrl: "data:logo", spendingPositive: true },
    { id: "2", name: "Amex", logoDataUrl: null, spendingPositive: true },
  ];

  it("merges upload ranges per bank and keeps banks without uploads", () => {
    const summaries = buildBankSummaries(
      [upload("a", "Chase", ["01/05/2026", "01/20/2026"]), upload("b", " chase ", ["02/01/2026"])],
      banks,
    );
    expect(summaries.map((summary) => summary.name)).toEqual(["Amex", "Chase"]);
    const chase = summaries[1];
    expect(chase.logoDataUrl).toBe("data:logo");
    expect(chase.transactionCount).toBe(3);
    expect(chase.uploads).toHaveLength(2);
    expect(chase.range?.min).toEqual(new Date(2026, 0, 5));
    expect(chase.range?.max).toEqual(new Date(2026, 1, 1));
    expect(summaries[0].range).toBeNull();
  });

  it("lists upload-only banks after configured ones", () => {
    const summaries = buildBankSummaries([upload("a", "Old Bank", ["01/01/2026"])], banks);
    expect(summaries.map((summary) => summary.name)).toEqual(["Amex", "Chase", "Old Bank"]);
  });
});
