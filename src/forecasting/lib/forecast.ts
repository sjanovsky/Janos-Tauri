// Pure computation for the Forecasting page: turn the Net Worth page's year-end balances into a
// year-by-year projection with a low/high annual-return range per account. Framework-free so it can
// be unit-tested; the page wires it to Tauri data and localStorage.
import {
  buildNetWorthView,
  yearsFromMonths,
  yearViewMonths,
  type AccountRecord,
  type BalanceRecord,
  type BucketGroup,
  type NetWorthBucketRecord,
} from "../../networth/lib/networth";

// An account's assumed annual growth, in percent (e.g. 4 means +4%/yr). `low` ≤ `high`.
export type RateRange = { low: number; high: number };

export const DEFAULT_YEARS = 10;
export const MAX_YEARS = 60;
export const DEFAULT_ASSET_RATE: RateRange = { low: 4, high: 8 };
export const DEFAULT_LIABILITY_RATE: RateRange = { low: 0, high: 0 };

export type Scenario = "low" | "mid" | "high";

export type ForecastAccountRow = {
  accountId: string;
  name: string;
  // Real year-end balances, one per historic year (null before the account's first entry).
  historic: (number | null)[];
  // Projected balances for each forecast year under each scenario.
  low: number[];
  mid: number[];
  high: number[];
  rate: RateRange;
  // Yearly payment added to the account (from Planning), 0 when none is mapped.
  payment: number;
};

export type ForecastGroup = {
  meta: BucketGroup["meta"];
  accounts: ForecastAccountRow[];
};

export type ForecastResult = {
  // Historic year labels (the last is the current/latest year, whose value is the forecast's base).
  historicYears: string[];
  forecastYears: string[];
  groups: ForecastGroup[];
  netHistoric: number[];
  netLow: number[];
  netMid: number[];
  netHigh: number[];
};

// Swap reversed ends and ignore non-finite input so a half-typed range can't break the math.
export function normalizeRate(rate: RateRange): RateRange {
  const low = Number.isFinite(rate.low) ? rate.low : 0;
  const high = Number.isFinite(rate.high) ? rate.high : low;
  return low <= high ? { low, high } : { low: high, high: low };
}

// Compound `base` for `years` years at `percent` per year.
export function compound(base: number, percent: number, years: number): number {
  return base * (1 + percent / 100) ** years;
}

// Compound `base` for each of `years` years at `percent`, adding `payment` at the end of each year.
export function projectWithPayments(base: number, percent: number, payment: number, years: number): number[] {
  const values: number[] = [];
  let balance = base;
  for (let index = 0; index < years; index += 1) {
    balance = balance * (1 + percent / 100) + payment;
    values.push(balance);
  }
  return values;
}

export function buildForecast(
  buckets: NetWorthBucketRecord[],
  accounts: AccountRecord[],
  balances: BalanceRecord[],
  nowMonth: string,
  yearsToForecast: number,
  // Per-account overrides; accounts without one get the asset/liability default by sign of balance.
  rates: Record<string, RateRange>,
  // Yearly payment per account id, added at the end of every forecast year.
  payments: Record<string, number> = {},
): ForecastResult {
  const years = yearsFromMonths(balances.map((balance) => balance.month));
  const spans = yearViewMonths(years, nowMonth);
  const endMonths = spans.map((span) => span.endMonth);
  const historicYears = spans.map((span) => span.year);
  const view = buildNetWorthView(buckets, accounts, balances, endMonths);

  const horizon = Math.max(0, Math.min(MAX_YEARS, Math.floor(yearsToForecast)));
  const lastYear = historicYears.length > 0 ? Number.parseInt(historicYears[historicYears.length - 1], 10) : 0;
  const forecastYears = historicYears.length === 0
    ? []
    : Array.from({ length: horizon }, (_, index) => String(lastYear + index + 1));

  const netHistoric = view.netPerColumn.slice();
  const netLow = new Array<number>(forecastYears.length).fill(0);
  const netMid = new Array<number>(forecastYears.length).fill(0);
  const netHigh = new Array<number>(forecastYears.length).fill(0);

  const groups: ForecastGroup[] = view.groups.map((group) => ({
    meta: group.meta,
    accounts: group.accounts.map((account) => {
      const historic = account.cells.map((cell) => cell.value);
      const base = historic.length > 0 ? (historic[historic.length - 1] ?? 0) : 0;
      const rate = normalizeRate(rates[account.accountId] ?? (base < 0 ? DEFAULT_LIABILITY_RATE : DEFAULT_ASSET_RATE));
      const mid = (rate.low + rate.high) / 2;
      const payment = payments[account.accountId] ?? 0;
      const project = (percent: number) => projectWithPayments(base, percent, payment, forecastYears.length);
      const low = project(rate.low);
      const midValues = project(mid);
      const high = project(rate.high);
      for (let index = 0; index < forecastYears.length; index += 1) {
        netLow[index] += low[index] ?? 0;
        netMid[index] += midValues[index] ?? 0;
        netHigh[index] += high[index] ?? 0;
      }
      return { accountId: account.accountId, name: account.name, historic, low, mid: midValues, high, rate, payment };
    }),
  }));

  return { historicYears, forecastYears, groups, netHistoric, netLow, netMid, netHigh };
}
