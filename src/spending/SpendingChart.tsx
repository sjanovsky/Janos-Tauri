import { useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { ChartRange } from "./lib/transactionSummary";
import type { DivergingScale } from "./lib/chartScale";
import { getCategoryLabel } from "./lib/categories";
import { currencyFormatter, wholeCurrencyFormatter } from "./lib/format";

const COLUMN_BASIS_BY_RANGE: Record<ChartRange, number> = { day: 26, month: 60, year: 84 };

const AXIS_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Compact x-axis labels derived from a bucket key (YYYY, YYYY-MM, or YYYY-MM-DD):
// year -> "2026", month -> "Oct'26", day -> "Oct 3".
function formatAxisLabel(key: string, range: ChartRange): string {
  const [year, month, day] = key.split("-");
  if (range === "year") {
    return year;
  }
  const monthName = AXIS_MONTHS[Number.parseInt(month, 10) - 1] ?? month;
  if (range === "month") {
    return `${monthName}'${year.slice(-2)}`;
  }
  return `${monthName} ${Number.parseInt(day, 10)}`;
}

// The chart stacks one segment per spending bucket (categories are summed into their bucket).
export type BucketSegment = {
  bucketId: string;
  label: string;
  color: string;
  value: number;
};

export type BucketChartPoint = {
  key: string;
  label: string;
  segments: BucketSegment[];
};

export type BucketMeta = { id: string; name: string; color: string };

// The chart can stack spending by bucket (categories rolled into buckets) or by the bank
// each transaction was imported from.
export type GroupMode = "bucket" | "bank" | "gross";

type TooltipAnchor = {
  point: BucketChartPoint;
  x: number;
  y: number;
};

// Each bucket's section renders its categories as line items, then the bucket total at the
// bottom. `perColumn` holds the value for each time column in the chart. `color` is the
// bucket's color (shared across the whole section); `sectionStart` marks the first line item.
export type TotalsDisplayRow =
  | {
      kind: "category";
      key: string;
      category: string;
      perColumn: number[];
      color: string;
      sectionStart: boolean;
    }
  | {
      kind: "bucketTotal";
      key: string;
      bucketId: string;
      label: string;
      perColumn: number[];
      color: string;
      // Set when this bucket total is the whole section (a single-category bucket collapsed into
      // one row), so it carries the gap a category line item would normally provide above it.
      sectionStart?: boolean;
    };

export type SpendingTotals = { displayRows: TotalsDisplayRow[]; netPerColumn: number[] };

type SpendingChartProps = {
  hasTransactions: boolean;
  selectedCategories: string[];
  chartRange: ChartRange;
  groupMode: GroupMode;
  activeSeries: BucketChartPoint[];
  chartScale: DivergingScale;
  activeTotals: SpendingTotals;
  selectedBucketKey: string | null;
  selectedCategory: string | null;
  selectedBucketId: string | null;
  onRangeChange: (range: ChartRange) => void;
  onGroupModeChange: (mode: GroupMode) => void;
  onToggleBucket: (key: string) => void;
  onToggleSegment: (key: string, category: string) => void;
  onToggleBucketSegment: (key: string, bucketId: string) => void;
  onToggleCategoryFilter: (category: string) => void;
  onToggleBucketFilter: (bucketId: string) => void;
  onOpenSettings: () => void;
  // Wording, so the Income page can reuse the card: "Spending" by default.
  title?: string;
  bucketLabel?: string;
  settingsLabel?: string;
  // Which grouping pills to offer, in order; defaults to buckets and banks.
  groupOptions?: { mode: GroupMode; label: string }[];
  // Label of the bottom row that sums every column; "Net" by default.
  netLabel?: string;
};

// The "Spending by {range}" card: a diverging stacked-bar chart with a per-bucket (or
// per-bank) totals table beneath it, plus the hover tooltip. Clicking a bar, segment, or
// totals cell/label filters the transaction table (the shell owns the selection state).
function SpendingChart({
  hasTransactions,
  selectedCategories,
  chartRange,
  groupMode,
  activeSeries,
  chartScale,
  activeTotals,
  selectedBucketKey,
  selectedCategory,
  selectedBucketId,
  onRangeChange,
  onGroupModeChange,
  onToggleBucket,
  onToggleSegment,
  onToggleBucketSegment,
  onToggleCategoryFilter,
  onToggleBucketFilter,
  onOpenSettings,
  title = "Spending",
  bucketLabel = "Buckets",
  settingsLabel = "Buckets & categories",
  groupOptions,
  netLabel = "Net",
}: SpendingChartProps) {
  const [tooltipAnchor, setTooltipAnchor] = useState<TooltipAnchor | null>(null);

  return (
    <>
      <div className="import-shell__chart-card">
        <div className="import-shell__chart-header">
          <div>
            <h2>{title} by {chartRange}</h2>
          </div>
          <div className="import-shell__chart-tools">
            <button
              type="button"
              className="import-shell__settings-button"
              aria-label={`Open ${settingsLabel.toLowerCase()} settings`}
              title={settingsLabel}
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

        {!hasTransactions ? (
          <div className="import-shell__empty">No chart data available yet.</div>
        ) : (
          <>
            {selectedCategories.length === 0 ? (
              <div className="import-shell__empty">Select at least one category to see the chart.</div>
            ) : (
              <div className="import-shell__chart-grid" aria-label="Transaction summary chart">
                <div className="import-shell__chart-gutter">
                  <div className="import-shell__y-axis">
                    <div
                      className="import-shell__group-toggle"
                      role="group"
                      aria-label={`Group ${title.toLowerCase()} by`}
                    >
                      {(groupOptions ?? [
                        { mode: "bucket" as GroupMode, label: bucketLabel },
                        { mode: "bank" as GroupMode, label: "Banks" },
                      ]).map(({ mode, label }) => (
                        <button
                          key={mode}
                          type="button"
                          className={`group-pill ${groupMode === mode ? "group-pill--active" : ""}`}
                          aria-pressed={groupMode === mode}
                          onClick={() => onGroupModeChange(mode)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {chartScale.ticks.map((tick) => (
                      <span
                        key={tick}
                        className="import-shell__y-axis-tick"
                        style={{ top: `${((chartScale.positiveMax - tick) / chartScale.totalRange) * 100}%` }}
                      >
                        {tick.toLocaleString()}
                      </span>
                    ))}
                  </div>

                  <div className="import-shell__x-axis-toggle">
                    <div className="import-shell__range-switcher">
                      {(["day", "month", "year"] as ChartRange[]).map((range) => (
                        <button
                          key={range}
                          type="button"
                          className={`range-pill ${chartRange === range ? "range-pill--active" : ""}`}
                          onClick={() => onRangeChange(range)}
                        >
                          {range === "day" ? "Days" : range === "month" ? "Months" : "Years"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {activeTotals.displayRows.length > 0 && (
                    <div
                      className={`import-shell__totals-labels ${
                        groupMode === "bank" ? "import-shell__totals-labels--standalone" : ""
                      }`}
                    >
                      {activeTotals.displayRows.map((row) => {
                        if (row.kind === "bucketTotal") {
                          const rowSelected =
                            selectedBucketId === row.bucketId && !selectedBucketKey && !selectedCategory;
                          return (
                            <button
                              key={row.key}
                              type="button"
                              className={`import-shell__totals-label import-shell__totals-label--bucket ${
                                row.sectionStart ? "import-shell__totals-label--section-start" : ""
                              } ${rowSelected ? "import-shell__totals-label--selected" : ""}`}
                              style={{ "--bucket": row.color } as CSSProperties}
                              title={`Filter the table to ${row.label}`}
                              aria-pressed={rowSelected}
                              onClick={() => onToggleBucketFilter(row.bucketId)}
                            >
                              <span className="import-shell__totals-label-text">{row.label}</span>
                            </button>
                          );
                        }

                        const rowSelected =
                          selectedCategory === row.category && !selectedBucketKey && !selectedBucketId;
                        return (
                          <button
                            key={row.key}
                            type="button"
                            className={`import-shell__totals-label import-shell__totals-label--item ${
                              row.sectionStart ? "import-shell__totals-label--section-start" : ""
                            } ${rowSelected ? "import-shell__totals-label--selected" : ""}`}
                            style={{ "--bucket": row.color } as CSSProperties}
                            title={`Filter the table to ${getCategoryLabel(row.category)}`}
                            aria-pressed={rowSelected}
                            onClick={() => onToggleCategoryFilter(row.category)}
                          >
                            <span className="import-shell__totals-label-text">{getCategoryLabel(row.category)}</span>
                          </button>
                        );
                      })}
                      <div className="import-shell__totals-label import-shell__totals-label--net">{netLabel}</div>
                    </div>
                  )}
                </div>

                <div className="import-shell__chart-scroll">
                  <div className="import-shell__chart-track">
                    <div className="import-shell__chart-plot">
                      {chartScale.ticks.map((tick) => (
                        <div
                          key={tick}
                          className="import-shell__gridline"
                          style={{ top: `${((chartScale.positiveMax - tick) / chartScale.totalRange) * 100}%` }}
                        />
                      ))}
                      <div
                        className="import-shell__baseline"
                        style={{ top: `${(chartScale.positiveMax / chartScale.totalRange) * 100}%` }}
                      />

                      <div className="import-shell__chart-bars">
                        {activeSeries.map((point) => {
                          const baselinePct = (chartScale.positiveMax / chartScale.totalRange) * 100;
                          const positiveSegments = point.segments.filter((segment) => segment.value > 0);
                          const negativeSegments = point.segments.filter((segment) => segment.value < 0);

                          let positiveCursor = 0;
                          const positiveRects = positiveSegments.map((segment, index) => {
                            positiveCursor += segment.value;
                            const heightPct = (segment.value / chartScale.totalRange) * 100;
                            const topPct = baselinePct - (positiveCursor / chartScale.totalRange) * 100;
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
                            const topPct = baselinePct + (negativeCursor / chartScale.totalRange) * 100;
                            negativeCursor += magnitude;
                            const heightPct = (magnitude / chartScale.totalRange) * 100;
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
                          const barTotal = point.segments.reduce((sum, segment) => sum + segment.value, 0);

                          const isSelected = selectedBucketKey === point.key;

                          const anchorTooltip = (rect: DOMRect) => {
                            setTooltipAnchor({
                              point,
                              x: rect.left + rect.width / 2,
                              y: rect.top + (tooltipTopPct / 100) * rect.height,
                            });
                          };
                          const clearTooltip = () => {
                            setTooltipAnchor((current) => (current?.point.label === point.label ? null : current));
                          };

                          return (
                            <div
                              key={point.label}
                              className={`import-shell__bar-col ${isSelected ? "import-shell__bar-col--selected" : ""}`}
                              style={{ flex: `1 0 ${COLUMN_BASIS_BY_RANGE[chartRange]}px` }}
                              tabIndex={0}
                              role="button"
                              aria-pressed={isSelected}
                              aria-label={`Filter the table to ${point.label}`}
                              onClick={() => onToggleBucket(point.key)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  onToggleBucket(point.key);
                                }
                              }}
                              onMouseEnter={(event) => anchorTooltip(event.currentTarget.getBoundingClientRect())}
                              onMouseLeave={clearTooltip}
                              onFocus={(event) => anchorTooltip(event.currentTarget.getBoundingClientRect())}
                              onBlur={clearTooltip}
                            >
                              {allRects.length > 0 && (
                                <span
                                  className="import-shell__bar-total"
                                  style={{ top: `${tooltipTopPct}%` }}
                                >
                                  {wholeCurrencyFormatter.format(barTotal)}
                                </span>
                              )}
                              {allRects.map(({ segment, topPct, heightPct, borderRadius }) => {
                                const segmentSelected = isSelected && selectedBucketId === segment.bucketId;
                                const segmentDimmed =
                                  selectedBucketId !== null && segment.bucketId !== selectedBucketId;

                                return (
                                  <div
                                    key={segment.bucketId}
                                    className={`import-shell__bar-segment ${segmentSelected ? "import-shell__bar-segment--selected" : ""} ${segmentDimmed ? "import-shell__bar-segment--dimmed" : ""}`}
                                    style={{
                                      top: `calc(${topPct}% + 1px)`,
                                      height: `calc(${heightPct}% - 2px)`,
                                      width: "75%",
                                      background: segment.color,
                                      borderRadius,
                                    }}
                                    aria-label={`Filter the table to ${point.label} ${segment.label}: ${currencyFormatter.format(segment.value)}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onToggleBucketSegment(point.key, segment.bucketId);
                                    }}
                                  />
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="import-shell__x-axis">
                      {activeSeries.map((point) => (
                        <div
                          key={point.key}
                          className="import-shell__x-axis-label"
                          style={{ flex: `1 0 ${COLUMN_BASIS_BY_RANGE[chartRange]}px` }}
                          title={point.label}
                        >
                          {formatAxisLabel(point.key, chartRange)}
                        </div>
                      ))}
                    </div>

                    {activeTotals.displayRows.length > 0 && (
                      <div
                        className={`import-shell__totals-values ${
                          groupMode === "bank" ? "import-shell__totals-values--standalone" : ""
                        }`}
                      >
                        {activeTotals.displayRows.map((row) => {
                          if (row.kind === "bucketTotal") {
                            return (
                              <div
                                key={row.key}
                                className={`import-shell__totals-row import-shell__totals-row--bucket ${
                                  row.sectionStart ? "import-shell__totals-row--section-start" : ""
                                }`}
                                style={{ "--bucket": row.color } as CSSProperties}
                              >
                                {row.perColumn.map((value, index) => {
                                  const point = activeSeries[index];
                                  const columnSelected = selectedBucketKey === point.key;
                                  const cellSelected = columnSelected && selectedBucketId === row.bucketId;
                                  return (
                                    <button
                                      key={point.key}
                                      type="button"
                                      className={`import-shell__totals-cell import-shell__totals-cell--bucket ${columnSelected ? "import-shell__totals-cell--column" : ""} ${cellSelected ? "import-shell__totals-cell--selected" : ""}`}
                                      style={{ flex: `1 0 ${COLUMN_BASIS_BY_RANGE[chartRange]}px` }}
                                      aria-label={`Filter the table to ${point.label} ${row.label}: ${currencyFormatter.format(value)}`}
                                      onClick={() => onToggleBucketSegment(point.key, row.bucketId)}
                                    >
                                      {value === 0 ? "—" : wholeCurrencyFormatter.format(value)}
                                    </button>
                                  );
                                })}
                              </div>
                            );
                          }

                          return (
                            <div
                              key={row.key}
                              className={`import-shell__totals-row import-shell__totals-row--item ${
                                row.sectionStart ? "import-shell__totals-row--section-start" : ""
                              }`}
                              style={{ "--bucket": row.color } as CSSProperties}
                            >
                              {row.perColumn.map((value, index) => {
                                const point = activeSeries[index];
                                const columnSelected = selectedBucketKey === point.key;
                                const cellSelected = columnSelected && selectedCategory === row.category;
                                return (
                                  <button
                                    key={point.key}
                                    type="button"
                                    className={`import-shell__totals-cell ${columnSelected ? "import-shell__totals-cell--column" : ""} ${cellSelected ? "import-shell__totals-cell--selected" : ""}`}
                                    style={{ flex: `1 0 ${COLUMN_BASIS_BY_RANGE[chartRange]}px` }}
                                    aria-label={`Filter the table to ${point.label} ${getCategoryLabel(row.category)}: ${currencyFormatter.format(value)}`}
                                    onClick={() => onToggleSegment(point.key, row.category)}
                                  >
                                    {value === 0 ? "—" : wholeCurrencyFormatter.format(value)}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })}

                        <div className="import-shell__totals-row import-shell__totals-row--net">
                          {activeTotals.netPerColumn.map((value, index) => {
                            const point = activeSeries[index];
                            const columnSelected = selectedBucketKey === point.key;
                            return (
                              <button
                                key={point.key}
                                type="button"
                                className={`import-shell__totals-cell import-shell__totals-cell--net ${columnSelected ? "import-shell__totals-cell--column" : ""}`}
                                style={{ flex: `1 0 ${COLUMN_BASIS_BY_RANGE[chartRange]}px` }}
                                aria-label={`Filter the table to ${point.label}: ${currencyFormatter.format(value)}`}
                                onClick={() => onToggleBucket(point.key)}
                              >
                                {value === 0 ? "—" : wholeCurrencyFormatter.format(value)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
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
          </div>,
          document.body,
        )}
    </>
  );
}

export default SpendingChart;
