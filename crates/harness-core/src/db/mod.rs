//! SQLite handle: open/create the schema, expose a guarded connection.
//!
//! v0.1 uses a single connection behind a `Mutex` (one writer, serialized
//! readers). A reader pool is a future optimization, not a v0.1 need.

mod ai_impact;
mod authors;
mod calendar;
mod dora;
mod git;
mod incidents;
mod insights;
mod queries;
mod schema;
mod survey;

pub use ai_impact::{
    AiAdoptionBundle, AiAdoptionDayRow, AiCorrelationBundle, AiCorrelationCoeffs,
    AiCorrelationSeriesRow, AiImpactBundle, AiLinesBundle, AiLinesRow, AiLinesSummary, AiRoiBundle,
    AiRoiByGroupRow,
};
pub use authors::{AuthorDoraRow, AuthorRow};
pub use calendar::{MeetingDay, MeetingImpact};
pub use dora::{DoraBand, DoraMetric};
pub use git::{
    AiSplitGroup, AiSplitRow, CommitDailyRow, CommitRowDto, DeploymentDto, GithubRepo,
    GithubRepoMeta, ProductiveHourRow, PullRequestDto, SyncState,
};
pub use incidents::{IncidentDoraStats, IncidentDto};
pub use insights::{
    AllocationBundle, AllocationPeriodRow, AllocationRow, DeploymentTimelineRow, DoraBundle,
    DoraRepoRow, DoraTrendRow, FocusBlockRow, Grain, LeadTimeBucketRow, PrChurnSummary,
    PrCorrelationRow, PrCycleTimeRow, PrSizeBucketRow, ProductivityInsightsBundle,
    ProductivityPeriodRow, ProductivitySummary, WarmupBucketRow,
};
pub use queries::{
    AgentGroupRow, DailyRow, MessageDetail, ModelRow, OverviewUsageBundle, ProjectRow, PromptRow,
    ProviderObservedStats, ProviderSummary, SessionRow, SkillRow, Tip, ToolRow, Totals,
    WorkspaceRow,
};
pub use survey::{
    SurveyCorrelationBundle, SurveyCorrelationRow, SurveyResponseRow, SurveyTrendRow,
};

use crate::error::Result;
use rusqlite::{Connection, OpenFlags};
use std::path::Path;
use std::sync::Mutex;

pub struct Db {
    pub(crate) conn: Mutex<Connection>,
}

/// Apply idempotent `ADD COLUMN` migrations; a duplicate-column error means the
/// column is already present, which is fine.
fn run_migrations(conn: &Connection) {
    for stmt in schema::MIGRATIONS {
        let _ = conn.execute(stmt, []);
    }
}

impl Db {
    /// Open (creating parent dirs and the schema) a file-backed database in WAL mode.
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(path)?;
        // WAL for concurrent readers; mmap + a larger page cache make the read-heavy
        // aggregations meaningfully faster (~1.8x measured) at no correctness cost.
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA mmap_size=268435456;
             PRAGMA cache_size=-65536;
             PRAGMA temp_store=MEMORY;",
        )?;
        conn.execute_batch(schema::SCHEMA_SQL)?;
        run_migrations(&conn);
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// In-memory database (tests).
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(schema::SCHEMA_SQL)?;
        run_migrations(&conn);
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Open a read-only connection to an existing database. WAL allows many
    /// concurrent readers, so callers can fan out independent queries across
    /// several of these connections (e.g. the overview bundle).
    pub fn open_read(path: &Path) -> Result<Self> {
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        conn.execute_batch(
            "PRAGMA mmap_size=268435456;
             PRAGMA cache_size=-65536;
             PRAGMA temp_store=MEMORY;",
        )?;
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
