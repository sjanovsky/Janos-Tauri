use serde::{Deserialize, Serialize};

/// One household-level number for a tax year (e.g. `qualifiedOwed`).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaxHouseholdValueRecord {
    pub year: i64,
    pub field: String,
    pub value: f64,
}

/// A user-defined line in one of the three projected sections of a tax year: `income`
/// (paychecks, interest, ...), `deduction` (401(k), HSA, ...) or `withholding`. Projected
/// year-end is `ytd + last_paycheck * paychecks_left`, computed by the frontend; a one-off amount
/// is just a `ytd` with nothing left to come.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaxItemRecord {
    pub id: String,
    pub year: i64,
    pub section: String,
    pub name: String,
    pub ytd: f64,
    pub last_paycheck: f64,
    pub paychecks_left: f64,
    pub position: i64,
    /// The Sankey category this line belongs to. Lines are created and named on the Sankey page.
    pub sankey_category_id: Option<String>,
}

/// Everything the Taxes page needs, loaded in one call.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaxesData {
    pub years: Vec<i64>,
    pub items: Vec<TaxItemRecord>,
    pub household_values: Vec<TaxHouseholdValueRecord>,
}
