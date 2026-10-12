use rusqlite::{params, Connection};

/// Create the tables owned by the taxes feature. Called from `crate::db::init_db`. Table names
/// are prefixed with `taxes_` so they never collide with other features.
pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let had_items = table_exists(conn, "taxes_items")?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS taxes_years (
             year INTEGER PRIMARY KEY
         );
         CREATE TABLE IF NOT EXISTS taxes_household_values (
             year INTEGER NOT NULL,
             field TEXT NOT NULL,
             value REAL NOT NULL,
             PRIMARY KEY (year, field)
         );
         CREATE TABLE IF NOT EXISTS taxes_items (
             id TEXT PRIMARY KEY,
             year INTEGER NOT NULL,
             section TEXT NOT NULL,
             name TEXT NOT NULL,
             ytd REAL NOT NULL DEFAULT 0,
             last_paycheck REAL NOT NULL DEFAULT 0,
             paychecks_left REAL NOT NULL DEFAULT 0,
             position INTEGER NOT NULL DEFAULT 0
         );",
    )?;

    if !had_items {
        migrate_legacy(conn)?;
    }
    Ok(())
}

fn table_exists(conn: &Connection, name: &str) -> rusqlite::Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        params![name],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

// Earlier versions kept per-person paycheck numbers (`taxes_person_values`), then separate
// `taxes_other_income` and `taxes_deductions` tables. Fold whatever exists into `taxes_items`,
// once, when that table is first created. The legacy tables are left untouched (never dropped) so
// no saved data is destroyed; nothing reads them afterwards.
//
// A person's paycheck/withholding line is named "<Person> paycheck" when there are several
// people, and plain "Paycheck" otherwise.
fn migrate_legacy(conn: &Connection) -> rusqlite::Result<()> {
    let years = conn
        .prepare("SELECT year FROM taxes_years ORDER BY year")?
        .query_map([], |row| row.get::<_, i64>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    let people: Vec<(String, String)> = if table_exists(conn, "taxes_people")? {
        conn.prepare("SELECT id, name FROM taxes_people ORDER BY position")?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        Vec::new()
    };
    let has_values = table_exists(conn, "taxes_person_values")?;
    let has_other_income = table_exists(conn, "taxes_other_income")?;
    let has_deductions = table_exists(conn, "taxes_deductions")?;

    let value = |person: &str, year: i64, field: &str| -> f64 {
        if !has_values {
            return 0.0;
        }
        conn.query_row(
            "SELECT value FROM taxes_person_values WHERE person_id = ?1 AND year = ?2 AND field = ?3",
            params![person, year, field],
            |row| row.get(0),
        )
        .unwrap_or(0.0)
    };

    let insert = |id: &str, year: i64, section: &str, name: &str, ytd: f64, last: f64, left: f64, position: i64| {
        conn.execute(
            "INSERT INTO taxes_items (id, year, section, name, ytd, last_paycheck, paychecks_left, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, year, section, name, ytd, last, left, position],
        )
    };

    for year in years {
        // Income: each person's paycheck, then the other-income lines.
        let mut position = 0_i64;
        for (person_id, person_name) in &people {
            let ytd = value(person_id, year, "ytd.earnings");
            let last = value(person_id, year, "last.earnings");
            if ytd == 0.0 && last == 0.0 {
                continue;
            }
            let name = if people.len() > 1 {
                format!("{person_name} paycheck")
            } else {
                "Paycheck".to_string()
            };
            let left = value(person_id, year, "paychecksLeft");
            insert(&format!("migrated-{year}-income-{position}"), year, "income", &name, ytd, last, left, position)?;
            position += 1;
        }
        if has_other_income {
            let rows = conn
                .prepare("SELECT id, name, amount FROM taxes_other_income WHERE year = ?1 ORDER BY position")?
                .query_map(params![year], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, f64>(2)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (id, name, amount) in rows {
                insert(&id, year, "income", &name, amount, 0.0, 0.0, position)?;
                position += 1;
            }
        }

        // Deductions: the dedicated table if it exists, else the old per-person 401(k)/HSA values.
        if has_deductions {
            let rows = conn
                .prepare(
                    "SELECT id, name, ytd, last_paycheck, paychecks_left, position
                     FROM taxes_deductions WHERE year = ?1 ORDER BY position",
                )?
                .query_map(params![year], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, f64>(2)?,
                        row.get::<_, f64>(3)?,
                        row.get::<_, f64>(4)?,
                        row.get::<_, i64>(5)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (id, name, ytd, last, left, pos) in rows {
                insert(&id, year, "deduction", &name, ytd, last, left, pos)?;
            }
        } else {
            let mut pos = 0_i64;
            for (key, label) in [("trad401k", "401(k)"), ("hsa", "HSA")] {
                for (person_id, person_name) in &people {
                    let ytd = value(person_id, year, &format!("ytd.{key}"));
                    let last = value(person_id, year, &format!("last.{key}"));
                    if ytd == 0.0 && last == 0.0 {
                        continue;
                    }
                    let name = if people.len() > 1 {
                        format!("{person_name} {label}")
                    } else {
                        label.to_string()
                    };
                    let left = value(person_id, year, "paychecksLeft");
                    insert(&format!("migrated-{year}-deduction-{pos}"), year, "deduction", &name, ytd, last, left, pos)?;
                    pos += 1;
                }
            }
        }

        // Withholdings: each person's federal tax.
        let mut pos = 0_i64;
        for (person_id, person_name) in &people {
            let ytd = value(person_id, year, "ytd.federalTax");
            let last = value(person_id, year, "last.federalTax");
            if ytd == 0.0 && last == 0.0 {
                continue;
            }
            let name = if people.len() > 1 {
                format!("{person_name} federal tax")
            } else {
                "Federal tax".to_string()
            };
            let left = value(person_id, year, "paychecksLeft");
            insert(&format!("migrated-{year}-withholding-{pos}"), year, "withholding", &name, ytd, last, left, pos)?;
            pos += 1;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Builds the legacy schema (people values + other income + deductions), then checks the
    // one-time migration folds everything into taxes_items, and only runs once.
    #[test]
    fn migrates_legacy_tables_once() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE taxes_years (year INTEGER PRIMARY KEY);
             CREATE TABLE taxes_people (id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE taxes_person_values (person_id TEXT, year INTEGER, field TEXT, value REAL,
                 PRIMARY KEY (person_id, year, field));
             CREATE TABLE taxes_other_income (id TEXT PRIMARY KEY, year INTEGER, name TEXT, amount REAL, position INTEGER);
             CREATE TABLE taxes_deductions (id TEXT PRIMARY KEY, year INTEGER, name TEXT, ytd REAL,
                 last_paycheck REAL, paychecks_left REAL, position INTEGER);
             INSERT INTO taxes_years VALUES (2026);
             INSERT INTO taxes_people VALUES ('s', 'Stephen', 0), ('r', 'Rachel', 1);
             INSERT INTO taxes_person_values VALUES
                 ('s', 2026, 'ytd.earnings', 111130), ('s', 2026, 'last.earnings', 7038),
                 ('s', 2026, 'ytd.federalTax', 20318), ('s', 2026, 'last.federalTax', 1256),
                 ('s', 2026, 'paychecksLeft', 10),
                 ('r', 2026, 'ytd.earnings', 89996), ('r', 2026, 'last.earnings', 6250),
                 ('r', 2026, 'paychecksLeft', 8);
             INSERT INTO taxes_other_income VALUES ('o1', 2026, 'Interest', 2000, 0);
             INSERT INTO taxes_deductions VALUES ('d1', 2026, '401(k)', 2661, 163, 8, 0);",
        )
        .unwrap();

        migrate(&conn).unwrap();

        let rows: Vec<(String, String, f64, f64, f64)> = conn
            .prepare(
                "SELECT section, name, ytd, last_paycheck, paychecks_left FROM taxes_items
                 ORDER BY section, position",
            )
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            rows,
            vec![
                ("deduction".into(), "401(k)".into(), 2661.0, 163.0, 8.0),
                ("income".into(), "Stephen paycheck".into(), 111130.0, 7038.0, 10.0),
                ("income".into(), "Rachel paycheck".into(), 89996.0, 6250.0, 8.0),
                ("income".into(), "Interest".into(), 2000.0, 0.0, 0.0),
                ("withholding".into(), "Stephen federal tax".into(), 20318.0, 1256.0, 10.0),
            ]
        );

        // A second run must not duplicate anything.
        migrate(&conn).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM taxes_items", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 5);
    }

    #[test]
    fn fresh_database_starts_empty() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM taxes_items", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }
}
