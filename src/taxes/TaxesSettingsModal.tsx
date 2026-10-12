import Modal from "../spending/Modal";
import TaxesYearsPanel from "./TaxesYearsPanel";
import type { ComponentProps } from "react";

type TaxesSettingsModalProps = {
  onClose: () => void;
  years: ComponentProps<typeof TaxesYearsPanel>;
};

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 2v4" />
      <path d="M16 2v4" />
    </svg>
  );
}

// The Taxes page's settings modal, using the same tab strip as the Spending and Net Worth manage
// modals. Years is the only tab for now.
function TaxesSettingsModal({ onClose, years }: TaxesSettingsModalProps) {
  return (
    <Modal label="Taxes settings" onClose={onClose}>
      <div className="manage-modal">
        <nav className="manage-modal__tabs" role="tablist" aria-label="Taxes settings">
          <button type="button" role="tab" aria-selected className="manage-modal__tab manage-modal__tab--active">
            <span className="manage-modal__tab-icon">
              <CalendarIcon />
            </span>
            Years
          </button>
        </nav>
        <div className="manage-modal__body">
          <TaxesYearsPanel {...years} />
        </div>
      </div>
    </Modal>
  );
}

export default TaxesSettingsModal;
