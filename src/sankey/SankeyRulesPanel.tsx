import type { SankeyBucketRecord } from "./lib/sankey";
import type { SankeyRuleKind, SankeyRuleRecord } from "./lib/flow";

type SankeyRulesPanelProps = {
  rules: SankeyRuleRecord[];
  buckets: SankeyBucketRecord[];
  onAddRule: (kind: SankeyRuleKind) => void;
  onChangeRule: (id: string, changes: Partial<Pick<SankeyRuleRecord, "name" | "pattern" | "kind" | "bucketId">>, shouldPersist: boolean) => void;
  onDeleteRule: (id: string) => void;
};

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

// Rules identify bank transactions by their description. A paycheck rule finds your net-pay
// deposits so they can be checked against the paycheck numbers you entered; a bucket rule counts
// matching transactions toward a Sankey bucket (brokerage transfers into Investments, say) instead
// of letting them fall under spending. The first matching rule wins, in the order listed here.
function SankeyRulesPanel({ rules, buckets, onAddRule, onChangeRule, onDeleteRule }: SankeyRulesPanelProps) {
  const ordered = [...rules].sort(byPosition);
  const bucketsInOrder = [...buckets].sort(byPosition);

  return (
    <div className="sankey-manage">
      <section className="sankey-manage__section">
        <div className="sankey-manage__section-head">
          <div>
            <h3>Description rules</h3>
            <p>
              A transaction matches a rule when its description contains the text, ignoring case. Rules are checked
              top to bottom, before the spending page's categories.
            </p>
          </div>
          <span className="sankey-rules__add">
            <button type="button" className="sankey-button" onClick={() => onAddRule("paycheck")}>
              + Paycheck rule
            </button>
            <button type="button" className="sankey-button" onClick={() => onAddRule("bucket")}>
              + Bucket rule
            </button>
          </span>
        </div>

        {ordered.length === 0 && (
          <p className="sankey-empty">
            No rules yet. Add a paycheck rule with a bit of your payroll deposit's description (for example your
            employer's name) to check your paychecks against the bank.
          </p>
        )}

        <ul className="sankey-rules">
          {ordered.map((rule) => (
            <li className="sankey-rule" key={rule.id}>
              <span className="sankey-rule__text">
                <label>
                  <span>Description contains</span>
                  <input
                    value={rule.pattern}
                    placeholder={rule.kind === "paycheck" ? "e.g. ACME PAYROLL" : "e.g. FIDELITY"}
                    onChange={(event) => onChangeRule(rule.id, { pattern: event.target.value }, false)}
                    onBlur={(event) => onChangeRule(rule.id, { pattern: event.target.value }, true)}
                  />
                </label>
              </span>
              {rule.kind === "paycheck" ? (
                <span className="sankey-rule__target sankey-rule__target--paycheck">
                  Paycheck deposit
                  <small>checked against your paychecks, not counted as income</small>
                </span>
              ) : (
                <>
                  <label className="sankey-rule__field">
                    <span>Counts toward</span>
                    <select
                      value={rule.bucketId ?? ""}
                      onChange={(event) => onChangeRule(rule.id, { bucketId: event.target.value || null }, true)}
                    >
                      <option value="">Choose a bucket…</option>
                      {bucketsInOrder.map((bucket) => (
                        <option key={bucket.id} value={bucket.id}>
                          {bucket.name} ({bucket.direction})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="sankey-rule__field">
                    <span>Shown as</span>
                    <input
                      value={rule.name}
                      placeholder="e.g. Brokerage"
                      onChange={(event) => onChangeRule(rule.id, { name: event.target.value }, false)}
                      onBlur={(event) => onChangeRule(rule.id, { name: event.target.value }, true)}
                    />
                  </label>
                </>
              )}
              <button
                type="button"
                className="sankey-icon-btn"
                aria-label="Delete rule"
                title="Delete rule"
                onClick={() => onDeleteRule(rule.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default SankeyRulesPanel;
