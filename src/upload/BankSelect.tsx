import { useEffect, useRef, useState } from "react";
import type { BankRecord } from "../spending/lib/banks";

type BankSelectProps = {
  banks: BankRecord[];
  // The selected bank's name (empty when nothing is chosen yet).
  value: string;
  onChange: (bankName: string) => void;
};

// A bank's logo chip, falling back to a two-letter monogram when no logo is uploaded — the same
// look the Banks settings tab uses, shrunk to sit inside the select.
function BankChip({ bank }: { bank: BankRecord }) {
  return bank.logoDataUrl ? (
    <img src={bank.logoDataUrl} alt="" className="bank-select__logo" />
  ) : (
    <span className="bank-select__logo bank-select__logo--placeholder" aria-hidden="true">
      {bank.name.slice(0, 2).toUpperCase() || "B"}
    </span>
  );
}

// A dropdown for picking the bank a report belongs to from the banks configured in settings.
// Unlike a native <select>, each option shows the bank's logo alongside its name. Follows the
// same open/close conventions as MultiSelectFilter (click away or press Escape to close).
function BankSelect({ banks, value, onChange }: BankSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const hasBanks = banks.length > 0;
  const selected = banks.find((bank) => bank.name === value) ?? null;

  return (
    <div className="bank-select" ref={containerRef}>
      <button
        type="button"
        className="bank-select__trigger"
        onClick={() => {
          if (hasBanks) {
            setOpen((prev) => !prev);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={!hasBanks}
      >
        {selected ? (
          <span className="bank-select__value">
            <BankChip bank={selected} />
            <span className="bank-select__name">{selected.name}</span>
          </span>
        ) : (
          <span className="bank-select__placeholder-text">
            {hasBanks ? "Select a bank" : "No banks set up — add one in the Banks tab"}
          </span>
        )}
        {hasBanks && (
          <span className="bank-select__caret" aria-hidden="true">
            ▾
          </span>
        )}
      </button>

      {open && hasBanks && (
        <div className="bank-select__panel" role="listbox">
          {banks.map((bank) => (
            <button
              key={bank.id}
              type="button"
              role="option"
              aria-selected={bank.name === value}
              className={`bank-select__option ${
                bank.name === value ? "bank-select__option--selected" : ""
              }`}
              onClick={() => {
                onChange(bank.name);
                setOpen(false);
              }}
            >
              <BankChip bank={bank} />
              <span className="bank-select__name">{bank.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default BankSelect;
