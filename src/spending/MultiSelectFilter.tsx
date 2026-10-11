import { useEffect, useRef, useState } from "react";

export type FilterOption = { value: string; label: string };

type MultiSelectFilterProps = {
  label: string;
  options: FilterOption[];
  // Values that are unchecked (excluded from the result). Empty = everything shown.
  excluded: Set<string>;
  onChange: (excluded: Set<string>) => void;
};

// A dropdown of checkboxes used to filter the transactions table by a single field (bank or
// category). Multiple options can be checked at once, with select-all / deselect-all shortcuts.
function MultiSelectFilter({ label, options, excluded, onChange }: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close when clicking away or pressing Escape.
  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointer = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const selectedCount = options.reduce(
    (count, option) => (excluded.has(option.value) ? count : count + 1),
    0,
  );
  const allSelected = selectedCount === options.length;

  const toggle = (value: string) => {
    const next = new Set(excluded);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onChange(next);
  };

  const selectAll = () => onChange(new Set());
  const deselectAll = () => onChange(new Set(options.map((option) => option.value)));

  return (
    <div className="import-shell__filter-dropdown" ref={containerRef}>
      <button
        type="button"
        className={`import-shell__filter-dropdown-trigger ${
          allSelected ? "" : "import-shell__filter-dropdown-trigger--active"
        }`}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        {label}
        {!allSelected && (
          <span className="import-shell__filter-dropdown-badge">{selectedCount}</span>
        )}
        <span className="import-shell__filter-dropdown-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="import-shell__filter-dropdown-panel">
          <div className="import-shell__filter-dropdown-actions">
            <button type="button" onClick={selectAll}>
              Select all
            </button>
            <button type="button" onClick={deselectAll}>
              Deselect all
            </button>
          </div>
          <div className="import-shell__filter-dropdown-options">
            {options.map((option) => (
              <label key={option.value} className="import-shell__filter-dropdown-option">
                <input
                  type="checkbox"
                  checked={!excluded.has(option.value)}
                  onChange={() => toggle(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default MultiSelectFilter;
