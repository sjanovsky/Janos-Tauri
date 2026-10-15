import { describe, expect, it } from "vitest";
import { buildFlow, type FlowInput, type FlowSourceTransaction } from "./flow";
import { defaultPeriod, periodBounds } from "./period";
import { LEFTOVER_ID, SHORTFALL_ID } from "./sankey";

const paycheck = {
  id: "pc1",
  name: "Stephen Salary",
  depositPattern: "",
  color: "#4f46e5",
  position: 0,
  versions: [
    {
      id: "v1",
      effectiveFrom: "",
      effectiveTo: "",
      gross: 4000,
      transactionId: null,
      values: [
        { itemId: "fed", amount: 600 },
        { itemId: "k401", amount: 400 },
      ],
    },
  ],
};

const tx = (
  id: string,
  date: string,
  amount: number,
  category: string,
): FlowSourceTransaction => ({
  id,
  date,
  description: id,
  amount,
  sourceBank: "Chase",
  category,
});

const base = (
  transactions: FlowSourceTransaction[],
  extra: Partial<FlowInput> = {},
): FlowInput => ({
  bounds: periodBounds({
    ...defaultPeriod(new Date(2026, 5, 1)),
    mode: "year",
    year: 2026,
  }),
  paychecks: [paycheck],
  paycheckBuckets: [
    { id: "wh", name: "Withholding", color: "#e11d48", position: 0 },
    { id: "sv", name: "Savings", color: "#0ca678", position: 1 },
  ],
  paycheckItems: [
    { id: "fed", label: "Federal", bucketId: "wh", position: 0 },
    { id: "k401", label: "401K", bucketId: "sv", position: 1 },
  ],
  spendingBuckets: [
    { id: "fixed", name: "Fixed", color: "#111111", position: 0 },
  ],
  spendingCategories: [
    {
      id: "rent",
      label: "Rent",
      color: "#111",
      bucketId: "fixed",
      excluded: false,
      position: 0,
    },
    {
      id: "utilities",
      label: "Utilities",
      color: "#222",
      bucketId: "fixed",
      excluded: false,
      position: 1,
    },
    {
      id: "interest",
      label: "Interest",
      color: "#333",
      bucketId: "income",
      excluded: false,
      position: 2,
    },
  ],
  banks: [{ name: "Chase", spendingPositive: false }],
  transactions,
  ...extra,
});

// Chase lists spending as negative, so a deposit is positive.
const deposit = (id: string, date: string) => tx(id, date, 3000, "pc1");

describe("buildFlow", () => {
  it("multiplies the template by the deposit count", () => {
    const flow = buildFlow(
      base([
        deposit("d1", "1/15/2026"),
        deposit("d2", "1/31/2026"),
        tx("r", "2/1/2026", -1500, "rent"),
      ]),
    );
    expect(flow.gross).toBe(8000);
    expect(flow.withheld).toBe(2000);
    expect(flow.net).toBe(6000);
    expect(flow.spending).toBe(1500);
    expect(flow.leftover).toBe(4500);
    const values = Object.fromEntries(
      flow.graph.nodes.map((n) => [n.id, n.value]),
    );
    expect(values["bucket:wh"]).toBe(1200);
    expect(values["bucket:sv"]).toBe(800);
    expect(flow.graph.nodes.some((n) => n.id.startsWith("item:"))).toBe(false);
    expect(values[LEFTOVER_ID]).toBe(4500);
  });

  it("limits to the month and ignores other income and transfers", () => {
    const flow = buildFlow(
      base(
        [
          deposit("d1", "1/15/2026"),
          deposit("d2", "2/15/2026"),
          tx("i", "2/2/2026", 50, "interest"),
          tx("t", "2/3/2026", -900, "transfers"),
          tx("r", "2/4/2026", -700, "rent"),
        ],
        {
          bounds: periodBounds({
            ...defaultPeriod(),
            mode: "month",
            year: 2026,
            month: 1,
          }),
        },
      ),
    );
    expect(flow.gross).toBe(4000);
    expect(flow.spending).toBe(700);
  });

  it("switches to a new version from its effective date", () => {
    const raised = {
      ...paycheck,
      versions: [
        ...paycheck.versions,
        {
          id: "v2",
          effectiveFrom: "2026-02-01",
          effectiveTo: "",
          gross: 5000,
          transactionId: null,
          values: [{ itemId: "fed", amount: 800 }],
        },
      ],
    };
    const flow = buildFlow(
      base(
        [
          tx("d1", "1/15/2026", 3000, "pc1"),
          tx("d2", "2/15/2026", 4200, "pc1"),
        ],
        { paychecks: [raised] },
      ),
    );
    expect(flow.gross).toBe(9000);
    expect(flow.withheld).toBe(1000 + 800);
  });

  it("uses a one-off version for a single deposit", () => {
    const commission = {
      ...paycheck,
      versions: [
        ...paycheck.versions,
        {
          id: "once",
          effectiveFrom: "",
          effectiveTo: "",
          gross: 6000,
          transactionId: "d2",
          values: [{ itemId: "fed", amount: 1000 }],
        },
      ],
    };
    const flow = buildFlow(
      base(
        [
          tx("d1", "1/15/2026", 3000, "pc1"),
          tx("d2", "1/31/2026", 5000, "pc1"),
        ],
        { paychecks: [commission] },
      ),
    );
    expect(flow.gross).toBe(10_000);
  });

  it("supports custom ranges, inclusive of the end day", () => {
    const flow = buildFlow(
      base(
        [
          deposit("d1", "1/15/2026"),
          deposit("d2", "1/31/2026"),
          deposit("d3", "2/1/2026"),
        ],
        {
          bounds: periodBounds({
            ...defaultPeriod(),
            mode: "range",
            from: "2026-01-16",
            to: "2026-01-31",
          }),
        },
      ),
    );
    expect(flow.gross).toBe(4000);
  });

  it("shows a shortfall when spending exceeds net", () => {
    const flow = buildFlow(
      base([deposit("d1", "1/15/2026"), tx("r", "1/16/2026", -4000, "rent")]),
    );
    expect(flow.shortfall).toBe(1000);
    expect(flow.graph.nodes.some((n) => n.id === SHORTFALL_ID)).toBe(true);
    const into = flow.graph.links
      .filter((l) => l.target === "net")
      .reduce((s, l) => s + l.value, 0);
    expect(into).toBe(4000);
  });

  it("draws spending alone when there are no paychecks", () => {
    const flow = buildFlow(base([tx("r", "1/16/2026", -400, "rent")]));
    expect(flow.gross).toBe(0);
    expect(flow.graph.total).toBe(400);
  });

  it("is empty with nothing in the period", () => {
    expect(buildFlow(base([])).graph.nodes).toEqual([]);
  });

  it("opens a paycheck bucket into its line items", () => {
    const deposits = [deposit("d1", "1/15/2026")];
    const closed = buildFlow(base(deposits));
    expect(closed.graph.nodes.some((n) => n.id === "item:fed")).toBe(false);
    expect(closed.graph.nodes.find((n) => n.id === "bucket:wh")).toMatchObject({
      expandable: true,
      expanded: false,
    });

    const open = buildFlow(
      base(deposits, { expanded: new Set(["bucket:wh"]) }),
    );
    expect(open.graph.nodes.find((n) => n.id === "bucket:wh")?.expanded).toBe(
      true,
    );
    expect(open.graph.nodes.find((n) => n.id === "item:fed")?.value).toBe(600);
    // Only the opened bucket's items show.
    expect(open.graph.nodes.some((n) => n.id === "item:k401")).toBe(false);
    expect(
      open.graph.links.find(
        (l) => l.source === "bucket:wh" && l.target === "item:fed",
      )?.value,
    ).toBe(600);
  });

  it("opens a spending bucket into its categories", () => {
    const txs = [
      deposit("d1", "1/15/2026"),
      tx("r", "1/16/2026", -1500, "rent"),
      tx("u", "1/17/2026", -200, "utilities"),
    ];
    const open = buildFlow(
      base(txs, { expanded: new Set(["net", "spending:fixed"]) }),
    );
    expect(open.graph.nodes.find((n) => n.id === "category:rent")?.value).toBe(
      1500,
    );
    expect(
      open.graph.nodes.find((n) => n.id === "category:utilities")?.value,
    ).toBe(200);
    expect(open.sources.get("category:rent")?.transactions).toHaveLength(1);
    expect(
      buildFlow(base(txs)).graph.nodes.some((n) => n.id === "category:rent"),
    ).toBe(false);
  });

  it("shows nothing past Net pay while it's collapsed", () => {
    const txs = [
      deposit("d1", "1/15/2026"),
      tx("r", "1/16/2026", -1500, "rent"),
      tx("o", "1/17/2026", -200, "other"),
    ];
    const closed = buildFlow(base(txs, { expanded: new Set() }));
    expect(closed.graph.nodes.find((n) => n.id === "net")).toMatchObject({
      expandable: true,
      expanded: false,
    });
    expect(
      closed.graph.nodes.some(
        (n) => n.kind === "spending" || n.kind === "leftover",
      ),
    ).toBe(false);
    expect(closed.graph.links.some((l) => l.source === "net")).toBe(false);

    const open = buildFlow(base(txs, { expanded: new Set(["net"]) }));
    expect(open.graph.nodes.some((n) => n.id === "spending:fixed")).toBe(true);
    expect(open.graph.nodes.some((n) => n.id === "leftover")).toBe(true);
  });
});
