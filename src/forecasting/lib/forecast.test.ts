import { describe, expect, it } from "vitest";
import { buildForecast, compound, normalizeRate } from "./forecast";

const buckets = [{ id: "b1", name: "Invest", color: "#000", position: 0 }];
const accounts = [
  { id: "a1", name: "401k", bucketId: "b1", position: 0 },
  { id: "a2", name: "Loan", bucketId: "b1", position: 1 },
];
const balances = [
  { accountId: "a1", month: "2024-12", amount: 1000 },
  { accountId: "a1", month: "2025-12", amount: 2000 },
  { accountId: "a1", month: "2026-08", amount: 3000 },
  { accountId: "a2", month: "2025-12", amount: -500 },
];

describe("normalizeRate", () => {
  it("orders low/high and tolerates NaN", () => {
    expect(normalizeRate({ low: 8, high: 4 })).toEqual({ low: 4, high: 8 });
    expect(normalizeRate({ low: 5, high: Number.NaN })).toEqual({ low: 5, high: 5 });
  });
});

describe("buildForecast", () => {
  it("uses year-end history, then compounds from the latest balance", () => {
    const result = buildForecast(buckets, accounts, balances, "2026-10", 2, {
      a1: { low: 0, high: 10 },
    });
    expect(result.historicYears).toEqual(["2024", "2025", "2026"]);
    expect(result.forecastYears).toEqual(["2027", "2028"]);
    const [invest] = result.groups;
    expect(invest.accounts[0].historic).toEqual([1000, 2000, 3000]);
    expect(invest.accounts[0].high[1]).toBeCloseTo(compound(3000, 10, 2));
    expect(invest.accounts[0].low).toEqual([3000, 3000]);
    // The liability defaults to 0% growth, so it stays flat.
    expect(invest.accounts[1].mid).toEqual([-500, -500]);
    expect(result.netHistoric).toEqual([1000, 1500, 2500]);
    expect(result.netHigh[0]).toBeCloseTo(3300 - 500);
  });

  it("returns an empty forecast with no balances", () => {
    const result = buildForecast(buckets, accounts, [], "2026-10", 5, {});
    expect(result.historicYears).toEqual([]);
    expect(result.forecastYears).toEqual([]);
  });
});
