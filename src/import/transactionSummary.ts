import type { ImportedTransaction } from "./csvParser";
import { SPEND_CATEGORIES, type SpendCategory } from "./categories";

export type ChartRange = "day" | "month" | "year";

export type ChartSegment = {
  category: SpendCategory;
  value: number;
};

export type ChartPoint = {
  key: string;
  label: string;
  segments: ChartSegment[];
};

function parseDate(dateString: string): Date | null {
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

export function buildChartSeries(transactions: ImportedTransaction[], range: ChartRange): ChartPoint[] {
  const buckets = new Map<string, Map<SpendCategory, number>>();

  transactions.forEach((transaction) => {
    if (transaction.category === "transfers" || transaction.category === "unclassified") {
      return;
    }

    const parsedDate = parseDate(transaction.date);
    if (!parsedDate) {
      return;
    }

    const bucketKey = bucketKeyForDate(parsedDate, range);
    const bucket = buckets.get(bucketKey) ?? new Map<SpendCategory, number>();
    bucket.set(transaction.category, (bucket.get(transaction.category) ?? 0) + transaction.amount);
    buckets.set(bucketKey, bucket);
  });

  const sortedEntries = Array.from(buckets.entries()).sort(([left], [right]) => left.localeCompare(right));

  return sortedEntries.map(([key, categoryTotals]) => {
    let label = key;
    if (range === "month") {
      const [year, month] = key.split("-");
      label = `${month}/${year}`;
    }

    if (range === "day") {
      const [year, month, day] = key.split("-");
      label = `${month}/${day}/${year}`;
    }

    const segments = SPEND_CATEGORIES.filter((category) => categoryTotals.has(category)).map((category) => ({
      category,
      value: Number((categoryTotals.get(category) ?? 0).toFixed(2)),
    }));

    return { key, label, segments };
  });
}
