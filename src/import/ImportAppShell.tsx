import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ImportedTransaction } from "./csvParser";
import BankReportUpload, { type UploadedFileView } from "./BankReportUpload";
import BucketsAndCategories from "./BucketsAndCategories";
import Modal from "./Modal";
import { buildBankSeries, buildChartSeries, parseDate, resolveBucketKey, type ChartRange } from "./transactionSummary";
import { computeDivergingScale } from "./chartScale";
import {
  BUCKET_COLOR_PALETTE,
  DEFAULT_CATEGORIES,
  RESERVED_CATEGORIES,
  applyCategoryRecords,
  deriveCategoryList,
  generateCategoryId,
  getCategoryColor,
  getCategoryLabel,
  isReservedCategory,
  nextBucketColor,
  resolveCategoryInput,
  UNGROUPED_BUCKET_COLOR,
  UNGROUPED_BUCKET_ID,
  type Category,
  type CategoryRecord,
  type BucketRecord,
} from "./categories";
import "./BankImportPage.css";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

// Whole-dollar currency (no cents) for the chart's bar totals and the spending totals table.
const wholeCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

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
type BucketSegment = {
  bucketId: string;
  label: string;
  color: string;
  value: number;
};

type BucketChartPoint = {
  key: string;
  label: string;
  segments: BucketSegment[];
};

type BucketMeta = { id: string; name: string; color: string };

// The chart can stack spending by bucket (categories rolled into buckets) or by the bank
// each transaction was imported from.
type GroupMode = "bucket" | "bank";

type TooltipAnchor = {
  point: BucketChartPoint;
  x: number;
  y: number;
};

type ViewMode = "uploads" | "master";

// Each bucket's section renders its categories as line items, then the bucket total at the
// bottom. `perColumn` holds the value for each time column in the chart. `color` is the
// bucket's color (shared across the whole section); `sectionStart` marks the first line item.
type TotalsDisplayRow =
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
    };

type SortKey = "date" | "description" | "bank" | "amount" | "category";
type SortDirection = "asc" | "desc";
type SortState = { key: SortKey; direction: SortDirection };

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "description", label: "Description" },
  { key: "bank", label: "Bank" },
  { key: "category", label: "Category" },
  { key: "amount", label: "Amount" },
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
  const [groupMode, setGroupMode] = useState<GroupMode>("bucket");
  const [tooltipAnchor, setTooltipAnchor] = useState<TooltipAnchor | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [dbError, setDbError] = useState<string | null>(null);
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedBucketId, setSelectedBucketId] = useState<string | null>(null);
  const [tableSort, setTableSort] = useState<SortState | null>(null);
  const [categoryRecords, setCategoryRecords] = useState<CategoryRecord[]>([]);
  const [buckets, setBuckets] = useState<BucketRecord[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

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

  // Ordered list of spending buckets that can appear (real buckets by name, then "Ungrouped"),
  // each with its color. Shared by both the chart segments and the totals section so they stay
  // in the same order and share the same colors.
  const bucketMeta = useMemo<BucketMeta[]>(() => {
    const metas: BucketMeta[] = buckets
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((bucket) => ({ id: bucket.id, name: bucket.name, color: bucket.color }));
    metas.push({ id: UNGROUPED_BUCKET_ID, name: "Ungrouped", color: UNGROUPED_BUCKET_COLOR });
    return metas;
  }, [buckets]);

  // Map a category to the id of the bucket it displays under (a real bucket, or "Ungrouped").
  const resolveDisplayBucketId = useMemo(() => {
    const bucketIdByCategory = new Map(categoryRecords.map((record) => [record.id, record.bucketId]));
    const realBucketIds = new Set(buckets.map((bucket) => bucket.id));
    return (category: string) => {
      const raw = bucketIdByCategory.get(category) ?? null;
      return raw && realBucketIds.has(raw) ? raw : UNGROUPED_BUCKET_ID;
    };
  }, [categoryRecords, buckets]);

  // Re-stack the per-category chart series into per-bucket segments.
  const bucketSeries = useMemo<BucketChartPoint[]>(() => {
    const metaById = new Map(bucketMeta.map((meta) => [meta.id, meta]));
    const order = new Map(bucketMeta.map((meta, index) => [meta.id, index]));

    return chartSeries.map((point) => {
      const totals = new Map<string, number>();
      point.segments.forEach((segment) => {
        const bucketId = resolveDisplayBucketId(segment.category);
        totals.set(bucketId, (totals.get(bucketId) ?? 0) + segment.value);
      });

      const segments: BucketSegment[] = Array.from(totals.entries())
        .map(([bucketId, value]) => {
          const meta = metaById.get(bucketId)!;
          return { bucketId, label: meta.name, color: meta.color, value: Number(value.toFixed(2)) };
        })
        .filter((segment) => segment.value !== 0)
        .sort((a, b) => (order.get(a.bucketId) ?? 0) - (order.get(b.bucketId) ?? 0));

      return { key: point.key, label: point.label, segments };
    });
  }, [chartSeries, bucketMeta, resolveDisplayBucketId]);

  // Banks that appear in the data, in a stable name order, each with a palette color.
  const bankMeta = useMemo<BucketMeta[]>(() => {
    const names = Array.from(new Set(masterTransactions.map((transaction) => transaction.sourceBank).filter(Boolean)));
    names.sort((a, b) => a.localeCompare(b));
    return names.map((name, index) => ({
      id: name,
      name,
      color: BUCKET_COLOR_PALETTE[index % BUCKET_COLOR_PALETTE.length],
    }));
  }, [masterTransactions]);

  // Per-bank stacked segments, reusing the same shape (and rendering) as the bucket series.
  const bankSeries = useMemo<BucketChartPoint[]>(() => {
    const metaById = new Map(bankMeta.map((meta) => [meta.id, meta]));
    return buildBankSeries(
      chartTransactions,
      chartRange,
      bankMeta.map((meta) => meta.id),
    ).map((point) => ({
      key: point.key,
      label: point.label,
      segments: point.segments
        .map((segment) => {
          const meta = metaById.get(segment.category)!;
          return { bucketId: meta.id, label: meta.name, color: meta.color, value: segment.value };
        })
        .filter((segment) => segment.value !== 0),
    }));
  }, [chartTransactions, chartRange, bankMeta]);

  const activeSeries = groupMode === "bank" ? bankSeries : bucketSeries;

  const chartScale = useMemo(
    () =>
      computeDivergingScale(
        activeSeries.map((point) => {
          const positiveTotal = point.segments
            .filter((segment) => segment.value > 0)
            .reduce((sum, segment) => sum + segment.value, 0);
          const negativeTotal = point.segments
            .filter((segment) => segment.value < 0)
            .reduce((sum, segment) => sum + Math.abs(segment.value), 0);
          return { positiveTotal, negativeTotal };
        }),
      ),
    [activeSeries],
  );

  const selectedBucketLabel = useMemo(
    () => chartSeries.find((point) => point.key === selectedBucketKey)?.label ?? selectedBucketKey,
    [chartSeries, selectedBucketKey],
  );

  const selectedBucketName = useMemo(
    () => (groupMode === "bank" ? bankMeta : bucketMeta).find((meta) => meta.id === selectedBucketId)?.name ?? null,
    [groupMode, bankMeta, bucketMeta, selectedBucketId],
  );

  const categoryTotals = useMemo(() => {
    const activeRows = categoryList
      .filter((category) => selectedCategories.includes(category) && !excludedCategories.has(category))
      .map((category) => {
        const perColumn = chartSeries.map((point) => {
          const segment = point.segments.find((item) => item.category === category);
          return segment ? segment.value : 0;
        });
        return { category, perColumn };
      })
      .filter((row) => row.perColumn.some((value) => value !== 0));

    const columnCount = chartSeries.length;
    const sumRows = (rows: { perColumn: number[] }[]) =>
      rows.reduce(
        (totals, row) => totals.map((value, index) => value + row.perColumn[index]),
        new Array<number>(columnCount).fill(0),
      );
    const byLabel = (a: { category: string }, b: { category: string }) =>
      getCategoryLabel(a.category).localeCompare(getCategoryLabel(b.category));

    // Group active categories under their display bucket (real bucket, or "Ungrouped").
    const grouped = new Map<string, { category: string; perColumn: number[] }[]>();
    activeRows.forEach((row) => {
      const bucketId = resolveDisplayBucketId(row.category);
      const members = grouped.get(bucketId) ?? [];
      members.push(row);
      grouped.set(bucketId, members);
    });

    // Emit each section in bucketMeta order: category line items first, bucket total last.
    const displayRows: TotalsDisplayRow[] = [];
    bucketMeta.forEach((meta) => {
      const members = grouped.get(meta.id);
      if (!members || members.length === 0) {
        return;
      }
      members
        .slice()
        .sort(byLabel)
        .forEach((row, index) => {
          displayRows.push({
            kind: "category",
            key: `${meta.id}:${row.category}`,
            category: row.category,
            perColumn: row.perColumn,
            color: meta.color,
            sectionStart: index === 0,
          });
        });
      displayRows.push({
        kind: "bucketTotal",
        key: `bucketTotal:${meta.id}`,
        bucketId: meta.id,
        label: meta.name,
        perColumn: sumRows(members),
        color: meta.color,
      });
    });

    const netPerColumn = chartSeries.map((point) =>
      point.segments.reduce((sum, segment) => sum + segment.value, 0),
    );

    return { displayRows, netPerColumn };
  }, [categoryList, selectedCategories, excludedCategories, chartSeries, bucketMeta, resolveDisplayBucketId]);

  // In bank mode the totals section lists one bold row per bank (no category line items).
  const bankTotals = useMemo(() => {
    const displayRows: TotalsDisplayRow[] = bankMeta
      .map((meta) => ({
        meta,
        perColumn: bankSeries.map((point) => point.segments.find((segment) => segment.bucketId === meta.id)?.value ?? 0),
      }))
      .filter((row) => row.perColumn.some((value) => value !== 0))
      .map((row) => ({
        kind: "bucketTotal" as const,
        key: `bank:${row.meta.id}`,
        bucketId: row.meta.id,
        label: row.meta.name,
        perColumn: row.perColumn,
        color: row.meta.color,
      }));

    const netPerColumn = bankSeries.map((point) =>
      point.segments.reduce((sum, segment) => sum + segment.value, 0),
    );

    return { displayRows, netPerColumn };
  }, [bankMeta, bankSeries]);

  const activeTotals = groupMode === "bank" ? bankTotals : categoryTotals;

  const tableTransactions = useMemo(() => {
    if (!selectedBucketKey && !selectedCategory && !selectedBucketId) {
      return masterTransactions;
    }

    return chartTransactions.filter((transaction) => {
      const timeMatches =
        !selectedBucketKey || resolveBucketKey(transaction.date, chartRange) === selectedBucketKey;
      const categoryMatches = !selectedCategory || transaction.category === selectedCategory;
      const bucketMatches =
        !selectedBucketId ||
        (groupMode === "bank"
          ? transaction.sourceBank === selectedBucketId
          : resolveDisplayBucketId(transaction.category) === selectedBucketId);
      return timeMatches && categoryMatches && bucketMatches;
    });
  }, [
    selectedBucketKey,
    selectedCategory,
    selectedBucketId,
    chartTransactions,
    masterTransactions,
    chartRange,
    groupMode,
    resolveDisplayBucketId,
  ]);

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

  const tableTotal = useMemo(
    () => sortedTransactions.reduce((sum, transaction) => sum + transaction.amount, 0),
    [sortedTransactions],
  );

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
    setSelectedBucketId(null);
  };

  // Bucket and bank selections use different id spaces, so clear any active filter on switch.
  const handleGroupModeChange = (mode: GroupMode) => {
    setGroupMode(mode);
    setSelectedBucketKey(null);
    setSelectedCategory(null);
    setSelectedBucketId(null);
  };

  const clearTableFilter = () => {
    setSelectedBucketKey(null);
    setSelectedCategory(null);
    setSelectedBucketId(null);
  };

  // Clicking a whole bar column filters the table to that time period.
  const toggleBucket = (key: string) => {
    setSelectedBucketKey((current) => (current === key ? null : key));
    setSelectedCategory(null);
    setSelectedBucketId(null);
  };

  // Clicking a category's value cell filters to that time period + category.
  const toggleSegment = (key: string, category: string) => {
    const alreadySelected = selectedBucketKey === key && selectedCategory === category;
    setSelectedBucketKey(alreadySelected ? null : key);
    setSelectedCategory(alreadySelected ? null : category);
    setSelectedBucketId(null);
  };

  // Clicking a bar's bucket segment (or a bucket-total cell) filters to that time period + bucket.
  const toggleBucketSegment = (key: string, bucketId: string) => {
    const alreadySelected = selectedBucketKey === key && selectedBucketId === bucketId;
    setSelectedBucketKey(alreadySelected ? null : key);
    setSelectedBucketId(alreadySelected ? null : bucketId);
    setSelectedCategory(null);
  };

  // Clicking a category label filters to that category across all time.
  const toggleCategoryFilter = (category: string) => {
    const alreadySelected = selectedCategory === category && !selectedBucketKey;
    setSelectedBucketKey(null);
    setSelectedBucketId(null);
    setSelectedCategory(alreadySelected ? null : category);
  };

  // Clicking a bucket label filters to that whole bucket across all time.
  const toggleBucketFilter = (bucketId: string) => {
    const alreadySelected = selectedBucketId === bucketId && !selectedBucketKey;
    setSelectedBucketKey(null);
    setSelectedCategory(null);
    setSelectedBucketId(alreadySelected ? null : bucketId);
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
      // The DB fills imported_at via its default; mirror it here for the optimistic row.
      importedAt: new Date().toISOString(),
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

  const handleRenameUpload = (uploadId: string, fileName: string) => {
    const previousUploads = uploads;
    setUploads((current) =>
      current.map((upload) => (upload.id === uploadId ? { ...upload, fileName } : upload)),
    );

    invoke("rename_upload", { id: uploadId, fileName }).catch((error) => {
      console.error("Failed to rename the upload in the database", error);
      setDbError("Couldn't save that file name change to the database.");
      setUploads(previousUploads);
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
    const color = nextBucketColor(buckets.length);
    setBuckets((current) => [...current, { id, name, color }]);

    invoke("upsert_bucket", { id, name, color }).catch((error) => {
      console.error("Failed to save the new bucket to the database", error);
      setDbError("Couldn't save that bucket to the database.");
      setBuckets(previousBuckets);
    });
  };

  const handleRenameBucket = (id: string, name: string) => {
    const previousBuckets = buckets;
    const color = buckets.find((bucket) => bucket.id === id)?.color ?? nextBucketColor(buckets.length);
    setBuckets((current) => current.map((bucket) => (bucket.id === id ? { ...bucket, name } : bucket)));

    invoke("upsert_bucket", { id, name, color }).catch((error) => {
      console.error("Failed to rename the bucket in the database", error);
      setDbError("Couldn't save that bucket to the database.");
      setBuckets(previousBuckets);
    });
  };

  const handleSetBucketColor = (id: string, color: string) => {
    const previousBuckets = buckets;
    const name = buckets.find((bucket) => bucket.id === id)?.name;
    if (name === undefined) {
      return;
    }
    setBuckets((current) => current.map((bucket) => (bucket.id === id ? { ...bucket, color } : bucket)));

    invoke("upsert_bucket", { id, name, color }).catch((error) => {
      console.error("Failed to save the bucket color to the database", error);
      setDbError("Couldn't save that bucket change to the database.");
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

  // A category lives in one place: a bucket, the Ungrouped tray (bucketId null), or the
  // Exclude tray (excluded true, left out of the spending chart/totals). Bucket and excluded
  // are mutually exclusive, so both are written together.
  const handlePlaceCategory = (categoryId: string, bucketId: string | null, excluded: boolean) => {
    const previousRecords = categoryRecords;
    const existing = categoryRecords.find((record) => record.id === categoryId);
    const label = existing?.label ?? getCategoryLabel(categoryId);
    const color = existing?.color ?? getCategoryColor(categoryId);

    setCategoryRecords((current) =>
      current.some((record) => record.id === categoryId)
        ? current.map((record) => (record.id === categoryId ? { ...record, bucketId, excluded } : record))
        : [...current, { id: categoryId, label, color, excluded, bucketId }],
    );

    invoke("set_category_placement", { id: categoryId, label, color, excluded, bucketId }).catch((error) => {
      console.error("Failed to save the category placement to the database", error);
      setDbError("Couldn't save that category change to the database.");
      setCategoryRecords(previousRecords);
    });
  };

  // Shared by the Uploads-page panel and the Spending-page settings modal.
  const bucketsAndCategoriesProps = {
    categories: categoryRecords,
    buckets,
    onAdd: handleAddCategory,
    onUpdate: handleUpdateCategory,
    onDelete: handleDeleteCategory,
    onAddBucket: handleAddBucket,
    onRenameBucket: handleRenameBucket,
    onSetBucketColor: handleSetBucketColor,
    onDeleteBucket: handleDeleteBucket,
    onPlaceCategory: handlePlaceCategory,
  };

  // Shared by the Uploads-page panel and the Spending-page upload modal.
  const bankReportUploadProps = {
    uploads,
    knownCategories,
    onImport: persistUpload,
    onDeleteUpload: handleDeleteUpload,
    onRenameUpload: handleRenameUpload,
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
            Spending
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

            <div className="import-shell__secondary-row">
              <BankReportUpload {...bankReportUploadProps} />

              <BucketsAndCategories {...bucketsAndCategoriesProps} />
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
                  <button
                    type="button"
                    className="import-shell__upload-button"
                    onClick={() => setUploadOpen(true)}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="15"
                      height="15"
                      aria-hidden="true"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    Upload
                  </button>

                  <button
                    type="button"
                    className="import-shell__settings-button"
                    aria-label="Open buckets and categories settings"
                    title="Buckets & categories"
                    onClick={() => setSettingsOpen(true)}
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
                          <div
                            className="import-shell__group-toggle"
                            role="group"
                            aria-label="Group spending by"
                          >
                            {(["bucket", "bank"] as GroupMode[]).map((mode) => (
                              <button
                                key={mode}
                                type="button"
                                className={`group-pill ${groupMode === mode ? "group-pill--active" : ""}`}
                                aria-pressed={groupMode === mode}
                                onClick={() => handleGroupModeChange(mode)}
                              >
                                {mode === "bucket" ? "Buckets" : "Banks"}
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
                                onClick={() => handleRangeChange(range)}
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
                                      rowSelected ? "import-shell__totals-label--selected" : ""
                                    }`}
                                    style={{ "--bucket": row.color } as CSSProperties}
                                    title={`Filter the table to ${row.label}`}
                                    aria-pressed={rowSelected}
                                    onClick={() => toggleBucketFilter(row.bucketId)}
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
                                  onClick={() => toggleCategoryFilter(row.category)}
                                >
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
                                            toggleBucketSegment(point.key, segment.bucketId);
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
                                      className="import-shell__totals-row import-shell__totals-row--bucket"
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
                                            onClick={() => toggleBucketSegment(point.key, row.bucketId)}
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
                                          onClick={() => toggleSegment(point.key, row.category)}
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
                                      onClick={() => toggleBucket(point.key)}
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

            <div className="import-shell__master-right">
            {(selectedBucketKey || selectedCategory || selectedBucketId) && (
              <div className="import-shell__table-filter">
                <span>
                  Filtered to{" "}
                  {selectedBucketKey && <strong>{selectedBucketLabel}</strong>}
                  {selectedBucketKey && (selectedCategory || selectedBucketId) && " · "}
                  {selectedCategory && <strong>{getCategoryLabel(selectedCategory)}</strong>}
                  {selectedBucketId && selectedBucketName && <strong>{selectedBucketName}</strong>}
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
                          <th
                            key={column.key}
                            aria-sort={ariaSort}
                            className={column.key === "amount" ? "import-shell__cell--amount" : undefined}
                          >
                            <button
                              type="button"
                              className={`import-shell__sort-button ${activeSort ? "import-shell__sort-button--active" : ""}`}
                              onClick={() => toggleSort(column.key)}
                            >
                              {column.label}
                              <span className="import-shell__sort-caret" aria-hidden="true">
                                {activeSort ? (activeSort.direction === "asc" ? "↑" : "↓") : "↓"}
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
                        <td className="import-shell__cell--amount">
                          {currencyFormatter.format(transaction.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="import-shell__table-total-row">
                      <td colSpan={SORT_COLUMNS.length - 1}>Total</td>
                      <td className="import-shell__cell--amount">{currencyFormatter.format(tableTotal)}</td>
                    </tr>
                  </tfoot>
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
              <div key={segment.bucketId} className="import-shell__tooltip-row">
                <span className="import-shell__tooltip-key" style={{ background: segment.color }} />
                <strong>{currencyFormatter.format(segment.value)}</strong>
                <span>{segment.label}</span>
              </div>
            ))}
          </div>,
          document.body,
        )}

      {settingsOpen && (
        <Modal label="Buckets and categories" onClose={() => setSettingsOpen(false)}>
          <BucketsAndCategories {...bucketsAndCategoriesProps} />
        </Modal>
      )}

      {uploadOpen && (
        <Modal label="Upload bank report" onClose={() => setUploadOpen(false)}>
          <BankReportUpload {...bankReportUploadProps} />
        </Modal>
      )}
    </>
  );
}

export default ImportAppShell;
