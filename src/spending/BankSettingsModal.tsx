import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import Modal from "./Modal";
import type { BankRecord } from "./lib/banks";

type BankSettingsModalProps = {
  banks: BankRecord[];
  onClose: () => void;
  onAddBank: (name: string) => void;
  onUpdateBank: (id: string, name: string) => void;
  onDeleteBank: (id: string) => void;
  onSetBankLogo: (id: string, logoDataUrl: string | null) => void;
};

function BankSettingsModal({
  banks,
  onClose,
  onAddBank,
  onUpdateBank,
  onDeleteBank,
  onSetBankLogo,
}: BankSettingsModalProps) {
  const [newBankName, setNewBankName] = useState("");
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});

  useEffect(() => {
    setDraftNames(Object.fromEntries(banks.map((bank) => [bank.id, bank.name])));
  }, [banks]);

  const handleAddBank = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = newBankName.trim();
    if (!trimmed) {
      return;
    }
    onAddBank(trimmed);
    setNewBankName("");
  };

  const saveBankName = (id: string) => {
    const trimmed = (draftNames[id] ?? "").trim();
    if (!trimmed) {
      return;
    }
    onUpdateBank(id, trimmed);
    setDraftNames((current) => ({ ...current, [id]: trimmed }));
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
    <Modal label="Bank logos" onClose={onClose}>
      <div className="bank-settings">
        <div className="bank-settings__header">
          <h2>Bank logos</h2>
          <p>Set the banks you use and upload each bank’s logo so the spending table can show them clearly.</p>
        </div>

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

        <div className="bank-settings__list">
          {banks.length === 0 ? (
            <p className="bank-settings__empty">No banks configured yet.</p>
          ) : (
            banks.map((bank) => (
              <div key={bank.id} className="bank-settings__row">
                <div className="bank-settings__badge">
                  {bank.logoDataUrl ? (
                    <img src={bank.logoDataUrl} alt={`${bank.name} logo`} className="bank-settings__logo" />
                  ) : (
                    <div className="bank-settings__logo-placeholder">{bank.name.slice(0, 2).toUpperCase() || "B"}</div>
                  )}
                  <label className="bank-settings__upload-label">
                    <input type="file" accept="image/*" onChange={(event) => handleLogoUpload(event, bank.id)} />
                    Upload logo
                  </label>
                </div>

                <div className="bank-settings__name-row">
                  <input
                    type="text"
                    value={draftNames[bank.id] ?? bank.name}
                    onChange={(event) =>
                      setDraftNames((current) => ({ ...current, [bank.id]: event.target.value }))
                    }
                    onBlur={() => saveBankName(bank.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        saveBankName(bank.id);
                        event.currentTarget.blur();
                      }
                    }}
                    aria-label={`Rename ${bank.name}`}
                  />

                  <button
                    type="button"
                    className="bank-settings__remove-button"
                    onClick={() => onDeleteBank(bank.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

export default BankSettingsModal;
