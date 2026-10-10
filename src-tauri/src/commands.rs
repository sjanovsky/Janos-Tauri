use crate::db::{DbState, TransactionRecord, UploadRecord};
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn list_uploads(state: State<DbState>) -> Result<Vec<UploadRecord>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let mut upload_stmt = conn
        .prepare("SELECT id, bank_name, file_name FROM uploads ORDER BY imported_at DESC")
        .map_err(|e| e.to_string())?;

    let uploads: Vec<(String, String, String)> = upload_stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    let mut tx_stmt = conn
        .prepare(
            "SELECT id, date, description, card_member, account_number, amount, source_bank, source_file_name, category
             FROM transactions WHERE upload_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let mut result = Vec::with_capacity(uploads.len());
    for (id, bank_name, file_name) in uploads {
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
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;

        result.push(UploadRecord {
            id,
            bank_name,
            file_name,
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
pub fn update_transaction_category(
    state: State<DbState>,
    transaction_id: String,
    category: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE transactions SET category = ?1 WHERE id = ?2",
        params![category, transaction_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
