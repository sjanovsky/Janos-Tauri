import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import SpendingChart, {
  type BucketChartPoint,
  type BucketMeta,
  type GroupMode,
  type TotalsDisplayRow,
} from "../spending/SpendingChart";
import TransactionList, {
  type SortKey,
  type SortState,
} from "../spending/TransactionList";
import type { UploadedFileView } from "../upload/lib/uploads";
import type { ImportedTransaction } from "../upload/lib/csvParser";
import type { BankRecord } from "../spending/lib/banks";
import { computeDivergingScale } from "../spending/lib/chartScale";
import {
  BUCKET_COLOR_PALETTE,
  INCOME_BUCKET_ID,
  UNCLASSIFIED_CATEGORY,
  applyCategoryRecords,
  generateCategoryId,
  getCategoryLabel,
  type CategoryRecord,
} from "../spending/lib/categories";
import {
  buildChartSeries,
  parseDate,
  resolveBucketKey,
  type ChartRange,
} from "../spending/lib/transactionSummary";
import {
  UNGROUPED_ITEMS_BUCKET_ID,
  bucketSegmentId,
  buildGrossBreakdown,
  checkDeposits,
  itemSegmentId,
  moveBucket,
  moveItem,
  netSegmentId,
  resolveVersion,
  toIncomeTransactions,
  type PaycheckBucketRecord,
  type PaycheckItemRecord,
  type PaycheckRecord,
  type PaycheckVersionRecord,
  type PaychecksData,
} from "./lib/income";
import IncomeSettingsModal from "./IncomeSettingsModal";
import PaychecksTab from "./PaychecksTab";

const DB_ERROR =
  "Couldn't reach the local database. Make sure the app is running via `npm run tauri dev`.";

// "gross" splits each deposit into net pay plus its withheld line items; "bucket" shows one bar
// segment per paycheck (and per plain income category) at the paycheck's gross amount.
const GROUP_OPTIONS = [
  { mode: "gross" as GroupMode, label: "Gross breakdown" },
  { mode: "bucket" as GroupMode, label: "By paycheck" },
];

// In the Gross breakdown, all paychecks' net pay rolls up into one bucket, with each paycheck as
// a line item under it (like categories in a spending bucket).
const PAYCHECKS_NET_BUCKET_ID = "net:__paychecks";
const PAYCHECKS_BUCKET_COLOR = "#4f46e5";

function sortValue(
  transaction: ImportedTransaction,
  key: SortKey,
): string | number {
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

// The Income page. "Income by Month" is the Spending page's layout (chart and totals table on
// the left, the transactions behind them on the right) for deposits filed under the Income
// bucket's categories; each paycheck is one of those categories, and the Gross breakdown view
// splits its deposits into net pay plus the paycheck's bucketed line items (taxes, 401K, ...).
// "Paychecks" is where the paycheck templates are entered.
type IncomePageProps = {
  // "income" is income by month (chart and transactions); "paychecks" is the paychecks grid with
  // the transactions of the paycheck you click.
  view?: "income" | "paychecks";
};

function IncomePage({ view = "income" }: IncomePageProps) {
  const [uploads, setUploads] = useState<UploadedFileView[]>([]);
  const [categoryRecords, setCategoryRecords] = useState<CategoryRecord[]>([]);
  const [bankRecords, setBankRecords] = useState<BankRecord[]>([]);
  const [paychecks, setPaychecks] = useState<PaycheckRecord[]>([]);
  const [paycheckBuckets, setPaycheckBuckets] = useState<
    PaycheckBucketRecord[]
  >([]);
  const [paycheckItems, setPaycheckItems] = useState<PaycheckItemRecord[]>([]);
  const tab = view === "paychecks" ? "paychecks" : "monthly";
  // The paycheck whose deposits the Paychecks page lists; null lists every paycheck deposit.
  const [selectedPaycheckId, setSelectedPaycheckId] = useState<string | null>(
    null,
  );
  const [dbError, setDbError] = useState<string | null>(null);
  const [chartRange, setChartRange] = useState<ChartRange>("month");
  const [groupMode, setGroupMode] = useState<GroupMode>("gross");
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(
    null,
  );
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedBucketId, setSelectedBucketId] = useState<string | null>(null);
  const [tableSort, setTableSort] = useState<SortState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const fail = (what: string) => (error: unknown) => {
      console.error(`Failed to load ${what} from the database`, error);
      setDbError(DB_ERROR);
    };
    // Paycheck deposit names classify transactions as they're uploaded; nothing is re-filed here.
    invoke<UploadedFileView[]>("list_uploads")
      .then(setUploads)
      .catch(fail("uploads"));
    invoke<CategoryRecord[]>("list_categories")
      .then(setCategoryRecords)
      .catch(fail("categories"));
    invoke<BankRecord[]>("list_banks")
      .then(setBankRecords)
      .catch(fail("banks"));
    invoke<PaychecksData>("get_paychecks_data")
      .then((data) => {
        setPaychecks(data.paychecks);
        setPaycheckBuckets(data.buckets);
        setPaycheckItems(data.items);
      })
      .catch(fail("paychecks"));
  }, []);

  // The Gross breakdown's table lists paycheck line items by their segment id; give those ids a
  // label and color (the bucket's) in the shared lookups the totals table reads.
  const bucketColorById = useMemo(
    () =>
      new Map(
        paycheckBuckets.map((bucket) => [bucket.id, bucket.color] as const),
      ),
    [paycheckBuckets],
  );
  const itemRecords = useMemo<CategoryRecord[]>(
    () =>
      paycheckItems.map((item) => ({
        id: itemSegmentId(item.id),
        label: item.label,
        color:
          (item.bucketId && bucketColorById.get(item.bucketId)) || "#94a3b8",
        excluded: false,
        bucketId: null,
        position: item.position,
      })),
    [paycheckItems, bucketColorById],
  );
  // Gross breakdown lists each paycheck's net pay under `net:<id>`; label it with the paycheck.
  const netRecords = useMemo<CategoryRecord[]>(
    () =>
      categoryRecords.map((record) => ({
        ...record,
        id: netSegmentId(record.id),
      })),
    [categoryRecords],
  );
  useMemo(
    () =>
      applyCategoryRecords([...categoryRecords, ...itemRecords, ...netRecords]),
    [categoryRecords, itemRecords, netRecords],
  );

  const incomeCategories = useMemo(
    () =>
      categoryRecords
        .filter((record) => record.bucketId === INCOME_BUCKET_ID)
        .sort(
          (a, b) => a.position - b.position || a.label.localeCompare(b.label),
        ),
    [categoryRecords],
  );
  const incomeCategoryIds = useMemo(
    () => new Set(incomeCategories.map((record) => record.id)),
    [incomeCategories],
  );
  const paychecksById = useMemo(
    () => new Map(paychecks.map((paycheck) => [paycheck.id, paycheck])),
    [paychecks],
  );
  // Paychecks are managed on the Paychecks tab; the gear manages the other income categories.
  const plainCategories = useMemo(
    () => incomeCategories.filter((record) => !paychecksById.has(record.id)),
    [incomeCategories, paychecksById],
  );

  const allTransactions = useMemo(
    () => uploads.flatMap((upload) => upload.transactions),
    [uploads],
  );
  const transactions = useMemo(
    () => toIncomeTransactions(allTransactions, incomeCategoryIds, bankRecords),
    [allTransactions, incomeCategoryIds, bankRecords],
  );

  // Each income category (paychecks included) is one stack segment and one totals row.
  const categoryMeta = useMemo<BucketMeta[]>(
    () =>
      incomeCategories.map((record) => ({
        id: record.id,
        name: record.label,
        color: record.color,
      })),
    [incomeCategories],
  );
  const categoryOrder = useMemo(
    () => categoryMeta.map((meta) => meta.id),
    [categoryMeta],
  );

  // By paycheck: each paycheck deposit at its gross (the deposit plus what was withheld from it).
  const grossTransactions = useMemo(
    () =>
      transactions.map((transaction) => {
        const paycheck = paychecksById.get(transaction.category);
        if (!paycheck) {
          return transaction;
        }
        const version = resolveVersion(paycheck, transaction);
        const withheld = (version?.values ?? []).reduce(
          (sum, value) => sum + value.amount,
          0,
        );
        return { ...transaction, amount: transaction.amount + withheld };
      }),
    [transactions, paychecksById],
  );
  const chartSeries = useMemo(
    () => buildChartSeries(grossTransactions, chartRange, categoryOrder),
    [grossTransactions, chartRange, categoryOrder],
  );

  const toSeries = (
    points: ReturnType<typeof buildChartSeries>,
    metas: BucketMeta[],
  ): BucketChartPoint[] => {
    const byId = new Map(metas.map((meta) => [meta.id, meta]));
    return points.map((point) => ({
      key: point.key,
      label: point.label,
      segments: point.segments
        .filter((segment) => segment.value !== 0 && byId.has(segment.category))
        .map((segment) => {
          const meta = byId.get(segment.category)!;
          return {
            bucketId: meta.id,
            label: meta.name,
            color: meta.color,
            value: segment.value,
          };
        }),
    }));
  };

  const categorySeries = useMemo(
    () => toSeries(chartSeries, categoryMeta),
    [chartSeries, categoryMeta],
  );

  // --- Gross breakdown: net pay per category, then paycheck line items rolled into buckets ---
  const gross = useMemo(() => {
    const { transactions: split, itemCategories } = buildGrossBreakdown(
      transactions,
      paychecksById,
    );
    const netMeta: BucketMeta[] = categoryMeta.map((meta) => ({
      ...meta,
      id: netSegmentId(meta.id),
    }));
    const isPaycheckNet = (meta: BucketMeta) =>
      paychecksById.has(meta.id.slice("net:".length));
    const paycheckNets = netMeta.filter(isPaycheckNet);
    const plainNets = netMeta.filter((meta) => !isPaycheckNet(meta));

    // Line items in bucket order; anything ungrouped (or in a deleted bucket) goes last.
    const orderedBuckets = [...paycheckBuckets].sort(
      (a, b) => a.position - b.position,
    );
    const known = new Set(orderedBuckets.map((bucket) => bucket.id));
    const sections = [
      ...orderedBuckets.map((bucket) => ({
        id: bucket.id,
        name: bucket.name,
        color: bucket.color,
      })),
      { id: UNGROUPED_ITEMS_BUCKET_ID, name: "Ungrouped", color: "#94a3b8" },
    ].map((section) => ({
      ...section,
      items: paycheckItems
        .filter((item) =>
          section.id === UNGROUPED_ITEMS_BUCKET_ID
            ? !item.bucketId || !known.has(item.bucketId)
            : item.bucketId === section.id,
        )
        .filter((item) => itemCategories.has(item.id))
        .sort((a, b) => a.position - b.position),
    }));

    const itemIds = sections.flatMap((section) =>
      section.items.map((item) => itemSegmentId(item.id)),
    );
    const itemSeries = buildChartSeries(split, chartRange, [
      ...netMeta.map((meta) => meta.id),
      ...itemIds,
    ]);

    // What each segment id filters the transaction table to: the categories that feed it.
    const filters = new Map<string, Set<string>>();
    categoryMeta.forEach((meta) =>
      filters.set(netSegmentId(meta.id), new Set([meta.id])),
    );
    filters.set(
      PAYCHECKS_NET_BUCKET_ID,
      new Set(paycheckNets.map((meta) => meta.id.slice("net:".length))),
    );
    sections.forEach((section) => {
      const all = new Set<string>();
      section.items.forEach((item) => {
        const feeding = itemCategories.get(item.id) ?? new Set<string>();
        filters.set(itemSegmentId(item.id), feeding);
        feeding.forEach((category) => all.add(category));
      });
      filters.set(bucketSegmentId(section.id), all);
    });

    const valueOf = (point: (typeof itemSeries)[number], id: string) =>
      point.segments.find((segment) => segment.category === id)?.value ?? 0;

    const bucketMeta: BucketMeta[] = sections
      .filter((section) => section.items.length > 0)
      .map((section) => ({
        id: bucketSegmentId(section.id),
        name: section.name,
        color: section.color,
      }));
    const itemMeta: BucketMeta[] = sections.flatMap((section) =>
      section.items.map((item) => ({
        id: itemSegmentId(item.id),
        name: item.label,
        color: section.color,
      })),
    );

    // The chart stacks net pay and one segment per bucket; the table lists every line item.
    const series: BucketChartPoint[] = itemSeries.map((point) => {
      const segments: BucketChartPoint["segments"] = [];
      const paycheckNet = paycheckNets.reduce(
        (sum, meta) => sum + valueOf(point, meta.id),
        0,
      );
      if (paycheckNet !== 0) {
        segments.push({
          bucketId: PAYCHECKS_NET_BUCKET_ID,
          label: "Paychecks (net)",
          color: PAYCHECKS_BUCKET_COLOR,
          value: paycheckNet,
        });
      }
      plainNets.forEach((meta) => {
        const value = valueOf(point, meta.id);
        if (value !== 0) {
          segments.push({
            bucketId: meta.id,
            label: meta.name,
            color: meta.color,
            value,
          });
        }
      });
      sections.forEach((section) => {
        const value = section.items.reduce(
          (sum, item) => sum + valueOf(point, itemSegmentId(item.id)),
          0,
        );
        if (value !== 0) {
          segments.push({
            bucketId: bucketSegmentId(section.id),
            label: section.name,
            color: section.color,
            value,
          });
        }
      });
      return { key: point.key, label: point.label, segments };
    });

    const rows: TotalsDisplayRow[] = [];
    const column = (id: string) =>
      itemSeries.map((point) => valueOf(point, id));
    const paycheckNetRows = paycheckNets
      .map((meta) => ({ meta, perColumn: column(meta.id) }))
      .filter((row) => row.perColumn.some((value) => value !== 0));
    paycheckNetRows.forEach((row, index) =>
      rows.push({
        kind: "category",
        key: `income:${row.meta.id}`,
        category: row.meta.id,
        perColumn: row.perColumn,
        color: row.meta.color,
        sectionStart: index === 0,
      }),
    );
    if (paycheckNetRows.length > 0) {
      rows.push({
        kind: "bucketTotal",
        key: PAYCHECKS_NET_BUCKET_ID,
        bucketId: PAYCHECKS_NET_BUCKET_ID,
        label: "Paychecks (net)",
        perColumn: itemSeries.map((_, index) =>
          paycheckNetRows.reduce((sum, row) => sum + row.perColumn[index], 0),
        ),
        color: PAYCHECKS_BUCKET_COLOR,
      });
    }
    plainNets.forEach((meta) => {
      const perColumn = column(meta.id);
      if (perColumn.some((value) => value !== 0)) {
        rows.push({
          kind: "bucketTotal",
          key: `income:${meta.id}`,
          bucketId: meta.id,
          label: meta.name,
          perColumn,
          color: meta.color,
        });
      }
    });
    sections.forEach((section) => {
      const itemRows = section.items
        .map((item) => ({ item, perColumn: column(itemSegmentId(item.id)) }))
        .filter((row) => row.perColumn.some((value) => value !== 0));
      if (itemRows.length === 0) {
        return;
      }
      itemRows.forEach((row, index) =>
        rows.push({
          kind: "category",
          key: `item:${row.item.id}`,
          category: itemSegmentId(row.item.id),
          perColumn: row.perColumn,
          color: section.color,
          sectionStart: index === 0,
        }),
      );
      rows.push({
        kind: "bucketTotal",
        key: `bucket:${section.id}`,
        bucketId: bucketSegmentId(section.id),
        label: section.name,
        perColumn: itemRows.reduce(
          (sum, row) => sum.map((value, index) => value + row.perColumn[index]),
          itemSeries.map(() => 0),
        ),
        color: section.color,
      });
    });

    const groupMeta: BucketMeta[] = [
      {
        id: PAYCHECKS_NET_BUCKET_ID,
        name: "Paychecks (net)",
        color: PAYCHECKS_BUCKET_COLOR,
      },
    ];
    return {
      series,
      rows,
      filters,
      meta: [...groupMeta, ...netMeta, ...bucketMeta, ...itemMeta],
    };
  }, [
    transactions,
    paychecksById,
    categoryMeta,
    paycheckBuckets,
    paycheckItems,
    chartRange,
  ]);

  const activeSeries = groupMode === "gross" ? gross.series : categorySeries;
  const activeMeta = groupMode === "gross" ? gross.meta : categoryMeta;

  const chartScale = useMemo(
    () =>
      computeDivergingScale(
        activeSeries.map((point) => ({
          positiveTotal: point.segments
            .filter((s) => s.value > 0)
            .reduce((sum, s) => sum + s.value, 0),
          negativeTotal: point.segments
            .filter((s) => s.value < 0)
            .reduce((sum, s) => sum + Math.abs(s.value), 0),
        })),
      ),
    [activeSeries],
  );

  // One bold row per category (or bank) across the time columns, and a total row beneath.
  const activeTotals = useMemo(() => {
    const netPerColumn = activeSeries.map((point) =>
      point.segments.reduce((sum, segment) => sum + segment.value, 0),
    );
    if (groupMode === "gross") {
      return { displayRows: gross.rows, netPerColumn };
    }
    const displayRows: TotalsDisplayRow[] = activeMeta
      .map((meta) => ({
        meta,
        perColumn: activeSeries.map(
          (point) =>
            point.segments.find((segment) => segment.bucketId === meta.id)
              ?.value ?? 0,
        ),
      }))
      .filter((row) => row.perColumn.some((value) => value !== 0))
      .map((row) => ({
        kind: "bucketTotal" as const,
        key: `income:${row.meta.id}`,
        bucketId: row.meta.id,
        label: row.meta.name,
        perColumn: row.perColumn,
        color: row.meta.color,
      }));
    return { displayRows, netPerColumn };
  }, [activeMeta, activeSeries, groupMode, gross.rows]);

  // A clicked row or cell is one id: a bank, a category, or (Gross breakdown) a net, bucket or
  // line item segment, which filters to the categories that feed it.
  const activeFilterId = selectedBucketId ?? selectedCategory;
  const activePaycheckId =
    selectedPaycheckId && paychecksById.has(selectedPaycheckId)
      ? selectedPaycheckId
      : null;

  const tableTransactions = useMemo(() => {
    if (tab === "paychecks") {
      return activePaycheckId
        ? transactions.filter(
            (transaction) => transaction.category === activePaycheckId,
          )
        : transactions;
    }
    if (!selectedBucketKey && !activeFilterId) {
      return transactions;
    }
    return transactions.filter((transaction) => {
      const timeMatches =
        !selectedBucketKey ||
        resolveBucketKey(transaction.date, chartRange) === selectedBucketKey;
      const groupMatches =
        !activeFilterId ||
        (groupMode === "gross"
          ? gross.filters.get(activeFilterId)?.has(transaction.category) ===
            true
          : transaction.category === activeFilterId);
      return timeMatches && groupMatches;
    });
  }, [
    tab,
    activePaycheckId,
    transactions,
    selectedBucketKey,
    activeFilterId,
    chartRange,
    groupMode,
    gross.filters,
  ]);

  const sortedTransactions = useMemo(() => {
    // Newest first by default; the user's column sort replaces it.
    const sort: SortState = tableSort ?? { key: "date", direction: "desc" };
    const direction = sort.direction === "asc" ? 1 : -1;
    return [...tableTransactions].sort((a, b) => {
      const aValue = sortValue(a, sort.key);
      const bValue = sortValue(b, sort.key);
      if (typeof aValue === "number" && typeof bValue === "number") {
        return (aValue - bValue) * direction;
      }
      return String(aValue).localeCompare(String(bValue)) * direction;
    });
    // categoryRecords is a dependency because sorting by category uses its (possibly renamed) label.
  }, [tableTransactions, tableSort, categoryRecords]);

  const tableTotal = useMemo(
    () =>
      sortedTransactions.reduce(
        (sum, transaction) => sum + transaction.amount,
        0,
      ),
    [sortedTransactions],
  );

  const selectedBucketLabel = useMemo(
    () =>
      chartSeries.find((point) => point.key === selectedBucketKey)?.label ??
      selectedBucketKey,
    [chartSeries, selectedBucketKey],
  );
  const selectedBucketName = useMemo(
    () => activeMeta.find((meta) => meta.id === activeFilterId)?.name ?? null,
    [activeMeta, activeFilterId],
  );

  const clearTableFilter = () => {
    setSelectedPaycheckId(null);
    setSelectedBucketKey(null);
    setSelectedCategory(null);
    setSelectedBucketId(null);
  };

  const handleRangeChange = (range: ChartRange) => {
    setChartRange(range);
    clearTableFilter();
  };

  const handleGroupModeChange = (mode: GroupMode) => {
    setGroupMode(mode);
    clearTableFilter();
  };

  const toggleSort = (key: SortKey) => {
    setTableSort((current) =>
      current && current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  };

  const toggleBucket = (key: string) => {
    setSelectedBucketKey((current) => (current === key ? null : key));
    setSelectedCategory(null);
    setSelectedBucketId(null);
  };
  const toggleBucketSegment = (key: string, bucketId: string) => {
    const alreadySelected =
      selectedBucketKey === key && selectedBucketId === bucketId;
    setSelectedBucketKey(alreadySelected ? null : key);
    setSelectedCategory(null);
    setSelectedBucketId(alreadySelected ? null : bucketId);
  };
  const toggleBucketFilter = (bucketId: string) => {
    const alreadySelected = selectedBucketId === bucketId && !selectedBucketKey;
    setSelectedBucketKey(null);
    setSelectedCategory(null);
    setSelectedBucketId(alreadySelected ? null : bucketId);
  };
  // Line item rows (Gross breakdown) are "categories" to the chart's totals table.
  const toggleCategoryFilter = (category: string) => {
    const alreadySelected = selectedCategory === category && !selectedBucketKey;
    setSelectedBucketKey(null);
    setSelectedBucketId(null);
    setSelectedCategory(alreadySelected ? null : category);
  };
  const toggleCategorySegment = (key: string, category: string) => {
    const alreadySelected =
      selectedBucketKey === key && selectedCategory === category;
    setSelectedBucketKey(alreadySelected ? null : key);
    setSelectedBucketId(null);
    setSelectedCategory(alreadySelected ? null : category);
  };

  // --- Transactions ---
  const patchCategory = (ids: Set<string>, category: string) =>
    setUploads((current) =>
      current.map((upload) => ({
        ...upload,
        transactions: upload.transactions.map((transaction) =>
          ids.has(transaction.id) ? { ...transaction, category } : transaction,
        ),
      })),
    );

  const handleCategoryChange = (transactionId: string, category: string) => {
    patchCategory(new Set([transactionId]), category);
    invoke("update_transaction_category", { transactionId, category }).catch(
      (error) => {
        console.error("Failed to save category change", error);
        setDbError("Couldn't save that category change to the database.");
      },
    );
  };

  const handleBulkCategoryChange = (
    transactionIds: string[],
    category: string,
  ) => {
    if (transactionIds.length === 0) {
      return;
    }
    patchCategory(new Set(transactionIds), category);
    invoke("update_transaction_categories", { transactionIds, category }).catch(
      (error) => {
        console.error("Failed to save bulk category change", error);
        setDbError("Couldn't save those category changes to the database.");
      },
    );
  };

  const handleBulkFlipSign = (transactionIds: string[]) => {
    if (transactionIds.length === 0) {
      return;
    }
    const idSet = new Set(transactionIds);
    setUploads((current) =>
      current.map((upload) => ({
        ...upload,
        transactions: upload.transactions.map((transaction) =>
          idSet.has(transaction.id) ? { ...transaction, amount: -transaction.amount } : transaction,
        ),
      })),
    );

    invoke("flip_transaction_amounts", { transactionIds }).catch((error) => {
      console.error("Failed to save sign flip", error);
      setDbError("Couldn't save those amount changes to the database.");
    });
  };

  // --- Income categories (spending categories placed in the Income bucket) ---
  const handleAddCategory = (label: string, color: string) => {
    const previous = categoryRecords;
    const id = generateCategoryId(
      label,
      categoryRecords.map((record) => record.id),
    );
    const position = incomeCategories.length;
    setCategoryRecords((current) => [
      ...current,
      {
        id,
        label,
        color,
        excluded: false,
        bucketId: INCOME_BUCKET_ID,
        position,
      },
    ]);

    invoke("set_category_placement", {
      id,
      label,
      color,
      excluded: false,
      bucketId: INCOME_BUCKET_ID,
    })
      .then(() =>
        invoke("set_category_positions", {
          ids: [...incomeCategories.map((r) => r.id), id],
        }),
      )
      .catch((error) => {
        console.error("Failed to save the new income category", error);
        setDbError("Couldn't save that category to the database.");
        setCategoryRecords(previous);
      });
  };

  const handleUpdateCategory = (id: string, label: string, color: string) => {
    const previous = categoryRecords;
    setCategoryRecords((current) =>
      current.map((record) =>
        record.id === id ? { ...record, label, color } : record,
      ),
    );
    invoke("upsert_category", { id, label, color }).catch((error) => {
      console.error("Failed to save the category change", error);
      setDbError("Couldn't save that category change to the database.");
      setCategoryRecords(previous);
    });
  };

  const handleDeleteCategory = (id: string) => {
    const previousRecords = categoryRecords;
    const previousUploads = uploads;
    setCategoryRecords((current) =>
      current.filter((record) => record.id !== id),
    );
    patchCategory(
      new Set(
        allTransactions
          .filter((transaction) => transaction.category === id)
          .map((t) => t.id),
      ),
      UNCLASSIFIED_CATEGORY,
    );
    invoke("delete_category", { id }).catch((error) => {
      console.error("Failed to delete the category", error);
      setDbError("Couldn't delete that category from the database.");
      setCategoryRecords(previousRecords);
      setUploads(previousUploads);
    });
  };

  // --- Paychecks ---
  // Each save applies optimistically and rolls back (with an error banner) if the write fails.
  const failSave = (what: string, rollback: () => void) => (error: unknown) => {
    console.error(`Failed to save ${what}`, error);
    setDbError(`Couldn't save ${what} to the database.`);
    rollback();
  };

  const persistPaycheck = (paycheck: PaycheckRecord) =>
    invoke("upsert_paycheck", {
      id: paycheck.id,
      name: paycheck.name,
      depositPattern: paycheck.depositPattern,
      color: paycheck.color,
    });

  const handleAddPaycheck = (name: string): string => {
    const previousPaychecks = paychecks;
    const previousCategories = categoryRecords;
    const id = crypto.randomUUID();
    const color =
      BUCKET_COLOR_PALETTE[paychecks.length % BUCKET_COLOR_PALETTE.length];
    const paycheck: PaycheckRecord = {
      id,
      name,
      depositPattern: "",
      color,
      position: paychecks.length,
      versions: [
        {
          id: `v-${id}`,
          effectiveFrom: "",
          effectiveTo: "",
          gross: 0,
          transactionId: null,
          values: [],
        },
      ],
    };
    setPaychecks((current) => [...current, paycheck]);
    // The paycheck is its own income category (same id), so its deposits chart and filter as one.
    setCategoryRecords((current) => [
      ...current,
      {
        id,
        label: name,
        color,
        excluded: false,
        bucketId: INCOME_BUCKET_ID,
        position: incomeCategories.length,
      },
    ]);
    persistPaycheck(paycheck).catch(
      failSave("that paycheck", () => {
        setPaychecks(previousPaychecks);
        setCategoryRecords(previousCategories);
      }),
    );
    return id;
  };

  const handleUpdatePaycheck = (
    id: string,
    patch: Partial<Pick<PaycheckRecord, "name" | "depositPattern" | "color">>,
  ) => {
    const current = paychecks.find((paycheck) => paycheck.id === id);
    if (!current) {
      return;
    }
    const previousPaychecks = paychecks;
    const previousCategories = categoryRecords;
    const next = { ...current, ...patch };
    setPaychecks((all) =>
      all.map((paycheck) => (paycheck.id === id ? next : paycheck)),
    );
    setCategoryRecords((all) =>
      all.map((record) =>
        record.id === id
          ? { ...record, label: next.name, color: next.color }
          : record,
      ),
    );
    persistPaycheck(next).catch(
      failSave("that paycheck", () => {
        setPaychecks(previousPaychecks);
        setCategoryRecords(previousCategories);
      }),
    );
  };

  const handleDeletePaycheck = (id: string) => {
    const previousPaychecks = paychecks;
    const previousCategories = categoryRecords;
    const previousUploads = uploads;
    setPaychecks((current) => current.filter((paycheck) => paycheck.id !== id));
    setCategoryRecords((current) =>
      current.filter((record) => record.id !== id),
    );
    patchCategory(
      new Set(
        allTransactions
          .filter((transaction) => transaction.category === id)
          .map((t) => t.id),
      ),
      UNCLASSIFIED_CATEGORY,
    );
    invoke("delete_paycheck", { id }).catch(
      failSave("that change", () => {
        setPaychecks(previousPaychecks);
        setCategoryRecords(previousCategories);
        setUploads(previousUploads);
      }),
    );
  };

  const patchVersion = (
    versionId: string,
    change: (version: PaycheckVersionRecord) => PaycheckVersionRecord,
  ) =>
    setPaychecks((all) =>
      all.map((paycheck) => ({
        ...paycheck,
        versions: paycheck.versions.map((version) =>
          version.id === versionId ? change(version) : version,
        ),
      })),
    );

  const handleSetValue = (
    versionId: string,
    itemId: string,
    amount: number,
  ) => {
    const previous = paychecks;
    patchVersion(versionId, (version) => ({
      ...version,
      values: [
        ...version.values.filter((value) => value.itemId !== itemId),
        { itemId, amount },
      ],
    }));
    invoke("set_paycheck_value", { versionId, itemId, amount }).catch(
      failSave("that amount", () => setPaychecks(previous)),
    );
  };

  const handleUpdateVersion = (
    versionId: string,
    patch: Partial<
      Pick<PaycheckVersionRecord, "effectiveFrom" | "effectiveTo" | "gross">
    >,
  ) => {
    const current = paychecks
      .flatMap((paycheck) => paycheck.versions)
      .find((version) => version.id === versionId);
    if (!current) {
      return;
    }
    const previous = paychecks;
    const next = { ...current, ...patch };
    patchVersion(versionId, () => next);
    invoke("update_paycheck_version", {
      id: versionId,
      effectiveFrom: next.effectiveFrom,
      effectiveTo: next.effectiveTo,
      gross: next.gross,
    }).catch(failSave("that version", () => setPaychecks(previous)));
  };

  // A new version starts as a copy of `copyFrom`. With a transaction id it's a one-off for that
  // deposit. Returns the new version's id so the page can show it.
  const handleAddVersion = (
    paycheckId: string,
    effectiveFrom: string,
    copyFrom: string,
    transactionId: string | null = null,
  ): string => {
    const source = paychecks
      .find((paycheck) => paycheck.id === paycheckId)
      ?.versions.find((version) => version.id === copyFrom);
    const id = crypto.randomUUID();
    const previous = paychecks;
    const version: PaycheckVersionRecord = {
      id,
      effectiveFrom,
      effectiveTo: "",
      gross: source?.gross ?? 0,
      transactionId,
      values: source ? source.values.map((value) => ({ ...value })) : [],
    };
    setPaychecks((all) =>
      all.map((paycheck) =>
        paycheck.id === paycheckId
          ? { ...paycheck, versions: [...paycheck.versions, version] }
          : paycheck,
      ),
    );
    invoke("add_paycheck_version", {
      id,
      paycheckId,
      effectiveFrom,
      copyFrom: source ? source.id : null,
      transactionId,
    }).catch(failSave("that version", () => setPaychecks(previous)));

    // A new dated version ends the one it was copied from, if that one was still open-ended and
    // started earlier: the day before the new one begins.
    if (
      source &&
      !transactionId &&
      source.transactionId === null &&
      source.effectiveTo === "" &&
      source.effectiveFrom < effectiveFrom
    ) {
      const [year, month, day] = effectiveFrom.split("-").map(Number);
      const before = new Date(year, month - 1, day - 1);
      const pad = (value: number) => String(value).padStart(2, "0");
      handleUpdateVersion(source.id, {
        effectiveTo: `${before.getFullYear()}-${pad(before.getMonth() + 1)}-${pad(before.getDate())}`,
      });
    }
    return id;
  };

  const handleDeleteVersion = (versionId: string) => {
    const previous = paychecks;
    setPaychecks((all) =>
      all.map((paycheck) => ({
        ...paycheck,
        versions: paycheck.versions.filter(
          (version) => version.id !== versionId,
        ),
      })),
    );
    invoke("delete_paycheck_version", { id: versionId }).catch(
      failSave("that change", () => setPaychecks(previous)),
    );
  };

  const handleSaveBucket = (
    bucket: Pick<PaycheckBucketRecord, "id" | "name" | "color">,
  ) => {
    const previous = paycheckBuckets;
    setPaycheckBuckets((all) =>
      all.some((item) => item.id === bucket.id)
        ? all.map((item) =>
            item.id === bucket.id ? { ...item, ...bucket } : item,
          )
        : [...all, { ...bucket, position: all.length }],
    );
    invoke("upsert_paycheck_bucket", {
      id: bucket.id,
      name: bucket.name,
      color: bucket.color,
    }).catch(failSave("that bucket", () => setPaycheckBuckets(previous)));
  };

  const handleDeleteBucket = (id: string) => {
    const previousBuckets = paycheckBuckets;
    const previousItems = paycheckItems;
    setPaycheckBuckets((all) => all.filter((bucket) => bucket.id !== id));
    setPaycheckItems((all) =>
      all.map((item) =>
        item.bucketId === id ? { ...item, bucketId: null } : item,
      ),
    );
    invoke("delete_paycheck_bucket", { id }).catch(
      failSave("that change", () => {
        setPaycheckBuckets(previousBuckets);
        setPaycheckItems(previousItems);
      }),
    );
  };

  const handleSaveItem = (
    item: Pick<PaycheckItemRecord, "id" | "label" | "bucketId">,
  ) => {
    const previous = paycheckItems;
    setPaycheckItems((all) =>
      all.some((existing) => existing.id === item.id)
        ? all.map((existing) =>
            existing.id === item.id ? { ...existing, ...item } : existing,
          )
        : [...all, { ...item, position: all.length }],
    );
    invoke("upsert_paycheck_item", {
      id: item.id,
      label: item.label,
      bucketId: item.bucketId,
    }).catch(failSave("that line item", () => setPaycheckItems(previous)));
  };

  const handleDeleteItem = (id: string) => {
    const previousItems = paycheckItems;
    const previousPaychecks = paychecks;
    setPaycheckItems((all) => all.filter((item) => item.id !== id));
    setPaychecks((all) =>
      all.map((paycheck) => ({
        ...paycheck,
        versions: paycheck.versions.map((version) => ({
          ...version,
          values: version.values.filter((value) => value.itemId !== id),
        })),
      })),
    );
    invoke("delete_paycheck_item", { id }).catch(
      failSave("that change", () => {
        setPaycheckItems(previousItems);
        setPaychecks(previousPaychecks);
      }),
    );
  };

  const handleMoveItem = (
    itemId: string,
    bucketId: string | null,
    beforeItemId: string | null,
  ) => {
    const previous = paycheckItems;
    const next = moveItem(paycheckItems, itemId, bucketId, beforeItemId);
    if (next === paycheckItems) {
      return;
    }
    setPaycheckItems(next);
    const layout = [...next]
      .sort((a, b) => a.position - b.position)
      .map((item) => ({ id: item.id, bucketId: item.bucketId }));
    invoke("set_paycheck_item_layout", { layout }).catch(
      failSave("that move", () => setPaycheckItems(previous)),
    );
  };

  const handleMoveBucket = (
    bucketId: string,
    beforeBucketId: string | null,
  ) => {
    const previous = paycheckBuckets;
    const next = moveBucket(paycheckBuckets, bucketId, beforeBucketId);
    if (next === paycheckBuckets) {
      return;
    }
    setPaycheckBuckets(next);
    const ids = [...next]
      .sort((a, b) => a.position - b.position)
      .map((bucket) => bucket.id);
    invoke("set_paycheck_bucket_positions", { ids }).catch(
      failSave("that move", () => setPaycheckBuckets(previous)),
    );
  };

  const categoryOptionsByBucket = useMemo(
    () => [
      {
        bucketLabel: "Paychecks",
        options: incomeCategories
          .filter((record) => paychecksById.has(record.id))
          .map((record) => ({ value: record.id, label: record.label })),
      },
      {
        bucketLabel: "Income",
        options: plainCategories.map((record) => ({
          value: record.id,
          label: record.label,
        })),
      },
      {
        bucketLabel: "Remove from income",
        options: [{ value: UNCLASSIFIED_CATEGORY, label: "Unclassified" }],
      },
    ],
    [incomeCategories, plainCategories, paychecksById],
  );
  const bucketColorByCategory = useMemo(
    () =>
      Object.fromEntries(
        incomeCategories.map((record) => [record.id, record.color]),
      ),
    [incomeCategories],
  );
  const noExcludedCategories = useMemo(() => new Set<string>(), []);

  // Every paycheck deposit against the net of the paycheck version in effect on its date.
  const depositCheck = useMemo(
    () => checkDeposits(paychecks, paycheckItems, transactions),
    [paychecks, paycheckItems, transactions],
  );

  return (
    <>
      {dbError && <div className="import-shell__db-error">{dbError}</div>}

      <section className="import-shell__panel">
        <div className="import-shell__master-layout">
          {tab === "monthly" && (
            <SpendingChart
              title="Income"
              bucketLabel="Categories"
              settingsLabel="Income categories"
              groupOptions={GROUP_OPTIONS}
              netLabel="Gross"
              hasTransactions={transactions.length > 0}
              selectedCategories={categoryOrder}
              chartRange={chartRange}
              groupMode={groupMode}
              activeSeries={activeSeries}
              chartScale={chartScale}
              activeTotals={activeTotals}
              selectedBucketKey={selectedBucketKey}
              selectedCategory={selectedCategory}
              selectedBucketId={selectedBucketId}
              onRangeChange={handleRangeChange}
              onGroupModeChange={handleGroupModeChange}
              onToggleBucket={toggleBucket}
              onToggleSegment={toggleCategorySegment}
              onToggleBucketSegment={toggleBucketSegment}
              onToggleCategoryFilter={toggleCategoryFilter}
              onToggleBucketFilter={toggleBucketFilter}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          )}

          {tab === "paychecks" && (
            <PaychecksTab
              paychecks={paychecks}
              buckets={paycheckBuckets}
              items={paycheckItems}
              deposits={transactions}
              check={depositCheck}
              selectedPaycheckId={activePaycheckId}
              onSelectPaycheck={setSelectedPaycheckId}
              onAddPaycheck={handleAddPaycheck}
              onUpdatePaycheck={handleUpdatePaycheck}
              onDeletePaycheck={handleDeletePaycheck}
              onSetValue={handleSetValue}
              onUpdateVersion={handleUpdateVersion}
              onAddVersion={handleAddVersion}
              onDeleteVersion={handleDeleteVersion}
              onSaveBucket={handleSaveBucket}
              onDeleteBucket={handleDeleteBucket}
              onSaveItem={handleSaveItem}
              onDeleteItem={handleDeleteItem}
              onMoveItem={handleMoveItem}
              onMoveBucket={handleMoveBucket}
            />
          )}

          <TransactionList
            transactions={sortedTransactions}
            total={tableTotal}
            hasAnyTransactions={transactions.length > 0}
            selectedBucketKey={tab === "paychecks" ? null : selectedBucketKey}
            selectedCategory={
              tab === "paychecks" ? activePaycheckId : selectedCategory
            }
            selectedBucketId={tab === "paychecks" ? null : selectedBucketId}
            selectedBucketLabel={selectedBucketLabel}
            selectedBucketName={selectedBucketName}
            filterBelowTools={tab === "paychecks"}
            onClearFilter={clearTableFilter}
            sort={tableSort}
            onToggleSort={toggleSort}
            categoryList={[...categoryOrder, UNCLASSIFIED_CATEGORY]}
            excludedCategoryIds={noExcludedCategories}
            bucketColorByCategory={bucketColorByCategory}
            categoryOptionsByBucket={categoryOptionsByBucket}
            bankRecords={bankRecords}
            onCategoryChange={handleCategoryChange}
            onBulkCategoryChange={handleBulkCategoryChange}
            onBulkFlipSign={handleBulkFlipSign}
          />
        </div>
      </section>

      {settingsOpen && (
        <IncomeSettingsModal
          categories={plainCategories}
          onClose={() => setSettingsOpen(false)}
          onAddCategory={handleAddCategory}
          onUpdateCategory={handleUpdateCategory}
          onDeleteCategory={handleDeleteCategory}
        />
      )}
    </>
  );
}

export default IncomePage;
