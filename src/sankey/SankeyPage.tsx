import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./sankey.css";
import { NET_ID } from "./lib/sankey";
import SankeyChart from "./SankeyChart";
import SankeyDrill, { type DrillContent } from "./SankeyDrill";
import { wholeCurrencyFormatter } from "../spending/lib/format";
import type {
  BucketRecord as SpendingBucketRecord,
  CategoryRecord as SpendingCategoryRecord,
} from "../spending/lib/categories";
import type { BankRecord } from "../spending/lib/banks";
import type { PaychecksData } from "../income/lib/income";
import { buildFlow, type FlowSourceTransaction } from "./lib/flow";
import {
  defaultPeriod,
  monthName,
  periodBounds,
  periodLabel,
  type PeriodMode,
  type PeriodSelection,
} from "./lib/period";

const DB_ERROR =
  "Couldn't reach the local database. Make sure the app is running via `npm run tauri dev`.";

const EMPTY_PAYCHECKS: PaychecksData = {
  paychecks: [],
  buckets: [],
  items: [],
};

const MODES: { id: PeriodMode; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
  { id: "range", label: "Date range" },
  { id: "all", label: "All time" },
];

const money = (value: number) => wholeCurrencyFormatter.format(value);

// The overview: money flowing from each paycheck's gross, through what's withheld, to net pay and
// on to spending, for a month, a year, a custom date range or all time. Nothing is entered here:
// paychecks come from the Income page's templates (one per matched bank deposit) and spending from
// the bank transactions, so the page just reads and derives.
function SankeyPage() {
  const [paychecks, setPaychecks] = useState<PaychecksData>(EMPTY_PAYCHECKS);
  const [spendingBuckets, setSpendingBuckets] = useState<
    SpendingBucketRecord[]
  >([]);
  const [spendingCategories, setSpendingCategories] = useState<
    SpendingCategoryRecord[]
  >([]);
  const [banks, setBanks] = useState<BankRecord[]>([]);
  const [transactions, setTransactions] = useState<FlowSourceTransaction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodSelection>(() => defaultPeriod());
  const [drill, setDrill] = useState<DrillContent | null>(null);
  // Bucket nodes opened into their line items or categories.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([NET_ID]),
  );

  // Reloaded whenever the overview mounts, so changes made on the other pages show up here.
  useEffect(() => {
    const fail = (what: string) => (error: unknown) => {
      console.error(`Failed to load ${what}`, error);
      setDbError(DB_ERROR);
    };
    Promise.all([
      invoke<PaychecksData>("get_paychecks_data").then(setPaychecks),
      invoke<SpendingBucketRecord[]>("list_buckets").then(setSpendingBuckets),
      invoke<SpendingCategoryRecord[]>("list_categories").then(
        setSpendingCategories,
      ),
      invoke<BankRecord[]>("list_banks").then(setBanks),
      invoke<{ transactions: FlowSourceTransaction[] }[]>("list_uploads").then(
        (uploads) =>
          setTransactions(uploads.flatMap((upload) => upload.transactions)),
      ),
    ])
      .then(() => setDbError(null))
      .catch(fail("the overview"))
      .finally(() => setLoaded(true));
  }, []);

  const label = periodLabel(period);

  const flow = useMemo(
    () =>
      buildFlow({
        bounds: periodBounds(period),
        paychecks: paychecks.paychecks,
        paycheckBuckets: paychecks.buckets,
        paycheckItems: paychecks.items,
        spendingBuckets,
        spendingCategories,
        banks,
        transactions,
        expanded,
      }),
    [
      period,
      paychecks,
      spendingBuckets,
      spendingCategories,
      banks,
      transactions,
      expanded,
    ],
  );

  const update = (changes: Partial<PeriodSelection>) =>
    setPeriod((current) => ({ ...current, ...changes }));

  // The ‹ › buttons: one month or one year at a time.
  const stepPeriod = (direction: 1 | -1) =>
    setPeriod((current) => {
      if (current.mode === "year") {
        return { ...current, year: current.year + direction };
      }
      const month = current.month + direction;
      return {
        ...current,
        year: current.year + Math.floor(month / 12),
        month: ((month % 12) + 12) % 12,
      };
    });

  const handleToggleNode = (nodeId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(nodeId)) {
        next.add(nodeId);
      }
      return next;
    });

  const handleSelectNode = (nodeId: string) => {
    const source = flow.sources.get(nodeId);
    if (source) {
      setDrill({ ...source });
    }
  };

  const { graph } = flow;
  const hasFlow = graph.nodes.length > 0;

  return (
    <>
      {dbError && <div className="import-shell__db-error">{dbError}</div>}
      <section className="sankey-page">
        {!loaded ? null : (
          <div className="sankey-body">
            <div className="sankey-panel">
              <div className="sankey-panel__header">
                <div>
                  <h2>Where the money goes</h2>
                  <p>
                    {label}: paychecks through withholding and net pay to
                    spending. Click ▸ to open a bucket, or any part of the
                    diagram to see what it's made of.
                  </p>
                </div>
                <div className="sankey-panel__right">
                  {hasFlow && (
                    <>
                      <dl className="sankey-summary">
                        <div>
                          <dt>Gross income</dt>
                          <dd>{money(flow.gross)}</dd>
                        </div>
                        <div>
                          <dt>Withheld</dt>
                          <dd>{money(flow.withheld)}</dd>
                        </div>
                        <div>
                          <dt>Net pay</dt>
                          <dd>{money(flow.net)}</dd>
                        </div>
                        <div>
                          <dt>Spending</dt>
                          <dd>{money(flow.spending)}</dd>
                        </div>
                        <div
                          className={
                            flow.shortfall > 0
                              ? "sankey-summary--short"
                              : "sankey-summary--left"
                          }
                        >
                          <dt>
                            {flow.shortfall > 0 ? "Shortfall" : "Left over"}
                          </dt>
                          <dd>
                            {money(
                              flow.shortfall > 0
                                ? flow.shortfall
                                : flow.leftover,
                            )}
                          </dd>
                        </div>
                      </dl>
                    </>
                  )}
                  <div className="sankey-panel__actions">
                    {(period.mode === "month" || period.mode === "year") && (
                      <div className="sankey-step">
                        <button
                          type="button"
                          aria-label="Previous"
                          onClick={() => stepPeriod(-1)}
                        >
                          ‹
                        </button>
                        <span>
                          {period.mode === "month"
                            ? `${monthName(period.month)} ${period.year}`
                            : period.year}
                        </span>
                        <button
                          type="button"
                          aria-label="Next"
                          onClick={() => stepPeriod(1)}
                        >
                          ›
                        </button>
                      </div>
                    )}
                    {period.mode === "range" && (
                      <div className="sankey-range">
                        <input
                          type="date"
                          aria-label="From"
                          value={period.from}
                          onChange={(event) =>
                            update({ from: event.target.value })
                          }
                        />
                        <span aria-hidden="true">–</span>
                        <input
                          type="date"
                          aria-label="To"
                          value={period.to}
                          onChange={(event) =>
                            update({ to: event.target.value })
                          }
                        />
                      </div>
                    )}
                    <div
                      className="sankey-seg"
                      role="group"
                      aria-label="Period type"
                    >
                      {MODES.map((mode) => (
                        <button
                          key={mode.id}
                          type="button"
                          aria-pressed={period.mode === mode.id}
                          className={`sankey-seg__btn ${period.mode === mode.id ? "sankey-seg__btn--active" : ""}`}
                          onClick={() => update({ mode: mode.id })}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {hasFlow ? (
                <SankeyChart
                  graph={graph}
                  onSelectNode={handleSelectNode}
                  onToggleNode={handleToggleNode}
                />
              ) : (
                <div className="sankey-placeholder">
                  <p>
                    Nothing to draw for {label}. Set up paychecks on the Income
                    page and import bank data, and the diagram will draw itself.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {drill && (
        <SankeyDrill
          content={drill}
          periodLabel={label}
          onClose={() => setDrill(null)}
        />
      )}
    </>
  );
}

export default SankeyPage;
