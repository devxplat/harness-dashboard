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
    provider               TEXT NOT NULL DEFAULT 'claude',
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
    usage_source           TEXT NOT NULL DEFAULT 'exact',
    reported_cost_usd      REAL,
    cost_source            TEXT NOT NULL DEFAULT 'api_estimate',
    source_path            TEXT,
    source_key             TEXT,
    source_fingerprint     TEXT,
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
CREATE INDEX IF NOT EXISTS idx_messages_ts_provider ON messages(timestamp, provider);
CREATE INDEX IF NOT EXISTS idx_messages_ts_provider_session ON messages(timestamp, provider, session_id);
CREATE INDEX IF NOT EXISTS idx_messages_type_ts_provider ON messages(type, timestamp, provider);
CREATE INDEX IF NOT EXISTS idx_messages_project_rollup ON messages(provider, project_slug, cwd, session_id);
CREATE INDEX IF NOT EXISTS idx_messages_daily_cover ON messages(timestamp, provider, session_id, input_tokens, output_tokens, cache_read_tokens, cache_create_5m_tokens, cache_create_1h_tokens);
CREATE INDEX IF NOT EXISTS idx_messages_model_cover ON messages(type, timestamp, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_create_5m_tokens, cache_create_1h_tokens);
CREATE INDEX IF NOT EXISTS idx_messages_project_rollup_cover ON messages(provider, project_slug, cwd, session_id, type, prompt_chars, input_tokens, output_tokens, cache_create_5m_tokens, cache_create_1h_tokens, cache_read_tokens);
CREATE INDEX IF NOT EXISTS idx_messages_provider_summary_cover ON messages(timestamp, provider, session_id, type, prompt_chars, input_tokens, output_tokens, cache_read_tokens, cache_create_5m_tokens, cache_create_1h_tokens, reported_cost_usd, usage_source, cost_source);
CREATE INDEX IF NOT EXISTS idx_messages_prompt_scan_cover ON messages(provider, session_id, timestamp, type, is_sidechain, uuid, project_slug, cwd, prompt_chars, model, input_tokens, output_tokens, cache_read_tokens, cache_create_5m_tokens, cache_create_1h_tokens, reported_cost_usd);
CREATE INDEX IF NOT EXISTS idx_messages_bundle_scan_cover ON messages(timestamp, provider, session_id, project_slug, cwd, type, model, prompt_chars, input_tokens, output_tokens, cache_read_tokens, cache_create_5m_tokens, cache_create_1h_tokens, usage_source, cost_source, reported_cost_usd);

CREATE TABLE IF NOT EXISTS tool_calls (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    provider      TEXT NOT NULL DEFAULT 'claude',
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
CREATE INDEX IF NOT EXISTS idx_tools_provider ON tool_calls(provider);
CREATE INDEX IF NOT EXISTS idx_tools_provider_ts_name ON tool_calls(provider, timestamp, tool_name);
CREATE INDEX IF NOT EXISTS idx_tools_provider_name_useid ON tool_calls(provider, tool_name, tool_use_id);
CREATE INDEX IF NOT EXISTS idx_tools_ts_provider_name ON tool_calls(timestamp, provider, tool_name);
CREATE INDEX IF NOT EXISTS idx_tools_result_ts_provider_useid ON tool_calls(timestamp, provider, tool_use_id) WHERE tool_name='_tool_result';

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

CREATE TABLE IF NOT EXISTS source_items (
    provider    TEXT NOT NULL,
    source_path TEXT NOT NULL,
    source_key  TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    mtime       REAL,
    scanned_at  REAL NOT NULL,
    PRIMARY KEY (provider, source_path, source_key)
);
CREATE INDEX IF NOT EXISTS idx_source_items_provider ON source_items(provider);

-- Local git history (Phase 1). Read offline from each repo discovered behind a
-- transcript cwd; the on-disk repo is the source of truth, so these tables are
-- derived and may be cleared and replayed like every other table here.

-- Per-repo incremental sync state — the commit-side analogue of `files`. One row
-- per canonical repo root; `last_ingested_sha` is the high-water mark we walk
-- back from on the next scan.
CREATE TABLE IF NOT EXISTS git_repos (
    repo_key          TEXT PRIMARY KEY, -- canonicalized repo-root path
    repo_root         TEXT NOT NULL,
    primary_slug      TEXT,             -- a representative transcript slug for this repo
    slugs_json        TEXT,             -- JSON array of every slug whose cwd maps here
    last_ingested_sha TEXT,             -- HEAD at last ingest (walk hides this on next scan)
    head_branch       TEXT,
    commit_count      INTEGER NOT NULL DEFAULT 0,
    last_scanned_at   REAL,
    -- origin remote, parsed offline during the local scan; gh_owner/gh_repo are the
    -- GitHub coordinates the (opt-in) Phase-2 enrichment uses. NULL when not GitHub.
    remote_url        TEXT,
    gh_owner          TEXT,
    gh_repo           TEXT,
    -- Whether this repo participates in the GitHub enrichment sync (user-toggled).
    gh_sync_enabled   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS commits (
    repo_key              TEXT NOT NULL,
    sha                   TEXT NOT NULL,
    project_slug          TEXT,
    author_name           TEXT,
    author_email          TEXT,
    -- UTC instant in the same RFC3339 "…Z" shape as messages.timestamp, so the
    -- two are directly comparable (string compare) for session overlap and share
    -- the substr(…,1,10) daily-grouping convention.
    authored_at_utc       TEXT NOT NULL,
    -- Local wall-clock the author saw (their own commit tz offset), for display.
    authored_at_local     TEXT,
    authored_tz_offset_min INTEGER NOT NULL DEFAULT 0,
    -- Precomputed because SQLite has no timezone math: local hour (0–23) and
    -- day-of-week (0=Sunday..6=Saturday, matching strftime('%w')).
    authored_local_hour   INTEGER NOT NULL DEFAULT 0,
    authored_dow          INTEGER NOT NULL DEFAULT 0,
    committed_at_utc      TEXT,
    branch                TEXT,
    message               TEXT,
    subject               TEXT,
    is_merge              INTEGER NOT NULL DEFAULT 0,
    files_changed         INTEGER NOT NULL DEFAULT 0,
    insertions            INTEGER NOT NULL DEFAULT 0,
    deletions             INTEGER NOT NULL DEFAULT 0,
    -- JSON array of "Name <email>" co-author trailers parsed from the message.
    coauthors             TEXT,
    -- AI attribution (union of two independent signals; kept separate so the UI
    -- can show a per-commit breakdown). Computed at ingest → query-time reads are
    -- plain indexed columns.
    ai_session_overlap    INTEGER NOT NULL DEFAULT 0, -- authored during/just-after a Claude session on this repo
    ai_coauthor_trailer   INTEGER NOT NULL DEFAULT 0, -- commit message carries a Claude co-author/Generated trailer
    PRIMARY KEY (repo_key, sha)
);

CREATE INDEX IF NOT EXISTS idx_commits_authored   ON commits(authored_at_utc);
CREATE INDEX IF NOT EXISTS idx_commits_date        ON commits(substr(authored_at_utc, 1, 10));
CREATE INDEX IF NOT EXISTS idx_commits_project     ON commits(project_slug);
CREATE INDEX IF NOT EXISTS idx_commits_localbucket ON commits(authored_local_hour, authored_dow);
CREATE INDEX IF NOT EXISTS idx_commits_ai_overlap  ON commits(ai_session_overlap);
CREATE INDEX IF NOT EXISTS idx_commits_ai_trailer  ON commits(ai_coauthor_trailer);

-- ---- Optional remote enrichment (Phase 2: GitHub; Phase 3: Google Calendar) ----
-- These are populated only when the user opts in by configuring a token / OAuth.
-- All times are RFC3339 "…Z" so they compare directly with messages.timestamp and
-- commits.authored_at_utc.

CREATE TABLE IF NOT EXISTS pull_requests (
    repo_key            TEXT NOT NULL,
    number              INTEGER NOT NULL,
    title               TEXT,
    state               TEXT,            -- open | closed | merged
    author              TEXT,
    created_at_utc      TEXT,
    merged_at_utc       TEXT,
    closed_at_utc       TEXT,
    head_branch         TEXT,
    base_branch         TEXT,
    additions           INTEGER NOT NULL DEFAULT 0,
    deletions           INTEGER NOT NULL DEFAULT 0,
    changed_files       INTEGER NOT NULL DEFAULT 0,
    review_count        INTEGER NOT NULL DEFAULT 0,
    first_review_at_utc TEXT,
    merge_commit_sha    TEXT,
    html_url            TEXT,
    ai_session_overlap  INTEGER NOT NULL DEFAULT 0, -- opened/merged during a Claude session
    PRIMARY KEY (repo_key, number)
);
CREATE INDEX IF NOT EXISTS idx_pr_created ON pull_requests(created_at_utc);
CREATE INDEX IF NOT EXISTS idx_pr_merged  ON pull_requests(merged_at_utc);

-- A "deployment" abstraction over git tags (local), GitHub releases, and GitHub
-- Actions workflow runs — whatever sources are configured. `kind` disambiguates.
CREATE TABLE IF NOT EXISTS deployments (
    repo_key       TEXT NOT NULL,
    kind           TEXT NOT NULL,   -- tag | release | run
    ext_id         TEXT NOT NULL,   -- tag name / release id / run id
    name           TEXT,
    created_at_utc TEXT,
    status         TEXT,            -- success | failure | NULL
    sha            TEXT,
    html_url       TEXT,
    PRIMARY KEY (repo_key, kind, ext_id)
);
CREATE INDEX IF NOT EXISTS idx_deploy_created ON deployments(created_at_utc);

CREATE TABLE IF NOT EXISTS calendar_events (
    event_id       TEXT PRIMARY KEY,
    calendar_id    TEXT,
    start_utc      TEXT,
    end_utc        TEXT,
    title          TEXT,
    attendee_count INTEGER NOT NULL DEFAULT 0,
    is_busy        INTEGER NOT NULL DEFAULT 1,
    is_meeting     INTEGER NOT NULL DEFAULT 0, -- >1 attendee
    updated_at_utc TEXT
);
CREATE INDEX IF NOT EXISTS idx_cal_start ON calendar_events(start_utc);

-- Per-(repo, resource) GitHub sync state: the ETag for conditional requests and the
-- high-water mark for incremental fetches, so steady-state syncs cost ~1 request.
CREATE TABLE IF NOT EXISTS github_sync_state (
    repo_key       TEXT NOT NULL,
    resource       TEXT NOT NULL,   -- pulls | releases | runs
    etag           TEXT,            -- last ETag for the conditional GET of page 1
    high_water_utc TEXT,            -- max created/merged time seen (incremental bound)
    last_status    TEXT,            -- ok | not_modified | error | rate_limited
    last_synced_at TEXT,
    PRIMARY KEY (repo_key, resource)
);
"#;

/// Idempotent `ADD COLUMN` migrations (SQLite has no `IF NOT EXISTS` for columns,
/// so a duplicate-column error is expected and ignored). Run after `SCHEMA_SQL`.
pub const MIGRATIONS: &[&str] = &[
    "ALTER TABLE messages ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude'",
    "ALTER TABLE messages ADD COLUMN usage_source TEXT NOT NULL DEFAULT 'exact'",
    "ALTER TABLE messages ADD COLUMN reported_cost_usd REAL",
    "ALTER TABLE messages ADD COLUMN cost_source TEXT NOT NULL DEFAULT 'api_estimate'",
    "ALTER TABLE messages ADD COLUMN source_path TEXT",
    "ALTER TABLE messages ADD COLUMN source_key TEXT",
    "ALTER TABLE messages ADD COLUMN source_fingerprint TEXT",
    "ALTER TABLE tool_calls ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude'",
    "CREATE INDEX IF NOT EXISTS idx_messages_provider ON messages(provider)",
    "CREATE INDEX IF NOT EXISTS idx_messages_provider_msgid ON messages(provider, session_id, message_id)",
    "CREATE INDEX IF NOT EXISTS idx_messages_provider_session_ts ON messages(provider, session_id, timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_tools_provider ON tool_calls(provider)",
    "CREATE INDEX IF NOT EXISTS idx_tools_provider_ts_name ON tool_calls(provider, timestamp, tool_name)",
    "CREATE INDEX IF NOT EXISTS idx_tools_provider_name_useid ON tool_calls(provider, tool_name, tool_use_id)",
    // Multi-provider range aggregation: the overview/daily/sessions/projects/prompts
    // queries filter `provider IN (…) AND timestamp >= … < …`. Without a leading
    // (provider, timestamp) index SQLite full-scans the messages table; these make
    // the WHERE an index range scan.
    "CREATE INDEX IF NOT EXISTS idx_messages_provider_ts ON messages(provider, timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_messages_type_provider_ts ON messages(type, provider, timestamp)",
    // expensive_prompts joins each user prompt to the assistant messages in the same
    // session within its turn window: (provider, session_id, type='assistant',
    // timestamp >= prompt). Without session_id in the index the join scanned every
    // assistant message of the provider per prompt (measured: 110s → 1.2s with this).
    "CREATE INDEX IF NOT EXISTS idx_messages_provider_session_type_ts ON messages(provider, session_id, type, timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_messages_ts_provider ON messages(timestamp, provider)",
    "CREATE INDEX IF NOT EXISTS idx_messages_ts_provider_session ON messages(timestamp, provider, session_id)",
    "CREATE INDEX IF NOT EXISTS idx_messages_type_ts_provider ON messages(type, timestamp, provider)",
    "CREATE INDEX IF NOT EXISTS idx_messages_project_rollup ON messages(provider, project_slug, cwd, session_id)",
    "CREATE INDEX IF NOT EXISTS idx_messages_daily_cover ON messages(timestamp, provider, session_id, input_tokens, output_tokens, cache_read_tokens, cache_create_5m_tokens, cache_create_1h_tokens)",
    "CREATE INDEX IF NOT EXISTS idx_messages_model_cover ON messages(type, timestamp, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_create_5m_tokens, cache_create_1h_tokens)",
    "CREATE INDEX IF NOT EXISTS idx_messages_project_rollup_cover ON messages(provider, project_slug, cwd, session_id, type, prompt_chars, input_tokens, output_tokens, cache_create_5m_tokens, cache_create_1h_tokens, cache_read_tokens)",
    "CREATE INDEX IF NOT EXISTS idx_messages_provider_summary_cover ON messages(timestamp, provider, session_id, type, prompt_chars, input_tokens, output_tokens, cache_read_tokens, cache_create_5m_tokens, cache_create_1h_tokens, reported_cost_usd, usage_source, cost_source)",
    "CREATE INDEX IF NOT EXISTS idx_messages_prompt_scan_cover ON messages(provider, session_id, timestamp, type, is_sidechain, uuid, project_slug, cwd, prompt_chars, model, input_tokens, output_tokens, cache_read_tokens, cache_create_5m_tokens, cache_create_1h_tokens, reported_cost_usd)",
    "CREATE INDEX IF NOT EXISTS idx_messages_bundle_scan_cover ON messages(timestamp, provider, session_id, project_slug, cwd, type, model, prompt_chars, input_tokens, output_tokens, cache_read_tokens, cache_create_5m_tokens, cache_create_1h_tokens, usage_source, cost_source, reported_cost_usd)",
    "CREATE INDEX IF NOT EXISTS idx_messages_source_item ON messages(provider, source_path, source_key)",
    // tools_for_providers LEFT JOINs results on (provider, tool_use_id); the existing
    // (provider, tool_name, tool_use_id) index can't serve a tool_name-less lookup.
    "CREATE INDEX IF NOT EXISTS idx_tools_provider_useid ON tool_calls(provider, tool_use_id)",
    "CREATE INDEX IF NOT EXISTS idx_tools_ts_provider_name ON tool_calls(timestamp, provider, tool_name)",
    "CREATE INDEX IF NOT EXISTS idx_tools_result_ts_provider_useid ON tool_calls(timestamp, provider, tool_use_id) WHERE tool_name='_tool_result'",
    "ALTER TABLE git_repos ADD COLUMN remote_url TEXT",
    "ALTER TABLE git_repos ADD COLUMN gh_owner TEXT",
    "ALTER TABLE git_repos ADD COLUMN gh_repo TEXT",
    "ALTER TABLE git_repos ADD COLUMN gh_sync_enabled INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE commits ADD COLUMN coauthors TEXT",
];
