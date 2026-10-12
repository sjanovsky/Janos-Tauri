import { useState } from "react";
import SpendingPage from "./spending/SpendingPage";
import NetWorthPage from "./networth/NetWorthPage";
import TaxesPage from "./taxes/TaxesPage";
import "./spending/BankImportPage.css";

type View = "spending" | "networth" | "taxes";

const TABS: { id: View; label: string }[] = [
  { id: "spending", label: "Spending" },
  { id: "networth", label: "Net Worth" },
  { id: "taxes", label: "Taxes" },
];

// App-level shell: the Janos top bar with one tab per page. Each tab swaps the page rendered
// in the content area; pages own their own state and data.
function AppShell() {
  const [view, setView] = useState<View>("spending");

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
      </header>

      <main className="import-shell__content">
        {view === "spending" && <SpendingPage />}
        {view === "networth" && <NetWorthPage />}
        {view === "taxes" && <TaxesPage />}
      </main>
    </div>
  );
}

export default AppShell;
