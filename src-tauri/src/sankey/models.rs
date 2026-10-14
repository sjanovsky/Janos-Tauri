use serde::{Deserialize, Serialize};

/// A Sankey bucket: one node of the diagram's bucket column. `direction` is `"inflow"` (money
/// coming in, drawn on the left) or `"outflow"` (money going out, drawn on the right). Lives in
/// its own table; only its categories reference spending buckets.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SankeyBucketRecord {
    pub id: String,
    pub name: String,
    pub color: String,
    pub direction: String,
    pub position: i64,
}

/// A yearly dollar amount within a Sankey bucket. When `spending_bucket_id` is set, the category
/// stands for that spending bucket and displays its live name and color; `name` keeps the last
/// known label so the category survives the spending bucket being deleted.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SankeyCategoryRecord {
    pub id: String,
    pub bucket_id: String,
    pub name: String,
    pub spending_bucket_id: Option<String>,
    /// Legacy hand-typed yearly amount. No longer read: figures come from the year's paycheck
    /// lines (`SankeyLineRecord`) or the bank transactions.
    pub amount: f64,
    pub position: i64,
    /// How the Taxes page reads this line: `income`, pre-tax `deduction`, `withholding`, `none`.
    pub tax_role: String,
}

/// One year's paycheck numbers for a category: year to date, the most recent paycheck, and how
/// many paychecks remain (the Taxes page projects year-end from these).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SankeyLineRecord {
    pub category_id: String,
    pub year: i64,
    pub ytd: f64,
    pub last_paycheck: f64,
    pub paychecks_left: f64,
}

/// A description rule. A transaction whose description contains `pattern` (ignoring case) is
/// either a paycheck deposit (`kind = "paycheck"`) or counts toward a Sankey bucket
/// (`kind = "bucket"`, e.g. brokerage transfers into Investments).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SankeyRuleRecord {
    pub id: String,
    pub name: String,
    pub pattern: String,
    pub kind: String,
    pub bucket_id: Option<String>,
    pub position: i64,
}

/// Everything the Sankey page needs, loaded in one call.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SankeyData {
    pub buckets: Vec<SankeyBucketRecord>,
    pub categories: Vec<SankeyCategoryRecord>,
    pub lines: Vec<SankeyLineRecord>,
    pub rules: Vec<SankeyRuleRecord>,
    /// Years that have paycheck numbers or tax data (the Taxes page's years).
    pub years: Vec<i64>,
}
