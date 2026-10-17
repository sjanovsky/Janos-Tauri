use serde::{Deserialize, Serialize};

/// A top-level Cash Flow group (Taxes, Savings, Spending, ...) that buckets are dragged into.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CashflowGroup {
    pub id: String,
    pub name: String,
    pub color: String,
    pub position: i64,
}

/// Where one bucket (or the Leftover line) was put. `item_key` names it ("spending:<id>",
/// "paycheck:<id>" or "leftover"); an empty `group_id` means it was put in Ungrouped on purpose.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CashflowMember {
    pub item_key: String,
    pub group_id: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CashflowData {
    pub groups: Vec<CashflowGroup>,
    pub members: Vec<CashflowMember>,
}
