import { useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GroupableItem } from "../CashFlowGroups";
import { INCOME_BUCKET_ID, type BucketRecord } from "../../spending/lib/categories";
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
    return new Map(items.map((item) => [item.key, resolveGroupId(item, placements, groups)] as const));
  }, [items, members, groups]);

  // Each edit applies straight away and rolls back (with an error banner) if the write fails.
  const failSave = (rollback: () => void) => (error: unknown) => {
    console.error("Failed to save the cash flow groups", error);
    onError("Couldn't save that change to the database.");
    rollback();
  };

  const handleSetGroupColor = (id: string, color: string) => {
    const previous = groups;
    setGroups((all) => all.map((group) => (group.id === id ? { ...group, color } : group)));
    invoke("set_cashflow_group_color", { id, color }).catch(failSave(() => setGroups(previous)));
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
    onSetGroupColor: handleSetGroupColor,
    onPlaceItem: handlePlaceItem,
  };
}
