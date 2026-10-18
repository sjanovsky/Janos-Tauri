import { useState, type ReactNode } from "react";
import SpendingPage from "./spending/SpendingPage";
import IncomePage from "./income/IncomePage";
import NetWorthPage from "./networth/NetWorthPage";
import TaxesPage from "./taxes/TaxesPage";
import CashFlowPage from "./cashflow/CashFlowPage";
import SankeyPage from "./sankey/SankeyPage";
import UploadPage from "./upload/UploadPage";
import SettingsPage from "./settings/SettingsPage";
import "./spending/BankImportPage.css";

type View =
  "income" | "paychecks" | "spending" | "cashflow" | "networth" | "taxes" | "sankey" | "upload" | "settings";

const TABS: { id: View; label: string }[] = [
  { id: "sankey", label: "Overview" },
  { id: "income", label: "Income" },
  { id: "spending", label: "Spending" },
  { id: "cashflow", label: "Cash Flow" },
  { id: "taxes", label: "Taxes" },
  { id: "networth", label: "Net Worth" },
];

function GearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// Setup pages sit apart from the reporting tabs, right-aligned in the top bar.
const SETUP_TABS: { id: View; label: ReactNode; title?: string }[] = [
  { id: "paychecks", label: "Paychecks" },
  { id: "upload", label: "Upload" },
  { id: "settings", label: <GearIcon />, title: "Settings" },
];

// App-level shell: the Janos top bar with one tab per page. The Overview (income, paychecks, taxes
// and spending as one diagram) is the home page the other pages' numbers tie back to. Each tab swaps the page rendered
// in the content area; pages own their own state and data.
function AppShell() {
  const [view, setView] = useState<View>("sankey");

  return (
    <div className="import-shell">
      <header className="import-shell__topbar">
        <div className="import-shell__brand">Janos</div>
        <nav className="import-shell__tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`shell-tab ${view === tab.id ? "shell-tab--active" : ""}`}
              onClick={() => setView(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <nav className="import-shell__tabs import-shell__tabs--setup">
          {SETUP_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`shell-tab ${view === tab.id ? "shell-tab--active" : ""}`}
              onClick={() => setView(tab.id)}
              title={tab.title}
              aria-label={tab.title}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="import-shell__content">
        {view === "income" && <IncomePage view="income" />}
        {view === "paychecks" && <IncomePage view="paychecks" />}
        {view === "spending" && <SpendingPage />}
        {view === "cashflow" && <CashFlowPage />}
        {view === "networth" && <NetWorthPage />}
        {view === "taxes" && <TaxesPage />}
        {view === "sankey" && <SankeyPage />}
        {view === "upload" && <UploadPage />}
        {view === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}

export default AppShell;
