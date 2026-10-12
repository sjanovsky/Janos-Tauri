import WaterfallChart from "./WaterfallChart";
import { wholeCurrencyFormatter } from "../spending/lib/format";
import { BRACKET_SHADES, buildWaterfall, type FederalResult } from "./lib/taxes";

const money = (value: number) => wholeCurrencyFormatter.format(value);
const percent = (value: number) => `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;

interface TaxesResultsProps {
  result: FederalResult;
  year: number;
  /** False when the year has no dedicated tax table and a nearby one was used. */
  tableExact: boolean;
  tableYear: number;
  years: number[];
  onSelectYear: (year: number) => void;
  onOpenSettings: () => void;
}

function TaxesResults({ result, year, tableExact, tableYear, years, onSelectYear, onOpenSettings }: TaxesResultsProps) {
  const owes = result.balance < 0;
  const used = result.slices.filter((slice) => slice.amount > 0);
  const top = used[used.length - 1];
  const nextBracket = top ? result.slices.find((slice) => slice.min === (top.max ?? Infinity)) : undefined;
  const headroom = top && top.max !== null ? top.max - result.normalTaxable : null;

  return (
    <>
      <div className={`taxes-hero ${owes ? "taxes-hero--owe" : "taxes-hero--refund"}`}>
        <div className="taxes-hero__row">
          <div className="taxes-hero__main">
            <div className="taxes-hero__amount">{money(Math.abs(result.balance))}</div>
            <div className="taxes-hero__side">
              <div className="taxes-hero__label">{owes ? "You owe" : "Projected refund"}</div>
              <div className="taxes-hero__math">
                <span>
                  <strong>{money(result.totalOwed)}</strong> owed
                </span>
                <span>−</span>
                <span>
                  <strong>{money(result.withheld)}</strong> withheld
                </span>
              </div>
            </div>
          </div>
          <div className="taxes-hero__stats">
            <span>Effective rate</span>
            <strong>{percent(result.effectiveRate)}</strong>
          </div>
          <div className="taxes-hero__years" role="tablist" aria-label="Tax year">
            {years.map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={value === year}
                className={`taxes-hero__year ${value === year ? "taxes-hero__year--active" : ""}`}
                onClick={() => onSelectYear(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="taxes-hero__settings"
            aria-label="Open settings"
            title="Settings"
            onClick={onOpenSettings}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
        {!tableExact && (
          <p className="taxes-hero__note">
            No {year} tax table yet — using {tableYear} brackets and standard deduction.
          </p>
        )}
      </div>

      <div className="taxes-card">
        <div className="taxes-card__header">
          <div>
            <h2>From earnings to {owes ? "balance due" : "refund"}</h2>
            <p>
              Earnings, less deductions, is taxable income; that's taxed, then what's already been withheld comes
              off. Hover any piece for details. Roth contributions are after-tax, so they don't reduce income.
            </p>
          </div>
        </div>
        <WaterfallChart bars={buildWaterfall(result)} title="Earnings to refund or balance due" />
      </div>

      <div className="taxes-card">
        <div className="taxes-card__header">
          <div>
            <h2>How the income tax is built</h2>
            <p>
              Each slice of {money(result.normalTaxable)} is taxed at its own bracket's rate — only the dollars
              inside a bracket get that rate.
              {result.qualifiedTaxable > 0 && ` (${money(result.qualifiedTaxable)} of qualified dividends is taxed separately.)`}
            </p>
          </div>
        </div>

        {used.length === 0 ? (
          <p className="taxes-empty">No taxable income yet — enter earnings to see the brackets fill.</p>
        ) : (
          <>
            <div className="taxes-brackets__bar" role="img" aria-label="Taxable income split by bracket">
              {used.map((slice) => (
                <div
                  key={slice.rate}
                  className="taxes-brackets__segment"
                  style={{
                    flexGrow: slice.amount,
                    background: BRACKET_SHADES[result.slices.indexOf(slice)],
                    color: result.slices.indexOf(slice) < 2 ? "#1e1b4b" : "#ffffff",
                  }}
                  title={`${percent(slice.rate)}: ${money(slice.amount)} → ${money(slice.tax)}`}
                >
                  {percent(slice.rate)}
                </div>
              ))}
            </div>

            <table className="taxes-brackets__table">
              <thead>
                <tr>
                  <th>Bracket</th>
                  <th>Income in bracket</th>
                  <th>Rate</th>
                  <th>Tax</th>
                </tr>
              </thead>
              <tbody>
                {used.map((slice) => (
                  <tr key={slice.rate}>
                    <td>
                      <span
                        className="taxes-brackets__swatch"
                        style={{ background: BRACKET_SHADES[result.slices.indexOf(slice)] }}
                      />
                      {money(slice.min)} – {slice.max === null ? "and up" : money(slice.max)}
                    </td>
                    <td>{money(slice.amount)}</td>
                    <td>{percent(slice.rate)}</td>
                    <td>{money(slice.tax)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Regular income tax</td>
                  <td>{money(result.normalTaxable)}</td>
                  <td>{result.normalTaxable > 0 ? percent(result.normalTax / result.normalTaxable) : "—"}</td>
                  <td>{money(result.normalTax)}</td>
                </tr>
              </tfoot>
            </table>

            {top && (
              <p className="taxes-brackets__hint">
                The next dollar you earn is taxed at <strong>{percent(top.rate)}</strong>
                {headroom !== null && nextBracket
                  ? `; you have ${money(headroom)} of room before the ${percent(nextBracket.rate)} bracket.`
                  : "."}
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}

export default TaxesResults;
