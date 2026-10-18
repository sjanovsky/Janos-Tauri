use rusqlite::Connection;

const DEFAULT_BUCKETS: [(&str, &str, &str); 3] = [
    ("withholding", "Withholding", "#e11d48"),
    ("savings", "Savings", "#0ca678"),
    ("tax", "Taxes", "#f08c00"),
];

const DEFAULT_ITEMS: [(&str, &str, &str); 13] = [
    ("federal-withholding", "Federal", "withholding"),
    ("state-withholding", "State", "withholding"),
    ("city-withholding", "City", "withholding"),
    ("401k", "401K", "savings"),
    ("roth-401k", "Roth 401K", "savings"),
    ("hsa", "HSA", "savings"),
    ("social-security", "Social Security", "tax"),
    ("medicare", "Medicare", "tax"),
    ("long-term-disability", "Long Term Disability", "tax"),
    ("nypfl", "NYPFL", "tax"),
    ("nysdi", "NYSDI", "tax"),
    ("medical-insurance", "Medical Insurance", "tax"),
    ("dental-insurance", "Dental Insurance", "tax"),
];

fn table_exists(conn: &Connection, name: &str) -> rusqlite::Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [name],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
        [table, column],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// Create the tables owned by the income feature. Called from `crate::db::init_db`, after the
/// spending migration.
///
/// A paycheck is a template with a required gross amount; one template stands behind many bank
/// deposits. Each paycheck is also an income category (same id, in the reserved `income`
/// bucket) so a deposit's `category` is simply the paycheck's id and the Spending and Overview
/// pages already leave it out. The withheld pieces are shared line items (Federal Withholding,
/// 401K, ...) grouped into shared buckets, the way spending categories are grouped into buckets;
/// each paycheck holds an amount per item.
pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let buckets_existed = table_exists(conn, "paycheck_buckets")?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS paychecks (
             id TEXT PRIMARY KEY,
             person TEXT NOT NULL DEFAULT '',
             name TEXT NOT NULL,
             deposit_pattern TEXT NOT NULL DEFAULT '',
             position INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS paycheck_buckets (
             id TEXT PRIMARY KEY,
             name TEXT NOT NULL,
             color TEXT NOT NULL,
             position INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS paycheck_items (
             id TEXT PRIMARY KEY,
             label TEXT NOT NULL,
             bucket_id TEXT,
             position INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS paycheck_values (
             paycheck_id TEXT NOT NULL REFERENCES paychecks(id) ON DELETE CASCADE,
             item_id TEXT NOT NULL REFERENCES paycheck_items(id) ON DELETE CASCADE,
             amount REAL NOT NULL DEFAULT 0,
             PRIMARY KEY (paycheck_id, item_id)
         );
         CREATE TABLE IF NOT EXISTS paycheck_versions (
             id TEXT PRIMARY KEY,
             paycheck_id TEXT NOT NULL REFERENCES paychecks(id) ON DELETE CASCADE,
             effective_from TEXT NOT NULL DEFAULT '',
             effective_to TEXT NOT NULL DEFAULT '',
             gross REAL NOT NULL DEFAULT 0,
             transaction_id TEXT UNIQUE
         );
         CREATE TABLE IF NOT EXISTS paycheck_version_values (
             version_id TEXT NOT NULL REFERENCES paycheck_versions(id) ON DELETE CASCADE,
             item_id TEXT NOT NULL REFERENCES paycheck_items(id) ON DELETE CASCADE,
             amount REAL NOT NULL DEFAULT 0,
             PRIMARY KEY (version_id, item_id)
         );
         DROP TABLE IF EXISTS income_rules;",
    )?;

    if !column_exists(conn, "paychecks", "paychecks_per_year")? {
        conn.execute("ALTER TABLE paychecks ADD COLUMN paychecks_per_year INTEGER NOT NULL DEFAULT 26", [])?;
    }
    if !column_exists(conn, "paychecks", "extra_income")? {
        conn.execute("ALTER TABLE paychecks ADD COLUMN extra_income REAL NOT NULL DEFAULT 0", [])?;
    }

    if !column_exists(conn, "paychecks", "gross")? {
        conn.execute("ALTER TABLE paychecks ADD COLUMN gross REAL NOT NULL DEFAULT 0", [])?;
    }

    // Starter buckets and line items, only when the tables are first created so ones the user
    // deletes or renames stay that way.
    if !buckets_existed {
        for (index, (id, name, color)) in DEFAULT_BUCKETS.iter().enumerate() {
            conn.execute(
                "INSERT OR IGNORE INTO paycheck_buckets (id, name, color, position) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![id, name, color, index as i64],
            )?;
        }
        for (index, (id, label, bucket)) in DEFAULT_ITEMS.iter().enumerate() {
            conn.execute(
                "INSERT OR IGNORE INTO paycheck_items (id, label, bucket_id, position) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![id, label, bucket, index as i64],
            )?;
        }
    }

    migrate_free_form_lines(conn)?;

    // One person-and-paycheck pair used to be two fields; a paycheck now has just a name.
    conn.execute(
        "UPDATE paychecks SET name = trim(person || ' ' || name), person = '' WHERE person <> ''",
        [],
    )?;

    // Every paycheck is backed by an income category with its own id.
    conn.execute(
        "INSERT OR IGNORE INTO categories (id, label, color, excluded, bucket_id, position)
         SELECT p.id, p.name, '#4f46e5', 0, 'income',
                COALESCE((SELECT MAX(position) + 1 FROM categories WHERE bucket_id = 'income'), 0) + p.position
         FROM paychecks p",
        [],
    )?;

    migrate_category_paycheck_links(conn)?;
    migrate_paycheck_versions(conn)?;
    Ok(())
}

/// A paycheck used to be one set of numbers (`paychecks.gross` and `paycheck_values`). Give every
/// paycheck without a version a first one, effective from the beginning, holding those numbers.
/// Idempotent: paychecks that already have a version are left alone.
fn migrate_paycheck_versions(conn: &Connection) -> rusqlite::Result<()> {
    if !column_exists(conn, "paycheck_versions", "effective_to")? {
        conn.execute("ALTER TABLE paycheck_versions ADD COLUMN effective_to TEXT NOT NULL DEFAULT ''", [])?;
    }
    conn.execute_batch(
        "INSERT INTO paycheck_versions (id, paycheck_id, effective_from, gross)
         SELECT 'v-' || p.id, p.id, '', p.gross FROM paychecks p
         WHERE NOT EXISTS (SELECT 1 FROM paycheck_versions v WHERE v.paycheck_id = p.id);

         INSERT OR IGNORE INTO paycheck_version_values (version_id, item_id, amount)
         SELECT 'v-' || pv.paycheck_id, pv.item_id, pv.amount FROM paycheck_values pv
         WHERE EXISTS (SELECT 1 FROM paycheck_versions v WHERE v.id = 'v-' || pv.paycheck_id)
           AND NOT EXISTS (SELECT 1 FROM paycheck_version_values x WHERE x.version_id = 'v-' || pv.paycheck_id);",
    )
}

/// Paychecks used to carry free-form lines typed by kind. Fold them into the shared line items:
/// earnings become the gross, and each other line becomes (or reuses) an item in a bucket that
/// matches its kind. Employer contributions aren't taken out of a paycheck, so they're dropped.
fn migrate_free_form_lines(conn: &Connection) -> rusqlite::Result<()> {
    if !table_exists(conn, "paycheck_lines")? || !column_exists(conn, "paycheck_lines", "kind")? {
        return Ok(());
    }

    conn.execute(
        "UPDATE paychecks SET gross = COALESCE(
             (SELECT SUM(amount) FROM paycheck_lines
              WHERE paycheck_id = paychecks.id AND kind = 'earning'), 0)",
        [],
    )?;

    let lines: Vec<(String, String, String, f64)> = conn
        .prepare(
            "SELECT paycheck_id, name, kind, amount FROM paycheck_lines
             WHERE kind IN ('pretax', 'tax', 'posttax') ORDER BY position, rowid",
        )?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))?
        .collect::<Result<_, _>>()?;

    for (paycheck_id, name, kind, amount) in lines {
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM paycheck_items WHERE lower(label) = lower(?1) LIMIT 1",
                [&name],
                |row| row.get(0),
            )
            .ok();
        let item_id = match existing {
            Some(id) => id,
            None => {
                let id = format!("item-{}", uuid_like(conn)?);
                let bucket = match kind.as_str() {
                    "pretax" => "savings",
                    "tax" => "tax",
                    _ => "withholding",
                };
                conn.execute(
                    "INSERT INTO paycheck_items (id, label, bucket_id, position)
                     VALUES (?1, ?2, ?3, COALESCE((SELECT MAX(position) + 1 FROM paycheck_items), 0))",
                    rusqlite::params![id, name, bucket],
                )?;
                id
            }
        };
        conn.execute(
            "INSERT INTO paycheck_values (paycheck_id, item_id, amount) VALUES (?1, ?2, ?3)
             ON CONFLICT(paycheck_id, item_id) DO UPDATE SET amount = amount + excluded.amount",
            rusqlite::params![paycheck_id, item_id, amount],
        )?;
    }

    conn.execute("DROP TABLE paycheck_lines", [])?;
    Ok(())
}

fn uuid_like(conn: &Connection) -> rusqlite::Result<String> {
    conn.query_row("SELECT lower(hex(randomblob(8)))", [], |row| row.get(0))
}

/// Income categories used to point at a paycheck through `categories.paycheck_id`. Now the
/// paycheck is the category: move those deposits onto the paycheck's own id and remove the
/// stand-in category (keeping its color).
fn migrate_category_paycheck_links(conn: &Connection) -> rusqlite::Result<()> {
    if !column_exists(conn, "categories", "paycheck_id")? {
        return Ok(());
    }
    let links: Vec<(String, String, String)> = conn
        .prepare(
            "SELECT c.id, c.paycheck_id, c.color FROM categories c
             JOIN paychecks p ON p.id = c.paycheck_id
             WHERE c.paycheck_id IS NOT NULL AND c.id <> c.paycheck_id",
        )?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<Result<_, _>>()?;
    for (category_id, paycheck_id, color) in links {
        conn.execute(
            "UPDATE transactions SET category = ?2 WHERE category = ?1",
            rusqlite::params![category_id, paycheck_id],
        )?;
        conn.execute("UPDATE categories SET color = ?2 WHERE id = ?1", rusqlite::params![paycheck_id, color])?;
        conn.execute("DELETE FROM categories WHERE id = ?1", [&category_id])?;
    }
    conn.execute("UPDATE categories SET paycheck_id = NULL WHERE paycheck_id IS NOT NULL", [])?;
    Ok(())
}
