import { describe, expect, it } from "vitest";
import { buildChartSeries } from "./transactionSummary";
import type { ImportedTransaction } from "../../upload/lib/csvParser";

function makeTransaction(overrides: Partial<ImportedTransaction>): ImportedTransaction {
  return {
    id: "1",
    date: "07/03/2026",
    description: "Coffee",
    cardMember: "Test",
    accountNumber: "1",
    amount: 12.96,
    sourceBank: "AMEX",
    sourceFileName: "activity.csv",
    category: "restaurants",
    ...overrides,
  };
}

describe("buildChartSeries", () => {
  it("groups transactions by month and category", () => {
    const transactions = [
      makeTransaction({ id: "1", date: "07/03/2026", description: "Coffee", amount: 12.96, category: "restaurants" }),
      makeTransaction({ id: "2", date: "07/20/2026", description: "Dinner", amount: 5.0, category: "restaurants" }),
      makeTransaction({ id: "3", date: "08/01/2026", description: "Groceries", amount: 24.0, category: "groceries" }),
    ];

    const series = buildChartSeries(transactions, "month", ["restaurants", "groceries"]);

    expect(series).toEqual([
      { key: "2026-07", label: "07/2026", segments: [{ category: "restaurants", value: 17.96 }] },
      { key: "2026-08", label: "08/2026", segments: [{ category: "groceries", value: 24 }] },
    ]);
  });

  it("excludes transfers from the totals", () => {
    const transactions = [
      makeTransaction({ id: "1", date: "07/03/2026", amount: 12.96, category: "restaurants" }),
      makeTransaction({ id: "2", date: "07/04/2026", amount: 500, category: "transfers" }),
    ];

    const series = buildChartSeries(transactions, "month", ["restaurants"]);

    expect(series).toEqual([
      { key: "2026-07", label: "07/2026", segments: [{ category: "restaurants", value: 12.96 }] },
    ]);
  });
});
