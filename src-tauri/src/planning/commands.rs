use super::models::PlanningSettingRecord;
use crate::db::DbState;
use rusqlite::{params, Connection};
use tauri::State;

fn load(conn: &Connection) -> rusqlite::Result<Vec<PlanningSettingRecord>> {
    conn.prepare("SELECT key, value FROM planning_settings ORDER BY key")?
        .query_map([], |row| Ok(PlanningSettingRecord { key: row.get(0)?, value: row.get(1)? }))?
        .collect()
}

#[tauri::command]
pub fn get_planning_settings(state: State<DbState>) -> Result<Vec<PlanningSettingRecord>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    load(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_planning_setting(state: State<DbState>, key: String, value: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO planning_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Remove a setting, so the field goes back to the value pulled from the other pages.
#[tauri::command]
pub fn delete_planning_setting(state: State<DbState>, key: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM planning_settings WHERE key = ?1", params![key])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_round_trip() {
        let conn = Connection::open_in_memory().unwrap();
        super::super::schema::migrate(&conn).unwrap();
        conn.execute("INSERT INTO planning_settings (key, value) VALUES ('taxes', '1000')", []).unwrap();
        conn.execute("UPDATE planning_settings SET value = '5%' WHERE key = 'taxes'", []).unwrap();
        let all = load(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].value, "5%");
    }
}
