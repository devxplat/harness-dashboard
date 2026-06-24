//! Best-effort normalizers for local provider transcript formats.
//!
//! Claude keeps its original parser in `jsonl`; the adapters here cover local
//! formats whose schemas vary more across releases. They intentionally read only
//! whitelisted fields and ignore auth/settings blobs.

use crate::db::Db;
use crate::error::Result;
use crate::model::{CostSource, MessageRow, ProviderId, ToolCall, Usage, UsageSource};
use crate::paths;
use rusqlite::types::Value as SqlValue;
use rusqlite::Connection;
use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect()
    }
}

fn now_secs() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn fingerprint(s: &str) -> String {
    let mut hasher = DefaultHasher::new();
    s.hash(&mut hasher);
    format!("{:016x}:{}", hasher.finish(), s.len())
}

fn path_mtime(path: &Path) -> Option<f64> {
    path.metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64())
}

fn value_str<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| v.get(*k).and_then(Value::as_str))
}

fn value_i64(v: &Value, keys: &[&str]) -> i64 {
    keys.iter()
        .find_map(|k| v.get(*k).and_then(Value::as_i64))
        .unwrap_or(0)
}

fn codex_usage_from(v: &Value) -> Usage {
    Usage {
        input_tokens: value_i64(v, &["input_tokens", "inputTokens"]),
        output_tokens: value_i64(v, &["output_tokens", "outputTokens"])
            + value_i64(v, &["reasoning_output_tokens", "reasoningOutputTokens"]),
        cache_read_tokens: value_i64(v, &["cached_input_tokens", "cachedInputTokens"]),
        cache_create_5m_tokens: 0,
        cache_create_1h_tokens: 0,
    }
}

fn usage_is_zero(u: Usage) -> bool {
    u.input_tokens == 0
        && u.output_tokens == 0
        && u.cache_read_tokens == 0
        && u.cache_create_5m_tokens == 0
        && u.cache_create_1h_tokens == 0
}

fn usage_delta(prev: Usage, current: Usage) -> Option<Usage> {
    let has_reset = current.input_tokens < prev.input_tokens
        || current.output_tokens < prev.output_tokens
        || current.cache_read_tokens < prev.cache_read_tokens
        || current.cache_create_5m_tokens < prev.cache_create_5m_tokens
        || current.cache_create_1h_tokens < prev.cache_create_1h_tokens;
    if has_reset {
        return None;
    }
    let delta = Usage {
        input_tokens: current.input_tokens - prev.input_tokens,
        output_tokens: current.output_tokens - prev.output_tokens,
        cache_read_tokens: current.cache_read_tokens - prev.cache_read_tokens,
        cache_create_5m_tokens: current.cache_create_5m_tokens - prev.cache_create_5m_tokens,
        cache_create_1h_tokens: current.cache_create_1h_tokens - prev.cache_create_1h_tokens,
    };
    (!usage_is_zero(delta)).then_some(delta)
}

fn project_slug_from_cwd(cwd: Option<&str>, fallback: &str) -> String {
    cwd.and_then(|c| Path::new(c).file_name())
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn local_path_setting(db: &Db, provider: ProviderId, key_suffix: &str) -> Result<Option<PathBuf>> {
    Ok(db
        .get_setting(&format!("provider.{}.{}", provider.as_str(), key_suffix))?
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from))
}

pub fn provider_path(
    db: &Db,
    provider: ProviderId,
    claude_projects_root: &Path,
) -> Result<PathBuf> {
    if let Some(path) = local_path_setting(db, provider, "path")? {
        return Ok(path);
    }
    Ok(match provider {
        ProviderId::Claude => claude_projects_root.to_path_buf(),
        ProviderId::Codex => paths::codex_sessions_dir(),
        ProviderId::Gemini => paths::gemini_chats_dir(),
        ProviderId::Cursor => paths::cursor_state_db(),
        ProviderId::Antigravity => paths::antigravity_transcripts_dir(),
        ProviderId::Copilot => paths::copilot_home_dir(),
        ProviderId::Opencode => paths::opencode_data_dir(),
    })
}

pub fn provider_enabled(db: &Db, provider: ProviderId) -> Result<bool> {
    Ok(db
        .get_setting(&format!("provider.{}.enabled", provider.as_str()))?
        .map(|v| v != "false" && v != "0")
        .unwrap_or(true))
}

pub fn provider_source_enabled(db: &Db, provider: ProviderId, source: &str) -> Result<bool> {
    Ok(db
        .get_setting(&format!(
            "provider.{}.source.{}.enabled",
            provider.as_str(),
            source
        ))?
        .map(|v| v != "false" && v != "0")
        .unwrap_or(true))
}

pub fn provider_source_path(
    db: &Db,
    provider: ProviderId,
    source: &str,
    default_path: Option<PathBuf>,
) -> Result<Option<PathBuf>> {
    let source_key = format!("provider.{}.source.{}.path", provider.as_str(), source);
    if let Some(path) = db
        .get_setting(&source_key)?
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from)
    {
        return Ok(Some(path));
    }
    if let Some(path) = local_path_setting(db, provider, "path")? {
        return Ok(Some(path));
    }
    Ok(default_path)
}

fn base_row(
    provider: ProviderId,
    uuid: String,
    session_id: String,
    project_slug: String,
    timestamp: String,
    msg_type: &str,
) -> MessageRow {
    MessageRow {
        uuid,
        provider,
        parent_uuid: None,
        session_id,
        project_slug,
        cwd: None,
        git_branch: None,
        cc_version: None,
        entrypoint: None,
        msg_type: msg_type.to_string(),
        is_sidechain: false,
        agent_id: None,
        timestamp,
        model: None,
        stop_reason: None,
        prompt_id: None,
        message_id: None,
        usage: Usage::default(),
        usage_source: UsageSource::Unavailable,
        reported_cost_usd: None,
        cost_source: CostSource::Unavailable,
        source_path: None,
        source_key: None,
        source_fingerprint: None,
        prompt_text: None,
        attribution_skill: None,
        tool_calls: Vec::new(),
    }
}

fn with_source(
    mut row: MessageRow,
    source_path: &str,
    source_key: &str,
    fingerprint: &str,
) -> MessageRow {
    row.source_path = Some(source_path.to_string());
    row.source_key = Some(source_key.to_string());
    row.source_fingerprint = Some(fingerprint.to_string());
    row
}

fn value_f64(v: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter().find_map(|k| v.get(*k).and_then(Value::as_f64))
}

fn nested_i64(v: &Value, path: &[&str]) -> i64 {
    let mut current = v;
    for key in path {
        current = current.get(*key).unwrap_or(&Value::Null);
    }
    current.as_i64().unwrap_or(0)
}

fn tokens_from_value(v: &Value) -> Usage {
    let tokens = v
        .get("tokens")
        .or_else(|| v.get("usage"))
        .or_else(|| v.get("tokenCount"))
        .unwrap_or(v);
    Usage {
        input_tokens: value_i64(
            tokens,
            &["input", "input_tokens", "inputTokens", "prompt_tokens"],
        ),
        output_tokens: value_i64(
            tokens,
            &[
                "output",
                "output_tokens",
                "outputTokens",
                "completion_tokens",
            ],
        ) + value_i64(
            tokens,
            &["reasoning", "reasoning_tokens", "reasoningTokens"],
        ),
        cache_read_tokens: nested_i64(tokens, &["cache", "read"])
            + value_i64(
                tokens,
                &[
                    "cached",
                    "cached_tokens",
                    "cachedTokens",
                    "cache_read_tokens",
                ],
            ),
        cache_create_5m_tokens: nested_i64(tokens, &["cache", "write"])
            + value_i64(tokens, &["cache_write_tokens", "cacheWriteTokens"]),
        cache_create_1h_tokens: 0,
    }
}

fn timestamp_from_value(v: &Value) -> String {
    if let Some(s) = value_str(
        v,
        &["timestamp", "created_at", "createdAt", "startTime", "time"],
    ) {
        return s.to_string();
    }
    let ms = value_i64(
        v,
        &[
            "timestamp_ms",
            "timestampMs",
            "start_time_ms",
            "startTimeMs",
        ],
    );
    if ms > 0 {
        if let Some(dt) = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms) {
            return dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        }
    }
    let secs = value_i64(v, &["created", "updated", "start"]);
    if secs > 0 {
        if let Some(dt) = chrono::DateTime::<chrono::Utc>::from_timestamp(secs, 0) {
            return dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        }
    }
    "1970-01-01T00:00:00Z".to_string()
}

fn sql_value_to_string(value: SqlValue) -> Option<String> {
    match value {
        SqlValue::Null => None,
        SqlValue::Integer(v) => Some(v.to_string()),
        SqlValue::Real(v) => Some(v.to_string()),
        SqlValue::Text(v) => Some(v),
        SqlValue::Blob(v) => Some(format!(
            "blob:{}:{}",
            v.len(),
            fingerprint(&String::from_utf8_lossy(&v))
        )),
    }
}

fn json_file_value(path: &Path) -> Option<Value> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
}

pub fn parse_codex_line(
    line: &str,
    file_key: &str,
    line_no: usize,
    session_id_hint: &mut Option<String>,
    cwd_hint: &mut Option<String>,
    model_hint: &mut Option<String>,
    total_usage_hint: &mut Option<Usage>,
) -> Option<MessageRow> {
    let v: Value = serde_json::from_str(line).ok()?;
    let timestamp = value_str(&v, &["timestamp", "time", "created_at"])
        .unwrap_or("1970-01-01T00:00:00Z")
        .to_string();
    let payload = v.get("payload").unwrap_or(&v);
    let record_type = value_str(&v, &["type", "kind"]).unwrap_or("");
    let payload_type = value_str(payload, &["type", "kind", "subtype", "event"]).unwrap_or("");

    if record_type == "session_meta" || payload_type == "session_meta" {
        if let Some(id) = value_str(payload, &["id", "session_id", "sessionId"]) {
            *session_id_hint = Some(id.to_string());
        }
        if let Some(cwd) = value_str(payload, &["cwd", "project_dir", "projectDir"]) {
            *cwd_hint = Some(cwd.to_string());
        }
        return None;
    }

    if record_type == "turn_context" || payload_type == "turn_context" {
        if let Some(cwd) = value_str(payload, &["cwd"]) {
            *cwd_hint = Some(cwd.to_string());
        }
        if let Some(model) = value_str(payload, &["model"]) {
            *model_hint = Some(model.to_string());
        }
        return None;
    }

    let session_id = session_id_hint
        .clone()
        .or_else(|| value_str(payload, &["session_id", "sessionId"]).map(str::to_string))
        .unwrap_or_else(|| file_key.to_string());
    let project_slug = project_slug_from_cwd(cwd_hint.as_deref(), "codex");

    if record_type == "user_message" || payload_type == "user_message" {
        let text = value_str(payload, &["message", "text", "content", "prompt"])?.to_string();
        let mut row = base_row(
            ProviderId::Codex,
            format!("codex:{file_key}:{line_no}:user"),
            session_id,
            project_slug,
            timestamp,
            "user",
        );
        row.cwd = cwd_hint.clone();
        row.prompt_text = Some(text);
        row.usage_source = UsageSource::Unavailable;
        return Some(row);
    }

    if record_type == "response_item" || payload_type == "function_call" {
        let item = payload.get("item").unwrap_or(payload);
        if value_str(item, &["type"]) == Some("function_call") || payload_type == "function_call" {
            let name = value_str(item, &["name"])
                .unwrap_or("function_call")
                .to_string();
            let target = item
                .get("arguments")
                .map(|v| truncate(&v.to_string(), 2000))
                .or_else(|| value_str(item, &["arguments"]).map(|s| truncate(s, 2000)));
            let mut row = base_row(
                ProviderId::Codex,
                format!("codex:{file_key}:{line_no}:tool"),
                session_id,
                project_slug,
                timestamp,
                "assistant",
            );
            row.cwd = cwd_hint.clone();
            row.model = model_hint.clone();
            row.tool_calls.push(ToolCall {
                tool_name: name,
                target,
                tool_use_id: value_str(item, &["call_id", "id"]).map(str::to_string),
                result_tokens: None,
                is_error: false,
            });
            return Some(row);
        }
    }

    let last_token_info = payload
        .get("info")
        .and_then(|i| i.get("last_token_usage"))
        .or_else(|| payload.get("last_token_usage"));
    let total_token_info = payload
        .get("info")
        .and_then(|i| i.get("total_token_usage"))
        .or_else(|| payload.get("total_token_usage"));
    if last_token_info.is_some() || total_token_info.is_some() {
        let usage = if let Some(total) = total_token_info {
            let current = codex_usage_from(total);
            let usage = match *total_usage_hint {
                Some(prev) => usage_delta(prev, current).or_else(|| {
                    let reset = current.input_tokens < prev.input_tokens
                        || current.output_tokens < prev.output_tokens
                        || current.cache_read_tokens < prev.cache_read_tokens;
                    if reset {
                        last_token_info
                            .map(codex_usage_from)
                            .filter(|u| !usage_is_zero(*u))
                    } else {
                        None
                    }
                }),
                None => last_token_info
                    .map(codex_usage_from)
                    .filter(|u| !usage_is_zero(*u))
                    .or_else(|| (!usage_is_zero(current)).then_some(current)),
            };
            *total_usage_hint = Some(current);
            usage?
        } else {
            last_token_info
                .map(codex_usage_from)
                .filter(|u| !usage_is_zero(*u))?
        };
        let mut row = base_row(
            ProviderId::Codex,
            format!("codex:{file_key}:{line_no}:usage"),
            session_id,
            project_slug,
            timestamp,
            "assistant",
        );
        row.cwd = cwd_hint.clone();
        row.model = model_hint.clone();
        row.message_id = value_str(payload, &["message_id", "messageId", "id"]).map(str::to_string);
        row.usage = usage;
        row.usage_source = UsageSource::Exact;
        row.cost_source = CostSource::ApiEstimate;
        return Some(row);
    }

    None
}

pub fn parse_gemini_line(line: &str, file_key: &str, line_no: usize) -> Option<MessageRow> {
    let v: Value = serde_json::from_str(line).ok()?;
    let session_id = value_str(&v, &["sessionId", "session_id"])
        .unwrap_or(file_key)
        .to_string();
    if v.get("kind").is_some() && v.get("type").is_none() {
        return None;
    }
    let msg_type = value_str(&v, &["type", "role"]).unwrap_or("");
    let timestamp = value_str(&v, &["timestamp", "createdAt", "startTime"])
        .unwrap_or("1970-01-01T00:00:00Z")
        .to_string();
    let content = value_str(&v, &["content", "text", "message"]).map(str::to_string);
    let id = value_str(&v, &["id", "messageId"])
        .map(str::to_string)
        .unwrap_or_else(|| format!("{file_key}:{line_no}"));

    let mut row = base_row(
        ProviderId::Gemini,
        format!("gemini:{file_key}:{id}"),
        session_id,
        "gemini".to_string(),
        timestamp,
        if msg_type == "user" {
            "user"
        } else {
            "assistant"
        },
    );
    row.message_id = Some(id);
    row.model = value_str(&v, &["model"]).map(str::to_string);
    if msg_type == "user" {
        row.prompt_text = content;
        return Some(row);
    }

    if let Some(tokens) = v.get("tokens") {
        row.usage = Usage {
            input_tokens: value_i64(tokens, &["input"]),
            output_tokens: value_i64(tokens, &["output"]) + value_i64(tokens, &["thoughts"]),
            cache_read_tokens: value_i64(tokens, &["cached"]),
            cache_create_5m_tokens: value_i64(tokens, &["tool"]),
            cache_create_1h_tokens: 0,
        };
        row.usage_source = UsageSource::Exact;
        row.cost_source = CostSource::ApiEstimate;
    }

    if let Some(calls) = v.get("toolCalls").and_then(Value::as_array) {
        for call in calls {
            let name = value_str(call, &["name", "functionName", "toolName"])
                .or_else(|| call.pointer("/function/name").and_then(Value::as_str))
                .unwrap_or("tool_call")
                .to_string();
            row.tool_calls.push(ToolCall {
                tool_name: name,
                target: call.get("args").map(|v| truncate(&v.to_string(), 2000)),
                tool_use_id: value_str(call, &["id", "callId"]).map(str::to_string),
                result_tokens: None,
                is_error: false,
            });
        }
    }

    Some(row)
}

fn cursor_reported_cost_usd(v: &Value) -> Option<f64> {
    let usage = v.get("usageData")?.as_object()?;
    let cents: f64 = usage
        .values()
        .filter_map(|entry| entry.get("costInCents").and_then(Value::as_f64))
        .sum();
    if cents > 0.0 {
        Some(cents / 100.0)
    } else {
        None
    }
}

pub fn scan_cursor_state_db(db: &Db, state_db: &Path) -> Result<(i64, i64)> {
    if !state_db.exists() {
        return Ok((0, 0));
    }
    let source_path = state_db.to_string_lossy().to_string();
    let conn = Connection::open_with_flags(state_db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut stmt = conn.prepare(
        "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' OR key LIKE 'bubbleId:%'",
    )?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    let mut composers: HashMap<String, Value> = HashMap::new();
    for (key, value) in &rows {
        if let Some(id) = key.strip_prefix("composerData:") {
            if let Ok(json) = serde_json::from_str::<Value>(value) {
                composers.insert(id.to_string(), json);
            }
        }
    }

    let mtime = path_mtime(state_db);
    let now = now_secs();
    let mut seen_keys = HashSet::new();
    let mut message_count = 0usize;
    let mut tool_count = 0usize;

    for (key, value) in rows {
        seen_keys.insert(key.clone());
        let fp = fingerprint(&value);
        let mut parsed = Vec::new();
        let Ok(json) = serde_json::from_str::<Value>(&value) else {
            db.replace_source_item_rows(
                ProviderId::Cursor,
                &source_path,
                &key,
                &fp,
                mtime,
                now,
                &[],
            )?;
            continue;
        };

        if let Some(composer_id) = key.strip_prefix("composerData:") {
            if let Some(reported_cost_usd) = cursor_reported_cost_usd(&json) {
                let timestamp = value_str(&json, &["createdAt", "lastUpdatedAt"])
                    .unwrap_or("1970-01-01T00:00:00Z")
                    .to_string();
                let mut row = base_row(
                    ProviderId::Cursor,
                    format!("cursor:{composer_id}:reported-cost"),
                    composer_id.to_string(),
                    "cursor".to_string(),
                    timestamp,
                    "assistant",
                );
                row.message_id = Some("reported-cost".to_string());
                row.model = json
                    .pointer("/modelConfig/model")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                row.usage_source = UsageSource::Unavailable;
                row.reported_cost_usd = Some(reported_cost_usd);
                row.cost_source = CostSource::ProviderReported;
                parsed.push(with_source(row, &source_path, &key, &fp));
            }
        } else if let Some(rest) = key.strip_prefix("bubbleId:") {
            let mut parts = rest.splitn(2, ':');
            let composer_id = parts.next().unwrap_or("unknown");
            let bubble_id = parts.next().unwrap_or(rest);
            let composer = composers.get(composer_id);
            let token_count = json.get("tokenCount").unwrap_or(&Value::Null);
            let input = value_i64(token_count, &["inputTokens", "input_tokens"]);
            let output = value_i64(token_count, &["outputTokens", "output_tokens"]);
            let timestamp = value_str(&json, &["createdAt", "timestamp"])
                .or_else(|| composer.and_then(|c| value_str(c, &["createdAt"])))
                .unwrap_or("1970-01-01T00:00:00Z")
                .to_string();
            let mut row = base_row(
                ProviderId::Cursor,
                format!("cursor:{composer_id}:{bubble_id}"),
                composer_id.to_string(),
                "cursor".to_string(),
                timestamp,
                if json.get("text").is_some() && input == 0 && output == 0 {
                    "user"
                } else {
                    "assistant"
                },
            );
            row.message_id = Some(bubble_id.to_string());
            row.model = composer
                .and_then(|c| c.pointer("/modelConfig/model").and_then(Value::as_str))
                .map(str::to_string);
            row.prompt_text = value_str(&json, &["text", "content"]).map(str::to_string);
            if input > 0 || output > 0 {
                row.usage = Usage {
                    input_tokens: input,
                    output_tokens: output,
                    cache_read_tokens: 0,
                    cache_create_5m_tokens: 0,
                    cache_create_1h_tokens: 0,
                };
                row.usage_source = UsageSource::ProviderReported;
                row.cost_source = CostSource::ApiEstimate;
            }
            parsed.push(with_source(row, &source_path, &key, &fp));
        }

        let (messages, tools) = db.replace_source_item_rows(
            ProviderId::Cursor,
            &source_path,
            &key,
            &fp,
            mtime,
            now,
            &parsed,
        )?;
        message_count += messages;
        tool_count += tools;
    }

    db.prune_missing_source_items(ProviderId::Cursor, &source_path, &seen_keys)?;
    Ok((message_count as i64, tool_count as i64))
}

pub fn parse_antigravity_line(line: &str, file_key: &str, line_no: usize) -> Option<MessageRow> {
    let v: Value = serde_json::from_str(line).ok()?;
    let timestamp = value_str(&v, &["created_at", "createdAt", "timestamp"])
        .unwrap_or("1970-01-01T00:00:00Z")
        .to_string();
    let session_id = value_str(&v, &["session_id", "sessionId"])
        .unwrap_or(file_key)
        .to_string();
    let content = value_str(&v, &["content", "text"]).map(str::to_string);
    let source = value_str(&v, &["source"]).unwrap_or("assistant");
    let mut row = base_row(
        ProviderId::Antigravity,
        format!("antigravity:{file_key}:{line_no}"),
        session_id,
        "antigravity".to_string(),
        timestamp,
        if source == "user" {
            "user"
        } else {
            "assistant"
        },
    );
    row.message_id = value_str(&v, &["id", "step_index"]).map(str::to_string);
    row.prompt_text = if row.msg_type == "user" {
        content
    } else {
        None
    };

    if let Some(calls) = v.get("tool_calls").and_then(Value::as_array) {
        for call in calls {
            let action = call
                .pointer("/args/toolAction")
                .and_then(Value::as_str)
                .or_else(|| value_str(call, &["name", "toolName"]))
                .unwrap_or("tool_call");
            row.tool_calls.push(ToolCall {
                tool_name: action.to_string(),
                target: call
                    .pointer("/args/toolSummary")
                    .and_then(Value::as_str)
                    .map(|s| truncate(s, 2000)),
                tool_use_id: value_str(call, &["id", "callId"]).map(str::to_string),
                result_tokens: None,
                is_error: value_str(&v, &["status"]) == Some("error"),
            });
        }
    }
    Some(row)
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool> {
    let exists = conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name=?1 LIMIT 1",
        [table],
        |_| Ok(()),
    );
    Ok(exists.is_ok())
}

fn sqlite_rows(conn: &Connection, table: &str) -> Result<Vec<HashMap<String, String>>> {
    if !table_exists(conn, table)? {
        return Ok(Vec::new());
    }
    let sql = format!("SELECT * FROM {table}");
    let mut stmt = conn.prepare(&sql)?;
    let names = stmt
        .column_names()
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
    let rows = stmt
        .query_map([], |r| {
            let mut out = HashMap::new();
            for (idx, name) in names.iter().enumerate() {
                if let Some(value) = sql_value_to_string(r.get::<_, SqlValue>(idx)?) {
                    out.insert(name.clone(), value);
                }
            }
            Ok(out)
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn map_value<'a>(row: &'a HashMap<String, String>, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| row.get(*key).map(String::as_str))
        .filter(|v| !v.is_empty())
}

fn map_i64(row: &HashMap<String, String>, keys: &[&str]) -> i64 {
    map_value(row, keys)
        .and_then(|v| v.parse::<f64>().ok())
        .map(|v| v as i64)
        .unwrap_or(0)
}

fn map_timestamp(row: &HashMap<String, String>) -> String {
    if let Some(ts) = map_value(row, &["timestamp", "created_at", "createdAt", "start_time"]) {
        return ts.to_string();
    }
    let ms = map_i64(row, &["start_time_ms", "timestamp_ms", "startTimeMs"]);
    if ms > 0 {
        if let Some(dt) = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms) {
            return dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        }
    }
    "1970-01-01T00:00:00Z".to_string()
}

fn merge_copilot_attributes(
    conn: &Connection,
    spans: &mut [HashMap<String, String>],
) -> Result<()> {
    if !table_exists(conn, "span_attributes")? {
        return Ok(());
    }
    let mut by_id = spans
        .iter_mut()
        .filter_map(|span| {
            map_value(span, &["span_id", "spanId", "id"])
                .map(str::to_string)
                .map(|id| (id, span))
        })
        .collect::<HashMap<_, _>>();
    let mut stmt = conn.prepare("SELECT span_id, key, value FROM span_attributes")?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
        ))
    })?;
    for row in rows {
        let (span_id, key, value) = row?;
        if let (Some(span), Some(value)) = (by_id.get_mut(&span_id), value) {
            span.entry(key).or_insert(value);
        }
    }
    Ok(())
}

pub fn scan_copilot_otel_db(db: &Db, otel_db: &Path) -> Result<(i64, i64)> {
    if !otel_db.exists() {
        return Ok((0, 0));
    }
    let source_path = otel_db.to_string_lossy().to_string();
    let conn = Connection::open_with_flags(otel_db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut spans = sqlite_rows(&conn, "spans")?;
    merge_copilot_attributes(&conn, &mut spans)?;

    let now = now_secs();
    let mtime = path_mtime(otel_db);
    let mut seen_keys = HashSet::new();
    let mut message_count = 0usize;
    let mut tool_count = 0usize;
    for span in spans {
        let span_id = map_value(&span, &["span_id", "spanId", "id"])
            .unwrap_or("unknown")
            .to_string();
        let key = format!("otel:{span_id}");
        seen_keys.insert(key.clone());
        let fp = fingerprint(&serde_json::to_string(&span).unwrap_or_default());
        let mut rows = Vec::new();
        let session_id = map_value(
            &span,
            &[
                "conversation_id",
                "chat_session_id",
                "session_id",
                "sessionId",
            ],
        )
        .unwrap_or(&span_id)
        .to_string();
        let operation = map_value(&span, &["operation_name", "name", "event"])
            .unwrap_or("")
            .to_ascii_lowercase();
        let tool_name = map_value(&span, &["tool_name", "toolName"]);
        let prompt_text =
            map_value(&span, &["userRequest", "user_request", "content"]).map(str::to_string);
        let input = map_i64(&span, &["input_tokens", "inputTokens"]);
        let output = map_i64(&span, &["output_tokens", "outputTokens"])
            + map_i64(&span, &["reasoning_tokens", "reasoningTokens"]);
        let cached = map_i64(&span, &["cached_tokens", "cachedTokens"]);
        let meaningful =
            input > 0 || output > 0 || cached > 0 || tool_name.is_some() || prompt_text.is_some();
        if meaningful {
            let mut row = base_row(
                ProviderId::Copilot,
                format!("copilot:otel:{span_id}"),
                session_id,
                project_slug_from_cwd(
                    map_value(&span, &["directory", "cwd", "workspace"]),
                    "copilot",
                ),
                map_timestamp(&span),
                if operation.contains("user") && prompt_text.is_some() {
                    "user"
                } else {
                    "assistant"
                },
            );
            row.cwd = map_value(&span, &["directory", "cwd", "workspace"]).map(str::to_string);
            row.message_id = Some(span_id);
            row.model = map_value(
                &span,
                &["response_model", "request_model", "model", "model_id"],
            )
            .map(str::to_string);
            row.prompt_text = prompt_text;
            if input > 0 || output > 0 || cached > 0 {
                row.usage = Usage {
                    input_tokens: input,
                    output_tokens: output,
                    cache_read_tokens: cached,
                    cache_create_5m_tokens: 0,
                    cache_create_1h_tokens: 0,
                };
                row.usage_source = UsageSource::ProviderReported;
            }
            if let Some(tool_name) = tool_name {
                row.tool_calls.push(ToolCall {
                    tool_name: tool_name.to_string(),
                    target: map_value(&span, &["args", "input", "tool_args"])
                        .map(|s| truncate(s, 2000)),
                    tool_use_id: map_value(&span, &["tool_call_id", "toolCallId"])
                        .map(str::to_string),
                    result_tokens: None,
                    is_error: map_value(&span, &["status", "error"]).is_some_and(|s| s != "ok"),
                });
            }
            rows.push(with_source(row, &source_path, &key, &fp));
        }
        let (messages, tools) = db.replace_source_item_rows(
            ProviderId::Copilot,
            &source_path,
            &key,
            &fp,
            mtime,
            now,
            &rows,
        )?;
        message_count += messages;
        tool_count += tools;
    }
    db.prune_missing_source_items(ProviderId::Copilot, &source_path, &seen_keys)?;
    Ok((message_count as i64, tool_count as i64))
}

fn collect_json_values(value: &Value, out: &mut Vec<Value>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_json_values(item, out);
            }
        }
        Value::Object(_) => out.push(value.clone()),
        _ => {}
    }
}

#[allow(clippy::too_many_arguments)]
fn parse_generic_message(
    provider: ProviderId,
    source_prefix: &str,
    source_key: &str,
    idx: usize,
    session_id: &str,
    project_slug: &str,
    cwd: Option<&str>,
    value: &Value,
) -> Option<MessageRow> {
    let role = value_str(value, &["role", "type", "kind", "source"]).unwrap_or("");
    let content = value_str(value, &["content", "text", "message", "prompt"]).map(str::to_string);
    let usage = tokens_from_value(value);
    let cost = value_f64(value, &["cost", "cost_usd", "costUsd", "reported_cost_usd"]);
    let has_usage = !usage_is_zero(usage);
    let has_cost = cost.is_some();
    let tool_name = value_str(value, &["tool", "toolName", "tool_name", "name"])
        .filter(|_| role.contains("tool") || value.get("tool").is_some());
    let is_user = role == "user" || role == "user_message";
    if !has_usage && !has_cost && content.is_none() && tool_name.is_none() {
        return None;
    }
    let id = value_str(value, &["id", "messageID", "messageId", "partID", "partId"])
        .map(str::to_string)
        .unwrap_or_else(|| idx.to_string());
    let mut row = base_row(
        provider,
        format!("{source_prefix}:{source_key}:{id}:{idx}"),
        session_id.to_string(),
        project_slug.to_string(),
        timestamp_from_value(value),
        if is_user { "user" } else { "assistant" },
    );
    row.cwd = cwd.map(str::to_string);
    row.message_id = Some(id);
    row.model = value_str(value, &["model", "modelID", "modelId"])
        .or_else(|| value.pointer("/model/modelID").and_then(Value::as_str))
        .map(str::to_string);
    if is_user {
        row.prompt_text = content;
    }
    if has_usage {
        row.usage = usage;
        row.usage_source = UsageSource::ProviderReported;
    }
    if let Some(cost) = cost {
        row.reported_cost_usd = Some(cost);
        row.cost_source = CostSource::ProviderReported;
    }
    if let Some(tool_name) = tool_name {
        row.tool_calls.push(ToolCall {
            tool_name: tool_name.to_string(),
            target: value
                .get("input")
                .or_else(|| value.get("args"))
                .or_else(|| value.get("metadata"))
                .map(|v| truncate(&v.to_string(), 2000)),
            tool_use_id: value_str(value, &["callID", "callId", "tool_call_id", "id"])
                .map(str::to_string),
            result_tokens: None,
            is_error: value_str(value, &["status", "state"]) == Some("error"),
        });
    }
    Some(row)
}

pub fn scan_copilot_cli_dir(db: &Db, copilot_home: &Path) -> Result<(i64, i64)> {
    let mut message_count = 0usize;
    let mut tool_count = 0usize;
    for subdir in ["session-state", "history-session-state"] {
        let root = copilot_home.join(subdir);
        if !root.exists() {
            continue;
        }
        let source_path = root.to_string_lossy().to_string();
        let now = now_secs();
        let mut seen_keys = HashSet::new();
        for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Some(value) = json_file_value(path) else {
                continue;
            };
            let fp = fingerprint(&value.to_string());
            let key = path
                .strip_prefix(&root)
                .unwrap_or(path)
                .to_string_lossy()
                .replace('\\', "/");
            seen_keys.insert(key.clone());
            let mut parsed = Vec::new();
            let session_id = value_str(&value, &["id", "session_id", "sessionId"])
                .map(str::to_string)
                .unwrap_or_else(|| key.clone());
            let cwd = value_str(&value, &["cwd", "directory", "project_dir", "projectDir"]);
            let project_slug = project_slug_from_cwd(cwd, "copilot");
            let mut values = Vec::new();
            if let Some(messages) = value
                .get("messages")
                .or_else(|| value.get("turns"))
                .or_else(|| value.get("events"))
                .or_else(|| value.get("items"))
            {
                collect_json_values(messages, &mut values);
            } else {
                values.push(value.clone());
            }
            for (idx, item) in values.iter().enumerate() {
                if let Some(row) = parse_generic_message(
                    ProviderId::Copilot,
                    "copilot:cli",
                    &key,
                    idx,
                    &session_id,
                    &project_slug,
                    cwd,
                    item,
                ) {
                    parsed.push(with_source(row, &source_path, &key, &fp));
                }
            }
            let (messages, tools) = db.replace_source_item_rows(
                ProviderId::Copilot,
                &source_path,
                &key,
                &fp,
                path_mtime(path),
                now,
                &parsed,
            )?;
            message_count += messages;
            tool_count += tools;
        }
        db.prune_missing_source_items(ProviderId::Copilot, &source_path, &seen_keys)?;
    }
    Ok((message_count as i64, tool_count as i64))
}

fn opencode_storage_root(data_dir: &Path) -> PathBuf {
    data_dir.join("project")
}

pub fn scan_opencode_storage(db: &Db, data_dir: &Path) -> Result<(i64, i64)> {
    let mut message_count = 0usize;
    let mut tool_count = 0usize;
    let roots = [opencode_storage_root(data_dir), data_dir.join("global")];
    for root in roots {
        if !root.exists() {
            continue;
        }
        let source_path = root.to_string_lossy().to_string();
        let now = now_secs();
        let mut seen_keys = HashSet::new();
        let mut session_meta: BTreeMap<String, (String, Option<String>, String)> = BTreeMap::new();
        for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Some(value) = json_file_value(path) else {
                continue;
            };
            let key = path
                .strip_prefix(&root)
                .unwrap_or(path)
                .to_string_lossy()
                .replace('\\', "/");
            if key.contains("/session/")
                || key.starts_with("storage/session/")
                || key.starts_with("session/")
            {
                let sid = value_str(&value, &["id", "sessionID", "sessionId"])
                    .map(str::to_string)
                    .or_else(|| path.file_stem().map(|s| s.to_string_lossy().to_string()))
                    .unwrap_or_else(|| key.clone());
                let cwd = value_str(&value, &["directory", "cwd", "path"]).map(str::to_string);
                let project_slug = project_slug_from_cwd(cwd.as_deref(), "opencode");
                session_meta.insert(sid, (project_slug, cwd, timestamp_from_value(&value)));
            }
        }

        for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Some(value) = json_file_value(path) else {
                continue;
            };
            let key = path
                .strip_prefix(&root)
                .unwrap_or(path)
                .to_string_lossy()
                .replace('\\', "/");
            let fp = fingerprint(&value.to_string());
            if db.source_item_fingerprint(ProviderId::Opencode, &source_path, &key)?
                == Some(fp.clone())
            {
                seen_keys.insert(key);
                continue;
            }
            seen_keys.insert(key.clone());
            let mut parsed = Vec::new();
            let session_id = value_str(&value, &["sessionID", "sessionId", "session_id"])
                .map(str::to_string)
                .or_else(|| {
                    path.parent()
                        .and_then(|p| p.file_name())
                        .map(|s| s.to_string_lossy().to_string())
                })
                .unwrap_or_else(|| key.clone());
            let (project_slug, cwd, _) = session_meta
                .get(&session_id)
                .cloned()
                .unwrap_or_else(|| ("opencode".to_string(), None, timestamp_from_value(&value)));
            let mut values = Vec::new();
            if let Some(parts) = value
                .get("parts")
                .or_else(|| value.get("message"))
                .or_else(|| value.get("part"))
            {
                collect_json_values(parts, &mut values);
            } else {
                values.push(value.clone());
            }
            for (idx, item) in values.iter().enumerate() {
                if let Some(row) = parse_generic_message(
                    ProviderId::Opencode,
                    "opencode:storage",
                    &key,
                    idx,
                    &session_id,
                    &project_slug,
                    cwd.as_deref(),
                    item,
                ) {
                    parsed.push(with_source(row, &source_path, &key, &fp));
                }
            }
            let (messages, tools) = db.replace_source_item_rows(
                ProviderId::Opencode,
                &source_path,
                &key,
                &fp,
                path_mtime(path),
                now,
                &parsed,
            )?;
            message_count += messages;
            tool_count += tools;
        }
        db.prune_missing_source_items(ProviderId::Opencode, &source_path, &seen_keys)?;
    }
    Ok((message_count as i64, tool_count as i64))
}

pub fn parse_opencode_run_line(line: &str, file_key: &str, line_no: usize) -> Option<MessageRow> {
    let v: Value = serde_json::from_str(line).ok()?;
    let part = v.get("part").unwrap_or(&v);
    let session_id = value_str(&v, &["sessionID", "sessionId", "session_id"])
        .or_else(|| value_str(part, &["sessionID", "sessionId", "session_id"]))
        .unwrap_or(file_key);
    let event_type = value_str(&v, &["type"]).unwrap_or("");
    let mut row = parse_generic_message(
        ProviderId::Opencode,
        "opencode:run",
        file_key,
        line_no,
        session_id,
        "opencode",
        None,
        part,
    )
    .or_else(|| {
        (event_type == "error").then(|| {
            base_row(
                ProviderId::Opencode,
                format!("opencode:run:{file_key}:{line_no}:error"),
                session_id.to_string(),
                "opencode".to_string(),
                timestamp_from_value(&v),
                "assistant",
            )
        })
    })?;
    if row.timestamp == "1970-01-01T00:00:00Z" {
        row.timestamp = timestamp_from_value(&v);
    }
    Some(row)
}

pub fn scan_opencode_run_logs_dir(db: &Db, root: &Path) -> Result<(i64, i64)> {
    if !root.exists() {
        return Ok((0, 0));
    }
    let mut messages = 0;
    let mut tools = 0;
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let bytes = std::fs::read(path)?;
        let key = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        let mut rows = Vec::new();
        for (line_no, line) in bytes.split(|&b| b == b'\n').enumerate() {
            if line.is_empty() {
                continue;
            }
            if let Ok(s) = std::str::from_utf8(line) {
                if let Some(row) = parse_opencode_run_line(s, &key, line_no) {
                    rows.push(row);
                }
            }
        }
        let (m, t) = db.insert_messages(&rows)?;
        messages += m as i64;
        tools += t as i64;
    }
    Ok((messages, tools))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    fn tmp_path(name: &str) -> PathBuf {
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("harness-provider-{name}-{n}"))
    }

    #[test]
    fn codex_counts_last_token_usage_only() {
        let line = r#"{"timestamp":"2026-06-20T10:00:00Z","type":"event_msg","payload":{"info":{"total_token_usage":{"input_tokens":9999,"output_tokens":9999},"last_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":30,"reasoning_output_tokens":7}}}}"#;
        let mut session = Some("s1".to_string());
        let mut cwd = Some("D:/repo/app".to_string());
        let mut model = Some("gpt-5.5".to_string());
        let mut total = None;
        let row = parse_codex_line(
            line,
            "codex-file",
            1,
            &mut session,
            &mut cwd,
            &mut model,
            &mut total,
        )
        .unwrap();
        assert_eq!(row.provider, ProviderId::Codex);
        assert_eq!(row.usage.input_tokens, 100);
        assert_eq!(row.usage.cache_read_tokens, 20);
        assert_eq!(row.usage.output_tokens, 37);
        assert_eq!(row.usage_source, UsageSource::Exact);
    }

    #[test]
    fn codex_skips_unchanged_total_usage_snapshots() {
        let mut session = Some("s1".to_string());
        let mut cwd = Some("D:/repo/app".to_string());
        let mut model = Some("gpt-5.5".to_string());
        let mut total = None;
        let first = r#"{"timestamp":"2026-06-20T10:00:00Z","type":"event_msg","payload":{"info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":30},"last_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":30}}}}"#;
        let duplicate = r#"{"timestamp":"2026-06-20T10:00:01Z","type":"event_msg","payload":{"info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":30},"last_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":30}}}}"#;
        let next = r#"{"timestamp":"2026-06-20T10:00:02Z","type":"event_msg","payload":{"info":{"total_token_usage":{"input_tokens":175,"cached_input_tokens":40,"output_tokens":45},"last_token_usage":{"input_tokens":75,"cached_input_tokens":20,"output_tokens":15}}}}"#;

        let row = parse_codex_line(
            first,
            "codex-file",
            1,
            &mut session,
            &mut cwd,
            &mut model,
            &mut total,
        )
        .unwrap();
        assert_eq!(row.usage.input_tokens, 100);
        assert!(parse_codex_line(
            duplicate,
            "codex-file",
            2,
            &mut session,
            &mut cwd,
            &mut model,
            &mut total,
        )
        .is_none());
        let row = parse_codex_line(
            next,
            "codex-file",
            3,
            &mut session,
            &mut cwd,
            &mut model,
            &mut total,
        )
        .unwrap();
        assert_eq!(row.usage.input_tokens, 75);
        assert_eq!(row.usage.output_tokens, 15);
        assert_eq!(row.usage.cache_read_tokens, 20);
    }

    #[test]
    fn gemini_includes_thoughts_and_tool_calls() {
        let line = r#"{"type":"gemini","id":"m1","sessionId":"s1","timestamp":"2026-06-20T10:00:00Z","model":"gemini-3.1-pro-preview-customtools","tokens":{"input":10,"output":20,"thoughts":5,"cached":3,"tool":2},"toolCalls":[{"id":"t1","name":"read_file","args":{"path":"src/lib.rs"}}]}"#;
        let row = parse_gemini_line(line, "gemini-file", 1).unwrap();
        assert_eq!(row.provider, ProviderId::Gemini);
        assert_eq!(row.usage.output_tokens, 25);
        assert_eq!(row.usage.cache_read_tokens, 3);
        assert_eq!(row.usage.cache_create_5m_tokens, 2);
        assert_eq!(row.tool_calls.len(), 1);
        assert_eq!(row.tool_calls[0].tool_name, "read_file");
    }

    #[test]
    fn source_path_resolution_prefers_source_then_legacy_then_default() {
        let db = Db::open_in_memory().unwrap();
        let default = PathBuf::from("D:/default/codex");
        assert_eq!(
            provider_source_path(
                &db,
                ProviderId::Codex,
                "codex-sessions",
                Some(default.clone())
            )
            .unwrap(),
            Some(default)
        );
        db.set_setting("provider.codex.path", "D:/legacy/codex")
            .unwrap();
        assert_eq!(
            provider_source_path(
                &db,
                ProviderId::Codex,
                "codex-sessions",
                Some(PathBuf::from("D:/default/codex")),
            )
            .unwrap(),
            Some(PathBuf::from("D:/legacy/codex"))
        );
        db.set_setting(
            "provider.codex.source.codex-sessions.path",
            "D:/source/codex",
        )
        .unwrap();
        assert_eq!(
            provider_source_path(
                &db,
                ProviderId::Codex,
                "codex-sessions",
                Some(PathBuf::from("D:/default/codex")),
            )
            .unwrap(),
            Some(PathBuf::from("D:/source/codex"))
        );
        db.set_setting("provider.codex.source.codex-sessions.enabled", "false")
            .unwrap();
        assert!(!provider_source_enabled(&db, ProviderId::Codex, "codex-sessions").unwrap());
    }

    #[test]
    fn cursor_reads_whitelisted_kv_and_reported_cost() {
        let db_path = tmp_path("cursor.vscdb");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute(
            "CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO cursorDiskKV (key,value) VALUES (?1,?2)",
            params![
                "composerData:c1",
                r#"{"composerId":"c1","createdAt":"2026-06-20T10:00:00Z","modelConfig":{"model":"claude-4-sonnet"},"usageData":{"claude-4-sonnet":{"costInCents":12,"amount":3}}}"#
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO cursorDiskKV (key,value) VALUES (?1,?2)",
            params![
                "bubbleId:c1:b1",
                r#"{"createdAt":"2026-06-20T10:01:00Z","tokenCount":{"inputTokens":11,"outputTokens":7}}"#
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO cursorDiskKV (key,value) VALUES (?1,?2)",
            params!["cursorAuth/accessToken", r#"{"secret":"ignored"}"#],
        )
        .unwrap();
        drop(conn);

        let db = Db::open_in_memory().unwrap();
        let (messages, _tools) = scan_cursor_state_db(&db, &db_path).unwrap();
        assert_eq!(messages, 2);
        let totals = db
            .overview_totals(&crate::pricing::Pricing::load_default(), None, None)
            .unwrap();
        assert_eq!(totals.input_tokens, 11);
        assert_eq!(totals.output_tokens, 7);
        assert_eq!(totals.reported_cost_usd, Some(0.12));
        std::fs::remove_file(db_path).ok();
    }

    #[test]
    fn antigravity_marks_usage_unavailable() {
        let line = r#"{"step_index":7,"source":"assistant","status":"ok","created_at":"2026-06-20T10:00:00Z","tool_calls":[{"id":"tool-1","args":{"toolAction":"edit","toolSummary":"updated file"}}]}"#;
        let row = parse_antigravity_line(line, "ag-file", 1).unwrap();
        assert_eq!(row.provider, ProviderId::Antigravity);
        assert_eq!(row.usage_source, UsageSource::Unavailable);
        assert_eq!(row.cost_source, CostSource::Unavailable);
        assert_eq!(row.tool_calls.len(), 1);
        assert_eq!(row.tool_calls[0].tool_name, "edit");
    }

    #[test]
    fn copilot_otel_reads_spans_tokens_model_and_tools() {
        let db_path = tmp_path("copilot-otel.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute(
            "CREATE TABLE spans (
                span_id TEXT PRIMARY KEY,
                conversation_id TEXT,
                name TEXT,
                start_time_ms INTEGER,
                request_model TEXT,
                input_tokens INTEGER,
                output_tokens INTEGER,
                cached_tokens INTEGER,
                tool_name TEXT,
                cwd TEXT
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO spans VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                "span-1",
                "chat-1",
                "github.copilot.chat.request",
                1_781_966_400_000i64,
                "gpt-5",
                42i64,
                13i64,
                5i64,
                "read_file",
                "D:/repo/app"
            ],
        )
        .unwrap();
        drop(conn);

        let db = Db::open_in_memory().unwrap();
        let (messages, tools) = scan_copilot_otel_db(&db, &db_path).unwrap();
        assert_eq!(messages, 1);
        assert_eq!(tools, 1);
        let totals = db
            .overview_totals_for_providers(
                &crate::pricing::Pricing::load_default(),
                None,
                None,
                &[ProviderId::Copilot],
            )
            .unwrap();
        assert_eq!(totals.input_tokens, 42);
        assert_eq!(totals.output_tokens, 13);
        assert_eq!(totals.cache_read_tokens, 5);
        std::fs::remove_file(db_path).ok();
    }

    #[test]
    fn mutable_source_replace_removes_old_null_tool_rows() {
        let db = Db::open_in_memory().unwrap();
        let source_path = "cursor-state";
        let source_key = "bubbleId:c1:b1";
        let mut first = base_row(
            ProviderId::Cursor,
            "cursor:c1:b1".to_string(),
            "c1".to_string(),
            "cursor".to_string(),
            "2026-06-20T10:00:00Z".to_string(),
            "assistant",
        );
        first.message_id = Some("b1".to_string());
        first.usage = Usage {
            input_tokens: 10,
            ..Default::default()
        };
        first.usage_source = UsageSource::ProviderReported;
        first.tool_calls.push(ToolCall {
            tool_name: "Edit".to_string(),
            target: Some("src/lib.rs".to_string()),
            tool_use_id: None,
            result_tokens: None,
            is_error: false,
        });
        let first = with_source(first, source_path, source_key, "fp1");
        let (messages, tools) = db
            .replace_source_item_rows(
                ProviderId::Cursor,
                source_path,
                source_key,
                "fp1",
                None,
                1.0,
                &[first],
            )
            .unwrap();
        assert_eq!((messages, tools), (1, 1));

        let mut second = base_row(
            ProviderId::Cursor,
            "cursor:c1:b1".to_string(),
            "c1".to_string(),
            "cursor".to_string(),
            "2026-06-20T10:00:00Z".to_string(),
            "assistant",
        );
        second.message_id = Some("b1".to_string());
        second.usage = Usage {
            input_tokens: 25,
            ..Default::default()
        };
        second.usage_source = UsageSource::ProviderReported;
        let second = with_source(second, source_path, source_key, "fp2");
        db.replace_source_item_rows(
            ProviderId::Cursor,
            source_path,
            source_key,
            "fp2",
            None,
            2.0,
            &[second],
        )
        .unwrap();

        let totals = db
            .overview_totals_for_providers(
                &crate::pricing::Pricing::load_default(),
                None,
                None,
                &[ProviderId::Cursor],
            )
            .unwrap();
        assert_eq!(totals.input_tokens, 25);
        assert!(db
            .tools_for_providers(None, None, &[ProviderId::Cursor])
            .unwrap()
            .is_empty());
    }

    #[test]
    fn projects_aggregate_real_sessions_across_slugs_and_providers() {
        let db = Db::open_in_memory().unwrap();
        let mut rows = Vec::new();
        for (provider, uuid, session, slug, input) in [
            (ProviderId::Codex, "codex-1", "s1", "slug-a", 10),
            (ProviderId::Codex, "codex-2", "s1", "slug-b", 15),
            (ProviderId::Claude, "claude-1", "s2", "slug-c", 20),
        ] {
            let mut row = base_row(
                provider,
                uuid.to_string(),
                session.to_string(),
                slug.to_string(),
                "2026-06-20T10:00:00Z".to_string(),
                "assistant",
            );
            row.cwd = Some("D:/repo/app".to_string());
            row.message_id = Some(uuid.to_string());
            row.usage = Usage {
                input_tokens: input,
                ..Default::default()
            };
            rows.push(row);
        }
        db.insert_messages(&rows).unwrap();

        let projects = db.projects_for_providers(None, None, &[]).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].sessions, 2);
        assert_eq!(projects[0].input_tokens, 45);
        assert_eq!(projects[0].providers, vec!["claude", "codex"]);
    }

    #[test]
    fn copilot_otel_missing_db_returns_zero() {
        let db = Db::open_in_memory().unwrap();
        let missing = tmp_path("missing-otel.db");
        assert_eq!(scan_copilot_otel_db(&db, &missing).unwrap(), (0, 0));
    }

    #[test]
    fn copilot_otel_prunes_removed_spans() {
        let db_path = tmp_path("copilot-otel-prune.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute(
            "CREATE TABLE spans (
                span_id TEXT PRIMARY KEY,
                conversation_id TEXT,
                name TEXT,
                start_time_ms INTEGER,
                input_tokens INTEGER
            )",
            [],
        )
        .unwrap();
        for span_id in ["span-1", "span-2"] {
            conn.execute(
                "INSERT INTO spans VALUES (?1,?2,?3,?4,?5)",
                params![
                    span_id,
                    "chat-1",
                    "github.copilot.chat.request",
                    1_781_966_400_000i64,
                    10i64,
                ],
            )
            .unwrap();
        }
        drop(conn);

        let db = Db::open_in_memory().unwrap();
        assert_eq!(scan_copilot_otel_db(&db, &db_path).unwrap().0, 2);
        let conn = Connection::open(&db_path).unwrap();
        conn.execute("DELETE FROM spans WHERE span_id='span-2'", [])
            .unwrap();
        drop(conn);
        scan_copilot_otel_db(&db, &db_path).unwrap();

        let observed = db.provider_observed_stats().unwrap();
        assert_eq!(observed.get("copilot").map(|s| s.messages), Some(1));
        std::fs::remove_file(db_path).ok();
    }

    #[test]
    fn opencode_run_line_reads_step_finish_tokens_and_cost() {
        let line = r#"{"type":"step-finish","sessionID":"s1","timestamp":"2026-06-20T10:00:00Z","part":{"id":"p1","type":"assistant","model":"anthropic/claude-sonnet-4","tokens":{"input":100,"output":20,"cached":10},"cost":0.025}}"#;
        let row = parse_opencode_run_line(line, "run.jsonl", 0).unwrap();
        assert_eq!(row.provider, ProviderId::Opencode);
        assert_eq!(row.session_id, "s1");
        assert_eq!(row.usage.input_tokens, 100);
        assert_eq!(row.usage.output_tokens, 20);
        assert_eq!(row.usage.cache_read_tokens, 10);
        assert_eq!(row.usage_source, UsageSource::ProviderReported);
        assert_eq!(row.reported_cost_usd, Some(0.025));
        assert_eq!(row.cost_source, CostSource::ProviderReported);
    }
}
