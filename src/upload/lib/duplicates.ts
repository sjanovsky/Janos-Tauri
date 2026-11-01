import type { ImportedTransaction } from "./csvParser";
import { normalizeBankName } from "../../spending/lib/banks";
import { parseDate } from "../../spending/lib/transactionSummary";

function normalizeDate(date: string): string {
  const parsed = parseDate(date.trim());
  return parsed ? `${parsed.getFullYear()}-${parsed.getMonth() + 1}-${parsed.getDate()}` : date.trim();
}

// Two transactions are the same when bank, date, amount and description all match
// (description compared ignoring case and extra whitespace).
function duplicateKey(transaction: ImportedTransaction): string {
  return [
    normalizeBankName(transaction.sourceBank),
    normalizeDate(transaction.date),
    transaction.amount.toFixed(2),
    transaction.description.trim().toLowerCase().replace(/\s+/g, " "),
  ].join("|");
}

// Indexes of the incoming transactions that already exist in `existing`. Only incoming rows are
// compared against existing ones, never against each other, so identical rows within one file
// are all flagged or none are.
export function findDuplicateIndexes(
  incoming: ImportedTransaction[],
  existing: ImportedTransaction[],
): Set<number> {
  const existingKeys = new Set(existing.map(duplicateKey));
  const duplicates = new Set<number>();
  incoming.forEach((transaction, index) => {
    if (existingKeys.has(duplicateKey(transaction))) {
      duplicates.add(index);
    }
  });
  return duplicates;
}
