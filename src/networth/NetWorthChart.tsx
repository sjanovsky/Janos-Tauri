import { useMemo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { DivergingScale } from "../spending/lib/chartScale";
import { currencyFormatter, wholeCurrencyFormatter } from "../spending/lib/format";
import { formatMonthAxis, formatMonthLabel, type BucketGroup, type NetWorthPoint } from "./lib/networth";

// Every column is sized to just fit the widest value in the grid (shared by the bars, the month
// headers, and the balance cells so each month stays aligned top to bottom). These budget that
// width: roughly one digit's worth of the cell font (0.82rem, tabular-nums) per character of the
// widest value, plus the cell's padding and divider. Counting "$" and "," at the wider digit width
// leaves a little slack so the largest value never truncates.
const CHAR_WIDTH_PX = 7.5;
const COLUMN_PADDING_PX = 12;
// Floor so a column never gets narrower than its month header ("Oct'26", with a remove button).
const MIN_COLUMN_BASIS = 60;

// Month choices for the column date editor, "01".."12" with short labels (kept compact so the
// editor fits within a month column). Built once.
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1).padStart(2, "0"),
  label: new Date(2000, index, 1).toLocaleString(undefined, { month: "short" }),
}));

type TooltipAnchor = { point: NetWorthPoint; x: number; y: number };

type NetWorthChartProps = {
  hasAccounts: boolean;
  // Whether any balance has been entered (drives the empty chart plot).
  hasData: boolean;
  months: string[];
  series: NetWorthPoint[];
  scale: DivergingScale;
  groups: BucketGroup[];
  netPerColumn: number[];
  // Months the user can remove again (added columns that hold no balances).
  removableMonths: Set<string>;
  // Commit an edited cell: a number sets/updates the balance, null clears it (back to carried).
  onSetBalance: (accountId: string, month: string, amount: number | null) => void;
  onEditMonth: (oldMonth: string, newMonth: string) => void;
  onRemoveMonth: (month: string) => void;
  onOpenSettings: () => void;
  onOpenImport: () => void;
};

// Turn typed cell text into a balance. Strips currency symbols, commas, and spaces so "$1,200.50"
// and "1200.5" both parse. Empty clears the entry (null); an unparseable value returns undefined so
// the caller can ignore it and reset the field.
function parseAmount(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const cleaned = trimmed.replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") {
    return undefined;
  }
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

// The "Net worth by month" card: a diverging stacked-bar chart over an editable grid of per-account
// balances, laid out as one structure (mirroring the Spending page) so each month's bar lines up
// with its column. Row labels (accounts, bucket totals, Net worth) sit in the fixed left gutter;
// the bars, month headers, and balance cells share one scrolling track and the same column width.
function NetWorthChart({
  hasAccounts,
  hasData,
  months,
  series,
  scale,
  groups,
  netPerColumn,
  removableMonths,
  onSetBalance,
  onEditMonth,
  onRemoveMonth,
  onOpenSettings,
  onOpenImport,
}: NetWorthChartProps) {
  const [tooltipAnchor, setTooltipAnchor] = useState<TooltipAnchor | null>(null);
  // Which column's date is currently being edited (its header shows the month picker).
  const [editingMonth, setEditingMonth] = useState<string | null>(null);

  // The width every column gets: just enough for the widest value shown anywhere in the grid
  // (account balances, bucket totals, and the Net worth row), so columns stay as narrow as the data
  // allows and more months fit before the chart scrolls.
  const columnBasis = useMemo(() => {
    let widest = 0;
    const consider = (value: number) => {
      const length = wholeCurrencyFormatter.format(value).length;
      if (length > widest) {
        widest = length;
      }
    };
    groups.forEach((group) => {
      group.accounts.forEach((account) => {
        account.cells.forEach((cell) => {
          if (cell.value !== null) {
            consider(cell.value);
          }
        });
      });
      group.totalPerColumn.forEach((value) => {
        if (value !== 0) {
          consider(value);
        }
      });
    });
    netPerColumn.forEach((value) => {
      if (value !== 0) {
        consider(value);
      }
    });
    return Math.max(MIN_COLUMN_BASIS, Math.ceil(widest * CHAR_WIDTH_PX) + COLUMN_PADDING_PX);
  }, [groups, netPerColumn]);

  const commitCell = (accountId: string, month: string, wasExplicit: boolean, raw: string) => {
    const parsed = parseAmount(raw);
    if (parsed === undefined) {
      return false; // Unparseable — leave the stored value as-is; caller resets the field.
    }
    // Clearing a cell that never had an entry is a no-op (nothing to delete).
    if (parsed === null && !wasExplicit) {
      return true;
    }
    onSetBalance(accountId, month, parsed);
    return true;
  };

  const baselinePct = (scale.positiveMax / scale.totalRange) * 100;

  return (
    <>
      <div className="import-shell__chart-card">
        <div className="import-shell__chart-header">
          <div>
            <h2>Net worth by month</h2>
            <p className="networth-chart-subtitle">
              Enter each account's end-of-month balance below. Blanks carry the last entered balance forward.
            </p>
          </div>
          <div className="import-shell__chart-tools">
            <button
              type="button"
              className="import-shell__settings-button"
              aria-label="Open settings"
              title="Settings"
              onClick={onOpenSettings}
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </div>

        {!hasAccounts ? (
          <div className="import-shell__empty">
            No accounts yet.{" "}
            <button type="button" className="networth-link-button" onClick={onOpenImport}>
              Paste from a spreadsheet
            </button>{" "}
            or{" "}
            <button type="button" className="networth-link-button" onClick={onOpenSettings}>
              add accounts and buckets
            </button>{" "}
            to start tracking your net worth.
          </div>
        ) : (
          <div className="import-shell__chart-grid" aria-label="Net worth chart and balances">
            <div className="import-shell__chart-gutter">
              <div className="import-shell__y-axis">
                {hasData &&
                  scale.ticks.map((tick) => (
                    <span
                      key={tick}
                      className="import-shell__y-axis-tick"
                      style={{ top: `${((scale.positiveMax - tick) / scale.totalRange) * 100}%` }}
                    >
                      {tick.toLocaleString()}
                    </span>
                  ))}
              </div>

              <div className="networth-axis-head">Account</div>

              <div className="import-shell__totals-labels">
                {groups.map((group) => (
                  <GroupLabels key={group.meta.id} group={group} />
                ))}
                <div className="import-shell__totals-label import-shell__totals-label--net">Net worth</div>
              </div>
            </div>

            <div className="import-shell__chart-scroll">
              <div className="import-shell__chart-track">
                <div className="import-shell__chart-plot">
                  {hasData ? (
                    <>
                      {scale.ticks.map((tick) => (
                        <div
                          key={tick}
                          className="import-shell__gridline"
                          style={{ top: `${((scale.positiveMax - tick) / scale.totalRange) * 100}%` }}
                        />
                      ))}
                      <div className="import-shell__baseline" style={{ top: `${baselinePct}%` }} />

                      <div className="import-shell__chart-bars">
                        {series.map((point) => {
                          const positiveSegments = point.segments.filter((segment) => segment.value > 0);
                          const negativeSegments = point.segments.filter((segment) => segment.value < 0);

                          let positiveCursor = 0;
                          const positiveRects = positiveSegments.map((segment, index) => {
                            positiveCursor += segment.value;
                            const heightPct = (segment.value / scale.totalRange) * 100;
                            const topPct = baselinePct - (positiveCursor / scale.totalRange) * 100;
                            return {
                              segment,
                              topPct,
                              heightPct,
                              borderRadius: index === positiveSegments.length - 1 ? "4px 4px 0 0" : "0",
                            };
                          });

                          let negativeCursor = 0;
                          const negativeRects = negativeSegments.map((segment, index) => {
                            const magnitude = Math.abs(segment.value);
                            const topPct = baselinePct + (negativeCursor / scale.totalRange) * 100;
                            negativeCursor += magnitude;
                            const heightPct = (magnitude / scale.totalRange) * 100;
                            return {
                              segment,
                              topPct,
                              heightPct,
                              borderRadius: index === negativeSegments.length - 1 ? "0 0 4px 4px" : "0",
                            };
                          });

                          const allRects = [...positiveRects, ...negativeRects];
                          const tooltipTopPct =
                            allRects.length > 0 ? Math.min(...allRects.map((rect) => rect.topPct)) : baselinePct;
                          const netTotal = point.segments.reduce((sum, segment) => sum + segment.value, 0);

                          const anchorTooltip = (rect: DOMRect) => {
                            setTooltipAnchor({
                              point,
                              x: rect.left + rect.width / 2,
                              y: rect.top + (tooltipTopPct / 100) * rect.height,
                            });
                          };
                          const clearTooltip = () => {
                            setTooltipAnchor((current) => (current?.point.month === point.month ? null : current));
                          };

                          return (
                            <div
                              key={point.month}
                              className="import-shell__bar-col"
                              style={{ flex: `0 0 ${columnBasis}px` }}
                              tabIndex={0}
                              aria-label={`${point.label}: ${currencyFormatter.format(netTotal)}`}
                              onMouseEnter={(event) => anchorTooltip(event.currentTarget.getBoundingClientRect())}
                              onMouseLeave={clearTooltip}
                              onFocus={(event) => anchorTooltip(event.currentTarget.getBoundingClientRect())}
                              onBlur={clearTooltip}
                            >
                              {allRects.length > 0 && (
                                <span className="import-shell__bar-total" style={{ top: `${tooltipTopPct}%` }}>
                                  {wholeCurrencyFormatter.format(netTotal)}
                                </span>
                              )}
                              {allRects.map(({ segment, topPct, heightPct, borderRadius }) => (
                                <div
                                  key={segment.bucketId}
                                  className="import-shell__bar-segment"
                                  style={{
                                    top: `calc(${topPct}% + 1px)`,
                                    height: `calc(${heightPct}% - 2px)`,
                                    width: "100%",
                                    background: segment.color,
                                    borderRadius,
                                  }}
                                  aria-hidden="true"
                                />
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <div className="networth-plot-empty">
                      Enter a balance below to see your net worth.
                    </div>
                  )}
                </div>

                <div className="import-shell__x-axis">
                  {months.map((month) => (
                    <div
                      key={month}
                      className="import-shell__x-axis-label networth-month-head"
                      style={{ flex: `0 0 ${columnBasis}px` }}
                    >
                      {editingMonth === month ? (
                        <MonthEditor
                          month={month}
                          onCommit={(newMonth) => {
                            onEditMonth(month, newMonth);
                            setEditingMonth(null);
                          }}
                          onCancel={() => setEditingMonth(null)}
                        />
                      ) : (
                        <span className="networth-month-head__display">
                          <button
                            type="button"
                            className="networth-month-head__label"
                            title={`${formatMonthLabel(month)} — click to change the month`}
                            onClick={() => setEditingMonth(month)}
                          >
                            {formatMonthAxis(month)}
                          </button>
                          {removableMonths.has(month) && (
                            <button
                              type="button"
                              className="networth-month-head__remove"
                              aria-label={`Remove ${formatMonthLabel(month)} column`}
                              title="Remove this month"
                              onClick={() => onRemoveMonth(month)}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                <div className="import-shell__totals-values">
                  {groups.map((group) => (
                    <GroupValues
                      key={group.meta.id}
                      group={group}
                      months={months}
                      columnBasis={columnBasis}
                      commitCell={commitCell}
                    />
                  ))}
                  <div className="import-shell__totals-row import-shell__totals-row--net">
                    {netPerColumn.map((value, index) => (
                      <div
                        key={months[index]}
                        className="import-shell__totals-cell import-shell__totals-cell--net networth-readonly-cell"
                        style={{ flex: `0 0 ${columnBasis}px` }}
                      >
                        {value === 0 ? "—" : wholeCurrencyFormatter.format(value)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {tooltipAnchor &&
        createPortal(
          <div
            className="import-shell__tooltip"
            role="tooltip"
            style={{
              position: "fixed",
              left: tooltipAnchor.x,
              top: tooltipAnchor.y,
              transform: "translate(-50%, calc(-100% - 8px))",
            }}
          >
            <div className="import-shell__tooltip-title">{tooltipAnchor.point.label}</div>
            {tooltipAnchor.point.segments.map((segment) => (
              <div key={segment.bucketId} className="import-shell__tooltip-row">
                <span className="import-shell__tooltip-key" style={{ background: segment.color }} />
                <strong>{currencyFormatter.format(segment.value)}</strong>
                <span>{segment.label}</span>
              </div>
            ))}
            <div className="import-shell__tooltip-row import-shell__tooltip-row--net">
              <span className="import-shell__tooltip-key" style={{ background: "transparent" }} />
              <strong>
                {currencyFormatter.format(
                  tooltipAnchor.point.segments.reduce((sum, segment) => sum + segment.value, 0),
                )}
              </strong>
              <span>Net worth</span>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

// One bucket's row labels in the gutter: an account name per row, then the bucket total, matching
// (row for row) the editable value rows in the track. Split out so the bucket color drives the
// section's tint via the inline `--bucket` custom property.
function GroupLabels({ group }: { group: BucketGroup }) {
  const accent = { "--bucket": group.meta.color } as CSSProperties;

  return (
    <>
      {group.accounts.map((account, index) => (
        <div
          key={account.accountId}
          className={`import-shell__totals-label import-shell__totals-label--item ${
            index === 0 ? "import-shell__totals-label--section-start" : ""
          }`}
          style={accent}
        >
          <span className="import-shell__totals-label-text">{account.name}</span>
        </div>
      ))}
      <div className="import-shell__totals-label import-shell__totals-label--bucket" style={accent}>
        <span className="import-shell__totals-label-text">{group.meta.name}</span>
      </div>
    </>
  );
}

type GroupValuesProps = {
  group: BucketGroup;
  months: string[];
  columnBasis: number;
  commitCell: (accountId: string, month: string, wasExplicit: boolean, raw: string) => boolean;
};

// One bucket's value rows in the track: an editable balance cell per account/month, then the
// bucket's (read-only) per-month total.
function GroupValues({ group, months, columnBasis, commitCell }: GroupValuesProps) {
  const accent = { "--bucket": group.meta.color } as CSSProperties;

  return (
    <>
      {group.accounts.map((account, accountIndex) => (
        <div
          key={account.accountId}
          className={`import-shell__totals-row import-shell__totals-row--item ${
            accountIndex === 0 ? "import-shell__totals-row--section-start" : ""
          }`}
          style={accent}
        >
          {account.cells.map((cell) => {
            // At rest the balance reads as currency ("$1,200"); focusing swaps in the raw number so
            // it's easy to edit, and committing (or cancelling) reformats it back to currency.
            const displayValue =
              cell.explicit && cell.value !== null ? wholeCurrencyFormatter.format(cell.value) : "";
            const editValue = cell.explicit && cell.value !== null ? String(cell.value) : "";
            const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
              event.target.value = editValue;
              event.target.select();
            };
            const handleCommit = (event: FocusEvent<HTMLInputElement>) => {
              const committed = commitCell(account.accountId, cell.month, cell.explicit, event.target.value);
              if (!committed) {
                event.target.value = displayValue;
                return;
              }
              // A change that sticks remounts this input with the formatted default; an unchanged
              // value stays mounted, so reformat the field here so it rests as currency either way.
              const parsed = parseAmount(event.target.value);
              event.target.value =
                parsed === null || parsed === undefined ? "" : wholeCurrencyFormatter.format(parsed);
            };
            const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                event.currentTarget.value = displayValue;
                event.currentTarget.blur();
              }
            };
            return (
              <div
                key={cell.month}
                className="import-shell__totals-cell networth-input-cell"
                style={{ flex: `0 0 ${columnBasis}px` }}
              >
                <input
                  // Remount (resetting defaultValue) whenever the stored balance for this cell changes.
                  key={`${cell.explicit ? "e" : "c"}:${cell.value ?? ""}`}
                  type="text"
                  inputMode="decimal"
                  className="networth-cell-input"
                  defaultValue={displayValue}
                  placeholder={
                    !cell.explicit && cell.value !== null ? wholeCurrencyFormatter.format(cell.value) : ""
                  }
                  aria-label={`${account.name} balance for ${formatMonthLabel(cell.month)}`}
                  onFocus={handleFocus}
                  onBlur={handleCommit}
                  onKeyDown={handleKeyDown}
                />
              </div>
            );
          })}
        </div>
      ))}
      <div className="import-shell__totals-row import-shell__totals-row--bucket" style={accent}>
        {group.totalPerColumn.map((value, index) => (
          <div
            key={months[index]}
            className="import-shell__totals-cell import-shell__totals-cell--bucket networth-readonly-cell"
            style={{ flex: `0 0 ${columnBasis}px` }}
          >
            {value === 0 ? "—" : wholeCurrencyFormatter.format(value)}
          </div>
        ))}
      </div>
    </>
  );
}

type MonthEditorProps = {
  // The column's current month, "YYYY-MM".
  month: string;
  // Commit a new month (always a valid "YYYY-MM"); the parent decides whether to accept it.
  onCommit: (newMonth: string) => void;
  // Abandon the edit without changing anything (Escape, or an unparseable year).
  onCancel: () => void;
};

// A column's date editor: a month dropdown plus a year field. Replaces `<input type="month">`,
// which WKWebView (the macOS Tauri webview) silently renders as a bare text box — so the native
// picker never appeared. These controls work everywhere. Commits when focus leaves the whole
// editor (click away) or on Enter; Escape cancels.
function MonthEditor({ month, onCommit, onCancel }: MonthEditorProps) {
  const [draftYear, draftMonthStart] = month.split("-");
  const [monthValue, setMonthValue] = useState(draftMonthStart);
  const [yearValue, setYearValue] = useState(draftYear);
  const containerRef = useRef<HTMLSpanElement>(null);

  const commit = () => {
    const year = Number.parseInt(yearValue, 10);
    if (!Number.isFinite(year) || year < 1900 || year > 2200) {
      onCancel();
      return;
    }
    onCommit(`${String(year).padStart(4, "0")}-${monthValue}`);
  };

  // Only commit when focus leaves the editor entirely — not when moving between the month and
  // year fields (relatedTarget still inside the container).
  const handleBlur = (event: FocusEvent<HTMLSpanElement>) => {
    if (!containerRef.current?.contains(event.relatedTarget as Node | null)) {
      commit();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter") {
      commit();
    } else if (event.key === "Escape") {
      onCancel();
    }
  };

  return (
    <span className="networth-month-editor" ref={containerRef} onBlur={handleBlur}>
      <select
        className="networth-month-editor__month"
        value={monthValue}
        autoFocus
        aria-label={`Change the month for the ${formatMonthLabel(month)} column`}
        onChange={(event) => setMonthValue(event.target.value)}
        onKeyDown={handleKeyDown}
      >
        {MONTH_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <input
        type="number"
        className="networth-month-editor__year"
        value={yearValue}
        inputMode="numeric"
        min={1900}
        max={2200}
        aria-label={`Change the year for the ${formatMonthLabel(month)} column`}
        onChange={(event) => setYearValue(event.target.value)}
        onKeyDown={handleKeyDown}
      />
    </span>
  );
}

export default NetWorthChart;
