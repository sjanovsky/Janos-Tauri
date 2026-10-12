use super::models::{NetWorthAccountRecord, NetWorthBalanceRecord, NetWorthBucketRecord};
use crate::db::DbState;
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn list_networth_buckets(state: State<DbState>) -> Result<Vec<NetWorthBucketRecord>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, color, position FROM networth_buckets
             ORDER BY position, name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;

    let buckets: Vec<NetWorthBucketRecord> = stmt
        .query_map([], |row| {
            Ok(NetWorthBucketRecord {
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
pub fn upsert_networth_bucket(
    state: State<DbState>,
    id: String,
    name: String,
    color: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    // New buckets land at the end of the order (MAX + 1); a rename/recolor leaves position alone.
    conn.execute(
        "INSERT INTO networth_buckets (id, name, color, position)
         VALUES (?1, ?2, ?3, COALESCE((SELECT MAX(position) + 1 FROM networth_buckets), 0))
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color",
        params![id, name, color],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_networth_bucket_positions(state: State<DbState>, ids: Vec<String>) -> Result<(), String> {
    // Persist bucket order: each id's position becomes its index in `ids`.
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare("UPDATE networth_buckets SET position = ?1 WHERE id = ?2")
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
pub fn delete_networth_bucket(state: State<DbState>, id: String) -> Result<(), String> {
    // The accounts.bucket_id FK is ON DELETE SET NULL, so deleting a bucket drops its accounts
    // back into the "Ungrouped" tray rather than deleting them (and their balances).
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM networth_buckets WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_networth_accounts(state: State<DbState>) -> Result<Vec<NetWorthAccountRecord>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, bucket_id, position FROM networth_accounts
             ORDER BY position, name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;

    let accounts: Vec<NetWorthAccountRecord> = stmt
        .query_map([], |row| {
            Ok(NetWorthAccountRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                bucket_id: row.get(2)?,
                position: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    Ok(accounts)
}

#[tauri::command]
pub fn upsert_networth_account(
    state: State<DbState>,
    id: String,
    name: String,
) -> Result<(), String> {
    // Add or rename an account. New accounts start in the "Ungrouped" tray (bucket_id null) at the
    // end of the order; a rename leaves placement and position untouched.
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO networth_accounts (id, name, bucket_id, position)
         VALUES (?1, ?2, NULL, COALESCE((SELECT MAX(position) + 1 FROM networth_accounts), 0))
         ON CONFLICT(id) DO UPDATE SET name = excluded.name",
        params![id, name],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_networth_account_placement(
    state: State<DbState>,
    id: String,
    name: String,
    bucket_id: Option<String>,
) -> Result<(), String> {
    // Move an account into a bucket, or back to the "Ungrouped" tray (bucket_id null). Upsert so a
    // placement can create the row if needed; an existing row keeps its name/position.
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO networth_accounts (id, name, bucket_id) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET bucket_id = ?3",
        params![id, name, bucket_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_networth_account_positions(state: State<DbState>, ids: Vec<String>) -> Result<(), String> {
    // Persist a bucket's account ordering: each id's position becomes its index in `ids`.
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare("UPDATE networth_accounts SET position = ?1 WHERE id = ?2")
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
pub fn delete_networth_account(state: State<DbState>, id: String) -> Result<(), String> {
    // The balances FK is ON DELETE CASCADE, so an account's balances go with it.
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM networth_accounts WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_networth_balances(state: State<DbState>) -> Result<Vec<NetWorthBalanceRecord>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT account_id, month, amount FROM networth_balances")
        .map_err(|e| e.to_string())?;

    let balances: Vec<NetWorthBalanceRecord> = stmt
        .query_map([], |row| {
            Ok(NetWorthBalanceRecord {
                account_id: row.get(0)?,
                month: row.get(1)?,
                amount: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    Ok(balances)
}

#[tauri::command]
pub fn rename_networth_month(
    state: State<DbState>,
    old_month: String,
    new_month: String,
) -> Result<(), String> {
    // Move every balance from one month column to another (when the user edits a column's date).
    // The frontend only allows renaming onto a month that has no balances yet, so this can't hit a
    // (account_id, month) primary-key conflict.
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE networth_balances SET month = ?1 WHERE month = ?2",
        params![new_month, old_month],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn import_networth(
    state: State<DbState>,
    buckets: Vec<NetWorthBucketRecord>,
    accounts: Vec<NetWorthAccountRecord>,
    balances: Vec<NetWorthBalanceRecord>,
) -> Result<(), String> {
    // Apply a whole pasted-spreadsheet import in one transaction: upsert the referenced buckets,
    // then the accounts (ordered after buckets so the bucket_id FK resolves), then every balance.
    // The frontend resolves all ids/positions/colors (reusing existing rows when a name matches),
    // so each statement is a plain upsert here. Running it as one batched command avoids the
    // hundreds of IPC round-trips a cell-by-cell import would need.
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut bucket_stmt = tx
            .prepare(
                "INSERT INTO networth_buckets (id, name, color, position) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color,
                     position = excluded.position",
            )
            .map_err(|e| e.to_string())?;
        for bucket in &buckets {
            bucket_stmt
                .execute(params![bucket.id, bucket.name, bucket.color, bucket.position])
                .map_err(|e| e.to_string())?;
        }

        let mut account_stmt = tx
            .prepare(
                "INSERT INTO networth_accounts (id, name, bucket_id, position) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name, bucket_id = excluded.bucket_id,
                     position = excluded.position",
            )
            .map_err(|e| e.to_string())?;
        for account in &accounts {
            account_stmt
                .execute(params![account.id, account.name, account.bucket_id, account.position])
                .map_err(|e| e.to_string())?;
        }

        let mut balance_stmt = tx
            .prepare(
                "INSERT INTO networth_balances (account_id, month, amount) VALUES (?1, ?2, ?3)
                 ON CONFLICT(account_id, month) DO UPDATE SET amount = excluded.amount",
            )
            .map_err(|e| e.to_string())?;
        for balance in &balances {
            balance_stmt
                .execute(params![balance.account_id, balance.month, balance.amount])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_networth_month(state: State<DbState>, month: String) -> Result<(), String> {
    // Remove a whole month column: delete every account's balance in that month. Empty columns the
    // user added this session live only in the frontend, so there may be nothing to delete here.
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM networth_balances WHERE month = ?1",
        params![month],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_networth_balance(
    state: State<DbState>,
    account_id: String,
    month: String,
    amount: Option<f64>,
) -> Result<(), String> {
    // `amount = None` clears the entry (so the cell falls back to the carried-forward value);
    // `Some(value)` upserts an explicit balance for that account/month.
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    match amount {
        Some(value) => conn
            .execute(
                "INSERT INTO networth_balances (account_id, month, amount) VALUES (?1, ?2, ?3)
                 ON CONFLICT(account_id, month) DO UPDATE SET amount = excluded.amount",
                params![account_id, month, value],
            )
            .map_err(|e| e.to_string())?,
        None => conn
            .execute(
                "DELETE FROM networth_balances WHERE account_id = ?1 AND month = ?2",
                params![account_id, month],
            )
            .map_err(|e| e.to_string())?,
    };
    Ok(())
}
