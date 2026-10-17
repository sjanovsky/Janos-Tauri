import { useEffect, useRef, useState } from "react";
import { BUCKET_COLOR_PALETTE } from "./lib/categories";

type ColorSwatchPickerProps = {
  value: string;
  label: string;
  onChange: (color: string) => void;
  className?: string;
};

// Round swatch button that opens a popover of curated colors, with a "Custom" escape hatch
// to the native picker.
export function ColorSwatchPicker({ value, label, onChange, className }: ColorSwatchPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="swatch-picker" ref={rootRef}>
      <button
        type="button"
        className={`swatch-picker__button ${className ?? ""}`}
        style={{ background: value }}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      />
      {open ? (
        <div className="swatch-picker__popover" role="dialog" aria-label={label}>
          <div className="swatch-picker__grid">
            {BUCKET_COLOR_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                className={`swatch-picker__option ${color.toLowerCase() === value.toLowerCase() ? "swatch-picker__option--active" : ""}`}
                style={{ background: color }}
                aria-label={color}
                onClick={() => {
                  onChange(color);
                  setOpen(false);
                }}
              />
            ))}
          </div>
          <label className="swatch-picker__custom">
            Custom…
            <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
          </label>
        </div>
      ) : null}
    </span>
  );
}
