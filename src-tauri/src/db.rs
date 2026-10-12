use rusqlite::Connection;
use std::sync::Mutex;

/// The single shared SQLite connection, guarded for use across Tauri commands.
pub struct DbState(pub Mutex<Connection>);

/// Apply connection-level setup and run every feature's migrations. Each feature owns its
/// own tables and migration logic (see e.g. `crate::spending::schema`); this orchestrates
/// them against the shared connection. New features add one line here.
pub fn init_db(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    crate::spending::schema::migrate(conn)?;
    crate::networth::schema::migrate(conn)?;
    crate::taxes::schema::migrate(conn)?;
    Ok(())
}
