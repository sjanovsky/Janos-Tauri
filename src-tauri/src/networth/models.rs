use serde::{Deserialize, Serialize};

/// A net-worth bucket groups accounts (e.g. Retirement, Brokerage, Cash). Mirrors the spending
/// `BucketRecord`, but lives in its own table so the two features never share rows.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NetWorthBucketRecord {
    pub id: String,
    pub name: String,
    pub color: String,
    pub position: i64,
}

/// An account whose balance the user tracks over time. `bucket_id` is the bucket it displays
/// under (null = the "Ungrouped" tray). `position` orders accounts within their bucket.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NetWorthAccountRecord {
    pub id: String,
    pub name: String,
    pub bucket_id: Option<String>,
    pub position: i64,
}

/// A single manually-entered balance: the amount in `account_id` at the end of `month`
/// (a `YYYY-MM` string). Amounts may be negative to represent liabilities.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NetWorthBalanceRecord {
    pub account_id: String,
    pub month: String,
    pub amount: f64,
}
