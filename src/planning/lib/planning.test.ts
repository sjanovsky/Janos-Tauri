import { describe, expect, it } from "vitest";
import type { PaycheckBucketRecord, PaycheckItemRecord, PaycheckRecord } from "../../income/lib/income";
import type { CategoryRecord } from "../../spending/lib/categories";
import type { ImportedTransaction } from "../../upload/lib/csvParser";
import {
  matchAmount,
  parseMatch,
  defaultSections,
  parseSections,
  lineKey,
  matchKey,
  bucketSource,
  expandBucketSources,
  itemSource,
  planPaycheck,
  planningTotals,
  spendingHistory,
  NET_INCOME_SOURCE,
  paymentKey,
  paymentMapping,
  paymentsByAccount,
  type PaymentSource,
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

const sections = defaultSections(items, ["withholding", "tax"], [], { taxes: "#69c", retirement: "#486" });

describe("planPaycheck", () => {
  it("annualizes the current version and adds extra income", () => {
    const plan = planPaycheck(paycheck, items, buckets, new Map(), sections);
    expect(plan.baseSalary).toBe(104_000);
    expect(plan.annualIncome).toBe(114_000);
    const [taxes, retirement] = plan.sections;
    expect(taxes.lines.map((line) => line.pulled)).toEqual([13_000, 6_500]);
    expect(taxes.amount).toBe(19_500);
    expect(retirement.lines.map((line) => [line.name, line.value])).toEqual([["401K", 10_400]]);
  });

  it("lets a line be overridden", () => {
    const key = lineKey("taxes", itemSource("ss"), "pc1");
    const plan = planPaycheck(paycheck, items, buckets, new Map([[key, "7000"]]), sections);
    expect(plan.sections[0].amount).toBe(20_000);
    expect(plan.sections[0].lines[1].overridden).toBe(true);
  });

  it("uses typed overrides and the company match", () => {
    const settings = new Map([
      [lineKey("retirement", itemSource("401k"), "pc1"), "12000"],
      [matchKey("retirement", "pc1"), "5%"],
    ]);
    const retirement = planPaycheck(paycheck, items, buckets, settings, sections).sections[1];
    expect(retirement.amount).toBe(12_000);
    expect(retirement.matchAmount).toBe(5_700);
  });

  it("ignores a match on a section without one, and sources that no longer exist", () => {
    const custom = [
      { id: "x", name: "Other", color: "", sources: [itemSource("hsa"), bucketSource("gone"), itemSource("fed")], match: false },
    ];
    const plan = planPaycheck(paycheck, items, buckets, new Map([[matchKey("x", "pc1"), "5%"]]), custom);
    expect(plan.sections[0].lines.map((line) => line.name)).toEqual(["HSA", "Federal"]);
    expect(plan.sections[0].matchAmount).toBe(0);
  });
});

describe("sections", () => {
  it("parses saved sections and rejects garbage", () => {
    expect(parseSections(undefined)).toBeNull();
    expect(parseSections("nope")).toBeNull();
    expect(parseSections(JSON.stringify([{ id: "a", name: "A", color: "#fff", sources: ["item:x"], match: true }]))).toEqual([
      { id: "a", name: "A", color: "#fff", sources: ["item:x"], match: true },
    ]);
  });

  it("starts retirement with the items in savings buckets and loose 401K items", () => {
    const [, retirement] = defaultSections(items, [], ["tax"], { taxes: "", retirement: "" });
    expect(retirement.sources).toEqual(["item:ss", "item:401k"]);
  });

  it("expands saved bucket sources into their items", () => {
    const [expanded] = expandBucketSources(
      [{ id: "a", name: "A", color: "", sources: ["bucket:withholding", "item:hsa", "bucket:gone"], match: false }],
      items,
    );
    expect(expanded.sources).toEqual(["item:fed", "item:hsa"]);
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
    const plan = planPaycheck(paycheck, items, buckets, new Map([[matchKey("retirement", "pc1"), "1000"]]), sections);
    const totals = planningTotals([plan], sections, 50_000);
    expect(totals.remaining).toBe(114_000 - 19_500 - 10_400 - 50_000);
    expect(totals.sections.map((section) => [section.amount, section.match])).toEqual([
      [19_500, 0],
      [10_400, 1_000],
    ]);
  });
});

describe("forecast payments", () => {
  const sources: PaymentSource[] = [
    { key: "401k:pc1", name: "A 401K", color: "", amount: 20000 },
    { key: "match:pc1", name: "A match", color: "", amount: 5000 },
    { key: NET_INCOME_SOURCE, name: "Net income", color: "", amount: 40000 },
  ];

  it("sums the sources mapped to each account and ignores missing accounts", () => {
    const settings = new Map([
      [paymentKey("401k:pc1"), "acct-401k"],
      [paymentKey("match:pc1"), "acct-401k"],
      [paymentKey(NET_INCOME_SOURCE), "gone"],
    ]);
    const mapping = paymentMapping(sources, settings, new Set(["acct-401k", "acct-savings"]));
    expect(paymentsByAccount(sources, mapping)).toEqual({ "acct-401k": 25000 });
  });
});
