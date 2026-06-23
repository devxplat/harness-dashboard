//! In-memory representations of a parsed transcript record.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

/// Supported local AI coding providers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderId {
    Claude,
    Codex,
    Gemini,
    Cursor,
    Antigravity,
    Copilot,
    Opencode,
}

impl ProviderId {
    pub const ALL: [ProviderId; 7] = [
        ProviderId::Claude,
        ProviderId::Codex,
        ProviderId::Gemini,
        ProviderId::Cursor,
        ProviderId::Antigravity,
        ProviderId::Copilot,
        ProviderId::Opencode,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            ProviderId::Claude => "claude",
            ProviderId::Codex => "codex",
            ProviderId::Gemini => "gemini",
            ProviderId::Cursor => "cursor",
            ProviderId::Antigravity => "antigravity",
            ProviderId::Copilot => "copilot",
            ProviderId::Opencode => "opencode",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            ProviderId::Claude => "Claude Code",
            ProviderId::Codex => "Codex",
            ProviderId::Gemini => "Gemini CLI",
            ProviderId::Cursor => "Cursor",
            ProviderId::Antigravity => "Antigravity",
            ProviderId::Copilot => "GitHub Copilot",
            ProviderId::Opencode => "opencode",
        }
    }
}

impl fmt::Display for ProviderId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for ProviderId {
    type Err = ();

    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "claude" | "claude-code" => Ok(ProviderId::Claude),
            "codex" | "openai" => Ok(ProviderId::Codex),
            "gemini" | "gemini-cli" => Ok(ProviderId::Gemini),
            "cursor" => Ok(ProviderId::Cursor),
            "antigravity" | "antigravity-ide" => Ok(ProviderId::Antigravity),
            "copilot" | "github-copilot" | "github_copilot" => Ok(ProviderId::Copilot),
            "opencode" | "open-code" => Ok(ProviderId::Opencode),
            _ => Err(()),
        }
    }
}

/// How trustworthy and complete the token usage fields are.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageSource {
    Exact,
    ProviderReported,
    Unavailable,
}

impl UsageSource {
    pub fn as_str(self) -> &'static str {
        match self {
            UsageSource::Exact => "exact",
            UsageSource::ProviderReported => "provider_reported",
            UsageSource::Unavailable => "unavailable",
        }
    }
}

/// Provenance for the cost surfaced on a row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CostSource {
    ApiEstimate,
    ProviderReported,
    Unavailable,
}

impl CostSource {
    pub fn as_str(self) -> &'static str {
        match self {
            CostSource::ApiEstimate => "api_estimate",
            CostSource::ProviderReported => "provider_reported",
            CostSource::Unavailable => "unavailable",
        }
    }
}

/// Token tallies read from `message.usage`. Never summed across snapshot siblings.
#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize)]
pub struct Usage {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_create_5m_tokens: i64,
    pub cache_create_1h_tokens: i64,
}

impl Usage {
    /// input + output + cache creation (both TTLs). Cache reads are priced separately.
    pub fn billable(&self) -> i64 {
        self.input_tokens
            + self.output_tokens
            + self.cache_create_5m_tokens
            + self.cache_create_1h_tokens
    }
}

/// One extracted tool invocation (or a synthetic `Skill` / `_tool_result` pseudo-row).
#[derive(Debug, Clone)]
pub struct ToolCall {
    pub tool_name: String,
    pub target: Option<String>,
    pub tool_use_id: Option<String>,
    pub result_tokens: Option<i64>,
    pub is_error: bool,
}

/// A parsed transcript line: the message row plus the tool calls it contributes.
#[derive(Debug, Clone)]
pub struct MessageRow {
    pub uuid: String,
    pub provider: ProviderId,
    pub parent_uuid: Option<String>,
    pub session_id: String,
    pub project_slug: String,
    pub cwd: Option<String>,
    pub git_branch: Option<String>,
    pub cc_version: Option<String>,
    pub entrypoint: Option<String>,
    pub msg_type: String,
    pub is_sidechain: bool,
    pub agent_id: Option<String>,
    pub timestamp: String,
    pub model: Option<String>,
    pub stop_reason: Option<String>,
    pub prompt_id: Option<String>,
    pub message_id: Option<String>,
    pub usage: Usage,
    pub usage_source: UsageSource,
    pub reported_cost_usd: Option<f64>,
    pub cost_source: CostSource,
    pub source_path: Option<String>,
    pub source_key: Option<String>,
    pub source_fingerprint: Option<String>,
    pub prompt_text: Option<String>,
    pub attribution_skill: Option<String>,
    pub tool_calls: Vec<ToolCall>,
}

/// Compact tool-call shape stored as JSON on the message row for the UI.
#[derive(Debug, Clone, Serialize)]
pub struct ToolCallBrief {
    pub name: String,
    pub target: Option<String>,
}

/// One parsed git commit, ready to insert. The mirror of [`MessageRow`] for the
/// local-git data source. `ai_coauthor_trailer` is decided at parse time from the
/// message; `ai_session_overlap` is computed later in the DB (correlation pass),
/// so it is not carried here.
#[derive(Debug, Clone)]
pub struct CommitRow {
    pub sha: String,
    pub project_slug: Option<String>,
    pub author_name: Option<String>,
    pub author_email: Option<String>,
    /// UTC instant, RFC3339 "…Z" — comparable to `messages.timestamp`.
    pub authored_at_utc: String,
    /// The author's local wall-clock (their own commit tz offset), with offset.
    pub authored_at_local: Option<String>,
    pub authored_tz_offset_min: i32,
    pub authored_local_hour: i32,
    /// 0=Sunday..6=Saturday (matches SQLite `strftime('%w')`).
    pub authored_dow: i32,
    pub committed_at_utc: Option<String>,
    pub branch: Option<String>,
    pub message: Option<String>,
    pub subject: Option<String>,
    pub is_merge: bool,
    pub files_changed: i64,
    pub insertions: i64,
    pub deletions: i64,
    pub ai_coauthor_trailer: bool,
    /// `Co-authored-by:` trailers, each "Name <email>" verbatim.
    pub coauthors: Vec<String>,
}

/// A GitHub pull request, parsed from the REST API, ready to insert. Times are
/// RFC3339 "…Z" so they compare directly with messages/commits.
#[derive(Debug, Clone)]
pub struct PullRequestRow {
    pub number: i64,
    pub title: Option<String>,
    /// open | closed | merged (merged takes precedence over closed).
    pub state: Option<String>,
    pub author: Option<String>,
    pub created_at_utc: Option<String>,
    pub merged_at_utc: Option<String>,
    pub closed_at_utc: Option<String>,
    pub head_branch: Option<String>,
    pub base_branch: Option<String>,
    pub additions: i64,
    pub deletions: i64,
    pub changed_files: i64,
    pub review_count: i64,
    pub first_review_at_utc: Option<String>,
    pub merge_commit_sha: Option<String>,
    pub html_url: Option<String>,
}

/// A deployment-like event: a git tag, a GitHub release, or an Actions run.
#[derive(Debug, Clone)]
pub struct DeploymentRow {
    pub kind: String, // tag | release | run
    pub ext_id: String,
    pub name: Option<String>,
    pub created_at_utc: Option<String>,
    pub status: Option<String>, // success | failure | None
    pub sha: Option<String>,
    pub html_url: Option<String>,
}

/// An incident, parsed from a source (GitHub issues today). Times are RFC3339 "…Z".
/// The `deploy_*` correlation columns are filled later in the DB, not at parse time.
#[derive(Debug, Clone)]
pub struct IncidentRow {
    pub source: String,
    pub repo_key: Option<String>,
    pub ext_id: String,
    pub title: Option<String>,
    pub severity: Option<String>,
    pub opened_at_utc: Option<String>,
    pub resolved_at_utc: Option<String>,
    pub state: Option<String>,
    pub html_url: Option<String>,
}

/// A calendar event, parsed from the Google Calendar API, ready to insert.
#[derive(Debug, Clone)]
pub struct CalendarEventRow {
    pub event_id: String,
    pub calendar_id: Option<String>,
    pub start_utc: Option<String>,
    pub end_utc: Option<String>,
    pub title: Option<String>,
    pub attendee_count: i64,
    pub is_busy: bool,
    pub updated_at_utc: Option<String>,
}
