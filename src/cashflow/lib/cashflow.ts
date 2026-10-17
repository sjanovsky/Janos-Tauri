// The Cash Flow page's numbers: per time period, gross income (paycheck deposits at the gross of
// the paycheck version in effect), every withheld bucket and every spending bucket as money out,
// and what's left. Same sources and rules as the Overview (flow.ts), but laid out per month/day/year
// for the Spending-style bar chart. Buckets are rolled up into the user's groups (Taxes, Savings,
// Spending, ...); the Leftover line can be dragged into a group too. Pure functions, no React.

import {
  INCOME_BUCKET_ID,
  UNCLASSIFIED_BUCKET_COLOR,
  UNCLASSIFIED_CATEGORY,
  UNGROUPED_BUCKET_COLOR,
  isTransferCategory,
} from "../../spending/lib/categories";
import {
  buildChartSeries,
  parseDate,
  type ChartRange,
} from "../../spending/lib/transactionSummary";
import {
  UNGROUPED_ITEMS_BUCKET_ID,
  resolveVersion,
  type PaycheckBucketRecord,
  type PaycheckItemRecord,
  type PaycheckRecord,
} from "../../income/lib/income";
import type { ImportedTransaction } from "../../upload/lib/csvParser";
import type {
  FlowBank,
  FlowSpendingBucket,
  FlowSpendingCategory,
} from "../../sankey/lib/flow";
import { GROSS_COLOR, LEFTOVER_COLOR } from "../../sankey/lib/sankey";
import {
  LEFTOVER_KEY,
  NO_GROUP_ID,
  NO_GROUP_NAME,
  paycheckItemKey,
  placementMap,
  resolveGroupId,
  spendingItemKey,
  type CashflowGroupRecord,
  type CashflowMemberRecord,
} from "./groups";

export const GROSS_SEGMENT_ID = "cf:gross";
export const withheldSegmentId = (bucketId: string) => `cf:withheld:${bucketId}`;
export const spendingSegmentId = (key: string) => `cf:spending:${key}`;
export const LEFTOVER_SEGMENT_ID = "cf:leftover";
export const groupSegmentId = (groupId: string) => `cf:group:${groupId}`;

const UNGROUPED_SPENDING_KEY = "ungrouped";
const UNCLASSIFIED_SPENDING_KEY = "unclassified";

// A bucket's line under its group in the table.
export type CashFlowChild = {
  id: string;
  label: string;
  color: string;
  perColumn: number[];
};

// A table row: gross income, or a group with the buckets that make it up.
export type CashFlowRow = {
  id: string;
  label: string;
  color: string;
  kind: "gross" | "group";
  perColumn: number[];
  children: CashFlowChild[];
};

export type CashFlowSegment = {
  id: string;
  label: string;
  color: string;
  value: number;
};

export type CashFlowPoint = {
  key: string;
  label: string;
  segments: CashFlowSegment[];
};

export type CashFlowInput = {
  transactions: ImportedTransaction[];
  range: ChartRange;
  paychecks: PaycheckRecord[];
  paycheckBuckets: PaycheckBucketRecord[];
  paycheckItems: PaycheckItemRecord[];
  spendingBuckets: FlowSpendingBucket[];
  spendingCategories: FlowSpendingCategory[];
  banks: FlowBank[];
  groups: CashflowGroupRecord[];
  members: CashflowMemberRecord[];
};

export type CashFlowResult = {
  // One bar per period: gross up, then one segment per group down.
  series: CashFlowPoint[];
  // Gross income, then a row per group with money in it (its buckets as children), in order.
  rows: CashFlowRow[];
  // Net income per period: gross minus every group. Zero once Leftover is in a group.
  netPerColumn: number[];
  // Which original transactions feed each row id (groups and buckets), for filtering the list.
  // Leftover has none: it isn't made of transactions.
  transactionIds: Map<string, Set<string>>;
  // Every transaction that feeds some row.
  allTransactionIds: Set<string>;
};

const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position;
const round2 = (value: number) => Math.round(value * 100) / 100;

export function buildCashFlow(input: CashFlowInput): CashFlowResult {
  const paycheckById = new Map(input.paychecks.map((paycheck) => [paycheck.id, paycheck]));
  const categoryById = new Map(input.spendingCategories.map((category) => [category.id, category]));
  const spendingBucketIds = new Set(input.spendingBuckets.map((bucket) => bucket.id));
  const withheldBucketIds = new Set(input.paycheckBuckets.map((bucket) => bucket.id));
  const itemById = new Map(input.paycheckItems.map((item) => [item.id, item]));

  // Every feeding transaction becomes one or more signed synthetic transactions (gross +, buckets −)
  // the shared month/day/year bucketing can sum.
  const synthetic: ImportedTransaction[] = [];
  const transactionIds = new Map<string, Set<string>>();
  const feed = (segmentId: string, source: ImportedTransaction, amount: number, part: string) => {
    synthetic.push({ ...source, id: `${source.id}:${part}`, category: segmentId, amount });
    const ids = transactionIds.get(segmentId) ?? new Set<string>();
    ids.add(source.id);
    transactionIds.set(segmentId, ids);
  };

  for (const source of input.transactions) {
    if (!parseDate(source.date)) {
      continue;
    }
    const paycheck = paycheckById.get(source.category);
    if (paycheck) {
      const version = resolveVersion(paycheck, source);
      if (!version) {
        continue;
      }
      feed(GROSS_SEGMENT_ID, source, version.gross, "gross");
      for (const { itemId, amount } of version.values) {
        const item = itemById.get(itemId);
        if (!item || amount <= 0) {
          continue;
        }
        const bucketId =
          item.bucketId && withheldBucketIds.has(item.bucketId) ? item.bucketId : UNGROUPED_ITEMS_BUCKET_ID;
        feed(withheldSegmentId(bucketId), source, -amount, itemId);
      }
      continue;
    }
    if (isTransferCategory(source.category)) {
      continue;
    }
    const record = categoryById.get(source.category);
    // Excluded categories and other money coming in (interest, dividends) aren't spending.
    if (record?.excluded || record?.bucketId === INCOME_BUCKET_ID) {
      continue;
    }
    const key =
      record?.bucketId && spendingBucketIds.has(record.bucketId)
        ? record.bucketId
        : record && source.category !== UNCLASSIFIED_CATEGORY
          ? UNGROUPED_SPENDING_KEY
          : UNCLASSIFIED_SPENDING_KEY;
    // Stored spending is already negative, which is how the chart wants it.
    feed(spendingSegmentId(key), source, source.amount, "spending");
  }

  // Buckets in display order: withheld buckets, then spending buckets. Each is rolled into a group.
  type Leaf = { id: string; itemKey: string; label: string; color: string };
  const leaves: Leaf[] = [
    ...[...input.paycheckBuckets].sort(byPosition).map((bucket) => ({
      id: withheldSegmentId(bucket.id),
      itemKey: paycheckItemKey(bucket.id),
      label: bucket.name,
      color: bucket.color,
    })),
    {
      id: withheldSegmentId(UNGROUPED_ITEMS_BUCKET_ID),
      itemKey: paycheckItemKey(UNGROUPED_ITEMS_BUCKET_ID),
      label: "Ungrouped withholding",
      color: UNGROUPED_BUCKET_COLOR,
    },
    ...[...input.spendingBuckets]
      .filter((bucket) => bucket.id !== INCOME_BUCKET_ID)
      .sort(byPosition)
      .map((bucket) => ({
        id: spendingSegmentId(bucket.id),
        itemKey: spendingItemKey(bucket.id),
        label: bucket.name,
        color: bucket.color,
      })),
    {
      id: spendingSegmentId(UNGROUPED_SPENDING_KEY),
      itemKey: spendingItemKey(UNGROUPED_SPENDING_KEY),
      label: "Ungrouped",
      color: UNGROUPED_BUCKET_COLOR,
    },
    {
      id: spendingSegmentId(UNCLASSIFIED_SPENDING_KEY),
      itemKey: spendingItemKey(UNCLASSIFIED_SPENDING_KEY),
      label: "Unclassified",
      color: UNCLASSIFIED_BUCKET_COLOR,
    },
  ];

  const points = buildChartSeries(
    synthetic,
    input.range,
    [GROSS_SEGMENT_ID, ...leaves.map((leaf) => leaf.id)],
  );
  const columns = points.length;
  const valueOf = (point: (typeof points)[number], id: string) =>
    point.segments.find((segment) => segment.category === id)?.value ?? 0;
  const grossPerColumn = points.map((point) => valueOf(point, GROSS_SEGMENT_ID));
  const leafColumns = new Map(leaves.map((leaf) => [leaf.id, points.map((point) => valueOf(point, leaf.id))]));
  // What's left of gross after every bucket (negative when more went out than came in).
  const leftoverPerColumn = points.map((_, index) =>
    round2(grossPerColumn[index] + leaves.reduce((sum, leaf) => sum + leafColumns.get(leaf.id)![index], 0)),
  );

  // --- Roll the buckets (and Leftover) up into the user's groups ---
  const placements = placementMap(input.members);
  const groups = [...input.groups].sort(byPosition);
  const groupIds = new Set(groups.map((group) => group.id));
  const groupOf = (itemKey: string, name: string) =>
    resolveGroupId({ key: itemKey, name }, placements, groupIds);

  const children = new Map<string, CashFlowChild[]>();
  const addChild = (groupId: string, child: CashFlowChild) =>
    children.set(groupId, [...(children.get(groupId) ?? []), child]);
  for (const leaf of leaves) {
    const perColumn = leafColumns.get(leaf.id)!;
    if (!perColumn.some((value) => value !== 0)) {
      continue;
    }
    const groupId = groupOf(leaf.itemKey, leaf.label);
    addChild(groupId, { id: leaf.id, label: leaf.label, color: leaf.color, perColumn });
  }
  // Leftover in a group is money out of that group: positive leftover adds to it, a shortfall
  // (negative leftover) takes away from it. Left out of every group it stays as Net income.
  const leftoverGroup = groupOf(LEFTOVER_KEY, "Leftover");
  const leftoverPlaced = leftoverGroup !== NO_GROUP_ID;
  if (leftoverPlaced && leftoverPerColumn.some((value) => value !== 0)) {
    addChild(leftoverGroup, {
      id: LEFTOVER_SEGMENT_ID,
      label: "Leftover",
      color: LEFTOVER_COLOR,
      perColumn: leftoverPerColumn.map((value) => round2(-value)),
    });
  }

  const sumColumns = (lists: number[][]) =>
    Array.from({ length: columns }, (_, index) => round2(lists.reduce((sum, list) => sum + list[index], 0)));

  const groupMeta = [
    ...groups.map((group) => ({ id: group.id, name: group.name, color: group.color })),
    { id: NO_GROUP_ID, name: NO_GROUP_NAME, color: UNGROUPED_BUCKET_COLOR },
  ];
  const rows: CashFlowRow[] = [];
  if (grossPerColumn.some((value) => value !== 0)) {
    rows.push({
      id: GROSS_SEGMENT_ID,
      label: "Gross income",
      color: GROSS_COLOR,
      kind: "gross",
      perColumn: grossPerColumn,
      children: [],
    });
  }
  for (const meta of groupMeta) {
    const members = children.get(meta.id) ?? [];
    if (members.length === 0) {
      continue;
    }
    rows.push({
      id: groupSegmentId(meta.id),
      label: meta.name,
      color: meta.color,
      kind: "group",
      perColumn: sumColumns(members.map((child) => child.perColumn)),
      children: members,
    });
  }
  const groupRows = rows.filter((row) => row.kind === "group");

  const series: CashFlowPoint[] = points.map((point, index) => ({
    key: point.key,
    label: point.label,
    segments: rows
      .filter((row) => row.perColumn[index] !== 0)
      .map((row) => ({ id: row.id, label: row.label, color: row.color, value: row.perColumn[index] })),
  }));

  const netPerColumn = sumColumns(rows.map((row) => row.perColumn));

  // Which transactions feed each row: a bucket's own, and a group's is all its buckets'.
  const rowTransactionIds = new Map<string, Set<string>>();
  for (const leaf of leaves) {
    const ids = transactionIds.get(leaf.id);
    if (ids) {
      rowTransactionIds.set(leaf.id, ids);
    }
  }
  const grossIds = transactionIds.get(GROSS_SEGMENT_ID);
  if (grossIds) {
    rowTransactionIds.set(GROSS_SEGMENT_ID, grossIds);
  }
  for (const row of groupRows) {
    const ids = new Set<string>();
    row.children.forEach((child) => rowTransactionIds.get(child.id)?.forEach((id) => ids.add(id)));
    if (ids.size > 0) {
      rowTransactionIds.set(row.id, ids);
    }
  }

  const allTransactionIds = new Set<string>();
  transactionIds.forEach((ids) => ids.forEach((id) => allTransactionIds.add(id)));

  return { series, rows, netPerColumn, transactionIds: rowTransactionIds, allTransactionIds };
}
