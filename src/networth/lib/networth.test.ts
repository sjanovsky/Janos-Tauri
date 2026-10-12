import { describe, expect, it } from "vitest";
import {
  addMonth,
  buildNetWorthView,
  buildNetWorthYearlyView,
  carryForwardValues,
  formatMonthAxis,
  formatMonthLabel,
  sortedUniqueMonths,
  yearsFromMonths,
  yearViewMonths,
  UNGROUPED_BUCKET_ID,
  type AccountRecord,
  type BalanceRecord,
  type NetWorthBucketRecord,
} from "./networth";

describe("addMonth", () => {
  it("advances and rolls over the year", () => {
    expect(addMonth("2026-10", 1)).toBe("2026-11");
    expect(addMonth("2026-11", 2)).toBe("2027-01");
    expect(addMonth("2026-01", -1)).toBe("2025-12");
  });
});

describe("sortedUniqueMonths", () => {
  it("sorts ascending and drops duplicates and blanks without filling gaps", () => {
    expect(sortedUniqueMonths(["2026-04", "2026-01", "2026-04", ""])).toEqual([
      "2026-01",
      "2026-04",
    ]);
    expect(sortedUniqueMonths([])).toEqual([]);
  });
});

describe("formatMonth helpers", () => {
  it("formats full and compact labels", () => {
    expect(formatMonthLabel("2026-10")).toBe("October 2026");
    expect(formatMonthAxis("2026-10")).toBe("Oct'26");
  });
});

describe("carryForwardValues", () => {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04"];

  it("carries the most recent entry forward and marks explicit months", () => {
    const cells = carryForwardValues(
      [
        { month: "2026-01", amount: 100 },
        { month: "2026-03", amount: 150 },
      ],
      months,
    );
    expect(cells).toEqual([
      { month: "2026-01", value: 100, explicit: true },
      { month: "2026-02", value: 100, explicit: false },
      { month: "2026-03", value: 150, explicit: true },
      { month: "2026-04", value: 150, explicit: false },
    ]);
  });

  it("leaves months before the first entry as null (not yet counted)", () => {
    const cells = carryForwardValues([{ month: "2026-03", amount: 50 }], months);
    expect(cells.map((cell) => cell.value)).toEqual([null, null, 50, 50]);
  });
});

describe("buildNetWorthView", () => {
  const buckets: NetWorthBucketRecord[] = [
    { id: "retirement", name: "Retirement", color: "#111", position: 0 },
    { id: "cash", name: "Cash", color: "#222", position: 1 },
  ];
  const accounts: AccountRecord[] = [
    { id: "a401k", name: "401(k)", bucketId: "retirement", position: 0 },
    { id: "checking", name: "Checking", bucketId: "cash", position: 0 },
    { id: "card", name: "Credit Card", bucketId: null, position: 1 },
  ];
  const months = ["2026-01", "2026-02"];

  it("sums accounts into their buckets and carries balances forward", () => {
    const balances: BalanceRecord[] = [
      { accountId: "a401k", month: "2026-01", amount: 1000 },
      { accountId: "checking", month: "2026-01", amount: 500 },
      // Only January entered for 401k; February carries it forward.
      { accountId: "checking", month: "2026-02", amount: 600 },
      // A liability: a negative balance that reduces net worth.
      { accountId: "card", month: "2026-01", amount: -200 },
    ];

    const view = buildNetWorthView(buckets, accounts, balances, months);

    // Retirement + Cash (real) then Ungrouped (holds the credit card).
    expect(view.bucketMeta.map((meta) => meta.id)).toEqual(["retirement", "cash", UNGROUPED_BUCKET_ID]);

    // Net worth: Jan = 1000 + 500 - 200 = 1300; Feb carries 401k (1000) + card (-200), checking = 600.
    expect(view.netPerColumn).toEqual([1300, 1400]);

    const retirement = view.groups.find((group) => group.meta.id === "retirement");
    expect(retirement?.totalPerColumn).toEqual([1000, 1000]);

    const ungrouped = view.groups.find((group) => group.meta.id === UNGROUPED_BUCKET_ID);
    expect(ungrouped?.totalPerColumn).toEqual([-200, -200]);

    // February's chart segments include the carried-forward retirement value and the liability.
    const feb = view.series[1];
    expect(feb.month).toBe("2026-02");
    expect(feb.segments).toEqual([
      { bucketId: "retirement", label: "Retirement", color: "#111", value: 1000 },
      { bucketId: "cash", label: "Cash", color: "#222", value: 600 },
      { bucketId: UNGROUPED_BUCKET_ID, label: "Ungrouped", color: expect.any(String), value: -200 },
    ]);
  });

  it("omits buckets that have no accounts and drops zero-value segments", () => {
    const soloBuckets: NetWorthBucketRecord[] = [
      { id: "retirement", name: "Retirement", color: "#111", position: 0 },
      { id: "brokerage", name: "Brokerage", color: "#333", position: 1 },
    ];
    const soloAccounts: AccountRecord[] = [
      { id: "a401k", name: "401(k)", bucketId: "retirement", position: 0 },
    ];
    const balances: BalanceRecord[] = [{ accountId: "a401k", month: "2026-01", amount: 1000 }];

    const view = buildNetWorthView(soloBuckets, soloAccounts, balances, ["2026-01"]);

    // Brokerage has no accounts, so it never becomes a grid group.
    expect(view.groups.map((group) => group.meta.id)).toEqual(["retirement"]);
    expect(view.series[0].segments).toEqual([
      { bucketId: "retirement", label: "Retirement", color: "#111", value: 1000 },
    ]);
  });
});

describe("yearsFromMonths", () => {
  it("returns the distinct years, ascending", () => {
    expect(yearsFromMonths(["2026-03", "2024-11", "2026-01", ""])).toEqual(["2024", "2026"]);
    expect(yearsFromMonths([])).toEqual([]);
  });
});

describe("yearViewMonths", () => {
  it("spans Jan–Dec for other years but stops the current year at nowMonth", () => {
    const spans = yearViewMonths(["2025", "2026"], "2026-03");

    expect(spans[0]).toEqual({
      year: "2025",
      endMonth: "2025-12",
      monthKeys: Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}`),
    });
    expect(spans[1]).toEqual({
      year: "2026",
      endMonth: "2026-03",
      monthKeys: ["2026-01", "2026-02", "2026-03"],
    });
  });
});

describe("buildNetWorthYearlyView", () => {
  const buckets: NetWorthBucketRecord[] = [
    { id: "retirement", name: "Retirement", color: "#111", position: 0 },
    { id: "cash", name: "Cash", color: "#222", position: 1 },
  ];
  const accounts: AccountRecord[] = [
    { id: "a401k", name: "401(k)", bucketId: "retirement", position: 0 },
    { id: "checking", name: "Checking", bucketId: "cash", position: 0 },
  ];
  const balances: BalanceRecord[] = [
    { accountId: "a401k", month: "2025-06", amount: 1000 },
    { accountId: "checking", month: "2025-06", amount: 500 },
    { accountId: "a401k", month: "2026-01", amount: 1200 },
  ];

  it("gives each year a column of monthly bars that rolls up to the year-end balance", () => {
    const yearly = buildNetWorthYearlyView(buckets, accounts, balances, ["2025-06", "2026-03"], "2026-03");

    // One column per touched year; both are read-only (balances are entered in Months view).
    expect(yearly.columns.map((column) => column.key)).toEqual(["2025", "2026"]);
    expect(yearly.columns.every((column) => !column.editable && column.month === null)).toBe(true);

    // 2025 is a full year (12 bars); the current year stops at nowMonth (Jan–Mar = 3 bars).
    expect(yearly.columns[0].bars).toHaveLength(12);
    expect(yearly.columns[1].bars).toHaveLength(3);

    // January 2025 predates the first balance, so that bar has no segments...
    expect(yearly.columns[0].bars[0].segments).toEqual([]);
    // ...while June 2025 (index 5) carries both accounts.
    expect(yearly.columns[0].bars[5].segments).toEqual([
      { bucketId: "retirement", label: "Retirement", color: "#111", value: 1000 },
      { bucketId: "cash", label: "Cash", color: "#222", value: 500 },
    ]);

    // Grid folds to each year-end: 2025 = Dec (1000 + 500), 2026 = Mar (carried 1200 + 500).
    expect(yearly.netPerColumn).toEqual([1500, 1700]);
    const retirement = yearly.groups.find((group) => group.meta.id === "retirement");
    expect(retirement?.totalPerColumn).toEqual([1000, 1200]);
    expect(retirement?.accounts[0].cells).toEqual([
      { month: "2025", value: 1000, explicit: false },
      { month: "2026", value: 1200, explicit: false },
    ]);
  });
});
