import { useEffect, useMemo, useRef, useState } from "react";
import type { ImportedTransaction } from "./lib/csvParser";
import {
  RESERVED_CATEGORIES,
  getCategoryColor,
  getCategoryLabel,
  type Category,
} from "./lib/categories";
import { buildBankLogoMap, normalizeBankName, type BankRecord } from "./lib/banks";
import { currencyFormatter } from "./lib/format";
import MultiSelectFilter from "./MultiSelectFilter";

export type SortKey = "date" | "description" | "bank" | "amount" | "category";
export type SortDirection = "asc" | "desc";
export type SortState = { key: SortKey; direction: SortDirection };

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
  sort,
  onToggleSort,
  categoryList,
  excludedCategoryIds,
  bucketColorByCategory,
  categoryOptionsByBucket,
  bankRecords,
  onCategoryChange,
}: TransactionListProps) {
  const [search, setSearch] = useState("");
  // Unchecked values per filter; empty set means that field isn't narrowing anything.
  const [excludedBanks, setExcludedBanks] = useState<Set<string>>(new Set());
  const [excludedCategories, setExcludedCategories] = useState<Set<string>>(new Set());
  const query = search.trim().toLowerCase();

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
    const banks = Array.from(new Set(transactions.map((transaction) => transaction.sourceBank)));
    return banks
      .sort((a, b) => a.localeCompare(b))
      .map((bank) => ({ value: bank, label: bank }));
  }, [transactions]);

  const categoryOptions = useMemo(() => {
    const categories = Array.from(new Set(transactions.map((transaction) => transaction.category)));
    return categories
      .map((category) => ({ value: category, label: getCategoryLabel(category) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [transactions]);

  const hasLocalFilter = query !== "" || excludedBanks.size > 0 || excludedCategories.size > 0;
  const bankLogoByName = useMemo(() => buildBankLogoMap(bankRecords), [bankRecords]);

  // Description search + bank/category filters, applied locally on top of the shell's filter/sort.
  const visibleTransactions = useMemo(() => {
    if (!hasLocalFilter) {
      return transactions;
    }
    return transactions.filter((transaction) => {
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
  }, [transactions, query, excludedBanks, excludedCategories, hasLocalFilter]);

  // Keep the footer total in sync with the rows actually shown after filtering.
  const visibleTotal = useMemo(
    () =>
      hasLocalFilter
        ? visibleTransactions.reduce((sum, transaction) => sum + transaction.amount, 0)
        : total,
    [hasLocalFilter, visibleTransactions, total],
  );

  return (
    <>
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
            <button type="button" onClick={onClearFilter}>
              Clear
            </button>
          </div>
        )}

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
                  {SORT_COLUMNS.map((column) => {
                    const activeSort = sort && sort.key === column.key ? sort : null;
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
                {visibleTransactions.map((transaction) => {
                  const categoryColor =
                    bucketColorByCategory[transaction.category] ?? getCategoryColor(transaction.category);
                  const selectedCategoryLabel = getCategoryLabel(transaction.category);
                  const categoryWidth = Math.max(70, selectedCategoryLabel.length * 9 + 24);

                  return (
                    <tr key={transaction.id}>
                      <td>{transaction.date}</td>
                      <td>{transaction.description}</td>
                      <td>
                        {(() => {
                          const bankLogo = bankLogoByName[normalizeBankName(transaction.sourceBank)];
                          return bankLogo ? (
                            <div className="import-shell__bank-badge" title={transaction.sourceBank}>
                              <img
                                src={bankLogo}
                                alt={`${transaction.sourceBank} logo`}
                                className="import-shell__bank-logo"
                              />
                            </div>
                          ) : (
                            <span className="import-shell__bank-name">{transaction.sourceBank}</span>
                          );
                        })()}
                      </td>
                      <td className="import-shell__cell--category-value">
                        <select
                          key={transaction.category}
                          className={`import-shell__category-select ${
                            transaction.category === "unclassified"
                              ? "import-shell__category-select--unclassified"
                              : ""
                          }`}
                          value={transaction.category}
                          style={{
                            width: `${categoryWidth}px`,
                            background: `color-mix(in srgb, ${categoryColor} 18%, white)`,
                            borderColor: categoryColor,
                            color: "#1f2937",
                            fontWeight: 400,
                            fontSize: "0.85rem",
                            lineHeight: 1.2,
                            borderRadius: 999,
                            minHeight: "30px",
                            padding: "0.45rem 0.7rem",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            textAlign: "center",
                            WebkitAppearance: "none",
                            appearance: "none",
                            backgroundImage: "none",
                            textTransform: "none",
                          }}
                          onChange={(event) => {
                            const nextCategory = event.target.value;
                            if (nextCategory !== transaction.category) {
                              onCategoryChange(transaction.id, nextCategory as Category);
                            }
                          }}
                        >
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
                  <td colSpan={SORT_COLUMNS.length - 1}>Total</td>
                  <td className="import-shell__cell--amount">{currencyFormatter.format(visibleTotal)}</td>
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
