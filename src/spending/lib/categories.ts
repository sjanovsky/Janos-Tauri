export type Category = string;

export type CategoryRecord = {
  id: string;
  label: string;
  color: string;
  excluded: boolean;
  bucketId: string | null;
  // Order within the category's bucket (ascending). Only meaningful relative to other members of
  // the same bucket; migrated rows default to 0 so they fall back to label order.
  position: number;
};

export type BucketRecord = {
  id: string;
  name: string;
  color: string;
  // Order of the bucket among all buckets (ascending); migrated rows default to 0 (name order).
  position: number;
};

// Id of the reserved bucket the Income page is built on. Its categories (Paycheck, Commission,
// Bonus, ...) hold money coming in, so the Spending page and the Sankey's spending leave them out.
export const INCOME_BUCKET_ID = "income";

// Id used for the catch-all section of categories that don't belong to a bucket.
export const UNGROUPED_BUCKET_ID = "__ungrouped";

// Neutral gray for the "Ungrouped" section, so it reads as distinct from real buckets.
export const UNGROUPED_BUCKET_COLOR = "#94a3b8";

// Sentinel id + color for the catch-all "Unclassified" section (uncategorized transactions).
// Rendered in red so uncategorized spending stands out as needing attention; it only appears
// while such transactions exist, and is never a real, user-managed bucket.
export const UNCLASSIFIED_BUCKET_ID = "__unclassified";
export const UNCLASSIFIED_BUCKET_COLOR = "#dc2626";

// Sentinel id + color for the permanent "Exclude" tray. Categories dropped here are flagged
// `excluded` and dropped from the spending chart/totals; it isn't a real bucket row.
export const EXCLUDE_BUCKET_ID = "__exclude";
export const EXCLUDE_BUCKET_COLOR = "#e11d48";

// New buckets cycle through this palette so each one starts with a distinct color;
// the user can recolor any bucket with its swatch.
export const BUCKET_COLOR_PALETTE = [
  "#4f46e5",
  "#0ca678",
  "#e8590c",
  "#d6336c",
  "#1098ad",
  "#f08c00",
  "#5f3dc4",
  "#2b8a3e",
];

export function nextBucketColor(existingCount: number): string {
  return BUCKET_COLOR_PALETTE[existingCount % BUCKET_COLOR_PALETTE.length];
}

export const RESERVED_CATEGORIES = ["unclassified", "transfers"] as const;
export type ReservedCategory = (typeof RESERVED_CATEGORIES)[number];

// Catch-all id for transactions whose category couldn't be determined on import.
export const UNCLASSIFIED_CATEGORY = "unclassified";

export const DEFAULT_CATEGORIES: string[] = ["restaurants", "groceries", "partying", "fixed", "stuff"];

export const CATEGORY_LABELS: Record<string, string> = {
  unclassified: "Unclassified",
  transfers: "Transfers",
  restaurants: "Restaurants",
  groceries: "Groceries",
  partying: "Partying",
  fixed: "Fixed",
  stuff: "Stuff",
};

const DEFAULT_CATEGORY_COLORS: Record<string, string> = {
  restaurants: "#2a78d6",
  groceries: "#1baf7a",
  partying: "#eda100",
  fixed: "#008300",
  stuff: "#4a3aa7",
};

const EXTRA_COLOR_PALETTE = [
  "#d6336c",
  "#0ca678",
  "#f08c00",
  "#5f3dc4",
  "#1098ad",
  "#e8590c",
  "#2b8a3e",
  "#9c36b5",
  "#1864ab",
  "#c92a2a",
];

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function isReservedCategory(category: string): category is ReservedCategory {
  return (RESERVED_CATEGORIES as readonly string[]).includes(category);
}

// Categories kept out of the spending chart entirely. Transfers move money between the user's
// own accounts, so they are never spending. Unclassified transactions, by contrast, are real
// spending that just hasn't been categorized yet, so they can still appear in the chart.
export function isTransferCategory(category: string): boolean {
  return category === "transfers";
}

const categoryLabelOverrides = new Map<string, string>();
const categoryColorOverrides = new Map<string, string>();

export function applyCategoryRecords(records: CategoryRecord[]): void {
  categoryLabelOverrides.clear();
  categoryColorOverrides.clear();
  records.forEach((record) => {
    categoryLabelOverrides.set(record.id, record.label);
    categoryColorOverrides.set(record.id, record.color);
  });
}

export function getCategoryLabel(category: string): string {
  return categoryLabelOverrides.get(category) ?? CATEGORY_LABELS[category] ?? category;
}

export function getCategoryColor(category: string): string {
  const override = categoryColorOverrides.get(category);
  if (override) {
    return override;
  }

  const defaultColor = DEFAULT_CATEGORY_COLORS[category];
  if (defaultColor) {
    return defaultColor;
  }

  const index = hashString(category) % EXTRA_COLOR_PALETTE.length;
  return EXTRA_COLOR_PALETTE[index];
}

export function getCategoryBucketColor(
  category: string,
  categoryRecords: Pick<CategoryRecord, "id" | "bucketId" | "excluded">[] = [],
  buckets: Pick<BucketRecord, "id" | "color">[] = [],
): string {
  if (category === UNCLASSIFIED_CATEGORY) {
    return UNCLASSIFIED_BUCKET_COLOR;
  }

  const record = categoryRecords.find((entry) => entry.id === category);
  if (record?.excluded) {
    return EXCLUDE_BUCKET_COLOR;
  }

  const bucketId = record?.bucketId ?? null;
  if (!bucketId) {
    return UNGROUPED_BUCKET_COLOR;
  }

  return buckets.find((bucket) => bucket.id === bucketId)?.color ?? UNGROUPED_BUCKET_COLOR;
}

export function slugifyCategoryLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "category";
}

export function generateCategoryId(label: string, existingIds: string[]): string {
  const taken = new Set<string>([...existingIds, ...RESERVED_CATEGORIES]);
  const base = slugifyCategoryLabel(label);

  if (!taken.has(base)) {
    return base;
  }

  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
}

const KNOWN_CATEGORY_LOOKUP = new Map<string, string>();
[...RESERVED_CATEGORIES, ...DEFAULT_CATEGORIES].forEach((category) => {
  KNOWN_CATEGORY_LOOKUP.set(category, category);
  KNOWN_CATEGORY_LOOKUP.set(getCategoryLabel(category).toLowerCase(), category);
});

export type KnownCategory = { id: string; label: string };

export function resolveCategoryInput(
  raw: string | undefined,
  knownCategories: KnownCategory[] = [],
): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    return "unclassified";
  }

  const key = trimmed.toLowerCase();

  // Match against the current categories first (by label, then by id) so imports and
  // manual edits reuse an existing category instead of minting a duplicate id for a
  // category whose id differs from its label (e.g. a renamed or multi-word category).
  for (const category of knownCategories) {
    if (category.label.toLowerCase() === key || category.id.toLowerCase() === key) {
      return category.id;
    }
  }

  return KNOWN_CATEGORY_LOOKUP.get(key) ?? trimmed;
}

export function deriveCategoryList(
  transactions: { category: string }[],
  extraCategoryIds: string[] = [],
): string[] {
  const seen = new Map<string, string>();
  DEFAULT_CATEGORIES.forEach((category) => seen.set(category, category));

  extraCategoryIds.forEach((category) => {
    if (isReservedCategory(category)) {
      return;
    }

    const key = category.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, category);
    }
  });

  transactions.forEach((transaction) => {
    if (isReservedCategory(transaction.category)) {
      return;
    }

    const key = transaction.category.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, transaction.category);
    }
  });

  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}
