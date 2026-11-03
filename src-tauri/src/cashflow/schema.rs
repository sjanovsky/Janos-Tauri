use rusqlite::Connection;

// The two fixed groups: (id, name, color). Every paycheck bucket rolls up into the first and every
// spending bucket into the second; the user can recolor them but not rename, delete or add to them.
const GROUPS: [(&str, &str, &str); 2] = [
    ("cf-paycheck", "Paycheck", "#dc2626"),
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

    // Make sure both groups exist (keeping a color the user already picked), and drop any other
    // group left over from when groups were editable (Taxes, Savings, custom ones).
    for (position, (id, name, color)) in GROUPS.iter().enumerate() {
        conn.execute(
            "INSERT INTO cashflow_groups (id, name, color, position) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, position = excluded.position",
            rusqlite::params![id, name, color, position as i64],
        )?;
    }
    conn.execute("DELETE FROM cashflow_groups WHERE id NOT IN ('cf-paycheck', 'cf-spending')", [])?;

    // Buckets always sit in the group for their kind, so their saved placements are stale. Only the
    // Leftover line can still be placed, and only into a group that still exists (or Ungrouped).
    conn.execute("DELETE FROM cashflow_members WHERE item_key != 'leftover'", [])?;
    conn.execute(
        "DELETE FROM cashflow_members WHERE group_id NOT IN ('', 'cf-paycheck', 'cf-spending')",
        [],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(conn: &Connection) -> Vec<String> {
        conn.prepare("SELECT name FROM cashflow_groups ORDER BY position")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    #[test]
    fn creates_the_two_fixed_groups() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        assert_eq!(names(&conn), vec!["Paycheck", "Spending"]);
        // Running again changes nothing.
        migrate(&conn).unwrap();
        assert_eq!(names(&conn), vec!["Paycheck", "Spending"]);
    }

    #[test]
    fn replaces_groups_from_when_they_were_editable() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE cashflow_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#4f46e5', position INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT '');
             CREATE TABLE cashflow_members (item_key TEXT PRIMARY KEY, group_id TEXT NOT NULL);
             INSERT INTO cashflow_groups (id, name, color, position) VALUES ('cf-taxes', 'Taxes', '#111', 0), ('cf-savings', 'Savings', '#222', 1), ('cf-spending', 'Spending', '#333', 2), ('cf-mine', 'Mine', '#444', 3);
             INSERT INTO cashflow_members (item_key, group_id) VALUES ('paycheck:a', 'cf-taxes'), ('spending:b', 'cf-spending'), ('leftover', 'cf-savings');",
        )
        .unwrap();
        migrate(&conn).unwrap();
        assert_eq!(names(&conn), vec!["Paycheck", "Spending"]);
        let color: String = conn
            .query_row("SELECT color FROM cashflow_groups WHERE id = 'cf-spending'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(color, "#333");
        let members: i64 = conn.query_row("SELECT COUNT(*) FROM cashflow_members", [], |r| r.get(0)).unwrap();
        assert_eq!(members, 0);
    }
}
