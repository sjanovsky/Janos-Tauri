import { describe, expect, it } from "vitest";
import {
  GROSS_SEGMENT_ID,
  LEFTOVER_SEGMENT_ID,
  buildCashFlow,
  groupSegmentId,
  spendingSegmentId,
  withheldSegmentId,
  type CashFlowInput,
} from "./cashflow";
import { LEFTOVER_KEY, SAVINGS_GROUP_ID, SPENDING_GROUP_ID, TAXES_GROUP_ID, spendingItemKey } from "./groups";
import type { ImportedTransaction } from "../../upload/lib/csvParser";

const tx = (id: string, date: string, amount: number, sourceBank: string, category: string): ImportedTransaction => ({
  id,
  date,
  description: id,
  cardMember: "",
  accountNumber: "",
  amount,
  sourceBank,
  sourceFileName: "f.csv",
  category,
});

const input = (transactions: ImportedTransaction[]): CashFlowInput => ({
  transactions,
  range: "month",
  paychecks: [
    {
      id: "pay",
      name: "Pay",
      depositPattern: "",
      paychecksPerYear: 26,
      extraIncome: 0,
      color: "#000",
      position: 0,
      versions: [
        {
          id: "v1",
          effectiveFrom: "",
          effectiveTo: "",
          gross: 3000,
          transactionId: null,
          values: [
            { itemId: "tax", amount: 500 },
            { itemId: "k401", amount: 300 },
          ],
        },
      ],
    },
  ],
  paycheckBuckets: [
    { id: "wh", name: "Withholding", color: "#111", position: 0 },
    { id: "ret", name: "Retirement", color: "#222", position: 1 },
  ],
  paycheckItems: [
    { id: "tax", label: "Tax", bucketId: "wh", position: 0 },
    { id: "k401", label: "401K", bucketId: "ret", position: 1 },
  ],
  spendingBuckets: [{ id: "food", name: "Food", color: "#333", position: 0 }],
  spendingCategories: [
    { id: "groceries", label: "Groceries", color: "#333", bucketId: "food", excluded: false, position: 0 },
    { id: "gift", label: "Gift", color: "#444", bucketId: "income", excluded: false, position: 1 },
    { id: "skip", label: "Skip", color: "#555", bucketId: null, excluded: true, position: 2 },
  ],
  banks: [
    { name: "Card", spendingPositive: true },
    { name: "Checking", spendingPositive: false },
  ],
  groups: [
    { id: TAXES_GROUP_ID, name: "Taxes", color: "#a00", position: 0 },
    { id: SAVINGS_GROUP_ID, name: "Savings", color: "#0a0", position: 1 },
    { id: SPENDING_GROUP_ID, name: "Spending", color: "#aa0", position: 2 },
  ],
  members: [],
});

const transactions = [
  tx("d1", "1/15/2026", 2200, "Checking", "pay"),
  tx("g1", "1/20/2026", -100, "Card", "groceries"),
  tx("g2", "1/21/2026", 20, "Card", "groceries"),
  tx("c1", "1/22/2026", -80, "Checking", "groceries"),
  tx("i1", "1/23/2026", 5, "Checking", "gift"),
  tx("x1", "1/24/2026", 999, "Card", "skip"),
  tx("t1", "1/25/2026", 999, "Card", "transfers"),
  tx("u1", "2/2/2026", -40, "Card", "unclassified"),
];

describe("buildCashFlow", () => {
  const result = buildCashFlow(input(transactions));

  it("shows gross up and one segment per group down, netting to what's left", () => {
    const jan = result.series[0];
    expect(jan.label).toBe("01/2026");
    expect(jan.segments.map((s) => [s.id, s.value])).toEqual([
      [GROSS_SEGMENT_ID, 3000],
      // Withholding starts in Taxes, Retirement (by name) in Savings, spending buckets in Spending.
      [groupSegmentId(TAXES_GROUP_ID), -500],
      [groupSegmentId(SAVINGS_GROUP_ID), -300],
      // 100 − 20 on the card, and an 80 debit from a spending-negative bank.
      [groupSegmentId(SPENDING_GROUP_ID), -160],
    ]);
    expect(result.netPerColumn).toEqual([2040, -40]);
  });

  it("leaves out excluded, transfer and other-income transactions", () => {
    expect(result.allTransactionIds).toEqual(new Set(["d1", "g1", "g2", "c1", "u1"]));
  });

  it("lists gross, then each group with its buckets underneath", () => {
    expect(result.rows.map((row) => [row.label, row.perColumn, row.children.map((c) => c.label)])).toEqual([
      ["Gross income", [3000, 0], []],
      ["Taxes", [-500, 0], ["Withholding"]],
      ["Savings", [-300, 0], ["Retirement"]],
      ["Spending", [-160, -40], ["Food", "Unclassified"]],
    ]);
  });

  it("records which transactions feed each group and bucket", () => {
    expect([...(result.transactionIds.get(groupSegmentId(SAVINGS_GROUP_ID)) ?? [])]).toEqual(["d1"]);
    expect([...(result.transactionIds.get(withheldSegmentId("ret")) ?? [])]).toEqual(["d1"]);
    expect([...(result.transactionIds.get(groupSegmentId(SPENDING_GROUP_ID)) ?? [])].sort()).toEqual([
      "c1",
      "g1",
      "g2",
      "u1",
    ]);
    expect([...(result.transactionIds.get(spendingSegmentId("food")) ?? [])].sort()).toEqual(["c1", "g1", "g2"]);
  });
});

describe("buildCashFlow groups", () => {
  it("honors where the user dragged a bucket, and Ungrouped for a deleted group", () => {
    const base = input(transactions);
    const moved = buildCashFlow({
      ...base,
      members: [{ itemKey: spendingItemKey("food"), groupId: SAVINGS_GROUP_ID }],
    });
    expect(moved.rows.find((row) => row.label === "Savings")?.children.map((c) => c.label)).toEqual([
      "Retirement",
      "Food",
    ]);

    const noSpending = buildCashFlow({ ...base, groups: base.groups.filter((g) => g.id !== SPENDING_GROUP_ID) });
    expect(noSpending.rows.map((row) => row.label)).toEqual(["Gross income", "Taxes", "Savings", "Ungrouped"]);
  });

  it("puts Leftover in a group as money out, so the bar balances", () => {
    const result = buildCashFlow({
      ...input(transactions),
      members: [{ itemKey: LEFTOVER_KEY, groupId: SAVINGS_GROUP_ID }],
    });
    const savings = result.rows.find((row) => row.label === "Savings")!;
    // January has 2040 left over, February is 40 short.
    expect(savings.children.find((c) => c.id === LEFTOVER_SEGMENT_ID)?.perColumn).toEqual([-2040, 40]);
    expect(savings.perColumn).toEqual([-2340, 40]);
    expect(result.netPerColumn).toEqual([0, 0]);
  });

  it("leaves Leftover as Net income while it is in no group", () => {
    const result = buildCashFlow({
      ...input(transactions),
      members: [{ itemKey: LEFTOVER_KEY, groupId: "" }],
    });
    expect(result.rows.some((row) => row.children.some((c) => c.id === LEFTOVER_SEGMENT_ID))).toBe(false);
    expect(result.netPerColumn).toEqual([2040, -40]);
  });
});
