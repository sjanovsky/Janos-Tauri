import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { DivergingScale } from "../spending/lib/chartScale";
import { abbreviateCurrency, currencyFormatter, wholeCurrencyFormatter } from "../spending/lib/format";
import {
  formatMonthLabel,
  type BucketGroup,
  type ChartColumn,
  type NetWorthPoint,
  type NetWorthRange,
} from "./lib/networth";

// Every column is sized to just fit the widest value in the grid (shared by the bars, the column
// headers, and the balance cells so each column stays aligned top to bottom). These budget that
// width: roughly one digit's worth of the cell font (0.82rem, tabular-nums) per character of the
// widest value, plus the cell's padding and divider. Counting "$" and "," at the wider digit width
// leaves a little slack so the largest value never truncates. The padding gives the numbers some
// breathing room so adjacent month columns don't feel cramped.
const CHAR_WIDTH_PX = 7.5;
const COLUMN_PADDING_PX = 28;
// Floor so a month column never gets narrower than its header ("Oct'26", with a remove button).
const MIN_COLUMN_BASIS = 76;
// In Years view the bars are one flat run of months and a value column hangs beneath only some of
// them. Bars never get narrower than this (the track scrolls instead).
const YEAR_MIN_BAR_PX = 14;
// Years view: height (px) of the guide lines linking a labelled bar to its column header. The axis
// row that holds them keeps the same total height as the gutter's Months/Years toggle row (the
// x-axis height plus its top margin) so the value rows stay level with their row labels.
const YEAR_GUIDE_PX = 14;
const YEAR_AXIS_ROW_HEIGHT = "calc(var(--x-axis-h) + 0.4rem)";
// The gap (px) between columns, mirroring the 2px gap on the net-worth bars, x-axis, and totals
// rows in CSS. Used to pin the month-view track to the columns' exact total width.
const COLUMN_GAP_PX = 2;

// Month choices for the column date editor, "01".."12" with short labels (kept compact so the
// editor fits within a month column). Built once.
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1).padStart(2, "0"),
  label: new Date(2000, index, 1).toLocaleString(undefined, { month: "short" }),
}));

type TooltipAnchor = { point: NetWorthPoint; x: number; y: number; bucketId: string | null };

type NetWorthChartProps = {
  hasAccounts: boolean;
  // Whether any balance has been entered (drives the empty chart plot).
  hasData: boolean;
  // Group columns by month (editable grid) or by year (read-only year-end overview).
  range: NetWorthRange;
  // One column per month or per year, each carrying the bar(s) drawn above it. See ChartColumn.
  columns: ChartColumn[];
  // Years view only: every month's bar, in order. Each column's `barIndex` points into this list.
  monthlyBars: NetWorthPoint[];
  scale: DivergingScale;
  groups: BucketGroup[];
  netPerColumn: number[];
  onRangeChange: (range: NetWorthRange) => void;
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
// balances, laid out as one structure (mirroring the Spending page) so each column's bar(s) line up
// with its balance cells. Row labels (accounts, bucket totals, Net worth) sit in the fixed left
// gutter; the bars, column headers, and balance cells share one scrolling track and the same column
// width. The Months/Years toggle switches between an editable per-month grid and a read-only
// per-year overview whose columns each hold the year's twelve monthly bars.
function NetWorthChart({
  hasAccounts,
  hasData,
  range,
  columns,
  monthlyBars,
  scale,
  groups,
  netPerColumn,
  onRangeChange,
  onSetBalance,
  onEditMonth,
  onRemoveMonth,
  onOpenSettings,
  onOpenImport,
}: NetWorthChartProps) {
  const [tooltipAnchor, setTooltipAnchor] = useState<TooltipAnchor | null>(null);
  // Which column's date is currently being edited (its header shows the month picker).
  const [editingMonth, setEditingMonth] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // When the columns overflow horizontally, start scrolled to the far right so the most recent
  // months are visible. Re-applied when the range switches or the column count changes.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollLeft = el.scrollWidth;
    }
  }, [range, columns.length, hasAccounts]);

  // The width every column gets: just enough for the widest value shown anywhere in the grid
  // (account balances, bucket totals, and the Net worth row). In month view columns hold exactly
  // this width (see columnFlex) so each hugs its numbers — no wasted space around the text — and as
  // many months as fit show before the chart scrolls. Year columns get a wider floor so their
  // packed monthly bars stay readable, and they stretch to share the width (a full-width overview).
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

  const isYear = range === "year";

  // How every month column (bar group, header, and value cell) flexes: at its exact basis (grow 0)
  // so it stays tight. Shared by all three rows so a column's bar, header, and cells line up.
  const columnFlex = `0 0 ${columnBasis}px`;

  // Years view: value columns aren't one-per-bar, so each is placed beneath the bar of the month it
  // reports (a year's column is its last month). The bars are inset half a column from each edge, so
  // even the first and last columns sit centered under their bars. Columns whose bars are too close
  // for them to fit side by side are pushed apart (the guide lines still lead from bar to column).
  // Needs the track's pixel width, tracked below.
  const barCount = monthlyBars.length;
  const labelledBars = useMemo(
    () => new Set(columns.map((column) => column.barIndex).filter((index): index is number => index !== null)),
    [columns],
  );
  const [trackWidth, setTrackWidth] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el || !isYear) {
      return undefined;
    }
    setTrackWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setTrackWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [isYear, hasAccounts]);

  const yearPlacements = useMemo(() => {
    const placements = new Map<string, { barX: number; colX: number }>();
    if (!isYear || barCount === 0 || trackWidth <= 0) {
      return placements;
    }
    const barsWidth = Math.max(0, trackWidth - columnBasis);
    const barX = columns.map((column) =>
      column.barIndex === null ? 0 : columnBasis / 2 + (barsWidth * (column.barIndex + 0.5)) / barCount,
    );
    const colX = barX.slice();
    const lo = columnBasis / 2;
    const hi = trackWidth - columnBasis / 2;
    for (let pass = 0; pass < 20; pass += 1) {
      let moved = false;
      for (let index = 1; index < colX.length; index += 1) {
        const overlap = columnBasis - (colX[index] - colX[index - 1]);
        if (overlap > 0.5) {
          colX[index - 1] -= overlap / 2;
          colX[index] += overlap / 2;
          moved = true;
        }
      }
      for (let index = 0; index < colX.length; index += 1) {
        colX[index] = Math.min(hi, Math.max(lo, colX[index]));
      }
      if (!moved) {
        break;
      }
    }
    columns.forEach((column, index) => placements.set(column.key, { barX: barX[index], colX: colX[index] }));
    return placements;
  }, [isYear, barCount, trackWidth, columnBasis, columns]);

  const cellStyle = (column: ChartColumn): CSSProperties => {
    const placement = isYear ? yearPlacements.get(column.key) : undefined;
    if (!placement) {
      return { flex: columnFlex };
    }
    return { position: "absolute", left: placement.colX - columnBasis / 2, width: columnBasis };
  };

  // In month view the columns don't stretch, so pin the scrolling track to their exact total width:
  // the plot, gridlines, headers, and value rows all end at the last month (nothing trailing off to
  // the right, and scrolling stops there). Year view leaves the track to its CSS (stretch to fill).
  const monthTrackWidth =
    range === "month"
      ? columns.length * columnBasis + Math.max(0, columns.length - 1) * COLUMN_GAP_PX
      : null;
  // Years view: the track fills the width (with a scroll floor so the bars stay readable).
  const trackStyle: CSSProperties | undefined = isYear
    ? // `max(100%, …)` keeps the track at least as wide as the card (an inline min-width would
      // otherwise replace the stylesheet's `min-width: 100%`), scrolling only when bars need more.
      { minWidth: `max(100%, ${barCount * YEAR_MIN_BAR_PX + columnBasis}px)` }
    : monthTrackWidth !== null
      ? { width: monthTrackWidth, minWidth: monthTrackWidth }
      : undefined;
  // Years view: the bars sit inside the plot with half a column of room each side; gridlines and
  // row tints still run edge to edge.
  const barsStyle: CSSProperties | undefined = isYear
    ? { boxSizing: "border-box", paddingInline: columnBasis / 2 }
    : undefined;
  const pinnedRowClass = isYear ? " networth-row--pinned" : "";

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

  // Anchor the shared tooltip over a hovered/focused bar. `topPct` is where the bar's top sits in
  // the plot, so the tooltip floats just above whichever bar the pointer is on (not the column).
  const showTooltip = (point: NetWorthPoint, rect: DOMRect, topPct: number, bucketId: string | null) => {
    const next = { point, x: rect.left + rect.width / 2, y: rect.top + (topPct / 100) * rect.height, bucketId };
    setTooltipAnchor((current) =>
      current && current.point.month === point.month && current.bucketId === bucketId ? current : next,
    );
  };
  const hideTooltip = (point: NetWorthPoint) => {
    setTooltipAnchor((current) => (current?.point.month === point.month ? null : current));
  };

  return (
    <>
      <div className="import-shell__chart-card">
        <div className="import-shell__chart-header">
          <div>
            <h2>Net worth by month</h2>
            <p className="networth-chart-subtitle">
              {isYear
                ? "End-of-month balances for the first and last month shown and for the last month of each year."
                : "Enter each account's end-of-month balance below. Blanks carry the last entered balance forward."}
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

              <div className="import-shell__x-axis-toggle">
                <div className="import-shell__range-switcher">
                  {(["month", "year"] as NetWorthRange[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`range-pill ${range === value ? "range-pill--active" : ""}`}
                      onClick={() => onRangeChange(value)}
                    >
                      {value === "month" ? "Months" : "Years"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="import-shell__totals-labels">
                {groups.map((group) => (
                  <GroupLabels key={group.meta.id} group={group} />
                ))}
                <div className="import-shell__totals-label import-shell__totals-label--net">Net worth</div>
              </div>
            </div>

            <div className="import-shell__chart-scroll" ref={scrollRef}>
              <div
                className="import-shell__chart-track"
                style={trackStyle}
                ref={trackRef}
              >
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

                      <div className="import-shell__chart-bars" style={barsStyle}>
                        {isYear ? (
                          // One group holding every month's bar; only the months with a value
                          // column below get a total above them (the rest would just crowd).
                          <div className="networth-bar-group networth-bar-group--multi" style={{ flex: "1 1 100%" }}>
                            {monthlyBars.map((point, index) => (
                              <BarColumn
                                key={point.month}
                                point={point}
                                baselinePct={baselinePct}
                                scale={scale}
                                showTotal={labelledBars.has(index)}
                                // Bars without a value column below are dimmed so the labelled
                                // ones (the months the table reports) stand out.
                                muted={!labelledBars.has(index)}
                                onShow={showTooltip}
                                onHide={hideTooltip}
                              />
                            ))}
                          </div>
                        ) : (
                          columns.map((column) => (
                            <div key={column.key} className="networth-bar-group" style={{ flex: columnFlex }}>
                              {column.bars.map((point) => (
                                <BarColumn
                                  key={point.month}
                                  point={point}
                                  baselinePct={baselinePct}
                                  scale={scale}
                                  showTotal
                                  onShow={showTooltip}
                                  onHide={hideTooltip}
                                />
                              ))}
                            </div>
                          ))
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="networth-plot-empty">
                      Enter a balance below to see your net worth.
                    </div>
                  )}
                </div>

                <div
                  className={`import-shell__x-axis${pinnedRowClass}`}
                  style={isYear ? { height: YEAR_AXIS_ROW_HEIGHT, marginTop: 0 } : undefined}
                >
                  {isYear && (
                    // Guides from each labelled bar's base down to its column header (an elbow when
                    // the column had to shift sideways to make room).
                    <svg
                      className="networth-year-guides"
                      width="100%"
                      height={YEAR_GUIDE_PX}
                      aria-hidden="true"
                    >
                      {columns.map((column) => {
                        const placement = yearPlacements.get(column.key);
                        if (!placement) {
                          return null;
                        }
                        const { barX, colX } = placement;
                        const d =
                          Math.abs(barX - colX) < 0.5
                            ? `M${barX} 0V${YEAR_GUIDE_PX}`
                            : `M${barX} 0V5H${colX}V${YEAR_GUIDE_PX}`;
                        return <path key={column.key} d={d} />;
                      })}
                    </svg>
                  )}
                  {columns.map((column) => {
                    const month = column.month;
                    return (
                      <div
                        key={column.key}
                        className="import-shell__x-axis-label networth-month-head"
                        style={isYear ? { ...cellStyle(column), top: YEAR_GUIDE_PX + 2 } : cellStyle(column)}
                      >
                        {column.editable && month ? (
                          editingMonth === month ? (
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
                                {column.label}
                              </button>
                              {column.removable && (
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
                          )
                        ) : (
                          <span className="networth-year-head">{column.label}</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="import-shell__totals-values">
                  {groups.map((group) => (
                    <GroupValues
                      key={group.meta.id}
                      group={group}
                      columns={columns}
                      cellStyle={cellStyle}
                      pinned={isYear}
                      commitCell={commitCell}
                    />
                  ))}
                  <div className={`import-shell__totals-row import-shell__totals-row--net${pinnedRowClass}`}>
                    {isYear && <span className="networth-row-strut" aria-hidden="true" />}
                    {netPerColumn.map((value, index) => (
                      <div
                        key={columns[index].key}
                        className="import-shell__totals-cell import-shell__totals-cell--net networth-readonly-cell"
                        style={cellStyle(columns[index])}
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
            {(() => {
              const hovered = tooltipAnchor.point.segments.find((s) => s.bucketId === tooltipAnchor.bucketId);
              if (hovered) {
                return (
                  <div className="import-shell__tooltip-row">
                    <span className="import-shell__tooltip-key" style={{ background: hovered.color }} />
                    <strong>{currencyFormatter.format(hovered.value)}</strong>
                    <span>{hovered.label}</span>
                  </div>
                );
              }
              return (
                <div className="import-shell__tooltip-row">
                  <strong>
                    {currencyFormatter.format(
                      tooltipAnchor.point.segments.reduce((sum, segment) => sum + segment.value, 0),
                    )}
                  </strong>
                  <span>Net worth</span>
                </div>
              );
            })()}
          </div>,
          document.body,
        )}
    </>
  );
}

type BarColumnProps = {
  point: NetWorthPoint;
  baselinePct: number;
  scale: DivergingScale;
  // Whether to pin the net total above the bar (every month column, and the labelled year bars).
  showTotal: boolean;
  // Years view: draw this bar dimmed (it has no value column beneath it).
  muted?: boolean;
  onShow: (point: NetWorthPoint, rect: DOMRect, topPct: number, bucketId: string | null) => void;
  onHide: (point: NetWorthPoint) => void;
};

// One stacked bar for a single point in time: assets stack up from the baseline, liabilities down.
// Used both for a month column's lone bar and for each bar in Years view's flat run of months.
function BarColumn({ point, baselinePct, scale, showTotal, muted = false, onShow, onHide }: BarColumnProps) {
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
  const tooltipTopPct = allRects.length > 0 ? Math.min(...allRects.map((rect) => rect.topPct)) : baselinePct;
  const netTotal = point.segments.reduce((sum, segment) => sum + segment.value, 0);

  return (
    <div
      className="import-shell__bar-col"
      tabIndex={0}
      aria-label={`${point.label}: ${currencyFormatter.format(netTotal)}`}
      onMouseMove={(event) => {
        const id =
          (event.target as HTMLElement).closest?.("[data-bucket-id]")?.getAttribute("data-bucket-id") ?? null;
        const hovered = id ? allRects.find((r) => r.segment.bucketId === id) : undefined;
        onShow(point, event.currentTarget.getBoundingClientRect(), hovered ? hovered.topPct : tooltipTopPct, id);
      }}
      onMouseLeave={() => onHide(point)}
      onFocus={(event) => onShow(point, event.currentTarget.getBoundingClientRect(), tooltipTopPct, null)}
      onBlur={() => onHide(point)}
    >
      {showTotal && allRects.length > 0 && (
        <span className="import-shell__bar-total" style={{ top: `${tooltipTopPct}%` }}>
          {abbreviateCurrency(netTotal)}
        </span>
      )}
      {allRects.map(({ segment, topPct, heightPct, borderRadius }) => (
        <div
          key={segment.bucketId}
          data-bucket-id={segment.bucketId}
          className="import-shell__bar-segment"
          style={{
            top: `calc(${topPct}% + 1px)`,
            height: `calc(${heightPct}% - 2px)`,
            width: "100%",
            background: segment.color,
            borderRadius,
            opacity: muted ? 0.55 : undefined,
          }}
          aria-hidden="true"
        />
      ))}
    </div>
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
  columns: ChartColumn[];
  // Per-column cell positioning: a fixed flex basis (Months) or placed under its bar (Years).
  cellStyle: (column: ChartColumn) => CSSProperties;
  pinned: boolean;
  commitCell: (accountId: string, month: string, wasExplicit: boolean, raw: string) => boolean;
};

// One bucket's value rows in the track: a balance cell per account/column, then the bucket's
// (read-only) per-column total. A month column's account cell is an editable input; in Years view
// the cell is the read-only balance for that labelled month (balances are entered in Months view).
function GroupValues({ group, columns, cellStyle, pinned, commitCell }: GroupValuesProps) {
  const accent = { "--bucket": group.meta.color } as CSSProperties;

  return (
    <>
      {group.accounts.map((account, accountIndex) => (
        <div
          key={account.accountId}
          className={`import-shell__totals-row import-shell__totals-row--item ${
            accountIndex === 0 ? "import-shell__totals-row--section-start" : ""
          }${pinned ? " networth-row--pinned" : ""}`}
          style={accent}
        >
          {pinned && <span className="networth-row-strut" aria-hidden="true" />}
          {account.cells.map((cell, cellIndex) => {
            const column = columns[cellIndex];
            // Year-view columns are read-only: the balance as plain text ("—" if the account has no
            // balance yet by that month).
            if (!column.editable || !column.month) {
              return (
                <div
                  key={column.key}
                  className="import-shell__totals-cell networth-readonly-cell"
                  style={cellStyle(column)}
                >
                  {cell.value === null ? "—" : wholeCurrencyFormatter.format(cell.value)}
                </div>
              );
            }

            const month = column.month;
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
              const committed = commitCell(account.accountId, month, cell.explicit, event.target.value);
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
                key={column.key}
                className="import-shell__totals-cell networth-input-cell"
                style={cellStyle(column)}
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
                  aria-label={`${account.name} balance for ${formatMonthLabel(month)}`}
                  onFocus={handleFocus}
                  onBlur={handleCommit}
                  onKeyDown={handleKeyDown}
                />
              </div>
            );
          })}
        </div>
      ))}
      <div
        className={`import-shell__totals-row import-shell__totals-row--bucket${pinned ? " networth-row--pinned" : ""}`}
        style={accent}
      >
        {pinned && <span className="networth-row-strut" aria-hidden="true" />}
        {group.totalPerColumn.map((value, index) => (
          <div
            key={columns[index].key}
            className="import-shell__totals-cell import-shell__totals-cell--bucket networth-readonly-cell"
            style={cellStyle(columns[index])}
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
