// Parsing a spreadsheet block (pasted as tab-separated rows) into the shape the Net Worth grid
// already uses: a header row of months, then one row per account, grouped into buckets by the
// subtotal rows the sheet itself has. Everything here is framework-free so the import modal's
// logic can be unit-tested directly.

// A parsed month column: the raw header text plus the normalized "YYYY-MM" (null when the header
// didn't look like a month — the column is flagged in the preview rather than silently dropped).
export type ParsedMonth = { raw: string; month: string | null };

// One account row: its label, the bucket it was grouped under (from the following subtotal row;
// null = Ungrouped), and one amount per month column aligned by index (null = the cell was blank).
export type ParsedAccountRow = {
  label: string;
  bucket: string | null;
  amounts: (number | null)[];
};

// A row the parser set aside: a bucket subtotal, the grand total, or a labelled row with no data.
// Surfaced in the preview so the user can see nothing was dropped silently.
export type SkippedRow = { label: string; reason: "subtotal" | "total" | "empty" };

export type ParsedImport = {
  months: ParsedMonth[];
  accounts: ParsedAccountRow[];
  skipped: SkippedRow[];
};

const SHORT_MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// A row label that reads as a grand-total ("Net Worth", "Total", …) rather than a bucket subtotal.
const TOTAL_LABEL = /\b(net\s*worth|grand\s*total|total|net)\b/i;

// Normalize a 2- or 4-digit year string: "22" → 2022, "2024" → 2024.
function normalizeYear(raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    return NaN;
  }
  return raw.length <= 2 ? 2000 + value : value;
}

// Build a "YYYY-MM" string, or null when the month/year is out of range.
function toMonth(year: number, month: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12 || year < 1900 || year > 2200) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

// Parse a column header into a "YYYY-MM" month, or null when it doesn't look like one. Accepts the
// common spreadsheet shapes: "Dec-22", "Dec 2022", "December 2022", "2022-12", "2022/12",
// "12/2022". Day-level dates ("2022-12-31") are not months and return null.
export function parseMonthHeader(raw: string): string | null {
  const text = (raw ?? "").trim();
  if (!text) {
    return null;
  }

  // YYYY-MM or YYYY/MM
  let match = text.match(/^(\d{4})[-/](\d{1,2})$/);
  if (match) {
    return toMonth(Number.parseInt(match[1], 10), Number.parseInt(match[2], 10));
  }

  // MM-YYYY or MM/YYYY
  match = text.match(/^(\d{1,2})[-/](\d{4})$/);
  if (match) {
    return toMonth(Number.parseInt(match[2], 10), Number.parseInt(match[1], 10));
  }

  // Month name + year, separated by "-", "/", or whitespace: "Dec-22", "December 2022".
  match = text.match(/^([A-Za-z]{3,})[-/\s]+(\d{2,4})$/);
  if (match) {
    const monthIndex = SHORT_MONTH_NAMES.indexOf(match[1].slice(0, 3).toLowerCase());
    if (monthIndex !== -1) {
      return toMonth(normalizeYear(match[2]), monthIndex + 1);
    }
  }

  return null;
}

// Turn a cell into a balance. Strips currency symbols, commas, and spaces; treats "(1,234)" as a
// negative. Blank or unparseable cells become null (no entry for that account/month).
export function parseImportAmount(raw: string): number | null {
  const text = (raw ?? "").trim();
  if (!text) {
    return null;
  }
  const isParenNegative = text.startsWith("(") && text.endsWith(")");
  const cleaned = (isParenNegative ? text.slice(1, -1) : text).replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") {
    return null;
  }
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) {
    return null;
  }
  return isParenNegative ? -Math.abs(value) : value;
}

// Column-wise sum of several rows' amounts (null counts as 0), one total per month column.
function sumColumns(rows: ParsedAccountRow[], monthCount: number): number[] {
  const totals = new Array<number>(monthCount).fill(0);
  rows.forEach((row) => {
    for (let index = 0; index < monthCount; index += 1) {
      totals[index] += row.amounts[index] ?? 0;
    }
  });
  return totals;
}

// Whether `amounts` matches `totals` column-for-column, over the real (parseable) month columns.
// Tolerance grows with the number of contributing rows so a subtotal of several rounded dollar
// figures still matches; returns false if there were no comparable columns.
function columnsMatch(
  amounts: (number | null)[],
  totals: number[],
  months: ParsedMonth[],
  contributingRows: number,
): boolean {
  const epsilon = Math.max(2, contributingRows);
  let comparedAny = false;
  for (let index = 0; index < months.length; index += 1) {
    if (months[index].month === null) {
      continue;
    }
    comparedAny = true;
    if (Math.abs((amounts[index] ?? 0) - (totals[index] ?? 0)) > epsilon) {
      return false;
    }
  }
  return comparedAny;
}

// Parse a pasted spreadsheet block. The first row whose cells (after the label column) hold at
// least two recognizable months is taken as the header; rows below it are classified, in order:
//   • a bucket subtotal — its values equal the running sum of the accounts since the last subtotal,
//     so those accounts are grouped under this row's label (e.g. "401k", "Brokerage", "Cash");
//   • the grand total — its values equal the sum of every account, or its label reads "Net worth";
//   • a labelled row with no numbers — skipped as empty;
//   • otherwise an account row.
// Subtotals and the total are recorded in `skipped` (nothing is dropped silently); fully blank
// lines are ignored. If no month header is found, `months` is empty and the caller shows an error.
export function parseNetWorthPaste(text: string): ParsedImport {
  const lines = (text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const cellRows = lines.map((line) => line.split("\t"));

  // Find the header row and where its month columns begin: the first row with a recognizable month.
  // Balance amounts never parse as months (they have no month/year separator), so the topmost such
  // row is the header even when it has only one month column.
  let headerIndex = -1;
  let monthStart = -1;
  for (let rowIndex = 0; rowIndex < cellRows.length; rowIndex += 1) {
    const firstMonth = cellRows[rowIndex].findIndex((cell) => parseMonthHeader(cell) !== null);
    if (firstMonth !== -1) {
      headerIndex = rowIndex;
      monthStart = firstMonth;
      break;
    }
  }

  if (headerIndex === -1) {
    return { months: [], accounts: [], skipped: [] };
  }

  const headerCells = cellRows[headerIndex];
  // Trim trailing empty header cells so stray columns past the last month aren't shown.
  let lastColumn = headerCells.length - 1;
  while (lastColumn > monthStart && headerCells[lastColumn].trim() === "") {
    lastColumn -= 1;
  }
  const monthColumns: number[] = [];
  for (let column = monthStart; column <= lastColumn; column += 1) {
    monthColumns.push(column);
  }
  const months: ParsedMonth[] = monthColumns.map((column) => ({
    raw: (headerCells[column] ?? "").trim(),
    month: parseMonthHeader(headerCells[column] ?? ""),
  }));
  const labelColumn = Math.max(0, monthStart - 1);

  const accounts: ParsedAccountRow[] = [];
  const skipped: SkippedRow[] = [];
  // Accounts seen since the last subtotal (awaiting a bucket) and every account so far.
  let pending: ParsedAccountRow[] = [];
  const allAccounts: ParsedAccountRow[] = [];

  for (let rowIndex = headerIndex + 1; rowIndex < cellRows.length; rowIndex += 1) {
    const cells = cellRows[rowIndex];
    const label = (cells[labelColumn] ?? "").trim();
    const amounts = monthColumns.map((column) => parseImportAmount(cells[column] ?? ""));
    const hasAmount = amounts.some((amount) => amount !== null);

    if (!hasAmount) {
      // A labelled-but-dataless row is a stray section header; a fully blank line is just noise.
      if (label) {
        skipped.push({ label, reason: "empty" });
      }
      continue;
    }

    if (pending.length > 0 && columnsMatch(amounts, sumColumns(pending, months.length), months, pending.length)) {
      // Subtotal: the accounts gathered since the last one belong to this bucket.
      pending.forEach((account) => {
        account.bucket = label || null;
      });
      pending = [];
      skipped.push({ label: label || "(subtotal)", reason: "subtotal" });
      continue;
    }

    if (
      TOTAL_LABEL.test(label) ||
      (allAccounts.length > 0 && columnsMatch(amounts, sumColumns(allAccounts, months.length), months, allAccounts.length))
    ) {
      skipped.push({ label: label || "(total)", reason: "total" });
      continue;
    }

    const account: ParsedAccountRow = { label, bucket: null, amounts };
    accounts.push(account);
    allAccounts.push(account);
    pending.push(account);
  }

  return { months, accounts, skipped };
}
