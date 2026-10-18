import { useState } from "react";

type PlanningFieldProps = {
  // What the field shows at rest (the override, or the value pulled from another page).
  text: string;
  ariaLabel: string;
  prefix?: string;
  placeholder?: string;
  overridden?: boolean;
  // Fires once on blur / Enter with what was typed.
  onCommit: (text: string) => void;
};

// A text input that shows its value at rest and commits on blur or Enter. Whether the value counts
// as an override or a reset is the caller's call.
function PlanningField({ text, ariaLabel, prefix = "$", placeholder = "0", overridden = false, onCommit }: PlanningFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <label className={`planning-field${overridden ? " planning-field--overridden" : ""}`}>
      {prefix && <span className="planning-field__prefix">{prefix}</span>}
      <input
        className="planning-field__input"
        inputMode="decimal"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={draft ?? text}
        onFocus={() => setDraft(text)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const typed = draft ?? text;
          setDraft(null);
          if (typed !== text) {
            onCommit(typed);
          }
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

export default PlanningField;
