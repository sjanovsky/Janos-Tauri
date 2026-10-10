use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

pub struct DbState(pub Mutex<Connection>);

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransactionRecord {
    pub id: String,
    pub date: String,
    pub description: String,
    pub card_member: String,
    pub account_number: String,
    pub amount: f64,
    pub source_bank: String,
    pub source_file_name: String,
    pub category: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UploadRecord {
    pub id: String,
    pub bank_name: String,
    pub file_name: String,
    pub transactions: Vec<TransactionRecord>,
}

pub fn init_db(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         CREATE TABLE IF NOT EXISTS uploads (
             id TEXT PRIMARY KEY,
             bank_name TEXT NOT NULL,
             file_name TEXT NOT NULL,
             imported_at TEXT NOT NULL DEFAULT (datetime('now'))
         );
         CREATE TABLE IF NOT EXISTS transactions (
             id TEXT PRIMARY KEY,
             upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
             date TEXT NOT NULL,
             description TEXT NOT NULL,
             card_member TEXT NOT NULL,
             account_number TEXT NOT NULL,
             amount REAL NOT NULL,
             source_bank TEXT NOT NULL,
             source_file_name TEXT NOT NULL,
             category TEXT NOT NULL
         );",
    )
}
