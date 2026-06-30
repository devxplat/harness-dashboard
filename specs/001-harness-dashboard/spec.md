# Feature Specification: harness-dashboard v0.1 — Claude Code support

**Feature branch:** `001-harness-dashboard`
**Status:** Draft
**Created:** 2026-06-20

## Summary

A local-first dashboard that scans the Claude Code JSONL transcripts under `~/.claude/projects/`
and presents token usage, cost, and session analytics. v0.1 supports **Claude Code** as the sole
data source and ships the full analytical surface: Overview, Prompts, Sessions (list + detail),
Projects, Tools, Skills, Subagents, Workspaces, Tips, and Settings, plus an optional RTK view that
appears only when an external `rtk` binary is present.

The backend (Rust) scans incrementally, deduplicates streaming snapshots, stores rows in SQLite,
materializes summary tables, and serves a JSON `/api/*` surface plus an SSE stream. The frontend
(Next.js, client-rendered) renders the views and live-refreshes on scan events.

## Clarifications

- **Data source (v0.1):** Claude Code only. The architecture leaves room for other harnesses
  later, but no other source is in scope now.
- **Deployment:** single Rust binary; the server embeds the built UI and serves API + UI on one
  port. Dev mode runs the Next.js dev server separately.
- **Cost basis:** per-model rates from `pricing.json`, with a tier fallback for unknown models and
  an optional subscription-plan overlay (Pro/Max/Team/…).
- **No multi-user, no auth, no remote storage.** One machine, one user, local files.

## User Scenarios & Testing

### User Story 1 — See where my tokens and money go (Priority: P1)
A Claude Code user opens the dashboard and immediately sees totals for a chosen time range
(sessions, turns, input/output/cache tokens, estimated cost), a daily trend, a per-model split,
their top projects, and their most-used tools.

**Independent test:** point the scanner at a transcript directory, open Overview, confirm the KPI
cards and charts populate and the numbers reconcile with the raw transcripts for the range.

**Acceptance scenarios:**
1. **Given** a populated transcript directory, **when** I open Overview with range "30d", **then**
   I see KPI cards (sessions, turns, input, output, cache read, cache create, estimated cost) and
   the daily, by-model, by-project, and by-tool charts for the last 30 days.
2. **Given** a chosen subscription plan, **when** I view any cost figure, **then** it shows the
   API-equivalent cost and, when a plan is selected, the flat monthly plan context.

### User Story 2 — Find my expensive prompts (Priority: P1)
A user wants to know which individual prompts cost the most so they can change how they work.

**Independent test:** open Prompts, sort by cost, confirm the top prompts show attributed billable
tokens and estimated cost and that totals exclude subagent spend (tracked separately).

**Acceptance scenarios:**
1. **Given** transcripts with varied prompt costs, **when** I open Prompts sorted by tokens,
   **then** I see one row per user prompt with attributed billable tokens, estimated cost, project,
   timestamp, and a prompt snippet.
2. **When** I switch the sort to "recent", **then** the same rows reorder by time.

### User Story 3 — Inspect a session in detail (Priority: P1)
A user drills from a session list into a single session to read the message thread and per-message
token/tool detail.

**Independent test:** open Sessions, filter/sort the list, click a row, confirm the detail view
shows the ordered message thread with token counts, models, tool calls, and sidechain markers.

**Acceptance scenarios:**
1. **Given** the session list, **when** I filter by project and set a minimum cost, **then** the
   list and the totals row reflect the filter.
2. **When** I open a session, **then** I see its messages in timestamp order with per-message
   model, tokens, tool calls, and a subagent indicator where applicable, reachable by a stable URL.
3. **When** I open a session with available context metadata, **then** I see context-window usage,
   component provenance, and plan-usage windows without confusing estimated values for official
   provider data.

### User Story 4 — Compare projects and tools (Priority: P2)
A user compares spend across projects and sees which tools consume the most result tokens.

**Acceptance scenarios:**
1. **When** I open Projects, **then** I see a per-project table (sessions, turns, input, output,
   billable, cache read) sorted by billable tokens.
2. **When** I open Tools, **then** I see per-tool call counts and result-token totals.

### User Story 5 — Understand skills, subagents, and workspaces (Priority: P2)
A user sees how slash commands and Skill invocations are used, how subagents and auto-compaction
contribute to spend, and how file edits flow across workspaces.

**Acceptance scenarios:**
1. **When** I open Skills, **then** I see per-skill "you ran" (manual slash-command sessions) vs.
   "Claude invoked" (Skill tool) counts, with cost and output-token percentiles.
2. **When** I open Subagents, **then** I see spend split by kind (main / auto-compaction /
   subagent) and by entrypoint (cli / desktop / vscode / sdk-*), plus a dispatch tree.
3. **When** I open Workspaces, **then** I see a flow of file-editing tool calls between the agent's
   workspace and the edited file's workspace, and a table of cross-workspace edits.

### User Story 6 — Get actionable tips (Priority: P2)
A user sees rule-based suggestions (cache discipline, repeated targets, right-sizing, outliers,
skill budgets) with estimated savings, and can dismiss ones they don't want.

**Acceptance scenarios:**
1. **When** I open Tips, **then** I see categorized suggestions with severity and, where
   computable, estimated weekly savings.
2. **When** I dismiss a tip, **then** it stays hidden for a fixed window and then may reappear.

### User Story 7 — Configure and refresh (Priority: P1)
A user picks their pricing plan, points the tool at the right `.claude` directory, and refreshes
scans without restarting.

**Acceptance scenarios:**
1. **When** I change the pricing plan in Settings, **then** all cost figures update.
2. **When** new transcript bytes are written, **then** a refresh (manual or periodic) ingests only
   the new bytes and the UI updates live via the SSE stream.

### Edge Cases
- A transcript line is a partial write at end of file → the scanner stops at the last complete line
  and resumes from there on the next pass (no double counting).
- Multiple snapshot lines share one `message.id` → counted once (latest snapshot wins); tool calls
  from superseded siblings are preserved on the keeper.
- A message has a `null` model (e.g. an error/refusal) → its tokens still count; its cost is `null`
  (shown as "—").
- An unknown model name → cost falls back to its tier rate and is flagged "estimated".
- The `rtk` binary is absent → the RTK view is hidden/feature-detected rather than erroring.
- The transcript directory is empty or missing → the UI renders empty states, not errors.

## Requirements

### Functional Requirements — Scanning & storage
- **FR-001:** The scanner MUST discover `*.jsonl` files recursively under the configured projects
  root (default `~/.claude/projects/`).
- **FR-002:** Scanning MUST be incremental: each file's mtime and byte offset are tracked, and only
  bytes beyond the last fully-parsed line are read on a subsequent scan.
- **FR-003:** The scanner MUST deduplicate streaming snapshots keyed on `(session_id, message_id)`,
  keeping the latest snapshot and re-pointing superseded siblings' tool calls onto the keeper.
- **FR-004:** Token usage MUST be read from `message.usage` (input, output, cache read, 5m and 1h
  cache creation) and never summed across snapshot siblings.
- **FR-005:** Tool calls MUST be extracted from `tool_use` blocks with a per-tool target field
  (file path / command / url / query / pattern / subagent type / skill), and tool results' sizes
  approximated from `tool_result` content.
- **FR-006:** User-typed slash commands MUST be recognized and attributed as skill activity
  distinct from assistant-initiated Skill tool calls.
- **FR-007:** The scanner MUST maintain materialized summary tables (daily, projects, models,
  tools, sessions) and MUST fall back to raw aggregation when summaries are not yet built.
- **FR-008:** Persistence MUST use bound SQL parameters for all user-derived values.

### Functional Requirements — Cost
- **FR-010:** Cost MUST be computed per model from `pricing.json`; unknown models fall back to a
  tier rate and are flagged "estimated"; models with no tier match yield a null cost.
- **FR-011:** "Billable" tokens MUST be input + output + cache-creation (5m + 1h); cache reads are
  priced separately at the cache-read rate.
- **FR-012:** A selected subscription plan MUST be persisted and surfaced alongside API-equivalent
  cost.
- **FR-013:** Provider plan selections MUST be persisted per provider. The legacy global plan MUST
  remain compatible and map only to Claude.
- **FR-014:** Context-window and plan-usage values MUST carry provenance (`reported`,
  `estimated`, `computed`, or `unavailable`).

### Functional Requirements — API
- **FR-020:** The server MUST expose JSON endpoints covering overview totals, an overview bundle,
expensive prompts, projects, tools, recent sessions, a single session's messages, daily series,
skills, by-model, subagents/orchestration, workspaces, cross-workspace edits, tips, plan, and
settings.
- **FR-025:** The server MUST expose provider plan catalog/selection and a session bundle that
  includes messages, context-window detail, and plan-usage windows.
- **FR-021:** The server MUST expose an SSE stream that emits scan events (and keep-alives) so the
  UI can refresh live.
- **FR-022:** The server MUST support manual refresh and a periodic background scan.
- **FR-023:** Endpoints MUST accept an optional time range (`since`/`until`) where applicable and
  MUST cache responses with a short TTL, clearing the cache on scan.
- **FR-024:** An RTK endpoint MUST feature-detect the external `rtk` binary and return an
  unavailable result (not an error) when it is absent.

### Functional Requirements — Frontend
- **FR-030:** The UI MUST render all v0.1 views as client-rendered pages that fetch `/api/*`.
- **FR-031:** Session detail MUST be reachable by a stable, deep-linkable URL.
- **FR-032:** The UI MUST live-update on SSE scan events.
- **FR-033:** The RTK view MUST be hidden when the RTK endpoint reports unavailable.
- **FR-034:** The UI MUST use the shadcnblocks dashboard18 base with shadcn/ui defaults (no design
  tokens copied from any other project).
- **FR-035:** Settings MUST show provider-specific plan selection and make Claude Status Line
  snapshot capture an opt-in setup path.

### Functional Requirements — CLI & config
- **FR-040:** The binary MUST default to serving the dashboard and MUST accept flags for port,
  host, database path, projects directory, a dev mode, and a no-open mode.
- **FR-041:** The tool MUST honor environment overrides: `PORT`, `HOST`, `CLAUDE_PROJECTS_DIR`,
  `HARNESS_DB` (and accept `TOKEN_DASHBOARD_DB` as an alias).

### Key Entities
- **Message:** a parsed transcript record — identity (`uuid`, `parent_uuid`, `session_id`,
  `message_id`), context (`project_slug`, `cwd`, `model`, `timestamp`, `is_sidechain`, `agent_id`,
  `entrypoint`), usage (input/output/cache-read/cache-create-5m/cache-create-1h), and for user
  messages the prompt text and an attributed skill.
- **Tool call:** an extracted invocation — `message_uuid`, `tool_name`, `target`, optional
  `tool_use_id`, result tokens, error flag, timestamp.
- **Summary rows:** per-day, per-project, per-model, per-tool, and per-session rollups.
- **Scan-file record:** per file path, its mtime, bytes read, and last scan time.
- **Plan / settings / dismissed tips:** small key/value and state tables.

## Success Criteria
- **SC-001:** With a populated `~/.claude/projects/`, the dashboard starts and Overview renders
  KPIs and charts for the selected range.
- **SC-002:** Re-running a scan after new transcript bytes ingests only the new bytes and updates
  totals; re-scanning unchanged files changes nothing (idempotent).
- **SC-003:** A fixture transcript with multiple streaming snapshots yields the correct,
  non-inflated token totals and message count.
- **SC-004:** Cost figures match a hand calculation from `pricing.json` for a known fixture, with
  unknown models flagged estimated.
- **SC-005:** The single release binary serves the UI, the API, and the SSE stream on one port with
  no Node.js or system SQLite present.
- **SC-006:** The test suite passes on Windows, macOS, and Linux.

## Assumptions
- Claude Code's transcript layout and `message.usage`/`message.model` fields are stable for v0.1.
- `pricing.json` reflects current published rates and is user-editable.
- Provider plan catalog prices are seed data with source URLs and `source_checked_at`, not a live
  billing sync.
- A single user on a single machine; no concurrency beyond one scanner writer and many readers.

## Out of scope (v0.1)
- Data sources other than Claude Code.
- Any remote sync, sharing, export to a service, or multi-user features.
- Authentication, accounts, or cloud storage.
