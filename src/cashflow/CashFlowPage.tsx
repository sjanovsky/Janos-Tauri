import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import SpendingChart, {
  type BucketChartPoint,
  type GroupMode,
  type TotalsDisplayRow,
} from "../spending/SpendingChart";
import TransactionList, {
  sortTransactions,
  type SortKey,
  type SortState,
} from "../spending/TransactionList";
import CashFlowSettingsModal from "./CashFlowSettingsModal";
import { useCashflowGroups } from "./lib/useCashflowGroups";
import { buildCategoryOptionsByBucket } from "../spending/lib/categoryOptions";
import { computeDivergingScale } from "../spending/lib/chartScale";
import { resolveBucketKey, type ChartRange } from "../spending/lib/transactionSummary";
import type { BankRecord } from "../spending/lib/banks";
import type { UploadedFileView } from "../upload/lib/uploads";
import type { PaychecksData } from "../income/lib/income";
import {
  UNCLASSIFIED_CATEGORY,
  applyCategoryRecords,
  deriveCategoryList,
  getCategoryBucketColor,
  type BucketRecord,
  type CategoryRecord,
} from "../spending/lib/categories";
import { buildCashFlow, GROSS_SEGMENT_ID } from "./lib/cashflow";
import {
  type CashflowData,
  type CashflowGroupRecord,
  type CashflowMemberRecord,
} from "./lib/groups";

const DB_ERROR =
  "Couldn't reach the local database. Make sure the app is running via `npm run tauri dev`.";

const EMPTY_PAYCHECKS: PaychecksData = { paychecks: [], buckets: [], items: [] };

// The Cash Flow page: the Income and Spending pages as one. Each period is a bar with gross income
// above the line and every bucket below it (withheld buckets such as Withholding and Retirement,
// then spending buckets such as Fixed and Food), and a net income row beneath the table. Clicking a
// bar, a bucket's cell or its label filters the transaction list to what feeds it.
function CashFlowPage() {
  const [uploads, setUploads] = useState<UploadedFileView[]>([]);
  const [categoryRecords, setCategoryRecords] = useState<CategoryRecord[]>([]);
  const [buckets, setBuckets] = useState<BucketRecord[]>([]);
  const [bankRecords, setBankRecords] = useState<BankRecord[]>([]);
  const [paychecks, setPaychecks] = useState<PaychecksData>(EMPTY_PAYCHECKS);
  const [groups, setGroups] = useState<CashflowGroupRecord[]>([]);
  const [members, setMembers] = useState<CashflowMemberRecord[]>([]);
  // Groups opened to show the buckets inside them; they start closed.
  const [dbError, setDbError] = useState<string | null>(null);
  const [chartRange, setChartRange] = useState<ChartRange>("month");
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(null);
  // A clicked group (or gross income) row, and a clicked bucket line inside a group.
  const [selectedBucketId, setSelectedBucketId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [tableSort, setTableSort] = useState<SortState | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  useEffect(() => {
    const fail = (what: string) => (error: unknown) => {
      console.error(`Failed to load ${what} from the database`, error);
      setDbError(DB_ERROR);
    };
    invoke<UploadedFileView[]>("list_uploads").then(setUploads).catch(fail("uploads"));
    invoke<CategoryRecord[]>("list_categories").then(setCategoryRecords).catch(fail("categories"));
    invoke<BucketRecord[]>("list_buckets").then(setBuckets).catch(fail("buckets"));
    invoke<BankRecord[]>("list_banks").then(setBankRecords).catch(fail("banks"));
    invoke<PaychecksData>("get_paychecks_data").then(setPaychecks).catch(fail("paychecks"));
    invoke<CashflowData>("get_cashflow_data")
      .then((data) => {
        setGroups(data.groups);
        setMembers(data.members);
      })
      .catch(fail("cash flow groups"));
  }, []);

  // Keep the shared label/color lookups fresh during render (see SpendingPage).
  useMemo(() => applyCategoryRecords(categoryRecords), [categoryRecords]);

  const masterTransactions = useMemo(() => uploads.flatMap((upload) => upload.transactions), [uploads]);

  const cashFlow = useMemo(
    () =>
      buildCashFlow({
        transactions: masterTransactions,
        range: chartRange,
        paychecks: paychecks.paychecks,
        paycheckBuckets: paychecks.buckets,
        paycheckItems: paychecks.items,
        spendingBuckets: buckets,
        spendingCategories: categoryRecords,
        banks: bankRecords,
        groups,
        members,
      }),
    [masterTransactions, chartRange, paychecks, buckets, categoryRecords, bankRecords, groups, members],
  );

  const activeSeries = useMemo<BucketChartPoint[]>(
    () =>
      cashFlow.series.map((point) => ({
        key: point.key,
        label: point.label,
        // Groups stack upward as positive amounts; gross income is the table's top row, and the
        // net income line shows what's left over.
        segments: point.segments
          .filter((segment) => segment.id !== GROSS_SEGMENT_ID)
          .map((segment) => ({
            bucketId: segment.id,
            label: segment.label,
            color: segment.color,
            value: -segment.value,
          })),
      })),
    [cashFlow.series],
  );

  const activeTotals = useMemo(() => {
    const displayRows: TotalsDisplayRow[] = [];
    for (const row of cashFlow.rows) {
      const isGroup = row.kind === "group";
      // Like the Spending table: a group's buckets as line items, then its total beneath. A group
      // with a single bucket is just the total, which then carries the gap above the section.
      const showChildren = isGroup && row.children.length > 1;
      if (showChildren) {
        row.children.forEach((child, index) =>
          displayRows.push({
            kind: "category",
            key: `${row.id}:${child.id}`,
            category: child.id,
            label: child.label,
            perColumn: child.perColumn.map((value) => -value),
            // The whole section takes the group's color, matching its bar in the chart.
            color: row.color,
            sectionStart: index === 0,
          }),
        );
      }
      displayRows.push({
        kind: "bucketTotal",
        key: row.id,
        bucketId: row.id,
        label: row.label,
        // Groups are money out; shown as positive amounts like the bars above.
        perColumn: isGroup ? row.perColumn.map((value) => -value) : row.perColumn,
        color: row.color,
        sectionStart: isGroup && !showChildren,
      });
    }
    return { displayRows, netPerColumn: cashFlow.netPerColumn };
  }, [cashFlow.rows, cashFlow.netPerColumn]);

  const grossPerColumn = useMemo(
    () => cashFlow.rows.find((row) => row.kind === "gross")?.perColumn ?? cashFlow.series.map(() => 0),
    [cashFlow.rows, cashFlow.series],
  );

  const chartScale = useMemo(
    () =>
      computeDivergingScale(
        activeSeries.map((point, index) => {
          const gross = grossPerColumn[index] ?? 0;
          return {
            positiveTotal: Math.max(
              gross,
              point.segments.filter((segment) => segment.value > 0).reduce((sum, segment) => sum + segment.value, 0),
            ),
            negativeTotal: Math.max(
              0,
              point.segments
                .filter((segment) => segment.value < 0)
                .reduce((sum, segment) => sum + Math.abs(segment.value), 0),
            ),
          };
        }),
      ),
    [activeSeries, grossPerColumn],
  );

  // --- Transactions behind the chart ---
  const flowTransactions = useMemo(
    () => masterTransactions.filter((transaction) => cashFlow.allTransactionIds.has(transaction.id)),
    [masterTransactions, cashFlow.allTransactionIds],
  );

  const tableTransactions = useMemo(() => {
    const rowId = selectedCategory ?? selectedBucketId;
    if (!selectedBucketKey && !rowId) {
      return flowTransactions;
    }
    // Leftover isn't made of transactions, so selecting it narrows by period only.
    const feeding = rowId ? cashFlow.transactionIds.get(rowId) : null;
    return flowTransactions.filter(
      (transaction) =>
        (!selectedBucketKey || resolveBucketKey(transaction.date, chartRange) === selectedBucketKey) &&
        (!feeding || feeding.has(transaction.id)),
    );
  }, [flowTransactions, selectedBucketKey, selectedBucketId, selectedCategory, chartRange, cashFlow.transactionIds]);

  const sortedTransactions = useMemo(() => {
    // Newest first by default; the user's column sort replaces it.
    const sort: SortState = tableSort ?? { key: "date", direction: "desc" };
    return sortTransactions(tableTransactions, sort);
    // categoryRecords is a dependency because sorting by category uses its (possibly renamed) label.
  }, [tableTransactions, tableSort, categoryRecords]);

  const tableTotal = useMemo(
    () => sortedTransactions.reduce((sum, transaction) => sum + transaction.amount, 0),
    [sortedTransactions],
  );

  const selectedBucketLabel = useMemo(
    () => cashFlow.series.find((point) => point.key === selectedBucketKey)?.label ?? selectedBucketKey,
    [cashFlow.series, selectedBucketKey],
  );
  const selectedBucketName = useMemo(
    () => {
      const rowId = selectedCategory ?? selectedBucketId;
      return (
        cashFlow.rows
          .flatMap((row) => [row, ...row.children])
          .find((row) => row.id === rowId)?.label ?? null
      );
    },
    [cashFlow.rows, selectedBucketId, selectedCategory],
  );

  // --- Selection ---
  const clearTableFilter = () => {
    setSelectedBucketKey(null);
    setSelectedBucketId(null);
    setSelectedCategory(null);
  };

  const handleRangeChange = (range: ChartRange) => {
    setChartRange(range);
    clearTableFilter();
  };

  const toggleSort = (key: SortKey) => {
    setTableSort((current) =>
      current && current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  };

  // Clicking a whole bar (or a net income cell) filters to that period.
  const toggleBucket = (key: string) => {
    setSelectedBucketKey((current) => (current === key ? null : key));
    setSelectedBucketId(null);
    setSelectedCategory(null);
  };

  // Clicking a bar segment or a group's cell filters to that period + group.
  const toggleBucketSegment = (key: string, bucketId: string) => {
    const alreadySelected = selectedBucketKey === key && selectedBucketId === bucketId;
    setSelectedBucketKey(alreadySelected ? null : key);
    setSelectedBucketId(alreadySelected ? null : bucketId);
    setSelectedCategory(null);
  };

  // Clicking a group's label filters to that group across all time.
  const toggleBucketFilter = (bucketId: string) => {
    const alreadySelected = selectedBucketId === bucketId && !selectedBucketKey;
    setSelectedBucketKey(null);
    setSelectedCategory(null);
    setSelectedBucketId(alreadySelected ? null : bucketId);
  };

  // Clicking a bucket line's cell filters to that period + bucket; its label, to the bucket alone.
  const toggleCategorySegment = (key: string, category: string) => {
    const alreadySelected = selectedBucketKey === key && selectedCategory === category;
    setSelectedBucketKey(alreadySelected ? null : key);
    setSelectedBucketId(null);
    setSelectedCategory(alreadySelected ? null : category);
  };
  const toggleCategoryFilter = (category: string) => {
    const alreadySelected = selectedCategory === category && !selectedBucketKey;
    setSelectedBucketKey(null);
    setSelectedBucketId(null);
    setSelectedCategory(alreadySelected ? null : category);
  };

  // --- Category editing in the transaction list ---
  const categoryList = useMemo(() => {
    const defined = deriveCategoryList(masterTransactions, categoryRecords.map((record) => record.id));
    return masterTransactions.some((transaction) => transaction.category === UNCLASSIFIED_CATEGORY)
      ? [...defined, UNCLASSIFIED_CATEGORY]
      : defined;
  }, [masterTransactions, categoryRecords]);

  const bucketColorByCategory = useMemo(
    () =>
      Object.fromEntries(
        categoryList.map((category) => [category, getCategoryBucketColor(category, categoryRecords, buckets)]),
      ),
    [buckets, categoryList, categoryRecords],
  );

  const categoryOptionsByBucket = useMemo(
    () => buildCategoryOptionsByBucket(categoryList, categoryRecords, buckets),
    [buckets, categoryList, categoryRecords],
  );

  const excludedCategories = useMemo(
    () => new Set(categoryRecords.filter((record) => record.excluded).map((record) => record.id)),
    [categoryRecords],
  );

  const patchTransactions = (change: (transaction: UploadedFileView["transactions"][number]) => UploadedFileView["transactions"][number], ids: Set<string>) =>
    setUploads((current) =>
      current.map((upload) => ({
        ...upload,
        transactions: upload.transactions.map((transaction) =>
          ids.has(transaction.id) ? change(transaction) : transaction,
        ),
      })),
    );

  const handleCategoryChange = (transactionId: string, category: string) => {
    patchTransactions((transaction) => ({ ...transaction, category }), new Set([transactionId]));
    invoke("update_transaction_category", { transactionId, category }).catch((error) => {
      console.error("Failed to save category change", error);
      setDbError("Couldn't save that category change to the database.");
    });
  };

  const handleBulkCategoryChange = (transactionIds: string[], category: string) => {
    if (transactionIds.length === 0) {
      return;
    }
    patchTransactions((transaction) => ({ ...transaction, category }), new Set(transactionIds));
    invoke("update_transaction_categories", { transactionIds, category }).catch((error) => {
      console.error("Failed to save bulk category change", error);
      setDbError("Couldn't save those category changes to the database.");
    });
  };

  const handleBulkFlipSign = (transactionIds: string[]) => {
    if (transactionIds.length === 0) {
      return;
    }
    patchTransactions((transaction) => ({ ...transaction, amount: -transaction.amount }), new Set(transactionIds));
    invoke("flip_transaction_amounts", { transactionIds }).catch((error) => {
      console.error("Failed to save sign flip", error);
      setDbError("Couldn't save those amount changes to the database.");
    });
  };

  const groupsProps = useCashflowGroups({
    paycheckBuckets: paychecks.buckets,
    buckets,
    groups,
    setGroups,
    members,
    setMembers,
    onError: setDbError,
  });

  return (
    <>
      {dbError && <div className="import-shell__db-error">{dbError}</div>}
      <section className="import-shell__panel">
        <div className="import-shell__master-layout">
          <SpendingChart
            title="Cash flow"
            bucketLabel="Buckets"
            settingsLabel="Cash flow groups"
            groupOptions={[{ mode: "bucket" as GroupMode, label: "Buckets" }]}
            netLabel="Net income"
            lineValues={grossPerColumn}
            lineLabel="Gross income"
            hasTransactions={flowTransactions.length > 0}
            selectedCategories={["cashflow"]}
            chartRange={chartRange}
            groupMode="bucket"
            activeSeries={activeSeries}
            chartScale={chartScale}
            activeTotals={activeTotals}
            selectedBucketKey={selectedBucketKey}
            selectedCategory={selectedCategory}
            selectedBucketId={selectedBucketId}
            onRangeChange={handleRangeChange}
            onGroupModeChange={() => {}}
            onToggleBucket={toggleBucket}
            onToggleSegment={toggleCategorySegment}
            onToggleBucketSegment={toggleBucketSegment}
            onToggleCategoryFilter={toggleCategoryFilter}
            onToggleBucketFilter={toggleBucketFilter}
            onOpenSettings={() => setManageOpen(true)}
          />

          <TransactionList
            transactions={sortedTransactions}
            total={tableTotal}
            hasAnyTransactions={flowTransactions.length > 0}
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
            onBulkFlipSign={handleBulkFlipSign}
          />
        </div>
      </section>

      {manageOpen && (
        <CashFlowSettingsModal
          onClose={() => setManageOpen(false)}
          groups={groupsProps}
        />
      )}
    </>
  );
}

export default CashFlowPage;
