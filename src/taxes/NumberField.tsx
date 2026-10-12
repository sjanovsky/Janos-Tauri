import { useState } from "react";

const displayFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

interface NumberFieldProps {
  value: number;
  /** Fires on every valid keystroke so dependent results update live. */
  onChange: (value: number) => void;
  /** Fires once on blur / Enter; this is where the page persists. */
  onCommit: (value: number) => void;
  ariaLabel: string;
  /** Leading symbol inside the field; "" for plain counts. */
  prefix?: string;
  placeholder?: string;
}

function parse(text: string): number {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") {
    return 0;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

// A numeric text input that shows thousands separators at rest and raw digits while editing.
// An empty field means 0 (and renders as a placeholder, so untouched inputs look quiet).
function NumberField({ value, onChange, onCommit, ariaLabel, prefix = "$", placeholder = "0" }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === 0 ? "" : displayFormatter.format(value));

  return (
    <label className="taxes-field">
      {prefix && <span className="taxes-field__prefix">{prefix}</span>}
      <input
        className="taxes-field__input"
        inputMode="decimal"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={shown}
        onFocus={() => setDraft(value === 0 ? "" : String(value))}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(parse(event.target.value));
        }}
        onBlur={() => {
          const next = parse(draft ?? "");
          setDraft(null);
          onChange(next);
          onCommit(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

export default NumberField;
