import { describe, expect, it } from "vitest";
import {
  LEFTOVER_ID,
  SHORTFALL_ID,
  bucketTotal,
  buildSankeyGraph,
  resolveCategory,
  type SankeyBucketRecord,
  type SankeyCategoryRecord,
} from "./sankey";

const bucket = (id: string, direction: "inflow" | "outflow", position: number, color = "#111111"): SankeyBucketRecord => ({
  id,
  name: id,
  color,
  direction,
  position,
});

let nextPosition = 0;
const category = (
  id: string,
  bucketId: string,
  amount: number,
  spendingBucketId: string | null = null,
): SankeyCategoryRecord => ({
  id,
  bucketId,
  name: id,
  spendingBucketId,
  amount,
  position: nextPosition++,
  taxRole: "none",
});

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe("resolveCategory", () => {
  const spending = [{ id: "sp1", name: "Food", color: "#ff0000" }];
  const parent = bucket("expenses", "outflow", 0, "#0000ff");

  it("uses the bucket color and own name for a free-form category", () => {
    expect(resolveCategory(category("rent", "expenses", 1), parent, spending)).toEqual({
      name: "rent",
      color: "#0000ff",
    });
  });

  it("takes the live name and color of a linked spending bucket", () => {
    expect(resolveCategory(category("old", "expenses", 1, "sp1"), parent, spending)).toEqual({
      name: "Food",
      color: "#ff0000",
    });
  });

  it("falls back to its stored name when the spending bucket is gone", () => {
    expect(resolveCategory(category("old", "expenses", 1, "missing"), parent, spending)).toEqual({
      name: "old",
      color: "#0000ff",
    });
  });
});

describe("buildSankeyGraph", () => {
  it("is empty when nothing has a positive amount", () => {
    const graph = buildSankeyGraph([bucket("income", "inflow", 0)], [category("salary", "income", 0)], []);
    expect(graph.nodes).toEqual([]);
    expect(graph.links).toEqual([]);
  });

  it("ignores negative and non-finite amounts", () => {
    const categories = [category("a", "b", 100), category("b", "b", -50), category("c", "b", Number.NaN)];
    expect(bucketTotal("b", categories)).toBe(100);
  });

  it("adds a left-over node on the outflow side when inflows exceed outflows", () => {
    const graph = buildSankeyGraph(
      [bucket("income", "inflow", 0), bucket("taxes", "outflow", 1)],
      [category("salary", "income", 100_000), category("federal", "taxes", 30_000)],
      [],
    );
    expect(graph.leftover).toBe(70_000);
    expect(graph.shortfall).toBe(0);
    const leftover = graph.nodes.find((node) => node.id === LEFTOVER_ID);
    expect(leftover?.value).toBe(70_000);
    expect(leftover?.column).toBe(2);
    expect(graph.nodes.find((node) => node.id === SHORTFALL_ID)).toBeUndefined();
  });

  it("adds a shortfall node on the inflow side when outflows exceed inflows", () => {
    const graph = buildSankeyGraph(
      [bucket("income", "inflow", 0), bucket("expenses", "outflow", 1)],
      [category("salary", "income", 50_000), category("rent", "expenses", 80_000)],
      [],
    );
    expect(graph.shortfall).toBe(30_000);
    expect(graph.leftover).toBe(0);
    const shortfall = graph.nodes.find((node) => node.id === SHORTFALL_ID);
    expect(shortfall?.value).toBe(30_000);
    expect(shortfall?.column).toBe(1);
  });

  it("conserves flow: every node's incoming and outgoing links add up to its value", () => {
    const graph = buildSankeyGraph(
      [
        bucket("income", "inflow", 0),
        bucket("side", "inflow", 1),
        bucket("taxes", "outflow", 2),
        bucket("expenses", "outflow", 3),
      ],
      [
        category("salary", "income", 120_000),
        category("bonus", "income", 20_000),
        category("gig", "side", 10_000),
        category("federal", "taxes", 25_000),
        category("state", "taxes", 5_000),
        category("rent", "expenses", 40_000),
        category("food", "expenses", 20_000),
      ],
      [],
    );
    expect(graph.inflowTotal).toBe(150_000);
    expect(graph.outflowTotal).toBe(90_000);
    expect(graph.leftover).toBe(60_000);

    for (const node of graph.nodes) {
      const incoming = sum(graph.links.filter((link) => link.target === node.id).map((link) => link.value));
      const outgoing = sum(graph.links.filter((link) => link.source === node.id).map((link) => link.value));
      const hasIn = incoming > 0;
      const hasOut = outgoing > 0;
      if (hasIn) expect(incoming).toBeCloseTo(node.value, 6);
      if (hasOut) expect(outgoing).toBeCloseTo(node.value, 6);
    }
  });

  it("splits each inflow bucket across outflows by the target's dollars", () => {
    const graph = buildSankeyGraph(
      [bucket("income", "inflow", 0), bucket("taxes", "outflow", 1), bucket("expenses", "outflow", 2)],
      [category("salary", "income", 100), category("federal", "taxes", 25), category("rent", "expenses", 75)],
      [],
    );
    const flow = (target: string) =>
      graph.links.find((link) => link.source === "bucket:income" && link.target === target)?.value;
    expect(flow("bucket:taxes")).toBe(25);
    expect(flow("bucket:expenses")).toBe(75);
  });

  it("keeps the user's bucket and category order", () => {
    const graph = buildSankeyGraph(
      [bucket("b", "outflow", 2), bucket("a", "outflow", 1), bucket("income", "inflow", 0)],
      [
        category("salary", "income", 100),
        { ...category("late", "a", 10), position: 5 },
        { ...category("early", "a", 10), position: 1 },
        category("other", "b", 10),
      ],
      [],
    );
    const outflowBuckets = graph.nodes.filter((node) => node.kind === "bucket" && node.direction === "outflow");
    expect(outflowBuckets.map((node) => node.label)).toEqual(["a", "b"]);
    const outflowCategories = graph.nodes.filter((node) => node.kind === "category" && node.direction === "outflow");
    expect(outflowCategories.map((node) => node.label).slice(0, 2)).toEqual(["early", "late"]);
  });

  it("renumbers columns densely when there are no inflows", () => {
    const graph = buildSankeyGraph(
      [bucket("expenses", "outflow", 0)],
      [category("rent", "expenses", 1_000)],
      [],
    );
    expect(graph.shortfall).toBe(1_000);
    expect(Math.min(...graph.nodes.map((node) => node.column))).toBe(0);
    expect(Math.max(...graph.nodes.map((node) => node.column))).toBe(2);
  });
});
