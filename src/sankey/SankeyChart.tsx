import { useMemo, type SVGProps } from "react";
import { sankey, sankeyLinkHorizontal, type SankeyLink, type SankeyNode } from "d3-sankey";
import { abbreviateCurrency } from "../spending/lib/format";
import type { GraphLink, GraphNode, SankeyGraph } from "./lib/sankey";

const WIDTH = 1100;
const MARGIN = { top: 24, right: 200, bottom: 16, left: 190 };
const NODE_WIDTH = 14;
const NODE_PADDING = 20;
const MIN_HEIGHT = 420;
const MAX_HEIGHT = 900;
const ROW_HEIGHT = 34;

type LaidOutNode = SankeyNode<GraphNode, GraphLink>;
type LaidOutLink = SankeyLink<GraphNode, GraphLink>;

type SankeyChartProps = {
  graph: SankeyGraph;
  // Called with the node's graph id when a node is clicked (drill into what makes it up).
  onSelectNode?: (id: string) => void;
};

// The diagram itself: d3-sankey does the layout (vertical packing and ribbon widths), React
// renders it as plain SVG. Nodes keep the user's order within each column, and each node's column
// comes straight from the graph so inflows always sit left and outflows right.
function SankeyChart({ graph, onSelectNode }: SankeyChartProps) {
  const lastColumn = useMemo(() => Math.max(0, ...graph.nodes.map((node) => node.column)), [graph.nodes]);

  const height = useMemo(() => {
    const perColumn = new Map<number, number>();
    graph.nodes.forEach((node) => perColumn.set(node.column, (perColumn.get(node.column) ?? 0) + 1));
    const tallest = Math.max(1, ...perColumn.values());
    return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, tallest * ROW_HEIGHT + MARGIN.top + MARGIN.bottom));
  }, [graph.nodes]);

  const layout = useMemo(() => {
    // d3-sankey mutates what it's given, so hand it copies.
    return sankey<GraphNode, GraphLink>()
      .nodeId((node) => node.id)
      .nodeAlign((node) => node.column)
      .nodeSort(null)
      .linkSort(null)
      .nodeWidth(NODE_WIDTH)
      .nodePadding(NODE_PADDING)
      .extent([
        [MARGIN.left, MARGIN.top],
        [WIDTH - MARGIN.right, height - MARGIN.bottom],
      ])({
      nodes: graph.nodes.map((node) => ({ ...node })),
      links: graph.links.map((link) => ({ ...link })),
    });
  }, [graph, height]);

  const linkPath = useMemo(() => sankeyLinkHorizontal<GraphNode, GraphLink>(), []);
  const percentOf = (value: number) => {
    const total = Math.max(graph.inflowTotal, graph.outflowTotal);
    return total > 0 ? `${Math.round((value / total) * 100)}%` : "";
  };

  return (
    <svg
      className="sankey-chart"
      viewBox={`0 0 ${WIDTH} ${height}`}
      role="img"
      aria-label="Money flowing from income to taxes, investments and expenses"
      preserveAspectRatio="xMidYMid meet"
    >
      <g fill="none">
        {(layout.links as LaidOutLink[]).map((link, index) => (
          <path
            key={index}
            d={linkPath(link) ?? undefined}
            stroke={link.color}
            strokeOpacity={0.38}
            strokeWidth={Math.max(1, link.width ?? 0)}
          />
        ))}
      </g>

      {(layout.nodes as LaidOutNode[]).map((node) => {
        const x0 = node.x0 ?? 0;
        const x1 = node.x1 ?? 0;
        const y0 = node.y0 ?? 0;
        const y1 = node.y1 ?? 0;
        const isFirst = node.column === 0;
        const isLast = node.column === lastColumn;
        const money = abbreviateCurrency(node.value ?? 0);
        // Category columns at either edge label outside the diagram. Bucket columns in the middle
        // label just above their bar, where the ribbons haven't fanned out yet.
        const edge = isFirst || isLast;
        const label = edge ? `${node.label}  ${money}` : `${node.label}  ${money} · ${percentOf(node.value ?? 0)}`;
        const textProps: SVGProps<SVGTextElement> = edge
          ? { x: isFirst ? x0 - 8 : x1 + 8, y: (y0 + y1) / 2, dy: "0.35em", textAnchor: isFirst ? "end" : "start" }
          : { x: x0, y: y0 - 7, textAnchor: "start" };
        return (
          <g
            key={node.id}
            className={onSelectNode ? "sankey-chart__node" : undefined}
            onClick={onSelectNode ? () => onSelectNode(node.id) : undefined}
          >
            <title>{`${node.label}: ${money}`}</title>
            <rect x={x0} y={y0} width={x1 - x0} height={Math.max(1, y1 - y0)} rx={2} fill={node.color} />
            <text className="sankey-chart__label" {...textProps}>
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default SankeyChart;
