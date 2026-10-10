import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ImportedTransaction } from "./csvParser";
import CustomImportPanel from "./CustomImportPanel";
import CategoriesPanel from "./CategoriesPanel";
import { buildChartSeries, parseDate, resolveBucketKey, type ChartPoint, type ChartRange } from "./transactionSummary";
import { computeDivergingScale } from "./chartScale";
import {
  DEFAULT_CATEGORIES,
  RESERVED_CATEGORIES,
  applyCategoryRecords,
  deriveCategoryList,
  generateCategoryId,
  getCategoryColor,
  getCategoryLabel,
  isReservedCategory,
  resolveCategoryInput,
  type Category,
  type CategoryRecord,
  type BucketRecord,
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

type TotalsDisplayRow =
  | { kind: "bucket"; key: string; label: string; perBucket: number[] }
  | { kind: "category"; key: string; category: string; perBucket: number[]; indented: boolean };

type SortKey = "date" | "description" | "bank" | "amount" | "category";
type SortDirection = "asc" | "desc";
type SortState = { key: SortKey; direction: SortDirection };

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "description", label: "Description" },
  { key: "bank", label: "Bank" },
  { key: "amount", label: "Amount" },
  { key: "category", label: "Category" },
];

function sortValue(transaction: ImportedTransaction, key: SortKey): string | number {
  switch (key) {
    case "date":
      return parseDate(transaction.date)?.getTime() ?? Number.NEGATIVE_INFINITY;
    case "amount":
      return transaction.amount;
    case "bank":
      return transaction.sourceBank.toLowerCase();
    case "category":
      return getCategoryLabel(transaction.category).toLowerCase();
    case "description":
    default:
      return transaction.description.toLowerCase();
  }
}

function ImportAppShell() {
  const [view, setView] = useState<ViewMode>("uploads");
  const [uploads, setUploads] = useState<UploadedFileView[]>([]);
  const [chartRange, setChartRange] = useState<ChartRange>("month");
  const [tooltipAnchor, setTooltipAnchor] = useState<TooltipAnchor | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [dbError, setDbError] = useState<string | null>(null);
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [tableSort, setTableSort] = useState<SortState | null>(null);
  const [categoryRecords, setCategoryRecords] = useState<CategoryRecord[]>([]);
  const [buckets, setBuckets] = useState<BucketRecord[]>([]);
  const [excludeMenuOpen, setExcludeMenuOpen] = useState(false);
  const excludeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<UploadedFileView[]>("list_uploads")
      .then(setUploads)
      .catch((error) => {
        console.error("Failed to load uploads from the database", error);
        setDbError("Couldn't reach the local database. Make sure the app is running via `npm run tauri dev`.");
      });
  }, []);

  useEffect(() => {
    invoke<CategoryRecord[]>("list_categories")
      .then(setCategoryRecords)
      .catch((error) => {
        console.error("Failed to load categories from the database", error);
        setDbError("Couldn't reach the local database. Make sure the app is running via `npm run tauri dev`.");
      });
  }, []);

  useEffect(() => {
    invoke<BucketRecord[]>("list_buckets")
      .then(setBuckets)
      .catch((error) => {
        console.error("Failed to load buckets from the database", error);
        setDbError("Couldn't reach the local database. Make sure the app is running via `npm run tauri dev`.");
      });
  }, []);

  useEffect(() => {
    applyCategoryRecords(categoryRecords);
  }, [categoryRecords]);

  useEffect(() => {
    if (!excludeMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (excludeMenuRef.current && !excludeMenuRef.current.contains(event.target as Node)) {
        setExcludeMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExcludeMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [excludeMenuOpen]);

  const masterTransactions = useMemo(() => uploads.flatMap((upload) => upload.transactions), [uploads]);

  const excludedCategories = useMemo(
    () => new Set(categoryRecords.filter((record) => record.excluded).map((record) => record.id)),
    [categoryRecords],
  );

  const categoryList = useMemo(
    () => deriveCategoryList(masterTransactions, categoryRecords.map((record) => record.id)),
    [masterTransactions, categoryRecords],
  );

  // Current categories (id + label) used to match imported/typed category text back to an
  // existing category instead of creating a duplicate.
  const knownCategories = useMemo(() => {
    const recordIds = new Set(categoryRecords.map((record) => record.id));
    const known = categoryRecords.map((record) => ({ id: record.id, label: record.label }));
    categoryList.forEach((id) => {
      if (!recordIds.has(id) && !isReservedCategory(id)) {
        known.push({ id, label: getCategoryLabel(id) });
      }
    });
    return known;
  }, [categoryRecords, categoryList]);

  useEffect(() => {
    setSelectedCategories((current) => {
      const additions = categoryList.filter((category) => !current.includes(category));
      return additions.length > 0 ? [...current, ...additions] : current;
    });
  }, [categoryList]);

  const chartTransactions = useMemo(
    () =>
      masterTransactions.filter(
        (transaction) =>
          !isReservedCategory(transaction.category) &&
          !excludedCategories.has(transaction.category) &&
          selectedCategories.includes(transaction.category),
      ),
    [masterTransactions, selectedCategories, excludedCategories],
  );

  const chartSeries = useMemo(
    () => buildChartSeries(chartTransactions, chartRange, categoryList),
    [chartTransactions, chartRange, categoryList],
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

  const categoryTotals = useMemo(() => {
    const bucketNameById = new Map(buckets.map((bucket) => [bucket.id, bucket.name]));
    const bucketIdByCategory = new Map(categoryRecords.map((record) => [record.id, record.bucketId]));

    const activeRows = categoryList
      .filter((category) => selectedCategories.includes(category) && !excludedCategories.has(category))
      .map((category) => {
        const perBucket = chartSeries.map((point) => {
          const segment = point.segments.find((item) => item.category === category);
          return segment ? segment.value : 0;
        });
        return { category, perBucket };
      })
      .filter((row) => row.perBucket.some((value) => value !== 0));

    const columnCount = chartSeries.length;
    const sumRows = (rows: { perBucket: number[] }[]) =>
      rows.reduce(
        (totals, row) => totals.map((value, index) => value + row.perBucket[index]),
        new Array<number>(columnCount).fill(0),
      );
    const byLabel = (a: { category: string }, b: { category: string }) =>
      getCategoryLabel(a.category).localeCompare(getCategoryLabel(b.category));

    const grouped = new Map<string, { category: string; perBucket: number[] }[]>();
    const ungrouped: { category: string; perBucket: number[] }[] = [];
    activeRows.forEach((row) => {
      const bucketId = bucketIdByCategory.get(row.category) ?? null;
      if (bucketId && bucketNameById.has(bucketId)) {
        const members = grouped.get(bucketId) ?? [];
        members.push(row);
        grouped.set(bucketId, members);
      } else {
        ungrouped.push(row);
      }
    });

    const displayRows: TotalsDisplayRow[] = [];
    const pushCategoryRows = (rows: { category: string; perBucket: number[] }[], indented: boolean) => {
      rows
        .slice()
        .sort(byLabel)
        .forEach((row) =>
          displayRows.push({
            kind: "category",
            key: row.category,
            category: row.category,
            perBucket: row.perBucket,
            indented,
          }),
        );
    };

    if (grouped.size > 0) {
      Array.from(grouped.keys())
        .sort((a, b) => (bucketNameById.get(a) ?? "").localeCompare(bucketNameById.get(b) ?? ""))
        .forEach((bucketId) => {
          const members = grouped.get(bucketId) ?? [];
          displayRows.push({
            kind: "bucket",
            key: `bucket:${bucketId}`,
            label: bucketNameById.get(bucketId) ?? "Bucket",
            perBucket: sumRows(members),
          });
          pushCategoryRows(members, true);
        });

      if (ungrouped.length > 0) {
        displayRows.push({
          kind: "bucket",
          key: "bucket:__ungrouped",
          label: "Ungrouped",
          perBucket: sumRows(ungrouped),
        });
        pushCategoryRows(ungrouped, true);
      }
    } else {
      pushCategoryRows(activeRows, false);
    }

    const netPerBucket = chartSeries.map((point) =>
      point.segments.reduce((sum, segment) => sum + segment.value, 0),
    );

    return { displayRows, netPerBucket };
  }, [categoryList, selectedCategories, excludedCategories, chartSeries, buckets, categoryRecords]);

  const tableTransactions = useMemo(() => {
    if (!selectedBucketKey && !selectedCategory) {
      return masterTransactions;
    }

    return chartTransactions.filter((transaction) => {
      const bucketMatches =
        !selectedBucketKey || resolveBucketKey(transaction.date, chartRange) === selectedBucketKey;
      const categoryMatches = !selectedCategory || transaction.category === selectedCategory;
      return bucketMatches && categoryMatches;
    });
  }, [selectedBucketKey, selectedCategory, chartTransactions, masterTransactions, chartRange]);

  const sortedTransactions = useMemo(() => {
    if (!tableSort) {
      return tableTransactions;
    }

    const direction = tableSort.direction === "asc" ? 1 : -1;
    return [...tableTransactions].sort((a, b) => {
      const aValue = sortValue(a, tableSort.key);
      const bValue = sortValue(b, tableSort.key);
      if (typeof aValue === "number" && typeof bValue === "number") {
        return (aValue - bValue) * direction;
      }
      return String(aValue).localeCompare(String(bValue)) * direction;
    });
    // categoryRecords is a dependency because sorting by category uses its (possibly renamed) label.
  }, [tableTransactions, tableSort, categoryRecords]);

  const toggleSort = (key: SortKey) => {
    setTableSort((current) =>
      current && current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  };

  const handleRangeChange = (range: ChartRange) => {
    setChartRange(range);
    setSelectedBucketKey(null);
    setSelectedCategory(null);
  };

  const clearTableFilter = () => {
    setSelectedBucketKey(null);
    setSelectedCategory(null);
  };

  const toggleBucket = (key: string) => {
    setSelectedBucketKey((current) => (current === key ? null : key));
    setSelectedCategory(null);
  };

  const toggleSegment = (key: string, category: string) => {
    const alreadySelected = selectedBucketKey === key && selectedCategory === category;
    setSelectedBucketKey(alreadySelected ? null : key);
    setSelectedCategory(alreadySelected ? null : category);
  };

  const toggleCategoryFilter = (category: string) => {
    const alreadySelected = selectedCategory === category && !selectedBucketKey;
    setSelectedBucketKey(null);
    setSelectedCategory(alreadySelected ? null : category);
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

  const persistUpload = async (
    bankName: string,
    fileName: string,
    transactions: ImportedTransaction[],
  ): Promise<boolean> => {
    const upload: UploadedFileView = {
      id: `${fileName}-${crypto.randomUUID()}`,
      bankName,
      fileName,
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
      return true;
    } catch (error) {
      console.error("Failed to save upload to the database", error);
      setDbError("Couldn't save that upload to the database.");
      return false;
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

  const toggleCategoryExclusion = (id: string) => {
    const previousRecords = categoryRecords;
    const existing = categoryRecords.find((record) => record.id === id);
    const nextExcluded = !excludedCategories.has(id);
    const label = existing?.label ?? getCategoryLabel(id);
    const color = existing?.color ?? getCategoryColor(id);

    setCategoryRecords((current) =>
      current.some((record) => record.id === id)
        ? current.map((record) => (record.id === id ? { ...record, excluded: nextExcluded } : record))
        : [...current, { id, label, color, excluded: nextExcluded, bucketId: null }],
    );

    invoke("set_category_excluded", { id, label, color, excluded: nextExcluded }).catch((error) => {
      console.error("Failed to save the category exclusion to the database", error);
      setDbError("Couldn't save that category change to the database.");
      setCategoryRecords(previousRecords);
    });
  };

  const handleAddCategory = (label: string, color: string) => {
    const previousRecords = categoryRecords;
    const id = generateCategoryId(label, categoryRecords.map((record) => record.id));
    setCategoryRecords((current) => [...current, { id, label, color, excluded: false, bucketId: null }]);

    invoke("upsert_category", { id, label, color }).catch((error) => {
      console.error("Failed to save the new category to the database", error);
      setDbError("Couldn't save that category to the database.");
      setCategoryRecords(previousRecords);
    });
  };

  const handleUpdateCategory = (id: string, label: string, color: string) => {
    const previousRecords = categoryRecords;
    setCategoryRecords((current) => {
      const exists = current.some((record) => record.id === id);
      return exists
        ? current.map((record) => (record.id === id ? { ...record, label, color } : record))
        : [...current, { id, label, color, excluded: false, bucketId: null }];
    });

    invoke("upsert_category", { id, label, color }).catch((error) => {
      console.error("Failed to save the category change to the database", error);
      setDbError("Couldn't save that category change to the database.");
      setCategoryRecords(previousRecords);
    });
  };

  const handleDeleteCategory = (id: string) => {
    const previousRecords = categoryRecords;
    const previousUploads = uploads;

    setCategoryRecords((current) => current.filter((record) => record.id !== id));
    setSelectedCategories((current) => current.filter((category) => category !== id));
    setUploads((current) =>
      current.map((upload) => ({
        ...upload,
        transactions: upload.transactions.map((transaction) =>
          transaction.category === id ? { ...transaction, category: "unclassified" } : transaction,
        ),
      })),
    );

    invoke("delete_category", { id }).catch((error) => {
      console.error("Failed to delete the category from the database", error);
      setDbError("Couldn't delete that category from the database.");
      setCategoryRecords(previousRecords);
      setUploads(previousUploads);
    });
  };

  const handleAddBucket = (name: string) => {
    const previousBuckets = buckets;
    const id = crypto.randomUUID();
    setBuckets((current) => [...current, { id, name }]);

    invoke("upsert_bucket", { id, name }).catch((error) => {
      console.error("Failed to save the new bucket to the database", error);
      setDbError("Couldn't save that bucket to the database.");
      setBuckets(previousBuckets);
    });
  };

  const handleRenameBucket = (id: string, name: string) => {
    const previousBuckets = buckets;
    setBuckets((current) => current.map((bucket) => (bucket.id === id ? { ...bucket, name } : bucket)));

    invoke("upsert_bucket", { id, name }).catch((error) => {
      console.error("Failed to rename the bucket in the database", error);
      setDbError("Couldn't save that bucket to the database.");
      setBuckets(previousBuckets);
    });
  };

  const handleDeleteBucket = (id: string) => {
    const previousBuckets = buckets;
    const previousRecords = categoryRecords;

    setBuckets((current) => current.filter((bucket) => bucket.id !== id));
    setCategoryRecords((current) =>
      current.map((record) => (record.bucketId === id ? { ...record, bucketId: null } : record)),
    );

    invoke("delete_bucket", { id }).catch((error) => {
      console.error("Failed to delete the bucket from the database", error);
      setDbError("Couldn't delete that bucket from the database.");
      setBuckets(previousBuckets);
      setCategoryRecords(previousRecords);
    });
  };

  const handleSetCategoryBucket = (categoryId: string, bucketId: string | null) => {
    const previousRecords = categoryRecords;
    const existing = categoryRecords.find((record) => record.id === categoryId);
    const label = existing?.label ?? getCategoryLabel(categoryId);
    const color = existing?.color ?? getCategoryColor(categoryId);

    setCategoryRecords((current) =>
      current.some((record) => record.id === categoryId)
        ? current.map((record) => (record.id === categoryId ? { ...record, bucketId } : record))
        : [...current, { id: categoryId, label, color, excluded: false, bucketId }],
    );

    invoke("set_category_bucket", { id: categoryId, label, color, bucketId }).catch((error) => {
      console.error("Failed to save the category bucket to the database", error);
      setDbError("Couldn't save that category change to the database.");
      setCategoryRecords(previousRecords);
    });
  };

  return (
    <>
      <div className="import-shell">
      <header className="import-shell__topbar">
        <div className="import-shell__brand">Janos</div>
        <nav className="import-shell__tabs">
          <button
            className={`shell-tab ${view === "uploads" ? "shell-tab--active" : ""}`}
            onClick={() => setView("uploads")}
          >
            Uploads
          </button>
          <button
            className={`shell-tab ${view === "master" ? "shell-tab--active" : ""}`}
            onClick={() => setView("master")}
          >
            Master table
          </button>
        </nav>
      </header>

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

            <CustomImportPanel onImport={persistUpload} knownCategories={knownCategories} />

            <div className="import-shell__secondary-row">
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

              <CategoriesPanel
                categories={categoryRecords}
                buckets={buckets}
                onAdd={handleAddCategory}
                onUpdate={handleUpdateCategory}
                onDelete={handleDeleteCategory}
                onAddBucket={handleAddBucket}
                onRenameBucket={handleRenameBucket}
                onDeleteBucket={handleDeleteBucket}
                onSetCategoryBucket={handleSetCategoryBucket}
              />
            </div>
          </section>
        ) : (
          <section className="import-shell__panel">
            <div className="import-shell__master-layout">
            <div className="import-shell__chart-card">
              <div className="import-shell__chart-header">
                <div>
                  <h2>Spending by {chartRange}</h2>
                </div>
                <div className="import-shell__chart-tools">
                  <div className="import-shell__exclude" ref={excludeMenuRef}>
                    <button
                      type="button"
                      className={`import-shell__exclude-button ${excludeMenuOpen ? "import-shell__exclude-button--open" : ""}`}
                      aria-haspopup="true"
                      aria-expanded={excludeMenuOpen}
                      onClick={() => setExcludeMenuOpen((open) => !open)}
                    >
                      Exclude{excludedCategories.size > 0 ? ` (${excludedCategories.size})` : ""}
                      <svg
                        viewBox="0 0 24 24"
                        width="14"
                        height="14"
                        aria-hidden="true"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>

                    {excludeMenuOpen && (
                      <div className="import-shell__exclude-menu" role="menu">
                        <p className="import-shell__exclude-menu-title">Exclude from spending</p>
                        {categoryList.length === 0 ? (
                          <p className="import-shell__exclude-empty">No categories yet.</p>
                        ) : (
                          categoryList.map((category) => (
                            <label key={category} className="import-shell__exclude-option">
                              <input
                                type="checkbox"
                                checked={excludedCategories.has(category)}
                                onChange={() => toggleCategoryExclusion(category)}
                              />
                              <span
                                className="import-shell__exclude-swatch"
                                style={{ background: getCategoryColor(category) }}
                              />
                              <span className="import-shell__exclude-option-label">{getCategoryLabel(category)}</span>
                            </label>
                          ))
                        )}
                      </div>
                    )}
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
              </div>

              {masterTransactions.length === 0 ? (
                <div className="import-shell__empty">No chart data available yet.</div>
              ) : (
                <>
                  {selectedCategories.length === 0 ? (
                    <div className="import-shell__empty">Select at least one category to see the chart.</div>
                  ) : (
                    <div className="import-shell__chart-grid" aria-label="Transaction summary chart">
                      <div className="import-shell__chart-gutter">
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

                        {categoryTotals.displayRows.length > 0 && (
                          <div className="import-shell__totals-labels">
                            {categoryTotals.displayRows.map((row) => {
                              if (row.kind === "bucket") {
                                return (
                                  <div
                                    key={row.key}
                                    className="import-shell__totals-label import-shell__totals-label--bucket"
                                    title={row.label}
                                  >
                                    <span className="import-shell__totals-label-text">{row.label}</span>
                                  </div>
                                );
                              }

                              const rowSelected = selectedCategory === row.category && !selectedBucketKey;
                              return (
                                <button
                                  key={row.key}
                                  type="button"
                                  className={`import-shell__totals-label ${
                                    row.indented ? "import-shell__totals-label--indented" : ""
                                  } ${rowSelected ? "import-shell__totals-label--selected" : ""}`}
                                  title={`Filter the table to ${getCategoryLabel(row.category)}`}
                                  aria-pressed={rowSelected}
                                  onClick={() => toggleCategoryFilter(row.category)}
                                >
                                  <span
                                    className="import-shell__totals-swatch"
                                    style={{ background: getCategoryColor(row.category) }}
                                  />
                                  <span className="import-shell__totals-label-text">{getCategoryLabel(row.category)}</span>
                                </button>
                              );
                            })}
                            <div className="import-shell__totals-label import-shell__totals-label--net">Net</div>
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
                                    {allRects.map(({ segment, topPct, heightPct, borderRadius }) => {
                                      const segmentSelected = isSelected && selectedCategory === segment.category;
                                      const segmentDimmed = selectedCategory !== null && !segmentSelected;

                                      return (
                                        <div
                                          key={segment.category}
                                          className={`import-shell__bar-segment ${segmentSelected ? "import-shell__bar-segment--selected" : ""} ${segmentDimmed ? "import-shell__bar-segment--dimmed" : ""}`}
                                          style={{
                                            top: `calc(${topPct}% + 1px)`,
                                            height: `calc(${heightPct}% - 2px)`,
                                            width: `${BAR_WIDTH_BY_RANGE[chartRange]}px`,
                                            background: getCategoryColor(segment.category),
                                            borderRadius,
                                          }}
                                          aria-label={`Filter the table to ${point.label} ${getCategoryLabel(segment.category)}: ${currencyFormatter.format(segment.value)}`}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            toggleSegment(point.key, segment.category);
                                          }}
                                        />
                                      );
                                    })}
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {categoryTotals.displayRows.length > 0 && (
                            <div className="import-shell__totals-values">
                              {categoryTotals.displayRows.map((row) => {
                                if (row.kind === "bucket") {
                                  return (
                                    <div
                                      key={row.key}
                                      className="import-shell__totals-row import-shell__totals-row--bucket"
                                    >
                                      {row.perBucket.map((value, index) => {
                                        const point = chartSeries[index];
                                        const columnSelected = selectedBucketKey === point.key;
                                        return (
                                          <button
                                            key={point.key}
                                            type="button"
                                            className={`import-shell__totals-cell import-shell__totals-cell--bucket ${columnSelected ? "import-shell__totals-cell--column" : ""}`}
                                            style={{ flex: `1 0 ${COLUMN_BASIS_BY_RANGE[chartRange]}px` }}
                                            aria-label={`${row.label} ${point.label}: ${currencyFormatter.format(value)}. Filter the table to ${point.label}.`}
                                            onClick={() => toggleBucket(point.key)}
                                          >
                                            {value === 0 ? "—" : currencyFormatter.format(value)}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  );
                                }

                                return (
                                  <div key={row.key} className="import-shell__totals-row">
                                    {row.perBucket.map((value, index) => {
                                      const point = chartSeries[index];
                                      const columnSelected = selectedBucketKey === point.key;
                                      const cellSelected = columnSelected && selectedCategory === row.category;
                                      return (
                                        <button
                                          key={point.key}
                                          type="button"
                                          className={`import-shell__totals-cell ${columnSelected ? "import-shell__totals-cell--column" : ""} ${cellSelected ? "import-shell__totals-cell--selected" : ""}`}
                                          style={{ flex: `1 0 ${COLUMN_BASIS_BY_RANGE[chartRange]}px` }}
                                          aria-label={`Filter the table to ${point.label} ${getCategoryLabel(row.category)}: ${currencyFormatter.format(value)}`}
                                          onClick={() => toggleSegment(point.key, row.category)}
                                        >
                                          {value === 0 ? "—" : currencyFormatter.format(value)}
                                        </button>
                                      );
                                    })}
                                  </div>
                                );
                              })}

                              <div className="import-shell__totals-row import-shell__totals-row--net">
                                {categoryTotals.netPerBucket.map((value, index) => {
                                  const point = chartSeries[index];
                                  const columnSelected = selectedBucketKey === point.key;
                                  return (
                                    <button
                                      key={point.key}
                                      type="button"
                                      className={`import-shell__totals-cell import-shell__totals-cell--net ${columnSelected ? "import-shell__totals-cell--column" : ""}`}
                                      style={{ flex: `1 0 ${COLUMN_BASIS_BY_RANGE[chartRange]}px` }}
                                      aria-label={`Filter the table to ${point.label}: ${currencyFormatter.format(value)}`}
                                      onClick={() => toggleBucket(point.key)}
                                    >
                                      {value === 0 ? "—" : currencyFormatter.format(value)}
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

            <div className="import-shell__master-right">
            {(selectedBucketKey || selectedCategory) && (
              <div className="import-shell__table-filter">
                <span>
                  Filtered to{" "}
                  {selectedBucketKey && <strong>{selectedBucketLabel}</strong>}
                  {selectedBucketKey && selectedCategory && " · "}
                  {selectedCategory && <strong>{getCategoryLabel(selectedCategory)}</strong>}
                </span>
                <button type="button" onClick={clearTableFilter}>
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
                      {SORT_COLUMNS.map((column) => {
                        const activeSort = tableSort && tableSort.key === column.key ? tableSort : null;
                        const ariaSort = activeSort
                          ? activeSort.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none";
                        return (
                          <th key={column.key} aria-sort={ariaSort}>
                            <button
                              type="button"
                              className={`import-shell__sort-button ${activeSort ? "import-shell__sort-button--active" : ""}`}
                              onClick={() => toggleSort(column.key)}
                            >
                              {column.label}
                              <span className="import-shell__sort-caret" aria-hidden="true">
                                {activeSort ? (activeSort.direction === "asc" ? "▲" : "▼") : "↕"}
                              </span>
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTransactions.map((transaction) => (
                      <tr key={transaction.id}>
                        <td>{transaction.date}</td>
                        <td>{transaction.description}</td>
                        <td>{transaction.sourceBank}</td>
                        <td>{transaction.amount.toFixed(2)}</td>
                        <td>
                          <input
                            key={transaction.category}
                            list="category-suggestions"
                            className={`import-shell__category-input ${
                              transaction.category === "unclassified"
                                ? "import-shell__category-input--unclassified"
                                : ""
                            }`}
                            defaultValue={getCategoryLabel(transaction.category)}
                            onBlur={(event) => {
                              const nextCategory = resolveCategoryInput(event.target.value, knownCategories);
                              if (nextCategory !== transaction.category) {
                                handleCategoryChange(transaction.id, nextCategory);
                              }
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.currentTarget.blur();
                              }
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            </div>
            </div>

            <datalist id="category-suggestions">
              {[...categoryList, ...RESERVED_CATEGORIES].map((category) => (
                <option key={category} value={getCategoryLabel(category)} />
              ))}
            </datalist>
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
                  style={{ background: getCategoryColor(segment.category) }}
                />
                <strong>{currencyFormatter.format(segment.value)}</strong>
                <span>{getCategoryLabel(segment.category)}</span>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

export default ImportAppShell;
