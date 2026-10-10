import { splitDelimitedLine } from "./csvParser";
import type { ImportedTransaction } from "./csvParser";
import { resolveCategoryInput, type KnownCategory } from "./categories";

export type ParsedTable = {
  headers: string[];
  rows: string[][];
};

export type ColumnMapping = {
  dateIndex: number;
  amountIndex: number;
  descriptionIndex: number;
  categoryIndex?: number | null;
};

export function parseDelimitedText(text: string): ParsedTable {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = splitDelimitedLine(lines[0], delimiter).map((header) => header.trim());
  const rows = lines.slice(1).map((line) => splitDelimitedLine(line, delimiter));

  return { headers, rows };
}

export function guessColumnIndex(headers: string[], keywords: string[]): number | null {
  const index = headers.findIndex((header) => {
    const normalized = header.toLowerCase();
    return keywords.some((keyword) => normalized.includes(keyword));
  });

  return index === -1 ? null : index;
}

function parseAmount(raw: string): number {
  const trimmed = raw.trim().replace(/[$,]/g, "");
  const isParenNegative = trimmed.startsWith("(") && trimmed.endsWith(")");
  const unwrapped = isParenNegative ? trimmed.slice(1, -1) : trimmed;
  const value = Number.parseFloat(unwrapped);

  if (Number.isNaN(value)) {
    return NaN;
  }

  return isParenNegative ? -Math.abs(value) : value;
}

export function buildTransactionsFromMapping(
  parsed: ParsedTable,
  mapping: ColumnMapping,
  bankName: string,
  fileName: string,
  knownCategories: KnownCategory[] = [],
): ImportedTransaction[] {
  const transactions: ImportedTransaction[] = [];

  parsed.rows.forEach((row) => {
    const amount = parseAmount(row[mapping.amountIndex] ?? "");
    if (Number.isNaN(amount)) {
      return;
    }

    const categoryRaw = mapping.categoryIndex != null ? row[mapping.categoryIndex] : undefined;

    transactions.push({
      id: crypto.randomUUID(),
      date: row[mapping.dateIndex] ?? "",
      description: row[mapping.descriptionIndex] ?? "",
      cardMember: "",
      accountNumber: "",
      amount,
      sourceBank: bankName,
      sourceFileName: fileName,
      category: resolveCategoryInput(categoryRaw, knownCategories),
    });
  });

  return transactions;
}
