import { useState, type ComponentProps, type ReactNode } from "react";
import Modal from "../spending/Modal";
import SankeyBucketsPanel from "./SankeyBucketsPanel";
import SankeyRulesPanel from "./SankeyRulesPanel";

export type SankeyManageTab = "buckets" | "rules";

type SankeyManageModalProps = {
  onClose: () => void;
  initialTab?: SankeyManageTab;
  buckets: ComponentProps<typeof SankeyBucketsPanel>;
  rules: ComponentProps<typeof SankeyRulesPanel>;
};

function BucketsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16l-1.5 13a1 1 0 0 1-1 .9H6.5a1 1 0 0 1-1-.9z" />
      <path d="M3.5 6l1-2.4a1 1 0 0 1 .92-.6h13.16a1 1 0 0 1 .92.6l1 2.4" />
    </svg>
  );
}

function RulesIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h18l-7 8v6l-4 2v-8z" />
    </svg>
  );
}

const TABS: { id: SankeyManageTab; label: string; icon: ReactNode }[] = [
  { id: "buckets", label: "Buckets & categories", icon: <BucketsIcon /> },
  { id: "rules", label: "Description rules", icon: <RulesIcon /> },
];

// The overview's manage modal, using the same tab strip as the Spending, Net Worth and Taxes
// modals: the buckets and categories, and the description rules that route bank transactions.
function SankeyManageModal({ onClose, initialTab = "buckets", buckets, rules }: SankeyManageModalProps) {
  const [tab, setTab] = useState<SankeyManageTab>(initialTab);

  return (
    <Modal label="Manage the overview" onClose={onClose}>
      <div className="manage-modal">
        <nav className="manage-modal__tabs" role="tablist" aria-label="Manage the overview">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={`manage-modal__tab ${tab === entry.id ? "manage-modal__tab--active" : ""}`}
              onClick={() => setTab(entry.id)}
            >
              <span className="manage-modal__tab-icon">{entry.icon}</span>
              {entry.label}
            </button>
          ))}
        </nav>
        <div className="manage-modal__body">
          {tab === "buckets" && <SankeyBucketsPanel {...buckets} />}
          {tab === "rules" && <SankeyRulesPanel {...rules} />}
        </div>
      </div>
    </Modal>
  );
}

export default SankeyManageModal;
