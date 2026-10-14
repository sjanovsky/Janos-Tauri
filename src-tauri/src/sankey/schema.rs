use rusqlite::{params, Connection};

// Seeded once, into an empty Sankey: (id, name, color, direction, categories). Each category is
// (name, tax role): the role says how the Taxes page reads that line (`income`, pre-tax
// `deduction`, `withholding`, or `none`). The Spending bucket's categories aren't listed here; it
// links to the spending buckets that exist.
type DefaultCategory = (&'static str, &'static str);
const DEFAULT_BUCKETS: [(&str, &str, &str, &str, &[DefaultCategory]); 4] = [
    (
        "default-income",
        "Income",
        "#4f46e5",
        "inflow",
        &[
            ("Salary", "income"),
            ("Bonus", "income"),
            ("Commission", "income"),
            ("Interest", "income"),
            ("Dividends", "income"),
        ],
    ),
    (
        "default-taxes",
        "Taxes",
        "#dc2626",
        "outflow",
        &[
            ("Federal", "withholding"),
            ("State", "none"),
            ("City", "none"),
            ("Social Security", "none"),
        ],
    ),
    (
        "default-investments",
        "Investments",
        "#0ca678",
        "outflow",
        &[("401K", "deduction"), ("Roth 401K", "none"), ("HSA", "deduction")],
    ),
    ("default-spending", "Spending", "#e8590c", "outflow", &[]),
];

/// Create the tables owned by the Sankey feature. Called from `crate::db::init_db`, after the
/// spending and taxes migrations so categories can reference spending `buckets` and the paycheck
/// numbers (`taxes_items`) can point back at a category. Table names are prefixed with `sankey_`
/// so they never collide with other features.
pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sankey_buckets (
             id TEXT PRIMARY KEY,
             name TEXT NOT NULL,
             color TEXT NOT NULL DEFAULT '#4f46e5',
             direction TEXT NOT NULL DEFAULT 'outflow',
             position INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS sankey_meta (
             key TEXT PRIMARY KEY
         );
         CREATE TABLE IF NOT EXISTS sankey_categories (
             id TEXT PRIMARY KEY,
             bucket_id TEXT NOT NULL REFERENCES sankey_buckets(id) ON DELETE CASCADE,
             name TEXT NOT NULL,
             spending_bucket_id TEXT REFERENCES buckets(id) ON DELETE SET NULL,
             amount REAL NOT NULL DEFAULT 0,
             position INTEGER NOT NULL DEFAULT 0,
             tax_role TEXT NOT NULL DEFAULT 'none'
         );
         CREATE TABLE IF NOT EXISTS sankey_rules (
             id TEXT PRIMARY KEY,
             name TEXT NOT NULL,
             pattern TEXT NOT NULL,
             kind TEXT NOT NULL DEFAULT 'bucket',
             bucket_id TEXT REFERENCES sankey_buckets(id) ON DELETE CASCADE,
             position INTEGER NOT NULL DEFAULT 0
         );",
    )?;

    // Databases created before categories carried a tax role: add the column, then give the
    // default categories the roles a fresh database would have.
    if !has_column(conn, "sankey_categories", "tax_role")? {
        conn.execute(
            "ALTER TABLE sankey_categories ADD COLUMN tax_role TEXT NOT NULL DEFAULT 'none'",
            [],
        )?;
        for (bucket_id, _, _, _, categories) in DEFAULT_BUCKETS.iter() {
            for (index, (_, role)) in categories.iter().enumerate() {
                conn.execute(
                    "UPDATE sankey_categories SET tax_role = ?1 WHERE id = ?2",
                    params![role, format!("{bucket_id}-{index}")],
                )?;
            }
        }
    }

    // Each year's paycheck numbers live in `taxes_items`; this column ties a line to its category,
    // so the Sankey and the Taxes page read the same rows. Deleting a category removes its lines.
    if has_column(conn, "taxes_items", "year")? && !has_column(conn, "taxes_items", "sankey_category_id")? {
        conn.execute(
            "ALTER TABLE taxes_items ADD COLUMN sankey_category_id TEXT
                 REFERENCES sankey_categories(id) ON DELETE CASCADE",
            [],
        )?;
    }

    // Seed the defaults once. The marker means buckets the user later deletes stay deleted; a
    // database that already has buckets (made before defaults existed) is left untouched and
    // just marked.
    let seeded: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sankey_meta WHERE key = 'defaults_seeded'",
        [],
        |row| row.get(0),
    )?;
    if seeded == 0 {
        let existing: i64 = conn.query_row("SELECT COUNT(*) FROM sankey_buckets", [], |row| row.get(0))?;
        if existing == 0 {
            seed_defaults(conn)?;
        }
        conn.execute("INSERT INTO sankey_meta (key) VALUES ('defaults_seeded')", [])?;
    }

    if has_column(conn, "taxes_items", "sankey_category_id")? {
        link_tax_items(conn)?;
    }
    Ok(())
}

fn has_column(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
        params![table, column],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

// "401(k)" and "401K" are the same line; compare names without case or punctuation.
fn name_key(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// Give every Taxes line that predates the shared store a Sankey category, once. Lines are
/// grouped by (section, name) across years: each group reuses a category of the same name in the
/// matching bucket or creates one, and every year's row is linked to it, so no entered number is
/// lost. Rows already linked are left alone, so this is a no-op after the first run.
fn link_tax_items(conn: &Connection) -> rusqlite::Result<()> {
    let groups: Vec<(String, String)> = conn
        .prepare(
            "SELECT DISTINCT section, name FROM taxes_items
             WHERE sankey_category_id IS NULL AND section IN ('income', 'deduction', 'withholding')
             ORDER BY section, name",
        )?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<_, _>>()?;

    for (section, name) in groups {
        let (bucket_id, default_name, direction, default_color) = match section.as_str() {
            "income" => ("default-income", "Income", "inflow", "#4f46e5"),
            "deduction" => ("default-investments", "Investments", "outflow", "#0ca678"),
            _ => ("default-taxes", "Taxes", "outflow", "#dc2626"),
        };
        let bucket = target_bucket(conn, bucket_id, default_name, direction, default_color)?;

        let key = name_key(&name);
        let existing: Option<(String, String)> = conn
            .prepare(
                "SELECT id, name, tax_role FROM sankey_categories
                 WHERE bucket_id = ?1 AND spending_bucket_id IS NULL",
            )?
            .query_map(params![bucket], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
            })?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .find(|(_, existing_name, _)| name_key(existing_name) == key)
            .map(|(id, _, role)| (id, role));

        let category_id = match existing {
            Some((id, role)) => {
                if role == "none" {
                    conn.execute("UPDATE sankey_categories SET tax_role = ?1 WHERE id = ?2", params![section, id])?;
                }
                id
            }
            None => {
                let id = format!("linked-{}", uuid_like(conn)?);
                conn.execute(
                    "INSERT INTO sankey_categories (id, bucket_id, name, tax_role, position)
                     VALUES (?1, ?2, ?3, ?4,
                             COALESCE((SELECT MAX(position) + 1 FROM sankey_categories WHERE bucket_id = ?2), 0))",
                    params![id, bucket, name, section],
                )?;
                id
            }
        };
        conn.execute(
            "UPDATE taxes_items SET sankey_category_id = ?1
             WHERE sankey_category_id IS NULL AND section = ?2 AND name = ?3",
            params![category_id, section, name],
        )?;
    }
    Ok(())
}

// A random-enough id from SQLite, so migrated categories don't need a uuid dependency.
fn uuid_like(conn: &Connection) -> rusqlite::Result<String> {
    conn.query_row("SELECT lower(hex(randomblob(8)))", [], |row| row.get(0))
}

// The bucket a migrated line goes into: the default bucket if it still exists, else the first
// bucket of the right direction, else a new one.
fn target_bucket(
    conn: &Connection,
    default_id: &str,
    default_name: &str,
    direction: &str,
    color: &str,
) -> rusqlite::Result<String> {
    let by_id: Option<String> = conn
        .query_row("SELECT id FROM sankey_buckets WHERE id = ?1", params![default_id], |row| row.get(0))
        .ok();
    if let Some(id) = by_id {
        return Ok(id);
    }
    let by_name: Option<String> = conn
        .query_row(
            "SELECT id FROM sankey_buckets WHERE direction = ?1 AND lower(name) = lower(?2)
             ORDER BY position LIMIT 1",
            params![direction, default_name],
            |row| row.get(0),
        )
        .ok();
    if let Some(id) = by_name {
        return Ok(id);
    }
    let any: Option<String> = conn
        .query_row(
            "SELECT id FROM sankey_buckets WHERE direction = ?1 ORDER BY position LIMIT 1",
            params![direction],
            |row| row.get(0),
        )
        .ok();
    if let Some(id) = any {
        return Ok(id);
    }
    let id = format!("linked-{}", uuid_like(conn)?);
    conn.execute(
        "INSERT INTO sankey_buckets (id, name, color, direction, position)
         VALUES (?1, ?2, ?3, ?4, COALESCE((SELECT MAX(position) + 1 FROM sankey_buckets), 0))",
        params![id, default_name, color, direction],
    )?;
    Ok(id)
}

/// Make sure every year in `taxes_years` has a line (a `taxes_items` row) for each Sankey
/// paycheck category, and that each line's name, section and order follow its category. Called
/// before the Taxes or Sankey page reads its data, so both always see the same set of lines.
/// Categories linked to a spending bucket take their numbers from the bank data instead, so they
/// have no lines.
pub fn sync_tax_lines(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "INSERT INTO taxes_items (id, year, section, name, ytd, last_paycheck, paychecks_left, position,
                                  sankey_category_id)
         SELECT 'line-' || y.year || '-' || c.id, y.year, c.tax_role, c.name, 0, 0, 0, c.position, c.id
         FROM taxes_years y CROSS JOIN sankey_categories c
         WHERE c.spending_bucket_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM taxes_items i WHERE i.year = y.year AND i.sankey_category_id = c.id);

         UPDATE taxes_items SET
             name = (SELECT c.name FROM sankey_categories c WHERE c.id = taxes_items.sankey_category_id),
             section = (SELECT c.tax_role FROM sankey_categories c WHERE c.id = taxes_items.sankey_category_id),
             position = (SELECT c.position FROM sankey_categories c WHERE c.id = taxes_items.sankey_category_id)
         WHERE sankey_category_id IS NOT NULL;",
    )
}

fn seed_defaults(conn: &Connection) -> rusqlite::Result<()> {
    for (position, (id, name, color, direction, categories)) in DEFAULT_BUCKETS.iter().enumerate() {
        conn.execute(
            "INSERT INTO sankey_buckets (id, name, color, direction, position) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, name, color, direction, position as i64],
        )?;
        for (index, (category, role)) in categories.iter().enumerate() {
            conn.execute(
                "INSERT INTO sankey_categories (id, bucket_id, name, tax_role, position)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![format!("{id}-{index}"), id, category, role, index as i64],
            )?;
        }
    }

    // Spending breaks down by the spending page's own buckets, in their order.
    let spending: Vec<(String, String)> = conn
        .prepare("SELECT id, name FROM buckets ORDER BY position, name COLLATE NOCASE")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<_, _>>()?;
    for (index, (spending_id, name)) in spending.iter().enumerate() {
        conn.execute(
            "INSERT INTO sankey_categories (id, bucket_id, name, spending_bucket_id, position)
             VALUES (?1, 'default-spending', ?2, ?3, ?4)",
            params![format!("default-spending-{index}"), name, spending_id, index as i64],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_defaults_once_and_links_existing_spending_buckets() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::spending::schema::migrate(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO buckets (id, name, position) VALUES ('b1', 'Fixed', 0), ('b2', 'Fun', 1);",
        )
        .unwrap();
        migrate(&conn).unwrap();

        let names = |direction: &str| -> Vec<String> {
            conn.prepare("SELECT name FROM sankey_buckets WHERE direction = ?1 ORDER BY position")
                .unwrap()
                .query_map([direction], |r| r.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        assert_eq!(names("inflow"), vec!["Income"]);
        assert_eq!(names("outflow"), vec!["Taxes", "Investments", "Spending"]);

        let linked: Vec<(String, Option<String>)> = conn
            .prepare(
                "SELECT name, spending_bucket_id FROM sankey_categories
                 WHERE bucket_id = 'default-spending' ORDER BY position",
            )
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            linked,
            vec![("Fixed".into(), Some("b1".into())), ("Fun".into(), Some("b2".into()))]
        );

        // Deleting a default and migrating again must not bring it back.
        conn.execute("DELETE FROM sankey_buckets WHERE id = 'default-taxes'", []).unwrap();
        migrate(&conn).unwrap();
        assert_eq!(names("outflow"), vec!["Investments", "Spending"]);
    }

    #[test]
    fn seeds_tables_that_already_exist_but_are_empty() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE sankey_buckets (id TEXT PRIMARY KEY, name TEXT NOT NULL,
                 color TEXT NOT NULL DEFAULT '#4f46e5', direction TEXT NOT NULL DEFAULT 'outflow',
                 position INTEGER NOT NULL DEFAULT 0);",
        )
        .unwrap();
        crate::spending::schema::migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM sankey_buckets", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 4);
    }

    #[test]
    fn leaves_existing_buckets_alone() {
        let conn = Connection::open_in_memory().unwrap();
        crate::spending::schema::migrate(&conn).unwrap();
        conn.execute_batch(
            "CREATE TABLE sankey_buckets (id TEXT PRIMARY KEY, name TEXT NOT NULL,
                 color TEXT NOT NULL DEFAULT '#4f46e5', direction TEXT NOT NULL DEFAULT 'outflow',
                 position INTEGER NOT NULL DEFAULT 0);
             INSERT INTO sankey_buckets (id, name) VALUES ('mine', 'Mine');",
        )
        .unwrap();
        migrate(&conn).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM sankey_buckets", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn migrates_idempotently_and_unlinks_deleted_spending_buckets() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::spending::schema::migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();

        conn.execute_batch(
            "INSERT INTO buckets (id, name) VALUES ('b1', 'Fixed');
             INSERT INTO sankey_buckets (id, name, direction) VALUES ('s1', 'Expenses', 'outflow');
             INSERT INTO sankey_categories (id, bucket_id, name, spending_bucket_id, amount)
                 VALUES ('c1', 's1', 'Fixed', 'b1', 1200);
             DELETE FROM buckets WHERE id = 'b1';",
        )
        .unwrap();

        let (name, link): (String, Option<String>) = conn
            .query_row(
                "SELECT name, spending_bucket_id FROM sankey_categories WHERE id = 'c1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(name, "Fixed");
        assert_eq!(link, None);

        // Deleting a Sankey bucket removes its categories.
        conn.execute("DELETE FROM sankey_buckets WHERE id = 's1'", []).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sankey_categories WHERE bucket_id = 's1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn links_existing_tax_lines_once_and_syncs_new_years() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::spending::schema::migrate(&conn).unwrap();
        crate::taxes::schema::migrate(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO taxes_years VALUES (2026);
             INSERT INTO taxes_items (id, year, section, name, ytd, position) VALUES
                 ('i1', 2026, 'income', 'Salary', 100000, 0),
                 ('i2', 2026, 'deduction', '401(k)', 5000, 0),
                 ('i3', 2026, 'withholding', 'Federal tax withheld', 12000, 0);",
        )
        .unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();

        // "Salary" and "401(k)" reuse the default categories; the withholding line gets its own.
        let linked = |id: &str| -> String {
            conn.query_row(
                "SELECT c.bucket_id || '/' || c.name FROM taxes_items i
                 JOIN sankey_categories c ON c.id = i.sankey_category_id WHERE i.id = ?1",
                [id],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(linked("i1"), "default-income/Salary");
        assert_eq!(linked("i2"), "default-investments/401K");
        assert_eq!(linked("i3"), "default-taxes/Federal tax withheld");
        let roles: Vec<String> = conn
            .prepare("SELECT tax_role FROM sankey_categories WHERE name IN ('Salary', '401K', 'Federal tax withheld') ORDER BY name")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(roles, vec!["deduction", "withholding", "income"]);

        // Migrating twice added nothing, and a new year gets a line per paycheck category.
        let items: i64 = conn.query_row("SELECT COUNT(*) FROM taxes_items", [], |r| r.get(0)).unwrap();
        assert_eq!(items, 3);
        conn.execute("INSERT INTO taxes_years VALUES (2027)", []).unwrap();
        sync_tax_lines(&conn).unwrap();
        let per_year: i64 = conn
            .query_row("SELECT COUNT(*) FROM taxes_items WHERE year = 2027", [], |r| r.get(0))
            .unwrap();
        let categories: i64 = conn
            .query_row("SELECT COUNT(*) FROM sankey_categories WHERE spending_bucket_id IS NULL", [], |r| r.get(0))
            .unwrap();
        assert_eq!(per_year, categories);

        // Deleting a category removes its lines.
        conn.execute("DELETE FROM sankey_categories WHERE name = 'Salary'", []).unwrap();
        let salary: i64 = conn
            .query_row("SELECT COUNT(*) FROM taxes_items WHERE name = 'Salary'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(salary, 0);
    }
}
