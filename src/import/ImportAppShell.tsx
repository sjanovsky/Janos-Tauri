import { useEffect, useMemo, useState, type ChangeEvent, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { parseCsvText, type ImportedTransaction } from "./csvParser";
import { buildChartSeries, resolveBucketKey, type ChartPoint, type ChartRange } from "./transactionSummary";
import { computeDivergingScale } from "./chartScale";
import {
  ALL_CATEGORIES,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  SPEND_CATEGORIES,
  type Category,
  type SpendCategory,
} from "./categories";
import "./BankImportPage.css";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const BAR_WIDTH_BY_RANGE: Record<ChartRange, number> = { day: 14, month: 32, year: 48 };
const COLUMN_BASIS_BY_RANGE: Record<ChartRange, number> = { day: 26, month: 60, year: 84 };

type TooltipAnchor = {
  point: ChartPoint;
  x: number;
  y: number;
};

type ViewMode = "uploads" | "master";

type UploadedFileView = {
  id: string;
  bankName: string;
  fileName: string;
  transactions: ImportedTransaction[];
};

type BankOption = {
  id: string;
  name: string;
  initials: string;
  accent: string;
};

const bankOptions: BankOption[] = [
  { id: "amex", name: "AMEX", initials: "AX", accent: "#2d6cdf" },
  { id: "chase", name: "Chase", initials: "C", accent: "#1177d6" },
  { id: "boa", name: "BoA", initials: "B", accent: "#0f7a4a" },
  { id: "capital-one", name: "Capital One", initials: "CO", accent: "#8a2be2" },
  { id: "citi", name: "Citi", initials: "CI", accent: "#e31b46" },
  { id: "schwab", name: "Schwab", initials: "S", accent: "#0f766e" },
  { id: "fidelity", name: "Fidelity", initials: "F", accent: "#b45309" },
  { id: "coinbase", name: "Coinbase", initials: "CB", accent: "#ff9500" },
];

function ImportAppShell() {
  const [view, setView] = useState<ViewMode>("uploads");
  const [uploads, setUploads] = useState<UploadedFileView[]>([]);
  const [activeBank, setActiveBank] = useState<string | null>(null);
  const [chartRange, setChartRange] = useState<ChartRange>("month");
  const [tooltipAnchor, setTooltipAnchor] = useState<TooltipAnchor | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<SpendCategory[]>(SPEND_CATEGORIES);
  const [dbError, setDbError] = useState<string | null>(null);
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(null);

  useEffect(() => {
    invoke<UploadedFileView[]>("list_uploads")
      .then(setUploads)
      .catch((error) => {
        console.error("Failed to load uploads from the database", error);
        setDbError("Couldn't reach the local database. Make sure the app is running via `npm run tauri dev`.");
      });
  }, []);

  const masterTransactions = useMemo(() => uploads.flatMap((upload) => upload.transactions), [uploads]);

  const chartTransactions = useMemo(
    () =>
      masterTransactions.filter(
        (transaction) =>
          transaction.category !== "transfers" &&
          transaction.category !== "unclassified" &&
          selectedCategories.includes(transaction.category),
      ),
    [masterTransactions, selectedCategories],
  );

  const chartSeries = useMemo(
    () => buildChartSeries(chartTransactions, chartRange),
    [chartTransactions, chartRange],
  );

  const chartScale = useMemo(
    () =>
      computeDivergingScale(
        chartSeries.map((point) => {
          const positiveTotal = point.segments
            .filter((segment) => segment.value > 0)
            .reduce((sum, segment) => sum + segment.value, 0);
          const negativeTotal = point.segments
            .filter((segment) => segment.value < 0)
            .reduce((sum, segment) => sum + Math.abs(segment.value), 0);
          return { positiveTotal, negativeTotal };
        }),
      ),
    [chartSeries],
  );

  const selectedBucketLabel = useMemo(
    () => chartSeries.find((point) => point.key === selectedBucketKey)?.label ?? selectedBucketKey,
    [chartSeries, selectedBucketKey],
  );

  const tableTransactions = useMemo(() => {
    if (!selectedBucketKey) {
      return masterTransactions;
    }

    return chartTransactions.filter(
      (transaction) => resolveBucketKey(transaction.date, chartRange) === selectedBucketKey,
    );
  }, [selectedBucketKey, chartTransactions, masterTransactions, chartRange]);

  const handleRangeChange = (range: ChartRange) => {
    setChartRange(range);
    setSelectedBucketKey(null);
  };

  const toggleBucket = (key: string) => {
    setSelectedBucketKey((current) => (current === key ? null : key));
  };

  const toggleCategory = (category: SpendCategory) => {
    setSelectedCategories((current) =>
      current.includes(category) ? current.filter((item) => item !== category) : [...current, category],
    );
  };

  const handleCategoryChange = (transactionId: string, category: Category) => {
    setUploads((current) =>
      current.map((upload) => ({
        ...upload,
        transactions: upload.transactions.map((transaction) =>
          transaction.id === transactionId ? { ...transaction, category } : transaction,
        ),
      })),
    );

    invoke("update_transaction_category", { transactionId, category }).catch((error) => {
      console.error("Failed to save category change", error);
      setDbError("Couldn't save that category change to the database.");
    });
  };

  const importFile = async (file: File | null, bankId: string) => {
    if (!file) {
      return;
    }

    const text = await file.text();
    const bankName = bankOptions.find((option) => option.id === bankId)?.name ?? "Unknown";
    const transactions = parseCsvText(text, bankName, file.name);
    const upload: UploadedFileView = {
      id: `${file.name}-${crypto.randomUUID()}`,
      bankName,
      fileName: file.name,
      transactions,
    };

    try {
      await invoke("add_upload", {
        id: upload.id,
        bankName: upload.bankName,
        fileName: upload.fileName,
        transactions: upload.transactions,
      });
      setUploads((current) => [upload, ...current]);
    } catch (error) {
      console.error("Failed to save upload to the database", error);
      setDbError("Couldn't save that upload to the database.");
    }
  };

  const handleDeleteUpload = async (uploadId: string) => {
    const previousUploads = uploads;
    setUploads((current) => current.filter((upload) => upload.id !== uploadId));

    try {
      await invoke("delete_upload", { id: uploadId });
    } catch (error) {
      console.error("Failed to delete upload from the database", error);
      setDbError("Couldn't delete that upload from the database.");
      setUploads(previousUploads);
    }
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>, bankId: string) => {
    await importFile(event.target.files?.[0] ?? null, bankId);
    event.target.value = "";
  };

  const handleDrop = async (event: DragEvent<HTMLLabelElement>, bankId: string) => {
    event.preventDefault();
    setActiveBank(null);
    await importFile(event.dataTransfer.files?.[0] ?? null, bankId);
  };

  return (
    <>
      <div className="import-shell">
      <aside className="import-shell__sidebar">
        <div className="import-shell__brand">Janos</div>
        <button
          className={`sidebar-tab ${view === "uploads" ? "sidebar-tab--active" : ""}`}
          onClick={() => setView("uploads")}
        >
          Uploads
        </button>
        <button
          className={`sidebar-tab ${view === "master" ? "sidebar-tab--active" : ""}`}
          onClick={() => setView("master")}
        >
          Master table
        </button>
      </aside>

      <main className="import-shell__content">
        {dbError && <div className="import-shell__db-error">{dbError}</div>}
        {view === "uploads" ? (
          <section className="import-shell__panel">
            <div className="import-shell__header">
              <div>
                <p className="import-shell__eyebrow">Import workspace</p>
                <h1>Upload bank statements</h1>
              </div>
            </div>

            <div className="import-shell__bank-grid">
              {bankOptions.map((bank) => {
                const isActive = activeBank === bank.id;

                return (
                  <label
                    key={bank.id}
                    className={`bank-button ${isActive ? "bank-button--active" : ""}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setActiveBank(bank.id);
                    }}
                    onDragLeave={() => setActiveBank((current) => (current === bank.id ? null : current))}
                    onDrop={(event) => handleDrop(event, bank.id)}
                  >
                    <span className="bank-button__logo" style={{ backgroundColor: bank.accent }}>
                      {bank.initials}
                    </span>

                    <span className="bank-button__content">
                      <span className="bank-button__name">{bank.name}</span>
                      <span className="bank-button__hint">Click or drop CSV</span>
                    </span>

                    <input
                      type="file"
                      accept=".csv"
                      className="bank-button__input"
                      onChange={(event) => handleFileUpload(event, bank.id)}
                    />
                  </label>
                );
              })}
            </div>

            <div className="import-shell__uploads">
              <div className="import-shell__uploads-heading">
                <h2>Recent uploads</h2>
                <p>Most recently imported files appear here.</p>
              </div>

              {uploads.length === 0 ? (
                <div className="import-shell__empty">
                  No files imported yet. Choose a bank card to get started.
                </div>
              ) : (
                uploads.map((upload) => (
                  <article key={upload.id} className="import-shell__upload-card">
                    <div>
                      <h2>{upload.fileName}</h2>
                      <p>{upload.bankName}</p>
                    </div>
                    <div className="import-shell__upload-card-meta">
                      <span>{upload.transactions.length} transactions</span>
                      <button
                        type="button"
                        className="import-shell__upload-delete"
                        aria-label={`Delete ${upload.fileName}`}
                        onClick={() => handleDeleteUpload(upload.id)}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="18"
                          height="18"
                          aria-hidden="true"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        ) : (
          <section className="import-shell__panel">
            <div className="import-shell__header">
              <div>
                <p className="import-shell__eyebrow">Master data</p>
                <h1>Combined transaction table</h1>
              </div>
            </div>

            <div className="import-shell__chart-card">
              <div className="import-shell__chart-header">
                <div>
                  <h2>Spending by {chartRange}</h2>
                  <p>
                    Totals grouped by {chartRange === "day" ? "day" : chartRange === "month" ? "month" : "year"},
                    transfers and unclassified transactions excluded.
                  </p>
                </div>
                <div className="import-shell__range-switcher">
                  {(["day", "month", "year"] as ChartRange[]).map((range) => (
                    <button
                      key={range}
                      type="button"
                      className={`range-pill ${chartRange === range ? "range-pill--active" : ""}`}
                      onClick={() => handleRangeChange(range)}
                    >
                      {range === "day" ? "Days" : range === "month" ? "Months" : "Years"}
                    </button>
                  ))}
                </div>
              </div>

              {masterTransactions.length === 0 ? (
                <div className="import-shell__empty">No chart data available yet.</div>
              ) : (
                <>
                  <div className="import-shell__chart-key">
                    {SPEND_CATEGORIES.map((category) => {
                      const isActive = selectedCategories.includes(category);
                      return (
                        <button
                          key={category}
                          type="button"
                          className={`import-shell__chart-key-item ${isActive ? "" : "import-shell__chart-key-item--inactive"}`}
                          aria-pressed={isActive}
                          onClick={() => toggleCategory(category)}
                        >
                          <span
                            className="import-shell__chart-key-swatch"
                            style={{ background: CATEGORY_COLORS[category] }}
                          />
                          {CATEGORY_LABELS[category]}
                        </button>
                      );
                    })}
                  </div>

                  {selectedCategories.length === 0 ? (
                    <div className="import-shell__empty">Select at least one category to see the chart.</div>
                  ) : (
                    <div className="import-shell__chart-axis" aria-label="Transaction summary chart">
                      <div className="import-shell__y-axis">
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

                      <div className="import-shell__chart-bands">
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
                            {chartSeries.map((point) => {
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
                                  onClick={() => toggleBucket(point.key)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      toggleBucket(point.key);
                                    }
                                  }}
                                  onMouseEnter={(event) => anchorTooltip(event.currentTarget.getBoundingClientRect())}
                                  onMouseLeave={clearTooltip}
                                  onFocus={(event) => anchorTooltip(event.currentTarget.getBoundingClientRect())}
                                  onBlur={clearTooltip}
                                >
                                  {allRects.map(({ segment, topPct, heightPct, borderRadius }) => (
                                    <div
                                      key={segment.category}
                                      className="import-shell__bar-segment"
                                      style={{
                                        top: `calc(${topPct}% + 1px)`,
                                        height: `calc(${heightPct}% - 2px)`,
                                        width: `${BAR_WIDTH_BY_RANGE[chartRange]}px`,
                                        background: CATEGORY_COLORS[segment.category],
                                        borderRadius,
                                      }}
                                      aria-label={`${point.label} ${CATEGORY_LABELS[segment.category]}: ${currencyFormatter.format(segment.value)}`}
                                    />
                                  ))}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {selectedBucketKey && (
              <div className="import-shell__table-filter">
                Filtered to <strong>{selectedBucketLabel}</strong>
                <button type="button" onClick={() => setSelectedBucketKey(null)}>
                  Clear
                </button>
              </div>
            )}

            <div className="import-shell__table-shell">
              {tableTransactions.length === 0 ? (
                <div className="import-shell__empty">
                  {masterTransactions.length === 0
                    ? "No transactions have been imported yet."
                    : "No transactions match this filter."}
                </div>
              ) : (
                <table className="import-shell__table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Card member</th>
                      <th>Account #</th>
                      <th>Amount</th>
                      <th>Bank</th>
                      <th>Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableTransactions.map((transaction) => (
                      <tr key={transaction.id}>
                        <td>{transaction.date}</td>
                        <td>{transaction.description}</td>
                        <td>{transaction.cardMember}</td>
                        <td>{transaction.accountNumber}</td>
                        <td>{transaction.amount.toFixed(2)}</td>
                        <td>{transaction.sourceBank}</td>
                        <td>
                          <select
                            className={`import-shell__category-select ${
                              transaction.category === "unclassified"
                                ? "import-shell__category-select--unclassified"
                                : ""
                            }`}
                            value={transaction.category}
                            onChange={(event) =>
                              handleCategoryChange(transaction.id, event.target.value as Category)
                            }
                          >
                            {ALL_CATEGORIES.map((category) => (
                              <option key={category} value={category}>
                                {CATEGORY_LABELS[category]}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        )}
      </main>
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
              <div key={segment.category} className="import-shell__tooltip-row">
                <span
                  className="import-shell__tooltip-key"
                  style={{ background: CATEGORY_COLORS[segment.category] }}
                />
                <strong>{currencyFormatter.format(segment.value)}</strong>
                <span>{CATEGORY_LABELS[segment.category]}</span>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

export default ImportAppShell;
