import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { UploadedFileView } from "../upload/lib/uploads";
import SpendingChart, {
  type BucketChartPoint,
  type BucketMeta,
  type BucketSegment,
  type GroupMode,
  type TotalsDisplayRow,
} from "./SpendingChart";
import TransactionList, { sortTransactions, type SortKey, type SortState } from "./TransactionList";
import ManageModal from "./ManageModal";
import { useBucketsAndCategories } from "./lib/useBucketsAndCategories";
import { buildCategoryOptionsByBucket } from "./lib/categoryOptions";
import { buildBankSeries, buildChartSeries, resolveBucketKey, type ChartRange } from "./lib/transactionSummary";
import type { BankRecord } from "./lib/banks";
import { computeDivergingScale } from "./lib/chartScale";
import {
  BUCKET_COLOR_PALETTE,
  DEFAULT_CATEGORIES,
  applyCategoryRecords,
  deriveCategoryList,
  getCategoryBucketColor,
  getCategoryLabel,
  isTransferCategory,
  INCOME_BUCKET_ID,
  UNCLASSIFIED_BUCKET_COLOR,
  UNCLASSIFIED_BUCKET_ID,
  UNCLASSIFIED_CATEGORY,
  UNGROUPED_BUCKET_COLOR,
  UNGROUPED_BUCKET_ID,
  type Category,
  type CategoryRecord,
  type BucketRecord,
} from "./lib/categories";
function SpendingPage() {
  const [uploads, setUploads] = useState<UploadedFileView[]>([]);
  const [chartRange, setChartRange] = useState<ChartRange>("month");
  const [groupMode, setGroupMode] = useState<GroupMode>("bucket");
  const [selectedCategories, setSelectedCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [dbError, setDbError] = useState<string | null>(null);
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedBucketId, setSelectedBucketId] = useState<string | null>(null);
  const [tableSort, setTableSort] = useState<SortState | null>(null);
  const [categoryRecords, setCategoryRecords] = useState<CategoryRecord[]>([]);
  const [buckets, setBuckets] = useState<BucketRecord[]>([]);
  const [bankRecords, setBankRecords] = useState<BankRecord[]>([]);
  // The Buckets & Categories settings modal.
  const [manageOpen, setManageOpen] = useState(false);

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
    invoke<BankRecord[]>("list_banks")
      .then(setBankRecords)
      .catch((error) => {
        console.error("Failed to load banks from the database", error);
        setDbError("Couldn't reach the local database. Make sure the app is running via `npm run tauri dev`.");
      });
  }, []);

  // Sync the shared label/color lookups with the loaded records DURING render (not in an
  // effect) so getCategoryLabel/getCategoryColor are fresh for this render and for the child
  // components that read them. An effect runs after commit without scheduling a re-render, so
  // the chart could keep showing raw lowercase ids (e.g. "travel" instead of "Travel") until
  // some unrelated state change happened to re-render it.
  useMemo(() => applyCategoryRecords(categoryRecords), [categoryRecords]);

  const masterTransactions = useMemo(() => uploads.flatMap((upload) => upload.transactions), [uploads]);

  // Income categories hold money coming in; they live on the Income page, not in spending.
  const incomeCategories = useMemo(
    () => new Set(categoryRecords.filter((record) => record.bucketId === INCOME_BUCKET_ID).map((record) => record.id)),
    [categoryRecords],
  );

  const excludedCategories = useMemo(
    () => new Set(categoryRecords.filter((record) => record.excluded).map((record) => record.id)),
    [categoryRecords],
  );

  // Unclassified isn't a user-defined category, but surface it alongside the defined ones while
  // any uncategorized transactions exist so their spending shows in the chart. Once they're all
  // categorized it drops back out (unlike defined categories, which stay even at zero spend).
  const hasUnclassified = useMemo(
    () => masterTransactions.some((transaction) => transaction.category === UNCLASSIFIED_CATEGORY),
    [masterTransactions],
  );

  const categoryList = useMemo(() => {
    const defined = deriveCategoryList(masterTransactions, categoryRecords.map((record) => record.id));
    return hasUnclassified ? [...defined, UNCLASSIFIED_CATEGORY] : defined;
  }, [masterTransactions, categoryRecords, hasUnclassified]);

  const bucketColorByCategory = useMemo(
    () =>
      Object.fromEntries(
        categoryList.map((category) => [category, getCategoryBucketColor(category, categoryRecords, buckets)]),
      ),
    [buckets, categoryList, categoryRecords],
  );

  const categoryOptionsByBucket = useMemo(
    () => buildCategoryOptionsByBucket(categoryList, categoryRecords, buckets),
    // hasUnclassified is already folded into categoryList; categoryRecords drives label renames.
    [buckets, categoryList, categoryRecords],
  );

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
          !isTransferCategory(transaction.category) &&
          !excludedCategories.has(transaction.category) &&
          !incomeCategories.has(transaction.category) &&
          selectedCategories.includes(transaction.category),
      ),
    [masterTransactions, selectedCategories, excludedCategories, incomeCategories],
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
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
      .map((bucket) => ({ id: bucket.id, name: bucket.name, color: bucket.color }));
    metas.push({ id: UNGROUPED_BUCKET_ID, name: "Ungrouped", color: UNGROUPED_BUCKET_COLOR });
    // Unclassified is its own catch-all section (below the real buckets and Ungrouped), shown
    // only while uncategorized transactions exist.
    if (hasUnclassified) {
      metas.push({ id: UNCLASSIFIED_BUCKET_ID, name: "Unclassified", color: UNCLASSIFIED_BUCKET_COLOR });
    }
    return metas;
  }, [buckets, hasUnclassified]);

  // Map a category to the id of the bucket it displays under (a real bucket, or "Ungrouped").
  const resolveDisplayBucketId = useMemo(() => {
    const bucketIdByCategory = new Map(categoryRecords.map((record) => [record.id, record.bucketId]));
    const realBucketIds = new Set(buckets.map((bucket) => bucket.id));
    return (category: string) => {
      if (category === UNCLASSIFIED_CATEGORY) {
        return UNCLASSIFIED_BUCKET_ID;
      }
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
    // Every defined (selected, non-excluded) category gets a row, even one with no spending in
    // the current view — its columns just read "—". This keeps the totals section in sync with
    // the categories managed in BucketsAndCategories.
    const activeRows = categoryList
      .filter(
        (category) =>
          selectedCategories.includes(category) &&
          !excludedCategories.has(category) &&
          !incomeCategories.has(category),
      )
      .map((category) => {
        const perColumn = chartSeries.map((point) => {
          const segment = point.segments.find((item) => item.category === category);
          return segment ? segment.value : 0;
        });
        return { category, perColumn };
      });

    const columnCount = chartSeries.length;
    const sumRows = (rows: { perColumn: number[] }[]) =>
      rows.reduce(
        (totals, row) => totals.map((value, index) => value + row.perColumn[index]),
        new Array<number>(columnCount).fill(0),
      );
    // Order categories within a bucket by the position the user set (dragging them in the
    // Buckets & categories manager), falling back to label for ties and for categories with no
    // managed record (e.g. Ungrouped/Unclassified entries).
    const positionByCategory = new Map(categoryRecords.map((record) => [record.id, record.position]));
    const byOrder = (a: { category: string }, b: { category: string }) => {
      const positionDelta =
        (positionByCategory.get(a.category) ?? Number.MAX_SAFE_INTEGER) -
        (positionByCategory.get(b.category) ?? Number.MAX_SAFE_INTEGER);
      return positionDelta !== 0
        ? positionDelta
        : getCategoryLabel(a.category).localeCompare(getCategoryLabel(b.category));
    };

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
      const sorted = members.slice().sort(byOrder);

      // Collapse a bucket that holds a single category whose name matches the bucket's into just
      // the bucket-total row, instead of showing a redundant category line and an identical total.
      const collapseSingle =
        sorted.length === 1 &&
        getCategoryLabel(sorted[0].category).trim().toLowerCase() === meta.name.trim().toLowerCase();

      if (!collapseSingle) {
        sorted.forEach((row, index) => {
          displayRows.push({
            kind: "category",
            key: `${meta.id}:${row.category}`,
            category: row.category,
            perColumn: row.perColumn,
            color: meta.color,
            sectionStart: index === 0,
          });
        });
      }

      displayRows.push({
        kind: "bucketTotal",
        key: `bucketTotal:${meta.id}`,
        bucketId: meta.id,
        label: meta.name,
        perColumn: sumRows(members),
        color: meta.color,
        // When collapsed the total is the whole section, so it needs the gap a line item would give.
        sectionStart: collapseSingle,
      });
    });

    const netPerColumn = chartSeries.map((point) =>
      point.segments.reduce((sum, segment) => sum + segment.value, 0),
    );

    return { displayRows, netPerColumn };
  }, [
    categoryList,
    selectedCategories,
    excludedCategories,
    incomeCategories,
    chartSeries,
    bucketMeta,
    resolveDisplayBucketId,
    categoryRecords,
  ]);

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

    return sortTransactions(tableTransactions, tableSort);
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

  const handleBulkCategoryChange = (transactionIds: string[], category: Category) => {
    if (transactionIds.length === 0) {
      return;
    }
    const idSet = new Set(transactionIds);
    setUploads((current) =>
      current.map((upload) => ({
        ...upload,
        transactions: upload.transactions.map((transaction) =>
          idSet.has(transaction.id) ? { ...transaction, category } : transaction,
        ),
      })),
    );

    invoke("update_transaction_categories", { transactionIds, category }).catch((error) => {
      console.error("Failed to save bulk category change", error);
      setDbError("Couldn't save those category changes to the database.");
    });
  };

  // Shared by the Spending-page settings modal and the Sankey page's.
  const bucketsAndCategoriesProps = useBucketsAndCategories({
    buckets,
    setBuckets,
    categoryRecords,
    setCategoryRecords,
    onError: setDbError,
    onCategoryRemoved: (id) => {
      const previousUploads = uploads;
      setSelectedCategories((current) => current.filter((category) => category !== id));
      setUploads((current) =>
        current.map((upload) => ({
          ...upload,
          transactions: upload.transactions.map((transaction) =>
            transaction.category === id ? { ...transaction, category: "unclassified" } : transaction,
          ),
        })),
      );
      return () => setUploads(previousUploads);
    },
  });

  return (
    <>
      {dbError && <div className="import-shell__db-error">{dbError}</div>}
      <section className="import-shell__panel">
        <div className="import-shell__master-layout">
          <SpendingChart
            hasTransactions={masterTransactions.length > 0}
            selectedCategories={selectedCategories}
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
            onToggleSegment={toggleSegment}
            onToggleBucketSegment={toggleBucketSegment}
            onToggleCategoryFilter={toggleCategoryFilter}
            onToggleBucketFilter={toggleBucketFilter}
            onOpenSettings={() => setManageOpen(true)}
          />

          <TransactionList
            transactions={sortedTransactions}
            total={tableTotal}
            hasAnyTransactions={masterTransactions.length > 0}
            selectedBucketKey={selectedBucketKey}
            selectedCategory={selectedCategory}
            selectedBucketId={selectedBucketId}
            selectedBucketLabel={selectedBucketLabel}
            selectedBucketName={selectedBucketName}
            onClearFilter={clearTableFilter}
            sort={tableSort}
            onToggleSort={toggleSort}
            categoryList={categoryList}
            excludedCategoryIds={excludedCategories}
            bucketColorByCategory={bucketColorByCategory}
            categoryOptionsByBucket={categoryOptionsByBucket}
            bankRecords={bankRecords}
            onCategoryChange={handleCategoryChange}
            onBulkCategoryChange={handleBulkCategoryChange}
          />
        </div>
      </section>

      {manageOpen && (
        <ManageModal
          onClose={() => setManageOpen(false)}
          buckets={bucketsAndCategoriesProps}
        />
      )}
    </>
  );
}

export default SpendingPage;
