import { useState, type CSSProperties, type DragEvent, type FormEvent } from "react";
import { ColorSwatchPicker } from "../spending/ColorSwatchPicker";
import { GripIcon, PlusIcon, TrashIcon } from "../spending/BucketsAndCategories";
import { UNGROUPED_BUCKET_COLOR } from "../spending/lib/categories";
import { NO_GROUP_ID, type CashflowGroupRecord } from "./lib/groups";

// A bucket (or the Leftover line) that can be dragged into a group.
export type GroupableItem = { key: string; name: string; color: string };

type CashFlowGroupsProps = {
  groups: CashflowGroupRecord[];
  items: GroupableItem[];
  // The group each item shows under now (NO_GROUP_ID for Ungrouped).
  groupOfItem: Map<string, string>;
  onAddGroup: (name: string) => void;
  onRenameGroup: (id: string, name: string) => void;
  onSetGroupColor: (id: string, color: string) => void;
  onDeleteGroup: (id: string) => void;
  // Reorder all groups to the given id order (dragged by their handles).
  onReorderGroups: (orderedIds: string[]) => void;
  // Move an item into a group, or null for Ungrouped.
  onPlaceItem: (itemKey: string, groupId: string | null) => void;
};

const ITEM_DRAG_TYPE = "application/x-janos-cashflow-item";
const GROUP_DRAG_TYPE = "application/x-janos-cashflow-group";

const byGroupPosition = (a: CashflowGroupRecord, b: CashflowGroupRecord) =>
  a.position - b.position || a.name.localeCompare(b.name);

const sameOrder = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

// The Cash Flow settings board, in the style of the Buckets & categories one: one row per group
// (Taxes, Savings, Spending by default), holding the buckets dragged into it.
function CashFlowGroups({
  groups,
  items,
  groupOfItem,
  onAddGroup,
  onRenameGroup,
  onSetGroupColor,
  onDeleteGroup,
  onReorderGroups,
  onPlaceItem,
}: CashFlowGroupsProps) {
  const [newGroup, setNewGroup] = useState("");
  const [draggingItem, setDraggingItem] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [groupDragPreview, setGroupDragPreview] = useState<string[] | null>(null);

  const baseOrder = () => groups.slice().sort(byGroupPosition).map((group) => group.id);

  const displayGroups = (): CashflowGroupRecord[] => {
    const base = groups.slice().sort(byGroupPosition);
    if (!draggingGroupId || !groupDragPreview) {
      return base;
    }
    const byId = new Map(base.map((group) => [group.id, group]));
    return groupDragPreview
      .map((id) => byId.get(id))
      .filter((group): group is CashflowGroupRecord => Boolean(group));
  };

  const itemsIn = (groupId: string) => items.filter((item) => (groupOfItem.get(item.key) ?? NO_GROUP_ID) === groupId);

  const isGroupDrag = (event: DragEvent<HTMLDivElement>) =>
    event.dataTransfer.types.includes(GROUP_DRAG_TYPE) || draggingGroupId !== null;
  const isItemDrag = (event: DragEvent<HTMLDivElement>) =>
    event.dataTransfer.types.includes(ITEM_DRAG_TYPE) || draggingItem !== null;

  const clearItemDrag = () => {
    setDraggingItem(null);
    setDragOverKey(null);
  };
  const clearGroupDrag = () => {
    setDraggingGroupId(null);
    setGroupDragPreview(null);
  };

  const handleItemDragStart = (event: DragEvent<HTMLDivElement>, item: GroupableItem) => {
    event.dataTransfer.setData(ITEM_DRAG_TYPE, item.key);
    event.dataTransfer.setData("text/plain", item.key);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setDragImage(event.currentTarget, 20, 16);
    setDraggingItem(item.key);
  };

  const handleGroupDragStart = (event: DragEvent<HTMLSpanElement>, group: CashflowGroupRecord) => {
    event.dataTransfer.setData(GROUP_DRAG_TYPE, group.id);
    event.dataTransfer.effectAllowed = "move";
    const row = (event.currentTarget as HTMLElement).closest(".bucket-row");
    if (row) {
      event.dataTransfer.setDragImage(row, 24, 20);
    }
    setDraggingGroupId(group.id);
  };

  // `group` is null for the Ungrouped tray, which can take items but isn't reorderable.
  const handleRowDragOver = (event: DragEvent<HTMLDivElement>, group: CashflowGroupRecord | null) => {
    if (isGroupDrag(event) && group) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (!draggingGroupId || group.id === draggingGroupId) {
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      const without = baseOrder().filter((id) => id !== draggingGroupId);
      const base = without.indexOf(group.id);
      const index = base === -1 ? without.length : after ? base + 1 : base;
      const order = [...without.slice(0, index), draggingGroupId, ...without.slice(index)];
      setGroupDragPreview((current) => (current && sameOrder(current, order) ? current : order));
      return;
    }
    if (isItemDrag(event)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDragOverKey(group?.id ?? NO_GROUP_ID);
    }
  };

  const handleRowDragLeave = (event: DragEvent<HTMLDivElement>, key: string) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setDragOverKey((current) => (current === key ? null : current));
  };

  const handleRowDrop = (event: DragEvent<HTMLDivElement>, group: CashflowGroupRecord | null) => {
    event.preventDefault();
    if (draggingGroupId) {
      onReorderGroups(groupDragPreview ?? baseOrder());
      clearGroupDrag();
      return;
    }
    const itemKey = event.dataTransfer.getData(ITEM_DRAG_TYPE) || draggingItem;
    if (itemKey) {
      onPlaceItem(itemKey, group?.id ?? null);
    }
    clearItemDrag();
  };

  const handleAddSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = newGroup.trim();
    if (!trimmed) {
      return;
    }
    onAddGroup(trimmed);
    setNewGroup("");
  };

  const renderPill = (item: GroupableItem) => (
    <div
      key={item.key}
      className={`cat-pill ${draggingItem === item.key ? "cat-pill--dragging" : ""}`}
      style={{ "--cat": item.color } as CSSProperties}
      draggable
      onDragStart={(event) => handleItemDragStart(event, item)}
      onDragEnd={clearItemDrag}
    >
      <span className="cat-pill__label">{item.name}</span>
    </div>
  );

  const ungrouped = itemsIn(NO_GROUP_ID);

  return (
    <section className="category-manager">
      <div className="category-manager__heading">
        <h2>Cash flow groups</h2>
        <p>
          Drag a bucket into a group to roll it up on the Cash Flow chart. Drag “Leftover” into one
          (usually Savings) to count what's left each month as that group's money; leave it out and it
          shows as Net income.
        </p>
      </div>

      <div className="bucket-board">
        <div className="bucket-board__header">
          <span className="bucket-board__header-label">Group</span>
          <span className="bucket-board__header-label">Buckets</span>
        </div>
        {displayGroups().map((group) => {
          const members = itemsIn(group.id);
          return (
            <div
              key={group.id}
              className={`bucket-row ${dragOverKey === group.id ? "bucket-row--drop" : ""} ${
                draggingGroupId === group.id ? "bucket-row--dragging" : ""
              }`}
              onDragOver={(event) => handleRowDragOver(event, group)}
              onDragLeave={(event) => handleRowDragLeave(event, group.id)}
              onDrop={(event) => handleRowDrop(event, group)}
            >
              <div className="bucket-row__head">
                <span
                  className="bucket-row__grip"
                  role="button"
                  tabIndex={-1}
                  draggable
                  aria-label={`Reorder group ${group.name}`}
                  title="Drag to reorder this group"
                  onDragStart={(event) => handleGroupDragStart(event, group)}
                  onDragEnd={clearGroupDrag}
                >
                  <GripIcon />
                </span>
                <ColorSwatchPicker
                  value={group.color}
                  label={`Color for group ${group.name}`}
                  onChange={(color) => onSetGroupColor(group.id, color)}
                />
                <textarea
                  key={group.name}
                  rows={1}
                  className="bucket-row__name"
                  defaultValue={group.name}
                  aria-label={`Name for group ${group.name}`}
                  onBlur={(event) => {
                    const trimmed = event.target.value.trim();
                    if (trimmed && trimmed !== group.name) {
                      onRenameGroup(group.id, trimmed);
                    } else {
                      event.target.value = group.name;
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
                  <span className="bucket-row__empty">Drag buckets here</span>
                ) : (
                  members.map(renderPill)
                )}
              </div>

              <button
                type="button"
                className="import-shell__upload-delete bucket-row__delete"
                aria-label={`Delete group ${group.name}`}
                onClick={() => onDeleteGroup(group.id)}
              >
                <TrashIcon />
              </button>
            </div>
          );
        })}

        <div
          className={`bucket-row bucket-row--ungrouped ${dragOverKey === NO_GROUP_ID ? "bucket-row--drop" : ""}`}
          style={{ "--cat": UNGROUPED_BUCKET_COLOR } as CSSProperties}
          onDragOver={(event) => handleRowDragOver(event, null)}
          onDragLeave={(event) => handleRowDragLeave(event, NO_GROUP_ID)}
          onDrop={(event) => handleRowDrop(event, null)}
        >
          <div className="bucket-row__head">
            <span className="bucket-row__name bucket-row__name--static">Ungrouped</span>
          </div>
          <div className="bucket-row__items">
            {ungrouped.length === 0 ? (
              <span className="bucket-row__empty">Drop here to take a bucket out of its group</span>
            ) : (
              ungrouped.map(renderPill)
            )}
          </div>
        </div>
      </div>

      <div className="bucket-board__forms">
        <form className="bucket-board__add" onSubmit={handleAddSubmit}>
          <div className="bucket-board__field">
            <input
              type="text"
              className="category-manager__label-input"
              placeholder="New group"
              value={newGroup}
              onChange={(event) => setNewGroup(event.target.value)}
            />
            {newGroup.trim() && (
              <button type="submit" className="bucket-board__add-btn" aria-label="Add group" title="Add group">
                <PlusIcon />
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}

export default CashFlowGroups;
