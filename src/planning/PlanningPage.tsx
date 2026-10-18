import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { wholeCurrencyFormatter } from "../spending/lib/format";
import type { CategoryRecord } from "../spending/lib/categories";
import type { UploadedFileView } from "../upload/lib/uploads";
import type { PaychecksData } from "../income/lib/income";
import type { TaxesData } from "../taxes/lib/taxes";
import NetWorthProjection from "./NetWorthProjection";
import PlanningField from "./PlanningField";
import {
  SPENDING_KEY,
  TAX_BUCKETS_KEY,
  estimatedTaxes,
  matchAmount,
  matchKey,
  parseAmount,
  parseMatch,
  planPaycheck,
  planningTotals,
  retirementKey,
  taxKey,
  spendingHistory,
  taxBucketIds,
  type PlanningSettingRecord,
} from "./lib/planning";
import "./planning.css";

const DB_ERROR = "Couldn't reach the local database. Make sure the app is running via `npm run tauri dev`.";

const money = (value: number) => wholeCurrencyFormatter.format(value);
const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
// What a field shows at rest: whole dollars with thousands separators ("" for zero).
const plain = (value: number) => (Math.abs(value) < 0.5 ? "" : wholeNumber.format(value));

// A planning column: one paycheck, or the totals (which is also where taxes and spending go). With
// a single paycheck its column is the totals column; with none there's just the totals column.
type Column = { id: string; paycheckId: string | null; isTotal: boolean; label: string; color: string | null };

// Planning: the next 12 months in one place. Income comes from the Paychecks page (current paycheck
// × paychecks per year, plus extra income), taxes from the Taxes page's full-year estimate, 401K
// from the paycheck, and spending from the last month and the trailing 12 months. Each of those is
// pulled in as a starting value and stays editable; what the user types is saved as an override,
// and clearing the field brings the pulled value back.
function PlanningPage() {
  const [paychecks, setPaychecks] = useState<PaychecksData>({ paychecks: [], buckets: [], items: [] });
  const [taxes, setTaxes] = useState<TaxesData>({ years: [], items: [], householdValues: [] });
  const [uploads, setUploads] = useState<UploadedFileView[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [settingRecords, setSettingRecords] = useState<PlanningSettingRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  const reloadSettings = useCallback(
    () =>
      invoke<PlanningSettingRecord[]>("get_planning_settings")
        .then(setSettingRecords)
        .catch((error) => {
          console.error("Failed to load planning settings", error);
          setDbError(DB_ERROR);
        }),
    [],
  );

  useEffect(() => {
    const fail = (what: string) => (error: unknown) => {
      console.error(`Failed to load ${what} from the database`, error);
      setDbError(DB_ERROR);
    };
    void Promise.all([
      invoke<PaychecksData>("get_paychecks_data").then(setPaychecks).catch(fail("paychecks")),
      invoke<TaxesData>("get_taxes_data").then(setTaxes).catch(fail("taxes")),
      invoke<UploadedFileView[]>("list_uploads").then(setUploads).catch(fail("uploads")),
      invoke<CategoryRecord[]>("list_categories").then(setCategories).catch(fail("categories")),
      reloadSettings(),
    ]).then(() => setLoaded(true));
  }, [reloadSettings]);

  const settings = useMemo(
    () => new Map(settingRecords.map((record) => [record.key, record.value] as const)),
    [settingRecords],
  );

  // Save (or, with null, remove) one override; roll back by reloading if the write fails.
  const setSetting = (key: string, value: string | null) => {
    setSettingRecords((current) => {
      const rest = current.filter((record) => record.key !== key);
      return value === null ? rest : [...rest, { key, value }];
    });
    const write =
      value === null
        ? invoke("delete_planning_setting", { key })
        : invoke("set_planning_setting", { key, value });
    write.catch((error) => {
      console.error(`Failed to save (${key})`, error);
      setDbError(DB_ERROR);
      void reloadSettings();
    });
  };

  // Store `value` unless it is just the pulled-in default, in which case drop the override.
  const setNumber = (key: string, value: number, pulled: number) =>
    setSetting(key, Math.abs(value - pulled) < 0.005 ? null : String(value));

  const plans = useMemo(
    () => paychecks.paychecks.map((paycheck) => planPaycheck(paycheck, paychecks.items, paychecks.buckets, settings)),
    [paychecks, settings],
  );

  // The Taxes page's federal estimate, shown for reference next to the paycheck-based taxes.
  const taxesDefault = useMemo(() => estimatedTaxes(taxes, new Date().getFullYear()), [taxes]);
  const history = useMemo(
    () =>
      spendingHistory(
        uploads.flatMap((upload) => upload.transactions),
        categories,
        paychecks.paychecks,
        new Date(),
      ),
    [uploads, categories, paychecks.paychecks],
  );

  // Spending defaults to the trailing average; it can be typed over.
  const spendingPulled = history.trailingAnnualized;
  const typedSpending = parseAmount(settings.get(SPENDING_KEY) ?? "");
  const spendingValue = typedSpending ?? spendingPulled;
  const totals = planningTotals(plans, spendingValue);

  const columns: Column[] = useMemo(() => {
    const paycheckColumns = plans.map<Column>((plan) => ({
      id: plan.paycheckId,
      paycheckId: plan.paycheckId,
      isTotal: plans.length === 1,
      label: plan.name,
      color: plan.color,
    }));
    return plans.length === 1
      ? paycheckColumns
      : [...paycheckColumns, { id: "total", paycheckId: null, isTotal: true, label: "Totals", color: null }];
  }, [plans]);

  const planFor = (column: Column) => plans.find((plan) => plan.paycheckId === column.paycheckId) ?? null;

  const row = (
    label: string,
    cell: (column: Column, plan: ReturnType<typeof planFor>) => React.ReactNode,
    className = "",
  ) => (
    <tr className={className}>
      <th scope="row">{label}</th>
      {columns.map((column) => (
        <td key={column.id} className={column.isTotal && columns.length > 1 ? "planning-total" : ""}>
          {cell(column, planFor(column))}
        </td>
      ))}
    </tr>
  );

  // A small muted line under a row, for the pulled-in value behind an editable field.
  const hintRow = (cell: (column: Column, plan: ReturnType<typeof planFor>) => React.ReactNode) =>
    row("", cell, "planning-hint");

  const [choosingTaxes, setChoosingTaxes] = useState(false);
  const chosenTaxBuckets = taxBucketIds(paychecks.buckets, settings);
  const toggleTaxBucket = (bucketId: string) =>
    setSetting(
      TAX_BUCKETS_KEY,
      (chosenTaxBuckets.includes(bucketId)
        ? chosenTaxBuckets.filter((id) => id !== bucketId)
        : [...chosenTaxBuckets, bucketId]
      ).join(","),
    );

  const sectionRow = (label: string, action?: React.ReactNode) => (
    <tr className="planning-section">
      <th scope="row" colSpan={columns.length + 1}>
        {label}
        {action}
      </th>
    </tr>
  );

  const taxLineNames = chosenTaxBuckets.flatMap((bucketId) => {
    const bucket = paychecks.buckets.find((candidate) => candidate.id === bucketId);
    return bucket ? [{ bucketId, name: bucket.name }] : [];
  });

  const extraTotal = plans.reduce((sum, plan) => sum + plan.extraIncome, 0);

  return (
    <>
      {dbError && <div className="import-shell__db-error">{dbError}</div>}
      <section className="planning-page">
        {!loaded ? null : plans.length === 0 ? (
          <p className="planning-empty">Add a paycheck on the Paychecks page to start planning.</p>
        ) : (
          <div className="planning-body">
            <div className="planning-column">
              <div className="planning-card planning-plan">
              <header className="planning-heading">
                <h2>Next 12 months</h2>
                <p>Pulled from Paychecks, Taxes and Spending. Type over an amount to use your own; clear it to reset.</p>
              </header>

              <table className="planning-table">
                <thead>
                  <tr>
                    <th aria-label="Line" />
                    {columns.map((column) => (
                      <th key={column.id} scope="col" className="planning-colhead">
                        {column.color && <span className="planning-dot" style={{ background: column.color }} />}
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sectionRow("Income")}
                  {row("Gross per paycheck", (_column, plan) => (plan ? money(plan.gross) : null), "planning-muted")}
                  {row("Paychecks per year", (_column, plan) => (plan ? plan.paychecksPerYear : null), "planning-muted")}
                  {row("Salary", (_column, plan) => money(plan ? plan.baseSalary : totals.annualIncome - extraTotal))}
                  {row("Bonus & commission", (_column, plan) => money(plan ? plan.extraIncome : extraTotal))}
                  {row(
                    "Annual income",
                    (_column, plan) => money(plan ? plan.annualIncome : totals.annualIncome),
                    "planning-sum",
                  )}

                  {sectionRow(
                    "Taxes",
                    <button type="button" className="planning-link" onClick={() => setChoosingTaxes((open) => !open)}>
                      {choosingTaxes ? "Done" : "Choose buckets"}
                    </button>,
                  )}
                  {choosingTaxes && (
                    <tr className="planning-choose">
                      <td colSpan={columns.length + 1}>
                        <span>Paycheck buckets that count as taxes:</span>
                        {paychecks.buckets.map((bucket) => (
                          <label key={bucket.id}>
                            <input
                              type="checkbox"
                              checked={chosenTaxBuckets.includes(bucket.id)}
                              onChange={() => toggleTaxBucket(bucket.id)}
                            />
                            {bucket.name}
                          </label>
                        ))}
                      </td>
                    </tr>
                  )}
                  {taxLineNames.map(({ bucketId, name }) => (
                    <Fragment key={bucketId}>
                    {row(name, (_column, plan) => {
                      const line = plan?.taxLines.find((candidate) => candidate.bucketId === bucketId);
                      if (!plan) {
                        return money(plans.reduce((sum, p) => sum + (p.taxLines.find((l) => l.bucketId === bucketId)?.value ?? 0), 0));
                      }
                      return line ? (
                        <PlanningField
                          ariaLabel={`${plan.name} ${name}`}
                          text={plain(line.value)}
                          overridden={line.overridden}
                          onCommit={(text) => {
                            const value = parseAmount(text);
                            const key = taxKey(bucketId, plan.paycheckId);
                            if (value === null) {
                              setSetting(key, null);
                            } else {
                              setNumber(key, value, line.pulled);
                            }
                          }}
                        />
                      ) : null;
                    })}
                    </Fragment>
                  ))}
                  {row("Total taxes", (_column, plan) => money(plan ? plan.taxes : totals.taxes), "planning-sum")}
                  {taxesDefault !== null &&
                    hintRow((column) => (column.isTotal ? `Taxes page estimate (federal): ${money(taxesDefault)}` : null))}

                  {sectionRow("Retirement")}
                  {row("401K", (_column, plan) =>
                    plan ? (
                      <PlanningField
                        ariaLabel={`${plan.name} 401K`}
                        text={plain(plan.retirement)}
                        overridden={plan.retirementOverridden}
                        onCommit={(text) => {
                          const value = parseAmount(text);
                          if (value === null) {
                            setSetting(retirementKey(plan.paycheckId), null);
                          } else {
                            setNumber(retirementKey(plan.paycheckId), value, plan.retirementDefault);
                          }
                        }}
                      />
                    ) : (
                      money(totals.retirement)
                    ),
                  "")}
                  {hintRow((_column, plan) => (plan ? `Paycheck: ${money(plan.retirementDefault)}` : null))}
                  {row("Company match", (_column, plan) =>
                    plan ? (
                      <PlanningField
                        ariaLabel={`${plan.name} company match`}
                        prefix=""
                        placeholder="5% or $"
                        text={plan.matchText}
                        onCommit={(text) => {
                          const typed = text.trim();
                          setSetting(matchKey(plan.paycheckId), parseMatch(typed) ? typed : null);
                        }}
                      />
                    ) : (
                      money(totals.match)
                    ),
                  )}
                  {hintRow((_column, plan) =>
                    plan?.match ? `${money(matchAmount(plan.match, plan.annualIncome))} a year` : null,
                  )}

                  {row(
                    "Total retirement",
                    (_column, plan) => money(plan ? plan.retirement + plan.matchAmount : totals.retirementSaved),
                    "planning-sum",
                  )}

                  {sectionRow("Spending")}
                  {row("Spending", (column) =>
                    column.isTotal ? (
                      <PlanningField
                        ariaLabel="Spending"
                        text={plain(spendingValue)}
                        overridden={typedSpending !== null}
                        onCommit={(text) => {
                          const value = parseAmount(text);
                          if (value === null) {
                            setSetting(SPENDING_KEY, null);
                          } else {
                            setNumber(SPENDING_KEY, value, spendingPulled);
                          }
                        }}
                      />
                    ) : null,
                  "")}
                  {hintRow((column) =>
                    column.isTotal ? (
                      <button
                        type="button"
                        onClick={() => setNumber(SPENDING_KEY, history.lastMonthAnnualized, spendingPulled)}
                      >
                        Last month × 12: {money(history.lastMonthAnnualized)}
                      </button>
                    ) : null,
                  )}
                  {hintRow((column) =>
                    column.isTotal ? (
                      <button type="button" onClick={() => setSetting(SPENDING_KEY, null)}>
                        {history.trailingMonths}-mo average × 12: {money(history.trailingAnnualized)}
                      </button>
                    ) : null,
                  )}

                  {sectionRow("Left over")}
                  {row("After taxes, 401K & spending", (column) =>
                    column.isTotal ? (
                      <span className={totals.remaining < 0 ? "planning-negative" : ""}>{money(totals.remaining)}</span>
                    ) : null,
                  "planning-sum")}
                </tbody>
              </table>
              </div>
            </div>

            <div className="planning-column">
              <NetWorthProjection />
            </div>
          </div>
        )}
      </section>
    </>
  );
}

export default PlanningPage;
