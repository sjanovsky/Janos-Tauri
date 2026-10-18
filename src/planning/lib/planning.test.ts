import { describe, expect, it } from "vitest";
import type { PaycheckBucketRecord, PaycheckItemRecord, PaycheckRecord } from "../../income/lib/income";
import type { CategoryRecord } from "../../spending/lib/categories";
import type { ImportedTransaction } from "../../upload/lib/csvParser";
import {
  matchAmount,
  parseMatch,
  TAX_BUCKETS_KEY,
  taxBucketIds,
  planPaycheck,
  planningTotals,
  retirementKey,
  taxKey,
  spendingHistory,
} from "./planning";

const items: PaycheckItemRecord[] = [
  { id: "401k", label: "401K", bucketId: null, position: 0 },
  { id: "fed", label: "Federal", bucketId: "withholding", position: 2 },
  { id: "ss", label: "Social Security", bucketId: "tax", position: 3 },
  { id: "hsa", label: "HSA", bucketId: null, position: 1 },
];

const buckets: PaycheckBucketRecord[] = [
  { id: "withholding", name: "Withholding", color: "", position: 0 },
  { id: "tax", name: "Taxes", color: "", position: 1 },
];

const paycheck: PaycheckRecord = {
  id: "pc1",
  name: "Salary",
  depositPattern: "",
  color: "#4f46e5",
  position: 0,
  paychecksPerYear: 26,
  extraIncome: 10_000,
  versions: [
    { id: "old", effectiveFrom: "", effectiveTo: "2025-12-31", gross: 3000, transactionId: null, values: [] },
    {
      id: "new",
      effectiveFrom: "2026-01-01",
      effectiveTo: "",
      gross: 4000,
      transactionId: null,
      values: [
        { itemId: "401k", amount: 400 },
        { itemId: "hsa", amount: 100 },
        { itemId: "fed", amount: 500 },
        { itemId: "ss", amount: 250 },
      ],
    },
  ],
};

describe("planPaycheck", () => {
  it("annualizes the current version and adds extra income", () => {
    const plan = planPaycheck(paycheck, items, buckets, new Map());
    expect(plan.baseSalary).toBe(104_000);
    expect(plan.annualIncome).toBe(114_000);
    expect(plan.retirementDefault).toBe(10_400);
    expect(plan.retirement).toBe(10_400);
    expect(plan.retirementOverridden).toBe(false);
    expect(plan.taxLines.map((line) => line.pulled)).toEqual([13_000, 6_500]);
    expect(plan.taxes).toBe(19_500);
  });

  it("lets a tax line be overridden", () => {
    const plan = planPaycheck(paycheck, items, buckets, new Map([[taxKey("tax", "pc1"), "7000"]]));
    expect(plan.taxes).toBe(20_000);
  });

  it("picks tax buckets by name until the user chooses", () => {
    expect(taxBucketIds(buckets, new Map())).toEqual(["withholding", "tax"]);
    expect(taxBucketIds(buckets, new Map([[TAX_BUCKETS_KEY, "tax"]]))).toEqual(["tax"]);
    expect(taxBucketIds(buckets, new Map([[TAX_BUCKETS_KEY, ""]]))).toEqual([]);
  });

  it("uses typed overrides and the company match", () => {
    const settings = new Map([
      [retirementKey("pc1"), "12000"],
      ["match:pc1", "5%"],
    ]);
    const plan = planPaycheck(paycheck, items, buckets, settings);
    expect(plan.retirement).toBe(12_000);
    expect(plan.retirementOverridden).toBe(true);
    expect(plan.matchAmount).toBe(5_700);
  });
});

describe("match", () => {
  it("parses percents and dollar amounts", () => {
    expect(parseMatch("4%")).toEqual({ kind: "percent", value: 4 });
    expect(parseMatch("$1,200")).toEqual({ kind: "amount", value: 1200 });
    expect(parseMatch("abc")).toBeNull();
    expect(matchAmount(parseMatch("1200"), 100_000)).toBe(1200);
  });
});

describe("spendingHistory", () => {
  const categories: CategoryRecord[] = [
    { id: "food", label: "Food", color: "", excluded: false, bucketId: "variable", position: 0 },
    { id: "skip", label: "Skip", color: "", excluded: true, bucketId: "variable", position: 1 },
  ];
  const tx = (date: string, amount: number, category = "food"): ImportedTransaction =>
    ({ id: `${date}${amount}${category}`, date, amount, category }) as ImportedTransaction;
  const today = new Date(2026, 9, 17); // last month = September 2026

  it("annualizes last month and the trailing average, ignoring excluded and paycheck rows", () => {
    const result = spendingHistory(
      [
        tx("9/5/2026", -1000),
        tx("8/5/2026", -500),
        tx("9/6/2026", -999, "skip"),
        tx("9/7/2026", 5000, "pc1"),
        tx("10/2/2026", -777), // this month isn't a full month
      ],
      categories,
      [paycheck],
      today,
    );
    expect(result.lastMonthAnnualized).toBe(12_000);
    expect(result.trailingMonths).toBe(2);
    expect(result.trailingAnnualized).toBe(9_000);
  });

  it("is zero without history", () => {
    expect(spendingHistory([], categories, [], today)).toEqual({
      lastMonthAnnualized: 0,
      trailingAnnualized: 0,
      trailingMonths: 0,
    });
  });
});

describe("planningTotals", () => {
  it("leaves income minus taxes, 401K and spending", () => {
    const plan = planPaycheck(paycheck, items, buckets, new Map([["match:pc1", "1000"]]));
    const totals = planningTotals([plan], 50_000);
    expect(totals.remaining).toBe(114_000 - 19_500 - 10_400 - 50_000);
    expect(totals.retirementSaved).toBe(11_400);
  });
});
