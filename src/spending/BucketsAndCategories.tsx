import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type FormEvent } from "react";
import { ColorSwatchPicker } from "./ColorSwatchPicker";
import {
  EXCLUDE_BUCKET_COLOR,
  EXCLUDE_BUCKET_ID,
  UNGROUPED_BUCKET_COLOR,
  UNGROUPED_BUCKET_ID,
  type BucketRecord,
  type CategoryRecord,
} from "./lib/categories";

type BucketsAndCategoriesProps = {
  categories: CategoryRecord[];
  buckets: BucketRecord[];
  onAdd: (label: string, color: string) => void;
  onUpdate: (id: string, label: string, color: string) => void;
  onDelete: (id: string) => void;
  onAddBucket: (name: string) => void;
  onRenameBucket: (id: string, name: string) => void;
  onSetBucketColor: (id: string, color: string) => void;
  onDeleteBucket: (id: string) => void;
  // Reorder all buckets to the given id order (dragged by their handles).
  onReorderBuckets: (orderedIds: string[]) => void;
  // Move a category into a bucket (bucketId), the Ungrouped tray (null), or the Exclude
  // tray (excluded = true). Bucket and excluded are mutually exclusive placements. When placing
  // into a bucket, `orderedBucketIds` is that bucket's full member order after the move, which
  // sets each category's position (the order shown in the Spending by Month table).
  onPlaceCategory: (
    categoryId: string,
    bucketId: string | null,
    excluded: boolean,
    orderedBucketIds?: string[],
  ) => void;
};

const NEW_CATEGORY_DEFAULT_COLOR = "#4f46e5";
const CATEGORY_DRAG_TYPE = "application/x-janos-category";
const BUCKET_DRAG_TYPE = "application/x-janos-bucket";

export function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
      <circle cx="9" cy="5" r="1.6" />
      <circle cx="15" cy="5" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="19" r="1.6" />
      <circle cx="15" cy="19" r="1.6" />
    </svg>
  );
}

// Grow a bucket-name textarea to fit its (possibly wrapped) content so long names aren't clipped.
function autoGrowTextarea(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

const byLabel = (a: CategoryRecord, b: CategoryRecord) => a.label.localeCompare(b.label);

// Buckets render in the order the user set by dragging (position), with name as a stable
// tie-breaker for migrated rows that all share position 0.
const byBucketPosition = (a: BucketRecord, b: BucketRecord) =>
  a.position - b.position || a.name.localeCompare(b.name);

// Bucket members render in the order the user set by dragging (position), with label as a stable
// tie-breaker for migrated rows that all share position 0.
const byPosition = (a: CategoryRecord, b: CategoryRecord) =>
  a.position - b.position || a.label.localeCompare(b.label);

function BucketsAndCategories({
  categories,
  buckets,
  onAdd,
  onUpdate,
  onDelete,
  onAddBucket,
  onRenameBucket,
  onSetBucketColor,
  onDeleteBucket,
  onReorderBuckets,
  onPlaceCategory,
}: BucketsAndCategoriesProps) {
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState(NEW_CATEGORY_DEFAULT_COLOR);
  const [newBucket, setNewBucket] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  // Live preview of a bucket's member order while a pill is dragged over it: the other pills
  // reflow to this order (opening a gap) so the drop's result is visible before releasing.
  const [dragPreview, setDragPreview] = useState<{ bucketId: string; orderedIds: string[] } | null>(null);
  // The same, one level up: which bucket is being dragged by its handle, and the live preview of
  // the whole-bucket order while it's dragged over the others.
  const [draggingBucketId, setDraggingBucketId] = useState<string | null>(null);
  const [bucketDragPreview, setBucketDragPreview] = useState<string[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingId]);

  // Place each category in exactly one row: excluded categories go to the "Exclude" tray;
  // otherwise its (known) bucket, or the "Ungrouped" tray where newly added categories start.
  const bucketIds = new Set(buckets.map((bucket) => bucket.id));
  const categoriesByBucket = new Map<string, CategoryRecord[]>();
  buckets.forEach((bucket) => categoriesByBucket.set(bucket.id, []));
  const excluded: CategoryRecord[] = [];
  const ungrouped: CategoryRecord[] = [];
  categories.forEach((category) => {
    if (category.excluded) {
      excluded.push(category);
    } else if (category.bucketId && bucketIds.has(category.bucketId)) {
      categoriesByBucket.get(category.bucketId)!.push(category);
    } else {
      ungrouped.push(category);
    }
  });
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  // A bucket's member ids in saved (position) order.
  const sortedBucketIds = (bucketId: string) =>
    (categoriesByBucket.get(bucketId) ?? [])
      .slice()
      .sort(byPosition)
      .map((category) => category.id);

  // Insert `draggedId` into `bucketId`'s order at `beforeId` (null = end). `after` nudges past the
  // reference pill, so dropping on a pill's right half lands after it (and lets you reach the end).
  const orderWithInsertion = (
    bucketId: string,
    draggedId: string,
    beforeId: string | null,
    after = false,
  ) => {
    const without = sortedBucketIds(bucketId).filter((id) => id !== draggedId);
    if (!beforeId) {
      return [...without, draggedId];
    }
    const base = without.indexOf(beforeId);
    const index = base === -1 ? without.length : after ? base + 1 : base;
    return [...without.slice(0, index), draggedId, ...without.slice(index)];
  };

  const sameOrder = (a: string[], b: string[]) =>
    a.length === b.length && a.every((value, index) => value === b[index]);

  // The members to render for a bucket: its preview order when it's the active drop target, or its
  // members with the dragged pill removed when that pill is being dragged into a different bucket.
  const displayMembers = (bucketId: string): CategoryRecord[] => {
    const base = (categoriesByBucket.get(bucketId) ?? []).slice().sort(byPosition);
    if (!draggingId) {
      return base;
    }
    if (dragPreview && dragPreview.bucketId === bucketId) {
      return dragPreview.orderedIds
        .map((id) => categoryById.get(id))
        .filter((category): category is CategoryRecord => Boolean(category));
    }
    if (dragPreview && base.some((category) => category.id === draggingId)) {
      return base.filter((category) => category.id !== draggingId);
    }
    return base;
  };

  // --- Whole-bucket reordering (dragging a bucket by its handle) ---

  const baseBucketOrder = () => buckets.slice().sort(byBucketPosition).map((bucket) => bucket.id);

  const bucketOrderWithInsertion = (draggedId: string, beforeId: string, after: boolean) => {
    const without = baseBucketOrder().filter((id) => id !== draggedId);
    const base = without.indexOf(beforeId);
    const index = base === -1 ? without.length : after ? base + 1 : base;
    return [...without.slice(0, index), draggedId, ...without.slice(index)];
  };

  // Buckets to render, in preview order while one is being dragged.
  const displayBuckets = (): BucketRecord[] => {
    const base = buckets.slice().sort(byBucketPosition);
    if (!draggingBucketId || !bucketDragPreview) {
      return base;
    }
    const byId = new Map(base.map((bucket) => [bucket.id, bucket]));
    return bucketDragPreview
      .map((id) => byId.get(id))
      .filter((bucket): bucket is BucketRecord => Boolean(bucket));
  };

  const isBucketDrag = (event: DragEvent<HTMLDivElement>) =>
    event.dataTransfer.types.includes(BUCKET_DRAG_TYPE) || draggingBucketId !== null;

  const clearBucketDrag = () => {
    setDraggingBucketId(null);
    setBucketDragPreview(null);
  };

  const handleBucketDragStart = (event: DragEvent<HTMLSpanElement>, bucket: BucketRecord) => {
    event.dataTransfer.setData(BUCKET_DRAG_TYPE, bucket.id);
    event.dataTransfer.effectAllowed = "move";
    // Drag the whole row, not just the grip.
    const row = (event.currentTarget as HTMLElement).closest(".bucket-row");
    if (row) {
      event.dataTransfer.setDragImage(row, 24, 20);
    }
    setDraggingBucketId(bucket.id);
  };

  const handleAddSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = newLabel.trim();
    if (!trimmed) {
      return;
    }
    onAdd(trimmed, newColor);
    setNewLabel("");
    setNewColor(NEW_CATEGORY_DEFAULT_COLOR);
  };

  const handleAddBucketSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = newBucket.trim();
    if (!trimmed) {
      return;
    }
    onAddBucket(trimmed);
    setNewBucket("");
  };

  const handlePillDragStart = (event: DragEvent<HTMLDivElement>, category: CategoryRecord) => {
    event.dataTransfer.setData(CATEGORY_DRAG_TYPE, category.id);
    event.dataTransfer.setData("text/plain", category.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setDragImage(event.currentTarget, 20, 16);
    setDraggingId(category.id);
  };

  const handleRowDragOver = (event: DragEvent<HTMLDivElement>, key: string) => {
    // dataTransfer.types is readable during dragover (unlike getData), so it works even on
    // the first event before the draggingId state has committed.
    const isCategoryDrag = event.dataTransfer.types.includes(CATEGORY_DRAG_TYPE) || draggingId !== null;
    if (!isCategoryDrag) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverKey(key);
    // Over a bucket's background (not a specific pill): preview an append, but keep a precise
    // pill-based preview already set for this bucket. Trays aren't ordered, so clear the preview.
    if (draggingId && bucketIds.has(key)) {
      setDragPreview((current) =>
        current && current.bucketId === key
          ? current
          : { bucketId: key, orderedIds: orderWithInsertion(key, draggingId, null) },
      );
    } else {
      setDragPreview(null);
    }
  };

  const handleRowDragLeave = (event: DragEvent<HTMLDivElement>, key: string) => {
    // Drag events bubble from the pills inside the row, so only clear once the pointer actually
    // leaves the row (not when it crosses onto a child).
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setDragOverKey((current) => (current === key ? null : current));
    setDragPreview((current) => (current && current.bucketId === key ? null : current));
  };

  const clearDragState = () => {
    setDraggingId(null);
    setDragOverKey(null);
    setDragPreview(null);
  };

  const handleRowDrop = (
    event: DragEvent<HTMLDivElement>,
    target: { bucketId: string | null; excluded: boolean },
  ) => {
    event.preventDefault();
    const categoryId = event.dataTransfer.getData(CATEGORY_DRAG_TYPE) || draggingId;
    if (categoryId) {
      if (target.bucketId && !target.excluded && bucketIds.has(target.bucketId)) {
        // Commit the previewed order (the gap the user is looking at); fall back to append.
        const order =
          dragPreview && dragPreview.bucketId === target.bucketId
            ? dragPreview.orderedIds
            : orderWithInsertion(target.bucketId, categoryId, null);
        onPlaceCategory(categoryId, target.bucketId, false, order);
      } else {
        // Trays (Ungrouped / Exclude) aren't ordered, so they take the plain placement.
        onPlaceCategory(categoryId, target.bucketId, target.excluded);
      }
    }
    clearDragState();
  };

  // Hovering a specific pill sets a precise insertion point: before it, or after it when the
  // pointer is past its horizontal midpoint. stopPropagation keeps the row from overriding it.
  const handlePillDragOver = (
    event: DragEvent<HTMLDivElement>,
    bucketId: string,
    category: CategoryRecord,
  ) => {
    const isCategoryDrag = event.dataTransfer.types.includes(CATEGORY_DRAG_TYPE) || draggingId !== null;
    if (!isCategoryDrag) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDragOverKey(bucketId);
    if (!draggingId || category.id === draggingId) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientX > rect.left + rect.width / 2;
    const orderedIds = orderWithInsertion(bucketId, draggingId, category.id, after);
    setDragPreview((current) =>
      current && current.bucketId === bucketId && sameOrder(current.orderedIds, orderedIds)
        ? current
        : { bucketId, orderedIds },
    );
  };

  // A bucket row is a drop target for two kinds of drag: a bucket being reordered by its handle,
  // or a category being dropped into the bucket. Dispatch on the drag type.
  const handleBucketRowDragOver = (event: DragEvent<HTMLDivElement>, bucket: BucketRecord) => {
    if (!isBucketDrag(event)) {
      handleRowDragOver(event, bucket.id);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (!draggingBucketId || bucket.id === draggingBucketId) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    const order = bucketOrderWithInsertion(draggingBucketId, bucket.id, after);
    setBucketDragPreview((current) => (current && sameOrder(current, order) ? current : order));
  };

  const handleBucketRowDragLeave = (event: DragEvent<HTMLDivElement>, bucket: BucketRecord) => {
    // The bucket-reorder preview intentionally persists across rows (cleared on drop/dragend);
    // only the category highlight clears when leaving a row.
    if (!isBucketDrag(event)) {
      handleRowDragLeave(event, bucket.id);
    }
  };

  const handleBucketRowDrop = (event: DragEvent<HTMLDivElement>, bucket: BucketRecord) => {
    if (!isBucketDrag(event)) {
      handleRowDrop(event, { bucketId: bucket.id, excluded: false });
      return;
    }
    event.preventDefault();
    if (draggingBucketId) {
      onReorderBuckets(bucketDragPreview ?? baseBucketOrder());
    }
    clearBucketDrag();
  };

  // `bucketId` is the real bucket a pill belongs to; pills in a bucket are reorder drop targets,
  // while tray pills (Ungrouped / Exclude) pass null and only the row handles drops.
  const renderPill = (category: CategoryRecord, sectionColor: string, bucketId: string | null = null) => {
    const isEditing = editingId === category.id;
    const isReorderable = bucketId !== null;
    return (
      <div
        key={category.id}
        className={`cat-pill ${draggingId === category.id ? "cat-pill--dragging" : ""}`}
        style={{ "--cat": sectionColor } as CSSProperties}
        draggable={!isEditing}
        onDragStart={(event) => handlePillDragStart(event, category)}
        onDragEnd={clearDragState}
        onDragOver={isReorderable ? (event) => handlePillDragOver(event, bucketId, category) : undefined}
        onDrop={
          isReorderable
            ? (event) => {
                // A bucket being reordered should fall through to the row; only a category drop
                // is handled here (and stopped from also firing the row's append-to-end drop).
                if (!draggingId) {
                  return;
                }
                event.stopPropagation();
                handleRowDrop(event, { bucketId, excluded: false });
              }
            : undefined
        }
      >
        {isEditing ? (
          <input
            ref={editInputRef}
            type="text"
            className="cat-pill__edit"
            defaultValue={category.label}
            aria-label={`Name for ${category.label}`}
            onBlur={(event) => {
              const trimmed = event.target.value.trim();
              if (trimmed && trimmed !== category.label) {
                onUpdate(category.id, trimmed, category.color);
              }
              setEditingId(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                event.currentTarget.value = category.label;
                event.currentTarget.blur();
              }
            }}
          />
        ) : (
          <span
            className="cat-pill__label"
            title="Double-click to rename"
            onDoubleClick={() => setEditingId(category.id)}
          >
            {category.label}
          </span>
        )}

        <button
          type="button"
          className="cat-pill__remove"
          aria-label={`Delete ${category.label}`}
          title="Delete category"
          onClick={() => onDelete(category.id)}
        >
          <CloseIcon />
        </button>
      </div>
    );
  };

  return (
    <section className="category-manager">
      <div className="category-manager__heading">
        <h2>Buckets &amp; categories</h2>
        <p>
          Drag a category into a bucket to group it. Drop it in “Exclude” to leave it out of
          spending, or “Ungrouped” to pull it back out.
        </p>
      </div>

      <div className="bucket-board">
        <div className="bucket-board__header">
          <span className="bucket-board__header-label">Bucket</span>
          <span className="bucket-board__header-label">Categories</span>
        </div>
        {displayBuckets().map((bucket) => {
          const members = displayMembers(bucket.id);
          const isOver = dragOverKey === bucket.id;
          const isDraggingThis = draggingBucketId === bucket.id;
          return (
            <div
              key={bucket.id}
              className={`bucket-row ${isOver ? "bucket-row--drop" : ""} ${
                isDraggingThis ? "bucket-row--dragging" : ""
              }`}
              onDragOver={(event) => handleBucketRowDragOver(event, bucket)}
              onDragLeave={(event) => handleBucketRowDragLeave(event, bucket)}
              onDrop={(event) => handleBucketRowDrop(event, bucket)}
            >
              <div className="bucket-row__head">
                <span
                  className="bucket-row__grip"
                  role="button"
                  tabIndex={-1}
                  draggable
                  aria-label={`Reorder bucket ${bucket.name}`}
                  title="Drag to reorder this bucket"
                  onDragStart={(event) => handleBucketDragStart(event, bucket)}
                  onDragEnd={clearBucketDrag}
                >
                  <GripIcon />
                </span>
                <ColorSwatchPicker
                  value={bucket.color}
                  label={`Color for bucket ${bucket.name}`}
                  onChange={(color) => onSetBucketColor(bucket.id, color)}
                />
                <textarea
                  key={bucket.name}
                  rows={1}
                  className="bucket-row__name"
                  defaultValue={bucket.name}
                  aria-label={`Name for bucket ${bucket.name}`}
                  ref={(el) => {
                    if (el) {
                      autoGrowTextarea(el);
                    }
                  }}
                  onInput={(event) => autoGrowTextarea(event.currentTarget)}
                  onBlur={(event) => {
                    const trimmed = event.target.value.trim();
                    if (trimmed && trimmed !== bucket.name) {
                      onRenameBucket(bucket.id, trimmed);
                    } else {
                      event.target.value = bucket.name;
                      autoGrowTextarea(event.target);
                    }
                  }}
                  onKeyDown={(event) => {
                    // Enter saves (blur) instead of inserting a newline into the name.
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                />
              </div>

              <div className="bucket-row__items">
                {members.length === 0 ? (
                  <span className="bucket-row__empty">Drag categories here</span>
                ) : (
                  members.map((category) => renderPill(category, bucket.color, bucket.id))
                )}
              </div>

              <button
                type="button"
                className="import-shell__upload-delete bucket-row__delete"
                aria-label={`Delete bucket ${bucket.name}`}
                onClick={() => onDeleteBucket(bucket.id)}
              >
                <TrashIcon />
              </button>
            </div>
          );
        })}

        <div
          className={`bucket-row bucket-row--exclude ${
            dragOverKey === EXCLUDE_BUCKET_ID ? "bucket-row--drop" : ""
          }`}
          onDragOver={(event) => handleRowDragOver(event, EXCLUDE_BUCKET_ID)}
          onDragLeave={(event) => handleRowDragLeave(event, EXCLUDE_BUCKET_ID)}
          onDrop={(event) => handleRowDrop(event, { bucketId: null, excluded: true })}
        >
          <div className="bucket-row__head">
            <span className="bucket-row__name bucket-row__name--static">Exclude</span>
          </div>
          <div className="bucket-row__items">
            {excluded.length === 0 ? (
              <span className="bucket-row__empty">Drop here to leave out of spending</span>
            ) : (
              excluded
                .slice()
                .sort(byLabel)
                .map((category) => renderPill(category, EXCLUDE_BUCKET_COLOR))
            )}
          </div>
        </div>

        <div
          className={`bucket-row bucket-row--ungrouped ${
            dragOverKey === UNGROUPED_BUCKET_ID ? "bucket-row--drop" : ""
          }`}
          onDragOver={(event) => handleRowDragOver(event, UNGROUPED_BUCKET_ID)}
          onDragLeave={(event) => handleRowDragLeave(event, UNGROUPED_BUCKET_ID)}
          onDrop={(event) => handleRowDrop(event, { bucketId: null, excluded: false })}
        >
          <div className="bucket-row__head">
            <span className="bucket-row__name bucket-row__name--static">Ungrouped</span>
          </div>
          <div className="bucket-row__items">
            {ungrouped.length === 0 ? (
              <span className="bucket-row__empty">Drop here to remove from a bucket</span>
            ) : (
              ungrouped
                .slice()
                .sort(byLabel)
                .map((category) => renderPill(category, UNGROUPED_BUCKET_COLOR))
            )}
          </div>
        </div>
      </div>

      <div className="bucket-board__forms">
        <form className="bucket-board__add" onSubmit={handleAddBucketSubmit}>
          <div className="bucket-board__field">
            <input
              type="text"
              className="category-manager__label-input"
              placeholder="New bucket"
              value={newBucket}
              onChange={(event) => setNewBucket(event.target.value)}
            />
            {newBucket.trim() && (
              <button
                type="submit"
                className="bucket-board__add-btn"
                aria-label="Add bucket"
                title="Add bucket"
              >
                <PlusIcon />
              </button>
            )}
          </div>
        </form>

        <form className="bucket-board__add" onSubmit={handleAddSubmit}>
          <div className="bucket-board__field">
            <input
              type="text"
              className="category-manager__label-input"
              placeholder="New category"
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
            />
            {newLabel.trim() && (
              <button
                type="submit"
                className="bucket-board__add-btn"
                aria-label="Add category"
                title="Add category"
              >
                <PlusIcon />
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}

export default BucketsAndCategories;
