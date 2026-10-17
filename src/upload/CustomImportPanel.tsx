import { useMemo, useState, type ChangeEvent, type DragEvent } from "react";
import type { ImportedTransaction } from "./lib/csvParser";
import type { KnownCategory } from "../spending/lib/categories";
import { normalizeBankName, type BankRecord } from "../spending/lib/banks";
import {
  buildTransactionsFromMapping,
  guessColumnIndex,
  parseAmount,
  parseDelimitedText,
  type ParsedTable,
} from "./lib/genericParser";
import BankSelect from "./BankSelect";

const PREVIEW_ROW_LIMIT = 10;

const signStorageKey = (bankName: string) => `janos.expensesNegative.${normalizeBankName(bankName)}`;

function readRememberedSign(bankName: string): boolean {
  try {
    return localStorage.getItem(signStorageKey(bankName)) === "1";
  } catch {
    return false;
  }
}

function rememberSign(bankName: string, expensesNegative: boolean) {
  try {
    localStorage.setItem(signStorageKey(bankName), expensesNegative ? "1" : "0");
  } catch {
    // Remembering is a convenience; ignore storage being unavailable.
  }
}

// What the preview shows for a cell in the amount column once the sign choice is applied.
function previewAmount(cell: string, flip: boolean): string {
  if (!flip) {
    return cell;
  }
  const value = parseAmount(cell);
  return Number.isNaN(value) ? cell : (0 - value).toFixed(2);
}

type CustomImportPanelProps = {
  // Amounts arrive already normalized: income is positive and spending negative, whatever sign the file used.
  onImport: (bankName: string, fileName: string, transactions: ImportedTransaction[]) => Promise<boolean>;
  knownCategories: KnownCategory[];
  bankRecords: BankRecord[];
};

type MappingField = "dateIndex" | "amountIndex" | "descriptionIndex" | "categoryIndex";

type ColumnMappingState = {
  dateIndex: number | null;
  amountIndex: number | null;
  descriptionIndex: number | null;
  categoryIndex: number | null;
};

const EMPTY_MAPPING: ColumnMappingState = {
  dateIndex: null,
  amountIndex: null,
  descriptionIndex: null,
  categoryIndex: null,
};

function CustomImportPanel({ onImport, knownCategories, bankRecords }: CustomImportPanelProps) {
  const [parsed, setParsed] = useState<ParsedTable | null>(null);
  const [sourceFileName, setSourceFileName] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [mapping, setMapping] = useState<ColumnMappingState>(EMPTY_MAPPING);
  const [bankName, setBankName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isDropActive, setIsDropActive] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [hasHeaders, setHasHeaders] = useState(true);
  // The text the preview was parsed from, kept so the headers checkbox can re-parse it.
  const [rawText, setRawText] = useState("");
  const [expensesNegative, setExpensesNegative] = useState(false);
  // Once the user touches the checkbox, picking a bank no longer overwrites it.
  const [expensesTouched, setExpensesTouched] = useState(false);

  const applyParsedTable = (table: ParsedTable, fileName: string, text: string): boolean => {
    if (table.headers.length === 0 || table.rows.length === 0) {
      setError("Couldn't find any rows. Make sure the first line has column headers.");
      return false;
    }

    setParsed(table);
    setSourceFileName(fileName);
    setRawText(text);
    setMapping({
      dateIndex: guessColumnIndex(table.headers, ["date"]),
      amountIndex: guessColumnIndex(table.headers, ["amount", "amt", "value"]),
      descriptionIndex: guessColumnIndex(table.headers, ["description", "desc", "memo", "payee", "merchant"]),
      categoryIndex: guessColumnIndex(table.headers, ["category"]),
    });
    setError(null);
    setSuccessMessage(null);
    return true;
  };

  const readFile = async (file: File | null) => {
    if (!file) {
      return;
    }

    const text = await file.text();
    applyParsedTable(parseDelimitedText(text, hasHeaders), file.name, text);
  };

  const handleBrowseChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await readFile(event.target.files?.[0] ?? null);
    event.target.value = "";
  };

  const handleDrop = async (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDropActive(false);
    await readFile(event.dataTransfer.files?.[0] ?? null);
  };

  const handlePreviewPaste = () => {
    if (!pasteText.trim()) {
      setError("Paste some data first.");
      return;
    }

    applyParsedTable(parseDelimitedText(pasteText, hasHeaders), "Pasted data", pasteText);
  };

  const resetAll = () => {
    setParsed(null);
    setSourceFileName("");
    setPasteText("");
    setMapping(EMPTY_MAPPING);
    setBankName("");
    setRawText("");
    setExpensesNegative(false);
    setExpensesTouched(false);
    setError(null);
  };

  // Toggling headers on the preview re-reads the same source text, so the columns (and the
  // guessed mapping) update in place without re-dropping the file.
  const handleHeadersChange = (checked: boolean) => {
    if (!parsed) {
      setHasHeaders(checked);
      return;
    }
    if (applyParsedTable(parseDelimitedText(rawText, checked), sourceFileName, rawText)) {
      setHasHeaders(checked);
    }
  };

  const handleExpensesNegativeChange = (checked: boolean) => {
    setExpensesNegative(checked);
    setExpensesTouched(true);
  };

  // Picking a bank starts the sign checkbox from what was used for that bank's last import,
  // unless the user has already chosen one for this file.
  const handleBankChange = (name: string) => {
    setBankName(name);
    if (!expensesTouched) {
      setExpensesNegative(readRememberedSign(name));
    }
  };

  const importOptions = (
    <div className="custom-import__options">
      <label className="custom-import__headers-toggle">
        <input
          type="checkbox"
          checked={hasHeaders}
          onChange={(event) => handleHeadersChange(event.target.checked)}
        />
        First row is headers
      </label>
      <label className="custom-import__headers-toggle">
        <input
          type="checkbox"
          checked={expensesNegative}
          onChange={(event) => handleExpensesNegativeChange(event.target.checked)}
        />
        Expenses are shown as negatives
      </label>
    </div>
  );

  const handleMappingChange = (field: MappingField, value: string) => {
    setMapping((current) => ({ ...current, [field]: value === "" ? null : Number.parseInt(value, 10) }));
  };

  const canImport = useMemo(
    () =>
      parsed !== null &&
      mapping.dateIndex !== null &&
      mapping.amountIndex !== null &&
      mapping.descriptionIndex !== null &&
      bankName.trim().length > 0,
    [parsed, mapping, bankName],
  );

  const handleImport = async () => {
    if (!parsed || mapping.dateIndex === null || mapping.amountIndex === null || mapping.descriptionIndex === null) {
      return;
    }

    const built = buildTransactionsFromMapping(
      parsed,
      {
        dateIndex: mapping.dateIndex,
        amountIndex: mapping.amountIndex,
        descriptionIndex: mapping.descriptionIndex,
        categoryIndex: mapping.categoryIndex,
      },
      bankName.trim(),
      sourceFileName,
      knownCategories,
    );

    if (built.length === 0) {
      setError("No rows had a valid amount in the selected column.");
      return;
    }

    // The app stores income as positive and spending as negative; a file that lists expenses as
    // positives is flipped.
    const transactions = expensesNegative
      ? built
      : built.map((transaction) => ({ ...transaction, amount: 0 - transaction.amount }));

    setIsImporting(true);
    try {
      const succeeded = await onImport(bankName.trim(), sourceFileName, transactions);
      if (succeeded) {
        rememberSign(bankName, expensesNegative);
        setSuccessMessage(`Imported ${transactions.length} transaction${transactions.length === 1 ? "" : "s"}.`);
        resetAll();
      }
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <section className="custom-import">
      <div className="custom-import__heading">
        <h2>Upload a bank report</h2>
        <p>Drop a CSV or paste your statement data, then tell us which columns are which.</p>
      </div>

      {!parsed ? (
        <>
          <div className="custom-import__intake">
            <label
              className={`custom-import__dropzone ${isDropActive ? "custom-import__dropzone--active" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDropActive(true);
              }}
              onDragLeave={() => setIsDropActive(false)}
              onDrop={handleDrop}
            >
              <span>Drop a CSV file here, or click to browse</span>
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="custom-import__file-input"
                onChange={handleBrowseChange}
              />
            </label>

            <textarea
              className="custom-import__textarea"
              placeholder="...or paste data here (CSV, or rows copied from a spreadsheet)"
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              rows={6}
            />
          </div>

          <div className="custom-import__intake-actions">
            {importOptions}
            <button type="button" className="custom-import__button" onClick={handlePreviewPaste}>
              Preview data
            </button>
          </div>
        </>
      ) : (
        <div className="custom-import__mapping">
          <div className="custom-import__preview-shell">
            <table className="custom-import__preview-table">
              <thead>
                <tr>
                  {parsed.headers.map((header, index) => (
                    <th key={`${header}-${index}`}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, PREVIEW_ROW_LIMIT).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {parsed.headers.map((_, columnIndex) => (
                      <td key={columnIndex}>
                        {columnIndex === mapping.amountIndex
                          ? previewAmount(row[columnIndex] ?? "", !expensesNegative)
                          : (row[columnIndex] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.rows.length > PREVIEW_ROW_LIMIT && (
              <p className="custom-import__preview-note">
                +{parsed.rows.length - PREVIEW_ROW_LIMIT} more row{parsed.rows.length - PREVIEW_ROW_LIMIT === 1 ? "" : "s"}
              </p>
            )}
          </div>

          {importOptions}

          <div className="custom-import__fields">
            <label className="custom-import__field">
              Date
              <select value={mapping.dateIndex ?? ""} onChange={(event) => handleMappingChange("dateIndex", event.target.value)}>
                <option value="">Select a column</option>
                {parsed.headers.map((header, index) => (
                  <option key={`${header}-${index}`} value={index}>
                    {header}
                  </option>
                ))}
              </select>
            </label>

            <label className="custom-import__field">
              Amount
              <select
                value={mapping.amountIndex ?? ""}
                onChange={(event) => handleMappingChange("amountIndex", event.target.value)}
              >
                <option value="">Select a column</option>
                {parsed.headers.map((header, index) => (
                  <option key={`${header}-${index}`} value={index}>
                    {header}
                  </option>
                ))}
              </select>
            </label>

            <label className="custom-import__field">
              Description
              <select
                value={mapping.descriptionIndex ?? ""}
                onChange={(event) => handleMappingChange("descriptionIndex", event.target.value)}
              >
                <option value="">Select a column</option>
                {parsed.headers.map((header, index) => (
                  <option key={`${header}-${index}`} value={index}>
                    {header}
                  </option>
                ))}
              </select>
            </label>

            <label className="custom-import__field">
              Category (optional)
              <select
                value={mapping.categoryIndex ?? ""}
                onChange={(event) => handleMappingChange("categoryIndex", event.target.value)}
              >
                <option value="">Leave as Unclassified</option>
                {parsed.headers.map((header, index) => (
                  <option key={`${header}-${index}`} value={index}>
                    {header}
                  </option>
                ))}
              </select>
            </label>

            <div className="custom-import__field">
              Bank
              <BankSelect banks={bankRecords} value={bankName} onChange={handleBankChange} />
            </div>

            <div className="custom-import__actions">
              <button type="button" className="custom-import__button" onClick={resetAll}>
                Start over
              </button>
              <button
                type="button"
                className="custom-import__button custom-import__button--primary"
                disabled={!canImport || isImporting}
                onClick={handleImport}
              >
                {isImporting ? "Importing..." : "Import"}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <p className="custom-import__error">{error}</p>}
      {successMessage && <p className="custom-import__success">{successMessage}</p>}
    </section>
  );
}

export default CustomImportPanel;
