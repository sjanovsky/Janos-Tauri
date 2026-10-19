import { Fragment, useMemo, useState } from "react";
import { wholeCurrencyFormatter } from "../spending/lib/format";
import { softenColor } from "../spending/lib/categories";
import { SPENDING_GROUP_ID } from "../cashflow/lib/groups";
import NetWorthProjection from "./NetWorthProjection";
import ForecastPayments from "./ForecastPayments";
import PlanningField from "./PlanningField";
import PlanningSettingsModal from "./PlanningSettingsModal";
import {
  SPENDING_KEY,
  TAXES_SECTION_ID,
  matchKey,
  parseAmount,
  parseMatch,
  paymentSources,
  type PlanningSection,
} from "./lib/planning";
import { usePlanning } from "./lib/usePlanning";
import "./planning.css";

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
  const {
    paychecks,
    cashflow,
    settings,
    loaded,
    dbError,
    setSetting,
    setExtraIncome,
    sections,
    saveSections,
    plans,
    taxesDefault,
    history,
    spendingPulled,
    typedSpending,
    spendingValue,
    totals,
    hiddenItems,
    saveHiddenItems,
  } = usePlanning();

  // Store `value` unless it is just the pulled-in default, in which case drop the override.
  const [settingsOpen, setSettingsOpen] = useState(false);

  const setNumber = (key: string, value: number, pulled: number) =>
    setSetting(key, Math.abs(value - pulled) < 0.005 ? null : String(value));

  // Each section has its own color; spending takes the Cash Flow Spending group's.
  const spendingColor = softenColor(
    cashflow.groups.find((group) => group.id === SPENDING_GROUP_ID)?.color ?? "#cf8a4e",
  );
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
    color?: string,
  ) => (
    <tr
      className={`${className}${color ? " planning-tinted" : ""}`}
      style={color ? ({ "--bucket": color } as React.CSSProperties) : undefined}
    >
      <th scope="row">{label}</th>
      {columns.map((column) => (
        <td key={column.id} className={column.isTotal && columns.length > 1 ? "planning-total" : ""}>
          {cell(column, planFor(column))}
        </td>
      ))}
    </tr>
  );

  // A small muted line under a row, for the pulled-in value behind an editable field.
  const hintRow = (
    cell: (column: Column, plan: ReturnType<typeof planFor>) => React.ReactNode,
    color?: string,
  ) => row("", cell, "planning-hint", color);

  // Rows in a section share its Cash Flow group color.
  const tone = (color: string) => ({
    row: (
      label: string,
      cell: (column: Column, plan: ReturnType<typeof planFor>) => React.ReactNode,
      className = "",
    ) => row(label, cell, className, color),
    hint: (cell: (column: Column, plan: ReturnType<typeof planFor>) => React.ReactNode) => hintRow(cell, color),
  });
  const incomeColor = softenColor("#8b93a1");

  // A blank band between sections.
  const gapRow = () => (
    <tr className="planning-gap" aria-hidden="true">
      <td colSpan={columns.length + 1} />
    </tr>
  );

  // One muted line under a section for the pulled-in values behind its editable fields.
  const footnoteRow = (content: React.ReactNode) => (
    <tr className="planning-footnote">
      <td colSpan={columns.length + 1}>{content}</td>
    </tr>
  );

  const sources = useMemo(() => paymentSources(plans, sections, totals), [plans, sections, totals]);

  const extraTotal = plans.reduce((sum, plan) => sum + plan.extraIncome, 0);

  // One section: a row per source (editable), the company match if it has one, and a total.
  const renderSection = (section: PlanningSection) => {
    const color = softenColor(section.color);
    const sectionTotal = totals.sections.find((total) => total.sectionId === section.id);
    const sectionPlan = (plan: (typeof plans)[number] | null) =>
      plan?.sections.find((candidate) => candidate.sectionId === section.id) ?? null;
    // Sources every paycheck shares, in the section's order.
    const lineSources = Array.from(
      new Map(plans.flatMap((plan) => sectionPlan(plan)?.lines ?? []).map((line) => [line.source, line.name])),
    );
    const { row: sectionRow } = tone(color);
    return (
      <Fragment key={section.id}>
        {gapRow()}
        {lineSources.map(([source, name]) => (
          <Fragment key={source}>
            {sectionRow(name, (_column, plan) => {
              if (!plan) {
                return money(
                  plans.reduce(
                    (sum, p) => sum + (sectionPlan(p)?.lines.find((candidate) => candidate.source === source)?.value ?? 0),
                    0,
                  ),
                );
              }
              const line = sectionPlan(plan)?.lines.find((candidate) => candidate.source === source);
              return line ? (
                <PlanningField
                  ariaLabel={`${plan.name} ${name}`}
                  text={plain(line.value)}
                  overridden={line.overridden}
                  onCommit={(text) => {
                    const value = parseAmount(text);
                    if (value === null) {
                      setSetting(line.key, null);
                    } else {
                      setNumber(line.key, value, line.pulled);
                    }
                  }}
                />
              ) : null;
            })}
          </Fragment>
        ))}
        {section.match &&
          sectionRow("Company match", (_column, plan) =>
            plan ? (
              <PlanningField
                ariaLabel={`${plan.name} ${section.name} company match`}
                prefix=""
                placeholder="5% or $"
                text={sectionPlan(plan)?.matchText ?? ""}
                onCommit={(text) => {
                  const typed = text.trim();
                  setSetting(matchKey(section.id, plan.paycheckId), parseMatch(typed) ? typed : null);
                }}
              />
            ) : (
              money(sectionTotal?.match ?? 0)
            ),
          )}
        {sectionRow(
          `Total ${section.name.toLowerCase()}`,
          (_column, plan) => {
            const part = sectionPlan(plan);
            return money(plan ? (part?.amount ?? 0) + (part?.matchAmount ?? 0) : (sectionTotal?.amount ?? 0) + (sectionTotal?.match ?? 0));
          },
          "planning-sum",
        )}
        {section.id === TAXES_SECTION_ID &&
          taxesDefault !== null &&
          footnoteRow(`Taxes page estimate (federal): ${money(taxesDefault)}`)}
      </Fragment>
    );
  };

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
                <div>
                  <h2>Next 12 months</h2>
                  <p>Pulled from Paychecks, Taxes and Spending. Type over an amount to use your own; clear it to reset.</p>
                </div>
                <button
                  type="button"
                  className="import-shell__settings-button"
                  aria-label="Open planning settings"
                  title="Planning categories"
                  onClick={() => setSettingsOpen(true)}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>
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
                                    {tone(incomeColor).row("Salary", (_column, plan) => money(plan ? plan.baseSalary : totals.annualIncome - extraTotal))}
                  {tone(incomeColor).row("Bonus & commission", (_column, plan) =>
                    plan ? (
                      <PlanningField
                        ariaLabel={`${plan.name} bonus and commission`}
                        text={plain(plan.extraIncome)}
                        overridden={false}
                        onCommit={(text) => setExtraIncome(plan.paycheckId, Math.max(0, parseAmount(text) ?? 0))}
                      />
                    ) : (
                      money(extraTotal)
                    ),
                  )}
                  {tone(incomeColor).row(
                    "Annual income",
                    (_column, plan) => money(plan ? plan.annualIncome : totals.annualIncome),
                    "planning-sum",
                  )}

                  {sections.map((section) => renderSection(section))}

                  {gapRow()}
                  {tone(spendingColor).row("Spending", (column) =>
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
                  "planning-flat")}
                  {footnoteRow(
                    <>
                      <button
                        type="button"
                        onClick={() => setNumber(SPENDING_KEY, history.lastMonthAnnualized, spendingPulled)}
                      >
                        Last month × 12: {money(history.lastMonthAnnualized)}
                      </button>
                      {" · "}
                      <button type="button" onClick={() => setSetting(SPENDING_KEY, null)}>
                        {history.trailingMonths}-mo average × 12: {money(history.trailingAnnualized)}
                      </button>
                    </>,
                  )}

                  {gapRow()}
                  {row("After taxes, 401K & spending", (column) =>
                    column.isTotal ? (
                      <span className={totals.remaining < 0 ? "planning-negative" : ""}>{money(totals.remaining)}</span>
                    ) : null,
                  "planning-sum planning-flat")}
                </tbody>
              </table>
              </div>

              <ForecastPayments sources={sources} settings={settings} onSetting={setSetting} />
            </div>

            <div className="planning-column">
              <NetWorthProjection />
            </div>
          </div>
        )}
      </section>

      {settingsOpen && (
        <PlanningSettingsModal
          sections={sections}
          buckets={paychecks.buckets}
          items={paychecks.items}
          onChange={saveSections}
          hiddenItems={hiddenItems}
          onHiddenItemsChange={saveHiddenItems}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}

export default PlanningPage;
