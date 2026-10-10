import { useState, type ChangeEvent, type DragEvent } from "react";
import "./BankImportPage.css";

type BankOption = {
  id: string;
  name: string;
  initials: string;
  accent: string;
};

const banks: BankOption[] = [
  { id: "amex", name: "AMEX", initials: "AX", accent: "#2d6cdf" },
  { id: "chase", name: "Chase", initials: "C", accent: "#1177d6" },
  { id: "boa", name: "BoA", initials: "B", accent: "#0f7a4a" },
  { id: "capital-one", name: "Capital One", initials: "CO", accent: "#8a2be2" },
  { id: "citi", name: "Citi", initials: "CI", accent: "#e31b46" },
  { id: "schwab", name: "Schwab", initials: "S", accent: "#0f766e" },
  { id: "fidelity", name: "Fidelity", initials: "F", accent: "#b45309" },
  { id: "coinbase", name: "Coinbase", initials: "CB", accent: "#ff9500" },
];

function BankImportPage() {
  const [selectedFiles, setSelectedFiles] = useState<Record<string, string>>({});
  const [activeBank, setActiveBank] = useState<string | null>(null);

  const handleFileSelection = (bankId: string, file: File | null) => {
    if (!file) {
      return;
    }

    setSelectedFiles((current) => ({
      ...current,
      [bankId]: file.name,
    }));
  };

  const handleInputChange = (
    event: ChangeEvent<HTMLInputElement>,
    bankId: string,
  ) => {
    const file = event.target.files?.[0] ?? null;
    handleFileSelection(bankId, file);
    event.target.value = "";
  };

  const handleDrop = (
    event: DragEvent<HTMLLabelElement>,
    bankId: string,
  ) => {
    event.preventDefault();
    setActiveBank(null);

    const file = event.dataTransfer.files?.[0] ?? null;
    handleFileSelection(bankId, file);
  };

  return (
    <main className="import-page">
      <section className="import-page__hero">
        <p className="import-page__eyebrow">Import bank statements</p>
        <h1>Choose a bank to start your import</h1>
        <p className="import-page__subtitle">
          Click a card to select a file or drag one onto it.
        </p>
      </section>

      <section className="import-page__grid" aria-label="Bank import options">
        {banks.map((bank) => {
          const selectedFileName = selectedFiles[bank.id];
          const isActive = activeBank === bank.id;

          return (
            <label
              key={bank.id}
              className={`bank-card ${isActive ? "bank-card--active" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setActiveBank(bank.id);
              }}
              onDragLeave={() => setActiveBank((current) => (current === bank.id ? null : current))}
              onDrop={(event) => handleDrop(event, bank.id)}
            >
              <span className="bank-card__logo" style={{ backgroundColor: bank.accent }}>
                {bank.initials}
              </span>

              <span className="bank-card__content">
                <span className="bank-card__name">{bank.name}</span>
                <span className="bank-card__hint">
                  {selectedFileName ? `Selected: ${selectedFileName}` : "Click or drop file"}
                </span>
              </span>

              <input
                type="file"
                className="bank-card__input"
                onChange={(event) => handleInputChange(event, bank.id)}
              />
            </label>
          );
        })}
      </section>
    </main>
  );
}

export default BankImportPage;
