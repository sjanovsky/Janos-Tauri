import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type FormEvent } from "react";
import { ColorSwatchPicker } from "../spending/ColorSwatchPicker";
import {
  UNGROUPED_BUCKET_COLOR,
  UNGROUPED_BUCKET_ID,
  type AccountRecord,
  type NetWorthBucketRecord,
} from "./lib/networth";

type AccountsAndBucketsProps = {
  accounts: AccountRecord[];
  buckets: NetWorthBucketRecord[];
  onAddAccount: (name: string) => void;
  onRenameAccount: (id: string, name: string) => void;
  onDeleteAccount: (id: string) => void;
  onAddBucket: (name: string) => void;
  onRenameBucket: (id: string, name: string) => void;
  onSetBucketColor: (id: string, color: string) => void;
  onDeleteBucket: (id: string) => void;
  // Reorder all buckets to the given id order (dragged by their handles).
  onReorderBuckets: (orderedIds: string[]) => void;
  // Move an account into a bucket (bucketId) or the Ungrouped tray (null). When placing into a
  // bucket, `orderedBucketIds` is that bucket's full member order after the move, which sets each
  // account's position (the order shown in the balances grid).
  onPlaceAccount: (accountId: string, bucketId: string | null, orderedBucketIds?: string[]) => void;
};

const ACCOUNT_DRAG_TYPE = "application/x-janos-account";
const BUCKET_DRAG_TYPE = "application/x-janos-networth-bucket";

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

function GripIcon() {
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

const byName = (a: AccountRecord, b: AccountRecord) => a.name.localeCompare(b.name);

// Buckets render in the order the user set by dragging (position), with name as a stable
// tie-breaker for migrated rows that all share position 0.
const byBucketPosition = (a: NetWorthBucketRecord, b: NetWorthBucketRecord) =>
  a.position - b.position || a.name.localeCompare(b.name);

// Bucket members render in the order the user set by dragging (position), with name as a stable
// tie-breaker for rows that share position 0.
const byPosition = (a: AccountRecord, b: AccountRecord) =>
  a.position - b.position || a.name.localeCompare(b.name);

// Drag-and-drop manager for net-worth buckets and the accounts inside them. Mirrors the spending
// Buckets & categories board: drag an account pill into a bucket to group it, or into "Ungrouped"
// to pull it back out; drag a bucket by its grip to reorder the whole list.
function AccountsAndBuckets({
  accounts,
  buckets,
  onAddAccount,
  onRenameAccount,
  onDeleteAccount,
  onAddBucket,
  onRenameBucket,
  onSetBucketColor,
  onDeleteBucket,
  onReorderBuckets,
  onPlaceAccount,
}: AccountsAndBucketsProps) {
  const [newAccount, setNewAccount] = useState("");
  const [newBucket, setNewBucket] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  // Live preview of a bucket's member order while a pill is dragged over it.
  const [dragPreview, setDragPreview] = useState<{ bucketId: string; orderedIds: string[] } | null>(null);
  // The same, one level up: which bucket is dragged by its handle, and the live preview order.
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

  // Place each account in exactly one row: its (known) bucket, or the "Ungrouped" tray where newly
  // added accounts start.
  const bucketIds = new Set(buckets.map((bucket) => bucket.id));
  const accountsByBucket = new Map<string, AccountRecord[]>();
  buckets.forEach((bucket) => accountsByBucket.set(bucket.id, []));
  const ungrouped: AccountRecord[] = [];
  accounts.forEach((account) => {
    if (account.bucketId && bucketIds.has(account.bucketId)) {
      accountsByBucket.get(account.bucketId)!.push(account);
    } else {
      ungrouped.push(account);
    }
  });
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  // A bucket's member ids in saved (position) order.
  const sortedBucketIds = (bucketId: string) =>
    (accountsByBucket.get(bucketId) ?? [])
      .slice()
      .sort(byPosition)
      .map((account) => account.id);

  // Insert `draggedId` into `bucketId`'s order at `beforeId` (null = end). `after` nudges past the
  // reference pill, so dropping on a pill's right half lands after it.
  const orderWithInsertion = (bucketId: string, draggedId: string, beforeId: string | null, after = false) => {
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
  const displayMembers = (bucketId: string): AccountRecord[] => {
    const base = (accountsByBucket.get(bucketId) ?? []).slice().sort(byPosition);
    if (!draggingId) {
      return base;
    }
    if (dragPreview && dragPreview.bucketId === bucketId) {
      return dragPreview.orderedIds
        .map((id) => accountById.get(id))
        .filter((account): account is AccountRecord => Boolean(account));
    }
    if (dragPreview && base.some((account) => account.id === draggingId)) {
      return base.filter((account) => account.id !== draggingId);
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

  const displayBuckets = (): NetWorthBucketRecord[] => {
    const base = buckets.slice().sort(byBucketPosition);
    if (!draggingBucketId || !bucketDragPreview) {
      return base;
    }
    const byId = new Map(base.map((bucket) => [bucket.id, bucket]));
    return bucketDragPreview
      .map((id) => byId.get(id))
      .filter((bucket): bucket is NetWorthBucketRecord => Boolean(bucket));
  };

  const isBucketDrag = (event: DragEvent<HTMLDivElement>) =>
    event.dataTransfer.types.includes(BUCKET_DRAG_TYPE) || draggingBucketId !== null;

  const clearBucketDrag = () => {
    setDraggingBucketId(null);
    setBucketDragPreview(null);
  };

  const handleBucketDragStart = (event: DragEvent<HTMLSpanElement>, bucket: NetWorthBucketRecord) => {
    event.dataTransfer.setData(BUCKET_DRAG_TYPE, bucket.id);
    event.dataTransfer.effectAllowed = "move";
    const row = (event.currentTarget as HTMLElement).closest(".bucket-row");
    if (row) {
      event.dataTransfer.setDragImage(row, 24, 20);
    }
    setDraggingBucketId(bucket.id);
  };

  const handleAddAccountSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = newAccount.trim();
    if (!trimmed) {
      return;
    }
    onAddAccount(trimmed);
    setNewAccount("");
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

  const handlePillDragStart = (event: DragEvent<HTMLDivElement>, account: AccountRecord) => {
    event.dataTransfer.setData(ACCOUNT_DRAG_TYPE, account.id);
    event.dataTransfer.setData("text/plain", account.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setDragImage(event.currentTarget, 20, 16);
    setDraggingId(account.id);
  };

  const handleRowDragOver = (event: DragEvent<HTMLDivElement>, key: string) => {
    const isAccountDrag = event.dataTransfer.types.includes(ACCOUNT_DRAG_TYPE) || draggingId !== null;
    if (!isAccountDrag) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverKey(key);
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

  const handleRowDrop = (event: DragEvent<HTMLDivElement>, target: { bucketId: string | null }) => {
    event.preventDefault();
    const accountId = event.dataTransfer.getData(ACCOUNT_DRAG_TYPE) || draggingId;
    if (accountId) {
      if (target.bucketId && bucketIds.has(target.bucketId)) {
        const order =
          dragPreview && dragPreview.bucketId === target.bucketId
            ? dragPreview.orderedIds
            : orderWithInsertion(target.bucketId, accountId, null);
        onPlaceAccount(accountId, target.bucketId, order);
      } else {
        // The Ungrouped tray isn't ordered, so it takes the plain placement.
        onPlaceAccount(accountId, target.bucketId);
      }
    }
    clearDragState();
  };

  const handlePillDragOver = (event: DragEvent<HTMLDivElement>, bucketId: string, account: AccountRecord) => {
    const isAccountDrag = event.dataTransfer.types.includes(ACCOUNT_DRAG_TYPE) || draggingId !== null;
    if (!isAccountDrag) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDragOverKey(bucketId);
    if (!draggingId || account.id === draggingId) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientX > rect.left + rect.width / 2;
    const orderedIds = orderWithInsertion(bucketId, draggingId, account.id, after);
    setDragPreview((current) =>
      current && current.bucketId === bucketId && sameOrder(current.orderedIds, orderedIds)
        ? current
        : { bucketId, orderedIds },
    );
  };

  const handleBucketRowDragOver = (event: DragEvent<HTMLDivElement>, bucket: NetWorthBucketRecord) => {
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

  const handleBucketRowDragLeave = (event: DragEvent<HTMLDivElement>, bucket: NetWorthBucketRecord) => {
    if (!isBucketDrag(event)) {
      handleRowDragLeave(event, bucket.id);
    }
  };

  const handleBucketRowDrop = (event: DragEvent<HTMLDivElement>, bucket: NetWorthBucketRecord) => {
    if (!isBucketDrag(event)) {
      handleRowDrop(event, { bucketId: bucket.id });
      return;
    }
    event.preventDefault();
    if (draggingBucketId) {
      onReorderBuckets(bucketDragPreview ?? baseBucketOrder());
    }
    clearBucketDrag();
  };

  // `bucketId` is the real bucket a pill belongs to; pills in a bucket are reorder drop targets,
  // while tray pills (Ungrouped) pass null and only the row handles drops.
  const renderPill = (account: AccountRecord, sectionColor: string, bucketId: string | null = null) => {
    const isEditing = editingId === account.id;
    const isReorderable = bucketId !== null;
    return (
      <div
        key={account.id}
        className={`cat-pill ${draggingId === account.id ? "cat-pill--dragging" : ""}`}
        style={{ "--cat": sectionColor } as CSSProperties}
        draggable={!isEditing}
        onDragStart={(event) => handlePillDragStart(event, account)}
        onDragEnd={clearDragState}
        onDragOver={isReorderable ? (event) => handlePillDragOver(event, bucketId, account) : undefined}
        onDrop={
          isReorderable
            ? (event) => {
                if (!draggingId) {
                  return;
                }
                event.stopPropagation();
                handleRowDrop(event, { bucketId });
              }
            : undefined
        }
      >
        {isEditing ? (
          <input
            ref={editInputRef}
            type="text"
            className="cat-pill__edit"
            defaultValue={account.name}
            aria-label={`Name for ${account.name}`}
            onBlur={(event) => {
              const trimmed = event.target.value.trim();
              if (trimmed && trimmed !== account.name) {
                onRenameAccount(account.id, trimmed);
              }
              setEditingId(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                event.currentTarget.value = account.name;
                event.currentTarget.blur();
              }
            }}
          />
        ) : (
          <span
            className="cat-pill__label"
            title="Double-click to rename"
            onDoubleClick={() => setEditingId(account.id)}
          >
            {account.name}
          </span>
        )}

        <button
          type="button"
          className="cat-pill__remove"
          aria-label={`Delete ${account.name}`}
          title="Delete account"
          onClick={() => onDeleteAccount(account.id)}
        >
          <CloseIcon />
        </button>
      </div>
    );
  };

  return (
    <section className="category-manager">
      <div className="category-manager__heading">
        <h2>Accounts &amp; buckets</h2>
        <p>
          Drag an account into a bucket to group it, or into “Ungrouped” to pull it back out.
          Drag a bucket by its handle to reorder, and recolor it with its swatch.
        </p>
      </div>

      <div className="bucket-board">
        <div className="bucket-board__header">
          <span className="bucket-board__header-label">Bucket</span>
          <span className="bucket-board__header-label">Accounts</span>
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
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                />
              </div>

              <div className="bucket-row__items">
                {members.length === 0 ? (
                  <span className="bucket-row__empty">Drag accounts here</span>
                ) : (
                  members.map((account) => renderPill(account, bucket.color, bucket.id))
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
          className={`bucket-row bucket-row--ungrouped ${
            dragOverKey === UNGROUPED_BUCKET_ID ? "bucket-row--drop" : ""
          }`}
          onDragOver={(event) => handleRowDragOver(event, UNGROUPED_BUCKET_ID)}
          onDragLeave={(event) => handleRowDragLeave(event, UNGROUPED_BUCKET_ID)}
          onDrop={(event) => handleRowDrop(event, { bucketId: null })}
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
                .sort(byName)
                .map((account) => renderPill(account, UNGROUPED_BUCKET_COLOR))
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
              <button type="submit" className="bucket-board__add-btn" aria-label="Add bucket" title="Add bucket">
                <PlusIcon />
              </button>
            )}
          </div>
        </form>

        <form className="bucket-board__add" onSubmit={handleAddAccountSubmit}>
          <div className="bucket-board__field">
            <input
              type="text"
              className="category-manager__label-input"
              placeholder="New account"
              value={newAccount}
              onChange={(event) => setNewAccount(event.target.value)}
            />
            {newAccount.trim() && (
              <button type="submit" className="bucket-board__add-btn" aria-label="Add account" title="Add account">
                <PlusIcon />
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}

export default AccountsAndBuckets;
