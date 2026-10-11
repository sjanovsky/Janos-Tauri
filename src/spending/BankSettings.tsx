import { useState, type ChangeEvent, type FormEvent } from "react";
import type { BankRecord } from "./lib/banks";

export type BankSettingsProps = {
  banks: BankRecord[];
  onAddBank: (name: string) => void;
  onUpdateBank: (id: string, name: string) => void;
  onDeleteBank: (id: string) => void;
  onSetBankLogo: (id: string, logoDataUrl: string | null) => void;
};

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

// The bank-logos panel: add/rename/remove the banks you use and upload each bank's logo so the
// spending table can show it. Laid out like the recent-uploads table — bank name on the left, a
// clickable logo chip (click it to upload), and a trash action. Rendered inside the manage modal's
// "Banks" tab (the modal owns the surrounding chrome and close button).
function BankSettings({ banks, onAddBank, onUpdateBank, onDeleteBank, onSetBankLogo }: BankSettingsProps) {
  const [newBankName, setNewBankName] = useState("");

  const handleAddBank = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = newBankName.trim();
    if (!trimmed) {
      return;
    }
    onAddBank(trimmed);
    setNewBankName("");
  };

  const handleLogoUpload = (event: ChangeEvent<HTMLInputElement>, id: string) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      onSetBankLogo(id, typeof reader.result === "string" ? reader.result : null);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  return (
    <div className="bank-settings">
      <div className="bank-settings__header">
        <h2>Bank logos</h2>
        <p>Set the banks you use and upload each bank’s logo so the spending table can show them clearly.</p>
      </div>

      {banks.length === 0 ? (
        <p className="bank-settings__empty">No banks configured yet.</p>
      ) : (
        <div className="import-shell__table-shell">
          <table className="import-shell__table bank-settings-table">
            <thead>
              <tr>
                <th className="bank-settings-table__logo-col">Logo</th>
                <th>Bank</th>
                <th className="uploads-table__actions" aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {banks.map((bank) => (
                <tr key={bank.id}>
                  <td className="bank-settings-table__logo-col">
                    <label
                      className="bank-settings__logo-button"
                      title="Click to upload a logo"
                      aria-label={`Upload a logo for ${bank.name}`}
                    >
                      <input type="file" accept="image/*" onChange={(event) => handleLogoUpload(event, bank.id)} />
                      {bank.logoDataUrl ? (
                        <img src={bank.logoDataUrl} alt={`${bank.name} logo`} className="bank-settings__logo" />
                      ) : (
                        <span className="bank-settings__logo-placeholder">
                          {bank.name.slice(0, 2).toUpperCase() || "B"}
                        </span>
                      )}
                    </label>
                  </td>
                  <td>
                    <input
                      key={bank.name}
                      className="uploads-table__name-input"
                      defaultValue={bank.name}
                      aria-label={`Rename ${bank.name}`}
                      onBlur={(event) => {
                        const trimmed = event.target.value.trim();
                        if (trimmed && trimmed !== bank.name) {
                          onUpdateBank(bank.id, trimmed);
                        } else {
                          event.target.value = bank.name;
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        } else if (event.key === "Escape") {
                          event.currentTarget.value = bank.name;
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  </td>
                  <td className="uploads-table__actions">
                    <button
                      type="button"
                      className="import-shell__upload-delete"
                      aria-label={`Remove ${bank.name}`}
                      onClick={() => onDeleteBank(bank.id)}
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form className="bank-settings__form" onSubmit={handleAddBank}>
        <input
          type="text"
          value={newBankName}
          onChange={(event) => setNewBankName(event.target.value)}
          placeholder="Add a bank name"
          aria-label="Add a bank name"
        />
        <button type="submit" className="bank-settings__primary-button">
          Add bank
        </button>
      </form>
    </div>
  );
}

export default BankSettings;
