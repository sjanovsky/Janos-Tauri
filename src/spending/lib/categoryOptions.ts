import { UNCLASSIFIED_CATEGORY, getCategoryLabel, type BucketRecord, type CategoryRecord } from "./categories";

export type CategoryOptionGroup = {
  bucketLabel: string;
  options: { value: string; label: string }[];
};

// Groups the categories shown in a per-row category picker under their bucket, in bucket order,
// with excluded categories left out, Unclassified in its own group and anything unbucketed last.
export function buildCategoryOptionsByBucket(
  categoryList: string[],
  categoryRecords: CategoryRecord[],
  buckets: BucketRecord[],
): CategoryOptionGroup[] {
    const bucketOrder = new Map(
      buckets
        .slice()
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
        .map((bucket, index) => [bucket.id, { bucketLabel: bucket.name, index }]),
    );
    const grouped = new Map<string, { bucketLabel: string; options: { value: string; label: string }[] }>();

    const addOption = (bucketId: string | null, bucketLabel: string, category: string) => {
      const target = bucketId && bucketOrder.has(bucketId) ? bucketId : "__ungrouped";
      const existing = grouped.get(target) ?? { bucketLabel, options: [] };
      existing.options.push({ value: category, label: getCategoryLabel(category) });
      grouped.set(target, existing);
    };

    const realBucketIds = new Set(buckets.map((bucket) => bucket.id));
    Array.from(new Set(categoryList)).forEach((category) => {
      const record = categoryRecords.find((item) => item.id === category);
      if (record?.excluded) {
        return;
      }

      if (category === UNCLASSIFIED_CATEGORY) {
        addOption(null, "Unclassified", category);
        return;
      }

      const bucketId = record?.bucketId && realBucketIds.has(record.bucketId) ? record.bucketId : null;
      addOption(bucketId, bucketId ? bucketOrder.get(bucketId)?.bucketLabel ?? "Ungrouped" : "Ungrouped", category);
    });

    const orderedGroups = Array.from(grouped.entries()).map(([bucketId, group]) => ({
      bucketLabel: group.bucketLabel,
      options: group.options.sort((a, b) => a.label.localeCompare(b.label)),
      bucketId,
    }));

    orderedGroups.sort((a, b) => {
      const aIndex = a.bucketId === "__ungrouped" ? Number.MAX_SAFE_INTEGER : bucketOrder.get(a.bucketId)?.index ?? Number.MAX_SAFE_INTEGER;
      const bIndex = b.bucketId === "__ungrouped" ? Number.MAX_SAFE_INTEGER : bucketOrder.get(b.bucketId)?.index ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });

    return orderedGroups.map(({ bucketLabel, options }) => ({ bucketLabel, options }));
}
