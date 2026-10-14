use super::models::{TaxHouseholdValueRecord, TaxItemRecord, TaxesData};
use crate::db::DbState;
use rusqlite::{params, Connection};
use tauri::State;

#[tauri::command]
pub fn get_taxes_data(state: State<DbState>) -> Result<TaxesData, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    load(&conn).map_err(|e| e.to_string())
}

fn load(conn: &Connection) -> rusqlite::Result<TaxesData> {
    // Income, deduction and withholding lines are the Sankey's categories; make sure every year
    // has one for each before reading.
    crate::sankey::schema::sync_tax_lines(conn)?;
    let years = conn
        .prepare("SELECT year FROM taxes_years ORDER BY year")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<i64>, _>>()?;

    let items = conn
        .prepare(
            "SELECT id, year, section, name, ytd, last_paycheck, paychecks_left, position,
                    sankey_category_id
             FROM taxes_items ORDER BY year, section, position",
        )?
        .query_map([], |row| {
            Ok(TaxItemRecord {
                id: row.get(0)?,
                year: row.get(1)?,
                section: row.get(2)?,
                name: row.get(3)?,
                ytd: row.get(4)?,
                last_paycheck: row.get(5)?,
                paychecks_left: row.get(6)?,
                position: row.get(7)?,
                sankey_category_id: row.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let household_values = conn
        .prepare("SELECT year, field, value FROM taxes_household_values")?
        .query_map([], |row| {
            Ok(TaxHouseholdValueRecord {
                year: row.get(0)?,
                field: row.get(1)?,
                value: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(TaxesData {
        years,
        items,
        household_values,
    })
}

#[tauri::command]
pub fn add_taxes_year(state: State<DbState>, year: i64) -> Result<(), String> {
    // A year's lines are the Sankey's categories, created on demand by the sync, so adding a year
    // is just recording it. Re-adding an existing year is a no-op.
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT OR IGNORE INTO taxes_years (year) VALUES (?1)", params![year])
        .map_err(|e| e.to_string())?;
    crate::sankey::schema::sync_tax_lines(&conn).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_taxes_year(state: State<DbState>, year: i64) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for sql in [
        "DELETE FROM taxes_items WHERE year = ?1",
        "DELETE FROM taxes_household_values WHERE year = ?1",
        "DELETE FROM taxes_years WHERE year = ?1",
    ] {
        tx.execute(sql, params![year]).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_taxes_household_value(
    state: State<DbState>,
    year: i64,
    field: String,
    value: f64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO taxes_household_values (year, field, value) VALUES (?1, ?2, ?3)
         ON CONFLICT(year, field) DO UPDATE SET value = excluded.value",
        params![year, field, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn upsert_taxes_item(
    state: State<DbState>,
    id: String,
    year: i64,
    section: String,
    name: String,
    ytd: f64,
    last_paycheck: f64,
    paychecks_left: f64,
) -> Result<(), String> {
    // New lines land at the end of their section's list; editing leaves position alone.
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO taxes_items (id, year, section, name, ytd, last_paycheck, paychecks_left, position)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7,
                 COALESCE((SELECT MAX(position) + 1 FROM taxes_items
                           WHERE year = ?2 AND section = ?3), 0))
         ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             ytd = excluded.ytd,
             last_paycheck = excluded.last_paycheck,
             paychecks_left = excluded.paychecks_left",
        params![id, year, section, name, ytd, last_paycheck, paychecks_left],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_taxes_item(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM taxes_items WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
