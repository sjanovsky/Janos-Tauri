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

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CategoryRecord {
    pub id: String,
    pub label: String,
    pub color: String,
    pub excluded: bool,
    pub bucket_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BucketRecord {
    pub id: String,
    pub name: String,
}

const DEFAULT_CATEGORIES: [(&str, &str, &str); 5] = [
    ("restaurants", "Restaurants", "#2a78d6"),
    ("groceries", "Groceries", "#1baf7a"),
    ("partying", "Partying", "#eda100"),
    ("fixed", "Fixed", "#008300"),
    ("stuff", "Stuff", "#4a3aa7"),
];

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
         );
         CREATE TABLE IF NOT EXISTS categories (
             id TEXT PRIMARY KEY,
             label TEXT NOT NULL,
             color TEXT NOT NULL,
             excluded INTEGER NOT NULL DEFAULT 0,
             bucket_id TEXT
         );
         CREATE TABLE IF NOT EXISTS buckets (
             id TEXT PRIMARY KEY,
             name TEXT NOT NULL
         );",
    )?;

    // Migrate databases created before the `excluded` flag existed.
    let has_excluded: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('categories') WHERE name = 'excluded'",
        [],
        |row| row.get(0),
    )?;
    if has_excluded == 0 {
        conn.execute(
            "ALTER TABLE categories ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

    // Migrate databases created before categories could belong to a bucket.
    let has_bucket_id: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('categories') WHERE name = 'bucket_id'",
        [],
        |row| row.get(0),
    )?;
    if has_bucket_id == 0 {
        conn.execute("ALTER TABLE categories ADD COLUMN bucket_id TEXT", [])?;
    }

    let category_count: i64 = conn.query_row("SELECT COUNT(*) FROM categories", [], |row| row.get(0))?;
    if category_count == 0 {
        for (id, label, color) in DEFAULT_CATEGORIES {
            conn.execute(
                "INSERT INTO categories (id, label, color) VALUES (?1, ?2, ?3)",
                rusqlite::params![id, label, color],
            )?;
        }
    }

    // Older builds stored a category's label text directly on transactions instead of
    // its stable id (e.g. a transaction.category of "Entertainment" for the category
    // whose id is "restaurants"). Reconcile any such rows onto the id once; this is a
    // no-op once a transaction's category already matches a known id.
    conn.execute(
        "UPDATE transactions
         SET category = (SELECT c.id FROM categories c WHERE c.label = transactions.category LIMIT 1)
         WHERE category NOT IN (SELECT id FROM categories)
           AND category IN (SELECT label FROM categories)",
        [],
    )?;

    Ok(())
}
