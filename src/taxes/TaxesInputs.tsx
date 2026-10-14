import type { CSSProperties } from "react";
import NumberField from "./NumberField";
import {
  SECTION_COLORS,
  TAX_LINE_FIELDS,
  projectItem,
  type SectionTone,
  type TaxItemRecord,
  type TaxLineField,
} from "./lib/taxes";
import { wholeCurrencyFormatter } from "../spending/lib/format";

interface LinesPanelProps {
  title: string;
  tone: SectionTone;
  description: string;
  emptyText: string;
  items: TaxItemRecord[];
  total: number;
  onChange: (
    id: string,
    changes: Partial<Pick<TaxItemRecord, "name" | "ytd" | "lastPaycheck" | "paychecksLeft">>,
    persist: boolean,
  ) => void;
}

// A table of lines: the name, year to date, last paycheck, paychecks left, and the calculated
// year-end (year to date + last paycheck × paychecks left). Used for Income, Deductions and
// Withholdings. The lines themselves are the overview's paycheck categories (so the numbers are
// entered once and tie to the diagram); only their amounts are edited here. A one-off amount just
// needs a year-to-date value.
export function LinesPanel({
  title,
  tone,
  description,
  emptyText,
  items,
  total,
  onChange,
}: LinesPanelProps) {
  return (
    <div className="taxes-card">
      <div
        className={`taxes-card__header taxes-card__header--banner taxes-tone--${tone}`}
        style={{ "--tone-accent": SECTION_COLORS[tone] } as CSSProperties}
      >
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="taxes-card__total">{wholeCurrencyFormatter.format(total)}</div>
      </div>

      <div className="taxes-lines-table">
        {items.length > 0 && (
          <div className="taxes-lines-table__head">
            <span>Name</span>
            <span>Year to date</span>
            <span>Last paycheck</span>
            <span>Paycheck</span>
            <span>Year-end</span>
          </div>
        )}
        {items.length === 0 && <p className="taxes-empty">{emptyText}</p>}
        {items.map((item) => (
          <div className="taxes-lines-table__row" key={item.id}>
            <span className="taxes-lines-table__name taxes-lines-table__name--static">{item.name}</span>
            <NumberField
              value={item.ytd}
              ariaLabel={`${item.name} year to date`}
              onChange={(ytd) => onChange(item.id, { ytd }, false)}
              onCommit={(ytd) => onChange(item.id, { ytd }, true)}
            />
            <NumberField
              value={item.lastPaycheck}
              ariaLabel={`${item.name} last paycheck`}
              onChange={(lastPaycheck) => onChange(item.id, { lastPaycheck }, false)}
              onCommit={(lastPaycheck) => onChange(item.id, { lastPaycheck }, true)}
            />
            <NumberField
              value={item.paychecksLeft}
              ariaLabel={`${item.name} paychecks left`}
              prefix=""
              onChange={(paychecksLeft) => onChange(item.id, { paychecksLeft }, false)}
              onCommit={(paychecksLeft) => onChange(item.id, { paychecksLeft }, true)}
            />
            <span className="taxes-lines-table__projected">{wholeCurrencyFormatter.format(projectItem(item))}</span>
          </div>
        ))}
      </div>
      <p className="taxes-note">
        Lines come from the Overview tab, where you add, rename and remove them and enter these numbers once.
      </p>
    </div>
  );
}

interface TaxLinesPanelProps {
  values: Partial<Record<TaxLineField, number>>;
  onChange: (field: TaxLineField, value: number, persist: boolean) => void;
}

// The household tax lines the MVP takes as typed-in numbers rather than deriving. Laid out like
// Other income (name, amount); the lines themselves are fixed, so there's nothing to add or delete.
export function TaxLinesPanel({ values, onChange }: TaxLinesPanelProps) {
  const total = TAX_LINE_FIELDS.filter((line) => line.sub !== "amount").reduce(
    (sum, line) => sum + (values[line.key] ?? 0),
    0,
  );

  return (
    <div className="taxes-card">
      <div
        className="taxes-card__header taxes-card__header--banner taxes-tone--violet"
        style={{ "--tone-accent": SECTION_COLORS.violet } as CSSProperties}
      >
        <div>
          <h2>Other federal taxes</h2>
          <p>Amounts you've worked out elsewhere. Qualified dividends are taken out of the regular brackets.</p>
        </div>
        <div className="taxes-card__total">{wholeCurrencyFormatter.format(total)}</div>
      </div>
      <div className="taxes-other">
        {TAX_LINE_FIELDS.map(({ key, label, sub }) => (
          <div className="taxes-other__row" key={key}>
            <span className="taxes-other__static">
              {label} <small>{sub}</small>
            </span>
            <NumberField
              value={values[key] ?? 0}
              ariaLabel={`${label} ${sub}`}
              onChange={(value) => onChange(key, value, false)}
              onCommit={(value) => onChange(key, value, true)}
            />
            <span className="taxes-other__spacer" aria-hidden="true" />
          </div>
        ))}
      </div>
    </div>
  );
}
