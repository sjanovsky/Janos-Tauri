import type { CSSProperties } from "react";
// The number fields reuse the Taxes page's number input (and its styles).
import NumberField from "../taxes/NumberField";
import "../taxes/taxes.css";
import { wholeCurrencyFormatter } from "../spending/lib/format";
import { bucketTotal, resolveCategory, type SankeyBucketRecord, type SankeyCategoryRecord, type SpendingBucketRef } from "./lib/sankey";
import type { CategorySource, SankeyLineRecord } from "./lib/flow";

export type LineChange = Partial<Pick<SankeyLineRecord, "ytd" | "lastPaycheck" | "paychecksLeft">>;

type SankeyAmountsProps = {
  year: number;
  buckets: SankeyBucketRecord[];
  // Categories with their amounts resolved for the year (see resolveFlow).
  categories: SankeyCategoryRecord[];
  sources: Map<string, CategorySource>;
  spendingBuckets: SpendingBucketRef[];
  onChangeLine: (categoryId: string, changes: LineChange, shouldPersist: boolean) => void;
  onOpenCategory: (categoryId: string) => void;
  onManage: () => void;
};

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

const money = (value: number) => wholeCurrencyFormatter.format(value);

// One card per bucket, inflows first. Paycheck lines are typed in here (year to date, your last
// paycheck, paychecks left) and are the same numbers the Taxes page reads; bank-derived lines
// (spending buckets, rules) are computed and open the transactions behind them.
function SankeyAmounts({
  year,
  buckets,
  categories,
  sources,
  spendingBuckets,
  onChangeLine,
  onOpenCategory,
  onManage,
}: SankeyAmountsProps) {
  const ordered = [
    ...buckets.filter((bucket) => bucket.direction === "inflow").sort(byPosition),
    ...buckets.filter((bucket) => bucket.direction === "outflow").sort(byPosition),
  ];

  return (
    <div className="sankey-amounts">
      {ordered.map((bucket) => {
        const members = categories.filter((category) => category.bucketId === bucket.id).sort(byPosition);
        const hasLines = members.some((category) => sources.get(category.id)?.kind === "line");
        return (
          <section className="sankey-card" key={bucket.id} style={{ "--bucket-color": bucket.color } as CSSProperties}>
            <header className="sankey-card__header">
              <span className="sankey-card__swatch" aria-hidden="true" />
              <div className="sankey-card__title">
                <h3>{bucket.name}</h3>
                <span className="sankey-card__direction">{bucket.direction === "inflow" ? "Inflow" : "Outflow"}</span>
              </div>
              <strong className="sankey-card__total">{money(bucketTotal(bucket.id, categories))}</strong>
            </header>

            {members.length === 0 ? (
              <p className="sankey-empty">
                No categories yet.{" "}
                <button type="button" className="sankey-link-btn" onClick={onManage}>
                  Add some
                </button>
              </p>
            ) : (
              <ul className="sankey-card__rows">
                {hasLines && (
                  <li className="sankey-line sankey-line--head" aria-hidden="true">
                    <span />
                    <span>{year} to date</span>
                    <span>Last paycheck</span>
                    <span>Paychecks left</span>
                  </li>
                )}
                {members.map((category) => {
                  const resolved = resolveCategory(category, bucket, spendingBuckets);
                  const source = sources.get(category.id);
                  const dot = <span className="sankey-card__dot" style={{ background: resolved.color }} aria-hidden="true" />;

                  if (source?.kind === "bank") {
                    return (
                      <li className="sankey-line sankey-line--bank" key={category.id}>
                        <span className="sankey-line__name">
                          {dot}
                          <span className="sankey-card__name">{resolved.name}</span>
                          <small>{source.rule ? "rule" : "bank"}</small>
                        </span>
                        <button
                          type="button"
                          className="sankey-line__amount"
                          title="See the transactions"
                          onClick={() => onOpenCategory(category.id)}
                        >
                          {money(category.amount)}
                        </button>
                        <span className="sankey-line__count">
                          {source.transactions.length} transaction{source.transactions.length === 1 ? "" : "s"}
                        </span>
                      </li>
                    );
                  }

                  const line = source?.line;
                  return (
                    <li className="sankey-line" key={category.id}>
                      <span className="sankey-line__name">
                        {dot}
                        <span className="sankey-card__name">{resolved.name}</span>
                      </span>
                      <NumberField
                        value={line?.ytd ?? 0}
                        ariaLabel={`${resolved.name} ${year} to date`}
                        onChange={(ytd) => onChangeLine(category.id, { ytd }, false)}
                        onCommit={(ytd) => onChangeLine(category.id, { ytd }, true)}
                      />
                      <NumberField
                        value={line?.lastPaycheck ?? 0}
                        ariaLabel={`${resolved.name} last paycheck`}
                        onChange={(lastPaycheck) => onChangeLine(category.id, { lastPaycheck }, false)}
                        onCommit={(lastPaycheck) => onChangeLine(category.id, { lastPaycheck }, true)}
                      />
                      <NumberField
                        value={line?.paychecksLeft ?? 0}
                        prefix=""
                        ariaLabel={`${resolved.name} paychecks left`}
                        onChange={(paychecksLeft) => onChangeLine(category.id, { paychecksLeft }, false)}
                        onCommit={(paychecksLeft) => onChangeLine(category.id, { paychecksLeft }, true)}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

export default SankeyAmounts;
