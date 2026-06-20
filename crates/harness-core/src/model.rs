//! In-memory representations of a parsed transcript record.

use serde::{Deserialize, Serialize};

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
