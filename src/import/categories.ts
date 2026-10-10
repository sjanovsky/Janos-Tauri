export type Category = string;

export type CategoryRecord = {
  id: string;
  label: string;
  color: string;
  excluded: boolean;
  bucketId: string | null;
};

export type BucketRecord = {
  id: string;
  name: string;
};

export const RESERVED_CATEGORIES = ["unclassified", "transfers"] as const;
export type ReservedCategory = (typeof RESERVED_CATEGORIES)[number];

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
