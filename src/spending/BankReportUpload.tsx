import type { ImportedTransaction } from "./lib/csvParser";
import type { KnownCategory } from "./lib/categories";
import CustomImportPanel from "./CustomImportPanel";

// A single imported bank report (its parsed transactions kept in memory alongside the
// bank/file it came from). Owned by the upload UI; the shell keeps the list in state.
export type UploadedFileView = {
  id: string;
  bankName: string;
  fileName: string;
  // When the report was imported, as a UTC timestamp (SQLite `datetime('now')` or an ISO
  // string for a just-added upload).
  importedAt: string;
  transactions: ImportedTransaction[];
};

const uploadDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

// Stored timestamps are UTC in either "YYYY-MM-DD HH:MM:SS" (SQLite) or ISO form; show the
// UTC calendar date so a just-added upload and its reloaded row read the same.
function formatUploadDate(value: string): string {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : uploadDateFormatter.format(date);
}

type BankReportUploadProps = {
  uploads: UploadedFileView[];
  knownCategories: KnownCategory[];
  onImport: (bankName: string, fileName: string, transactions: ImportedTransaction[]) => Promise<boolean>;
  onDeleteUpload: (uploadId: string) => void;
  onRenameUpload: (uploadId: string, fileName: string) => void;
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

// The bank-report upload experience: the CSV drop / paste intake (and its column-mapping
// flow) on top, with the list of recent uploads below. Reused on the Uploads page and in
// the Spending-page upload modal.
function BankReportUpload({
  uploads,
  knownCategories,
  onImport,
  onDeleteUpload,
  onRenameUpload,
}: BankReportUploadProps) {
  return (
    <div className="bank-report-upload">
      <CustomImportPanel onImport={onImport} knownCategories={knownCategories} />

      <div className="bank-report-upload__recent">
        <div className="import-shell__uploads-heading">
          <h2>Recent uploads</h2>
          <p>Most recently imported files appear here. Rename a file by editing its name.</p>
        </div>

        {uploads.length === 0 ? (
          <div className="import-shell__empty">
            No files imported yet. Drop a CSV or paste data above to get started.
          </div>
        ) : (
          <div className="import-shell__table-shell">
            <table className="import-shell__table uploads-table">
              <thead>
                <tr>
                  <th>Uploaded</th>
                  <th>File name</th>
                  <th>Bank</th>
                  <th className="import-shell__cell--amount">Transactions</th>
                  <th className="uploads-table__actions" aria-label="Delete" />
                </tr>
              </thead>
              <tbody>
                {uploads.map((upload) => (
                  <tr key={upload.id}>
                    <td className="uploads-table__date">{formatUploadDate(upload.importedAt)}</td>
                    <td>
                      <input
                        key={upload.fileName}
                        className="uploads-table__name-input"
                        defaultValue={upload.fileName}
                        aria-label={`File name for ${upload.fileName}`}
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
                    <td>{upload.bankName}</td>
                    <td className="import-shell__cell--amount">{upload.transactions.length}</td>
                    <td className="uploads-table__actions">
                      <button
                        type="button"
                        className="import-shell__upload-delete"
                        aria-label={`Delete ${upload.fileName}`}
                        onClick={() => onDeleteUpload(upload.id)}
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
    </div>
  );
}

export default BankReportUpload;
