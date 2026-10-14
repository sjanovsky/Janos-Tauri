import Modal from "../spending/Modal";
import { currencyFormatter, wholeCurrencyFormatter } from "../spending/lib/format";
import type { FlowTransaction, SankeyLineRecord } from "./lib/flow";

export type DrillContent = {
  title: string;
  // One-line explanation of where the number comes from.
  note: string;
  total: number;
  // Paycheck lines behind a bucket or category.
  lines: { name: string; line: SankeyLineRecord | undefined }[];
  transactions: FlowTransaction[];
};

type SankeyDrillProps = {
  content: DrillContent;
  year: number;
  onClose: () => void;
};

const MAX_ROWS = 300;

// What stands behind a node: the paycheck numbers entered for it and/or the bank transactions that
// add up to it. Transaction amounts are shown as money out (+) or in (−) whatever the bank's sign.
function SankeyDrill({ content, year, onClose }: SankeyDrillProps) {
  const shown = content.transactions.slice(0, MAX_ROWS);
  return (
    <Modal label={content.title} onClose={onClose}>
      <div className="sankey-drill">
        <header className="sankey-drill__head">
          <h2>{content.title}</h2>
          <strong>{wholeCurrencyFormatter.format(content.total)}</strong>
        </header>
        <p className="sankey-drill__note">{content.note}</p>

        {content.lines.length > 0 && (
          <table className="sankey-drill__table">
            <thead>
              <tr>
                <th>Paycheck line</th>
                <th>{year} to date</th>
                <th>Last paycheck</th>
              </tr>
            </thead>
            <tbody>
              {content.lines.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{wholeCurrencyFormatter.format(row.line?.ytd ?? 0)}</td>
                  <td>{wholeCurrencyFormatter.format(row.line?.lastPaycheck ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {content.transactions.length > 0 && (
          <table className="sankey-drill__table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Bank</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{transaction.date}</td>
                  <td>{transaction.description}</td>
                  <td>{transaction.bank}</td>
                  <td>{currencyFormatter.format(transaction.flow)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {content.transactions.length > MAX_ROWS && (
          <p className="sankey-drill__note">
            Showing the {MAX_ROWS} most recent of {content.transactions.length} transactions.
          </p>
        )}
        {content.lines.length === 0 && content.transactions.length === 0 && (
          <p className="sankey-drill__note">Nothing for {year} yet.</p>
        )}
      </div>
    </Modal>
  );
}

export default SankeyDrill;
