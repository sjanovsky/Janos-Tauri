import { useState } from "react";
import { formatMonthLabel } from "./lib/networth";

type NetWorthMonthsPanelProps = {
  // All current month columns, ascending (always at least one).
  months: string[];
  // How many entered balances each month holds, so deleting one can warn about data loss.
  balanceCountByMonth: Record<string, number>;
  onAddBefore: () => void;
  onAddAfter: () => void;
  // Add every month in [start, end] that isn't already a column.
  onAddRange: (start: string, end: string) => void;
  onDeleteMonth: (month: string) => void;
};

// A valid month is "YYYY-MM" with a month of 01..12.
function isValidMonth(value: string): boolean {
  const match = value.trim().match(/^(\d{4})-(\d{2})$/);
  return match !== null && Number(match[2]) >= 1 && Number(match[2]) <= 12;
}

// The "Months" tab of the Net Worth manage modal: add a column just before the earliest or after
// the latest month, bulk-add a date range, or delete any column (clearing its balances).
function NetWorthMonthsPanel({
  months,
  balanceCountByMonth,
  onAddBefore,
  onAddAfter,
  onAddRange,
  onDeleteMonth,
}: NetWorthMonthsPanelProps) {
  const earliest = months[0];
  const latest = months[months.length - 1];
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleAddRange = () => {
    if (!isValidMonth(rangeStart) || !isValidMonth(rangeEnd)) {
      setError("Enter both months as YYYY-MM (e.g. 2024-01).");
      return;
    }
    setError(null);
    onAddRange(rangeStart.trim(), rangeEnd.trim());
    setRangeStart("");
    setRangeEnd("");
  };

  const handleDelete = (month: string, count: number) => {
    if (
      count > 0 &&
      !window.confirm(
        `Delete ${formatMonthLabel(month)}? This removes ${count} entered balance${count === 1 ? "" : "s"}.`,
      )
    ) {
      return;
    }
    onDeleteMonth(month);
  };

  return (
    <div className="networth-months">
      <p className="networth-import__intro">
        Add or remove the month columns on the chart. Empty months are placeholders for entering balances; deleting a
        month also removes any balances in it.
      </p>

      <div className="networth-months__section">
        <span className="networth-months__section-label">Quick add</span>
        <div className="networth-months__actions">
          <button type="button" className="networth-import__button" onClick={onAddBefore}>
            + Before {formatMonthLabel(earliest)}
          </button>
          <button type="button" className="networth-import__button" onClick={onAddAfter}>
            + After {formatMonthLabel(latest)}
          </button>
        </div>
      </div>

      <div className="networth-months__section">
        <span className="networth-months__section-label">Add a range</span>
        <div className="networth-months__range">
          <input
            type="text"
            className="networth-months__range-input"
            placeholder="YYYY-MM"
            aria-label="Range start month"
            value={rangeStart}
            onChange={(event) => setRangeStart(event.target.value)}
          />
          <span className="networth-months__range-to">to</span>
          <input
            type="text"
            className="networth-months__range-input"
            placeholder="YYYY-MM"
            aria-label="Range end month"
            value={rangeEnd}
            onChange={(event) => setRangeEnd(event.target.value)}
          />
          <button
            type="button"
            className="networth-import__button networth-import__button--primary"
            onClick={handleAddRange}
          >
            Add range
          </button>
        </div>
      </div>

      <div className="networth-months__section">
        <span className="networth-months__section-label">Current months ({months.length})</span>
        <ul className="networth-months__list">
          {months.map((month) => {
            const count = balanceCountByMonth[month] ?? 0;
            return (
              <li key={month} className="networth-months__item">
                <span className="networth-months__item-label">{formatMonthLabel(month)}</span>
                <span className="networth-months__item-count">
                  {count > 0 ? `${count} balance${count === 1 ? "" : "s"}` : "empty"}
                </span>
                <button
                  type="button"
                  className="networth-months__delete"
                  aria-label={`Delete ${formatMonthLabel(month)}`}
                  title="Delete this month"
                  onClick={() => handleDelete(month, count)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {error && <p className="networth-import__error">{error}</p>}
    </div>
  );
}

export default NetWorthMonthsPanel;
