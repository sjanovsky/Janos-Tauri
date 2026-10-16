import { invoke } from "@tauri-apps/api/core";
import {
  generateCategoryId,
  getCategoryColor,
  getCategoryLabel,
  nextBucketColor,
  type BucketRecord,
  type CategoryRecord,
} from "./categories";

type Options = {
  buckets: BucketRecord[];
  setBuckets: React.Dispatch<React.SetStateAction<BucketRecord[]>>;
  categoryRecords: CategoryRecord[];
  setCategoryRecords: React.Dispatch<React.SetStateAction<CategoryRecord[]>>;
  onError: (message: string) => void;
  // Called when a category is deleted so the caller can reset what used it (e.g. move its
  // transactions to unclassified); returns a function that undoes that if saving fails.
  onCategoryRemoved?: (id: string) => () => void;
};

// The edit handlers behind the Buckets & Categories board, shared by every page that shows it.
// Each updates state straight away and rolls back if the database write fails.
export function useBucketsAndCategories({
  buckets,
  setBuckets,
  categoryRecords,
  setCategoryRecords,
  onError,
  onCategoryRemoved,
}: Options) {
  const handleAddCategory = (label: string, color: string) => {
    const previousRecords = categoryRecords;
    const id = generateCategoryId(label, categoryRecords.map((record) => record.id));
    setCategoryRecords((current) => [
      ...current,
      { id, label, color, excluded: false, bucketId: null, position: 0 },
    ]);

    invoke("upsert_category", { id, label, color }).catch((error) => {
      console.error("Failed to save the new category to the database", error);
      onError("Couldn't save that category to the database.");
      setCategoryRecords(previousRecords);
    });
  };

  const handleUpdateCategory = (id: string, label: string, color: string) => {
    const previousRecords = categoryRecords;
    setCategoryRecords((current) => {
      const exists = current.some((record) => record.id === id);
      return exists
        ? current.map((record) => (record.id === id ? { ...record, label, color } : record))
        : [...current, { id, label, color, excluded: false, bucketId: null, position: 0 }];
    });

    invoke("upsert_category", { id, label, color }).catch((error) => {
      console.error("Failed to save the category change to the database", error);
      onError("Couldn't save that category change to the database.");
      setCategoryRecords(previousRecords);
    });
  };

  const handleDeleteCategory = (id: string) => {
    const previousRecords = categoryRecords;
    setCategoryRecords((current) => current.filter((record) => record.id !== id));
    const undoExtras = onCategoryRemoved?.(id);

    invoke("delete_category", { id }).catch((error) => {
      console.error("Failed to delete the category from the database", error);
      onError("Couldn't delete that category from the database.");
      setCategoryRecords(previousRecords);
      undoExtras?.();
    });
  };

  const handleAddBucket = (name: string) => {
    const previousBuckets = buckets;
    const id = crypto.randomUUID();
    const color = nextBucketColor(buckets.length);
    // New buckets land at the end of the order, matching upsert_bucket's MAX + 1 on the DB side.
    const position = buckets.reduce((max, bucket) => Math.max(max, bucket.position), -1) + 1;
    setBuckets((current) => [...current, { id, name, color, position }]);

    invoke("upsert_bucket", { id, name, color }).catch((error) => {
      console.error("Failed to save the new bucket to the database", error);
      onError("Couldn't save that bucket to the database.");
      setBuckets(previousBuckets);
    });
  };

  const handleRenameBucket = (id: string, name: string) => {
    const previousBuckets = buckets;
    const color = buckets.find((bucket) => bucket.id === id)?.color ?? nextBucketColor(buckets.length);
    setBuckets((current) => current.map((bucket) => (bucket.id === id ? { ...bucket, name } : bucket)));

    invoke("upsert_bucket", { id, name, color }).catch((error) => {
      console.error("Failed to rename the bucket in the database", error);
      onError("Couldn't save that bucket to the database.");
      setBuckets(previousBuckets);
    });
  };

  const handleSetBucketColor = (id: string, color: string) => {
    const previousBuckets = buckets;
    const name = buckets.find((bucket) => bucket.id === id)?.name;
    if (name === undefined) {
      return;
    }
    setBuckets((current) => current.map((bucket) => (bucket.id === id ? { ...bucket, color } : bucket)));

    invoke("upsert_bucket", { id, name, color }).catch((error) => {
      console.error("Failed to save the bucket color to the database", error);
      onError("Couldn't save that bucket change to the database.");
      setBuckets(previousBuckets);
    });
  };

  const handleDeleteBucket = (id: string) => {
    const previousBuckets = buckets;
    const previousRecords = categoryRecords;

    setBuckets((current) => current.filter((bucket) => bucket.id !== id));
    setCategoryRecords((current) =>
      current.map((record) => (record.bucketId === id ? { ...record, bucketId: null } : record)),
    );

    invoke("delete_bucket", { id }).catch((error) => {
      console.error("Failed to delete the bucket from the database", error);
      onError("Couldn't delete that bucket from the database.");
      setBuckets(previousBuckets);
      setCategoryRecords(previousRecords);
    });
  };

  // Reorder the buckets to the given id order (dragged in the manager); drives the section order
  // in the Spending by Month table and the stacked bars.
  const handleReorderBuckets = (orderedIds: string[]) => {
    const previousBuckets = buckets;
    const positionById = new Map(orderedIds.map((id, index) => [id, index]));
    setBuckets((current) =>
      current.map((bucket) =>
        positionById.has(bucket.id) ? { ...bucket, position: positionById.get(bucket.id)! } : bucket,
      ),
    );

    invoke("set_bucket_positions", { ids: orderedIds }).catch((error) => {
      console.error("Failed to save the bucket order to the database", error);
      onError("Couldn't save that bucket order to the database.");
      setBuckets(previousBuckets);
    });
  };

  // A category lives in one place: a bucket, the Ungrouped tray (bucketId null), or the
  // Exclude tray (excluded true, left out of the spending chart/totals). Bucket and excluded
  // are mutually exclusive, so both are written together. When dropping into a bucket the caller
  // also passes `orderedBucketIds` — that bucket's full member order after the move — which sets
  // each member's position (the order shown in the Spending by Month table).
  const handlePlaceCategory = (
    categoryId: string,
    bucketId: string | null,
    excluded: boolean,
    orderedBucketIds?: string[],
  ) => {
    const previousRecords = categoryRecords;
    const existing = categoryRecords.find((record) => record.id === categoryId);
    const label = existing?.label ?? getCategoryLabel(categoryId);
    const color = existing?.color ?? getCategoryColor(categoryId);
    const positionById = orderedBucketIds
      ? new Map(orderedBucketIds.map((id, index) => [id, index]))
      : null;

    setCategoryRecords((current) => {
      const withMoved = current.some((record) => record.id === categoryId)
        ? current.map((record) => (record.id === categoryId ? { ...record, bucketId, excluded } : record))
        : [
            ...current,
            { id: categoryId, label, color, excluded, bucketId, position: positionById?.get(categoryId) ?? 0 },
          ];
      return positionById
        ? withMoved.map((record) =>
            positionById.has(record.id) ? { ...record, position: positionById.get(record.id)! } : record,
          )
        : withMoved;
    });

    // Persist the placement first (it creates the row for a transaction-only category), then the
    // positions, so the reorder update always lands on an existing row.
    invoke("set_category_placement", { id: categoryId, label, color, excluded, bucketId })
      .then(() => (orderedBucketIds ? invoke("set_category_positions", { ids: orderedBucketIds }) : undefined))
      .catch((error) => {
        console.error("Failed to save the category placement to the database", error);
        onError("Couldn't save that category change to the database.");
        setCategoryRecords(previousRecords);
      });
  };

  return {
    categories: categoryRecords,
    buckets,
    onAdd: handleAddCategory,
    onUpdate: handleUpdateCategory,
    onDelete: handleDeleteCategory,
    onAddBucket: handleAddBucket,
    onRenameBucket: handleRenameBucket,
    onSetBucketColor: handleSetBucketColor,
    onDeleteBucket: handleDeleteBucket,
    onReorderBuckets: handleReorderBuckets,
    onPlaceCategory: handlePlaceCategory,
  };
}
