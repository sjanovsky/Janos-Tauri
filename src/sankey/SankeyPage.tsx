import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./sankey.css";
import SankeyAmounts from "./SankeyAmounts";
import SankeyChart from "./SankeyChart";
import SankeyDrill, { type DrillContent } from "./SankeyDrill";
import SankeyManageModal, { type SankeyManageTab } from "./SankeyManageModal";
import { wholeCurrencyFormatter } from "../spending/lib/format";
import {
  nextBucketColor,
  type BucketRecord as SpendingBucketRecord,
  type CategoryRecord as SpendingCategoryRecord,
} from "../spending/lib/categories";
import type { BankRecord } from "../spending/lib/banks";
import {
  buildSankeyGraph,
  type SankeyBucketRecord,
  type SankeyCategoryRecord,
  type SankeyDirection,
  type TaxRole,
} from "./lib/sankey";
import {
  LEFTOVER_ID,
  SHORTFALL_ID,
} from "./lib/sankey";
import {
  availableYears,
  bucketTransactions,
  resolveFlow,
  type FlowSourceTransaction,
  type SankeyLineRecord,
  type SankeyRuleKind,
  type SankeyRuleRecord,
} from "./lib/flow";

// Everything the overview needs from the sankey_* commands, loaded in one call.
type SankeyData = {
  buckets: SankeyBucketRecord[];
  categories: SankeyCategoryRecord[];
  lines: SankeyLineRecord[];
  rules: SankeyRuleRecord[];
  years: number[];
};

const DB_ERROR = "Couldn't reach the local database. Make sure the app is running via `npm run tauri dev`.";

const EMPTY: SankeyData = { buckets: [], categories: [], lines: [], rules: [], years: [] };

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

const money = (value: number) => wholeCurrencyFormatter.format(value);

// The overview: the year's money flowing from income (paycheck numbers you enter plus bank
// deposits routed by rules) through taxes and investments to spending, with whatever doesn't
// balance shown as "Left over" or "Shortfall". Paycheck numbers are the same rows the Taxes page
// reads; spending comes from the bank transactions. State lives here and is persisted through the
// sankey_* Tauri commands with optimistic updates; on any failure the page reloads.
function SankeyPage() {
  const [data, setData] = useState<SankeyData>(EMPTY);
  const [spendingBuckets, setSpendingBuckets] = useState<SpendingBucketRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [manageTab, setManageTab] = useState<SankeyManageTab | null>(null);
  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [drill, setDrill] = useState<DrillContent | null>(null);
  const [spendingCategories, setSpendingCategories] = useState<SpendingCategoryRecord[]>([]);
  const [banks, setBanks] = useState<BankRecord[]>([]);
  const [transactions, setTransactions] = useState<FlowSourceTransaction[]>([]);
  const [dbError, setDbError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      invoke<SankeyData>("get_sankey_data")
        .then((next) => {
          setData(next);
          setLoaded(true);
          setDbError(null);
        })
        .catch((error) => {
          console.error("Failed to load the Sankey from the database", error);
          setDbError(DB_ERROR);
        }),
    [],
  );

  const reloadSpendingBuckets = useCallback(
    () =>
      invoke<SpendingBucketRecord[]>("list_buckets")
        .then(setSpendingBuckets)
        .catch((error) => console.error("Failed to load spending buckets", error)),
    [],
  );

  // Bank data is reloaded whenever the overview mounts, so changes made on the Spending page (a
  // rename, a recategorized transaction, a new upload) show up here.
  const reloadBankData = useCallback(() => {
    const log = (what: string) => (error: unknown) => console.error(`Failed to load ${what}`, error);
    invoke<SpendingCategoryRecord[]>("list_categories").then(setSpendingCategories).catch(log("categories"));
    invoke<BankRecord[]>("list_banks").then(setBanks).catch(log("banks"));
    invoke<{ transactions: FlowSourceTransaction[] }[]>("list_uploads")
      .then((uploads) => setTransactions(uploads.flatMap((upload) => upload.transactions)))
      .catch(log("transactions"));
  }, []);

  useEffect(() => {
    void reload();
    void reloadSpendingBuckets();
    reloadBankData();
  }, [reload, reloadSpendingBuckets, reloadBankData]);

  // Run a persistence call; on failure surface the error and resync from the database.
  const persist = useCallback(
    (command: string, args: Record<string, unknown>) => {
      invoke(command, args).catch((error) => {
        console.error(`Failed to save (${command})`, error);
        setDbError(DB_ERROR);
        void reload();
      });
    },
    [reload],
  );

  const years = useMemo(() => availableYears(data.years, transactions), [data.years, transactions]);

  const flow = useMemo(
    () =>
      resolveFlow({
        year,
        buckets: data.buckets,
        categories: data.categories,
        lines: data.lines,
        rules: data.rules,
        spendingBuckets,
        spendingCategories,
        banks,
        transactions,
      }),
    [year, data, spendingBuckets, spendingCategories, banks, transactions],
  );

  const graph = useMemo(
    () => buildSankeyGraph(data.buckets, flow.categories, spendingBuckets),
    [data.buckets, flow.categories, spendingBuckets],
  );

  // --- Buckets ---

  const saveBucket = (bucket: SankeyBucketRecord) =>
    persist("upsert_sankey_bucket", {
      id: bucket.id,
      name: bucket.name,
      color: bucket.color,
      direction: bucket.direction,
    });

  const handleAddBucket = (direction: SankeyDirection) => {
    const hasInflow = data.buckets.some((bucket) => bucket.direction === "inflow");
    const bucket: SankeyBucketRecord = {
      id: crypto.randomUUID(),
      name: direction === "inflow" ? (hasInflow ? "New inflow" : "Income") : "New outflow",
      color: nextBucketColor(data.buckets.length),
      direction,
      position: data.buckets.reduce((max, other) => Math.max(max, other.position), -1) + 1,
    };
    setData((current) => ({ ...current, buckets: [...current.buckets, bucket] }));
    saveBucket(bucket);
  };

  const handleChangeBucket = (
    id: string,
    changes: Partial<Pick<SankeyBucketRecord, "name" | "color" | "direction">>,
    shouldPersist: boolean,
  ) => {
    const current = data.buckets.find((bucket) => bucket.id === id);
    if (!current) {
      return;
    }
    const next = { ...current, ...changes };
    setData((state) => ({
      ...state,
      buckets: state.buckets.map((bucket) => (bucket.id === id ? next : bucket)),
    }));
    if (shouldPersist) {
      saveBucket(next);
    }
  };

  const handleDeleteBucket = (id: string) => {
    setData((current) => {
      const removed = new Set(current.categories.filter((category) => category.bucketId === id).map((c) => c.id));
      return {
        ...current,
        buckets: current.buckets.filter((bucket) => bucket.id !== id),
        categories: current.categories.filter((category) => category.bucketId !== id),
        lines: current.lines.filter((line) => !removed.has(line.categoryId)),
        rules: current.rules.filter((rule) => rule.bucketId !== id),
      };
    });
    persist("delete_sankey_bucket", { id });
  };

  // Reordering one direction keeps the other direction's order; positions are global, so write
  // the inflows then the outflows as one sequence.
  const handleReorderBuckets = (direction: SankeyDirection, orderedIds: string[]) => {
    const other = data.buckets
      .filter((bucket) => bucket.direction !== direction)
      .sort(byPosition)
      .map((bucket) => bucket.id);
    const all = direction === "inflow" ? [...orderedIds, ...other] : [...other, ...orderedIds];
    setData((current) => ({
      ...current,
      buckets: current.buckets.map((bucket) => ({ ...bucket, position: all.indexOf(bucket.id) })),
    }));
    persist("set_sankey_bucket_positions", { ids: all });
  };

  // --- Categories ---

  const saveCategory = (category: SankeyCategoryRecord) =>
    persist("upsert_sankey_category", {
      id: category.id,
      bucketId: category.bucketId,
      name: category.name,
      spendingBucketId: category.spendingBucketId,
      taxRole: category.taxRole,
    });

  const handleAddCategory = (bucketId: string, spendingBucketId: string | null) => {
    const linked = spendingBucketId ? spendingBuckets.find((bucket) => bucket.id === spendingBucketId) : undefined;
    const category: SankeyCategoryRecord = {
      id: crypto.randomUUID(),
      bucketId,
      name: linked?.name ?? "New category",
      spendingBucketId: linked ? linked.id : null,
      amount: 0,
      taxRole: !linked && data.buckets.find((bucket) => bucket.id === bucketId)?.direction === "inflow" ? "income" : "none",
      position:
        data.categories
          .filter((other) => other.bucketId === bucketId)
          .reduce((max, other) => Math.max(max, other.position), -1) + 1,
    };
    setData((current) => ({ ...current, categories: [...current.categories, category] }));
    saveCategory(category);
  };

  const changeCategory = (
    id: string,
    changes: Partial<Pick<SankeyCategoryRecord, "name" | "taxRole">>,
    shouldPersist: boolean,
  ) => {
    const current = data.categories.find((category) => category.id === id);
    if (!current) {
      return;
    }
    const next = { ...current, ...changes };
    setData((state) => ({
      ...state,
      categories: state.categories.map((category) => (category.id === id ? next : category)),
    }));
    if (shouldPersist) {
      saveCategory(next);
    }
  };

  const handleDeleteCategory = (id: string) => {
    setData((current) => ({
      ...current,
      categories: current.categories.filter((category) => category.id !== id),
      lines: current.lines.filter((line) => line.categoryId !== id),
    }));
    persist("delete_sankey_category", { id });
  };

  // --- Paycheck lines (shared with the Taxes page) ---

  const handleChangeLine = (
    categoryId: string,
    changes: Partial<Pick<SankeyLineRecord, "ytd" | "lastPaycheck" | "paychecksLeft">>,
    shouldPersist: boolean,
  ) => {
    const existing = data.lines.find((line) => line.categoryId === categoryId && line.year === year);
    const next: SankeyLineRecord = {
      categoryId,
      year,
      ytd: 0,
      lastPaycheck: 0,
      paychecksLeft: 0,
      ...existing,
      ...changes,
    };
    setData((state) => ({
      ...state,
      lines: existing
        ? state.lines.map((line) => (line === existing ? next : line))
        : [...state.lines, next],
      years: state.years.includes(year) ? state.years : [...state.years, year],
    }));
    if (shouldPersist) {
      persist("set_paycheck_line", {
        categoryId,
        year,
        ytd: next.ytd,
        lastPaycheck: next.lastPaycheck,
        paychecksLeft: next.paychecksLeft,
      });
    }
  };

  // --- Rules ---

  const saveRule = (rule: SankeyRuleRecord) =>
    persist("upsert_sankey_rule", {
      id: rule.id,
      name: rule.name,
      pattern: rule.pattern,
      kind: rule.kind,
      bucketId: rule.bucketId,
    });

  const handleAddRule = (kind: SankeyRuleKind) => {
    const investments = data.buckets.find((bucket) => bucket.name.toLowerCase().includes("invest"));
    const rule: SankeyRuleRecord = {
      id: crypto.randomUUID(),
      name: kind === "paycheck" ? "Paycheck" : "",
      pattern: "",
      kind,
      bucketId: kind === "bucket" ? (investments?.id ?? null) : null,
      position: data.rules.reduce((max, other) => Math.max(max, other.position), -1) + 1,
    };
    setData((current) => ({ ...current, rules: [...current.rules, rule] }));
    saveRule(rule);
  };

  const handleChangeRule = (
    id: string,
    changes: Partial<Pick<SankeyRuleRecord, "name" | "pattern" | "kind" | "bucketId">>,
    shouldPersist: boolean,
  ) => {
    const current = data.rules.find((rule) => rule.id === id);
    if (!current) {
      return;
    }
    const next = { ...current, ...changes };
    setData((state) => ({ ...state, rules: state.rules.map((rule) => (rule.id === id ? next : rule)) }));
    if (shouldPersist) {
      saveRule(next);
    }
  };

  const handleDeleteRule = (id: string) => {
    setData((current) => ({ ...current, rules: current.rules.filter((rule) => rule.id !== id) }));
    persist("delete_sankey_rule", { id });
  };

  // --- Drilling into the diagram ---

  const lineRowsFor = (categories: SankeyCategoryRecord[]) =>
    categories
      .filter((category) => flow.sources.get(category.id)?.kind === "line")
      .map((category) => {
        const source = flow.sources.get(category.id);
        return { name: category.name, line: source?.kind === "line" ? source.line : undefined };
      })
      .filter((row) => (row.line?.ytd ?? 0) !== 0 || (row.line?.lastPaycheck ?? 0) !== 0);

  const openCategory = (categoryId: string) => {
    const category = flow.categories.find((candidate) => candidate.id === categoryId);
    const source = flow.sources.get(categoryId);
    if (!category || !source) {
      return;
    }
    const spendingName = spendingBuckets.find((bucket) => bucket.id === category.spendingBucketId)?.name;
    const title = spendingName ?? category.name;
    if (source.kind === "bank") {
      setDrill({
        title,
        note: source.rule
          ? `Transactions matching the rule "${source.rule.pattern}".`
          : "Bank transactions in this spending bucket, as money out (+) or in (−).",
        total: category.amount,
        lines: [],
        transactions: [...source.transactions].sort((a, b) => b.timestamp - a.timestamp),
      });
    } else {
      setDrill({
        title,
        note: "Entered by you; the Taxes page reads the same numbers.",
        total: category.amount,
        lines: lineRowsFor([category]),
        transactions: [],
      });
    }
  };

  const openBucket = (bucketId: string) => {
    const bucket = data.buckets.find((candidate) => candidate.id === bucketId);
    if (!bucket) {
      return;
    }
    const members = flow.categories.filter((category) => category.bucketId === bucketId);
    setDrill({
      title: bucket.name,
      note: "Paycheck numbers you entered and the bank transactions that make up this bucket.",
      total: members.reduce((total, category) => total + Math.max(0, category.amount), 0),
      lines: lineRowsFor(members),
      transactions: bucketTransactions(bucketId, flow.categories, flow.sources),
    });
  };

  const handleSelectNode = (nodeId: string) => {
    if (nodeId === LEFTOVER_ID || nodeId === SHORTFALL_ID) {
      return;
    }
    if (nodeId.startsWith("category:")) {
      openCategory(nodeId.slice("category:".length));
    } else if (nodeId.startsWith("bucket:")) {
      openBucket(nodeId.slice("bucket:".length));
    }
  };

  const openDeposits = () =>
    setDrill({
      title: "Paycheck deposits",
      note: "Deposits matching your paycheck rules. These are checked against your paycheck numbers rather than counted as income.",
      total: flow.paycheck.deposits,
      lines: [],
      transactions: flow.paycheck.depositTransactions,
    });

  const handleReorderCategories = (bucketId: string, orderedIds: string[]) => {
    setData((current) => ({
      ...current,
      categories: current.categories.map((category) =>
        category.bucketId === bucketId ? { ...category, position: orderedIds.indexOf(category.id) } : category,
      ),
    }));
    persist("set_sankey_category_positions", { ids: orderedIds });
  };

  const hasBuckets = data.buckets.length > 0;
  const hasFlow = graph.nodes.length > 0;
  const balanced = graph.leftover === 0 && graph.shortfall === 0;
  const check = flow.paycheck;

  return (
    <>
      {dbError && <div className="import-shell__db-error">{dbError}</div>}
      <section className="sankey-page">
        {!loaded ? null : (
          <div className="sankey-body">
            <div className="sankey-panel">
              <div className="sankey-panel__header">
                <div>
                  <h2>Where the money goes</h2>
                  <p>
                    {year} to date: income and paychecks through taxes, investments and spending. Click any part of
                    the diagram to see what it's made of.
                  </p>
                </div>
                <div className="sankey-panel__actions">
                  <select
                    className="sankey-year"
                    aria-label="Year"
                    value={year}
                    onChange={(event) => setYear(Number(event.target.value))}
                  >
                    {years.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="sankey-button" onClick={() => setManageTab("rules")}>
                    Rules
                  </button>
                  <button type="button" className="sankey-button sankey-button--primary" onClick={() => setManageTab("buckets")}>
                    Manage buckets
                  </button>
                </div>
              </div>

              {hasFlow && (
                <dl className="sankey-summary">
                  <div>
                    <dt>Inflows</dt>
                    <dd>{money(graph.inflowTotal)}</dd>
                  </div>
                  <div>
                    <dt>Outflows</dt>
                    <dd>{money(graph.outflowTotal)}</dd>
                  </div>
                  <div className={graph.shortfall > 0 ? "sankey-summary--short" : "sankey-summary--left"}>
                    <dt>{graph.shortfall > 0 ? "Shortfall" : "Left over"}</dt>
                    <dd>{balanced ? money(0) : money(graph.shortfall > 0 ? graph.shortfall : graph.leftover)}</dd>
                  </div>
                </dl>
              )}

              {check.status !== "none" && (
                <div className={`sankey-check sankey-check--${check.status}`} role="status">
                  {check.status === "ok" && (
                    <p>
                      <strong>Paychecks tie to the bank.</strong> Expected take-home {money(check.expectedNet)} (
                      {money(check.gross)} gross − {money(check.withheld)} withheld); deposits found{" "}
                      {money(check.deposits)}.
                    </p>
                  )}
                  {check.status === "mismatch" && (
                    <p>
                      <strong>Paychecks don't tie to the bank.</strong> Expected take-home {money(check.expectedNet)} (
                      {money(check.gross)} gross − {money(check.withheld)} withheld) but your paycheck rule found{" "}
                      {money(check.deposits)} — {money(Math.abs(check.difference))}{" "}
                      {check.difference < 0 ? "short" : "over"}. Check the year-to-date numbers or the rule.{" "}
                      <button type="button" className="sankey-link-btn" onClick={openDeposits}>
                        See deposits
                      </button>
                    </p>
                  )}
                  {check.status === "missing-rule" && (
                    <p>
                      <strong>Add a paycheck rule</strong> so your deposits can be checked against these paycheck
                      numbers (expected take-home {money(check.expectedNet)}).{" "}
                      <button type="button" className="sankey-link-btn" onClick={() => setManageTab("rules")}>
                        Add a rule
                      </button>
                    </p>
                  )}
                </div>
              )}

              {hasFlow ? (
                <SankeyChart graph={graph} onSelectNode={handleSelectNode} />
              ) : (
                <div className="sankey-placeholder">
                  {hasBuckets ? (
                    <p>Enter your {year} year-to-date paycheck numbers below, or import bank data, and the diagram will draw itself.</p>
                  ) : (
                    <>
                      <p>
                        Start by defining your buckets: an inflow such as Income, and outflows such as Taxes,
                        Investments and Spending.
                      </p>
                      <button type="button" className="sankey-button sankey-button--primary" onClick={() => setManageTab("buckets")}>
                        Set up buckets
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {hasBuckets && (
              <SankeyAmounts
                year={year}
                buckets={data.buckets}
                categories={flow.categories}
                sources={flow.sources}
                spendingBuckets={spendingBuckets}
                onChangeLine={handleChangeLine}
                onOpenCategory={openCategory}
                onManage={() => setManageTab("buckets")}
              />
            )}
          </div>
        )}
      </section>

      {drill && <SankeyDrill content={drill} year={year} onClose={() => setDrill(null)} />}

      {manageTab && (
        <SankeyManageModal
          initialTab={manageTab}
          onClose={() => setManageTab(null)}
          buckets={{
            buckets: data.buckets,
            categories: data.categories,
            spendingBuckets,
            onAddBucket: handleAddBucket,
            onChangeBucket: handleChangeBucket,
            onDeleteBucket: handleDeleteBucket,
            onReorderBuckets: handleReorderBuckets,
            onAddCategory: handleAddCategory,
            onChangeCategoryName: (id, name, shouldPersist) => changeCategory(id, { name }, shouldPersist),
            onChangeCategoryRole: (id, taxRole: TaxRole) => changeCategory(id, { taxRole }, true),
            onDeleteCategory: handleDeleteCategory,
            onReorderCategories: handleReorderCategories,
          }}
          rules={{
            rules: data.rules,
            buckets: data.buckets,
            onAddRule: handleAddRule,
            onChangeRule: handleChangeRule,
            onDeleteRule: handleDeleteRule,
          }}
        />
      )}
    </>
  );
}

export default SankeyPage;
