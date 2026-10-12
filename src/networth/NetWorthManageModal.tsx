import { useState, type ComponentProps, type ReactNode } from "react";
import Modal from "../spending/Modal";
import NetWorthImportModal from "./NetWorthImportModal";
import NetWorthMonthsPanel from "./NetWorthMonthsPanel";
import AccountsAndBuckets from "./AccountsAndBuckets";

// Which panel the Net Worth manage modal shows. The toolbar's Settings button and the empty-state
// links each open the modal straight to the tab they're about.
export type NetWorthManageTab = "upload" | "months" | "accounts";

type NetWorthManageModalProps = {
  initialTab: NetWorthManageTab;
  onClose: () => void;
  upload: ComponentProps<typeof NetWorthImportModal>;
  months: ComponentProps<typeof NetWorthMonthsPanel>;
  accounts: ComponentProps<typeof AccountsAndBuckets>;
};

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function MonthsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 2v4" />
      <path d="M16 2v4" />
    </svg>
  );
}

function AccountsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16l-1.5 13a1 1 0 0 1-1 .9H6.5a1 1 0 0 1-1-.9z" />
      <path d="M3.5 6l1-2.4a1 1 0 0 1 .92-.6h13.16a1 1 0 0 1 .92.6l1 2.4" />
      <path d="M9 11v4" />
      <path d="M15 11v4" />
    </svg>
  );
}

const TABS: { id: NetWorthManageTab; label: string; icon: ReactNode }[] = [
  { id: "upload", label: "Upload", icon: <UploadIcon /> },
  { id: "months", label: "Months", icon: <MonthsIcon /> },
  { id: "accounts", label: "Accounts & buckets", icon: <AccountsIcon /> },
];

// One modal for the Net Worth page's management tasks — importing balances from a spreadsheet and
// organizing accounts & buckets — behind a tab strip, mirroring the Spending page's manage modal.
function NetWorthManageModal({ initialTab, onClose, upload, months, accounts }: NetWorthManageModalProps) {
  const [activeTab, setActiveTab] = useState<NetWorthManageTab>(initialTab);
  const activeLabel = TABS.find((tab) => tab.id === activeTab)?.label ?? "Manage";

  return (
    <Modal label={activeLabel} onClose={onClose}>
      <div className="manage-modal">
        <nav className="manage-modal__tabs" role="tablist" aria-label="Manage net worth">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`manage-modal__tab ${activeTab === tab.id ? "manage-modal__tab--active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="manage-modal__tab-icon">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="manage-modal__body">
          {activeTab === "upload" && <NetWorthImportModal {...upload} />}
          {activeTab === "months" && <NetWorthMonthsPanel {...months} />}
          {activeTab === "accounts" && <AccountsAndBuckets {...accounts} />}
        </div>
      </div>
    </Modal>
  );
}

export default NetWorthManageModal;
