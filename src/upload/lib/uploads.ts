import type { ImportedTransaction } from "./csvParser";
import { normalizeBankName, type BankRecord } from "../../spending/lib/banks";
import { parseDate } from "../../spending/lib/transactionSummary";

// A single imported bank report (its parsed transactions kept in memory alongside the
// bank/file it came from).
export type UploadedFileView = {
  id: string;
  bankName: string;
  fileName: string;
  // When the report was imported, as a UTC timestamp (SQLite `datetime('now')` or an ISO
  // string for a just-added upload).
  importedAt: string;
  transactions: ImportedTransaction[];
};

export type DateRange = { min: Date; max: Date };

export type UploadSummary = {
  upload: UploadedFileView;
  range: DateRange | null;
};

export type BankSummary = {
  // normalizeBankName(name); also the id used to filter the transaction list.
  key: string;
  name: string;
  logoDataUrl: string | null;
  uploads: UploadSummary[];
  transactionCount: number;
  // Earliest and latest transaction date across every upload for the bank.
  range: DateRange | null;
};

export function transactionDateRange(transactions: ImportedTransaction[]): DateRange | null {
  let min: Date | null = null;
  let max: Date | null = null;
  for (const transaction of transactions) {
    const date = parseDate(transaction.date);
    if (!date) {
      continue;
    }
    if (!min || date < min) {
      min = date;
    }
    if (!max || date > max) {
      max = date;
    }
  }
  return min && max ? { min, max } : null;
}

function mergeRanges(a: DateRange | null, b: DateRange | null): DateRange | null {
  if (!a || !b) {
    return a ?? b;
  }
  return { min: a.min < b.min ? a.min : b.min, max: a.max > b.max ? a.max : b.max };
}

// One summary per configured bank (even with no uploads yet, so a new bank shows up), followed
// by any bank name that only appears on uploads. Sorted by name within each group.
export function buildBankSummaries(uploads: UploadedFileView[], banks: BankRecord[]): BankSummary[] {
  const summaries = new Map<string, BankSummary>();
  const ensure = (name: string, logoDataUrl: string | null): BankSummary => {
    const key = normalizeBankName(name);
    let summary = summaries.get(key);
    if (!summary) {
      summary = { key, name, logoDataUrl, uploads: [], transactionCount: 0, range: null };
      summaries.set(key, summary);
    }
    return summary;
  };

  const configured = banks
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((bank) => ensure(bank.name, bank.logoDataUrl));
  const configuredKeys = new Set(configured.map((summary) => summary.key));

  for (const upload of uploads) {
    const summary = ensure(upload.bankName, null);
    const range = transactionDateRange(upload.transactions);
    summary.uploads.push({ upload, range });
    summary.transactionCount += upload.transactions.length;
    summary.range = mergeRanges(summary.range, range);
  }

  const orphans = Array.from(summaries.values())
    .filter((summary) => !configuredKeys.has(summary.key))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...configured, ...orphans];
}

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export function formatDate(date: Date): string {
  return dateFormatter.format(date);
}

export function formatRange(range: DateRange | null): string {
  if (!range) {
    return "No dates";
  }
  return `${formatDate(range.min)} – ${formatDate(range.max)}`;
}

const uploadDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

// Stored timestamps are UTC in either "YYYY-MM-DD HH:MM:SS" (SQLite) or ISO form; show the
// UTC calendar date so a just-added upload and its reloaded row read the same.
export function formatUploadDate(value: string): string {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : uploadDateFormatter.format(date);
}
