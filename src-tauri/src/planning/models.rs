use serde::{Deserialize, Serialize};

/// One value the user typed on the Planning page. Values are stored as text so a field can hold
/// either a number or a percent (e.g. "5%"); the page parses them.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlanningSettingRecord {
    pub key: String,
    pub value: String,
}
