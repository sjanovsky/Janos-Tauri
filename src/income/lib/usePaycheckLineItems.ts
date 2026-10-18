import { invoke } from "@tauri-apps/api/core";
import {
  moveBucket,
  moveItem,
  type PaycheckBucketRecord,
  type PaycheckItemRecord,
} from "./income";

type Options = {
  buckets: PaycheckBucketRecord[];
  setBuckets: React.Dispatch<React.SetStateAction<PaycheckBucketRecord[]>>;
  items: PaycheckItemRecord[];
  setItems: React.Dispatch<React.SetStateAction<PaycheckItemRecord[]>>;
  onError: (message: string) => void;
  // Called when a line item is deleted so the caller can drop the amounts entered for it; returns
  // a function that undoes that if saving fails.
  onItemRemoved?: (id: string) => () => void;
};

// The edit handlers behind the paycheck buckets & line items board, shared by every page that
// shows it. Each updates state straight away and rolls back if the database write fails.
export function usePaycheckLineItems({
  buckets,
  setBuckets,
  items,
  setItems,
  onError,
  onItemRemoved,
}: Options) {
  const failSave = (what: string, rollback: () => void) => (error: unknown) => {
    console.error(`Failed to save ${what}`, error);
    onError(`Couldn't save ${what} to the database.`);
    rollback();
  };

  const handleSaveBucket = (
    bucket: Pick<PaycheckBucketRecord, "id" | "name" | "color">,
  ) => {
    const previous = buckets;
    setBuckets((all) =>
      all.some((item) => item.id === bucket.id)
        ? all.map((item) =>
            item.id === bucket.id ? { ...item, ...bucket } : item,
          )
        : [...all, { ...bucket, position: all.length }],
    );
    invoke("upsert_paycheck_bucket", {
      id: bucket.id,
      name: bucket.name,
      color: bucket.color,
    }).catch(failSave("that bucket", () => setBuckets(previous)));
  };

  const handleDeleteBucket = (id: string) => {
    const previousBuckets = buckets;
    const previousItems = items;
    setBuckets((all) => all.filter((bucket) => bucket.id !== id));
    setItems((all) =>
      all.map((item) =>
        item.bucketId === id ? { ...item, bucketId: null } : item,
      ),
    );
    invoke("delete_paycheck_bucket", { id }).catch(
      failSave("that change", () => {
        setBuckets(previousBuckets);
        setItems(previousItems);
      }),
    );
  };

  const handleSaveItem = (
    item: Pick<PaycheckItemRecord, "id" | "label" | "bucketId">,
  ) => {
    const previous = items;
    setItems((all) =>
      all.some((existing) => existing.id === item.id)
        ? all.map((existing) =>
            existing.id === item.id ? { ...existing, ...item } : existing,
          )
        : [...all, { ...item, position: all.length }],
    );
    invoke("upsert_paycheck_item", {
      id: item.id,
      label: item.label,
      bucketId: item.bucketId,
    }).catch(failSave("that line item", () => setItems(previous)));
  };

  const handleDeleteItem = (id: string) => {
    const previousItems = items;
    setItems((all) => all.filter((item) => item.id !== id));
    const undoExtras = onItemRemoved?.(id);
    invoke("delete_paycheck_item", { id }).catch(
      failSave("that change", () => {
        setItems(previousItems);
        undoExtras?.();
      }),
    );
  };

  const handleMoveItem = (
    itemId: string,
    bucketId: string | null,
    beforeItemId: string | null,
  ) => {
    const previous = items;
    const next = moveItem(items, itemId, bucketId, beforeItemId);
    if (next === items) {
      return;
    }
    setItems(next);
    const layout = [...next]
      .sort((a, b) => a.position - b.position)
      .map((item) => ({ id: item.id, bucketId: item.bucketId }));
    invoke("set_paycheck_item_layout", { layout }).catch(
      failSave("that move", () => setItems(previous)),
    );
  };

  const handleMoveBucket = (
    bucketId: string,
    beforeBucketId: string | null,
  ) => {
    const previous = buckets;
    const next = moveBucket(buckets, bucketId, beforeBucketId);
    if (next === buckets) {
      return;
    }
    setBuckets(next);
    const ids = [...next]
      .sort((a, b) => a.position - b.position)
      .map((bucket) => bucket.id);
    invoke("set_paycheck_bucket_positions", { ids }).catch(
      failSave("that move", () => setBuckets(previous)),
    );
  };

  return {
    buckets,
    items,
    onSaveBucket: handleSaveBucket,
    onDeleteBucket: handleDeleteBucket,
    onSaveItem: handleSaveItem,
    onDeleteItem: handleDeleteItem,
    onMoveItem: handleMoveItem,
    onMoveBucket: handleMoveBucket,
  };
}
