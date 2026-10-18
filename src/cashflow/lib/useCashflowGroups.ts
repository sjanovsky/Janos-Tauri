import { useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GroupableItem } from "../CashFlowGroups";
import { INCOME_BUCKET_ID, nextBucketColor, type BucketRecord } from "../../spending/lib/categories";
import type { PaycheckBucketRecord } from "../../income/lib/income";
import { LEFTOVER_COLOR } from "../../sankey/lib/sankey";
import {
  LEFTOVER_KEY,
  paycheckItemKey,
  placementMap,
  resolveGroupId,
  spendingItemKey,
  type CashflowGroupRecord,
  type CashflowMemberRecord,
} from "./groups";

type Options = {
  paycheckBuckets: PaycheckBucketRecord[];
  buckets: BucketRecord[];
  groups: CashflowGroupRecord[];
  setGroups: React.Dispatch<React.SetStateAction<CashflowGroupRecord[]>>;
  members: CashflowMemberRecord[];
  setMembers: React.Dispatch<React.SetStateAction<CashflowMemberRecord[]>>;
  onError: (message: string) => void;
};

// The edit handlers behind the Cash flow groups board, shared by every page that shows it. Each
// edit applies straight away and rolls back (with an error) if the write fails.
export function useCashflowGroups({
  paycheckBuckets,
  buckets,
  groups,
  setGroups,
  members,
  setMembers,
  onError,
}: Options) {
  // The buckets that can be dragged into groups, and the group each shows under now.
  const items = useMemo<GroupableItem[]>(
    () => [
      ...[...paycheckBuckets]
        .sort((a, b) => a.position - b.position)
        .map((bucket) => ({ key: paycheckItemKey(bucket.id), name: bucket.name, color: bucket.color })),
      ...buckets
        .filter((bucket) => bucket.id !== INCOME_BUCKET_ID)
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
        .map((bucket) => ({ key: spendingItemKey(bucket.id), name: bucket.name, color: bucket.color })),
      { key: LEFTOVER_KEY, name: "Leftover", color: LEFTOVER_COLOR },
    ],
    [paycheckBuckets, buckets],
  );
  const groupOfItem = useMemo(() => {
    const placements = placementMap(members);
    const groupIds = new Set(groups.map((group) => group.id));
    return new Map(items.map((item) => [item.key, resolveGroupId(item, placements, groupIds)] as const));
  }, [items, members, groups]);

  // --- Group settings ---
  // Each edit applies straight away and rolls back (with an error banner) if the write fails.
  const failSave = (rollback: () => void) => (error: unknown) => {
    console.error("Failed to save the cash flow groups", error);
    onError("Couldn't save that change to the database.");
    rollback();
  };

  const handleAddGroup = (name: string) => {
    const previous = groups;
    const id = `cf-${crypto.randomUUID()}`;
    const color = nextBucketColor(groups.length);
    setGroups((current) => [...current, { id, name, color, position: current.length }]);
    invoke("upsert_cashflow_group", { id, name, color }).catch(failSave(() => setGroups(previous)));
  };

  const handleUpdateGroup = (id: string, patch: Partial<Pick<CashflowGroupRecord, "name" | "color">>) => {
    const current = groups.find((group) => group.id === id);
    if (!current) {
      return;
    }
    const previous = groups;
    const next = { ...current, ...patch };
    setGroups((all) => all.map((group) => (group.id === id ? next : group)));
    invoke("upsert_cashflow_group", { id, name: next.name, color: next.color }).catch(
      failSave(() => setGroups(previous)),
    );
  };

  const handleDeleteGroup = (id: string) => {
    const previousGroups = groups;
    const previousMembers = members;
    // What was in the group goes to Ungrouped on purpose, so it doesn't fall back to a default.
    const orphaned = items.filter((item) => groupOfItem.get(item.key) === id).map((item) => item.key);
    setGroups((all) => all.filter((group) => group.id !== id));
    setMembers((all) => [
      ...all.filter((member) => !orphaned.includes(member.itemKey)),
      ...orphaned.map((itemKey) => ({ itemKey, groupId: "" })),
    ]);
    invoke("delete_cashflow_group", { id })
      .then(() =>
        Promise.all(orphaned.map((itemKey) => invoke("set_cashflow_member", { itemKey, groupId: "" }))),
      )
      .catch(
        failSave(() => {
          setGroups(previousGroups);
          setMembers(previousMembers);
        }),
      );
  };

  const handleReorderGroups = (orderedIds: string[]) => {
    const previous = groups;
    setGroups((all) =>
      orderedIds
        .map((id, position) => {
          const group = all.find((candidate) => candidate.id === id);
          return group ? { ...group, position } : null;
        })
        .filter((group): group is CashflowGroupRecord => group !== null),
    );
    invoke("set_cashflow_group_positions", { ids: orderedIds }).catch(failSave(() => setGroups(previous)));
  };

  const handlePlaceItem = (itemKey: string, groupId: string | null) => {
    const previous = members;
    const stored = groupId ?? "";
    setMembers((all) => [...all.filter((member) => member.itemKey !== itemKey), { itemKey, groupId: stored }]);
    invoke("set_cashflow_member", { itemKey, groupId: stored }).catch(failSave(() => setMembers(previous)));
  };

  return {
    groups,
    items,
    groupOfItem,
    onAddGroup: handleAddGroup,
    onRenameGroup: (id: string, name: string) => handleUpdateGroup(id, { name }),
    onSetGroupColor: (id: string, color: string) => handleUpdateGroup(id, { color }),
    onDeleteGroup: handleDeleteGroup,
    onReorderGroups: handleReorderGroups,
    onPlaceItem: handlePlaceItem,
  };
}
