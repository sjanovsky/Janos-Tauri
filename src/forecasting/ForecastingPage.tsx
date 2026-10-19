import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { abbreviateCurrency, currencyFormatter, wholeCurrencyFormatter } from "../spending/lib/format";
import {
  currentMonth,
  type AccountRecord,
  type BalanceRecord,
  type NetWorthBucketRecord,
} from "../networth/lib/networth";
import { DEFAULT_YEARS, MAX_YEARS, buildForecast, type ForecastResult, type RateRange } from "./lib/forecast";
import { usePlanningPayments } from "../planning/lib/usePlanningPayments";
import "./forecasting.css";

const DB_ERROR = "Couldn't reach the local database. Make sure the app is running via `npm run tauri dev`.";
const STORAGE_KEY = "janos.forecasting.v1";

type RateMode = "range" | "single";
// `singles` holds the one-number rate per account, kept apart from the low/high range so switching
// modes doesn't lose either.
type Saved = {
  years: number;
  rates: Record<string, RateRange>;
  mode: RateMode;
  singles: Record<string, number>;
};
type Group = ForecastResult["groups"][number];

function loadSaved(): Saved {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Saved> | null;
    return {
      years: typeof parsed?.years === "number" ? parsed.years : DEFAULT_YEARS,
      rates: parsed?.rates && typeof parsed.rates === "object" ? parsed.rates : {},
      mode: parsed?.mode === "single" ? "single" : "range",
      singles: parsed?.singles && typeof parsed.singles === "object" ? parsed.singles : {},
    };
  } catch {
    return { years: DEFAULT_YEARS, rates: {}, mode: "range", singles: {} };
  }
}

const money = (value: number | null | undefined) =>
  value === null || value === undefined || Math.abs(value) < 0.5 ? "—" : wholeCurrencyFormatter.format(value);

// Forecasting: projects the Net Worth page's balances forward. History is the real year-end balances
// (the current year uses the latest entered month); each forecast year compounds the latest balance
// at a per-account low/high annual rate. Assumptions are kept in localStorage — they're a what-if
// the user tweaks, not accounting data.
function ForecastingPage() {
  const [buckets, setBuckets] = useState<NetWorthBucketRecord[]>([]);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [balances, setBalances] = useState<BalanceRecord[]>([]);
  const [dbError, setDbError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved>(loadSaved);

  useEffect(() => {
    const fail = (error: unknown) => {
      console.error("Failed to load net-worth data for forecasting", error);
      setDbError(DB_ERROR);
    };
    invoke<NetWorthBucketRecord[]>("list_networth_buckets").then(setBuckets).catch(fail);
    invoke<AccountRecord[]>("list_networth_accounts").then(setAccounts).catch(fail);
    invoke<BalanceRecord[]>("list_networth_balances").then(setBalances).catch(fail);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // Storage unavailable — assumptions just won't persist.
    }
  }, [saved]);

  const payments = usePlanningPayments(accounts);
  const single = saved.mode === "single";
  const forecast = useMemo(() => {
    const ranged = buildForecast(buckets, accounts, balances, currentMonth(), saved.years, saved.rates, payments);
    if (!single) {
      return ranged;
    }
    // One rate per account (its saved number, else the middle of its range) used as both low and high.
    const rates: Record<string, RateRange> = {};
    ranged.groups.forEach((group) =>
      group.accounts.forEach((account) => {
        const rate = saved.singles[account.accountId] ?? (account.rate.low + account.rate.high) / 2;
        rates[account.accountId] = { low: rate, high: rate };
      }),
    );
    return buildForecast(buckets, accounts, balances, currentMonth(), saved.years, rates, payments);
  }, [buckets, accounts, balances, saved, payments, single]);

  const setRate = (accountId: string, rate: RateRange) =>
    setSaved((current) => ({
      ...current,
      rates: { ...current.rates, [accountId]: rate },
    }));

  const setSingle = (accountId: string, rate: number) =>
    setSaved((current) => ({
      ...current,
      singles: { ...current.singles, [accountId]: rate },
    }));

  const hasData = forecast.historicYears.length > 0;

  return (
    <>
      {dbError && <div className="import-shell__db-error">{dbError}</div>}
      <section className="import-shell__panel forecast-page">
        <div className="import-shell__chart-card">
          <div className="import-shell__chart-header">
            <div>
              <h2>Net worth forecast</h2>
              <p className="networth-chart-subtitle">
                Year-end balances from the Net Worth page, then each year projected from your latest balances. Set each
                account's expected annual return in the table (a low and high range, or a single number); with a range,
                the chart shades the range between them. Accounts mapped on the Planning page also receive their yearly
                payment at the end of each forecast year.
              </p>
            </div>
            <div className="forecast-controls">
              <label className="forecast-years">
                Return
                <select
                  className="forecast-input forecast-mode"
                  value={saved.mode}
                  onChange={(event) =>
                    setSaved((current) => ({
                      ...current,
                      mode: event.target.value as RateMode,
                    }))
                  }
                >
                  <option value="range">Range</option>
                  <option value="single">Single</option>
                </select>
              </label>
              <label className="forecast-years">
                Years to forecast
                <NumberInput
                  value={saved.years}
                  min={1}
                  max={MAX_YEARS}
                  integer
                  onCommit={(years) => setSaved((current) => ({ ...current, years }))}
                />
              </label>
            </div>
          </div>
          {hasData ? (
            <ForecastGrid forecast={forecast} single={single} onRate={setRate} onSingle={setSingle} />
          ) : (
            <div className="import-shell__empty">Enter balances on the Net Worth page to build a forecast.</div>
          )}
        </div>
      </section>
    </>
  );
}

type NumberInputProps = {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  label?: string;
  // Shown inside the field's right edge (e.g. "%").
  suffix?: string;
};

// A numeric field that keeps its own text while you type (so "-" or "4." don't get clobbered) and
// only reports values that parse and fall within bounds. Blur snaps the text back to the real value.
function NumberInput({ value, onCommit, min, max, step, integer, label, suffix }: NumberInputProps) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const input = (
    <input
      type="number"
      className="forecast-input"
      value={text}
      min={min}
      max={max}
      step={step}
      aria-label={label}
      onChange={(event) => {
        setText(event.target.value);
        const parsed = Number.parseFloat(event.target.value);
        if (!Number.isFinite(parsed) || (min !== undefined && parsed < min) || (max !== undefined && parsed > max)) {
          return;
        }
        onCommit(integer ? Math.floor(parsed) : parsed);
      }}
      onBlur={() => setText(String(value))}
    />
  );
  return suffix ? (
    <span className="forecast-input-wrap" data-suffix={suffix}>
      {input}
    </span>
  ) : (
    input
  );
}

// --- Chart ---

// The chart and table share one scrolling container and one column grid: a fixed-width label area
// (account name + low/high inputs, where the chart draws its y-axis), then one column per year of
// `yearW` px. Because the chart's year slots are exactly the table's year columns, they line up.
const LABEL_W = 170;
const RATE_W = 76;
const LEFT = LABEL_W + RATE_W * 2;
const MIN_YEAR_W = 84;
const H = 340;
const M = { top: 20, bottom: 34 };

function niceTicks(min: number, max: number, target = 5): number[] {
  const range = max - min || 1;
  const rough = range / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = (residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1) * magnitude;
  const ticks: number[] = [];
  for (let tick = Math.floor(min / step) * step; tick <= max + step * 0.001; tick += step) {
    ticks.push(Math.round(tick / step) * step);
  }
  return ticks;
}

// Line chart over every year: a solid line for real year-end net worth, then — past a labelled
// divider on a tinted background — a shaded low-to-high band with a dashed midpoint line.
function ForecastChart({ forecast, yearW, single }: { forecast: ForecastResult; yearW: number; single: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const { historicYears, forecastYears, netHistoric, netLow, netMid, netHigh } = forecast;
  const years = [...historicYears, ...forecastYears];
  const histCount = historicYears.length;
  const anchor = netHistoric[histCount - 1] ?? 0;

  const ticks = niceTicks(Math.min(0, ...netHistoric, ...netLow), Math.max(0, ...netHistoric, ...netHigh));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const slot = yearW;
  const innerW = slot * years.length;
  const W = LEFT + innerW;
  const innerH = H - M.top - M.bottom;
  const x = (index: number) => LEFT + slot * (index + 0.5);
  const y = (value: number) => M.top + innerH * (1 - (value - yMin) / (yMax - yMin || 1));

  const points = (values: number[], from: number) => values.map((value, index) => `${x(from + index)},${y(value)}`);
  const line = (values: number[], from: number) => `M${points(values, from).join(" L")}`;

  // Forecast series start at the last real point so the lines connect to history.
  const from = histCount - 1;
  const low = [anchor, ...netLow];
  const high = [anchor, ...netHigh];
  const band = `M${[...points(high, from), ...points(low, from).reverse()].join(" L")} Z`;

  const dividerX = x(from) + slot / 2;
  const labelEvery = Math.ceil(years.length / 14);

  const hoverRows =
    hover === null
      ? []
      : hover < histCount
        ? [{ label: "Actual", value: netHistoric[hover] }]
        : single
          ? [{ label: "Forecast", value: netMid[hover - histCount] }]
          : [
              { label: "High", value: netHigh[hover - histCount] },
              { label: "Mid", value: netMid[hover - histCount] },
              { label: "Low", value: netLow[hover - histCount] },
            ];

  return (
    <div className="forecast-chart">
      <div className="forecast-legend">
        <span>
          <i className="forecast-key forecast-key--actual" />
          Actual
        </span>
        {!single && (
          <span>
            <i className="forecast-key forecast-key--band" />
            Forecast range (low–high)
          </span>
        )}
        <span>
          <i className="forecast-key forecast-key--mid" />
          {single ? "Forecast" : "Forecast midpoint"}
        </span>
      </div>
      <svg
        width={W}
        height={H}
        role="img"
        aria-label="Net worth history and forecast"
        onMouseLeave={() => setHover(null)}
      >
        {forecastYears.length > 0 && (
          <>
            <rect className="forecast-zone" x={dividerX} y={M.top} width={LEFT + innerW - dividerX} height={innerH} />
            <text className="forecast-zone-label" x={dividerX + 8} y={M.top + 14}>
              Forecast →
            </text>
            <text className="forecast-zone-label" x={dividerX - 8} y={M.top + 14} textAnchor="end">
              ← Actual
            </text>
          </>
        )}

        {ticks.map((tick) => (
          <g key={tick}>
            <line
              className={tick === 0 ? "forecast-baseline" : "forecast-grid"}
              x1={LEFT}
              x2={W}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text className="forecast-axis" x={LEFT - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">
              {abbreviateCurrency(tick)}
            </text>
          </g>
        ))}

        {forecastYears.length > 0 && (
          <>
            <line className="forecast-divider" x1={dividerX} x2={dividerX} y1={M.top} y2={M.top + innerH} />
            {!single && (
              <>
                <path className="forecast-band" d={band} />
                <path className="forecast-line forecast-line--edge" d={line(low, from)} />
                <path className="forecast-line forecast-line--edge" d={line(high, from)} />
              </>
            )}
            <path className="forecast-line forecast-line--mid" d={line([anchor, ...netMid], from)} />
          </>
        )}
        <path className="forecast-line forecast-line--actual" d={line(netHistoric, 0)} />
        {netHistoric.map((value, index) => (
          <circle key={historicYears[index]} className="forecast-dot" cx={x(index)} cy={y(value)} r={3.5} />
        ))}
        {netMid.map((value, index) => (
          <circle
            key={forecastYears[index]}
            className="forecast-dot forecast-dot--mid"
            cx={x(histCount + index)}
            cy={y(value)}
            r={3}
          />
        ))}

        {years.map((year, index) =>
          index % labelEvery === 0 || index === years.length - 1 ? (
            <text key={year} className="forecast-axis" x={x(index)} y={H - 12} textAnchor="middle">
              {year}
            </text>
          ) : null,
        )}

        {hover !== null && (
          <line className="forecast-hover-line" x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + innerH} />
        )}
        {years.map((year, index) => (
          <rect
            key={year}
            x={LEFT + slot * index}
            y={M.top}
            width={slot}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(index)}
          />
        ))}
      </svg>
      {hover !== null && (
        <div className="forecast-tooltip" style={{ left: x(hover) }} role="tooltip">
          <div className="forecast-tooltip__title">
            {years[hover]} · {hover < histCount ? "actual" : "forecast"}
          </div>
          {hoverRows.map((row) => (
            <div key={row.label} className="forecast-tooltip__row">
              <span>{row.label}</span>
              <strong>{currencyFormatter.format(row.value)}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Grid (chart above table, one scroll container) ---

function ForecastGrid({
  forecast,
  single,
  onRate,
  onSingle,
}: {
  forecast: ForecastResult;
  single: boolean;
  onRate: (accountId: string, rate: RateRange) => void;
  onSingle: (accountId: string, rate: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return undefined;
    }
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Year columns stretch to fill the card, but never get narrower than MIN_YEAR_W (then it scrolls).
  const count = forecast.historicYears.length + forecast.forecastYears.length;
  const yearW = Math.max(MIN_YEAR_W, (width - LEFT) / count);

  return (
    <div className="forecast-scroll" ref={ref}>
      <ForecastChart forecast={forecast} yearW={yearW} single={single} />
      <ForecastTable forecast={forecast} yearW={yearW} single={single} onRate={onRate} onSingle={onSingle} />
    </div>
  );
}

// --- Table ---

// Sum a per-account series across a bucket's accounts, treating missing balances as zero.
function sumSeries(group: Group, pick: (account: Group["accounts"][number]) => (number | null)[]): number[] {
  return group.accounts.reduce<number[]>((totals, account) => {
    pick(account).forEach((value, index) => {
      totals[index] = (totals[index] ?? 0) + (value ?? 0);
    });
    return totals;
  }, []);
}

// Account and bucket rows by year. The header is split into "Actual" and "Forecast" groups, forecast
// columns are tinted, and the first one carries a heavier left border running the table's full height.
function ForecastTable({
  forecast,
  yearW,
  single,
  onRate,
  onSingle,
}: {
  forecast: ForecastResult;
  yearW: number;
  single: boolean;
  onRate: (accountId: string, rate: RateRange) => void;
  onSingle: (accountId: string, rate: number) => void;
}) {
  const { historicYears, forecastYears, groups, netHistoric, netLow, netMid, netHigh } = forecast;
  const histCount = historicYears.length;
  const proj = (index: number) => `forecast-cell forecast-cell--proj${index === 0 ? " forecast-cell--edge" : ""}`;

  const cells = (actual: (number | null)[], projected: number[], titles?: (index: number) => string) => (
    <>
      {actual.map((value, index) => (
        <td key={historicYears[index]} className="forecast-cell">
          {money(value)}
        </td>
      ))}
      {projected.map((value, index) => (
        <td key={forecastYears[index]} className={proj(index)} title={titles?.(index)}>
          {money(value)}
        </td>
      ))}
    </>
  );

  return (
    <div className="forecast-table-wrap">
      <table className="forecast-table" style={{ width: LEFT + yearW * (histCount + forecastYears.length) }}>
        <colgroup>
          <col style={{ width: LABEL_W }} />
          <col style={{ width: RATE_W }} />
          <col style={{ width: RATE_W }} />
          {historicYears.concat(forecastYears).map((year) => (
            <col key={year} style={{ width: yearW }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="forecast-label" colSpan={3} />
            <th colSpan={histCount} className="forecast-group">
              Actual
            </th>
            {forecastYears.length > 0 && (
              <th colSpan={forecastYears.length} className="forecast-group forecast-group--proj forecast-cell--edge">
                Forecast
              </th>
            )}
          </tr>
          <tr>
            <th className="forecast-label" />
            {single ? (
              <th className="forecast-cell" colSpan={2}>
                Return %
              </th>
            ) : (
              <>
                <th className="forecast-cell">Low %</th>
                <th className="forecast-cell">High %</th>
              </>
            )}
            {historicYears.map((year) => (
              <th key={year} className="forecast-cell">
                {year}
              </th>
            ))}
            {forecastYears.map((year, index) => (
              <th key={year} className={proj(index)}>
                {year}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.meta.id}>
              {group.accounts.map((account) => (
                <tr key={account.accountId} className="forecast-row">
                  <th className="forecast-label">
                    <span className="forecast-swatch" style={{ background: group.meta.color }} />
                    {account.name}
                    {account.payment > 0 && (
                      <span className="forecast-payment" title="Yearly payment mapped on the Planning page">
                        +{money(account.payment)}/yr
                      </span>
                    )}
                  </th>
                  {single ? (
                    <td colSpan={2} className="forecast-cell forecast-rate">
                      <NumberInput
                        value={account.rate.low}
                        step={0.5}
                        suffix="%"
                        label={`${account.name} annual return`}
                        onCommit={(rate) => onSingle(account.accountId, rate)}
                      />
                    </td>
                  ) : (
                    <>
                      <td className="forecast-cell forecast-rate">
                        <NumberInput
                          value={account.rate.low}
                          step={0.5}
                          suffix="%"
                          label={`${account.name} low annual return`}
                          onCommit={(low) => onRate(account.accountId, { ...account.rate, low })}
                        />
                      </td>
                      <td className="forecast-cell forecast-rate">
                        <NumberInput
                          value={account.rate.high}
                          step={0.5}
                          suffix="%"
                          label={`${account.name} high annual return`}
                          onCommit={(high) => onRate(account.accountId, { ...account.rate, high })}
                        />
                      </td>
                    </>
                  )}
                  {cells(
                    account.historic,
                    account.mid,
                    single
                      ? undefined
                      : (index) => `Low ${money(account.low[index])} · High ${money(account.high[index])}`,
                  )}
                </tr>
              ))}
              <tr className="forecast-row forecast-row--bucket">
                <th className="forecast-label">{group.meta.name}</th>
                <td colSpan={2} />
                {cells(
                  sumSeries(group, (a) => a.historic),
                  sumSeries(group, (a) => a.mid),
                )}
              </tr>
            </Fragment>
          ))}
          <tr className="forecast-row forecast-row--net">
            <th className="forecast-label">Net worth</th>
            <td colSpan={2} />
            {cells(netHistoric, netMid)}
          </tr>
          {forecastYears.length > 0 &&
            !single &&
            (
              [
                ["Low case", netLow],
                ["High case", netHigh],
              ] as const
            ).map(([label, values]) => (
              <tr key={label} className="forecast-row forecast-row--case">
                <th className="forecast-label">{label}</th>
                <td colSpan={2 + histCount} className="forecast-cell" />
                {values.map((value, index) => (
                  <td key={forecastYears[index]} className={proj(index)}>
                    {money(value)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

export default ForecastingPage;
