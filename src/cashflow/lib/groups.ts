// The Cash Flow page's top level: groups (Paycheck and Spending) that paycheck buckets and
// spending buckets roll up into, and that the Leftover line can be dragged into.
// Pure helpers, no React.

export type CashflowGroupRecord = { id: string; name: string; color: string; position: number };

// The two fixed groups (seeded by the backend): paycheck buckets roll up into the first, spending
// buckets into the second. The user can recolor them but not rename, delete or add to them.
export const PAYCHECK_GROUP_ID = "cf-paycheck";
export const SPENDING_GROUP_ID = "cf-spending";

// Where a bucket was put. An empty groupId means "Ungrouped" on purpose.
export type CashflowMemberRecord = { itemKey: string; groupId: string };

export type CashflowData = { groups: CashflowGroupRecord[]; members: CashflowMemberRecord[] };

// Stands in for "no group" in the chart and table; never stored.
export const NO_GROUP_ID = "cf-none";
export const NO_GROUP_NAME = "Ungrouped";

// What's left of gross after every bucket, positive or negative: a line the user can drag into any
// group (typically Savings). Left out of every group, it's the Net income row instead.
export const LEFTOVER_KEY = "leftover";

export const paycheckItemKey = (bucketId: string) => `paycheck:${bucketId}`;
export const spendingItemKey = (bucketId: string) => `spending:${bucketId}`;

// Paycheck buckets that set money aside, by name (401k, HSA, ...). Planning starts its Retirement
// section from these and its Taxes section from the rest.
export const SAVINGS_NAME = /retire|401|403|\bira\b|\bhsa\b|saving|invest|pension/i;

/** The group an item sits in until it's placed elsewhere: its kind's group, or null for Leftover. */
export function defaultGroupId(itemKey: string): string | null {
  if (itemKey === LEFTOVER_KEY) {
    return null;
  }
  return itemKey.startsWith("paycheck:") ? PAYCHECK_GROUP_ID : SPENDING_GROUP_ID;
}

/**
 * The group an item shows under: where it was put, else its default, else Ungrouped (also when that
 * group doesn't exist).
 */
export function resolveGroupId(
  item: { key: string },
  placements: Map<string, string>,
  groups: CashflowGroupRecord[],
): string {
  const stored = placements.get(item.key);
  const wanted = stored !== undefined ? stored : defaultGroupId(item.key);
  return wanted && groups.some((group) => group.id === wanted) ? wanted : NO_GROUP_ID;
}

export const placementMap = (members: CashflowMemberRecord[]) =>
  new Map(members.map((member) => [member.itemKey, member.groupId] as const));
