import { describe, expect, it } from "vitest";
import {
  buildGrossBreakdown,
  checkDeposits,
  currentVersion,
  expectedNet,
  matchesExpectedNet,
  moveBucket,
  moveItem,
  resolveVersion,
  toIncomeTransactions,
  type PaycheckRecord,
} from "./income";
import type { ImportedTransaction } from "../../spending/lib/csvParser";

const tx = (id: string, amount: number, sourceBank: string, category: string): ImportedTransaction => ({
  id,
  date: "1/15/2026",
  description: id,
  cardMember: "",
  accountNumber: "",
  amount,
  sourceBank,
  sourceFileName: "f.csv",
  category,
});

describe("toIncomeTransactions", () => {
  const banks = [
    { name: "Card", spendingPositive: true },
    { name: "Checking", spendingPositive: false },
  ];
  const income = new Set(["income-paycheck"]);

  it("keeps only income categories and makes deposits positive for either sign convention", () => {
    const result = toIncomeTransactions(
      [
        tx("a", -1000, "Card", "income-paycheck"),
        tx("b", 2000, "Checking", "income-paycheck"),
        tx("c", 50, "Card", "groceries"),
      ],
      income,
      banks,
    );
    expect(result.map((t) => [t.id, t.amount])).toEqual([
      ["a", 1000],
      ["b", 2000],
    ]);
  });

  it("treats an unknown bank like a spending-positive one", () => {
    const [result] = toIncomeTransactions([tx("a", -300, "Other", "income-paycheck")], income, banks);
    expect(result.amount).toBe(300);
  });
});

const items = [{ id: "k" }, { id: "t" }];
const paycheck: PaycheckRecord = {
  id: "rachel",
  name: "Rachel Salary",
  depositPattern: "ACME",
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
        { itemId: "k", amount: 300 },
        { itemId: "t", amount: 500 },
        { itemId: "unused", amount: 0 },
      ],
    },
  ],
};
const v1 = paycheck.versions[0];

describe("paycheck templates", () => {
  it("computes net as gross minus every line item", () => {
    expect(expectedNet(v1, items)).toBe(2200);
    expect(matchesExpectedNet(2200, 2200.25)).toBe(true);
    expect(matchesExpectedNet(2200, 2150)).toBe(false);
  });

  it("splits a deposit into net and line item segments", () => {
    const deposit = { ...tx("d1", 2200, "Checking", "rachel"), amount: 2200 };
    const { transactions, itemCategories } = buildGrossBreakdown([deposit], new Map([["rachel", paycheck]]));
    expect(transactions.map((t) => [t.category, t.amount])).toEqual([
      ["net:rachel", 2200],
      ["item:k", 300],
      ["item:t", 500],
    ]);
    expect([...(itemCategories.get("k") ?? [])]).toEqual(["rachel"]);
  });
});

describe("drag and drop ordering", () => {
  const list = [
    { id: "a", label: "A", bucketId: "x", position: 0 },
    { id: "b", label: "B", bucketId: "x", position: 1 },
    { id: "c", label: "C", bucketId: "y", position: 2 },
  ];

  it("moves an item across buckets before a target", () => {
    const moved = moveItem(list, "a", "y", "c");
    expect(moved.map((i) => [i.id, i.bucketId, i.position])).toEqual([
      ["b", "x", 0],
      ["a", "y", 1],
      ["c", "y", 2],
    ]);
  });

  it("appends to the end and can ungroup", () => {
    const moved = moveItem(list, "a", null, null);
    expect(moved.map((i) => i.id)).toEqual(["b", "c", "a"]);
    expect(moved[2].bucketId).toBeNull();
  });

  it("reorders buckets", () => {
    const buckets = [
      { id: "x", name: "X", color: "", position: 0 },
      { id: "y", name: "Y", color: "", position: 1 },
    ];
    expect(moveBucket(buckets, "y", "x").map((b) => b.id)).toEqual(["y", "x"]);
  });
});

describe("paycheck versions", () => {
  const raise: PaycheckRecord = {
    ...paycheck,
    versions: [
      v1,
      { id: "v2", effectiveFrom: "2026-03-01", effectiveTo: "", gross: 3500, transactionId: null, values: [{ itemId: "k", amount: 350 }] },
      { id: "once", effectiveFrom: "", effectiveTo: "", gross: 5000, transactionId: "bonus", values: [] },
    ],
  };
  const on = (id: string, date: string) => resolveVersion(raise, { id, date })?.id;

  it("resolves a deposit to the version in effect on its date", () => {
    expect(on("a", "2/28/2026")).toBe("v1");
    expect(on("b", "3/1/2026")).toBe("v2");
    expect(on("c", "12/31/2026")).toBe("v2");
  });

  it("uses the earliest version for deposits before the first date", () => {
    const later: PaycheckRecord = { ...raise, versions: [{ ...v1, effectiveFrom: "2026-01-01" }] };
    expect(resolveVersion(later, { id: "x", date: "6/1/2025" })?.id).toBe("v1");
  });

  it("prefers a one-off for its own deposit and ignores it for others", () => {
    expect(on("bonus", "3/15/2026")).toBe("once");
    expect(on("other", "3/15/2026")).toBe("v2");
    expect(currentVersion(raise)?.id).toBe("v2");
  });

  it("honors end dates and falls back across a gap", () => {
    const gappy: PaycheckRecord = {
      ...paycheck,
      versions: [
        { ...v1, effectiveFrom: "2026-01-01", effectiveTo: "2026-01-31" },
        { ...v1, id: "v2", effectiveFrom: "2026-03-01", effectiveTo: "2026-03-31" },
      ],
    };
    const on2 = (date: string) => resolveVersion(gappy, { id: "x", date })?.id;
    expect(on2("1/31/2026")).toBe("v1");
    expect(on2("3/1/2026")).toBe("v2");
    // February is in neither range: the version that started before it applies.
    expect(on2("2/15/2026")).toBe("v1");
    // After the last end date, the latest version that started still applies.
    expect(on2("5/1/2026")).toBe("v2");
  });

  it("lets a later start win an overlap", () => {
    const overlap: PaycheckRecord = {
      ...paycheck,
      versions: [
        { ...v1, effectiveFrom: "2026-01-01", effectiveTo: "" },
        { ...v1, id: "v2", effectiveFrom: "2026-02-01", effectiveTo: "" },
      ],
    };
    expect(resolveVersion(overlap, { id: "x", date: "2/10/2026" })?.id).toBe("v2");
    expect(resolveVersion(overlap, { id: "x", date: "1/10/2026" })?.id).toBe("v1");
  });

  it("builds a gross breakdown from the version in effect", () => {
    const deposit = { ...tx("d", 2000, "Checking", "rachel"), date: "3/15/2026" };
    const { transactions } = buildGrossBreakdown([deposit], new Map([["rachel", raise]]));
    expect(transactions.map((t) => [t.category, t.amount])).toEqual([
      ["net:rachel", 2000],
      ["item:k", 350],
    ]);
  });
});

describe("checkDeposits", () => {
  const dep = (id: string, amount: number, date = "1/15/2026") => ({ id, date, amount, category: "rachel" });

  it("reports ok when every deposit equals its net", () => {
    const result = checkDeposits([paycheck], items, [dep("a", 2200), dep("b", 2200.25)]);
    expect(result).toMatchObject({ status: "ok", count: 2, mismatched: 0, expected: 4400 });
  });

  it("flags deposits that are off, and ignores other categories", () => {
    const result = checkDeposits([paycheck], items, [
      dep("a", 2200),
      dep("b", 2000),
      { id: "c", date: "1/15/2026", amount: 50, category: "interest" },
    ]);
    expect(result).toMatchObject({ status: "mismatch", count: 2, mismatched: 1 });
  });

  it("is none without paycheck deposits", () => {
    expect(checkDeposits([paycheck], items, []).status).toBe("none");
  });
});
