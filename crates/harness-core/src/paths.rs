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

pub fn codex_sessions_dir() -> PathBuf {
    env_path("CODEX_SESSIONS_DIR").unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".codex")
            .join("sessions")
    })
}

pub fn codex_models_cache() -> PathBuf {
    env_path("CODEX_MODELS_CACHE").unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".codex")
            .join("models_cache.json")
    })
}

pub fn gemini_chats_dir() -> PathBuf {
    env_path("GEMINI_CHATS_DIR").unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".gemini")
            .join("tmp")
    })
}

pub fn cursor_state_db() -> PathBuf {
    env_path("CURSOR_STATE_DB").unwrap_or_else(|| {
        std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                dirs::home_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join("AppData")
                    .join("Roaming")
            })
            .join("Cursor")
            .join("User")
            .join("globalStorage")
            .join("state.vscdb")
    })
}

pub fn antigravity_transcripts_dir() -> PathBuf {
    env_path("ANTIGRAVITY_TRANSCRIPTS_DIR").unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".gemini")
            .join("antigravity")
            .join("brain")
    })
}

pub fn copilot_home_dir() -> PathBuf {
    env_path("COPILOT_HOME").unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".copilot")
    })
}

pub fn copilot_otel_db() -> Option<PathBuf> {
    env_path("COPILOT_OTEL_DB").or_else(|| {
        copilot_otel_candidates()
            .into_iter()
            .find(|path| path.exists())
    })
}

pub fn copilot_otel_candidates() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        let appdata = PathBuf::from(appdata);
        roots.push(
            appdata
                .join("Code")
                .join("User")
                .join("globalStorage")
                .join("github.copilot-chat")
                .join("agent-traces.db"),
        );
        roots.push(
            appdata
                .join("Code - Insiders")
                .join("User")
                .join("globalStorage")
                .join("github.copilot-chat")
                .join("agent-traces.db"),
        );
        roots.push(
            appdata
                .join("Cursor")
                .join("User")
                .join("globalStorage")
                .join("github.copilot-chat")
                .join("agent-traces.db"),
        );
    }
    roots
}

pub fn opencode_data_dir() -> PathBuf {
    env_path("OPENCODE_DATA_DIR").unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".local")
            .join("share")
            .join("opencode")
    })
}

pub fn opencode_run_logs_dir() -> Option<PathBuf> {
    env_path("OPENCODE_RUN_LOGS_DIR")
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
