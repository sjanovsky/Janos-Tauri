use serde::{Deserialize, Serialize};

/// What a paycheck version holds for one line item.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PaycheckValueRecord {
    pub item_id: String,
    pub amount: f64,
}

/// One version of a paycheck: its gross and line-item amounts as they were from `effective_from`
/// to `effective_to` (ISO dates; empty means from the beginning / still going). Where versions
/// overlap, the one that started latest wins. A version with a
/// `transaction_id` is a one-off that applies to that single deposit only.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PaycheckVersionRecord {
    pub id: String,
    pub effective_from: String,
    pub effective_to: String,
    pub gross: f64,
    pub transaction_id: Option<String>,
    pub values: Vec<PaycheckValueRecord>,
}

/// A paycheck (e.g. "Rachel Salary", "Stephen Commission"). `id` is also the id of the income
/// category its deposits are filed under. Unclassified deposits whose description contains
/// `deposit_pattern` are filed there when they are uploaded. Its numbers live in `versions`.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PaycheckRecord {
    pub id: String,
    pub name: String,
    pub deposit_pattern: String,
    pub color: String,
    pub position: i64,
    pub versions: Vec<PaycheckVersionRecord>,
}

/// A group of paycheck line items (Withholding, Savings, Tax, ...), shared by all paychecks.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PaycheckBucketRecord {
    pub id: String,
    pub name: String,
    pub color: String,
    pub position: i64,
}

/// A line item (Federal Withholding, 401K, ...) in a bucket. A null bucket means ungrouped.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PaycheckItemRecord {
    pub id: String,
    pub label: String,
    pub bucket_id: Option<String>,
    pub position: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PaychecksData {
    pub paychecks: Vec<PaycheckRecord>,
    pub buckets: Vec<PaycheckBucketRecord>,
    pub items: Vec<PaycheckItemRecord>,
}
