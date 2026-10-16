import { useEffect, useState } from "react";
import { formatDate, formatRange, formatUploadDate, type BankSummary } from "./lib/uploads";

type BankListProps = {
  banks: BankSummary[];
  // Key of the bank filtering the transaction list, or null for all banks.
  selectedKey: string | null;
  // The upload narrowing the list further (within selectedKey's bank), if any.
  selectedUploadId: string | null;
  onSelect: (key: string) => void;
  onSelectUpload: (bankKey: string, uploadId: string) => void;
  onDeleteUpload: (uploadId: string) => void;
  onRenameUpload: (uploadId: string, fileName: string) => void;
};

function TrashIcon() {
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
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
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
      style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 120ms" }}
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

// The left pane of the Upload page: one row per bank with its logo, transaction count and the
// earliest–latest transaction date across its uploads (so you can see how current the data is).
// Click a row to filter the transaction list to that bank; the chevron expands the bank's
// individual uploads, each with its own date range.
function BankList({
  banks,
  selectedKey,
  selectedUploadId,
  onSelect,
  onSelectUpload,
  onDeleteUpload,
  onRenameUpload,
}: BankListProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Reveal the selected upload's row (e.g. right after an import) by opening its bank.
  useEffect(() => {
    if (selectedUploadId && selectedKey) {
      setExpanded((current) => (current.has(selectedKey) ? current : new Set(current).add(selectedKey)));
    }
  }, [selectedUploadId, selectedKey]);

  const toggleExpanded = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (banks.length === 0) {
    return (
      <div className="import-shell__empty">
        No banks yet. Open settings to add one, then import a file.
      </div>
    );
  }

  return (
    <ul className="bank-list">
      {banks.map((bank) => {
        const isExpanded = expanded.has(bank.key);
        const isSelected = selectedKey === bank.key;
        return (
          <li key={bank.key} className={`bank-list__item ${isSelected ? "bank-list__item--selected" : ""}`}>
            <div className="bank-list__row">
              <button
                type="button"
                className="bank-list__expand"
                aria-label={`${isExpanded ? "Hide" : "Show"} uploads for ${bank.name}`}
                aria-expanded={isExpanded}
                onClick={() => toggleExpanded(bank.key)}
              >
                <Chevron open={isExpanded} />
              </button>
              <button
                type="button"
                className="bank-list__select"
                aria-pressed={isSelected}
                onClick={() => onSelect(bank.key)}
              >
                {bank.logoDataUrl ? (
                  <img src={bank.logoDataUrl} alt="" className="bank-list__logo" />
                ) : (
                  <span className="bank-list__logo bank-list__logo--placeholder" aria-hidden="true">
                    {bank.name.slice(0, 2).toUpperCase() || "B"}
                  </span>
                )}
                <span className="bank-list__text">
                  <span className="bank-list__name">{bank.name}</span>
                  <span className="bank-list__range">
                    {bank.transactionCount === 0 ? "No uploads yet" : formatRange(bank.range)}
                  </span>
                </span>
                <span className="bank-list__count">{bank.transactionCount.toLocaleString()}</span>
              </button>
            </div>

            {isExpanded && (
              <div className="bank-list__uploads">
                {bank.uploads.length === 0 ? (
                  <p className="bank-list__uploads-empty">No files imported for this bank.</p>
                ) : (
                  <div className="import-shell__table-shell">
                    <table className="import-shell__table uploads-table bank-list__table">
                      <thead>
                        <tr>
                          <th>File name</th>
                          <th>From</th>
                          <th>To</th>
                          <th>Imported</th>
                          <th className="import-shell__cell--amount">Txns</th>
                          <th className="uploads-table__actions" aria-label="Delete" />
                        </tr>
                      </thead>
                      <tbody>
                        {bank.uploads.map(({ upload, range }) => (
                          <tr
                            key={upload.id}
                            className={`bank-list__upload-row ${
                              selectedUploadId === upload.id ? "bank-list__upload-row--selected" : ""
                            }`}
                            aria-selected={selectedUploadId === upload.id}
                            onClick={() => onSelectUpload(bank.key, upload.id)}
                          >
                            <td>
                              <input
                                key={upload.fileName}
                                className="uploads-table__name-input"
                                defaultValue={upload.fileName}
                                aria-label={`File name for ${upload.fileName}`}
                                onClick={(event) => event.stopPropagation()}
                                onBlur={(event) => {
                                  const trimmed = event.target.value.trim();
                                  if (trimmed && trimmed !== upload.fileName) {
                                    onRenameUpload(upload.id, trimmed);
                                  } else {
                                    event.target.value = upload.fileName;
                                  }
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.currentTarget.blur();
                                  } else if (event.key === "Escape") {
                                    event.currentTarget.value = upload.fileName;
                                    event.currentTarget.blur();
                                  }
                                }}
                              />
                            </td>
                            <td className="uploads-table__date">{range ? formatDate(range.min) : "—"}</td>
                            <td className="uploads-table__date">{range ? formatDate(range.max) : "—"}</td>
                            <td className="uploads-table__date">{formatUploadDate(upload.importedAt)}</td>
                            <td className="import-shell__cell--amount">{upload.transactions.length}</td>
                            <td className="uploads-table__actions">
                              <button
                                type="button"
                                className="import-shell__upload-delete"
                                aria-label={`Delete ${upload.fileName}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onDeleteUpload(upload.id);
                                }}
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
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default BankList;
