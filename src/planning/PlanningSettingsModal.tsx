import { useMemo, useState, type FormEvent } from "react";
import Modal from "../spending/Modal";
import { PlusIcon } from "../spending/BucketsAndCategories";
import CashFlowGroups, { type GroupableItem } from "../cashflow/CashFlowGroups";
import { nextBucketColor } from "../spending/lib/categories";
import type { PaycheckBucketRecord, PaycheckItemRecord } from "../income/lib/income";
import { itemSource, type PlanningSection } from "./lib/planning";

type PlanningSettingsModalProps = {
  sections: PlanningSection[];
  buckets: PaycheckBucketRecord[];
  items: PaycheckItemRecord[];
  onChange: (sections: PlanningSection[]) => void;
  // Line items taken off the board (by item id), and how to change that list.
  hiddenItems: string[];
  onHiddenItemsChange: (ids: string[]) => void;
  onClose: () => void;
};

const LOOSE_ITEM_COLOR = "#8b93a1";

// The Planning settings modal: choose the sections of the plan (Taxes, Retirement, ...) and which
// Paychecks-page line items (categories) each one adds up. Same board as the Cash Flow groups.
function PlanningSettingsModal({
  sections,
  buckets,
  items,
  onChange,
  hiddenItems,
  onHiddenItemsChange,
  onClose,
}: PlanningSettingsModalProps) {
  // Every paycheck line item, in its bucket's order and tinted with the bucket's color.
  const [addText, setAddText] = useState("");
  const bucketById = useMemo(() => new Map(buckets.map((bucket) => [bucket.id, bucket])), [buckets]);

  const pills = useMemo<GroupableItem[]>(() => {
    const bucketPosition = (item: PaycheckItemRecord) =>
      item.bucketId && bucketById.has(item.bucketId) ? bucketById.get(item.bucketId)!.position : Infinity;
    return items
      .filter((item) => !hiddenItems.includes(item.id))
      .slice()
      .sort((a, b) => bucketPosition(a) - bucketPosition(b) || a.position - b.position)
      .map((item) => ({
        key: itemSource(item.id),
        name: item.label,
        color: (item.bucketId && bucketById.get(item.bucketId)?.color) || LOOSE_ITEM_COLOR,
      }));
  }, [bucketById, items, hiddenItems]);

  // The removed items that can be added back, named with their bucket when two share a label.
  const hiddenOptions = useMemo(() => {
    const hidden = items.filter((item) => hiddenItems.includes(item.id));
    return hidden.map((item) => {
      const clash = items.some((other) => other.id !== item.id && other.label === item.label);
      const bucket = item.bucketId ? bucketById.get(item.bucketId)?.name : null;
      return { id: item.id, name: clash && bucket ? `${item.label} · ${bucket}` : item.label };
    });
  }, [items, hiddenItems, bucketById]);
  const addMatch = hiddenOptions.find((option) => option.name.toLowerCase() === addText.trim().toLowerCase());

  const removeItem = (source: string) => {
    const id = source.slice("item:".length);
    onChange(sections.map((section) => ({ ...section, sources: section.sources.filter((s) => s !== source) })));
    onHiddenItemsChange([...hiddenItems.filter((hidden) => hidden !== id), id]);
  };

  const addBack = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!addMatch) {
      return;
    }
    onHiddenItemsChange(hiddenItems.filter((id) => id !== addMatch.id));
    setAddText("");
  };

  const groupOfItem = useMemo(
    () => new Map(sections.flatMap((section) => section.sources.map((source) => [source, section.id] as const))),
    [sections],
  );

  const update = (id: string, change: Partial<PlanningSection>) =>
    onChange(sections.map((section) => (section.id === id ? { ...section, ...change } : section)));

  return (
    <Modal label="Planning sections" onClose={onClose}>
      <div className="manage-modal">
        <div className="manage-modal__body">
          <CashFlowGroups
            title="Planning Categories"
            itemsLabel="Categories"
            description="Drag a paycheck category into a section to add it to the plan. Anything left in Ungrouped stays out of the plan."
            groups={sections.map((section, position) => ({ ...section, position }))}
            items={pills}
            groupOfItem={groupOfItem}
            onAddGroup={(name) =>
              onChange([
                ...sections,
                {
                  id: `section-${Date.now().toString(36)}`,
                  name,
                  color: nextBucketColor(sections.length),
                  sources: [],
                  match: false,
                },
              ])
            }
            onRenameGroup={(id, name) => update(id, { name })}
            onSetGroupColor={(id, color) => update(id, { color })}
            onDeleteGroup={(id) => onChange(sections.filter((section) => section.id !== id))}
            onReorderGroups={(orderedIds) =>
              onChange(
                orderedIds.flatMap((id) => sections.find((section) => section.id === id) ?? []),
              )
            }
            onRemoveItem={removeItem}
            footer={
              hiddenOptions.length > 0 && (
                <form className="planning-settings__addback" onSubmit={addBack}>
                  <div className="bucket-board__field">
                    <input
                      type="text"
                      list="planning-hidden-items"
                      className="category-manager__label-input"
                      placeholder="Add a removed category back"
                      aria-label="Add a removed category back"
                      value={addText}
                      onChange={(event) => setAddText(event.target.value)}
                    />
                    <datalist id="planning-hidden-items">
                      {hiddenOptions.map((option) => (
                        <option key={option.id} value={option.name} />
                      ))}
                    </datalist>
                    {addMatch && (
                      <button type="submit" className="bucket-board__add-btn" aria-label="Add category" title="Add category">
                        <PlusIcon />
                      </button>
                    )}
                  </div>
                </form>
              )
            }
            onPlaceItem={(source, sectionId) =>
              onChange(
                sections.map((section) => {
                  const rest = section.sources.filter((candidate) => candidate !== source);
                  return { ...section, sources: section.id === sectionId ? [...rest, source] : rest };
                }),
              )
            }
          />

          {sections.length > 0 && (
            <fieldset className="planning-settings__match">
              <legend>Company match</legend>
              <p>Adds a match row to the section, like 401K matching.</p>
              {sections.map((section) => (
                <label key={section.id}>
                  <input
                    type="checkbox"
                    checked={section.match}
                    onChange={(event) => update(section.id, { match: event.target.checked })}
                  />
                  {section.name}
                </label>
              ))}
            </fieldset>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default PlanningSettingsModal;
