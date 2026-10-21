use anyhow::{Context, Result, bail};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};

struct Migration {
    name: &'static str,
    sql: &'static str,
}
const MIGRATIONS: &[Migration] = &[
    Migration {
        name: "documents",
        sql: include_str!("../migrations/001_documents.sql"),
    },
    Migration {
        name: "review_indexes",
        sql: include_str!("../migrations/002_review_indexes.sql"),
    },
    Migration {
        name: "language_preference",
        sql: include_str!("../migrations/003_language_preference.sql"),
    },
    Migration { name: "workspace_scope", sql: include_str!("../migrations/004_workspace_scope.sql") },
];
pub const VERSION: u32 = MIGRATIONS.len() as u32;
pub fn version(connection: &Connection) -> Result<u32> {
    Ok(connection.pragma_query_value(None, "user_version", |row| row.get(0))?)
}
pub fn migrate(connection: &mut Connection) -> Result<()> {
    apply(connection, MIGRATIONS)
}
fn apply(connection: &mut Connection, migrations: &[Migration]) -> Result<()> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let current = version(&transaction)?;
    if current > migrations.len() as u32 {
        bail!(
            "Database schema {current} is newer than this app supports ({}). Install a newer diffcity build; the database was not changed.",
            migrations.len()
        );
    }
    let had_history: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations')", [], |r| r.get(0))?;
    if current > 1 && !had_history {
        bail!("Migration history is missing; database left unchanged");
    }
    transaction.execute_batch("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);")?;
    for (index, migration) in migrations.iter().enumerate() {
        let version = index as u32 + 1;
        let checksum = crate::domain::hash(migration.sql);
        if version <= current {
            let recorded: Option<(String, String)> = transaction
                .query_row(
                    "SELECT name, checksum FROM schema_migrations WHERE version=?1",
                    [version],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            match recorded {
                Some((name, hash)) if name == migration.name && hash == checksum => continue,
                None if current == 1 && !had_history => {} // Adopt the original alpha schema.
                _ => bail!(
                    "Migration {version} differs from recorded history; database left unchanged"
                ),
            }
        } else {
            transaction.execute_batch(migration.sql).with_context(|| {
                format!(
                    "Database migration {version} ({}) failed; changes rolled back",
                    migration.name
                )
            })?;
        }
        transaction.execute(
            "INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES(?1,?2,?3,?4)",
            params![
                version,
                migration.name,
                checksum,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
    }
    transaction.pragma_update(None, "user_version", migrations.len() as u32)?;
    transaction.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fresh_and_repeated_startup_are_idempotent() {
        let mut db = Connection::open_in_memory().unwrap();
        migrate(&mut db).unwrap();
        migrate(&mut db).unwrap();
        assert_eq!(version(&db).unwrap(), VERSION);
        assert_eq!(
            db.query_row("SELECT count(*) FROM schema_migrations", [], |r| r
                .get::<_, u32>(0))
                .unwrap(),
            VERSION
        );
    }
    #[test]
    fn legacy_upgrade_preserves_drafts_and_preferences() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch(MIGRATIONS[0].sql).unwrap();
        db.execute_batch("PRAGMA user_version=1; INSERT INTO documents VALUES('note','private','{\"body\":\"keep\",\"snapshotId\":\"revision\"}','now'); INSERT INTO documents VALUES('settings','main','{\"theme\":\"dark\"}','now');").unwrap();
        migrate(&mut db).unwrap();
        assert_eq!(
            db.query_row(
                "SELECT json_extract(value,'$.body') FROM documents WHERE kind='note'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "keep"
        );
        assert_eq!(
            db.query_row(
                "SELECT value FROM documents WHERE kind='settings'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            r#"{"theme":"dark","locale":"en"}"#
        );
    }
    #[test]
    fn a_failed_step_rolls_back_the_whole_upgrade() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch(MIGRATIONS[0].sql).unwrap();
        db.pragma_update(None, "user_version", 1).unwrap();
        let steps = [
            Migration {
                name: "documents",
                sql: MIGRATIONS[0].sql,
            },
            Migration {
                name: "broken",
                sql: "CREATE TABLE scratch(id INTEGER); INSERT INTO missing VALUES(1);",
            },
        ];
        assert!(apply(&mut db, &steps).is_err());
        assert_eq!(version(&db).unwrap(), 1);
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM sqlite_master WHERE name IN ('scratch','schema_migrations')",
                [],
                |r| r.get::<_, u32>(0)
            )
            .unwrap(),
            0
        );
    }
    #[test]
    fn future_versions_and_changed_history_are_rejected() {
        let mut db = Connection::open_in_memory().unwrap();
        db.pragma_update(None, "user_version", 99).unwrap();
        assert!(migrate(&mut db).is_err());
        assert_eq!(version(&db).unwrap(), 99);
        db.pragma_update(None, "user_version", 0).unwrap();
        migrate(&mut db).unwrap();
        db.execute(
            "UPDATE schema_migrations SET checksum='changed' WHERE version=2",
            [],
        )
        .unwrap();
        assert!(migrate(&mut db).is_err());
        assert_eq!(version(&db).unwrap(), VERSION);
    }
}
