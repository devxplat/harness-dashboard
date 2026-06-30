# Data Model — harness-dashboard v0.1

SQLite schema and the invariants the scanner must uphold. The on-disk JSONL transcripts are the
source of truth; every table below is derived and may be cleared and rebuilt from them.

## Source record (Claude Code JSONL)

One transcript line is a JSON object. Fields the scanner consumes:

| Path | Meaning |
| --- | --- |
| `uuid` | per-line id (NOT the dedup key) |
| `parentUuid` | previous message link |
| `sessionId` | session id |
| `type` | `user` \| `assistant` \| … |
| `timestamp` | ISO 8601 |
| `cwd`, `gitBranch`, `version`, `entrypoint` | context (optional) |
| `isSidechain`, `agentId` | subagent dispatch markers |
| `message.id` | **snapshot dedup key** (with `sessionId`) |
| `message.model` | model id (may be null) |
| `message.usage.input_tokens` | fresh input |
| `message.usage.output_tokens` | output |
| `message.usage.cache_read_input_tokens` | cache reads |
| `message.usage.cache_creation.ephemeral_5m_input_tokens` | 5m cache writes |
| `message.usage.cache_creation.ephemeral_1h_input_tokens` | 1h cache writes |
| `message.content[]` | text / `tool_use` / `tool_result` blocks |

Slash commands appear inside user-message content as `<command-name>/slug</command-name>` and are
synthesized into a `Skill` tool-call row.

## Tables

### `messages`
`uuid` (PK), `parent_uuid`, `session_id` (NN), `project_slug` (NN), `cwd`, `git_branch`,
`cc_version`, `entrypoint`, `type` (NN), `is_sidechain` (INT), `agent_id`, `timestamp` (NN),
`model`, `stop_reason`, `prompt_id`, `message_id`, `input_tokens`, `output_tokens`,
`cache_read_tokens`, `cache_create_5m_tokens`, `cache_create_1h_tokens` (all INT default 0),
`prompt_text`, `prompt_chars` (INT), `tool_calls_json` (TEXT — compact `[{name,target}]` for the
UI), `attribution_skill`.

Indexes: `session`, `project`, `timestamp`, `model`, `(session_id, message_id)`, `parent`,
`agent`, `substr(timestamp,1,10)` (day), `(type, model)`, `(timestamp, session_id)`,
`(timestamp, project_slug)`, `(type, timestamp, model)`.

### `tool_calls`
`id` (PK autoinc), `message_uuid` (NN), `session_id` (NN), `project_slug` (NN), `tool_name` (NN —
includes synthetic `Skill` rows and `_tool_result` pseudo-rows), `target`, `result_tokens` (INT),
`is_error` (INT default 0), `timestamp` (NN), `tool_use_id`.
Indexes: `session`, `(tool_name, timestamp)`, `target`, `tool_use_id`.

### `files` (incremental scan state)
`path` (PK), `mtime` (REAL), `bytes_read` (INT), `scanned_at` (REAL).

### Summary tables (materialized)
- `summary_daily(day PK, turns, input, output, cache_read, cache_5m, cache_1h)`
- `summary_projects(day, project_slug, sample_cwd, turns, …tokens; PK(day,project_slug))`
- `summary_models(day, model, turns, …tokens; PK(day,model))`
- `summary_tools(day, tool_name, calls, result_tokens; PK(day,tool_name))`
- `summary_sessions(session_id PK, project_slug, sample_cwd, started, ended, turns, …tokens)`
- `summary_meta(k PK, v)` — holds `last_rebuild`; absence ⇒ queries use raw-aggregation fallback.

### Small state tables
- `plan(k PK, v)` — selected pricing plan.
- `settings(k PK, v)` — UI/runtime settings (e.g. claude dir override).
- `dismissed_tips(tip_key PK, dismissed_at REAL)`.
- `provider_plan_selections(provider PK, plan_id, updated_at)` — selected plan per provider.
  `plan_id` is provider-qualified, for example `claude:max-5x`. The legacy `plan` row maps only to
  Claude for backward compatibility.
- `session_context_latest(provider, session_id, captured_at, source, model,
  context_window_size, used_tokens, used_pct, remaining_pct, current_usage_json,
  components_json; PK(provider,session_id))` — latest sanitized context snapshot or estimate.
- `provider_plan_usage_latest(provider, account_scope, window_key, captured_at, source, used_pct,
  resets_at, used_amount, limit_amount, unit, details_json; PK(provider,account_scope,window_key))`
  — latest sanitized provider usage windows.

## Invariants

### INV-1 — Snapshot dedup keys on `(session_id, message_id)`
Claude Code writes several JSONL lines per assistant response; each carries a distinct top-level
`uuid` but the same `message.id`, and each repeats the **final** usage totals. Therefore:
- Keep exactly one row per `(session_id, message_id)` — the **latest** snapshot (the keeper).
- Never sum usage across siblings.
- Distinct `tool_use` blocks (parallel tool calls) are spread across siblings; when a sibling is
  superseded, **re-point** its `tool_calls` onto the keeper rather than deleting them.
- Dedup runs in two layers: within a parse batch, and across batches against already-stored rows
  (so re-scans are idempotent). Chunk any `IN (…)` lists to stay under SQLite's variable limit.

### INV-2 — High-water mark sits behind partial lines
`files.bytes_read` records the byte offset just past the last line that ended in `\n`. A partial
trailing line is re-read next pass once complete. Skipping a file whose size equals `bytes_read`
must be safe and cheap.

### INV-3 — Turns
A "turn" is a `type='user'` message with non-null `prompt_text`. Messages sharing a `prompt_id`
collapse to the earliest for prompt-level attribution.

### INV-4 — Expensive-prompt attribution by session + time window
A prompt's cost is the billable tokens of the main-thread assistant work that follows it, bounded
by the next user prompt in the same session — attributed by **session + timestamp window**, not by
`parent_uuid` (which is unreliable once attachment records are interleaved). Subagent (sidechain)
spend is excluded here and reported under Subagents.

### INV-5 — Cost
`cost = Σ tokens_component × rate_component / 1_000_000`. Billable = input + output +
cache_create_5m + cache_create_1h. Unknown model ⇒ tier-fallback rate, `estimated = true`. No tier
match ⇒ `cost = null`.

### INV-6 — Project slug & workspace classification are opaque
The project slug is the encoded transcript directory name (drive letters, colons, and separators
become hyphens). Reproduce the encoding exactly; do not normalize via path APIs. Workspace
classification of a file target is a longest-prefix match against the index of observed
`(cwd, project_slug)` pairs.

### INV-7 — Context and plan usage provenance
Provider context-window and plan-usage records MUST be latest-only and MUST carry provenance.
Official provider payloads are stored only as sanitized fields, not raw payloads. Values inferred
from local messages, model catalogs, or cache files MUST be labeled `estimated`, `computed`, or
`unavailable` rather than `reported`.
