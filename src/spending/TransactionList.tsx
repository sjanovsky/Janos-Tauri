import type { ImportedTransaction } from "./lib/csvParser";
import {
  RESERVED_CATEGORIES,
  getCategoryLabel,
  resolveCategoryInput,
  type Category,
  type KnownCategory,
} from "./lib/categories";
import { currencyFormatter } from "./lib/format";

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
  knownCategories: KnownCategory[];
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
  knownCategories,
  onCategoryChange,
}: TransactionListProps) {
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

        <div className="import-shell__table-shell">
          {transactions.length === 0 ? (
            <div className="import-shell__empty">
              {!hasAnyTransactions
                ? "No transactions have been imported yet."
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
                        className={column.key === "amount" ? "import-shell__cell--amount" : undefined}
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
                {transactions.map((transaction) => (
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
                            onCategoryChange(transaction.id, nextCategory);
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
                  <td className="import-shell__cell--amount">{currencyFormatter.format(total)}</td>
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
