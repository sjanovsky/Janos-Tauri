import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { abbreviateCurrency, wholeCurrencyFormatter } from "../spending/lib/format";
import {
  currentMonth,
  type AccountRecord,
  type BalanceRecord,
  type NetWorthBucketRecord,
} from "../networth/lib/networth";
import { usePlanningPayments } from "./lib/usePlanningPayments";
import { DEFAULT_YEARS, buildForecast, type RateRange } from "../forecasting/lib/forecast";

// The Forecasting tab keeps its years-to-forecast and per-account return ranges here; reading them
// keeps this chart identical to the forecast without sharing any of that page's code.
const FORECASTING_STORAGE_KEY = "janos.forecasting.v1";

function savedAssumptions(): { years: number; rates: Record<string, RateRange> } {
  try {
    const parsed = JSON.parse(localStorage.getItem(FORECASTING_STORAGE_KEY) ?? "null");
    return {
      years: typeof parsed?.years === "number" ? parsed.years : DEFAULT_YEARS,
      rates: parsed?.rates && typeof parsed.rates === "object" ? parsed.rates : {},
    };
  } catch {
    return { years: DEFAULT_YEARS, rates: {} };
  }
}

const W = 560;
const LABEL_W = 44;
const VALUE_PAD = 62;
const ROW_H = 24;
const BAR_H = 14;
const TOP = 8;

// Projected net worth by year as horizontal bars: the years run down the y-axis, newest at the
// bottom. Real year-end balances are solid; forecast years show the midpoint with a line across the
// low-to-high range.
function NetWorthProjection() {
  const [buckets, setBuckets] = useState<NetWorthBucketRecord[]>([]);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [balances, setBalances] = useState<BalanceRecord[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const fail = (error: unknown) => {
      console.error("Failed to load net-worth data for the projection", error);
      setFailed(true);
    };
    invoke<NetWorthBucketRecord[]>("list_networth_buckets").then(setBuckets).catch(fail);
    invoke<AccountRecord[]>("list_networth_accounts").then(setAccounts).catch(fail);
    invoke<BalanceRecord[]>("list_networth_balances").then(setBalances).catch(fail);
  }, []);

  const payments = usePlanningPayments(accounts);

  const rows = useMemo(() => {
    const { years, rates } = savedAssumptions();
    const forecast = buildForecast(buckets, accounts, balances, currentMonth(), years, rates, payments);
    return [
      ...forecast.historicYears.map((year, index) => ({
        year,
        value: forecast.netHistoric[index],
        low: null as number | null,
        high: null as number | null,
        projected: false,
      })),
      ...forecast.forecastYears.map((year, index) => ({
        year,
        value: forecast.netMid[index],
        low: forecast.netLow[index] as number | null,
        high: forecast.netHigh[index] as number | null,
        projected: true,
      })),
    ];
  }, [buckets, accounts, balances, payments]);

  if (failed || rows.length === 0) {
    return (
      <div className="planning-card planning-chart planning-chart--empty">
        {failed ? "Couldn't load net worth." : "Enter balances on the Net Worth page to see the projection."}
      </div>
    );
  }

  const min = Math.min(0, ...rows.map((row) => row.low ?? row.value));
  const max = Math.max(0, ...rows.map((row) => row.high ?? row.value));
  const left = LABEL_W;
  const plotW = W - left - VALUE_PAD;
  const x = (value: number) => left + ((value - min) / (max - min || 1)) * plotW;
  const height = TOP * 2 + ROW_H * rows.length;

  return (
    <div className="planning-card planning-chart">
      <header className="planning-heading">
        <h2>Projected net worth</h2>
        <p>Year-end balances from Net Worth, then the Forecasting midpoint with its low–high range (including mapped payments).</p>
      </header>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Projected net worth by year">
        <line className="planning-chart__axis" x1={x(0)} x2={x(0)} y1={TOP} y2={height - TOP} />
        {rows.map((row, index) => {
          const top = TOP + index * ROW_H;
          const mid = top + ROW_H / 2;
          const barX = Math.min(x(0), x(row.value));
          const barW = Math.abs(x(row.value) - x(0));
          const end = Math.max(x(row.value), row.high === null ? -Infinity : x(row.high));
          return (
            <g key={row.year}>
              <title>
                {row.year}
                {row.projected ? " (forecast)" : ""}: {wholeCurrencyFormatter.format(row.value)}
                {row.low !== null && row.high !== null
                  ? ` — range ${wholeCurrencyFormatter.format(row.low)} to ${wholeCurrencyFormatter.format(row.high)}`
                  : ""}
              </title>
              <text className="planning-chart__label" x={LABEL_W - 8} y={mid} textAnchor="end" dominantBaseline="middle">
                {row.year}
              </text>
              <rect
                className={row.projected ? "planning-chart__bar planning-chart__bar--projected" : "planning-chart__bar"}
                x={barX}
                y={mid - BAR_H / 2}
                width={Math.max(barW, 1)}
                height={BAR_H}
                rx={2}
              />
              {row.low !== null && row.high !== null && (
                <g className="planning-chart__range">
                  <line x1={x(row.low)} x2={x(row.high)} y1={mid} y2={mid} />
                  <line x1={x(row.low)} x2={x(row.low)} y1={mid - 4} y2={mid + 4} />
                  <line x1={x(row.high)} x2={x(row.high)} y1={mid - 4} y2={mid + 4} />
                </g>
              )}
              <text className="planning-chart__value" x={end + 6} y={mid} dominantBaseline="middle">
                {abbreviateCurrency(row.value)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default NetWorthProjection;
