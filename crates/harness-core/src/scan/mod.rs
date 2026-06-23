//! Incremental transcript scan.
//!
//! Walk `*.jsonl` under the projects root, read only the bytes past each file's
//! recorded high-water mark, parse complete lines, and hand them to the database
//! (which applies snapshot dedup). The high-water mark always sits behind a
//! partial trailing line so a mid-write record is re-read once complete.

use crate::db::Db;
use crate::error::Result;
use crate::git;
use crate::jsonl;
use crate::model::ProviderId;
use crate::paths;
use crate::provider_adapters;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

const CODEX_USAGE_TOTAL_DELTA_KEY: &str = "maintenance.codex_usage_total_delta_v2";

#[derive(Debug, Default, Clone, Copy)]
pub struct ScanStats {
    pub files: i64,
    pub messages: i64,
    pub tools: i64,
    pub repos: i64,
    pub commits: i64,
}

pub fn scan_dir(db: &Db, projects_root: &Path) -> Result<ScanStats> {
    let mut stats = ScanStats::default();
    if !projects_root.exists() {
        return Ok(stats);
    }

    for entry in WalkDir::new(projects_root)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Ok(meta) = path.metadata() else { continue };
        let size = meta.len() as i64;
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);

        let path_str = path.to_string_lossy().to_string();
        let prev = db.file_state(&path_str)?;
        let mut bytes_read = prev.map(|(_, b)| b).unwrap_or(0);
        if size == bytes_read {
            continue; // no new bytes
        }
        if size < bytes_read {
            bytes_read = 0; // truncated / rotated → re-read from the start
        }

        let mut f = std::fs::File::open(path)?;
        f.seek(SeekFrom::Start(bytes_read as u64))?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf)?;

        let complete_len = match buf.iter().rposition(|&b| b == b'\n') {
            Some(i) => i + 1,
            None => 0, // no complete line yet
        };

        let project_slug = paths::project_slug_for(path, projects_root);
        let mut rows = Vec::new();
        for line in buf[..complete_len].split(|&b| b == b'\n') {
            if line.is_empty() {
                continue;
            }
            if let Ok(s) = std::str::from_utf8(line) {
                if let Some(row) = jsonl::parse_line(s, &project_slug) {
                    rows.push(row);
                }
            }
        }

        let (m, t) = db.insert_messages(&rows)?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        db.set_file_state(&path_str, mtime, bytes_read + complete_len as i64, now)?;

        if complete_len > 0 {
            stats.files += 1;
            stats.messages += m as i64;
            stats.tools += t as i64;
        }
    }

    Ok(stats)
}

pub fn scan_all(db: &Db, claude_projects_root: &Path) -> Result<ScanStats> {
    let mut total = ScanStats::default();

    if provider_adapters::provider_enabled(db, ProviderId::Claude)?
        && provider_adapters::provider_source_enabled(db, ProviderId::Claude, "claude-projects")?
    {
        let claude_path =
            provider_adapters::provider_path(db, ProviderId::Claude, claude_projects_root)?;
        let claude_path = provider_adapters::provider_source_path(
            db,
            ProviderId::Claude,
            "claude-projects",
            Some(claude_path),
        )?
        .unwrap_or_else(|| claude_projects_root.to_path_buf());
        total += scan_dir(db, &claude_path)?;
    }

    for provider in [
        ProviderId::Codex,
        ProviderId::Gemini,
        ProviderId::Cursor,
        ProviderId::Antigravity,
        ProviderId::Copilot,
        ProviderId::Opencode,
    ] {
        if !provider_adapters::provider_enabled(db, provider)? {
            continue;
        }
        let path = provider_adapters::provider_path(db, provider, claude_projects_root)?;
        let stats = match provider {
            ProviderId::Codex => {
                if !provider_adapters::provider_source_enabled(db, provider, "codex-sessions")? {
                    ScanStats::default()
                } else if let Some(path) = provider_adapters::provider_source_path(
                    db,
                    provider,
                    "codex-sessions",
                    Some(path.clone()),
                )? {
                    scan_codex_dir(db, &path)?
                } else {
                    ScanStats::default()
                }
            }
            ProviderId::Gemini => {
                if !provider_adapters::provider_source_enabled(db, provider, "gemini-chats")? {
                    ScanStats::default()
                } else if let Some(path) = provider_adapters::provider_source_path(
                    db,
                    provider,
                    "gemini-chats",
                    Some(path.clone()),
                )? {
                    scan_gemini_dir(db, &path)?
                } else {
                    ScanStats::default()
                }
            }
            ProviderId::Cursor => {
                if !provider_adapters::provider_source_enabled(db, provider, "cursor-state")? {
                    ScanStats::default()
                } else if let Some(path) = provider_adapters::provider_source_path(
                    db,
                    provider,
                    "cursor-state",
                    Some(path.clone()),
                )? {
                    let (messages, tools) = provider_adapters::scan_cursor_state_db(db, &path)?;
                    ScanStats {
                        files: if messages > 0 || tools > 0 { 1 } else { 0 },
                        messages,
                        tools,
                        ..Default::default()
                    }
                } else {
                    ScanStats::default()
                }
            }
            ProviderId::Antigravity => {
                if !provider_adapters::provider_source_enabled(
                    db,
                    provider,
                    "antigravity-transcripts",
                )? {
                    ScanStats::default()
                } else if let Some(path) = provider_adapters::provider_source_path(
                    db,
                    provider,
                    "antigravity-transcripts",
                    Some(path.clone()),
                )? {
                    scan_antigravity_dir(db, &path)?
                } else {
                    ScanStats::default()
                }
            }
            ProviderId::Copilot => {
                let (cli_messages, cli_tools) =
                    if provider_adapters::provider_source_enabled(db, provider, "copilot-cli")? {
                        if let Some(cli_dir) = provider_adapters::provider_source_path(
                            db,
                            provider,
                            "copilot-cli",
                            Some(path.clone()),
                        )? {
                            provider_adapters::scan_copilot_cli_dir(db, &cli_dir)?
                        } else {
                            (0, 0)
                        }
                    } else {
                        (0, 0)
                    };
                let (otel_messages, otel_tools) = if provider_adapters::provider_source_enabled(
                    db,
                    provider,
                    "copilot-chat-otel",
                )? {
                    if let Some(otel_db) = provider_adapters::provider_source_path(
                        db,
                        provider,
                        "copilot-chat-otel",
                        paths::copilot_otel_db(),
                    )? {
                        provider_adapters::scan_copilot_otel_db(db, &otel_db)?
                    } else {
                        (0, 0)
                    }
                } else {
                    (0, 0)
                };
                let messages = cli_messages + otel_messages;
                let tools = cli_tools + otel_tools;
                ScanStats {
                    files: if messages > 0 || tools > 0 { 1 } else { 0 },
                    messages,
                    tools,
                    ..Default::default()
                }
            }
            ProviderId::Opencode => {
                let (storage_messages, storage_tools) =
                    if provider_adapters::provider_source_enabled(db, provider, "opencode-storage")?
                    {
                        if let Some(storage_dir) = provider_adapters::provider_source_path(
                            db,
                            provider,
                            "opencode-storage",
                            Some(path.clone()),
                        )? {
                            provider_adapters::scan_opencode_storage(db, &storage_dir)?
                        } else {
                            (0, 0)
                        }
                    } else {
                        (0, 0)
                    };
                let (run_messages, run_tools) = if provider_adapters::provider_source_enabled(
                    db,
                    provider,
                    "opencode-run-logs",
                )? {
                    if let Some(log_dir) = provider_adapters::provider_source_path(
                        db,
                        provider,
                        "opencode-run-logs",
                        paths::opencode_run_logs_dir(),
                    )? {
                        let stats = scan_opencode_run_logs_dir(db, &log_dir)?;
                        (stats.messages, stats.tools)
                    } else {
                        (0, 0)
                    }
                } else {
                    (0, 0)
                };
                let messages = storage_messages + run_messages;
                let tools = storage_tools + run_tools;
                ScanStats {
                    files: if messages > 0 || tools > 0 { 1 } else { 0 },
                    messages,
                    tools,
                    ..Default::default()
                }
            }
            ProviderId::Claude => ScanStats::default(),
        };
        total += stats;
    }

    // Local-git pass runs once after every enabled provider scan, so DORA/git
    // correlation is not accidentally tied to the Claude provider being enabled.
    if let Ok((repos, commits)) = git::scan_git(db) {
        total.repos = repos;
        total.commits = commits;
    }

    Ok(total)
}

impl std::ops::AddAssign for ScanStats {
    fn add_assign(&mut self, rhs: Self) {
        self.files += rhs.files;
        self.messages += rhs.messages;
        self.tools += rhs.tools;
        self.repos += rhs.repos;
        self.commits += rhs.commits;
    }
}

fn file_key(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches(".jsonl")
        .to_string()
}

fn scan_incremental_jsonl<F>(
    db: &Db,
    root: &Path,
    mut accept: impl FnMut(&Path) -> bool,
    mut parse_file: F,
) -> Result<ScanStats>
where
    F: FnMut(&Path, &str, &[u8]) -> Vec<crate::model::MessageRow>,
{
    let mut stats = ScanStats::default();
    if !root.exists() {
        return Ok(stats);
    }

    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file()
            || path.extension().and_then(|e| e.to_str()) != Some("jsonl")
            || !accept(path)
        {
            continue;
        }
        let Ok(meta) = path.metadata() else { continue };
        let size = meta.len() as i64;
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        let path_str = path.to_string_lossy().to_string();
        let prev = db.file_state(&path_str)?;
        let mut bytes_read = prev.map(|(_, b)| b).unwrap_or(0);
        if size == bytes_read {
            continue;
        }
        if size < bytes_read {
            bytes_read = 0;
        }

        let mut f = std::fs::File::open(path)?;
        f.seek(SeekFrom::Start(bytes_read as u64))?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf)?;
        let complete_len = match buf.iter().rposition(|&b| b == b'\n') {
            Some(i) => i + 1,
            None => 0,
        };
        let key = file_key(path, root);
        let rows = parse_file(path, &key, &buf[..complete_len]);
        let (m, t) = db.insert_messages(&rows)?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        db.set_file_state(&path_str, mtime, bytes_read + complete_len as i64, now)?;

        if complete_len > 0 {
            stats.files += 1;
            stats.messages += m as i64;
            stats.tools += t as i64;
        }
    }
    Ok(stats)
}

fn scan_codex_dir(db: &Db, root: &Path) -> Result<ScanStats> {
    if db.get_setting(CODEX_USAGE_TOTAL_DELTA_KEY)?.as_deref() != Some("done") {
        db.reset_provider_derived_rows(ProviderId::Codex, root)?;
        let stats = scan_codex_dir_inner(db, root)?;
        db.set_setting(CODEX_USAGE_TOTAL_DELTA_KEY, "done")?;
        return Ok(stats);
    }
    scan_codex_dir_inner(db, root)
}

fn scan_codex_dir_inner(db: &Db, root: &Path) -> Result<ScanStats> {
    let mut stats = ScanStats::default();
    if !root.exists() {
        return Ok(stats);
    }

    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Ok(meta) = path.metadata() else { continue };
        let size = meta.len() as i64;
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        let path_str = path.to_string_lossy().to_string();
        let prev = db.file_state(&path_str)?;
        let mut bytes_read = prev.map(|(_, b)| b).unwrap_or(0);
        if size == bytes_read {
            continue;
        }
        if size < bytes_read {
            bytes_read = 0;
        }

        let Ok(bytes) = std::fs::read(path) else {
            continue;
        };
        let complete_len = match bytes.iter().rposition(|&b| b == b'\n') {
            Some(i) => i + 1,
            None => 0,
        };
        let key = file_key(path, root);
        let mut rows = Vec::new();
        let mut session_id = None;
        let mut cwd = None;
        let mut model = None;
        let mut total_usage = None;
        let mut offset = 0usize;

        for (line_no, line) in bytes[..complete_len].split(|&b| b == b'\n').enumerate() {
            if line.is_empty() {
                offset += 1;
                continue;
            }
            let line_end = offset + line.len() + 1;
            if let Ok(s) = std::str::from_utf8(line) {
                let row = provider_adapters::parse_codex_line(
                    s,
                    &key,
                    line_no,
                    &mut session_id,
                    &mut cwd,
                    &mut model,
                    &mut total_usage,
                );
                if line_end as i64 > bytes_read {
                    if let Some(row) = row {
                        rows.push(row);
                    }
                }
            }
            offset = line_end;
        }

        let (m, t) = db.insert_messages(&rows)?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        db.set_file_state(&path_str, mtime, complete_len as i64, now)?;

        if complete_len > bytes_read as usize {
            stats.files += 1;
            stats.messages += m as i64;
            stats.tools += t as i64;
        }
    }
    Ok(stats)
}

fn scan_gemini_dir(db: &Db, root: &Path) -> Result<ScanStats> {
    scan_incremental_jsonl(
        db,
        root,
        |path| {
            path.parent()
                .and_then(|p| p.file_name())
                .map(|n| n.to_string_lossy() == "chats")
                .unwrap_or(false)
        },
        |_path, key, bytes| {
            let mut rows = Vec::new();
            for (line_no, line) in bytes.split(|&b| b == b'\n').enumerate() {
                if line.is_empty() {
                    continue;
                }
                if let Ok(s) = std::str::from_utf8(line) {
                    if let Some(row) = provider_adapters::parse_gemini_line(s, key, line_no) {
                        rows.push(row);
                    }
                }
            }
            rows
        },
    )
}

fn scan_antigravity_dir(db: &Db, root: &Path) -> Result<ScanStats> {
    scan_incremental_jsonl(
        db,
        root,
        |path| {
            path.file_name()
                .map(|n| n.to_string_lossy() == "transcript.jsonl")
                .unwrap_or(false)
                && path
                    .components()
                    .any(|c| c.as_os_str().to_string_lossy() == ".system_generated")
        },
        |_path, key, bytes| {
            let mut rows = Vec::new();
            for (line_no, line) in bytes.split(|&b| b == b'\n').enumerate() {
                if line.is_empty() {
                    continue;
                }
                if let Ok(s) = std::str::from_utf8(line) {
                    if let Some(row) = provider_adapters::parse_antigravity_line(s, key, line_no) {
                        rows.push(row);
                    }
                }
            }
            rows
        },
    )
}

fn scan_opencode_run_logs_dir(db: &Db, root: &Path) -> Result<ScanStats> {
    scan_incremental_jsonl(
        db,
        root,
        |_| true,
        |_path, key, bytes| {
            let mut rows = Vec::new();
            for (line_no, line) in bytes.split(|&b| b == b'\n').enumerate() {
                if line.is_empty() {
                    continue;
                }
                if let Ok(s) = std::str::from_utf8(line) {
                    if let Some(row) = provider_adapters::parse_opencode_run_line(s, key, line_no) {
                        rows.push(row);
                    }
                }
            }
            rows
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::pricing::Pricing;
    use std::fs;
    use std::io::Write;

    fn tmp_dir(name: &str) -> std::path::PathBuf {
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("harness-scan-{name}-{n}"))
    }

    #[test]
    fn codex_scan_uses_total_usage_delta_incrementally() {
        let root = tmp_dir("codex");
        fs::create_dir_all(&root).unwrap();
        let file = root.join("session.jsonl");
        fs::write(
            &file,
            concat!(
                r#"{"timestamp":"2026-06-20T10:00:00Z","type":"session_meta","payload":{"id":"s1","cwd":"D:/repo/app"}}"#,
                "\n",
                r#"{"timestamp":"2026-06-20T10:00:01Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":30},"last_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":30}}}}"#,
                "\n",
                r#"{"timestamp":"2026-06-20T10:00:02Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":30},"last_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":30}}}}"#,
                "\n",
            ),
        )
        .unwrap();

        let db = Db::open_in_memory().unwrap();
        scan_codex_dir(&db, &root).unwrap();
        let totals = db
            .overview_totals_for_providers(
                &Pricing::load_default(),
                None,
                None,
                &[ProviderId::Codex],
            )
            .unwrap();
        assert_eq!(totals.input_tokens, 100);
        assert_eq!(totals.output_tokens, 30);
        assert_eq!(totals.cache_read_tokens, 20);

        fs::OpenOptions::new()
            .append(true)
            .open(&file)
            .unwrap()
            .write_all(
                concat!(
                    r#"{"timestamp":"2026-06-20T10:00:03Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":175,"cached_input_tokens":40,"output_tokens":45},"last_token_usage":{"input_tokens":75,"cached_input_tokens":20,"output_tokens":15}}}}"#,
                    "\n",
                )
                .as_bytes(),
            )
            .unwrap();

        scan_codex_dir(&db, &root).unwrap();
        let totals = db
            .overview_totals_for_providers(
                &Pricing::load_default(),
                None,
                None,
                &[ProviderId::Codex],
            )
            .unwrap();
        assert_eq!(totals.input_tokens, 175);
        assert_eq!(totals.output_tokens, 45);
        assert_eq!(totals.cache_read_tokens, 40);

        fs::remove_dir_all(root).ok();
    }
}
