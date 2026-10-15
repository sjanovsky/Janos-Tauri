import { useMemo, useState } from "react";
import Modal from "../spending/Modal";
import { currencyFormatter, wholeCurrencyFormatter } from "../spending/lib/format";
import type { FlowLine, FlowTransaction } from "./lib/flow";

export type DrillContent = {
  title: string;
  // One-line explanation of where the number comes from.
  note: string;
  total: number;
  // How a derived number was built (paycheck deposit counts times template amounts).
  lines: FlowLine[];
  transactions: FlowTransaction[];
};

type SankeyDrillProps = {
  content: DrillContent;
  periodLabel: string;
  onClose: () => void;
};

type Direction = "asc" | "desc";
type TransactionKey = "date" | "description" | "bank" | "amount";
type LineKey = "name" | "total";

const MAX_ROWS = 300;

const TRANSACTION_COLUMNS: { key: TransactionKey; label: string; numeric?: boolean }[] = [
  { key: "date", label: "Date" },
  { key: "description", label: "Description" },
  { key: "bank", label: "Bank" },
  { key: "amount", label: "Amount", numeric: true },
];

// A header cell that sorts its table when clicked; the active column shows its direction.
function SortHeader({
  label,
  active,
  direction,
  numeric,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: Direction;
  numeric?: boolean;
  onClick: () => void;
}) {
  return (
    <th
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={numeric ? "sankey-drill__num" : undefined}
    >
      <button
        type="button"
        className={`sankey-drill__sort ${active ? "sankey-drill__sort--active" : ""}`}
        onClick={onClick}
      >
        {label}
        <span aria-hidden="true">{active ? (direction === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  );
}

const compare = (a: string | number, b: string | number) =>
  typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true });

// What stands behind a node: the paycheck math and/or the bank transactions that add up to it.
// Transaction amounts are shown as money out (+) or in (−) whatever the bank's sign. Both tables
// sort by clicking a header; the total is pinned to the bottom so it stays in view while the
// rows scroll.
function SankeyDrill({ content, periodLabel, onClose }: SankeyDrillProps) {
  const [transactionSort, setTransactionSort] = useState<{ key: TransactionKey; direction: Direction }>({
    key: "date",
    direction: "desc",
  });
  const [lineSort, setLineSort] = useState<{ key: LineKey; direction: Direction } | null>(null);

  const transactions = useMemo(() => {
    const value = (transaction: FlowTransaction): string | number => {
      switch (transactionSort.key) {
        case "date":
          return transaction.timestamp;
        case "description":
          return transaction.description;
        case "bank":
          return transaction.bank;
        default:
          return transaction.flow;
      }
    };
    const factor = transactionSort.direction === "asc" ? 1 : -1;
    return [...content.transactions].sort((a, b) => factor * compare(value(a), value(b)));
  }, [content.transactions, transactionSort]);

  const lines = useMemo(() => {
    if (!lineSort) {
      return content.lines;
    }
    const factor = lineSort.direction === "asc" ? 1 : -1;
    return [...content.lines].sort(
      (a, b) => factor * compare(lineSort.key === "name" ? a.name : a.total, lineSort.key === "name" ? b.name : b.total),
    );
  }, [content.lines, lineSort]);

  const toggleTransactionSort = (key: TransactionKey) =>
    setTransactionSort((current) => ({
      key,
      // Dates and amounts open newest/largest first; text opens A–Z.
      direction:
        current.key === key
          ? current.direction === "asc"
            ? "desc"
            : "asc"
          : key === "date" || key === "amount"
            ? "desc"
            : "asc",
    }));

  const toggleLineSort = (key: LineKey) =>
    setLineSort((current) => ({
      key,
      direction: current?.key === key ? (current.direction === "asc" ? "desc" : "asc") : key === "total" ? "desc" : "asc",
    }));

  const shown = transactions.slice(0, MAX_ROWS);
  const empty = content.lines.length === 0 && content.transactions.length === 0;

  return (
    <Modal label={content.title} onClose={onClose}>
      <div className="sankey-drill">
        <header className="sankey-drill__head">
          <h2>{content.title}</h2>
          <p className="sankey-drill__note">{content.note}</p>
        </header>

        <div className="sankey-drill__body">
          {lines.length > 0 && (
            <table className="sankey-drill__table">
              <thead>
                <tr>
                  <SortHeader
                    label="Paycheck"
                    active={lineSort?.key === "name"}
                    direction={lineSort?.direction ?? "asc"}
                    onClick={() => toggleLineSort("name")}
                  />
                  <th>Calculation</th>
                  <SortHeader
                    label="Total"
                    numeric
                    active={lineSort?.key === "total"}
                    direction={lineSort?.direction ?? "desc"}
                    onClick={() => toggleLineSort("total")}
                  />
                </tr>
              </thead>
              <tbody>
                {lines.map((row, index) => (
                  <tr key={`${row.name}-${index}`}>
                    <td>{row.name}</td>
                    <td>{row.detail}</td>
                    <td className="sankey-drill__num">{currencyFormatter.format(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {transactions.length > 0 && (
            <table className="sankey-drill__table">
              <thead>
                <tr>
                  {TRANSACTION_COLUMNS.map((column) => (
                    <SortHeader
                      key={column.key}
                      label={column.label}
                      numeric={column.numeric}
                      active={transactionSort.key === column.key}
                      direction={transactionSort.direction}
                      onClick={() => toggleTransactionSort(column.key)}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{transaction.date}</td>
                    <td>{transaction.description}</td>
                    <td>{transaction.bank}</td>
                    <td className="sankey-drill__num">{currencyFormatter.format(transaction.flow)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {transactions.length > MAX_ROWS && (
            <p className="sankey-drill__note">
              Showing {MAX_ROWS} of {transactions.length} transactions, in this order.
            </p>
          )}
          {empty && <p className="sankey-drill__note">Nothing for {periodLabel}.</p>}
        </div>

        <footer className="sankey-drill__footer">
          <span>
            Total
            {transactions.length > 0 && (
              <small>
                {" "}
                · {transactions.length} transaction{transactions.length === 1 ? "" : "s"}
              </small>
            )}
          </span>
          <strong>{wholeCurrencyFormatter.format(content.total)}</strong>
        </footer>
      </div>
    </Modal>
  );
}

export default SankeyDrill;
