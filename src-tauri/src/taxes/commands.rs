use super::models::{TaxHouseholdValueRecord, TaxItemRecord, TaxesData};
use crate::db::DbState;
use rusqlite::{params, Connection};
use tauri::State;

// Seeded into a brand-new year that has no earlier year to copy from: (section, name).
const DEFAULT_ITEMS: [(&str, &str); 9] = [
    ("income", "Paycheck"),
    ("income", "Interest"),
    ("income", "Dividends"),
    ("income", "Short-term capital gains"),
    ("income", "Gambling winnings"),
    ("income", "Crypto"),
    ("deduction", "401(k)"),
    ("deduction", "HSA"),
    ("withholding", "Federal tax withheld"),
];

#[tauri::command]
pub fn get_taxes_data(state: State<DbState>) -> Result<TaxesData, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    load(&conn).map_err(|e| e.to_string())
}

fn load(conn: &Connection) -> rusqlite::Result<TaxesData> {
    let years = conn
        .prepare("SELECT year FROM taxes_years ORDER BY year")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<i64>, _>>()?;

    let items = conn
        .prepare(
            "SELECT id, year, section, name, ytd, last_paycheck, paychecks_left, position
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
    // Create the year once. A new year starts with the line names (per section) of the most recent
    // earlier year, amounts reset to 0, or the defaults if there is none. Re-adding an existing
    // year is a no-op, so deleting lines in a year never re-seeds them.
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let inserted = tx
        .execute("INSERT OR IGNORE INTO taxes_years (year) VALUES (?1)", params![year])
        .map_err(|e| e.to_string())?;
    if inserted == 0 {
        return Ok(());
    }

    let previous_year: Option<i64> = tx
        .query_row(
            "SELECT MAX(year) FROM taxes_years WHERE year < ?1",
            params![year],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let lines: Vec<(String, String)> = match previous_year {
        Some(previous) => tx
            .prepare(
                "SELECT section, name FROM taxes_items WHERE year = ?1 ORDER BY section, position",
            )
            .map_err(|e| e.to_string())?
            .query_map(params![previous], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?,
        None => DEFAULT_ITEMS
            .iter()
            .map(|(section, name)| (section.to_string(), name.to_string()))
            .collect(),
    };

    // Position counts up within each section.
    let mut counts = std::collections::HashMap::<String, i64>::new();
    for (section, name) in lines {
        let position = counts.entry(section.clone()).or_insert(0);
        tx.execute(
            "INSERT INTO taxes_items (id, year, section, name, position) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![format!("seed-{}-{}-{}", year, section, position), year, section, name, *position],
        )
        .map_err(|e| e.to_string())?;
        *position += 1;
    }

    tx.commit().map_err(|e| e.to_string())?;
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
