use rusqlite::params;
use tauri::State;

use super::models::{CashflowData, CashflowGroup, CashflowMember};
use crate::db::DbState;

#[tauri::command]
pub fn get_cashflow_data(state: State<DbState>) -> Result<CashflowData, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let groups = conn
        .prepare("SELECT id, name, color, position FROM cashflow_groups ORDER BY position, name")
        .map_err(|e| e.to_string())?
        .query_map([], |row| {
            Ok(CashflowGroup {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                position: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let members = conn
        .prepare("SELECT item_key, group_id FROM cashflow_members")
        .map_err(|e| e.to_string())?
        .query_map([], |row| {
            Ok(CashflowMember { item_key: row.get(0)?, group_id: row.get(1)? })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(CashflowData { groups, members })
}

/// Recolor one of the two fixed groups.
#[tauri::command]
pub fn set_cashflow_group_color(state: State<DbState>, id: String, color: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE cashflow_groups SET color = ?2 WHERE id = ?1", params![id, color])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Put a bucket (or the Leftover line) in a group; an empty `group_id` puts it in Ungrouped.
#[tauri::command]
pub fn set_cashflow_member(
    state: State<DbState>,
    item_key: String,
    group_id: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO cashflow_members (item_key, group_id) VALUES (?1, ?2)
         ON CONFLICT(item_key) DO UPDATE SET group_id = excluded.group_id",
        params![item_key, group_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
