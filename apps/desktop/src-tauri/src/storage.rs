use crate::contracts::*;
use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Serialize, de::DeserializeOwned};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

pub struct Store {
    connection: Mutex<Connection>,
    pub directory: PathBuf,
}

impl Store {
    pub fn open(directory: &Path) -> Result<Self> {
        std::fs::create_dir_all(directory)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))?;
        }
        let mut connection = Connection::open(directory.join("diffcity.sqlite"))?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;",
        )?;
        let version = crate::migrations::version(&connection)?;
        if version > 0 && version < crate::migrations::VERSION {
            let backup = directory.join(format!(
                "before-schema-{version}-{}.sqlite",
                chrono::Utc::now().timestamp_millis()
            ));
            connection
                .execute("VACUUM INTO ?1", [backup.to_string_lossy().as_ref()])
                .context("Could not back up the database before its schema upgrade")?;
        }
        crate::migrations::migrate(&mut connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
            directory: directory.to_path_buf(),
        })
    }
    pub fn get<T: DeserializeOwned>(&self, kind: &str, key: &str) -> Result<Option<T>> {
        let db = self
            .connection
            .lock()
            .map_err(|_| anyhow::anyhow!("Local database lock unavailable"))?;
        let text: Option<String> = db
            .query_row(
                "SELECT value FROM documents WHERE kind=?1 AND key=?2",
                params![kind, key],
                |r| r.get(0),
            )
            .optional()?;
        text.map(|s| serde_json::from_str(&s).context("Local data could not be decoded"))
            .transpose()
    }
    pub fn put<T: Serialize>(&self, kind: &str, key: &str, value: &T) -> Result<()> {
        let text = serde_json::to_string(value)?;
        let db = self
            .connection
            .lock()
            .map_err(|_| anyhow::anyhow!("Local database lock unavailable"))?;
        db.execute("INSERT INTO documents(kind,key,value,updated) VALUES(?1,?2,?3,?4) ON CONFLICT(kind,key) DO UPDATE SET value=excluded.value,updated=excluded.updated", params![kind,key,text,chrono::Utc::now().to_rfc3339()])?;
        Ok(())
    }
    pub fn list<T: DeserializeOwned>(&self, kind: &str) -> Result<Vec<T>> {
        let db = self
            .connection
            .lock()
            .map_err(|_| anyhow::anyhow!("Local database lock unavailable"))?;
        let mut stmt = db.prepare("SELECT value FROM documents WHERE kind=?1 ORDER BY updated")?;
        stmt.query_map([kind], |r| r.get::<_, String>(0))?
            .map(|s| Ok(serde_json::from_str(&s?)?))
            .collect()
    }
    pub fn batch(&self, documents: &[(&str, &str, serde_json::Value)]) -> Result<()> {
        let mut db = self
            .connection
            .lock()
            .map_err(|_| anyhow::anyhow!("Local database lock unavailable"))?;
        let transaction = db.transaction()?;
        let updated = chrono::Utc::now().to_rfc3339();
        for (kind, key, value) in documents {
            transaction.execute("INSERT INTO documents(kind,key,value,updated) VALUES(?1,?2,?3,?4) ON CONFLICT(kind,key) DO UPDATE SET value=excluded.value,updated=excluded.updated", params![kind,key,serde_json::to_string(value)?,updated])?;
        }
        transaction.commit()?;
        Ok(())
    }
    pub fn delete(&self, kind: &str, key: &str) -> Result<()> {
        self.connection
            .lock()
            .map_err(|_| anyhow::anyhow!("Local database lock unavailable"))?
            .execute(
                "DELETE FROM documents WHERE kind=?1 AND key=?2",
                params![kind, key],
            )?;
        Ok(())
    }
    pub fn settings(&self) -> Result<Settings> {
        Ok(self.get("settings", "main")?.unwrap_or(Settings {
            repositories: vec!["crs48/diffcity".into()],
            theme: "system".into(),
            locale: "en".into(),
            completed_days: default_completed_days(),
            ..Settings::default()
        }))
    }
    pub fn notes(&self, snapshot: &str) -> Result<Vec<Note>> {
        Ok({
            let db = self
                .connection
                .lock()
                .map_err(|_| anyhow::anyhow!("Local database lock unavailable"))?;
            let mut stmt = db.prepare("SELECT value FROM documents WHERE kind='note' AND json_extract(value,'$.snapshotId')=?1 ORDER BY updated")?;
            stmt.query_map([snapshot], |r| r.get::<_, String>(0))?
                .map(|value| Ok(serde_json::from_str(&value?)?))
                .collect::<Result<Vec<Note>>>()?
        })
    }
    pub fn previous_snapshot(&self, snapshot: &Snapshot) -> Result<Option<String>> {
        let db = self
            .connection
            .lock()
            .map_err(|_| anyhow::anyhow!("Local database lock unavailable"))?;
        // Only return the ID. Opening one review must not deserialize every saved diff.
        Ok(db.query_row(
            "SELECT key FROM documents WHERE kind='snapshot' AND json_extract(value,'$.pull.repository')=?1 COLLATE NOCASE AND json_extract(value,'$.pull.number')=?2 AND key!=?3 AND json_extract(value,'$.capturedAt')<?4 ORDER BY json_extract(value,'$.capturedAt') DESC LIMIT 1",
            params![snapshot.pull.repository, snapshot.pull.number, snapshot.id, snapshot.captured_at],
            |row| row.get(0),
        ).optional()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn drafts_survive_connection_restart() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        store
            .put("draft", "id", &vec!["private", "line 4"])
            .unwrap();
        drop(store);
        let restored = Store::open(dir.path()).unwrap();
        assert_eq!(
            restored.get::<Vec<String>>("draft", "id").unwrap().unwrap(),
            vec!["private", "line 4"]
        );
    }
    #[test]
    fn failed_publication_batch_rolls_back_all_documents() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path()).unwrap();
        store.connection.lock().unwrap().execute_batch(
            "CREATE TRIGGER fail_note BEFORE INSERT ON documents WHEN NEW.kind='note' BEGIN SELECT RAISE(ABORT, 'simulated disk write failure'); END;"
        ).unwrap();
        let result = store.batch(&[
            (
                "operation",
                "review",
                serde_json::json!({"state":"published"}),
            ),
            ("note", "draft", serde_json::json!({"published":true})),
        ]);
        assert!(result.is_err());
        assert!(
            store
                .get::<serde_json::Value>("operation", "review")
                .unwrap()
                .is_none()
        );
        assert!(
            store
                .get::<serde_json::Value>("note", "draft")
                .unwrap()
                .is_none()
        );
    }
}
