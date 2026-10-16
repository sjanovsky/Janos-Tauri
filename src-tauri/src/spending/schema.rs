use rusqlite::Connection;

const DEFAULT_CATEGORIES: [(&str, &str, &str); 5] = [
    ("restaurants", "Restaurants", "#2a78d6"),
    ("groceries", "Groceries", "#1baf7a"),
    ("partying", "Partying", "#eda100"),
    ("fixed", "Fixed", "#008300"),
    ("stuff", "Stuff", "#4a3aa7"),
];

const DEFAULT_INCOME_CATEGORIES: [(&str, &str, &str); 3] = [
    ("income-paycheck", "Paycheck", "#4f46e5"),
    ("income-commission", "Commission", "#0ca678"),
    ("income-bonus", "Bonus", "#f08c00"),
];

/// Create and migrate the tables owned by the spending feature (uploads, transactions,
/// categories, buckets, banks). Called from `crate::db::init_db`, which owns connection-level
/// setup such as `PRAGMA foreign_keys`.
pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS uploads (
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
             bucket_id TEXT,
             position INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS buckets (
             id TEXT PRIMARY KEY,
             name TEXT NOT NULL,
             color TEXT NOT NULL DEFAULT '#4f46e5',
             position INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS banks (
             id TEXT PRIMARY KEY,
             name TEXT NOT NULL,
             logo_data_url TEXT
         );",
    )?;

    // Migrate databases created before buckets carried their own color.
    let has_bucket_color: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('buckets') WHERE name = 'color'",
        [],
        |row| row.get(0),
    )?;
    if has_bucket_color == 0 {
        conn.execute(
            "ALTER TABLE buckets ADD COLUMN color TEXT NOT NULL DEFAULT '#4f46e5'",
            [],
        )?;
    }

    // Migrate databases created before buckets could be ordered. Existing rows default to 0, so
    // they keep their prior (name) order until the user drags to reorder them.
    let has_bucket_position: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('buckets') WHERE name = 'position'",
        [],
        |row| row.get(0),
    )?;
    if has_bucket_position == 0 {
        conn.execute(
            "ALTER TABLE buckets ADD COLUMN position INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

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

    // Migrate databases created before banks could carry their logo data URLs.
    let has_bank_logo_data_url: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('banks') WHERE name = 'logo_data_url'",
        [],
        |row| row.get(0),
    )?;
    if has_bank_logo_data_url == 0 {
        conn.execute("ALTER TABLE banks ADD COLUMN logo_data_url TEXT", [])?;
    }

    // Migrate databases created before banks could say which sign their spending carries. Most
    // statements list spending as positive; some checking exports list it as negative.
    let has_spending_positive: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('banks') WHERE name = 'spending_positive'",
        [],
        |row| row.get(0),
    )?;
    if has_spending_positive == 0 {
        conn.execute(
            "ALTER TABLE banks ADD COLUMN spending_positive INTEGER NOT NULL DEFAULT 1",
            [],
        )?;
    }

    // Migrate databases created before imports could auto-categorize from earlier transactions.
    // The flag marks a category the app chose (not the user) so it can be highlighted for review
    // until the user confirms or changes it.
    let has_auto_categorized: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('transactions') WHERE name = 'auto_categorized'",
        [],
        |row| row.get(0),
    )?;
    if has_auto_categorized == 0 {
        conn.execute(
            "ALTER TABLE transactions ADD COLUMN auto_categorized INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

    // Amounts are now always stored with spending positive (the import flips files that list
    // expenses as negatives), so the per-bank sign setting is retired. Banks that were set to
    // "negative spending" get their existing amounts flipped to match, then the setting is reset;
    // once reset this is a no-op, so it only ever runs once per bank.
    conn.execute(
        "UPDATE transactions SET amount = -amount
         WHERE lower(trim(source_bank)) IN (
             SELECT lower(trim(name)) FROM banks WHERE spending_positive = 0)",
        [],
    )?;
    conn.execute("UPDATE banks SET spending_positive = 1 WHERE spending_positive = 0", [])?;

    // Migrate databases created before categories could be ordered within a bucket. Existing
    // rows default to position 0, so they keep their prior (label) order until the user drags
    // to reorder a bucket.
    let has_position: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('categories') WHERE name = 'position'",
        [],
        |row| row.get(0),
    )?;
    if has_position == 0 {
        conn.execute(
            "ALTER TABLE categories ADD COLUMN position INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

    // The Income page's reserved bucket and its starter categories. The bucket is recreated if
    // missing; the categories are only seeded together with it, so ones the user deletes or
    // renames stay that way.
    let seeded_income = conn.execute(
        "INSERT OR IGNORE INTO buckets (id, name, color, position)
         VALUES ('income', 'Income', '#4f46e5', COALESCE((SELECT MAX(position) + 1 FROM buckets), 0))",
        [],
    )?;
    if seeded_income > 0 {
        for (index, (id, label, color)) in DEFAULT_INCOME_CATEGORIES.iter().enumerate() {
            conn.execute(
                "INSERT OR IGNORE INTO categories (id, label, color, bucket_id, position)
                 VALUES (?1, ?2, ?3, 'income', ?4)",
                rusqlite::params![id, label, color, index as i64],
            )?;
        }
    }

    let category_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM categories", [], |row| row.get(0))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flips_negative_spending_banks_once() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO banks (id, name, spending_positive) VALUES ('b1', 'Checking', 0), ('b2', 'Card', 1);
             INSERT INTO uploads (id, bank_name, file_name) VALUES ('u', 'x', 'f');
             INSERT INTO transactions (id, upload_id, date, description, card_member, account_number,
                                       amount, source_bank, source_file_name, category) VALUES
               ('t1', 'u', '1/1/2026', 'a', '', '', -40, ' checking ', 'f', 'unclassified'),
               ('t2', 'u', '1/1/2026', 'b', '', '', 12, 'Card', 'f', 'unclassified');",
        )
        .unwrap();

        migrate(&conn).unwrap();
        migrate(&conn).unwrap(); // idempotent: the second run must not flip again

        let amount = |id: &str| -> f64 {
            conn.query_row("SELECT amount FROM transactions WHERE id = ?1", [id], |r| r.get(0)).unwrap()
        };
        assert_eq!(amount("t1"), 40.0);
        assert_eq!(amount("t2"), 12.0);
        let flag: i64 = conn
            .query_row("SELECT spending_positive FROM banks WHERE id = 'b1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(flag, 1);
    }
}
