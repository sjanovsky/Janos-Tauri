use super::models::{
    PaycheckBucketRecord, PaycheckItemRecord, PaycheckRecord, PaycheckValueRecord, PaycheckVersionRecord,
    PaychecksData,
};
use crate::db::DbState;
use rusqlite::{params, Connection};
use tauri::State;

/// File the unclassified transactions of one upload whose description contains a paycheck's
/// deposit name under that paycheck (its id is the income category). Only the given upload is
/// touched, so transactions already in the app never change, and a transaction that already has
/// a category is left alone. Returns how many were classified.
pub fn apply_paycheck_names(conn: &Connection, upload_id: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE transactions
         SET category = (
             SELECT p.id FROM paychecks p
             WHERE trim(p.deposit_pattern) <> ''
               AND instr(lower(transactions.description), lower(trim(p.deposit_pattern))) > 0
             ORDER BY p.position, p.rowid LIMIT 1)
         WHERE upload_id = ?1
           AND category = 'unclassified'
           AND EXISTS (
             SELECT 1 FROM paychecks p
             WHERE trim(p.deposit_pattern) <> ''
               AND instr(lower(transactions.description), lower(trim(p.deposit_pattern))) > 0)",
        params![upload_id],
    )
}

#[tauri::command]
pub fn get_paychecks_data(state: State<DbState>) -> Result<PaychecksData, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    load(&conn).map_err(|e| e.to_string())
}

fn load(conn: &Connection) -> rusqlite::Result<PaychecksData> {
    let mut paychecks = conn
        .prepare(
            "SELECT p.id, p.name, p.deposit_pattern, COALESCE(c.color, '#4f46e5'), p.position
             FROM paychecks p LEFT JOIN categories c ON c.id = p.id
             ORDER BY p.position, p.rowid",
        )?
        .query_map([], |row| {
            Ok(PaycheckRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                deposit_pattern: row.get(2)?,
                color: row.get(3)?,
                position: row.get(4)?,
                versions: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let versions = conn
        .prepare(
            "SELECT paycheck_id, id, effective_from, effective_to, gross, transaction_id FROM paycheck_versions
             ORDER BY effective_from, rowid",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                PaycheckVersionRecord {
                    id: row.get(1)?,
                    effective_from: row.get(2)?,
                    effective_to: row.get(3)?,
                    gross: row.get(4)?,
                    transaction_id: row.get(5)?,
                    values: Vec::new(),
                },
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (paycheck_id, version) in versions {
        if let Some(paycheck) = paychecks.iter_mut().find(|p| p.id == paycheck_id) {
            paycheck.versions.push(version);
        }
    }

    let values = conn
        .prepare("SELECT version_id, item_id, amount FROM paycheck_version_values")?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                PaycheckValueRecord { item_id: row.get(1)?, amount: row.get(2)? },
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (version_id, value) in values {
        if let Some(version) = paychecks
            .iter_mut()
            .flat_map(|p| p.versions.iter_mut())
            .find(|v| v.id == version_id)
        {
            version.values.push(value);
        }
    }

    let buckets = conn
        .prepare("SELECT id, name, color, position FROM paycheck_buckets ORDER BY position, rowid")?
        .query_map([], |row| {
            Ok(PaycheckBucketRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                position: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let items = conn
        .prepare("SELECT id, label, bucket_id, position FROM paycheck_items ORDER BY position, rowid")?
        .query_map([], |row| {
            Ok(PaycheckItemRecord {
                id: row.get(0)?,
                label: row.get(1)?,
                bucket_id: row.get(2)?,
                position: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(PaychecksData { paychecks, buckets, items })
}

/// Create or update a paycheck, along with the income category of the same id that its deposits
/// are filed under (so renames and recolors show up on the Income chart and in category menus). A
/// new paycheck starts with one version, effective from the beginning.
#[tauri::command]
pub fn upsert_paycheck(
    state: State<DbState>,
    id: String,
    name: String,
    deposit_pattern: String,
    color: String,
) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO paychecks (id, name, deposit_pattern, position)
         VALUES (?1, ?2, ?3, COALESCE((SELECT MAX(position) + 1 FROM paychecks), 0))
         ON CONFLICT(id) DO UPDATE SET name = excluded.name,
                                       deposit_pattern = excluded.deposit_pattern",
        params![id, name, deposit_pattern],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO paycheck_versions (id, paycheck_id, effective_from, gross)
         SELECT ?2, ?1, '', 0 WHERE NOT EXISTS (SELECT 1 FROM paycheck_versions WHERE paycheck_id = ?1)",
        params![id, format!("v-{id}")],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO categories (id, label, color, excluded, bucket_id, position)
         VALUES (?1, ?2, ?3, 0, 'income', COALESCE((SELECT MAX(position) + 1 FROM categories WHERE bucket_id = 'income'), 0))
         ON CONFLICT(id) DO UPDATE SET label = excluded.label, color = excluded.color",
        params![id, name, color],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete a paycheck template. Its deposits go back to unclassified (like deleting a category).
#[tauri::command]
pub fn delete_paycheck(state: State<DbState>, id: String) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("UPDATE transactions SET category = 'unclassified' WHERE category = ?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM categories WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM paychecks WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Insert a version of a paycheck, starting from a copy of `copy_from` (another version of the
/// same paycheck). With a `transaction_id` the version is a one-off for that deposit only.
fn insert_version(
    conn: &Connection,
    id: &str,
    paycheck_id: &str,
    effective_from: &str,
    copy_from: Option<&str>,
    transaction_id: Option<&str>,
) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO paycheck_versions (id, paycheck_id, effective_from, gross, transaction_id)
         VALUES (?1, ?2, ?3,
                 COALESCE((SELECT gross FROM paycheck_versions WHERE id = ?4 AND paycheck_id = ?2), 0),
                 ?5)",
        params![id, paycheck_id, effective_from, copy_from, transaction_id],
    )?;
    if let Some(source) = copy_from {
        tx.execute(
            "INSERT INTO paycheck_version_values (version_id, item_id, amount)
             SELECT ?1, item_id, amount FROM paycheck_version_values
             WHERE version_id = ?2 AND EXISTS (SELECT 1 FROM paycheck_versions WHERE id = ?2 AND paycheck_id = ?3)",
            params![id, source, paycheck_id],
        )?;
    }
    tx.commit()
}

#[tauri::command]
pub fn add_paycheck_version(
    state: State<DbState>,
    id: String,
    paycheck_id: String,
    effective_from: String,
    copy_from: Option<String>,
    transaction_id: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    insert_version(
        &conn,
        &id,
        &paycheck_id,
        &effective_from,
        copy_from.as_deref(),
        transaction_id.as_deref(),
    )
    .map_err(|e| e.to_string())
}

/// Change a version's start date, end date and gross.
#[tauri::command]
pub fn update_paycheck_version(
    state: State<DbState>,
    id: String,
    effective_from: String,
    effective_to: String,
    gross: f64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE paycheck_versions SET effective_from = ?2, effective_to = ?3, gross = ?4 WHERE id = ?1",
        params![id, effective_from, effective_to, gross],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete a version unless it's the last dated one of its paycheck (its period would be left
/// with no numbers). Returns how many rows were removed.
fn remove_version(conn: &Connection, id: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM paycheck_versions
         WHERE id = ?1
           AND (transaction_id IS NOT NULL
                OR (SELECT COUNT(*) FROM paycheck_versions o
                    WHERE o.paycheck_id = paycheck_versions.paycheck_id AND o.transaction_id IS NULL) > 1)",
        params![id],
    )
}

#[tauri::command]
pub fn delete_paycheck_version(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    if remove_version(&conn, &id).map_err(|e| e.to_string())? == 0 {
        return Err("A paycheck needs at least one version.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn set_paycheck_value(
    state: State<DbState>,
    version_id: String,
    item_id: String,
    amount: f64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO paycheck_version_values (version_id, item_id, amount) VALUES (?1, ?2, ?3)
         ON CONFLICT(version_id, item_id) DO UPDATE SET amount = excluded.amount",
        params![version_id, item_id, amount],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn upsert_paycheck_bucket(
    state: State<DbState>,
    id: String,
    name: String,
    color: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO paycheck_buckets (id, name, color, position)
         VALUES (?1, ?2, ?3, COALESCE((SELECT MAX(position) + 1 FROM paycheck_buckets), 0))
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color",
        params![id, name, color],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete a bucket. Its line items are kept, ungrouped.
#[tauri::command]
pub fn delete_paycheck_bucket(state: State<DbState>, id: String) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("UPDATE paycheck_items SET bucket_id = NULL WHERE bucket_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM paycheck_buckets WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn upsert_paycheck_item(
    state: State<DbState>,
    id: String,
    label: String,
    bucket_id: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO paycheck_items (id, label, bucket_id, position)
         VALUES (?1, ?2, ?3, COALESCE((SELECT MAX(position) + 1 FROM paycheck_items), 0))
         ON CONFLICT(id) DO UPDATE SET label = excluded.label, bucket_id = excluded.bucket_id",
        params![id, label, bucket_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// One line item's place in the layout: its bucket (null = ungrouped), in display order.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaycheckItemPlacement {
    pub id: String,
    pub bucket_id: Option<String>,
}

/// Save the order of the buckets (earlier id = earlier position).
#[tauri::command]
pub fn set_paycheck_bucket_positions(state: State<DbState>, ids: Vec<String>) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (position, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE paycheck_buckets SET position = ?2 WHERE id = ?1",
            params![id, position as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Save every line item's bucket and order in one write (drag and drop can move an item across
/// buckets and shift its neighbors).
#[tauri::command]
pub fn set_paycheck_item_layout(
    state: State<DbState>,
    layout: Vec<PaycheckItemPlacement>,
) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (position, placement) in layout.iter().enumerate() {
        tx.execute(
            "UPDATE paycheck_items SET bucket_id = ?2, position = ?3 WHERE id = ?1",
            params![placement.id, placement.bucket_id, position as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_paycheck_item(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM paycheck_items WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::spending::schema::migrate(&conn).unwrap();
        super::super::schema::migrate(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO uploads (id, bank_name, file_name) VALUES ('u1', 'Bank', 'a.csv'), ('u2', 'Bank', 'b.csv');
             INSERT INTO transactions (id, upload_id, date, description, card_member, account_number,
                                       amount, source_bank, source_file_name, category) VALUES
               ('old', 'u1', '1/1/2026', 'ACME Payroll DIRECT DEP', '', '', -1000, 'Bank', 'a', 'unclassified'),
               ('new', 'u2', '1/15/2026', 'ACME PAYROLL', '', '', -1000, 'Bank', 'b', 'unclassified'),
               ('mine', 'u2', '1/16/2026', 'ACME PAYROLL', '', '', -900, 'Bank', 'b', 'groceries'),
               ('other', 'u2', '1/17/2026', 'COFFEE', '', '', 5, 'Bank', 'b', 'unclassified');
             INSERT INTO paychecks (id, name, deposit_pattern, position, gross)
               VALUES ('p1', 'Rachel Salary', ' acme payroll ', 0, 3000);",
        )
        .unwrap();
        conn
    }

    #[test]
    fn seeds_default_buckets_and_items() {
        let conn = setup();
        let data = load(&conn).unwrap();
        let names: Vec<_> = data.buckets.iter().map(|b| b.name.as_str()).collect();
        assert_eq!(names, vec!["Withholding", "Savings", "Taxes"]);
        let tax_items: Vec<_> = data
            .items
            .iter()
            .filter(|i| i.bucket_id.as_deref() == Some("tax"))
            .map(|i| i.label.as_str())
            .collect();
        assert_eq!(
            tax_items,
            vec![
                "Social Security",
                "Medicare",
                "Long Term Disability",
                "NYPFL",
                "NYSDI",
                "Medical Insurance",
                "Dental Insurance"
            ]
        );
    }

    #[test]
    fn files_only_the_new_upload_and_only_unclassified_rows() {
        let conn = setup();
        assert_eq!(apply_paycheck_names(&conn, "u2").unwrap(), 1);
        let category = |id: &str| -> String {
            conn.query_row("SELECT category FROM transactions WHERE id = ?1", [id], |r| r.get(0)).unwrap()
        };
        assert_eq!(category("new"), "p1");
        assert_eq!(category("old"), "unclassified");
        assert_eq!(category("mine"), "groceries");
        assert_eq!(category("other"), "unclassified");
    }

    #[test]
    fn migrates_old_lines_and_category_links() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::spending::schema::migrate(&conn).unwrap();
        // The previous shape: person + name, typed lines, and a category pointing at the paycheck.
        conn.execute_batch(
            "CREATE TABLE paychecks (id TEXT PRIMARY KEY, person TEXT NOT NULL, name TEXT NOT NULL,
                 deposit_pattern TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE paycheck_lines (id TEXT PRIMARY KEY, paycheck_id TEXT NOT NULL, name TEXT NOT NULL,
                 kind TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0);
             ALTER TABLE categories ADD COLUMN paycheck_id TEXT;
             INSERT INTO paychecks (id, person, name) VALUES ('p1', 'Rachel', 'Salary');
             INSERT INTO paycheck_lines (id, paycheck_id, name, kind, amount) VALUES
               ('l1', 'p1', 'Gross pay', 'earning', 3000),
               ('l2', 'p1', '401k', 'pretax', 300),
               ('l3', 'p1', 'Parking', 'posttax', 40),
               ('l4', 'p1', 'Match', 'employer', 150);
             INSERT INTO categories (id, label, color, bucket_id, paycheck_id)
               VALUES ('rachel-paycheck', 'Rachel Paycheck', '#123456', 'income', 'p1');
             INSERT INTO uploads (id, bank_name, file_name) VALUES ('u', 'Bank', 'f');
             INSERT INTO transactions (id, upload_id, date, description, card_member, account_number,
                                       amount, source_bank, source_file_name, category)
               VALUES ('t', 'u', '1/1/2026', 'x', '', '', -2000, 'Bank', 'f', 'rachel-paycheck');",
        )
        .unwrap();
        super::super::schema::migrate(&conn).unwrap();
        super::super::schema::migrate(&conn).unwrap(); // idempotent

        let data = load(&conn).unwrap();
        let p = &data.paychecks[0];
        assert_eq!(p.name, "Rachel Salary");
        assert_eq!(p.versions.len(), 1);
        assert_eq!(p.versions[0].gross, 3000.0);
        assert_eq!(p.versions[0].effective_from, "");
        assert_eq!(p.color, "#123456");
        let amount =
            |item: &str| p.versions[0].values.iter().find(|v| v.item_id == item).map(|v| v.amount);
        assert_eq!(amount("401k"), Some(300.0));
        assert_eq!(data.items.iter().filter(|i| i.label == "Parking").count(), 1);
        let category: String =
            conn.query_row("SELECT category FROM transactions WHERE id = 't'", [], |r| r.get(0)).unwrap();
        assert_eq!(category, "p1");
        let stand_in: i64 = conn
            .query_row("SELECT COUNT(*) FROM categories WHERE id = 'rachel-paycheck'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stand_in, 0);
    }

    #[test]
    fn versions_copy_values_from_their_own_paycheck_only() {
        let conn = setup();
        conn.execute_batch(
            "INSERT INTO paychecks (id, name, deposit_pattern, position, gross) VALUES ('p2', 'Other', '', 1, 10);",
        )
        .unwrap();
        super::super::schema::migrate(&conn).unwrap();
        conn.execute("INSERT INTO paycheck_version_values VALUES ('v-p1', '401k', 300)", []).unwrap();
        conn.execute("UPDATE paycheck_versions SET gross = 3000 WHERE id = 'v-p1'", []).unwrap();

        insert_version(&conn, "v2", "p1", "2026-03-01", Some("v-p1"), None).unwrap();
        insert_version(&conn, "once", "p1", "", Some("v2"), Some("new")).unwrap();
        // Another paycheck's version can't be copied from.
        insert_version(&conn, "stray", "p2", "2026-01-01", Some("v-p1"), None).unwrap();

        let data = load(&conn).unwrap();
        let versions = &data.paychecks[0].versions;
        assert_eq!(versions.len(), 3);
        let v2 = versions.iter().find(|v| v.id == "v2").unwrap();
        assert_eq!((v2.gross, v2.values.len()), (3000.0, 1));
        let once = versions.iter().find(|v| v.id == "once").unwrap();
        assert_eq!(once.transaction_id.as_deref(), Some("new"));
        let stray = data.paychecks[1].versions.iter().find(|v| v.id == "stray").unwrap();
        assert_eq!((stray.gross, stray.values.len()), (0.0, 0));
    }

    #[test]
    fn the_last_dated_version_cannot_be_deleted() {
        let conn = setup();
        super::super::schema::migrate(&conn).unwrap();
        insert_version(&conn, "once", "p1", "", None, Some("new")).unwrap();
        let delete = |id: &str| remove_version(&conn, id).unwrap();
        assert_eq!(delete("v-p1"), 0);
        assert_eq!(delete("once"), 1);
    }
}
