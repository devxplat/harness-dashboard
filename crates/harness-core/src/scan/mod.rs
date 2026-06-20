//! Incremental transcript scan.
//!
//! Walk `*.jsonl` under the projects root, read only the bytes past each file's
//! recorded high-water mark, parse complete lines, and hand them to the database
//! (which applies snapshot dedup). The high-water mark always sits behind a
//! partial trailing line so a mid-write record is re-read once complete.

use crate::db::Db;
use crate::error::Result;
use crate::jsonl;
use crate::paths;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

#[derive(Debug, Default, Clone, Copy)]
pub struct ScanStats {
    pub files: i64,
    pub messages: i64,
    pub tools: i64,
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
