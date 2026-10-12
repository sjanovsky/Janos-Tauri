// Core types and pure computation for the Net Worth page. Everything here is framework-free so it
// can be unit-tested directly; the page wires these to Tauri commands and React state.

export type NetWorthBucketRecord = {
  id: string;
  name: string;
  color: string;
  // Order among all buckets (ascending); seeded rows get 0..n, dragging reorders them.
  position: number;
};

export type AccountRecord = {
  id: string;
  name: string;
  // The bucket the account displays under; null means the "Ungrouped" tray.
  bucketId: string | null;
  // Order within the account's bucket (ascending).
  position: number;
};

// One manually-entered balance: the amount in `accountId` at the end of `month` (a "YYYY-MM"
// string). Amounts may be negative to represent liabilities (credit cards, loans, …).
export type BalanceRecord = {
  accountId: string;
  month: string;
  amount: number;
};

// Ordered buckets plus the catch-all "Ungrouped" tray, each with the color its chart segment and
// grid section use.
export type NetWorthBucketMeta = { id: string; name: string; color: string };

// A stacked-bar segment for one bucket in one month (assets stack up, liabilities down).
export type NetWorthSegment = { bucketId: string; label: string; color: string; value: number };

// One month column of the chart: a label plus a segment per contributing bucket.
export type NetWorthPoint = { month: string; label: string; segments: NetWorthSegment[] };

// A single account's cell in the grid. `value` is the balance shown after carry-forward (null when
// no balance is known yet — i.e. before the account's first entry). `explicit` is true when this
// month has its own entered balance, false when the value was carried forward from an earlier one.
export type AccountCell = { month: string; value: number | null; explicit: boolean };

export type AccountRow = { accountId: string; name: string; cells: AccountCell[] };

// A bucket's grid section: its accounts (as rows) and the per-month bucket total.
export type BucketGroup = {
  meta: NetWorthBucketMeta;
  accounts: AccountRow[];
  totalPerColumn: number[];
};

// Everything the chart and grid need for one set of month columns, computed once per render.
export type NetWorthView = {
  bucketMeta: NetWorthBucketMeta[];
  series: NetWorthPoint[];
  groups: BucketGroup[];
  netPerColumn: number[];
};

export const UNGROUPED_BUCKET_ID = "__ungrouped";
export const UNGROUPED_BUCKET_COLOR = "#94a3b8";

// New buckets cycle through this palette (shared look with the spending buckets); the user can
// recolor any bucket afterward.
export const BUCKET_COLOR_PALETTE = [
  "#4f46e5",
  "#0ca678",
  "#e8590c",
  "#d6336c",
  "#1098ad",
  "#f08c00",
  "#5f3dc4",
  "#2b8a3e",
];

export function nextBucketColor(existingCount: number): string {
  return BUCKET_COLOR_PALETTE[existingCount % BUCKET_COLOR_PALETTE.length];
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const SHORT_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The current month as a "YYYY-MM" string (local time).
export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Shift a "YYYY-MM" month by `delta` months (negative goes backward).
export function addMonth(month: string, delta: number): string {
  const [year, monthIndex] = month.split("-").map((part) => Number.parseInt(part, 10));
  const total = year * 12 + (monthIndex - 1) + delta;
  const newYear = Math.floor(total / 12);
  const newMonth = (total % 12) + 1;
  return `${newYear}-${String(newMonth).padStart(2, "0")}`;
}

// Full month label for tooltips/titles, e.g. "October 2026".
export function formatMonthLabel(month: string): string {
  const [year, monthIndex] = month.split("-");
  const name = MONTH_NAMES[Number.parseInt(monthIndex, 10) - 1] ?? monthIndex;
  return `${name} ${year}`;
}

// Compact axis/column label, e.g. "Oct'26".
export function formatMonthAxis(month: string): string {
  const [year, monthIndex] = month.split("-");
  const name = SHORT_MONTH_NAMES[Number.parseInt(monthIndex, 10) - 1] ?? monthIndex;
  return `${name}'${year.slice(-2)}`;
}

// Sort a set of months ascending, dropping blanks and duplicates. The Net Worth grid shows exactly
// the months in this set — one column each, no gap-filling between them.
export function sortedUniqueMonths(months: string[]): string[] {
  return Array.from(new Set(months)).filter(Boolean).sort();
}

// Carry each account's most recent entered balance forward across `months`. For a month with no
// entry at or before it (before the account's first balance), the value is null — the account
// isn't counted yet. `explicit` marks the months that carry their own entered balance.
export function carryForwardValues(
  entries: { month: string; amount: number }[],
  months: string[],
): AccountCell[] {
  const sorted = entries.slice().sort((a, b) => a.month.localeCompare(b.month));
  const amountByMonth = new Map(sorted.map((entry) => [entry.month, entry.amount]));

  let carried: number | null = null;
  let cursor = 0;
  return months.map((month) => {
    // Advance through any entries at or before this month, keeping the latest as the carried value.
    while (cursor < sorted.length && sorted[cursor].month <= month) {
      carried = sorted[cursor].amount;
      cursor += 1;
    }
    return { month, value: carried, explicit: amountByMonth.has(month) };
  });
}

const byBucketPosition = (a: NetWorthBucketRecord, b: NetWorthBucketRecord) =>
  a.position - b.position || a.name.localeCompare(b.name);

const byAccountPosition = (a: AccountRecord, b: AccountRecord) =>
  a.position - b.position || a.name.localeCompare(b.name);

// Build the ordered bucket metadata: the real buckets in saved order, then the "Ungrouped" tray if
// any account isn't in a (still-existing) bucket.
export function buildBucketMeta(
  buckets: NetWorthBucketRecord[],
  accounts: AccountRecord[],
): NetWorthBucketMeta[] {
  const bucketIds = new Set(buckets.map((bucket) => bucket.id));
  const metas: NetWorthBucketMeta[] = buckets
    .slice()
    .sort(byBucketPosition)
    .map((bucket) => ({ id: bucket.id, name: bucket.name, color: bucket.color }));

  const hasUngrouped = accounts.some(
    (account) => !account.bucketId || !bucketIds.has(account.bucketId),
  );
  if (hasUngrouped) {
    metas.push({ id: UNGROUPED_BUCKET_ID, name: "Ungrouped", color: UNGROUPED_BUCKET_COLOR });
  }
  return metas;
}

// Compute the full chart + grid view for the given month columns. Accounts are carried forward and
// summed into their bucket; buckets with no accounts are left out of the grid (they contribute no
// segment to the chart either). Null carried values count as 0 in every total.
export function buildNetWorthView(
  buckets: NetWorthBucketRecord[],
  accounts: AccountRecord[],
  balances: BalanceRecord[],
  months: string[],
): NetWorthView {
  const bucketMeta = buildBucketMeta(buckets, accounts);
  const realBucketIds = new Set(buckets.map((bucket) => bucket.id));

  // Group each account's entries by account for carry-forward.
  const entriesByAccount = new Map<string, { month: string; amount: number }[]>();
  balances.forEach((balance) => {
    const list = entriesByAccount.get(balance.accountId) ?? [];
    list.push({ month: balance.month, amount: balance.amount });
    entriesByAccount.set(balance.accountId, list);
  });

  const displayBucketId = (account: AccountRecord) =>
    account.bucketId && realBucketIds.has(account.bucketId) ? account.bucketId : UNGROUPED_BUCKET_ID;

  // Accounts grouped under their display bucket, each sorted by position.
  const accountsByBucket = new Map<string, AccountRecord[]>();
  accounts.forEach((account) => {
    const id = displayBucketId(account);
    const list = accountsByBucket.get(id) ?? [];
    list.push(account);
    accountsByBucket.set(id, list);
  });

  const zeros = () => new Array<number>(months.length).fill(0);

  const groups: BucketGroup[] = [];
  bucketMeta.forEach((meta) => {
    const members = (accountsByBucket.get(meta.id) ?? []).slice().sort(byAccountPosition);
    if (members.length === 0) {
      return;
    }
    const totalPerColumn = zeros();
    const accountRows: AccountRow[] = members.map((account) => {
      const cells = carryForwardValues(entriesByAccount.get(account.id) ?? [], months);
      cells.forEach((cell, index) => {
        totalPerColumn[index] += cell.value ?? 0;
      });
      return { accountId: account.id, name: account.name, cells };
    });
    groups.push({ meta, accounts: accountRows, totalPerColumn });
  });

  const netPerColumn = zeros();
  groups.forEach((group) => {
    group.totalPerColumn.forEach((value, index) => {
      netPerColumn[index] += value;
    });
  });

  const series: NetWorthPoint[] = months.map((month, index) => ({
    month,
    label: formatMonthLabel(month),
    segments: groups
      .map((group) => ({
        bucketId: group.meta.id,
        label: group.meta.name,
        color: group.meta.color,
        value: Number(group.totalPerColumn[index].toFixed(2)),
      }))
      .filter((segment) => segment.value !== 0),
  }));

  return { bucketMeta, series, groups, netPerColumn };
}
