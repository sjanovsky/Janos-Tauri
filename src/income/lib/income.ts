import type { ImportedTransaction } from "../../upload/lib/csvParser";
import { normalizeBankName, type BankRecord } from "../../spending/lib/banks";
import { parseDate } from "../../spending/lib/transactionSummary";

// One version of a paycheck: its gross and line-item amounts from `effectiveFrom` through
// `effectiveTo` (ISO dates; "" = from the beginning / still going). Where versions overlap, the one
// that started latest wins. A version with a `transactionId` is a one-off for that single deposit.
export type PaycheckVersionRecord = {
  id: string;
  effectiveFrom: string;
  effectiveTo: string;
  gross: number;
  transactionId: string | null;
  values: { itemId: string; amount: number }[];
};

// A paycheck. `id` is also the id of the income category its deposits are filed under; its numbers
// live in `versions`.
export type PaycheckRecord = {
  id: string;
  name: string;
  // Unclassified deposits whose description contains this text are filed under the paycheck when
  // they are uploaded.
  depositPattern: string;
  color: string;
  position: number;
  versions: PaycheckVersionRecord[];
};

// A group of line items shared by every paycheck (Withholding, Savings, Tax, ...).
export type PaycheckBucketRecord = { id: string; name: string; color: string; position: number };

// A line item (Federal Withholding, 401K, ...). A null bucket means it isn't grouped.
export type PaycheckItemRecord = { id: string; label: string; bucketId: string | null; position: number };

export type PaychecksData = {
  paychecks: PaycheckRecord[];
  buckets: PaycheckBucketRecord[];
  items: PaycheckItemRecord[];
};

// Items without a bucket are shown, and charted, under this pseudo-bucket.
export const UNGROUPED_ITEMS_BUCKET_ID = "__ungrouped";

// A deposit this far from the template's net is flagged (cents of rounding are fine).
export const NET_MATCH_TOLERANCE = 0.5;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** A deposit date ("M/D/YYYY" as bank files write it) as an ISO date, or "" if unreadable. */
export function toIsoDate(dateString: string): string {
  const date = parseDate(dateString);
  if (!date) {
    return "";
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const byEffectiveFrom = (a: PaycheckVersionRecord, b: PaycheckVersionRecord) =>
  a.effectiveFrom.localeCompare(b.effectiveFrom);

/** The paycheck's dated versions (not one-offs), oldest first. */
export function datedVersions(paycheck: PaycheckRecord): PaycheckVersionRecord[] {
  return paycheck.versions.filter((version) => version.transactionId === null).sort(byEffectiveFrom);
}

/** The newest dated version: the numbers a paycheck has "moving forward". */
export function currentVersion(paycheck: PaycheckRecord): PaycheckVersionRecord | null {
  const dated = datedVersions(paycheck);
  return dated[dated.length - 1] ?? null;
}

/**
 * The version a deposit falls under: its own one-off if it has one, else the dated version whose
 * start and end dates contain its date (the latest start wins an overlap). A date no version
 * covers falls back to the latest version that started before it, or the earliest version, so a
 * gap in the dates never leaves a deposit without numbers.
 */
export function resolveVersion(
  paycheck: PaycheckRecord,
  deposit: { id: string; date: string },
): PaycheckVersionRecord | null {
  const oneOff = paycheck.versions.find((version) => version.transactionId === deposit.id);
  if (oneOff) {
    return oneOff;
  }
  const dated = datedVersions(paycheck);
  const iso = toIsoDate(deposit.date);
  const covering = dated.filter(
    (version) => version.effectiveFrom <= iso && (version.effectiveTo === "" || iso <= version.effectiveTo),
  );
  const started = dated.filter((version) => version.effectiveFrom <= iso);
  return covering[covering.length - 1] ?? started[started.length - 1] ?? dated[0] ?? null;
}

export function paycheckItemAmount(version: PaycheckVersionRecord, itemId: string): number {
  return version.values.find((value) => value.itemId === itemId)?.amount ?? 0;
}

/** The sum of the given items on a paycheck version. */
export function paycheckSubtotal(version: PaycheckVersionRecord, itemIds: string[]): number {
  return round2(itemIds.reduce((sum, itemId) => sum + paycheckItemAmount(version, itemId), 0));
}

/** What the deposit should be: gross minus every line item. */
export function expectedNet(version: PaycheckVersionRecord, items: Pick<PaycheckItemRecord, "id">[]): number {
  return round2(version.gross - paycheckSubtotal(version, items.map((item) => item.id)));
}

export type DepositCheck = {
  // "none": no paycheck deposits yet. "ok": every deposit equals its paycheck's net. "mismatch":
  // at least one doesn't.
  status: "none" | "ok" | "mismatch";
  count: number;
  mismatched: number;
  // Total deposited, and what the paychecks said it should be.
  deposited: number;
  expected: number;
};

/**
 * Compares every deposit filed under a paycheck with the net of the paycheck version in effect on
 * its date. `deposits` are income-signed (positive = money in).
 */
export function checkDeposits(
  paychecks: PaycheckRecord[],
  items: Pick<PaycheckItemRecord, "id">[],
  deposits: Pick<ImportedTransaction, "id" | "date" | "amount" | "category">[],
): DepositCheck {
  const byId = new Map(paychecks.map((paycheck) => [paycheck.id, paycheck] as const));
  let count = 0;
  let mismatched = 0;
  let deposited = 0;
  let expected = 0;
  for (const deposit of deposits) {
    const paycheck = byId.get(deposit.category);
    const version = paycheck ? resolveVersion(paycheck, deposit) : null;
    if (!version) {
      continue;
    }
    const net = expectedNet(version, items);
    count += 1;
    deposited += deposit.amount;
    expected += net;
    if (!matchesExpectedNet(net, deposit.amount)) {
      mismatched += 1;
    }
  }
  return {
    status: count === 0 ? "none" : mismatched > 0 ? "mismatch" : "ok",
    count,
    mismatched,
    deposited: round2(deposited),
    expected: round2(expected),
  };
}

export function matchesExpectedNet(net: number, depositAmount: number): boolean {
  return Math.abs(depositAmount - net) <= NET_MATCH_TOLERANCE;
}

/**
 * The transactions filed under the given income categories, with `amount` turned into income:
 * positive when money arrived, whatever sign the bank's statements use. (Banks that list spending
 * as positive show a deposit as a negative amount, and the reverse for checking exports.)
 */
export function toIncomeTransactions(
  transactions: ImportedTransaction[],
  incomeCategoryIds: Set<string>,
  banks: Pick<BankRecord, "name" | "spendingPositive">[],
): ImportedTransaction[] {
  const spendingPositive = new Map(
    banks.map((bank) => [normalizeBankName(bank.name), bank.spendingPositive] as const),
  );

  return transactions
    .filter((transaction) => incomeCategoryIds.has(transaction.category))
    .map((transaction) => {
      const sign = (spendingPositive.get(normalizeBankName(transaction.sourceBank)) ?? true) ? -1 : 1;
      return { ...transaction, amount: transaction.amount * sign };
    });
}

export const netSegmentId = (categoryId: string) => `net:${categoryId}`;
export const itemSegmentId = (itemId: string) => `item:${itemId}`;
export const bucketSegmentId = (bucketId: string) => `bucket:${bucketId}`;

/**
 * Splits each deposit of a paycheck into synthetic transactions the chart can bucket by month
 * like any other: a net part (the actual deposit) plus one part per line item with an amount on
 * the paycheck's template, so net plus the items adds back up to gross. Deposits in categories
 * without a paycheck stay whole, as the category's own net segment.
 *
 * Also returns, per item id, which categories (paychecks) contribute to it, for filtering the
 * transaction table.
 */
export function buildGrossBreakdown(
  incomeTransactions: ImportedTransaction[],
  paychecksById: Map<string, PaycheckRecord>,
): { transactions: ImportedTransaction[]; itemCategories: Map<string, Set<string>> } {
  const itemCategories = new Map<string, Set<string>>();
  const out: ImportedTransaction[] = [];

  for (const transaction of incomeTransactions) {
    out.push({ ...transaction, category: netSegmentId(transaction.category) });
    const paycheck = paychecksById.get(transaction.category);
    const version = paycheck ? resolveVersion(paycheck, transaction) : null;
    if (!version) {
      continue;
    }
    for (const { itemId, amount } of version.values) {
      if (amount === 0) {
        continue;
      }
      out.push({
        ...transaction,
        id: `${transaction.id}:${itemId}`,
        category: itemSegmentId(itemId),
        amount,
      });
      const categories = itemCategories.get(itemId) ?? new Set<string>();
      categories.add(transaction.category);
      itemCategories.set(itemId, categories);
    }
  }
  return { transactions: out, itemCategories };
}

/**
 * Move a line item into `bucketId` (null = ungrouped), placed just before `beforeItemId`, or at
 * the end when there is none. Returns the whole list in its new display order, renumbered.
 */
export function moveItem(
  items: PaycheckItemRecord[],
  itemId: string,
  bucketId: string | null,
  beforeItemId: string | null,
): PaycheckItemRecord[] {
  const ordered = [...items].sort((a, b) => a.position - b.position);
  const moving = ordered.find((item) => item.id === itemId);
  if (!moving || itemId === beforeItemId) {
    return items;
  }
  const rest = ordered.filter((item) => item.id !== itemId);
  const index = beforeItemId ? rest.findIndex((item) => item.id === beforeItemId) : -1;
  rest.splice(index === -1 ? rest.length : index, 0, { ...moving, bucketId });
  return rest.map((item, position) => ({ ...item, position }));
}

/** Move a bucket just before `beforeBucketId` (or to the end), renumbering the list. */
export function moveBucket(
  buckets: PaycheckBucketRecord[],
  bucketId: string,
  beforeBucketId: string | null,
): PaycheckBucketRecord[] {
  const ordered = [...buckets].sort((a, b) => a.position - b.position);
  const moving = ordered.find((bucket) => bucket.id === bucketId);
  if (!moving || bucketId === beforeBucketId) {
    return buckets;
  }
  const rest = ordered.filter((bucket) => bucket.id !== bucketId);
  const index = beforeBucketId ? rest.findIndex((bucket) => bucket.id === beforeBucketId) : -1;
  rest.splice(index === -1 ? rest.length : index, 0, moving);
  return rest.map((bucket, position) => ({ ...bucket, position }));
}
