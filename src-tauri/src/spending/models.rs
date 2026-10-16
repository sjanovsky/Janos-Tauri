use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransactionRecord {
    pub id: String,
    pub date: String,
    pub description: String,
    pub card_member: String,
    pub account_number: String,
    pub amount: f64,
    pub source_bank: String,
    pub source_file_name: String,
    pub category: String,
    /// True while the category was chosen by import auto-classification and hasn't been
    /// reviewed (confirmed or changed) by the user.
    #[serde(default)]
    pub auto_categorized: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UploadRecord {
    pub id: String,
    pub bank_name: String,
    pub file_name: String,
    pub imported_at: String,
    pub transactions: Vec<TransactionRecord>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CategoryRecord {
    pub id: String,
    pub label: String,
    pub color: String,
    pub excluded: bool,
    pub bucket_id: Option<String>,
    pub position: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BucketRecord {
    pub id: String,
    pub name: String,
    pub color: String,
    pub position: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankRecord {
    pub id: String,
    pub name: String,
    pub logo_data_url: Option<String>,
    /// True when this bank's statements list money going out as a positive amount (credit
    /// cards); false when deposits are the positive side (many checking exports).
    pub spending_positive: bool,
}
