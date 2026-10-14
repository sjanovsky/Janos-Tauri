import { describe, expect, it } from "vitest";
import { availableYears, matchRule, resolveFlow, type FlowInput, type SankeyRuleRecord } from "./flow";
import { buildSankeyGraph } from "./sankey";

const base = (): FlowInput => ({
  year: 2026,
  buckets: [
    { id: "income", name: "Income", color: "#4f46e5", direction: "inflow", position: 0 },
    { id: "taxes", name: "Taxes", color: "#dc2626", direction: "outflow", position: 1 },
    { id: "invest", name: "Investments", color: "#0ca678", direction: "outflow", position: 2 },
    { id: "spending", name: "Spending", color: "#e8590c", direction: "outflow", position: 3 },
  ],
  categories: [
    { id: "salary", bucketId: "income", name: "Salary", spendingBucketId: null, amount: 0, position: 0, taxRole: "income" },
    { id: "interest", bucketId: "income", name: "Interest", spendingBucketId: null, amount: 0, position: 1, taxRole: "income" },
    { id: "fed", bucketId: "taxes", name: "Federal", spendingBucketId: null, amount: 0, position: 0, taxRole: "withholding" },
    { id: "k401", bucketId: "invest", name: "401K", spendingBucketId: null, amount: 0, position: 0, taxRole: "deduction" },
    { id: "food", bucketId: "spending", name: "Food", spendingBucketId: "b-food", amount: 0, position: 0, taxRole: "none" },
  ],
  lines: [
    { categoryId: "salary", year: 2026, ytd: 100000, lastPaycheck: 10000, paychecksLeft: 2 },
    { categoryId: "interest", year: 2026, ytd: 500, lastPaycheck: 0, paychecksLeft: 0 },
    { categoryId: "fed", year: 2026, ytd: 20000, lastPaycheck: 2000, paychecksLeft: 2 },
    { categoryId: "k401", year: 2026, ytd: 10000, lastPaycheck: 1000, paychecksLeft: 2 },
    { categoryId: "salary", year: 2025, ytd: 999, lastPaycheck: 0, paychecksLeft: 0 },
  ],
  rules: [],
  spendingBuckets: [
    { id: "b-food", name: "Food", color: "#1baf7a", position: 0 },
    { id: "b-fun", name: "Fun", color: "#eda100", position: 1 },
  ],
  spendingCategories: [
    { id: "groceries", bucketId: "b-food", excluded: false },
    { id: "partying", bucketId: "b-fun", excluded: false },
    { id: "misc", bucketId: null, excluded: false },
    { id: "skipped", bucketId: "b-fun", excluded: true },
  ],
  banks: [
    { name: "Amex", spendingPositive: true },
    { name: "Checking", spendingPositive: false },
  ],
  transactions: [],
});

const tx = (id: string, date: string, description: string, amount: number, sourceBank: string, category: string) => ({
  id,
  date,
  description,
  amount,
  sourceBank,
  category,
});

const amountOf = (result: ReturnType<typeof resolveFlow>, id: string) =>
  result.categories.find((category) => category.id === id)?.amount;

describe("resolveFlow", () => {
  it("takes paycheck categories from the year's lines, not another year's", () => {
    const result = resolveFlow(base());
    expect(amountOf(result, "salary")).toBe(100000);
    expect(amountOf(result, "fed")).toBe(20000);
    expect(amountOf({ ...result }, "interest")).toBe(500);
  });

  it("totals spending by bucket for the year and honors each bank's sign", () => {
    const input = base();
    input.transactions = [
      tx("1", "03/04/2026", "WHOLE FOODS", 120, "Amex", "groceries"),
      tx("2", "03/05/2026", "WHOLE FOODS REFUND", -20, "Amex", "groceries"),
      tx("3", "04/01/2026", "TRADER JOES", -50, "Checking", "groceries"), // checking lists spending negative
      tx("4", "04/02/2025", "OLD", 999, "Amex", "groceries"), // another year
    ];
    const result = resolveFlow(input);
    expect(amountOf(result, "food")).toBe(150);
  });

  it("skips transfers and excluded categories but keeps unlinked buckets, ungrouped and unclassified", () => {
    const input = base();
    input.transactions = [
      tx("1", "01/05/2026", "MOVE", 500, "Amex", "transfers"),
      tx("2", "01/05/2026", "X", 40, "Amex", "skipped"),
      tx("3", "01/06/2026", "BAR", 60, "Amex", "partying"),
      tx("4", "01/07/2026", "STUFF", 30, "Amex", "misc"),
      tx("5", "01/08/2026", "???", 10, "Amex", "unclassified"),
    ];
    const result = resolveFlow(input);
    expect(amountOf(result, "bank:b-fun")).toBe(60);
    expect(amountOf(result, "bank:ungrouped")).toBe(30);
    expect(amountOf(result, "bank:unclassified")).toBe(10);
    expect(result.categories.find((category) => category.id === "bank:b-fun")?.bucketId).toBe("spending");
  });

  it("routes bucket rules ahead of the transfer exclusion and out of spending", () => {
    const input = base();
    input.rules = [{ id: "r1", name: "Brokerage", pattern: "fidelity", kind: "bucket", bucketId: "invest", position: 0 }];
    input.transactions = [
      tx("1", "02/01/2026", "FIDELITY BROKERAGE TRANSFER", 1000, "Checking", "transfers"),
      tx("2", "02/01/2026", "Fidelity", -1000, "Amex", "groceries"),
    ];
    const result = resolveFlow(input);
    // Checking lists spending as negative, so its +1000 is money arriving; Amex's -1000 is too.
    expect(amountOf(result, "rule:r1")).toBe(-2000);
    expect(amountOf(result, "food")).toBe(0);
  });

  it("counts a bucket rule toward an outflow bucket as money out", () => {
    const input = base();
    input.rules = [{ id: "r1", name: "Brokerage", pattern: "fidelity", kind: "bucket", bucketId: "invest", position: 0 }];
    input.transactions = [tx("1", "02/01/2026", "FIDELITY TRANSFER", -1500, "Checking", "transfers")];
    expect(amountOf(resolveFlow(input), "rule:r1")).toBe(1500);
  });

  it("makes the diagram tie: inflows equal outflows plus left over", () => {
    const input = base();
    input.rules = [{ id: "r1", name: "Brokerage", pattern: "fidelity", kind: "bucket", bucketId: "invest", position: 0 }];
    input.transactions = [
      tx("1", "02/01/2026", "FIDELITY TRANSFER", -1500, "Checking", "transfers"),
      tx("2", "03/04/2026", "WHOLE FOODS", 300, "Amex", "groceries"),
      tx("3", "03/06/2026", "BAR", 200, "Amex", "partying"),
    ];
    const result = resolveFlow(input);
    const graph = buildSankeyGraph(input.buckets, result.categories, input.spendingBuckets);
    expect(graph.inflowTotal).toBe(100500);
    expect(graph.outflowTotal).toBe(20000 + 10000 + 1500 + 300 + 200);
    expect(graph.leftover).toBe(graph.inflowTotal - graph.outflowTotal);
    expect(graph.shortfall).toBe(0);
  });
});

describe("paycheck check", () => {
  const rules: SankeyRuleRecord[] = [{ id: "pay", name: "Paycheck", pattern: "acme payroll", kind: "paycheck", bucketId: null, position: 0 }];

  it("expects take-home from lines with a last paycheck, ignoring year-to-date-only income", () => {
    const input = base();
    input.rules = rules;
    input.transactions = [
      tx("1", "01/15/2026", "ACME PAYROLL DIRECT DEP", -35000, "Amex", "unclassified"),
      tx("2", "02/15/2026", "ACME PAYROLL DIRECT DEP", -35000, "Amex", "unclassified"),
    ];
    const { paycheck } = resolveFlow(input);
    expect(paycheck.gross).toBe(100000);
    expect(paycheck.withheld).toBe(30000);
    expect(paycheck.expectedNet).toBe(70000);
    expect(paycheck.deposits).toBe(70000);
    expect(paycheck.status).toBe("ok");
    expect(paycheck.depositTransactions).toHaveLength(2);
  });

  it("flags a mismatch and a missing rule, and keeps paycheck deposits out of spending", () => {
    const input = base();
    input.transactions = [tx("1", "01/15/2026", "ACME PAYROLL", -50000, "Amex", "groceries")];
    expect(resolveFlow(input).paycheck.status).toBe("missing-rule");

    input.rules = rules;
    const result = resolveFlow(input);
    expect(result.paycheck.status).toBe("mismatch");
    expect(result.paycheck.difference).toBe(50000 - 70000);
    expect(amountOf(result, "food")).toBe(0);
  });

  it("is quiet when nothing has been entered", () => {
    const input = base();
    input.lines = [];
    expect(resolveFlow(input).paycheck.status).toBe("none");
  });
});

describe("matchRule and availableYears", () => {
  it("matches case-insensitively and ignores blank patterns", () => {
    const rules: SankeyRuleRecord[] = [
      { id: "a", name: "A", pattern: "  ", kind: "bucket", bucketId: "x", position: 0 },
      { id: "b", name: "B", pattern: "Vanguard", kind: "bucket", bucketId: "x", position: 1 },
    ];
    expect(matchRule("ACH vanguard buy", rules)?.id).toBe("b");
    expect(matchRule("grocery", rules)).toBeNull();
  });

  it("lists tax years, transaction years and this year in order", () => {
    expect(availableYears([2024], [{ date: "05/05/2025" }, { date: "garbage" }], new Date(2026, 5, 1))).toEqual([
      2024, 2025, 2026,
    ]);
  });
});
