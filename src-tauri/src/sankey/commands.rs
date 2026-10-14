use super::models::{SankeyBucketRecord, SankeyCategoryRecord, SankeyData, SankeyLineRecord, SankeyRuleRecord};
use crate::db::DbState;
use rusqlite::{params, Connection};
use tauri::State;

#[tauri::command]
pub fn get_sankey_data(state: State<DbState>) -> Result<SankeyData, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    load(&conn).map_err(|e| e.to_string())
}

fn load(conn: &Connection) -> rusqlite::Result<SankeyData> {
    super::schema::sync_tax_lines(conn)?;
    let buckets = conn
        .prepare(
            "SELECT id, name, color, direction, position FROM sankey_buckets
             ORDER BY position, name COLLATE NOCASE",
        )?
        .query_map([], |row| {
            Ok(SankeyBucketRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                direction: row.get(3)?,
                position: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let categories = conn
        .prepare(
            "SELECT id, bucket_id, name, spending_bucket_id, amount, position, tax_role FROM sankey_categories
             ORDER BY position, name COLLATE NOCASE",
        )?
        .query_map([], |row| {
            Ok(SankeyCategoryRecord {
                id: row.get(0)?,
                bucket_id: row.get(1)?,
                name: row.get(2)?,
                spending_bucket_id: row.get(3)?,
                amount: row.get(4)?,
                position: row.get(5)?,
                tax_role: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let lines = conn
        .prepare(
            "SELECT sankey_category_id, year, ytd, last_paycheck, paychecks_left FROM taxes_items
             WHERE sankey_category_id IS NOT NULL ORDER BY year, position",
        )?
        .query_map([], |row| {
            Ok(SankeyLineRecord {
                category_id: row.get(0)?,
                year: row.get(1)?,
                ytd: row.get(2)?,
                last_paycheck: row.get(3)?,
                paychecks_left: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let rules = conn
        .prepare("SELECT id, name, pattern, kind, bucket_id, position FROM sankey_rules ORDER BY position")?
        .query_map([], |row| {
            Ok(SankeyRuleRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                pattern: row.get(2)?,
                kind: row.get(3)?,
                bucket_id: row.get(4)?,
                position: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let years = conn
        .prepare("SELECT year FROM taxes_years ORDER BY year")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<i64>, _>>()?;

    Ok(SankeyData { buckets, categories, lines, rules, years })
}

#[tauri::command]
pub fn upsert_sankey_bucket(
    state: State<DbState>,
    id: String,
    name: String,
    color: String,
    direction: String,
) -> Result<(), String> {
    if direction != "inflow" && direction != "outflow" {
        return Err(format!("unknown direction: {direction}"));
    }
    // New buckets land at the end of the order; editing leaves position alone.
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO sankey_buckets (id, name, color, direction, position)
         VALUES (?1, ?2, ?3, ?4, COALESCE((SELECT MAX(position) + 1 FROM sankey_buckets), 0))
         ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             color = excluded.color,
             direction = excluded.direction",
        params![id, name, color, direction],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_sankey_bucket_positions(state: State<DbState>, ids: Vec<String>) -> Result<(), String> {
    set_positions(&state, "sankey_buckets", &ids)
}

#[tauri::command]
pub fn delete_sankey_bucket(state: State<DbState>, id: String) -> Result<(), String> {
    // sankey_categories.bucket_id is ON DELETE CASCADE, so the bucket's categories go with it.
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sankey_buckets WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn upsert_sankey_category(
    state: State<DbState>,
    id: String,
    bucket_id: String,
    name: String,
    spending_bucket_id: Option<String>,
    tax_role: String,
) -> Result<(), String> {
    if !["income", "deduction", "withholding", "none"].contains(&tax_role.as_str()) {
        return Err(format!("unknown tax role: {tax_role}"));
    }
    // New categories land at the end of their bucket's list; editing leaves position alone.
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO sankey_categories (id, bucket_id, name, spending_bucket_id, tax_role, position)
         VALUES (?1, ?2, ?3, ?4, ?5,
                 COALESCE((SELECT MAX(position) + 1 FROM sankey_categories WHERE bucket_id = ?2), 0))
         ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             spending_bucket_id = excluded.spending_bucket_id,
             tax_role = excluded.tax_role",
        params![id, bucket_id, name, spending_bucket_id, tax_role],
    )
    .map_err(|e| e.to_string())?;
    // Keep the Taxes page's lines in step with the category's name and role.
    super::schema::sync_tax_lines(&conn).map_err(|e| e.to_string())?;
    Ok(())
}

/// Save one year's paycheck numbers for a category. These are the numbers the Taxes page also
/// reads, so they're entered once.
#[tauri::command]
pub fn set_paycheck_line(
    state: State<DbState>,
    category_id: String,
    year: i64,
    ytd: f64,
    last_paycheck: f64,
    paychecks_left: f64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT OR IGNORE INTO taxes_years (year) VALUES (?1)", params![year])
        .map_err(|e| e.to_string())?;
    super::schema::sync_tax_lines(&conn).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE taxes_items SET ytd = ?3, last_paycheck = ?4, paychecks_left = ?5
         WHERE year = ?1 AND sankey_category_id = ?2",
        params![year, category_id, ytd, last_paycheck, paychecks_left],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn upsert_sankey_rule(
    state: State<DbState>,
    id: String,
    name: String,
    pattern: String,
    kind: String,
    bucket_id: Option<String>,
) -> Result<(), String> {
    if kind != "paycheck" && kind != "bucket" {
        return Err(format!("unknown rule kind: {kind}"));
    }
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO sankey_rules (id, name, pattern, kind, bucket_id, position)
         VALUES (?1, ?2, ?3, ?4, ?5, COALESCE((SELECT MAX(position) + 1 FROM sankey_rules), 0))
         ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             pattern = excluded.pattern,
             kind = excluded.kind,
             bucket_id = excluded.bucket_id",
        params![id, name, pattern, kind, bucket_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_sankey_rule(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sankey_rules WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_sankey_category_positions(state: State<DbState>, ids: Vec<String>) -> Result<(), String> {
    set_positions(&state, "sankey_categories", &ids)
}

#[tauri::command]
pub fn delete_sankey_category(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sankey_categories WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Persist an ordering: each id's position becomes its index in `ids`. `table` is only ever one of
// this module's two literal table names.
fn set_positions(state: &State<DbState>, table: &str, ids: &[String]) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare(&format!("UPDATE {table} SET position = ?1 WHERE id = ?2"))
            .map_err(|e| e.to_string())?;
        for (index, id) in ids.iter().enumerate() {
            stmt.execute(params![index as i64, id])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
