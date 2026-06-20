//! Parse one Claude Code transcript line into a [`MessageRow`] plus its tool calls.
//!
//! Lines are parsed defensively as `serde_json::Value` because the transcript
//! schema varies across Claude Code versions; we read the fields we know and
//! ignore the rest.

use crate::model::{MessageRow, ToolCall, Usage};
use serde_json::Value;
use std::sync::OnceLock;

/// Tool name → the input field we surface as its `target`.
fn target_for(tool: &str, input: &Value) -> Option<String> {
    let key = match tool {
        "Read" | "Edit" | "Write" | "NotebookEdit" => "file_path",
        "Bash" => "command",
        "WebFetch" => "url",
        "WebSearch" => "query",
        "Glob" | "Grep" => "pattern",
        "Task" | "Agent" => "subagent_type",
        "Skill" => "skill",
        _ => return None,
    };
    input
        .get(key)
        .and_then(Value::as_str)
        .map(|s| truncate(s, 2000))
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect()
    }
}

/// Approximate token size of a `tool_result` content value (chars / 4).
fn content_chars(v: &Value) -> usize {
    match v {
        Value::String(s) => s.chars().count(),
        Value::Array(a) => a.iter().map(content_chars).sum(),
        Value::Object(o) => o
            .get("text")
            .and_then(Value::as_str)
            .map(|s| s.chars().count())
            .unwrap_or_else(|| v.to_string().chars().count()),
        _ => 0,
    }
}

fn usage_from(message: &Value) -> Usage {
    let u = match message.get("usage") {
        Some(u) => u,
        None => return Usage::default(),
    };
    let get = |k: &str| u.get(k).and_then(Value::as_i64).unwrap_or(0);
    let cc = u.get("cache_creation");
    let cc_get = |k: &str| {
        cc.and_then(|c| c.get(k))
            .and_then(Value::as_i64)
            .unwrap_or(0)
    };
    Usage {
        input_tokens: get("input_tokens"),
        output_tokens: get("output_tokens"),
        cache_read_tokens: get("cache_read_input_tokens"),
        cache_create_5m_tokens: cc_get("ephemeral_5m_input_tokens"),
        cache_create_1h_tokens: cc_get("ephemeral_1h_input_tokens"),
    }
}

fn slash_command_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| {
        regex::Regex::new(r"<command-name>\s*/?([\w:.\-]+)\s*</command-name>").unwrap()
    })
}

/// Parse a single JSONL line. Returns `None` for lines that are not message
/// records (e.g. summaries) or that lack the identifying fields.
pub fn parse_line(line: &str, project_slug: &str) -> Option<MessageRow> {
    let v: Value = serde_json::from_str(line).ok()?;
    let uuid = v.get("uuid")?.as_str()?.to_string();
    let session_id = v.get("sessionId")?.as_str()?.to_string();
    let timestamp = v.get("timestamp")?.as_str()?.to_string();
    let msg_type = v.get("type")?.as_str()?.to_string();

    let str_field = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
    let message = v.get("message").cloned().unwrap_or(Value::Null);

    let mut prompt_text: Option<String> = None;
    let mut tool_calls: Vec<ToolCall> = Vec::new();

    match message.get("content") {
        Some(Value::String(s)) if msg_type == "user" => {
            prompt_text = Some(s.clone());
        }
        Some(Value::Array(blocks)) => {
            let mut texts: Vec<String> = Vec::new();
            for b in blocks {
                match b.get("type").and_then(Value::as_str) {
                    Some("text") => {
                        if let Some(t) = b.get("text").and_then(Value::as_str) {
                            texts.push(t.to_string());
                        }
                    }
                    Some("tool_use") => {
                        if let Some(name) = b.get("name").and_then(Value::as_str) {
                            let input = b.get("input").cloned().unwrap_or(Value::Null);
                            tool_calls.push(ToolCall {
                                tool_name: name.to_string(),
                                target: target_for(name, &input),
                                tool_use_id: b
                                    .get("id")
                                    .and_then(Value::as_str)
                                    .map(str::to_string),
                                result_tokens: None,
                                is_error: false,
                            });
                        }
                    }
                    Some("tool_result") => {
                        let chars = b.get("content").map(content_chars).unwrap_or(0);
                        tool_calls.push(ToolCall {
                            tool_name: "_tool_result".to_string(),
                            target: None,
                            tool_use_id: b
                                .get("tool_use_id")
                                .and_then(Value::as_str)
                                .map(str::to_string),
                            result_tokens: Some((chars / 4) as i64),
                            is_error: b.get("is_error").and_then(Value::as_bool).unwrap_or(false),
                        });
                    }
                    _ => {}
                }
            }
            if msg_type == "user" && !texts.is_empty() {
                prompt_text = Some(texts.join("\n"));
            }
        }
        _ => {}
    }

    // Synthesize a Skill tool call for a user-typed slash command.
    if msg_type == "user" {
        if let Some(text) = &prompt_text {
            if let Some(caps) = slash_command_re().captures(text) {
                tool_calls.push(ToolCall {
                    tool_name: "Skill".to_string(),
                    target: Some(caps[1].to_string()),
                    tool_use_id: None,
                    result_tokens: None,
                    is_error: false,
                });
            }
        }
    }

    Some(MessageRow {
        uuid,
        parent_uuid: str_field("parentUuid"),
        session_id,
        project_slug: project_slug.to_string(),
        cwd: str_field("cwd"),
        git_branch: str_field("gitBranch"),
        cc_version: str_field("version"),
        entrypoint: str_field("entrypoint"),
        msg_type,
        is_sidechain: v
            .get("isSidechain")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        agent_id: str_field("agentId"),
        timestamp,
        model: message
            .get("model")
            .and_then(Value::as_str)
            .map(str::to_string),
        stop_reason: message
            .get("stop_reason")
            .and_then(Value::as_str)
            .map(str::to_string),
        prompt_id: str_field("promptId"),
        message_id: message
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string),
        usage: usage_from(&message),
        prompt_text,
        attribution_skill: str_field("attributionSkill"),
        tool_calls,
    })
}
