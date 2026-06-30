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
mod pr_dashboard;
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
    GithubRepoMeta, ProductiveHourRow, PullRequestDto, PullRequestEventDto, SyncState,
};
pub use incidents::{IncidentDoraStats, IncidentDto};
pub use insights::{
    AllocationBundle, AllocationPeriodRow, AllocationRow, DeploymentTimelineRow, DoraBundle,
    DoraRepoRow, DoraTrendRow, FocusBlockRow, Grain, LeadTimeBucketRow, PrChurnSummary,
    PrCorrelationRow, PrCycleTimeRow, PrSizeBucketRow, ProductivityInsightsBundle,
    ProductivityPeriodRow, ProductivitySummary, WarmupBucketRow,
};
pub use pr_dashboard::{
    PrAiIndex, PrAnalyticsTile, PrAuthorOption, PrDashboardBundle, PrDashboardQuery,
    PrDashboardRow, PrDeploymentRef, PrDeterministicInsightsPage, PrFileRef, PrFilterOptions,
    PrGrain, PrIncidentRef, PrInsight, PrInsightRule, PrPagination, PrPeriodRow, PrRef,
    PrRelatedCommit, PrSessionCandidateGroup, PrSessionCorrelation, PrSessionCorrelationConfig,
    PrSessionCorrelationWeights, PrSummary,
};
pub use queries::{
    AgentGroupRow, ContextWindowComponent, ContextWindowDetail, DailyRow, MessageDetail, ModelRow,
    OverviewUsageBundle, PlanUsageSnapshotWindow, PlanUsageWindow, ProjectRow, PromptRow,
    ProviderObservedStats, ProviderPlanSelection, ProviderSnapshotStatus, ProviderSummary,
    SessionBundle, SessionRow, SkillRow, Tip, ToolRow, Totals, WorkspaceRow,
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
        // Existing databases may have old tables without columns referenced by
        // newer indexes in SCHEMA_SQL. Run migrations first for upgrades, then
        // again after SCHEMA_SQL for brand-new tables created on this open.
        run_migrations(&conn);
        conn.execute_batch(schema::SCHEMA_SQL)?;
        run_migrations(&conn);
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// In-memory database (tests).
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        run_migrations(&conn);
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
    use rusqlite::Connection;
    use std::path::{Path, PathBuf};

    fn remove_db_family(path: &Path) {
        for ext in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(PathBuf::from(format!("{}{}", path.display(), ext)));
        }
    }

    fn temp_db_path(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "harness-dashboard-{name}-{}-{nanos}.db",
            std::process::id()
        ))
    }

    #[test]
    fn opens_in_memory_with_schema() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(db.message_count().unwrap(), 0);
    }

    #[test]
    fn opens_legacy_db_before_creating_provider_indexes() {
        let path = temp_db_path("legacy-provider");
        remove_db_family(&path);

        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE messages (
                    uuid                   TEXT PRIMARY KEY,
                    parent_uuid            TEXT,
                    session_id             TEXT NOT NULL,
                    project_slug           TEXT NOT NULL,
                    cwd                    TEXT,
                    git_branch             TEXT,
                    cc_version             TEXT,
                    entrypoint             TEXT,
                    type                   TEXT NOT NULL,
                    is_sidechain           INTEGER NOT NULL DEFAULT 0,
                    agent_id               TEXT,
                    timestamp              TEXT NOT NULL,
                    model                  TEXT,
                    stop_reason            TEXT,
                    prompt_id              TEXT,
                    message_id             TEXT,
                    input_tokens           INTEGER NOT NULL DEFAULT 0,
                    output_tokens          INTEGER NOT NULL DEFAULT 0,
                    cache_read_tokens      INTEGER NOT NULL DEFAULT 0,
                    cache_create_5m_tokens INTEGER NOT NULL DEFAULT 0,
                    cache_create_1h_tokens INTEGER NOT NULL DEFAULT 0,
                    prompt_text            TEXT,
                    prompt_chars           INTEGER,
                    tool_calls_json        TEXT,
                    attribution_skill      TEXT
                );
                CREATE TABLE tool_calls (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_uuid  TEXT NOT NULL,
                    session_id    TEXT NOT NULL,
                    project_slug  TEXT NOT NULL,
                    tool_name     TEXT NOT NULL,
                    target        TEXT,
                    result_tokens INTEGER,
                    is_error      INTEGER NOT NULL DEFAULT 0,
                    timestamp     TEXT NOT NULL,
                    tool_use_id   TEXT
                );",
            )
            .unwrap();
        }

        let db = Db::open(&path).unwrap();
        let conn = db.conn.lock().unwrap();
        let provider_columns: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name='provider'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let provider_indexes: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_messages_ts_provider'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(provider_columns, 1);
        assert_eq!(provider_indexes, 1);
        drop(conn);
        drop(db);

        remove_db_family(&path);
    }
}
