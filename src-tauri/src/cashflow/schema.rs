use rusqlite::Connection;

// Seeded once: (id, name, color). The frontend's default placement of buckets refers to these ids.
const DEFAULT_GROUPS: [(&str, &str, &str); 3] = [
    ("cf-taxes", "Taxes", "#dc2626"),
    ("cf-savings", "Savings", "#0ca678"),
    ("cf-spending", "Spending", "#e8590c"),
];

/// Create the tables owned by the Cash Flow feature. Called from `crate::db::init_db`. Table names
/// are prefixed with `cashflow_` so they never collide with other features.
pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS cashflow_groups (
             id TEXT PRIMARY KEY,
             name TEXT NOT NULL,
             color TEXT NOT NULL DEFAULT '#4f46e5',
             position INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS cashflow_members (
             item_key TEXT PRIMARY KEY,
             group_id TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS cashflow_meta (
             key TEXT PRIMARY KEY
         );",
    )?;

    // Seed the defaults once, so groups the user later deletes stay deleted.
    let seeded: i64 = conn.query_row(
        "SELECT COUNT(*) FROM cashflow_meta WHERE key = 'defaults_seeded'",
        [],
        |row| row.get(0),
    )?;
    if seeded == 0 {
        for (position, (id, name, color)) in DEFAULT_GROUPS.iter().enumerate() {
            conn.execute(
                "INSERT OR IGNORE INTO cashflow_groups (id, name, color, position) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![id, name, color, position as i64],
            )?;
        }
        conn.execute("INSERT INTO cashflow_meta (key) VALUES ('defaults_seeded')", [])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_the_default_groups_once() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let names = |conn: &Connection| -> Vec<String> {
            conn.prepare("SELECT name FROM cashflow_groups ORDER BY position")
                .unwrap()
                .query_map([], |r| r.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        assert_eq!(names(&conn), vec!["Taxes", "Savings", "Spending"]);

        // A deleted default must not come back.
        conn.execute("DELETE FROM cashflow_groups WHERE id = 'cf-savings'", []).unwrap();
        migrate(&conn).unwrap();
        assert_eq!(names(&conn), vec!["Taxes", "Spending"]);
    }
}
