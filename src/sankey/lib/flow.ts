// Where the diagram's numbers come from, for any period (month, year, custom range, all time):
//   - every bank deposit filed under a paycheck (an Income page template) is one paycheck, so a
//     paycheck's gross and each withheld line are the template's amounts times its deposit count;
//   - net pay is gross minus the withheld lines, and spending is the bank transactions grouped by
//     spending bucket;
//   - whatever net doesn't cover is "Shortfall", whatever it doesn't spend is "Left over".
// Pure functions, no React: everything the page shows is derived here so it can be unit-tested.

import { normalizeBankName } from "../../spending/lib/banks";
import {
  INCOME_BUCKET_ID,
  UNCLASSIFIED_BUCKET_COLOR,
  UNCLASSIFIED_CATEGORY,
  UNGROUPED_BUCKET_COLOR,
  isTransferCategory,
} from "../../spending/lib/categories";
import { parseDate } from "../../spending/lib/transactionSummary";
import {
  resolveVersion,
  UNGROUPED_ITEMS_BUCKET_ID,
  type PaycheckBucketRecord,
  type PaycheckItemRecord,
  type PaycheckRecord,
  type PaycheckVersionRecord,
} from "../../income/lib/income";
import { inPeriod, type PeriodBounds } from "./period";
import {
  GROSS_COLOR,
  GROSS_ID,
  LEFTOVER_COLOR,
  LEFTOVER_ID,
  NET_COLOR,
  NET_ID,
  SHORTFALL_COLOR,
  SHORTFALL_ID,
  bucketNodeId,
  categoryNodeId,
  itemNodeId,
  paycheckNodeId,
  spendingNodeId,
  type GraphLink,
  type GraphNode,
  type SankeyGraph,
} from "./sankey";

// The slice of a stored transaction the flow needs (structurally an ImportedTransaction).
export type FlowSourceTransaction = {
  id: string;
  date: string;
  description: string;
  amount: number;
  sourceBank: string;
  category: string;
};

export type FlowBank = { name: string; spendingPositive: boolean };

export type FlowSpendingBucket = {
  id: string;
  name: string;
  color: string;
  position: number;
};

export type FlowSpendingCategory = {
  id: string;
  label: string;
  color: string;
  bucketId: string | null;
  excluded: boolean;
  position: number;
};

// A transaction as the diagram sees it: `flow` is positive for money leaving, negative for money
// arriving, whatever sign its bank uses.
export type FlowTransaction = {
  id: string;
  date: string;
  description: string;
  bank: string;
  flow: number;
  timestamp: number;
};

// One row of a drill-down table: how a number was built.
export type FlowLine = { name: string; detail: string; total: number };

// What stands behind a node.
export type NodeSource = {
  title: string;
  note: string;
  total: number;
  lines: FlowLine[];
  transactions: FlowTransaction[];
};

export type FlowInput = {
  bounds: PeriodBounds;
  paychecks: PaycheckRecord[];
  paycheckBuckets: PaycheckBucketRecord[];
  paycheckItems: PaycheckItemRecord[];
  spendingBuckets: FlowSpendingBucket[];
  spendingCategories: FlowSpendingCategory[];
  banks: FlowBank[];
  transactions: FlowSourceTransaction[];
  // Ids of the nodes opened into what they're made of ("bucket:<id>", "spending:<id>", and "net"
  // for Net pay's spending buckets). Leave it out to open only Net pay.
  expanded?: Set<string>;
};

export type FlowResult = {
  graph: SankeyGraph;
  sources: Map<string, NodeSource>;
  gross: number;
  withheld: number;
  net: number;
  spending: number;
  leftover: number;
  shortfall: number;
};

export const UNCLASSIFIED_KEY = "unclassified";
export const UNGROUPED_KEY = "ungrouped";

const byPosition = <T extends { position: number }>(a: T, b: T) =>
  a.position - b.position;
const round2 = (value: number) => Math.round(value * 100) / 100;

export function buildFlow(input: FlowInput): FlowResult {
  const { bounds, paychecks, spendingBuckets, spendingCategories, banks } =
    input;
  const expanded = input.expanded ?? new Set<string>();
  // Net pay is open (showing the spending buckets) unless the caller passes a set without it.
  const netOpen = input.expanded ? input.expanded.has(NET_ID) : true;
  const paycheckById = new Map(
    paychecks.map((paycheck) => [paycheck.id, paycheck]),
  );
  const spendingBucketById = new Map(
    spendingBuckets.map((bucket) => [bucket.id, bucket]),
  );
  const categoryById = new Map(
    spendingCategories.map((category) => [category.id, category]),
  );
  const spendingPositive = new Map(
    banks.map(
      (bank) => [normalizeBankName(bank.name), bank.spendingPositive] as const,
    ),
  );

  // --- Sort the period's transactions into paycheck deposits and spending ---
  const deposits = new Map<string, FlowTransaction[]>();
  const spendingAmounts = new Map<string, number>();
  const spendingTransactions = new Map<string, FlowTransaction[]>();
  // The same, per spending category, and which bucket node each category landed in.
  const categoryAmounts = new Map<string, number>();
  const categoryTransactions = new Map<string, FlowTransaction[]>();
  const categoryKey = new Map<string, string>();

  for (const source of input.transactions) {
    const date = parseDate(source.date);
    if (!date || !inPeriod(date.getTime(), bounds)) {
      continue;
    }
    const sign =
      (spendingPositive.get(normalizeBankName(source.sourceBank)) ?? true)
        ? 1
        : -1;
    const transaction: FlowTransaction = {
      id: source.id,
      date: source.date,
      description: source.description,
      bank: source.sourceBank,
      flow: source.amount * sign,
      timestamp: date.getTime(),
    };

    if (paycheckById.has(source.category)) {
      const list = deposits.get(source.category) ?? [];
      list.push(transaction);
      deposits.set(source.category, list);
      continue;
    }
    if (isTransferCategory(source.category)) {
      continue;
    }
    const record = categoryById.get(source.category);
    // Excluded categories and other money coming in (interest, dividends) are not spending.
    if (record?.excluded || record?.bucketId === INCOME_BUCKET_ID) {
      continue;
    }
    const key =
      record?.bucketId && spendingBucketById.has(record.bucketId)
        ? record.bucketId
        : record && source.category !== UNCLASSIFIED_CATEGORY
          ? UNGROUPED_KEY
          : UNCLASSIFIED_KEY;
    spendingAmounts.set(
      key,
      (spendingAmounts.get(key) ?? 0) + transaction.flow,
    );
    const list = spendingTransactions.get(key) ?? [];
    list.push(transaction);
    spendingTransactions.set(key, list);

    categoryKey.set(source.category, key);
    categoryAmounts.set(
      source.category,
      (categoryAmounts.get(source.category) ?? 0) + transaction.flow,
    );
    const inCategory = categoryTransactions.get(source.category) ?? [];
    inCategory.push(transaction);
    categoryTransactions.set(source.category, inCategory);
  }

  const newestFirst = (list: FlowTransaction[]) =>
    [...list].sort((a, b) => b.timestamp - a.timestamp);
  const sources = new Map<string, NodeSource>();
  const nodes: (GraphNode & { order: number })[] = [];
  const links: GraphLink[] = [];
  let order = 0;
  const addNode = (node: Omit<GraphNode, "column">, column: number) => {
    nodes.push({ ...node, column, order: order++ });
  };

  // --- Paychecks: gross, withheld lines and net ---
  const paycheckTemplates = [...paychecks].sort(byPosition);
  const items = [...input.paycheckItems].sort(byPosition);
  const buckets = [...input.paycheckBuckets].sort(byPosition);
  const itemById = new Map(items.map((item) => [item.id, item]));

  let gross = 0;
  const grossLines: FlowLine[] = [];
  const itemTotals = new Map<string, number>();
  const itemLines = new Map<string, FlowLine[]>();
  const allDeposits: FlowTransaction[] = [];

  const paycheckNodes: { paycheck: PaycheckRecord; value: number }[] = [];
  for (const paycheck of paycheckTemplates) {
    const list = deposits.get(paycheck.id) ?? [];
    if (list.length === 0) {
      continue;
    }
    // Each deposit takes the numbers of the version in effect on its date (or its own one-off), so
    // a raise partway through the period changes the figures from that date on.
    const perVersion = new Map<
      string,
      { version: PaycheckVersionRecord; count: number }
    >();
    let paycheckGross = 0;
    for (const deposit of list) {
      const version = resolveVersion(paycheck, deposit);
      if (!version) {
        continue;
      }
      const entry = perVersion.get(version.id) ?? { version, count: 0 };
      entry.count += 1;
      perVersion.set(version.id, entry);

      paycheckGross += version.gross;
      for (const { itemId, amount } of version.values) {
        if (!itemById.has(itemId) || amount <= 0) {
          continue;
        }
        itemTotals.set(itemId, (itemTotals.get(itemId) ?? 0) + amount);
      }
    }
    allDeposits.push(...list);
    paycheckGross = round2(paycheckGross);
    gross += paycheckGross;

    // Drill-down lines: one per version used, so a mid-period raise shows both sets of numbers.
    const versions = [...perVersion.values()];
    for (const { version, count } of versions) {
      const label =
        versions.length > 1 || version.transactionId
          ? `${paycheck.name} (${version.transactionId ? "one-off" : version.effectiveFrom ? `from ${version.effectiveFrom}` : "original"})`
          : paycheck.name;
      grossLines.push({
        name: label,
        detail: `${count} × ${version.gross.toFixed(2)}`,
        total: round2(count * version.gross),
      });
      for (const { itemId, amount } of version.values) {
        if (!itemById.has(itemId) || amount <= 0) {
          continue;
        }
        const lines = itemLines.get(itemId) ?? [];
        lines.push({
          name: label,
          detail: `${count} × ${amount.toFixed(2)}`,
          total: round2(count * amount),
        });
        itemLines.set(itemId, lines);
      }
    }
    paycheckNodes.push({ paycheck, value: paycheckGross });
    sources.set(paycheckNodeId(paycheck.id), {
      title: paycheck.name,
      note: `${list.length} deposit${list.length === 1 ? "" : "s"} filed under this paycheck, each with the gross of the paycheck version in effect on its date.`,
      total: paycheckGross,
      lines: [],
      transactions: newestFirst(list),
    });
  }
  gross = round2(gross);

  // Items grouped by their paycheck bucket (null bucket → Ungrouped).
  type BucketGroup = {
    id: string;
    name: string;
    color: string;
    items: { item: PaycheckItemRecord; total: number }[];
  };
  const groups: BucketGroup[] = buckets.map((bucket) => ({
    id: bucket.id,
    name: bucket.name,
    color: bucket.color,
    items: [],
  }));
  const ungrouped: BucketGroup = {
    id: UNGROUPED_ITEMS_BUCKET_ID,
    name: "Ungrouped",
    color: UNGROUPED_BUCKET_COLOR,
    items: [],
  };
  for (const item of items) {
    const total = round2(itemTotals.get(item.id) ?? 0);
    if (total <= 0) {
      continue;
    }
    const group =
      groups.find((candidate) => candidate.id === item.bucketId) ?? ungrouped;
    group.items.push({ item, total });
  }
  const usedGroups = [...groups, ungrouped].filter(
    (group) => group.items.length > 0,
  );
  const withheld = round2(
    usedGroups.reduce(
      (sum, group) => sum + group.items.reduce((s, i) => s + i.total, 0),
      0,
    ),
  );
  const net = Math.max(0, round2(gross - withheld));

  // --- Spending ---
  type SpendingEntry = {
    key: string;
    name: string;
    color: string;
    position: number;
    amount: number;
  };
  const spendingEntries: SpendingEntry[] = [];
  for (const bucket of [...spendingBuckets].sort(byPosition)) {
    spendingEntries.push({
      key: bucket.id,
      name: bucket.name,
      color: bucket.color,
      position: bucket.position,
      amount: round2(spendingAmounts.get(bucket.id) ?? 0),
    });
  }
  spendingEntries.push(
    {
      key: UNGROUPED_KEY,
      name: "Ungrouped",
      color: UNGROUPED_BUCKET_COLOR,
      position: 10_000,
      amount: round2(spendingAmounts.get(UNGROUPED_KEY) ?? 0),
    },
    {
      key: UNCLASSIFIED_KEY,
      name: "Unclassified",
      color: UNCLASSIFIED_BUCKET_COLOR,
      position: 10_001,
      amount: round2(spendingAmounts.get(UNCLASSIFIED_KEY) ?? 0),
    },
  );
  // Buckets that net out to nothing or less (refunds) don't draw.
  const drawnSpending = spendingEntries.filter((entry) => entry.amount > 0);
  const spending = round2(
    drawnSpending.reduce((sum, entry) => sum + entry.amount, 0),
  );

  // Each spending bucket's categories with money in them, in the order the Spending page lists them.
  const childrenByBucket = new Map<
    string,
    { id: string; label: string; amount: number }[]
  >();
  for (const category of [...spendingCategories].sort(byPosition)) {
    const key = categoryKey.get(category.id);
    if (!key) {
      continue;
    }
    const list = childrenByBucket.get(key) ?? [];
    list.push({
      id: category.id,
      label: category.label,
      amount: round2(categoryAmounts.get(category.id) ?? 0),
    });
    childrenByBucket.set(key, list);
  }

  const leftover = Math.max(0, round2(net - spending));
  const shortfall = Math.max(0, round2(spending - net));
  const total = round2(gross + shortfall);

  if (total <= 0) {
    return {
      graph: { nodes: [], links: [], total: 0 },
      sources,
      gross,
      withheld,
      net,
      spending,
      leftover,
      shortfall,
    };
  }

  // --- Graph: paychecks → Gross → (withheld buckets, Net) → (spending, Left over) ---
  for (const { paycheck, value } of paycheckNodes) {
    addNode(
      {
        id: paycheckNodeId(paycheck.id),
        label: paycheck.name,
        color: paycheck.color,
        kind: "paycheck",
        value,
      },
      0,
    );
    links.push({
      source: paycheckNodeId(paycheck.id),
      target: GROSS_ID,
      value,
      color: paycheck.color,
    });
  }
  if (gross > 0) {
    addNode(
      {
        id: GROSS_ID,
        label: "Gross income",
        color: GROSS_COLOR,
        kind: "gross",
        value: gross,
      },
      1,
    );
    sources.set(GROSS_ID, {
      title: "Gross income",
      note: "Each deposit in this period at the gross of the paycheck version in effect on its date.",
      total: gross,
      lines: grossLines,
      transactions: newestFirst(allDeposits),
    });
  }
  if (shortfall > 0) {
    addNode(
      {
        id: SHORTFALL_ID,
        label: "Shortfall",
        color: SHORTFALL_COLOR,
        kind: "shortfall",
        value: shortfall,
      },
      1,
    );
  }

  for (const group of usedGroups) {
    const groupTotal = round2(
      group.items.reduce((sum, entry) => sum + entry.total, 0),
    );
    const id = bucketNodeId(group.id);
    addNode(
      {
        id,
        label: group.name,
        color: group.color,
        kind: "bucket",
        value: groupTotal,
        expandable: group.items.length > 0,
        expanded: expanded.has(id),
      },
      2,
    );
    links.push({
      source: GROSS_ID,
      target: id,
      value: groupTotal,
      color: group.color,
    });
    sources.set(id, {
      title: group.name,
      note: "Withheld from paychecks: each deposit at the line's amount on the paycheck version in effect on its date.",
      total: groupTotal,
      lines: group.items.flatMap((entry) => itemLines.get(entry.item.id) ?? []),
      transactions: [],
    });
  }

  const netNodeValue = round2(net + shortfall);
  if (netNodeValue > 0) {
    addNode(
      {
        id: NET_ID,
        label: "Net pay",
        color: NET_COLOR,
        kind: "net",
        value: netNodeValue,
        expandable: spending > 0 || leftover > 0,
        expanded: netOpen,
      },
      2,
    );
    if (net > 0) {
      links.push({
        source: GROSS_ID,
        target: NET_ID,
        value: net,
        color: NET_COLOR,
      });
    }
    if (shortfall > 0) {
      links.push({
        source: SHORTFALL_ID,
        target: NET_ID,
        value: shortfall,
        color: SHORTFALL_COLOR,
      });
    }
    sources.set(NET_ID, {
      title: "Net pay",
      note: "Gross minus everything withheld.",
      total: net,
      lines: [
        { name: "Gross income", detail: "", total: gross },
        { name: "Withheld", detail: "", total: -withheld },
      ],
      transactions: newestFirst(allDeposits),
    });
  }

  // Opened buckets show the line items they're made of.
  for (const group of usedGroups) {
    if (!expanded.has(bucketNodeId(group.id))) {
      continue;
    }
    for (const { item, total: itemTotal } of group.items) {
      const id = itemNodeId(item.id);
      addNode(
        {
          id,
          label: item.label,
          color: group.color,
          kind: "item",
          value: itemTotal,
        },
        3,
      );
      links.push({
        source: bucketNodeId(group.id),
        target: id,
        value: itemTotal,
        color: group.color,
      });
      sources.set(id, {
        title: item.label,
        note: "Each deposit at this line's amount on the paycheck version in effect on its date.",
        total: itemTotal,
        lines: itemLines.get(item.id) ?? [],
        transactions: [],
      });
    }
  }

  // With Net pay closed nothing flows out of it, so there's no spending or left over to draw.
  for (const entry of netOpen ? drawnSpending : []) {
    const id = spendingNodeId(entry.key);
    const children = (childrenByBucket.get(entry.key) ?? []).filter(
      (child) => child.amount > 0,
    );
    addNode(
      {
        id,
        label: entry.name,
        color: entry.color,
        kind: "spending",
        value: entry.amount,
        expandable: entry.key !== UNCLASSIFIED_KEY && children.length > 0,
        expanded: expanded.has(id),
      },
      3,
    );
    links.push({
      source: NET_ID,
      target: id,
      value: entry.amount,
      color: entry.color,
    });
    if (expanded.has(id) && entry.key !== UNCLASSIFIED_KEY) {
      for (const child of children) {
        const childId = categoryNodeId(child.id);
        addNode(
          {
            id: childId,
            label: child.label,
            color: entry.color,
            kind: "category",
            value: child.amount,
          },
          4,
        );
        links.push({
          source: id,
          target: childId,
          value: child.amount,
          color: entry.color,
        });
        sources.set(childId, {
          title: child.label,
          note: `Bank transactions in this category (${entry.name}), as money out (+) or in (−).`,
          total: child.amount,
          lines: [],
          transactions: newestFirst(categoryTransactions.get(child.id) ?? []),
        });
      }
    }
    sources.set(id, {
      title: entry.name,
      note: "Bank transactions in this spending bucket, as money out (+) or in (−).",
      total: entry.amount,
      lines: [],
      transactions: newestFirst(spendingTransactions.get(entry.key) ?? []),
    });
  }
  if (netOpen && leftover > 0) {
    addNode(
      {
        id: LEFTOVER_ID,
        label: "Left over",
        color: LEFTOVER_COLOR,
        kind: "leftover",
        value: leftover,
      },
      3,
    );
    links.push({
      source: NET_ID,
      target: LEFTOVER_ID,
      value: leftover,
      color: LEFTOVER_COLOR,
    });
  }

  // Squeeze out unused columns, keeping nodes in the order they were added within a column.
  const columns = [...new Set(nodes.map((node) => node.column))].sort(
    (a, b) => a - b,
  );
  const graphNodes: GraphNode[] = nodes
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...node }) => ({
      ...node,
      column: columns.indexOf(node.column),
    }));

  return {
    graph: { nodes: graphNodes, links, total },
    sources,
    gross,
    withheld,
    net,
    spending,
    leftover,
    shortfall,
  };
}
