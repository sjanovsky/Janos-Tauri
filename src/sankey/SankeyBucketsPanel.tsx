import { useState } from "react";
import ReorderList from "./ReorderList";
import {
  resolveCategory,
  type SankeyBucketRecord,
  type SankeyCategoryRecord,
  type SankeyDirection,
  type SpendingBucketRef,
  type TaxRole,
} from "./lib/sankey";

type SankeyBucketsPanelProps = {
  buckets: SankeyBucketRecord[];
  categories: SankeyCategoryRecord[];
  spendingBuckets: SpendingBucketRef[];
  onAddBucket: (direction: SankeyDirection) => void;
  onChangeBucket: (
    id: string,
    changes: Partial<Pick<SankeyBucketRecord, "name" | "color" | "direction">>,
    shouldPersist: boolean,
  ) => void;
  onDeleteBucket: (id: string) => void;
  // Reorder one direction's buckets to the given id order.
  onReorderBuckets: (direction: SankeyDirection, orderedIds: string[]) => void;
  // Add a free-form category (spendingBucketId null) or one linked to a spending bucket.
  onAddCategory: (bucketId: string, spendingBucketId: string | null) => void;
  onChangeCategoryName: (id: string, name: string, shouldPersist: boolean) => void;
  onChangeCategoryRole: (id: string, taxRole: TaxRole) => void;
  onDeleteCategory: (id: string) => void;
  onReorderCategories: (bucketId: string, orderedIds: string[]) => void;
};

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

const SECTIONS: { direction: SankeyDirection; title: string; blurb: string; addLabel: string }[] = [
  {
    direction: "inflow",
    title: "Inflows",
    blurb: "Where money comes from. Drawn on the left of the diagram.",
    addLabel: "+ Add inflow bucket",
  },
  {
    direction: "outflow",
    title: "Outflows",
    blurb: "Where money goes: taxes, investments, expenses. Drawn on the right.",
    addLabel: "+ Add outflow bucket",
  },
];

// The structure editor: the buckets (each an inflow or an outflow) and the categories inside them.
// Categories are paycheck lines (you enter their year-to-date numbers on the overview, and the Taxes
// page reads them according to the line's tax role), or linked to one of the spending page's
// buckets so an "Expenses" bucket breaks down by how you actually categorize spending. Spending
// buckets you don't link still appear on the diagram on their own. Drag a grip to reorder.
function SankeyBucketsPanel({
  buckets,
  categories,
  spendingBuckets,
  onAddBucket,
  onChangeBucket,
  onDeleteBucket,
  onReorderBuckets,
  onAddCategory,
  onChangeCategoryName,
  onChangeCategoryRole,
  onDeleteCategory,
  onReorderCategories,
}: SankeyBucketsPanelProps) {
  // The bucket awaiting delete confirmation (native confirm doesn't work in the macOS webview).
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  return (
    <div className="sankey-manage">
      {SECTIONS.map((section) => {
        const sectionBuckets = buckets.filter((bucket) => bucket.direction === section.direction).sort(byPosition);
        return (
          <section className="sankey-manage__section" key={section.direction}>
            <div className="sankey-manage__section-head">
              <div>
                <h3>{section.title}</h3>
                <p>{section.blurb}</p>
              </div>
              <button type="button" className="sankey-button" onClick={() => onAddBucket(section.direction)}>
                {section.addLabel}
              </button>
            </div>

            {sectionBuckets.length === 0 && <p className="sankey-empty">No {section.title.toLowerCase()} yet.</p>}

            <ReorderList
              className="sankey-manage__buckets"
              items={sectionBuckets}
              onReorder={(ids) => onReorderBuckets(section.direction, ids)}
              renderItem={(bucket, grip) => {
                const members = categories.filter((category) => category.bucketId === bucket.id).sort(byPosition);
                const linkedIds = new Set(members.map((member) => member.spendingBucketId).filter(Boolean));
                const linkable = spendingBuckets.filter((spending) => !linkedIds.has(spending.id));
                return (
                  <div className="sankey-bucket">
                    <div className="sankey-bucket__head">
                      {grip}
                      <input
                        type="color"
                        className="sankey-bucket__color"
                        aria-label={`${bucket.name} color`}
                        value={bucket.color}
                        onChange={(event) => onChangeBucket(bucket.id, { color: event.target.value }, false)}
                        onBlur={(event) => onChangeBucket(bucket.id, { color: event.target.value }, true)}
                      />
                      <input
                        className="sankey-bucket__name"
                        aria-label="Bucket name"
                        value={bucket.name}
                        placeholder="Bucket name"
                        onChange={(event) => onChangeBucket(bucket.id, { name: event.target.value }, false)}
                        onBlur={(event) => onChangeBucket(bucket.id, { name: event.target.value }, true)}
                      />
                      <select
                        className="sankey-bucket__direction"
                        aria-label={`${bucket.name} direction`}
                        value={bucket.direction}
                        onChange={(event) =>
                          onChangeBucket(bucket.id, { direction: event.target.value as SankeyDirection }, true)
                        }
                      >
                        <option value="inflow">Inflow</option>
                        <option value="outflow">Outflow</option>
                      </select>
                      {pendingDelete === bucket.id ? (
                        <span className="sankey-confirm">
                          Delete{members.length > 0 ? ` with ${members.length} categor${members.length === 1 ? "y" : "ies"}` : ""}?
                          <button
                            type="button"
                            className="sankey-button sankey-button--danger"
                            onClick={() => {
                              setPendingDelete(null);
                              onDeleteBucket(bucket.id);
                            }}
                          >
                            Delete
                          </button>
                          <button type="button" className="sankey-button" onClick={() => setPendingDelete(null)}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="sankey-icon-btn"
                          aria-label={`Delete ${bucket.name}`}
                          title="Delete bucket"
                          onClick={() => setPendingDelete(bucket.id)}
                        >
                          ×
                        </button>
                      )}
                    </div>

                    <ReorderList
                      className="sankey-bucket__categories"
                      items={members}
                      onReorder={(ids) => onReorderCategories(bucket.id, ids)}
                      renderItem={(category, categoryGrip) => {
                        const resolved = resolveCategory(category, bucket, spendingBuckets);
                        const linked = category.spendingBucketId !== null && spendingBuckets.some((s) => s.id === category.spendingBucketId);
                        return (
                          <div className="sankey-category">
                            {categoryGrip}
                            <span className="sankey-card__dot" style={{ background: resolved.color }} aria-hidden="true" />
                            {linked ? (
                              <span className="sankey-category__linked" title="Linked to a spending bucket">
                                {resolved.name}
                                <small>spending bucket</small>
                              </span>
                            ) : (
                              <input
                                className="sankey-category__name"
                                aria-label="Category name"
                                value={category.name}
                                placeholder="Category name"
                                onChange={(event) => onChangeCategoryName(category.id, event.target.value, false)}
                                onBlur={(event) => onChangeCategoryName(category.id, event.target.value, true)}
                              />
                            )}
                            {!linked && (
                              <select
                                className="sankey-category__role"
                                aria-label={`${resolved.name} on the Taxes page`}
                                title="How the Taxes page uses this line"
                                value={category.taxRole}
                                onChange={(event) => onChangeCategoryRole(category.id, event.target.value as TaxRole)}
                              >
                                <option value="none">Not used for taxes</option>
                                <option value="income">Taxable income</option>
                                <option value="deduction">Pre-tax deduction</option>
                                <option value="withholding">Federal withholding</option>
                              </select>
                            )}
                            <button
                              type="button"
                              className="sankey-icon-btn"
                              aria-label={`Delete ${resolved.name}`}
                              title="Delete category"
                              onClick={() => onDeleteCategory(category.id)}
                            >
                              ×
                            </button>
                          </div>
                        );
                      }}
                    />

                    <div className="sankey-bucket__add">
                      <button type="button" className="sankey-link-btn" onClick={() => onAddCategory(bucket.id, null)}>
                        + Add category
                      </button>
                      {linkable.length > 0 && (
                        <select
                          className="sankey-bucket__link"
                          aria-label={`Add a spending bucket to ${bucket.name}`}
                          value=""
                          onChange={(event) => {
                            if (event.target.value) {
                              onAddCategory(bucket.id, event.target.value);
                            }
                          }}
                        >
                          <option value="">+ Link a spending bucket…</option>
                          {linkable.map((spending) => (
                            <option key={spending.id} value={spending.id}>
                              {spending.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                );
              }}
            />
          </section>
        );
      })}
    </div>
  );
}

export default SankeyBucketsPanel;
