import { useEffect, useMemo, useRef, useState } from "react";
import type { ImportedTransaction } from "../upload/lib/csvParser";
import {
  RESERVED_CATEGORIES,
  getCategoryColor,
  getCategoryLabel,
  type Category,
} from "./lib/categories";
import {
  buildBankLogoMap,
  normalizeBankName,
  type BankRecord,
} from "./lib/banks";
import { currencyFormatter } from "./lib/format";
import { parseDate } from "./lib/transactionSummary";
import MultiSelectFilter from "./MultiSelectFilter";

export type SortKey = "date" | "description" | "bank" | "amount" | "category";
export type SortDirection = "asc" | "desc";
export type SortState = { key: SortKey; direction: SortDirection };

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

// Orders transactions for the table; callers pass the result back in as `transactions`.
export function sortTransactions(transactions: ImportedTransaction[], sort: SortState): ImportedTransaction[] {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...transactions].sort((a, b) => {
    const aValue = sortValue(a, sort.key);
    const bValue = sortValue(b, sort.key);
    if (typeof aValue === "number" && typeof bValue === "number") {
      return (aValue - bValue) * direction;
    }
    return String(aValue).localeCompare(String(bValue)) * direction;
  });
}

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "description", label: "Description" },
  { key: "bank", label: "Bank" },
  { key: "category", label: "Category" },
  { key: "amount", label: "Amount" },
];

type TransactionListProps = {
  // Already filtered + sorted by the shell; `total` is their summed amount.
  transactions: ImportedTransaction[];
  total: number;
  // Whether any transactions exist at all, to pick the right empty-state message.
  hasAnyTransactions: boolean;
  selectedBucketKey: string | null;
  selectedCategory: string | null;
  selectedBucketId: string | null;
  selectedBucketLabel: string | null;
  selectedBucketName: string | null;
  onClearFilter: () => void;
  // Put the "Filtered to" chip under the search and filters instead of above them, so the search
  // bar keeps its place whether or not a filter is on.
  filterBelowTools?: boolean;
  sort: SortState | null;
  onToggleSort: (key: SortKey) => void;
  // Suggestions for the per-row category input.
  categoryList: string[];
  // Category ids sitting in the Exclude bucket; they start unchecked in the Category filter so
  // excluded spending is hidden by default (the user can re-check them to bring it back).
  excludedCategoryIds: Set<string>;
  bucketColorByCategory: Record<string, string>;
  categoryOptionsByBucket: {
    bucketLabel: string;
    options: { value: string; label: string }[];
  }[];
  bankRecords: BankRecord[];
  onCategoryChange: (transactionId: string, category: Category) => void;
  // Apply one category to many transactions at once (bulk update).
  onBulkCategoryChange: (transactionIds: string[], category: Category) => void;
  // When given, transactions flagged autoCategorized are highlighted and can be confirmed
  // (marked reviewed) one at a time or all at once.
  onConfirmAutoCategorized?: (transactionIds: string[]) => void;
};

// The right-hand column of the Spending view: an active-filter banner (driven by the chart's
// selection) over the transactions table, whose Category cells are editable.
function TransactionList({
  transactions,
  total,
  hasAnyTransactions,
  selectedBucketKey,
  selectedCategory,
  selectedBucketId,
  selectedBucketLabel,
  selectedBucketName,
  onClearFilter,
  filterBelowTools = false,
  sort,
  onToggleSort,
  categoryList,
  excludedCategoryIds,
  bucketColorByCategory,
  categoryOptionsByBucket,
  bankRecords,
  onCategoryChange,
  onBulkCategoryChange,
  onConfirmAutoCategorized,
}: TransactionListProps) {
  const [search, setSearch] = useState("");
  // Bulk-update mode: a checkbox column appears and a toolbar applies one category to all
  // selected rows at once. selectedIds may outlive a row briefly (filter/sort changes); it's
  // always intersected with the visible rows before anything acts on it.
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("");
  // Unchecked values per filter; empty set means that field isn't narrowing anything.
  const [excludedBanks, setExcludedBanks] = useState<Set<string>>(new Set());
  const [excludedCategories, setExcludedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [reviewOnly, setReviewOnly] = useState(false);
  const query = search.trim().toLowerCase();
  const reviewIds = useMemo(
    () =>
      onConfirmAutoCategorized
        ? transactions.filter((transaction) => transaction.autoCategorized).map((transaction) => transaction.id)
        : [],
    [transactions, onConfirmAutoCategorized],
  );

  // Keep the Category filter's unchecked set in sync with the Exclude bucket: uncheck a category
  // when it joins the bucket, re-check it when it leaves. We diff against the ids we last applied
  // (not the live checked state) so the user's own manual toggles are left untouched. This runs via
  // an effect rather than initial state because the categories load asynchronously, so the Exclude
  // bucket is usually empty on first render.
  const appliedExclusionsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const applied = appliedExclusionsRef.current;
    const added = [...excludedCategoryIds].filter((id) => !applied.has(id));
    const removed = [...applied].filter((id) => !excludedCategoryIds.has(id));
    if (added.length > 0 || removed.length > 0) {
      setExcludedCategories((current) => {
        const next = new Set(current);
        added.forEach((id) => next.add(id));
        removed.forEach((id) => next.delete(id));
        return next;
      });
    }
    appliedExclusionsRef.current = new Set(excludedCategoryIds);
  }, [excludedCategoryIds]);

  // Dropdown options come from the transactions actually in view (deduped + sorted by label).
  const bankOptions = useMemo(() => {
    const banks = Array.from(
      new Set(transactions.map((transaction) => transaction.sourceBank)),
    );
    return banks
      .sort((a, b) => a.localeCompare(b))
      .map((bank) => ({ value: bank, label: bank }));
  }, [transactions]);

  const categoryOptions = useMemo(() => {
    const categories = Array.from(
      new Set(transactions.map((transaction) => transaction.category)),
    );
    return categories
      .map((category) => ({
        value: category,
        label: getCategoryLabel(category),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [transactions]);

  const hasLocalFilter =
    query !== "" ||
    excludedBanks.size > 0 ||
    excludedCategories.size > 0 ||
    (reviewOnly && reviewIds.length > 0);
  const bankLogoByName = useMemo(
    () => buildBankLogoMap(bankRecords),
    [bankRecords],
  );

  // Description search + bank/category filters, applied locally on top of the shell's filter/sort.
  const visibleTransactions = useMemo(() => {
    if (!hasLocalFilter && !(reviewOnly && reviewIds.length > 0)) {
      return transactions;
    }
    const showOnlyReview = reviewOnly && reviewIds.length > 0;
    return transactions.filter((transaction) => {
      if (showOnlyReview && !transaction.autoCategorized) {
        return false;
      }
      if (query && !transaction.description.toLowerCase().includes(query)) {
        return false;
      }
      if (excludedBanks.has(transaction.sourceBank)) {
        return false;
      }
      if (excludedCategories.has(transaction.category)) {
        return false;
      }
      return true;
    });
  }, [transactions, query, excludedBanks, excludedCategories, hasLocalFilter, reviewOnly, reviewIds]);

  // Keep the footer total in sync with the rows actually shown after filtering.
  const visibleTotal = useMemo(
    () =>
      hasLocalFilter
        ? visibleTransactions.reduce(
            (sum, transaction) => sum + transaction.amount,
            0,
          )
        : total,
    [hasLocalFilter, visibleTransactions, total],
  );

  // Selections only ever act on rows the user can currently see, so a stale id left behind by a
  // filter/sort change never silently recategorizes something off-screen.
  const selectedVisibleIds = useMemo(
    () =>
      visibleTransactions
        .filter((transaction) => selectedIds.has(transaction.id))
        .map((t) => t.id),
    [visibleTransactions, selectedIds],
  );
  const selectedVisibleCount = selectedVisibleIds.length;
  const allVisibleSelected =
    visibleTransactions.length > 0 &&
    selectedVisibleCount === visibleTransactions.length;

  // Drive the header checkbox's indeterminate state (no HTML attribute exists for it).
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate =
        selectedVisibleCount > 0 && !allVisibleSelected;
    }
  }, [selectedVisibleCount, allVisibleSelected]);

  const toggleBulkMode = () => {
    setBulkMode((on) => !on);
    setSelectedIds(new Set());
    setBulkCategory("");
  };

  const toggleRowSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(
      allVisibleSelected
        ? new Set()
        : new Set(visibleTransactions.map((t) => t.id)),
    );
  };

  const applyBulkCategory = () => {
    if (!bulkCategory || selectedVisibleCount === 0) {
      return;
    }
    onBulkCategoryChange(selectedVisibleIds, bulkCategory as Category);
    setSelectedIds(new Set());
    setBulkCategory("");
    setBulkMode(false);
  };

  const footerColSpan = SORT_COLUMNS.length - 1 + (bulkMode ? 1 : 0);

  const filterChip =
    selectedBucketKey || selectedCategory || selectedBucketId ? (
      <div className="import-shell__table-filter">
        <span>
          Filtered to{" "}
          {selectedBucketKey && <strong>{selectedBucketLabel}</strong>}
          {selectedBucketKey && (selectedCategory || selectedBucketId) && " · "}
          {selectedCategory && (
            <strong>{getCategoryLabel(selectedCategory)}</strong>
          )}
          {selectedBucketId && selectedBucketName && (
            <strong>{selectedBucketName}</strong>
          )}
        </span>
        <button type="button" onClick={onClearFilter}>
          Clear
        </button>
      </div>
    ) : null;

  return (
    <>
      <div className="import-shell__master-right">
        {!filterBelowTools && filterChip}

        {hasAnyTransactions && (
          <div className="import-shell__table-tools">
            <input
              type="search"
              className="import-shell__table-search-input"
              placeholder="Search descriptions…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <MultiSelectFilter
              label="Bank"
              options={bankOptions}
              excluded={excludedBanks}
              onChange={setExcludedBanks}
            />
            <MultiSelectFilter
              label="Category"
              options={categoryOptions}
              excluded={excludedCategories}
              onChange={setExcludedCategories}
            />
            <button
              type="button"
              className={`import-shell__bulk-toggle ${bulkMode ? "import-shell__bulk-toggle--active" : ""}`}
              onClick={toggleBulkMode}
            >
              {bulkMode ? "Cancel" : "Bulk update"}
            </button>
          </div>
        )}

        {filterBelowTools && filterChip}

        {onConfirmAutoCategorized && reviewIds.length > 0 && (
          <div className="import-shell__review-banner" role="status">
            <span>
              <strong>{reviewIds.length}</strong> auto-categorized from earlier transactions — review the
              highlighted rows.
            </span>
            <label className="import-shell__review-toggle">
              <input
                type="checkbox"
                checked={reviewOnly}
                onChange={(event) => setReviewOnly(event.target.checked)}
              />
              Only show these
            </label>
            <button type="button" onClick={() => onConfirmAutoCategorized(reviewIds)}>
              Mark all reviewed
            </button>
          </div>
        )}

        {bulkMode && (
          <div className="import-shell__bulk-bar">
            <span className="import-shell__bulk-count">
              {selectedVisibleCount} selected
            </span>
            <select
              className="import-shell__bulk-select"
              value={bulkCategory}
              onChange={(event) => setBulkCategory(event.target.value)}
            >
              <option value="">Change category to…</option>
              {categoryOptionsByBucket.map((group) => (
                <optgroup key={group.bucketLabel} label={group.bucketLabel}>
                  {group.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              className="import-shell__bulk-apply"
              onClick={applyBulkCategory}
              disabled={!bulkCategory || selectedVisibleCount === 0}
            >
              Apply
            </button>
          </div>
        )}

        <div className="import-shell__table-shell">
          {visibleTransactions.length === 0 ? (
            <div className="import-shell__empty">
              {!hasAnyTransactions
                ? "No transactions have been imported yet."
                : hasLocalFilter
                  ? "No transactions match your search or filters."
                  : "No transactions match this filter."}
            </div>
          ) : (
            <table className="import-shell__table">
              <thead>
                <tr>
                  {bulkMode && (
                    <th className="import-shell__cell--select">
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        aria-label="Select all shown transactions"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAll}
                      />
                    </th>
                  )}
                  {SORT_COLUMNS.map((column) => {
                    const activeSort =
                      sort && sort.key === column.key ? sort : null;
                    const ariaSort = activeSort
                      ? activeSort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none";
                    return (
                      <th
                        key={column.key}
                        aria-sort={ariaSort}
                        className={
                          column.key === "amount"
                            ? "import-shell__cell--amount"
                            : column.key === "category"
                              ? "import-shell__cell--category"
                              : undefined
                        }
                      >
                        <button
                          type="button"
                          className={`import-shell__sort-button ${activeSort ? "import-shell__sort-button--active" : ""}`}
                          onClick={() => onToggleSort(column.key)}
                        >
                          {column.label}
                          <span
                            className="import-shell__sort-caret"
                            aria-hidden="true"
                          >
                            {activeSort
                              ? activeSort.direction === "asc"
                                ? "↑"
                                : "↓"
                              : "↓"}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleTransactions.map((transaction) => {
                  const categoryColor =
                    bucketColorByCategory[transaction.category] ??
                    getCategoryColor(transaction.category);
                  const selectedCategoryLabel = getCategoryLabel(
                    transaction.category,
                  );

                  return (
                    <tr
                      key={transaction.id}
                      className={
                        [
                          bulkMode
                            ? `import-shell__row--clickable ${
                                selectedIds.has(transaction.id)
                                  ? "import-shell__row--selected"
                                  : ""
                              }`
                            : "",
                          onConfirmAutoCategorized && transaction.autoCategorized
                            ? "import-shell__row--review"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ") || undefined
                      }
                      onClick={
                        bulkMode
                          ? (event) => {
                              // Let the row's own controls (the category select, the checkbox) handle
                              // their clicks; a click anywhere else toggles the row's selection.
                              if (
                                (event.target as HTMLElement).closest(
                                  "input, select, button, a",
                                )
                              ) {
                                return;
                              }
                              toggleRowSelected(transaction.id);
                            }
                          : undefined
                      }
                    >
                      {bulkMode && (
                        <td className="import-shell__cell--select">
                          <input
                            type="checkbox"
                            aria-label={`Select ${transaction.description}`}
                            checked={selectedIds.has(transaction.id)}
                            onChange={() => toggleRowSelected(transaction.id)}
                          />
                        </td>
                      )}
                      <td>{transaction.date}</td>
                      <td>{transaction.description}</td>
                      <td>
                        {(() => {
                          const bankLogo =
                            bankLogoByName[
                              normalizeBankName(transaction.sourceBank)
                            ];
                          return bankLogo ? (
                            <div
                              className="import-shell__bank-badge"
                              title={transaction.sourceBank}
                            >
                              <img
                                src={bankLogo}
                                alt={`${transaction.sourceBank} logo`}
                                className="import-shell__bank-logo"
                              />
                            </div>
                          ) : (
                            <span className="import-shell__bank-name">
                              {transaction.sourceBank}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="import-shell__cell--category-value">
                        <span className="import-shell__category-pill-wrap">
                          <select
                            key={transaction.category}
                            className={`import-shell__category-select ${
                              transaction.category === "unclassified"
                                ? "import-shell__category-select--unclassified"
                                : ""
                            }`}
                            value={transaction.category}
                            style={{
                              background: `color-mix(in srgb, ${categoryColor} 18%, white)`,
                              borderColor: categoryColor,
                              color: "#1f2937",
                              fontWeight: 400,
                              fontSize: "0.85rem",
                              lineHeight: 1.2,
                              borderRadius: 999,
                              padding: "0.45rem 0.7rem",
                              textAlign: "center",
                              WebkitAppearance: "none",
                              appearance: "none",
                              backgroundImage: "none",
                              textTransform: "none",
                            }}
                            onChange={(event) => {
                              const nextCategory = event.target.value;
                              if (nextCategory !== transaction.category) {
                                onCategoryChange(
                                  transaction.id,
                                  nextCategory as Category,
                                );
                              }
                            }}
                          >
                            {categoryOptionsByBucket.map((group) => (
                              <optgroup
                                key={group.bucketLabel}
                                label={group.bucketLabel}
                              >
                                {group.options.map((option) => (
                                  <option
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                          {/* Hidden copy of just the selected label sizes the pill to its text; the
                              select overlays it. Without this an appearance:none select widens to fit
                              its widest option instead of the chosen one. */}
                          <span
                            className="import-shell__category-pill-mirror"
                            aria-hidden="true"
                          >
                            {selectedCategoryLabel}
                          </span>
                        </span>
                        {onConfirmAutoCategorized && transaction.autoCategorized && (
                          <button
                            type="button"
                            className="import-shell__review-confirm"
                            title="Auto-categorized — click to confirm this category"
                            aria-label={`Confirm category for ${transaction.description}`}
                            onClick={() => onConfirmAutoCategorized([transaction.id])}
                          >
                            ✓
                          </button>
                        )}
                      </td>
                      <td className="import-shell__cell--amount">
                        {currencyFormatter.format(transaction.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="import-shell__table-total-row">
                  <td colSpan={footerColSpan}>Total</td>
                  <td className="import-shell__cell--amount">
                    {currencyFormatter.format(visibleTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      <datalist id="category-suggestions">
        {[...categoryList, ...RESERVED_CATEGORIES].map((category) => (
          <option key={category} value={getCategoryLabel(category)} />
        ))}
      </datalist>
    </>
  );
}

export default TransactionList;
