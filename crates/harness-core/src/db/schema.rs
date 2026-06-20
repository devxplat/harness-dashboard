//! SQLite DDL. The transcripts on disk are the source of truth; every table here
//! is derived and may be cleared and replayed.

pub const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS files (
    path       TEXT PRIMARY KEY,
    mtime      REAL NOT NULL,
    bytes_read INTEGER NOT NULL,
    scanned_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
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

CREATE INDEX IF NOT EXISTS idx_messages_session   ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_project   ON messages(project_slug);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_model     ON messages(model);
CREATE INDEX IF NOT EXISTS idx_messages_msgid     ON messages(session_id, message_id);
CREATE INDEX IF NOT EXISTS idx_messages_parent    ON messages(parent_uuid);
CREATE INDEX IF NOT EXISTS idx_messages_agent     ON messages(agent_id);
CREATE INDEX IF NOT EXISTS idx_messages_date      ON messages(substr(timestamp, 1, 10));
CREATE INDEX IF NOT EXISTS idx_messages_type_ts   ON messages(type, timestamp);
-- Supports the per-prompt token-attribution range join (expensive_prompts):
-- "same session, timestamp within the turn window". Without it that query is O(60s+).
CREATE INDEX IF NOT EXISTS idx_messages_session_ts ON messages(session_id, timestamp);

CREATE TABLE IF NOT EXISTS tool_calls (
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
);

CREATE INDEX IF NOT EXISTS idx_tools_session ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_tools_name_ts ON tool_calls(tool_name, timestamp);
CREATE INDEX IF NOT EXISTS idx_tools_target  ON tool_calls(target);
CREATE INDEX IF NOT EXISTS idx_tools_useid   ON tool_calls(tool_use_id);
CREATE INDEX IF NOT EXISTS idx_tools_msg     ON tool_calls(message_uuid);

CREATE TABLE IF NOT EXISTS summary_daily (
    day                    TEXT PRIMARY KEY,
    turns                  INTEGER NOT NULL DEFAULT 0,
    input_tokens           INTEGER NOT NULL DEFAULT 0,
    output_tokens          INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens      INTEGER NOT NULL DEFAULT 0,
    cache_create_5m_tokens INTEGER NOT NULL DEFAULT 0,
    cache_create_1h_tokens INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS summary_sessions (
    session_id             TEXT PRIMARY KEY,
    project_slug           TEXT,
    sample_cwd             TEXT,
    started                TEXT,
    ended                  TEXT,
    turns                  INTEGER NOT NULL DEFAULT 0,
    input_tokens           INTEGER NOT NULL DEFAULT 0,
    output_tokens          INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens      INTEGER NOT NULL DEFAULT 0,
    cache_create_5m_tokens INTEGER NOT NULL DEFAULT 0,
    cache_create_1h_tokens INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS summary_meta (k TEXT PRIMARY KEY, v TEXT);

CREATE TABLE IF NOT EXISTS plan           (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS settings       (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS dismissed_tips (tip_key TEXT PRIMARY KEY, dismissed_at REAL);
"#;
