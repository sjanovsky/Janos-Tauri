import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type FormEvent } from "react";
import type { BucketRecord, CategoryRecord } from "./categories";

type CategoriesPanelProps = {
  categories: CategoryRecord[];
  buckets: BucketRecord[];
  onAdd: (label: string, color: string) => void;
  onUpdate: (id: string, label: string, color: string) => void;
  onDelete: (id: string) => void;
  onAddBucket: (name: string) => void;
  onRenameBucket: (id: string, name: string) => void;
  onDeleteBucket: (id: string) => void;
  onSetCategoryBucket: (categoryId: string, bucketId: string | null) => void;
};

const NEW_CATEGORY_DEFAULT_COLOR = "#4f46e5";
const CATEGORY_DRAG_TYPE = "application/x-janos-category";
const UNGROUPED_KEY = "__ungrouped";

function TrashIcon() {
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

function PlusIcon() {
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

function CloseIcon() {
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

const byLabel = (a: CategoryRecord, b: CategoryRecord) => a.label.localeCompare(b.label);

function CategoriesPanel({
  categories,
  buckets,
  onAdd,
  onUpdate,
  onDelete,
  onAddBucket,
  onRenameBucket,
  onDeleteBucket,
  onSetCategoryBucket,
}: CategoriesPanelProps) {
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState(NEW_CATEGORY_DEFAULT_COLOR);
  const [newBucket, setNewBucket] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingId]);

  // Group categories under their bucket; anything without a (known) bucket falls into the
  // "Ungrouped" tray at the bottom, which is where newly added categories start.
  const bucketIds = new Set(buckets.map((bucket) => bucket.id));
  const categoriesByBucket = new Map<string, CategoryRecord[]>();
  buckets.forEach((bucket) => categoriesByBucket.set(bucket.id, []));
  const ungrouped: CategoryRecord[] = [];
  categories.forEach((category) => {
    if (category.bucketId && bucketIds.has(category.bucketId)) {
      categoriesByBucket.get(category.bucketId)!.push(category);
    } else {
      ungrouped.push(category);
    }
  });

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
  };

  const handleRowDragLeave = (event: DragEvent<HTMLDivElement>, key: string) => {
    // Drag events bubble from the pills inside the row, so only clear the highlight once
    // the pointer actually leaves the row (not when it crosses onto a child).
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setDragOverKey((current) => (current === key ? null : current));
  };

  const handleRowDrop = (event: DragEvent<HTMLDivElement>, bucketId: string | null) => {
    event.preventDefault();
    const categoryId = event.dataTransfer.getData(CATEGORY_DRAG_TYPE) || draggingId;
    if (categoryId) {
      onSetCategoryBucket(categoryId, bucketId);
    }
    setDraggingId(null);
    setDragOverKey(null);
  };

  const renderPill = (category: CategoryRecord) => {
    const isEditing = editingId === category.id;
    return (
      <div
        key={category.id}
        className={`cat-pill ${draggingId === category.id ? "cat-pill--dragging" : ""}`}
        style={{ "--cat": category.color } as CSSProperties}
        draggable={!isEditing}
        onDragStart={(event) => handlePillDragStart(event, category)}
        onDragEnd={() => {
          setDraggingId(null);
          setDragOverKey(null);
        }}
      >
        <input
          type="color"
          className="cat-pill__swatch"
          value={category.color}
          aria-label={`Color for ${category.label}`}
          onChange={(event) => onUpdate(category.id, category.label, event.target.value)}
        />

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
        <p>Drag a category into a bucket to group it. Drop it in “Ungrouped” to pull it back out.</p>
      </div>

      <div className="bucket-board">
        {buckets.map((bucket) => {
          const members = (categoriesByBucket.get(bucket.id) ?? []).slice().sort(byLabel);
          const isOver = dragOverKey === bucket.id;
          return (
            <div
              key={bucket.id}
              className={`bucket-row ${isOver ? "bucket-row--drop" : ""}`}
              onDragOver={(event) => handleRowDragOver(event, bucket.id)}
              onDragLeave={(event) => handleRowDragLeave(event, bucket.id)}
              onDrop={(event) => handleRowDrop(event, bucket.id)}
            >
              <div className="bucket-row__head">
                <input
                  key={bucket.name}
                  type="text"
                  className="bucket-row__name"
                  defaultValue={bucket.name}
                  aria-label={`Name for bucket ${bucket.name}`}
                  onBlur={(event) => {
                    const trimmed = event.target.value.trim();
                    if (trimmed && trimmed !== bucket.name) {
                      onRenameBucket(bucket.id, trimmed);
                    } else {
                      event.target.value = bucket.name;
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                />
                <button
                  type="button"
                  className="import-shell__upload-delete bucket-row__delete"
                  aria-label={`Delete bucket ${bucket.name}`}
                  onClick={() => onDeleteBucket(bucket.id)}
                >
                  <TrashIcon />
                </button>
              </div>

              <div className="bucket-row__items">
                {members.length === 0 ? (
                  <span className="bucket-row__empty">Drag categories here</span>
                ) : (
                  members.map(renderPill)
                )}
              </div>
            </div>
          );
        })}

        <div
          className={`bucket-row bucket-row--ungrouped ${
            dragOverKey === UNGROUPED_KEY ? "bucket-row--drop" : ""
          }`}
          onDragOver={(event) => handleRowDragOver(event, UNGROUPED_KEY)}
          onDragLeave={(event) => handleRowDragLeave(event, UNGROUPED_KEY)}
          onDrop={(event) => handleRowDrop(event, null)}
        >
          <div className="bucket-row__head">
            <span className="bucket-row__name bucket-row__name--static">Ungrouped</span>
          </div>
          <div className="bucket-row__items">
            {ungrouped.length === 0 ? (
              <span className="bucket-row__empty">Drop here to remove from a bucket</span>
            ) : (
              ungrouped.slice().sort(byLabel).map(renderPill)
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

export default CategoriesPanel;
