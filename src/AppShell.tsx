import { useState } from "react";
import SpendingPage from "./spending/SpendingPage";
import IncomePage from "./income/IncomePage";
import NetWorthPage from "./networth/NetWorthPage";
import TaxesPage from "./taxes/TaxesPage";
import SankeyPage from "./sankey/SankeyPage";
import "./spending/BankImportPage.css";

type View =
  "income" | "paychecks" | "spending" | "networth" | "taxes" | "sankey";

const TABS: { id: View; label: string }[] = [
  { id: "sankey", label: "Overview" },
  { id: "income", label: "Income" },
  { id: "paychecks", label: "Paychecks" },
  { id: "spending", label: "Spending" },
  { id: "taxes", label: "Taxes" },
  { id: "networth", label: "Net Worth" },
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
      </header>

      <main className="import-shell__content">
        {view === "income" && <IncomePage view="income" />}
        {view === "paychecks" && <IncomePage view="paychecks" />}
        {view === "spending" && <SpendingPage />}
        {view === "networth" && <NetWorthPage />}
        {view === "taxes" && <TaxesPage />}
        {view === "sankey" && <SankeyPage />}
      </main>
    </div>
  );
}

export default AppShell;
