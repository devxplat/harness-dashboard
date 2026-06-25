# Data Sources

harness-dashboard builds a local derived analytics store from provider files, editor databases,
local git repositories, and explicit integrations. The dashboard never requires a hosted backend.
Most sources are purely local; GitHub and Google Calendar are opt-in network enrichments.

## Source Model

Every AI coding source is normalized into provider-tagged message rows and optional tool-call rows.
Each row carries provenance:

- `provider`: `claude`, `codex`, `gemini`, `cursor`, `antigravity`, `copilot`, or `opencode`.
- `usage_source`: `exact`, `provider_reported`, or `unavailable`.
- `cost_source`: `api_estimate`, `provider_reported`, or `unavailable`.
- `source_path`, `source_key`, and `source_fingerprint` for mutable source adapters.

This lets the UI distinguish exact token counts from provider-reported values and unavailable
fields instead of presenting every source as equally precise.

## AI Coding Providers

| Provider       | Source key                | Default path                                   | Env override                  | Usage       | Cost        | Tools/prompts |
| -------------- | ------------------------- | ---------------------------------------------- | ----------------------------- | ----------- | ----------- | ------------- |
| Claude Code    | `claude-projects`         | `~/.claude/projects`                           | `CLAUDE_PROJECTS_DIR`         | exact       | estimated   | yes/yes       |
| Codex          | `codex-sessions`          | `~/.codex/sessions`                            | `CODEX_SESSIONS_DIR`          | exact       | estimated   | yes/yes       |
| Gemini CLI     | `gemini-chats`            | `~/.gemini/tmp`                                | `GEMINI_CHATS_DIR`            | exact       | estimated   | yes/yes       |
| Cursor         | `cursor-state`            | Cursor user `globalStorage/state.vscdb`        | `CURSOR_STATE_DB`             | reported    | reported    | yes/yes       |
| Antigravity    | `antigravity-transcripts` | `~/.gemini/antigravity/brain`                  | `ANTIGRAVITY_TRANSCRIPTS_DIR` | unavailable | unavailable | yes/no        |
| GitHub Copilot | `copilot-chat-otel`       | auto-detected VS Code/Cursor `agent-traces.db` | `COPILOT_OTEL_DB`             | reported    | unavailable | yes/yes       |
| GitHub Copilot | `copilot-cli`             | `~/.copilot`                                   | `COPILOT_HOME`                | reported    | unavailable | yes/yes       |
| opencode       | `opencode-storage`        | `~/.local/share/opencode`                      | `OPENCODE_DATA_DIR`           | reported    | reported    | yes/yes       |
| opencode       | `opencode-run-logs`       | unset                                          | `OPENCODE_RUN_LOGS_DIR`       | reported    | reported    | yes/yes       |

Settings can enable/disable providers and source entries, override paths, and trigger refreshes.

## Incremental Scanning

File-tree sources are scanned incrementally. The scanner tracks each file's mtime and byte offset,
reads only complete new lines, and leaves partial trailing writes to be retried later. If a file is
truncated or rotated, its high-water mark is reset.

Mutable or database-backed sources use source keys and fingerprints. When an item changes, old rows
for that `(provider, source_path, source_key)` are replaced; when an item disappears, stale derived
rows are pruned.

After AI provider scans, local git scanning runs once so delivery metrics are not tied to any one
AI provider being enabled.

## Snapshot Dedup

Some providers emit repeated snapshots for the same assistant response. For those streams, the
dedup key is `(session_id, message_id)`, not the per-line UUID.

The rules are:

- keep one message row per `(session_id, message_id)`;
- do not sum repeated usage totals across snapshot siblings;
- when superseding a sibling, preserve its tool calls by re-pointing them to the keeper.

This invariant protects token and cost totals from silent inflation.

## Local Git

Local git scanning reads repositories discovered from observed workspaces. It collects commits,
authors, co-authors, insertions/deletions, conventional-commit categories, GitHub remote metadata,
and tags used as local deployment signals.

This source is offline. It does not call GitHub; it reads the repositories on disk with vendored
`libgit2`.

## GitHub Integration

GitHub is an explicit enrichment source configured in Settings. A token is validated against the
GitHub API, encrypted at rest, and then used only for selected repositories.

The sync imports:

- pull requests and PR cycle-time data;
- releases and Actions workflow runs as deployment signals;
- incident issues when configured by label;
- repo metadata, high-water marks, ETags, and rate-limit status.

Sync progress is emitted over SSE so the UI can show live backfill state.

## Google Calendar Integration

Google Calendar is optional and requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the
server. The dashboard starts an OAuth loopback flow, stores tokens encrypted at rest, and reads
primary-calendar event timing.

Calendar events feed meeting overlap, productive-hours heatmaps, focus estimates, and warm-up
analysis. Event contents are not a general analytics source; the integration is scoped to event
timing needed for productivity views.

## Database As Derived State

SQLite stores derived rows and settings. Provider files, editor databases, local repositories, and
configured remote integration APIs remain the source of truth. It is acceptable for schema changes
to clear and replay derived tables when that is safer than fragile in-place migration.
