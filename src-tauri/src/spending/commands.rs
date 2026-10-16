use super::models::{BankRecord, BucketRecord, CategoryRecord, TransactionRecord, UploadRecord};
use crate::db::DbState;
use rusqlite::{params, Connection};
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub fn list_uploads(state: State<DbState>) -> Result<Vec<UploadRecord>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let mut upload_stmt = conn
        .prepare("SELECT id, bank_name, file_name, imported_at FROM uploads ORDER BY imported_at DESC")
        .map_err(|e| e.to_string())?;

    let uploads: Vec<(String, String, String, String)> = upload_stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    let mut tx_stmt = conn
        .prepare(
            "SELECT id, date, description, card_member, account_number, amount, source_bank, source_file_name, category, auto_categorized
             FROM transactions WHERE upload_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let mut result = Vec::with_capacity(uploads.len());
    for (id, bank_name, file_name, imported_at) in uploads {
        let transactions = tx_stmt
            .query_map(params![id], |row| {
                Ok(TransactionRecord {
                    id: row.get(0)?,
                    date: row.get(1)?,
                    description: row.get(2)?,
                    card_member: row.get(3)?,
                    account_number: row.get(4)?,
                    amount: row.get(5)?,
                    source_bank: row.get(6)?,
                    source_file_name: row.get(7)?,
                    category: row.get(8)?,
                    auto_categorized: row.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;

        result.push(UploadRecord {
            id,
            bank_name,
            file_name,
            imported_at,
            transactions,
        });
    }

    Ok(result)
}

#[tauri::command]
pub fn add_upload(
    state: State<DbState>,
    id: String,
    bank_name: String,
    file_name: String,
    transactions: Vec<TransactionRecord>,
) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO uploads (id, bank_name, file_name) VALUES (?1, ?2, ?3)",
        params![id, bank_name, file_name],
    )
    .map_err(|e| e.to_string())?;

    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO transactions
                 (id, upload_id, date, description, card_member, account_number, amount, source_bank, source_file_name, category)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            )
            .map_err(|e| e.to_string())?;

        for transaction in &transactions {
            stmt.execute(params![
                transaction.id,
                id,
                transaction.date,
                transaction.description,
                transaction.card_member,
                transaction.account_number,
                transaction.amount,
                transaction.source_bank,
                transaction.source_file_name,
                transaction.category,
            ])
            .map_err(|e| e.to_string())?;
        }
    }

    // Paycheck deposit names classify the new rows right away, so paychecks are filed on import.
    // Only unclassified rows are touched, and only at upload time: nothing already stored changes.
    crate::income::commands::apply_paycheck_names(&tx, &id).map_err(|e| e.to_string())?;

    // Whatever is still unclassified is matched to earlier transactions by description and takes
    // the category of the most recent one. These rows are flagged so the user can review them.
    apply_previous_categories(&tx, &id).map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Sortable key for a stored "M/D/YY" or "M/D/YYYY" date; unparseable dates sort oldest.
fn date_sort_key(date: &str) -> i64 {
    let mut parts = date.trim().split('/').map(|part| part.trim().parse::<i64>());
    match (parts.next(), parts.next(), parts.next()) {
        (Some(Ok(month)), Some(Ok(day)), Some(Ok(year))) => {
            let year = if year < 100 { 2000 + year } else { year };
            year * 10_000 + month * 100 + day
        }
        _ => i64::MIN,
    }
}

/// Case- and whitespace-insensitive form of a description, used as the match key.
fn description_key(description: &str) -> String {
    description
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Categorize the still-unclassified transactions of one upload from earlier transactions with
/// the same description: each takes the category of the most recent (by transaction date)
/// categorized match in any other upload. Matched rows are flagged `auto_categorized` for
/// review. Rows with no match stay unclassified. Returns how many were categorized.
pub fn apply_previous_categories(conn: &Connection, upload_id: &str) -> rusqlite::Result<usize> {
    let mut latest: HashMap<String, (i64, String)> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT description, date, category FROM transactions
             WHERE upload_id <> ?1 AND category <> 'unclassified'
             ORDER BY rowid",
        )?;
        let rows = stmt.query_map(params![upload_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        })?;
        for row in rows {
            let (description, date, category) = row?;
            let key = date_sort_key(&date);
            let entry = latest.entry(description_key(&description));
            entry
                .and_modify(|current| {
                    // >= so a later-imported row wins a same-day tie.
                    if key >= current.0 {
                        *current = (key, category.clone());
                    }
                })
                .or_insert((key, category));
        }
    }

    let pending: Vec<(String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, description FROM transactions
             WHERE upload_id = ?1 AND category = 'unclassified'",
        )?;
        let rows = stmt.query_map(params![upload_id], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect::<Result<_, _>>()?
    };

    let mut update =
        conn.prepare("UPDATE transactions SET category = ?1, auto_categorized = 1 WHERE id = ?2")?;
    let mut applied = 0;
    for (id, description) in pending {
        if let Some((_, category)) = latest.get(&description_key(&description)) {
            update.execute(params![category, id])?;
            applied += 1;
        }
    }
    Ok(applied)
}

/// The user has reviewed these auto-categorized transactions; stop highlighting them.
#[tauri::command]
pub fn confirm_auto_categorized(
    state: State<DbState>,
    transaction_ids: Vec<String>,
) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare("UPDATE transactions SET auto_categorized = 0 WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        for id in &transaction_ids {
            stmt.execute(params![id]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_upload(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM uploads WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn rename_upload(state: State<DbState>, id: String, file_name: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE uploads SET file_name = ?1 WHERE id = ?2",
        params![file_name, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_transaction_category(
    state: State<DbState>,
    transaction_id: String,
    category: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE transactions SET category = ?1, auto_categorized = 0 WHERE id = ?2",
        params![category, transaction_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_transaction_categories(
    state: State<DbState>,
    transaction_ids: Vec<String>,
    category: String,
) -> Result<(), String> {
    // Apply one category to many transactions in a single transaction so a partial failure
    // doesn't leave the batch half-applied.
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare("UPDATE transactions SET category = ?1, auto_categorized = 0 WHERE id = ?2")
            .map_err(|e| e.to_string())?;
        for id in &transaction_ids {
            stmt.execute(params![category, id])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_categories(state: State<DbState>) -> Result<Vec<CategoryRecord>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, label, color, excluded, bucket_id, position FROM categories
             ORDER BY position, label COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;

    let categories: Vec<CategoryRecord> = stmt
        .query_map([], |row| {
            Ok(CategoryRecord {
                id: row.get(0)?,
                label: row.get(1)?,
                color: row.get(2)?,
                excluded: row.get(3)?,
                bucket_id: row.get(4)?,
                position: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    Ok(categories)
}

#[tauri::command]
pub fn upsert_category(
    state: State<DbState>,
    id: String,
    label: String,
    color: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO categories (id, label, color) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET label = excluded.label, color = excluded.color",
        params![id, label, color],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_category_placement(
    state: State<DbState>,
    id: String,
    label: String,
    color: String,
    excluded: bool,
    bucket_id: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    // A category's placement is its bucket plus whether it's excluded from spending; both
    // are set together (the "Exclude" tray is just a placement). Upsert so categories that
    // only exist on transactions (no managed row yet) can still be placed; an existing row
    // keeps its label/color and only updates excluded + bucket_id.
    conn.execute(
        "INSERT INTO categories (id, label, color, excluded, bucket_id) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET excluded = ?4, bucket_id = ?5",
        params![id, label, color, excluded, bucket_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_category_positions(state: State<DbState>, ids: Vec<String>) -> Result<(), String> {
    // Persist a bucket's ordering: each id's position becomes its index in `ids`. Positions only
    // need to be ordered within a bucket, so the caller sends one bucket's members at a time.
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare("UPDATE categories SET position = ?1 WHERE id = ?2")
            .map_err(|e| e.to_string())?;
        for (index, id) in ids.iter().enumerate() {
            stmt.execute(params![index as i64, id])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_banks(state: State<DbState>) -> Result<Vec<BankRecord>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, logo_data_url, spending_positive FROM banks ORDER BY name COLLATE NOCASE")
        .map_err(|e| e.to_string())?;

    let banks: Vec<BankRecord> = stmt
        .query_map([], |row| {
            Ok(BankRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                logo_data_url: row.get(2)?,
                spending_positive: row.get::<_, i64>(3)? != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    Ok(banks)
}

#[tauri::command]
pub fn upsert_bank(
    state: State<DbState>,
    id: String,
    name: String,
    logo_data_url: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO banks (id, name, logo_data_url) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, logo_data_url = excluded.logo_data_url",
        params![id, name, logo_data_url],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_bank_spending_positive(
    state: State<DbState>,
    id: String,
    spending_positive: bool,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE banks SET spending_positive = ?2 WHERE id = ?1",
        params![id, spending_positive as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_bank(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM banks WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_buckets(state: State<DbState>) -> Result<Vec<BucketRecord>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, color, position FROM buckets ORDER BY position, name COLLATE NOCASE")
        .map_err(|e| e.to_string())?;

    let buckets: Vec<BucketRecord> = stmt
        .query_map([], |row| {
            Ok(BucketRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                position: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    Ok(buckets)
}

#[tauri::command]
pub fn upsert_bucket(
    state: State<DbState>,
    id: String,
    name: String,
    color: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    // New buckets land at the end of the order (MAX + 1); a rename/recolor of an existing bucket
    // leaves its position untouched.
    conn.execute(
        "INSERT INTO buckets (id, name, color, position)
         VALUES (?1, ?2, ?3, COALESCE((SELECT MAX(position) + 1 FROM buckets), 0))
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color",
        params![id, name, color],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_bucket_positions(state: State<DbState>, ids: Vec<String>) -> Result<(), String> {
    // Persist bucket order: each id's position becomes its index in `ids`.
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare("UPDATE buckets SET position = ?1 WHERE id = ?2")
            .map_err(|e| e.to_string())?;
        for (index, id) in ids.iter().enumerate() {
            stmt.execute(params![index as i64, id])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_bucket(state: State<DbState>, id: String) -> Result<(), String> {
    // The Income page is built on this bucket, so it can be renamed but not deleted.
    if id == "income" {
        return Err("The Income bucket can't be deleted.".to_string());
    }
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE categories SET bucket_id = NULL WHERE bucket_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM buckets WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_category(state: State<DbState>, id: String) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE transactions SET category = 'unclassified' WHERE category = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM categories WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::spending::schema::migrate(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO uploads (id, bank_name, file_name) VALUES ('u1', 'Bank', 'a'), ('u2', 'Bank', 'b');
             INSERT INTO transactions (id, upload_id, date, description, card_member, account_number,
                                       amount, source_bank, source_file_name, category) VALUES
               ('old', 'u1', '1/5/2026', 'Blue Bottle  Coffee', '', '', 5, 'Bank', 'a', 'restaurants'),
               ('newer', 'u1', '2/5/26', 'BLUE BOTTLE COFFEE', '', '', 5, 'Bank', 'a', 'groceries'),
               ('uncat', 'u1', '3/1/2026', 'MYSTERY', '', '', 5, 'Bank', 'a', 'unclassified'),
               ('in1', 'u2', '3/5/2026', 'blue bottle coffee', '', '', 6, 'Bank', 'b', 'unclassified'),
               ('in2', 'u2', '3/6/2026', 'MYSTERY', '', '', 6, 'Bank', 'b', 'unclassified'),
               ('in3', 'u2', '3/7/2026', 'BRAND NEW', '', '', 6, 'Bank', 'b', 'unclassified'),
               ('in4', 'u2', '3/8/2026', 'Blue Bottle Coffee', '', '', 6, 'Bank', 'b', 'travel');",
        )
        .unwrap();
        conn
    }

    fn row(conn: &Connection, id: &str) -> (String, bool) {
        conn.query_row(
            "SELECT category, auto_categorized FROM transactions WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
    }

    #[test]
    fn takes_the_category_of_the_most_recent_match() {
        let conn = setup();
        assert_eq!(apply_previous_categories(&conn, "u2").unwrap(), 1);
        // 2/5/26 is later than 1/5/2026 even though it uses a two-digit year.
        assert_eq!(row(&conn, "in1"), ("groceries".to_string(), true));
    }

    #[test]
    fn leaves_unmatched_and_already_categorized_rows_alone() {
        let conn = setup();
        apply_previous_categories(&conn, "u2").unwrap();
        // The only earlier MYSTERY is itself unclassified, so there is nothing to copy.
        assert_eq!(row(&conn, "in2"), ("unclassified".to_string(), false));
        assert_eq!(row(&conn, "in3"), ("unclassified".to_string(), false));
        assert_eq!(row(&conn, "in4"), ("travel".to_string(), false));
        // Rows in other uploads are never touched.
        assert_eq!(row(&conn, "old"), ("restaurants".to_string(), false));
    }

    #[test]
    fn date_keys_order_chronologically() {
        assert!(date_sort_key("12/31/2025") < date_sort_key("1/1/26"));
        assert!(date_sort_key("garbage") < date_sort_key("1/1/2000"));
    }
}
