import { useMemo, useState, type ChangeEvent, type DragEvent } from "react";
import type { ImportedTransaction } from "./lib/csvParser";
import type { KnownCategory } from "./lib/categories";
import type { BankRecord } from "./lib/banks";
import { buildTransactionsFromMapping, guessColumnIndex, parseDelimitedText, type ParsedTable } from "./lib/genericParser";
import BankSelect from "./BankSelect";

const PREVIEW_ROW_LIMIT = 10;

type CustomImportPanelProps = {
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

  const applyParsedTable = (table: ParsedTable, fileName: string) => {
    if (table.headers.length === 0 || table.rows.length === 0) {
      setError("Couldn't find any rows. Make sure the first line has column headers.");
      return;
    }

    setParsed(table);
    setSourceFileName(fileName);
    setMapping({
      dateIndex: guessColumnIndex(table.headers, ["date"]),
      amountIndex: guessColumnIndex(table.headers, ["amount", "amt", "value"]),
      descriptionIndex: guessColumnIndex(table.headers, ["description", "desc", "memo", "payee", "merchant"]),
      categoryIndex: guessColumnIndex(table.headers, ["category"]),
    });
    setError(null);
    setSuccessMessage(null);
  };

  const readFile = async (file: File | null) => {
    if (!file) {
      return;
    }

    const text = await file.text();
    applyParsedTable(parseDelimitedText(text, hasHeaders), file.name);
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

    applyParsedTable(parseDelimitedText(pasteText, hasHeaders), "Pasted data");
  };

  const resetAll = () => {
    setParsed(null);
    setSourceFileName("");
    setPasteText("");
    setMapping(EMPTY_MAPPING);
    setBankName("");
    setError(null);
  };

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

    const transactions = buildTransactionsFromMapping(
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

    if (transactions.length === 0) {
      setError("No rows had a valid amount in the selected column.");
      return;
    }

    setIsImporting(true);
    try {
      const succeeded = await onImport(bankName.trim(), sourceFileName, transactions);
      if (succeeded) {
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
            <label className="custom-import__headers-toggle">
              <input
                type="checkbox"
                checked={hasHeaders}
                onChange={(event) => setHasHeaders(event.target.checked)}
              />
              First row is headers
            </label>
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
                      <td key={columnIndex}>{row[columnIndex] ?? ""}</td>
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
              <BankSelect banks={bankRecords} value={bankName} onChange={setBankName} />
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
