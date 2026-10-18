use rusqlite::Connection;

/// Create the tables owned by the planning feature. Called from `crate::db::init_db`.
///
/// Planning mostly reads what other pages already hold (paychecks, taxes, spending); this table
/// keeps only what the user overrides or enters on the page itself, keyed by field.
pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS planning_settings (
             key TEXT PRIMARY KEY,
             value TEXT NOT NULL
         );",
    )
}
