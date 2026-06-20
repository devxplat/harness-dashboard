//! SQLite handle: open/create the schema, expose a guarded connection.
//!
//! v0.1 uses a single connection behind a `Mutex` (one writer, serialized
//! readers). A reader pool is a future optimization, not a v0.1 need.

mod queries;
mod schema;

pub use queries::{
    DailyRow, MessageDetail, ModelRow, ProjectRow, PromptRow, SessionRow, ToolRow, Totals,
};

use crate::error::Result;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

pub struct Db {
    pub(crate) conn: Mutex<Connection>,
}

impl Db {
    /// Open (creating parent dirs and the schema) a file-backed database in WAL mode.
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
        conn.execute_batch(schema::SCHEMA_SQL)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// In-memory database (tests).
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(schema::SCHEMA_SQL)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Count of stored message rows — a cheap sanity check.
    pub fn message_count(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_in_memory_with_schema() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(db.message_count().unwrap(), 0);
    }
}
