use rusqlite::Connection;

// Seeded when the buckets table is empty, so a fresh install opens with the three default
// net-worth buckets the user expects. Colors are reused from the spending bucket palette.
const DEFAULT_BUCKETS: [(&str, &str, &str); 3] = [
    ("retirement", "Retirement", "#4f46e5"),
    ("brokerage", "Brokerage", "#0ca678"),
    ("cash", "Cash", "#e8590c"),
];

/// Create and migrate the tables owned by the net-worth feature (buckets, accounts, balances).
/// Called from `crate::db::init_db`, which owns connection-level setup. Table names are prefixed
/// with `networth_` so they never collide with the spending feature's own `buckets` table.
pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS networth_buckets (
             id TEXT PRIMARY KEY,
             name TEXT NOT NULL,
             color TEXT NOT NULL DEFAULT '#4f46e5',
             position INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS networth_accounts (
             id TEXT PRIMARY KEY,
             name TEXT NOT NULL,
             bucket_id TEXT REFERENCES networth_buckets(id) ON DELETE SET NULL,
             position INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS networth_balances (
             account_id TEXT NOT NULL REFERENCES networth_accounts(id) ON DELETE CASCADE,
             month TEXT NOT NULL,
             amount REAL NOT NULL,
             PRIMARY KEY (account_id, month)
         );",
    )?;

    let bucket_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM networth_buckets", [], |row| row.get(0))?;
    if bucket_count == 0 {
        for (index, (id, name, color)) in DEFAULT_BUCKETS.iter().enumerate() {
            conn.execute(
                "INSERT INTO networth_buckets (id, name, color, position) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![id, name, color, index as i64],
            )?;
        }
    }

    Ok(())
}
