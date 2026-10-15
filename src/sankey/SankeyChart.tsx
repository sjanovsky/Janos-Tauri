import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  sankey,
  sankeyLinkHorizontal,
  type SankeyLink,
  type SankeyNode,
} from "d3-sankey";
import {
  abbreviateCurrency,
  wholeCurrencyFormatter,
} from "../spending/lib/format";
import type { GraphLink, GraphNode, SankeyGraph } from "./lib/sankey";

const MARGIN = { top: 30, right: 215, bottom: 16, left: 185 };
const NODE_WIDTH = 14;
const NODE_PADDING = 38;
const MIN_HEIGHT = 480;
const ROW_HEIGHT = 46;

// Relative width of the gap after each column (0 = between the first two). The left side only
// carries ribbons, so it's tight; the right side carries labels and gets the room.
const GAP_WEIGHTS = [0.7, 0.9, 1.3, 1.4, 1.4];

// How far the middle columns are pulled in from the top and bottom, and the widest gap spread
// leaves between two nodes.
const COLUMN_INSET = 56;
const MAX_GAP = 130;

type LaidOutNode = SankeyNode<GraphNode, GraphLink>;
type LaidOutLink = SankeyLink<GraphNode, GraphLink>;

type SankeyChartProps = {
  graph: SankeyGraph;
  // Called with the node's graph id when a node is clicked (drill into what makes it up).
  onSelectNode?: (id: string) => void;
  // Called when a bucket's arrow is clicked, to open or close it.
  onToggleNode?: (id: string) => void;
};

// The diagram itself: d3-sankey does the layout (vertical packing and ribbon widths), React
// renders it as plain SVG. The SVG is drawn at the size of the space it's given, so the diagram
// fills the panel's whole width and height. Nodes keep the user's order within each column, and
// each node's column comes straight from the graph so inflows always sit left and outflows right.
function SankeyChart({ graph, onSelectNode, onToggleNode }: SankeyChartProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1250, height: 620 });

  // Track the stage's size so the layout always matches what's on screen.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const measure = () =>
      setSize((current) =>
        current.width === stage.clientWidth &&
        current.height === stage.clientHeight
          ? current
          : { width: stage.clientWidth, height: stage.clientHeight },
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // Tall diagrams (many nodes in a column) still get room to breathe if the panel is short.
  const minHeight = useMemo(() => {
    const perColumn = new Map<number, number>();
    graph.nodes.forEach((node) =>
      perColumn.set(node.column, (perColumn.get(node.column) ?? 0) + 1),
    );
    const tallest = Math.max(1, ...perColumn.values());
    return Math.max(
      MIN_HEIGHT,
      tallest * ROW_HEIGHT + MARGIN.top + MARGIN.bottom,
    );
  }, [graph.nodes]);

  const width = Math.max(size.width, 600);
  const height = Math.max(size.height, minHeight);

  const layout = useMemo(() => {
    // d3-sankey mutates what it's given, so hand it copies.
    const generator = sankey<GraphNode, GraphLink>()
      .nodeId((node) => node.id)
      .nodeAlign((node) => node.column)
      .nodeSort(null)
      .linkSort(null)
      .nodeWidth(NODE_WIDTH)
      .nodePadding(NODE_PADDING)
      .extent([
        [MARGIN.left, MARGIN.top],
        [width - MARGIN.right, height - MARGIN.bottom],
      ]);
    const laidOut = generator({
      nodes: graph.nodes.map((node) => ({ ...node })),
      links: graph.links.map((link) => ({ ...link })),
    });

    // d3-sankey spaces columns evenly. Re-space them by weight (ribbons follow the nodes), so the
    // right-hand columns, which carry the labels, aren't squeezed against each other.
    const lastColumn = Math.max(0, ...laidOut.nodes.map((node) => node.column));
    const weights = Array.from(
      { length: lastColumn },
      (_, index) => GAP_WEIGHTS[Math.min(index, GAP_WEIGHTS.length - 1)],
    );
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    const span = width - MARGIN.right - MARGIN.left - NODE_WIDTH;
    const columnX = (column: number) =>
      MARGIN.left +
      (span *
        weights.slice(0, column).reduce((sum, weight) => sum + weight, 0)) /
        totalWeight;
    for (const node of laidOut.nodes) {
      node.x0 = columnX(node.column);
      node.x1 = node.x0 + NODE_WIDTH;
    }

    // Spread every column after the first evenly top to bottom, like an income statement. The
    // last column uses the full height; the columns before it are inset a little at both ends, so
    // the ribbons into the first and last node of the last column curl out instead of running
    // flat, and the buckets sit toward the corners rather than bunched in the middle.
    const top = MARGIN.top;
    const bottom = height - MARGIN.bottom;
    for (let column = 1; column <= lastColumn; column += 1) {
      const nodes = laidOut.nodes
        .filter((node) => node.column === column)
        .sort((a, b) => (a.y0 ?? 0) - (b.y0 ?? 0));
      if (nodes.length < 2) {
        continue;
      }
      const inset = column === lastColumn ? 0 : COLUMN_INSET;
      const from = top + inset;
      const to = bottom - inset;
      const heights = nodes.map((node) => (node.y1 ?? 0) - (node.y0 ?? 0));
      const free = to - from - heights.reduce((sum, value) => sum + value, 0);
      const gap = Math.max(8, Math.min(MAX_GAP, free / (nodes.length - 1)));
      // Center the group when the gap was capped.
      const used =
        heights.reduce((sum, value) => sum + value, 0) +
        gap * (nodes.length - 1);
      let y = from + Math.max(0, (to - from - used) / 2);
      nodes.forEach((node, index) => {
        node.y0 = y;
        node.y1 = y + heights[index];
        y += heights[index] + gap;
      });
    }
    generator.update(laidOut);
    return laidOut;
  }, [graph, width, height]);

  const linkPath = useMemo(
    () => sankeyLinkHorizontal<GraphNode, GraphLink>(),
    [],
  );
  const percentOf = (value: number) => {
    return graph.total > 0 ? `${Math.round((value / graph.total) * 100)}%` : "";
  };

  const gradientId = (index: number) => `sankey-link-${index}`;

  return (
    <div className="sankey-stage" ref={stageRef} style={{ minHeight }}>
      <svg
        className="sankey-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Money flowing from paychecks through withholding to spending"
      >
        <defs>
          {(layout.links as LaidOutLink[]).map((link, index) => {
            const source = link.source as LaidOutNode;
            const target = link.target as LaidOutNode;
            return (
              <linearGradient
                key={index}
                id={gradientId(index)}
                gradientUnits="userSpaceOnUse"
                x1={source.x1 ?? 0}
                x2={target.x0 ?? 0}
              >
                <stop offset="0%" stopColor={source.color} />
                <stop offset="100%" stopColor={link.color} />
              </linearGradient>
            );
          })}
        </defs>

        <g fill="none">
          {(layout.links as LaidOutLink[]).map((link, index) => (
            <path
              key={index}
              d={linkPath(link) ?? undefined}
              stroke={`url(#${gradientId(index)})`}
              strokeOpacity={0.4}
              strokeWidth={Math.max(1, link.width ?? 0)}
            />
          ))}
        </g>

        {(layout.nodes as LaidOutNode[]).map((node) => {
          const x0 = node.x0 ?? 0;
          const x1 = node.x1 ?? 0;
          const y0 = node.y0 ?? 0;
          const y1 = node.y1 ?? 0;
          const value = node.value ?? 0;
          // What comes out of net pay (spending, its categories and what's left) is a long list of
          // small numbers: it gets smaller type and the whole dollar amount. The income side keeps
          // the larger, abbreviated labels.
          const detail =
            node.kind === "spending" ||
            node.kind === "category" ||
            node.kind === "leftover";
          const amount = detail
            ? wholeCurrencyFormatter.format(value)
            : abbreviateCurrency(value);
          const midY = (y0 + y1) / 2;
          const hasIncoming = (node.targetLinks?.length ?? 0) > 0;
          const hasOutgoing = (node.sourceLinks?.length ?? 0) > 0;
          const toggle =
            node.expandable && onToggleNode
              ? () => onToggleNode(node.id)
              : null;

          const classes = `sankey-chart__label ${detail ? "sankey-chart__label--detail" : ""}`;
          const arrow = toggle ? (
            <tspan
              className="sankey-chart__toggle"
              onClick={(event) => {
                event.stopPropagation();
                toggle();
              }}
            >
              {node.expanded ? "▾" : "▸"}
              {"\u00a0"}
            </tspan>
          ) : null;

          let label: ReactNode;
          if (!hasIncoming) {
            // The first column labels to the left of its bars, centered on them.
            label = (
              <text
                className={classes}
                x={x0 - 8}
                y={midY}
                dy="0.35em"
                textAnchor="end"
              >
                <tspan className="sankey-chart__name">{node.label}</tspan>
                <tspan className="sankey-chart__amount" dx="6">
                  {amount}
                </tspan>
              </text>
            );
          } else if (!hasOutgoing) {
            // Nodes nothing flows out of label to their right, centered on the bar, so the text
            // sits exactly where its value is.
            label = (
              <text
                className={classes}
                x={x1 + 8}
                y={midY}
                dy="0.35em"
                textAnchor="start"
              >
                {arrow}
                <tspan className="sankey-chart__name">{node.label}</tspan>
                <tspan className="sankey-chart__amount" dx="6">
                  {amount}
                  {!detail && node.kind === "bucket"
                    ? ` · ${percentOf(value)}`
                    : ""}
                </tspan>
              </text>
            );
          } else {
            // Nodes with ribbons leaving sit above their bar on one line, clear of the ribbons.
            label = (
              <text className={classes} x={x0} y={y0 - 8} textAnchor="start">
                {arrow}
                <tspan className="sankey-chart__name">{node.label}</tspan>
                <tspan className="sankey-chart__amount" dx="6">
                  {amount} · {percentOf(value)}
                </tspan>
              </text>
            );
          }

          return (
            <g
              key={node.id}
              className={onSelectNode ? "sankey-chart__node" : undefined}
              onClick={onSelectNode ? () => onSelectNode(node.id) : undefined}
            >
              <title>{`${node.label}: ${wholeCurrencyFormatter.format(value)}`}</title>
              <rect
                x={x0}
                y={y0}
                width={x1 - x0}
                height={Math.max(1, y1 - y0)}
                rx={2}
                fill={node.color}
              />
              {label}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default SankeyChart;
