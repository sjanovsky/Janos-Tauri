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
