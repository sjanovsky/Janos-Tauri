// Pure logic for the Sankey page: record types, how a category resolves to a name/color, and how
// the user's buckets and categories become the nodes and links of the diagram. No React here.

export type SankeyDirection = "inflow" | "outflow";

export type SankeyBucketRecord = {
  id: string;
  name: string;
  color: string;
  direction: SankeyDirection;
  // Order among all Sankey buckets (ascending); each direction shows its own subsequence.
  position: number;
};

export type SankeyCategoryRecord = {
  id: string;
  bucketId: string;
  // Last known label. A linked category displays its spending bucket's live name instead, and
  // falls back to this when the spending bucket has been deleted.
  name: string;
  // The spending bucket this category stands for, or null for a free-form category.
  spendingBucketId: string | null;
  // Legacy hand-typed yearly dollars. The page fills this in from the year's paycheck lines or
  // the bank transactions (see flow.ts) before the graph is built.
  amount: number;
  // Order within the category's bucket (ascending).
  position: number;
  // How the Taxes page reads this line (a paycheck category only).
  taxRole: TaxRole;
  // Display color for a category the page derives itself (e.g. Unclassified); saved ones use their
  // bucket's color.
  color?: string;
};

// How a paycheck category feeds the Taxes page: income, a pre-tax deduction, federal withholding,
// or nothing (State tax, Roth contributions and the like only appear on the diagram).
export type TaxRole = "income" | "deduction" | "withholding" | "none";

export type SankeyData = {
  buckets: SankeyBucketRecord[];
  categories: SankeyCategoryRecord[];
};

// The slice of a spending bucket the Sankey page needs (structurally a spending BucketRecord).
export type SpendingBucketRef = { id: string; name: string; color: string };

export const LEFTOVER_COLOR = "#16a34a";
export const SHORTFALL_COLOR = "#dc2626";

export const LEFTOVER_ID = "__leftover";
export const SHORTFALL_ID = "__shortfall";

const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

// What a category shows as: a linked category takes its spending bucket's live name and color;
// a free-form one uses its own name and its Sankey bucket's color.
export function resolveCategory(
  category: SankeyCategoryRecord,
  bucket: SankeyBucketRecord | undefined,
  spendingBuckets: SpendingBucketRef[],
): { name: string; color: string } {
  const linked = category.spendingBucketId
    ? spendingBuckets.find((spending) => spending.id === category.spendingBucketId)
    : undefined;
  return {
    name: linked?.name ?? category.name,
    color: linked?.color ?? category.color ?? bucket?.color ?? "#94a3b8",
  };
}

// Non-positive and non-finite amounts don't draw anything.
const drawable = (amount: number) => (Number.isFinite(amount) && amount > 0 ? amount : 0);

export function bucketTotal(bucketId: string, categories: SankeyCategoryRecord[]): number {
  return categories
    .filter((category) => category.bucketId === bucketId)
    .reduce((total, category) => total + drawable(category.amount), 0);
}

export type GraphNodeKind = "category" | "bucket" | "leftover" | "shortfall";

export type GraphNode = {
  id: string;
  label: string;
  color: string;
  kind: GraphNodeKind;
  direction: SankeyDirection | null;
  // Dense left-to-right column index: unused columns are squeezed out so the diagram never has
  // empty vertical gaps (e.g. when there are no inflows at all).
  column: number;
  value: number;
};

export type GraphLink = {
  source: string;
  target: string;
  value: number;
  color: string;
};

export type SankeyGraph = {
  nodes: GraphNode[];
  links: GraphLink[];
  inflowTotal: number;
  outflowTotal: number;
  // Inflows beyond the outflows, drawn as a "Left over" node on the outflow side.
  leftover: number;
  // Outflows beyond the inflows, drawn as a "Shortfall" node on the inflow side.
  shortfall: number;
};

// Four logical columns before dense renumbering:
//   0 inflow categories → 1 inflow buckets (+ shortfall) → 2 outflow buckets (+ left over)
//   → 3 outflow categories
// Each inflow bucket (and the shortfall) splits across the outflow nodes in proportion to their
// dollars, so every outflow node receives exactly its own total.
export function buildSankeyGraph(
  buckets: SankeyBucketRecord[],
  categories: SankeyCategoryRecord[],
  spendingBuckets: SpendingBucketRef[],
): SankeyGraph {
  const ordered = [...buckets].sort(byPosition);
  const used = ordered
    .map((bucket) => ({ bucket, total: bucketTotal(bucket.id, categories) }))
    .filter((entry) => entry.total > 0);
  const inflows = used.filter((entry) => entry.bucket.direction === "inflow");
  const outflows = used.filter((entry) => entry.bucket.direction === "outflow");

  const inflowTotal = inflows.reduce((sum, entry) => sum + entry.total, 0);
  const outflowTotal = outflows.reduce((sum, entry) => sum + entry.total, 0);
  const leftover = Math.max(0, inflowTotal - outflowTotal);
  const shortfall = Math.max(0, outflowTotal - inflowTotal);
  const flowTotal = Math.max(inflowTotal, outflowTotal);

  const empty: SankeyGraph = { nodes: [], links: [], inflowTotal, outflowTotal, leftover, shortfall };
  if (flowTotal === 0) {
    return empty;
  }

  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  const categoryNodes = (entries: typeof used, column: number, direction: SankeyDirection) => {
    for (const { bucket } of entries) {
      const members = categories
        .filter((category) => category.bucketId === bucket.id && drawable(category.amount) > 0)
        .sort(byPosition);
      for (const category of members) {
        const resolved = resolveCategory(category, bucket, spendingBuckets);
        nodes.push({
          id: `category:${category.id}`,
          label: resolved.name,
          color: resolved.color,
          kind: "category",
          direction,
          column,
          value: drawable(category.amount),
        });
        // Inflow categories feed their bucket; an outflow bucket feeds its categories.
        links.push(
          direction === "inflow"
            ? { source: `category:${category.id}`, target: `bucket:${bucket.id}`, value: drawable(category.amount), color: resolved.color }
            : { source: `bucket:${bucket.id}`, target: `category:${category.id}`, value: drawable(category.amount), color: resolved.color },
        );
      }
    }
  };

  categoryNodes(inflows, 0, "inflow");

  for (const { bucket, total } of inflows) {
    nodes.push({
      id: `bucket:${bucket.id}`,
      label: bucket.name,
      color: bucket.color,
      kind: "bucket",
      direction: "inflow",
      column: 1,
      value: total,
    });
  }
  if (shortfall > 0) {
    nodes.push({
      id: SHORTFALL_ID,
      label: "Shortfall",
      color: SHORTFALL_COLOR,
      kind: "shortfall",
      direction: "inflow",
      column: 1,
      value: shortfall,
    });
  }

  for (const { bucket, total } of outflows) {
    nodes.push({
      id: `bucket:${bucket.id}`,
      label: bucket.name,
      color: bucket.color,
      kind: "bucket",
      direction: "outflow",
      column: 2,
      value: total,
    });
  }
  if (leftover > 0) {
    nodes.push({
      id: LEFTOVER_ID,
      label: "Left over",
      color: LEFTOVER_COLOR,
      kind: "leftover",
      direction: "outflow",
      column: 2,
      value: leftover,
    });
  }

  categoryNodes(outflows, 3, "outflow");

  // Middle links: every source node (inflow bucket or shortfall) → every outflow node, split by
  // the target's share of all outflow dollars.
  const sources = nodes.filter((node) => node.column === 1);
  const targets = nodes.filter((node) => node.column === 2);
  for (const source of sources) {
    for (const target of targets) {
      links.push({
        source: source.id,
        target: target.id,
        value: (source.value * target.value) / flowTotal,
        color: target.color,
      });
    }
  }

  // Squeeze out unused columns.
  const columns = [...new Set(nodes.map((node) => node.column))].sort((a, b) => a - b);
  for (const node of nodes) {
    node.column = columns.indexOf(node.column);
  }

  return { nodes, links, inflowTotal, outflowTotal, leftover, shortfall };
}
