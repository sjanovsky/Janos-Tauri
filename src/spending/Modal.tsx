import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ModalProps = {
  // Accessible name for the dialog; also what screen readers announce on open.
  label: string;
  onClose: () => void;
  children: ReactNode;
};

// A centered overlay dialog rendered into document.body. Closes on backdrop click, the ✕
// button, or Escape. Content is provided by the caller.
function Modal({ label, onClose, children }: ModalProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="app-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="app-modal"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="app-modal__close" aria-label="Close" onClick={onClose}>
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export default Modal;
