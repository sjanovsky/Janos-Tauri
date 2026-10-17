// The Cash Flow page's top level: groups (Taxes, Savings, Spending by default, and whatever else
// the user adds) that paycheck buckets, spending buckets and the Leftover line are dragged into.
// Pure helpers, no React.

export type CashflowGroupRecord = { id: string; name: string; color: string; position: number };

// Where a bucket was put. An empty groupId means "Ungrouped" on purpose.
export type CashflowMemberRecord = { itemKey: string; groupId: string };

export type CashflowData = { groups: CashflowGroupRecord[]; members: CashflowMemberRecord[] };

// Seeded by the backend; buckets with no saved placement start in these.
export const TAXES_GROUP_ID = "cf-taxes";
export const SAVINGS_GROUP_ID = "cf-savings";
export const SPENDING_GROUP_ID = "cf-spending";

// Stands in for "no group" in the chart and table; never stored.
export const NO_GROUP_ID = "cf-none";
export const NO_GROUP_NAME = "Ungrouped";

// What's left of gross after every bucket, positive or negative: a line the user can drag into any
// group (typically Savings). Left out of every group, it's the Net income row instead.
export const LEFTOVER_KEY = "leftover";

export const paycheckItemKey = (bucketId: string) => `paycheck:${bucketId}`;
export const spendingItemKey = (bucketId: string) => `spending:${bucketId}`;

// Paycheck buckets that set money aside, by name; every other paycheck bucket starts in Taxes.
const SAVINGS_NAME = /retire|401|403|\bira\b|\bhsa\b|saving|invest|pension/i;

/** The group an item starts in until the user drags it somewhere, or null for Ungrouped. */
export function defaultGroupId(itemKey: string, name: string): string | null {
  if (itemKey === LEFTOVER_KEY) {
    return null;
  }
  if (itemKey.startsWith("paycheck:")) {
    return SAVINGS_NAME.test(name) ? SAVINGS_GROUP_ID : TAXES_GROUP_ID;
  }
  return SPENDING_GROUP_ID;
}

/**
 * The group an item shows under: where the user put it, else its default, else Ungrouped (also
 * when that group has since been deleted).
 */
export function resolveGroupId(
  item: { key: string; name: string },
  placements: Map<string, string>,
  groupIds: Set<string>,
): string {
  const stored = placements.get(item.key);
  const wanted = stored !== undefined ? stored : defaultGroupId(item.key, item.name);
  return wanted && groupIds.has(wanted) ? wanted : NO_GROUP_ID;
}

export const placementMap = (members: CashflowMemberRecord[]) =>
  new Map(members.map((member) => [member.itemKey, member.groupId] as const));
