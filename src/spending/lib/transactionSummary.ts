import type { ImportedTransaction } from "../../upload/lib/csvParser";
import { isTransferCategory } from "./categories";

export type ChartRange = "day" | "month" | "year";

export type ChartSegment = {
  category: string;
  value: number;
};

export type ChartPoint = {
  key: string;
  label: string;
  segments: ChartSegment[];
};

export function parseDate(dateString: string): Date | null {
  const [month, day, year] = dateString.split("/").map((part) => Number.parseInt(part, 10));
  if ([month, day, year].some((value) => Number.isNaN(value))) {
    return null;
  }

  const fullYear = year < 100 ? 2000 + year : year;
  return new Date(fullYear, month - 1, day);
}

function bucketKeyForDate(date: Date, range: ChartRange): string {
  if (range === "day") {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  if (range === "month") {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  return `${date.getFullYear()}`;
}

export function resolveBucketKey(dateString: string, range: ChartRange): string | null {
  const parsedDate = parseDate(dateString);
  return parsedDate ? bucketKeyForDate(parsedDate, range) : null;
}

function labelForKey(key: string, range: ChartRange): string {
  if (range === "month") {
    const [year, month] = key.split("-");
    return `${month}/${year}`;
  }

  if (range === "day") {
    const [year, month, day] = key.split("-");
    return `${month}/${day}/${year}`;
  }

  return key;
}

// Group transactions into time buckets, then into segments keyed by `dimensionOf`
// (category, bank, …). Segments are emitted in `order`; any dimension not in `order`
// is dropped. Transfers are always excluded (they move money between the user's own accounts).
function buildSeries(
  transactions: ImportedTransaction[],
  range: ChartRange,
  dimensionOf: (transaction: ImportedTransaction) => string,
  order: string[],
): ChartPoint[] {
  const buckets = new Map<string, Map<string, number>>();

  transactions.forEach((transaction) => {
    if (isTransferCategory(transaction.category)) {
      return;
    }

    const parsedDate = parseDate(transaction.date);
    if (!parsedDate) {
      return;
    }

    const bucketKey = bucketKeyForDate(parsedDate, range);
    const dimension = dimensionOf(transaction);
    const bucket = buckets.get(bucketKey) ?? new Map<string, number>();
    bucket.set(dimension, (bucket.get(dimension) ?? 0) + transaction.amount);
    buckets.set(bucketKey, bucket);
  });

  const sortedEntries = Array.from(buckets.entries()).sort(([left], [right]) => left.localeCompare(right));

  return sortedEntries.map(([key, dimensionTotals]) => {
    const segments = order
      .filter((name) => dimensionTotals.has(name))
      .map((name) => ({
        category: name,
        value: Number((dimensionTotals.get(name) ?? 0).toFixed(2)),
      }));

    return { key, label: labelForKey(key, range), segments };
  });
}

export function buildChartSeries(
  transactions: ImportedTransaction[],
  range: ChartRange,
  categoryOrder: string[],
): ChartPoint[] {
  return buildSeries(transactions, range, (transaction) => transaction.category, categoryOrder);
}

export function buildBankSeries(
  transactions: ImportedTransaction[],
  range: ChartRange,
  bankOrder: string[],
): ChartPoint[] {
  return buildSeries(transactions, range, (transaction) => transaction.sourceBank, bankOrder);
}
