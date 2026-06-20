//! Home / `.claude` / projects / database path resolution, and project-slug derivation.
//!
//! Claude Code's on-disk project slug encodes drive letters, colons, and path
//! separators. We treat the slug (the directory name under the projects root) as
//! opaque and never "normalize" it — see constitution principle VIII.

use std::path::{Path, PathBuf};

fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var(key)
        .ok()
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

/// `~/.claude` (override with `CLAUDE_DIR`).
pub fn claude_dir() -> PathBuf {
    env_path("CLAUDE_DIR").unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".claude")
    })
}

/// Transcript root to scan (override with `CLAUDE_PROJECTS_DIR`).
pub fn projects_dir() -> PathBuf {
    env_path("CLAUDE_PROJECTS_DIR").unwrap_or_else(|| claude_dir().join("projects"))
}

/// SQLite database path (override with `HARNESS_DB`, or legacy `TOKEN_DASHBOARD_DB`).
pub fn db_path() -> PathBuf {
    env_path("HARNESS_DB")
        .or_else(|| env_path("TOKEN_DASHBOARD_DB"))
        .unwrap_or_else(|| claude_dir().join("harness-dashboard.db"))
}

/// Project slug = the first path component of `file` under `projects_root`.
pub fn project_slug_for(file: &Path, projects_root: &Path) -> String {
    file.strip_prefix(projects_root)
        .ok()
        .and_then(|rel| rel.components().next())
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .unwrap_or_else(|| "unknown".to_string())
}
