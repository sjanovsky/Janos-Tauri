// The diagram's data shape: nodes in dense left-to-right columns and the links between them. The
// numbers themselves are derived from transactions in flow.ts; no React here.

export type NodeKind =
  | "paycheck"
  | "gross"
  | "bucket"
  | "item"
  | "net"
  | "spending"
  | "category"
  | "leftover"
  | "shortfall";

export type GraphNode = {
  id: string;
  label: string;
  color: string;
  kind: NodeKind;
  // Dense left-to-right column index: unused columns are squeezed out so the diagram never has
  // empty vertical gaps.
  column: number;
  value: number;
  // A bucket that can open into its categories or line items, and whether it currently has.
  expandable?: boolean;
  expanded?: boolean;
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
  // Dollars entering the diagram: gross pay plus any shortfall covered from elsewhere.
  total: number;
};

export const LEFTOVER_COLOR = "#16a34a";
export const SHORTFALL_COLOR = "#dc2626";
export const GROSS_COLOR = "#4f46e5";
export const NET_COLOR = "#0891b2";

export const GROSS_ID = "gross";
export const NET_ID = "net";
export const LEFTOVER_ID = "leftover";
export const SHORTFALL_ID = "shortfall";

export const paycheckNodeId = (paycheckId: string) => `paycheck:${paycheckId}`;
export const bucketNodeId = (bucketId: string) => `bucket:${bucketId}`;
export const itemNodeId = (itemId: string) => `item:${itemId}`;
export const spendingNodeId = (key: string) => `spending:${key}`;
export const categoryNodeId = (categoryId: string) => `category:${categoryId}`;
