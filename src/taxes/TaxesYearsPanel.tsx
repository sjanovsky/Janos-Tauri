import { useState } from "react";

type TaxesYearsPanelProps = {
  // Every year on the page, ascending (always at least one).
  years: number[];
  // How many lines (income, deductions, withholdings) each year holds, so deleting can warn.
  itemCountByYear: Record<number, number>;
  onAddYear: (year: number) => void;
  onDeleteYear: (year: number) => void;
};

const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

// The "Years" tab of the Taxes settings modal: add the next or previous year, add any specific
// year, or delete a year along with its numbers.
function TaxesYearsPanel({ years, itemCountByYear, onAddYear, onDeleteYear }: TaxesYearsPanelProps) {
  const earliest = years[0];
  const latest = years[years.length - 1];
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The year awaiting delete confirmation. Native window.confirm doesn't work in the macOS
  // webview, so deleting asks inline instead.
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  const handleAddTyped = () => {
    const value = Number(typed.trim());
    if (!Number.isInteger(value) || value < MIN_YEAR || value > MAX_YEAR) {
      setError(`Enter a four-digit year between ${MIN_YEAR} and ${MAX_YEAR}.`);
      return;
    }
    if (years.includes(value)) {
      setError(`${value} is already here.`);
      return;
    }
    setError(null);
    onAddYear(value);
    setTyped("");
  };

  const confirmDelete = (year: number) => {
    setPendingDelete(null);
    onDeleteYear(year);
  };

  return (
    <div className="networth-months">
      <p className="networth-import__intro">
        Add the years you want to project. Each year keeps its own income, deductions, withholdings and tax lines;
        deleting a year removes its numbers.
      </p>

      <div className="networth-months__section">
        <span className="networth-months__section-label">Add a year</span>
        <div className="networth-months__controls">
          <button type="button" className="networth-import__button" onClick={() => onAddYear(earliest - 1)}>
            + {earliest - 1}
          </button>
          <button type="button" className="networth-import__button" onClick={() => onAddYear(latest + 1)}>
            + {latest + 1}
          </button>
          <input
            type="text"
            inputMode="numeric"
            className="networth-months__range-input"
            placeholder="YYYY"
            aria-label="Year to add"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleAddTyped();
              }
            }}
          />
          <button
            type="button"
            className="networth-import__button networth-import__button--primary"
            onClick={handleAddTyped}
          >
            Add year
          </button>
        </div>
      </div>

      <div className="networth-months__section">
        <span className="networth-months__section-label">Current years ({years.length})</span>
        <ul className="networth-months__list">
          {years.map((year) => {
            const count = itemCountByYear[year] ?? 0;
            return (
              <li key={year} className="networth-months__item">
                <span className="networth-months__item-label">{year}</span>
                {pendingDelete === year ? (
                  <div className="networth-months__confirm">
                    <span className="networth-months__confirm-text">
                      Delete {year} and its {count} line{count === 1 ? "" : "s"}?
                    </span>
                    <button
                      type="button"
                      className="networth-months__confirm-btn networth-months__confirm-btn--danger"
                      onClick={() => confirmDelete(year)}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      className="networth-months__confirm-btn"
                      onClick={() => setPendingDelete(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="networth-months__item-count">
                      {count > 0 ? `${count} line${count === 1 ? "" : "s"}` : "empty"}
                    </span>
                    {years.length > 1 && (
                      <button
                        type="button"
                        className="networth-months__delete"
                        aria-label={`Delete ${year}`}
                        title="Delete this year"
                        onClick={() => setPendingDelete(year)}
                      >
                        ×
                      </button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {error && <p className="networth-import__error">{error}</p>}
    </div>
  );
}

export default TaxesYearsPanel;
