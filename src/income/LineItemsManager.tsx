import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
} from "react";
import Modal from "../spending/Modal";
import { ColorSwatchPicker } from "../spending/ColorSwatchPicker";
import {
  CloseIcon,
  GripIcon,
  PlusIcon,
  TrashIcon,
} from "../spending/BucketsAndCategories";
import {
  BUCKET_COLOR_PALETTE,
  UNGROUPED_BUCKET_COLOR,
} from "../spending/lib/categories";
import type {
  PaycheckBucketRecord,
  PaycheckItemRecord,
  PaycheckRecord,
} from "./lib/income";

type LineItemsManagerProps = {
  paychecks: PaycheckRecord[];
  onAddPaycheck: (name: string) => void;
  onUpdatePaycheck: (
    id: string,
    patch: Partial<
      Pick<
        PaycheckRecord,
        "name" | "depositPattern" | "color" | "paychecksPerYear" | "extraIncome"
      >
    >,
  ) => void;
  onDeletePaycheck: (id: string) => void;
  buckets: PaycheckBucketRecord[];
  items: PaycheckItemRecord[];
  onClose: () => void;
  onSaveBucket: (
    bucket: Pick<PaycheckBucketRecord, "id" | "name" | "color">,
  ) => void;
  onDeleteBucket: (id: string) => void;
  onSaveItem: (
    item: Pick<PaycheckItemRecord, "id" | "label" | "bucketId">,
  ) => void;
  onDeleteItem: (id: string) => void;
  // Move an item into a bucket (null = ungrouped) before another item (null = end), or move a
  // bucket before another bucket (null = end).
  onMoveItem: (
    itemId: string,
    bucketId: string | null,
    beforeItemId: string | null,
  ) => void;
  onMoveBucket: (bucketId: string, beforeBucketId: string | null) => void;
};

const ITEM_DRAG_TYPE = "application/x-janos-line-item";
const BUCKET_DRAG_TYPE = "application/x-janos-paycheck-bucket";

function BucketsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6h16l-1.5 13a1 1 0 0 1-1 .9H6.5a1 1 0 0 1-1-.9z" />
      <path d="M3.5 6l1-2.4a1 1 0 0 1 .92-.6h13.16a1 1 0 0 1 .92.6l1 2.4" />
      <path d="M9 11v4" />
      <path d="M15 11v4" />
    </svg>
  );
}

// Grow a bucket-name textarea to fit its (possibly wrapped) content so long names aren't clipped.
function autoGrowTextarea(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

// The buckets and line items every paycheck shares, laid out like the Spending page's buckets &
// categories board: a row per bucket with its line items as pills. Drag a pill into a bucket (or
// before another pill) to move it, drag the grip to reorder buckets, double-click a pill to
// rename it. New line items start Ungrouped. The grid only ever edits numbers; this is where the
// structure is edited.
type PaycheckBucketsBoardProps = Pick<
  LineItemsManagerProps,
  | "buckets"
  | "items"
  | "onSaveBucket"
  | "onDeleteBucket"
  | "onSaveItem"
  | "onDeleteItem"
  | "onMoveItem"
  | "onMoveBucket"
>;

// The paycheck buckets & line items board: drag line items between buckets, reorder buckets,
// rename, recolor, add and delete. Shown in the line items modal and on the Settings page.
export function PaycheckBucketsBoard({
  buckets,
  items,
  onSaveBucket,
  onDeleteBucket,
  onSaveItem,
  onDeleteItem,
  onMoveItem,
  onMoveBucket,
}: PaycheckBucketsBoardProps) {
  const [newBucket, setNewBucket] = useState("");
  const [newItem, setNewItem] = useState("");
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [draggingBucketId, setDraggingBucketId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingId]);

  const orderedBuckets = [...buckets].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  );
  const orderedItems = [...items].sort(
    (a, b) => a.position - b.position || a.label.localeCompare(b.label),
  );
  const bucketIds = new Set(buckets.map((bucket) => bucket.id));
  const itemsIn = (bucketId: string) =>
    orderedItems.filter((item) => item.bucketId === bucketId);
  const ungrouped = orderedItems.filter(
    (item) => !item.bucketId || !bucketIds.has(item.bucketId),
  );

  const clearDrag = () => {
    setDraggingItemId(null);
    setDraggingBucketId(null);
    setDragOverKey(null);
  };

  const addBucket = (event: FormEvent) => {
    event.preventDefault();
    const name = newBucket.trim();
    if (!name) {
      return;
    }
    onSaveBucket({
      id: crypto.randomUUID(),
      name,
      color: BUCKET_COLOR_PALETTE[buckets.length % BUCKET_COLOR_PALETTE.length],
    });
    setNewBucket("");
  };

  const addItem = (event: FormEvent) => {
    event.preventDefault();
    const label = newItem.trim();
    if (!label) {
      return;
    }
    onSaveItem({ id: crypto.randomUUID(), label, bucketId: null });
    setNewItem("");
  };

  // Dropping a pill: before the pill it landed on (or after it, past its midpoint), else at the
  // end of the row.
  const dropItem = (
    itemId: string,
    bucketId: string | null,
    beforeItemId: string | null,
  ) => {
    onMoveItem(itemId, bucketId, beforeItemId);
    clearDrag();
  };

  const renderPill = (
    item: PaycheckItemRecord,
    color: string,
    siblings: PaycheckItemRecord[],
    bucketId: string | null,
  ) => {
    const editing = editingId === item.id;
    return (
      <div
        key={item.id}
        className={`cat-pill ${draggingItemId === item.id ? "cat-pill--dragging" : ""}`}
        style={{ "--cat": color } as CSSProperties}
        draggable={!editing}
        onDragStart={(event) => {
          event.dataTransfer.setData(ITEM_DRAG_TYPE, item.id);
          event.dataTransfer.setData("text/plain", item.id);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setDragImage(event.currentTarget, 20, 16);
          setDraggingItemId(item.id);
        }}
        onDragEnd={clearDrag}
        onDragOver={(event) => {
          if (!draggingItemId) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          setDragOverKey(bucketId ?? "ungrouped");
        }}
        onDrop={(event) => {
          if (!draggingItemId) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          if (draggingItemId === item.id) {
            clearDrag();
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          const after = event.clientX > rect.left + rect.width / 2;
          const index = siblings.findIndex((sibling) => sibling.id === item.id);
          const next = after ? siblings[index + 1] : item;
          dropItem(draggingItemId, bucketId, next?.id ?? null);
        }}
      >
        {editing ? (
          <input
            ref={editInputRef}
            type="text"
            className="cat-pill__edit"
            defaultValue={item.label}
            aria-label={`Name for ${item.label}`}
            onBlur={(event) => {
              const label = event.target.value.trim();
              if (label && label !== item.label) {
                onSaveItem({ id: item.id, label, bucketId: item.bucketId });
              }
              setEditingId(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                event.currentTarget.value = item.label;
                event.currentTarget.blur();
              }
            }}
          />
        ) : (
          <span
            className="cat-pill__label"
            title="Double-click to rename"
            onDoubleClick={() => setEditingId(item.id)}
          >
            {item.label}
          </span>
        )}
        <button
          type="button"
          className="cat-pill__remove"
          aria-label={`Delete ${item.label}`}
          title="Delete line item"
          onClick={() => onDeleteItem(item.id)}
        >
          <CloseIcon />
        </button>
      </div>
    );
  };

  return (
    <section className="category-manager">
      <div className="category-manager__heading">
        <h2>Paycheck Buckets</h2>
        <p>
          Drag a line item into a bucket to group it, or onto “Ungrouped” to
          pull it back out. These are shared by every paycheck; each paycheck
          keeps its own amounts in the grid. Double-click a line item to rename
          it.
        </p>
      </div>

      <div className="bucket-board">
        <div className="bucket-board__header">
          <span className="bucket-board__header-label">Bucket</span>
          <span className="bucket-board__header-label">Line items</span>
        </div>

        {orderedBuckets.map((bucket) => {
          const members = itemsIn(bucket.id);
          return (
            <div
              key={bucket.id}
              className={`bucket-row ${dragOverKey === bucket.id ? "bucket-row--drop" : ""} ${
                draggingBucketId === bucket.id ? "bucket-row--dragging" : ""
              }`}
              onDragOver={(event: DragEvent<HTMLDivElement>) => {
                if (draggingBucketId) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                } else if (draggingItemId) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDragOverKey(bucket.id);
                }
              }}
              onDragLeave={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                ) {
                  setDragOverKey((current) =>
                    current === bucket.id ? null : current,
                  );
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggingBucketId) {
                  if (draggingBucketId !== bucket.id) {
                    // Past the row's midpoint lands after it: before the next bucket.
                    const rect = event.currentTarget.getBoundingClientRect();
                    const after = event.clientY > rect.top + rect.height / 2;
                    const index = orderedBuckets.findIndex(
                      (candidate) => candidate.id === bucket.id,
                    );
                    const next = after ? orderedBuckets[index + 1] : bucket;
                    onMoveBucket(draggingBucketId, next?.id ?? null);
                  }
                  clearDrag();
                } else if (draggingItemId) {
                  dropItem(draggingItemId, bucket.id, null);
                }
              }}
            >
              <div className="bucket-row__head">
                <span
                  className="bucket-row__grip"
                  role="button"
                  tabIndex={-1}
                  draggable
                  aria-label={`Reorder bucket ${bucket.name}`}
                  title="Drag to reorder this bucket"
                  onDragStart={(event) => {
                    event.dataTransfer.setData(BUCKET_DRAG_TYPE, bucket.id);
                    event.dataTransfer.effectAllowed = "move";
                    const row = (event.currentTarget as HTMLElement).closest(
                      ".bucket-row",
                    );
                    if (row) {
                      event.dataTransfer.setDragImage(row, 24, 20);
                    }
                    setDraggingBucketId(bucket.id);
                  }}
                  onDragEnd={clearDrag}
                >
                  <GripIcon />
                </span>
                <ColorSwatchPicker
                  value={bucket.color}
                  label={`Color for bucket ${bucket.name}`}
                  onChange={(color) =>
                    onSaveBucket({
                      id: bucket.id,
                      name: bucket.name,
                      color,
                    })
                  }
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
                    const name = event.target.value.trim();
                    if (name && name !== bucket.name) {
                      onSaveBucket({
                        id: bucket.id,
                        name,
                        color: bucket.color,
                      });
                    } else {
                      event.target.value = bucket.name;
                      autoGrowTextarea(event.target);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                />
              </div>

              <div className="bucket-row__items">
                {members.length === 0 ? (
                  <span className="bucket-row__empty">
                    Drag line items here
                  </span>
                ) : (
                  members.map((item) =>
                    renderPill(item, bucket.color, members, bucket.id),
                  )
                )}
              </div>

              <button
                type="button"
                className="import-shell__upload-delete bucket-row__delete"
                aria-label={`Delete bucket ${bucket.name}`}
                title="Delete bucket (its line items become ungrouped)"
                onClick={() => onDeleteBucket(bucket.id)}
              >
                <TrashIcon />
              </button>
            </div>
          );
        })}

        <div
          className={`bucket-row bucket-row--ungrouped ${
            dragOverKey === "ungrouped" ? "bucket-row--drop" : ""
          }`}
          onDragOver={(event) => {
            if (draggingItemId) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragOverKey("ungrouped");
            }
          }}
          onDragLeave={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              setDragOverKey((current) =>
                current === "ungrouped" ? null : current,
              );
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (draggingItemId) {
              dropItem(draggingItemId, null, null);
            }
          }}
        >
          <div className="bucket-row__head">
            <span className="bucket-row__name bucket-row__name--static">
              Ungrouped
            </span>
          </div>
          <div className="bucket-row__items">
            {ungrouped.length === 0 ? (
              <span className="bucket-row__empty">
                Drop here to remove from a bucket
              </span>
            ) : (
              ungrouped.map((item) =>
                renderPill(item, UNGROUPED_BUCKET_COLOR, ungrouped, null),
              )
            )}
          </div>
        </div>
      </div>

      <div className="bucket-board__forms">
        <form className="bucket-board__add" onSubmit={addBucket}>
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

        <form className="bucket-board__add" onSubmit={addItem}>
          <div className="bucket-board__field">
            <input
              type="text"
              className="category-manager__label-input"
              placeholder="New line item"
              value={newItem}
              onChange={(event) => setNewItem(event.target.value)}
            />
            {newItem.trim() && (
              <button
                type="submit"
                className="bucket-board__add-btn"
                aria-label="Add line item"
                title="Add line item"
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

function LineItemsManager({
  paychecks,
  onAddPaycheck,
  onUpdatePaycheck,
  onDeletePaycheck,
  buckets,
  items,
  onClose,
  onSaveBucket,
  onDeleteBucket,
  onSaveItem,
  onDeleteItem,
  onMoveItem,
  onMoveBucket,
}: LineItemsManagerProps) {
  const [tab, setTab] = useState<"paychecks" | "items">("paychecks");
  const [newPaycheck, setNewPaycheck] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  return (
    <Modal label="Line items" onClose={onClose}>
      <div className="manage-modal">
        <nav
          className="manage-modal__tabs"
          role="tablist"
          aria-label="Paycheck settings"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "paychecks"}
            className={`manage-modal__tab ${tab === "paychecks" ? "manage-modal__tab--active" : ""}`}
            onClick={() => setTab("paychecks")}
          >
            Paychecks
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "items"}
            className={`manage-modal__tab ${tab === "items" ? "manage-modal__tab--active" : ""}`}
            onClick={() => setTab("items")}
          >
            <span className="manage-modal__tab-icon">
              <BucketsIcon />
            </span>
            Line items
          </button>
        </nav>

        <div className="manage-modal__body">
          {tab === "paychecks" && (
            <section className="category-manager">
              <div className="category-manager__heading">
                <h2>Paychecks</h2>
                <p>
                  Each paycheck is a template with its own amounts and its own
                  income category for matching deposits.
                </p>
              </div>
              <table className="income-settings__table">
                <thead>
                  <tr>
                    <th>Paycheck</th>
                    <th>Transaction description contains</th>
                    <th>Paychecks per year</th>
                    <th>Extra income per year</th>
                    <th aria-label="Delete" />
                  </tr>
                </thead>
                <tbody>
                  {paychecks.length === 0 && (
                    <tr>
                      <td colSpan={5} className="income-settings__empty">
                        No paychecks yet.
                      </td>
                    </tr>
                  )}
                  {paychecks.map((paycheck) => (
                    <tr key={paycheck.id}>
                      <td>
                        <div className="income-settings__row">
                          <ColorSwatchPicker
                            label={`${paycheck.name} color`}
                            value={paycheck.color}
                            onChange={(color) =>
                              onUpdatePaycheck(paycheck.id, { color })
                            }
                          />
                          <input
                            className="income-settings__text"
                            aria-label="Paycheck name"
                            defaultValue={paycheck.name}
                            onBlur={(event) => {
                              const name = event.target.value.trim();
                              if (name && name !== paycheck.name) {
                                onUpdatePaycheck(paycheck.id, { name });
                              } else {
                                event.target.value = paycheck.name;
                              }
                            }}
                          />
                        </div>
                      </td>
                      <td>
                        <input
                          className="income-settings__text"
                          aria-label={`${paycheck.name} transaction description`}
                          placeholder="e.g. ACME PAYROLL"
                          defaultValue={paycheck.depositPattern}
                          onBlur={(event) => {
                            const depositPattern = event.target.value.trim();
                            if (depositPattern !== paycheck.depositPattern) {
                              onUpdatePaycheck(paycheck.id, { depositPattern });
                            }
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="income-settings__text"
                          type="number"
                          min={1}
                          step={1}
                          aria-label={`${paycheck.name} paychecks per year`}
                          defaultValue={paycheck.paychecksPerYear}
                          onBlur={(event) => {
                            const count = Math.round(Number(event.target.value));
                            if (Number.isFinite(count) && count >= 1) {
                              if (count !== paycheck.paychecksPerYear) {
                                onUpdatePaycheck(paycheck.id, { paychecksPerYear: count });
                              }
                            } else {
                              event.target.value = String(paycheck.paychecksPerYear);
                            }
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="income-settings__text"
                          type="number"
                          min={0}
                          step="any"
                          aria-label={`${paycheck.name} extra income per year`}
                          placeholder="Bonus, commission"
                          defaultValue={paycheck.extraIncome === 0 ? "" : paycheck.extraIncome}
                          onBlur={(event) => {
                            const amount = event.target.value === "" ? 0 : Number(event.target.value);
                            if (Number.isFinite(amount) && amount >= 0) {
                              if (amount !== paycheck.extraIncome) {
                                onUpdatePaycheck(paycheck.id, { extraIncome: amount });
                              }
                            } else {
                              event.target.value = paycheck.extraIncome === 0 ? "" : String(paycheck.extraIncome);
                            }
                          }}
                        />
                      </td>
                      <td className="income-settings__actions">
                        {confirmDeleteId === paycheck.id ? (
                          <>
                            <button
                              type="button"
                              className="pset__delete"
                              onClick={() => {
                                setConfirmDeleteId(null);
                                onDeletePaycheck(paycheck.id);
                              }}
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="import-shell__upload-delete"
                            aria-label={`Delete ${paycheck.name}`}
                            title="Delete paycheck (its deposits become unclassified)"
                            onClick={() => setConfirmDeleteId(paycheck.id)}
                          >
                            <TrashIcon />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <form
                className="income-settings__add"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = newPaycheck.trim();
                  if (name) {
                    onAddPaycheck(name);
                    setNewPaycheck("");
                  }
                }}
              >
                <input
                  className="income-settings__text"
                  placeholder="New paycheck name"
                  value={newPaycheck}
                  onChange={(event) => setNewPaycheck(event.target.value)}
                />
                <button type="submit" disabled={!newPaycheck.trim()}>
                  ＋ Paycheck
                </button>
              </form>
            </section>
          )}
          {tab === "items" && (
            <PaycheckBucketsBoard
              buckets={buckets}
              items={items}
              onSaveBucket={onSaveBucket}
              onDeleteBucket={onDeleteBucket}
              onSaveItem={onSaveItem}
              onDeleteItem={onDeleteItem}
              onMoveItem={onMoveItem}
              onMoveBucket={onMoveBucket}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

export default LineItemsManager;
