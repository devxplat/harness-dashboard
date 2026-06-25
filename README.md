# harness-dashboard

[![CI](https://github.com/devxplat/harness-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/devxplat/harness-dashboard/actions/workflows/ci.yml)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue.svg)](./LICENSE)

**Unlock 100x AI coding leverage with local-first analytics for usage, costs, productivity, and
engineering impact.**

**harness-dashboard** is a local command center for understanding and improving how you work with
AI coding agents. It turns local agent transcripts, editor databases, git history, pull requests,
incidents, and calendar context into actionable visibility: what you ask, what it costs, where AI
accelerates delivery, and which habits unlock more leverage over time.

It is built for developers and teams who want to become better AI-native engineers without sending
their work history to another service. Your source files, transcripts, SQLite database, and derived
metrics stay on your machine. The only runtime network calls are opt-in integrations you explicitly
configure, such as GitHub and Google Calendar.

> Status: active development, pre-1.0. The repo is already a working Rust + Next.js application,
> but public packaging, docs, and provider coverage are still evolving.

## Vision

AI coding is no longer just a faster autocomplete. It is a new engineering system: prompts,
context, agents, tools, reviews, meetings, pull requests, deployments, and feedback loops all shape
the outcome. harness-dashboard exists to make that system observable.

The goal is simple: help developers see their own AI patterns, improve them deliberately, and turn
AI usage into compounding engineering leverage. Track usage and cost, connect it to productivity and
delivery signals, then use those insights to build a better personal or team AI operating model.

## Feature Overview

### Usage And Cost

- Overview KPIs for sessions, turns, input/output/cache tokens, estimated cost, daily activity,
  provider splits, model splits, recent sessions, and project usage.
- Prompts table with server-side pagination, expensive-prompt attribution, recent sorting, and
  provider filters.
- Sessions drill-down with per-message usage, model, provider, tool calls, sidechain/subagent
  markers, and stable deep links.
- Projects, tools, skills, subagents, and workspaces views for understanding where agent work
  happens and which tools return the most context.

### Productivity, Impact, And DevEx

- Productivity view combining local git activity, assistant activity, pull requests, deployments,
  meetings, focus blocks, and post-meeting warm-up estimates.
- AI Impact view for adoption, ROI-style cost per commit/line, and correlation between AI usage
  and delivery signals.
- DORA view with deployment frequency, lead time, change failure rate, MTTR, bands, trends, PR
  cycle-time distribution, and incident context.
- Allocation, Team, and DevEx views for work mix, author-level delivery signals, and lightweight
  sentiment/pulse tracking.

### Providers And Integrations

- Local AI coding providers: Claude Code, Codex, Gemini CLI, Cursor, Antigravity, GitHub Copilot,
  and opencode.
- Local git scanning for commits, repositories, deployments from tags, co-authors, AI-assisted
  commit heuristics, and workspace correlation.
- Optional GitHub enrichment for PRs, releases, workflow deployments, incidents, repo selection,
  backfill windows, rate-budget display, and auto-sync.
- Optional Google Calendar integration for meeting overlap, focus/warm-up analysis, and calendar
  heatmaps.
- Feature-detected RTK view when an external `rtk` binary is available.

### Product Experience

- Single local dashboard shell with grouped navigation, global date ranges, custom date ranges,
  provider filters where relevant, live/pause controls, and manual refresh.
- Onboarding flow for initial source setup and backfill.
- Settings for profile display name, language, theme, default date range, pricing plan, providers,
  source paths, and integrations.
- Internationalized UI in English, Portuguese, Spanish, German, Dutch, Chinese, and Japanese.

## Local And Privacy First

harness-dashboard is designed around local ownership of developer telemetry:

- No account, hosted backend, telemetry, analytics beacon, or remote logging.
- SQLite is local and bundled through Rust; no external database service is required.
- Provider files and editor databases are read from disk and remain the source of truth.
- The frontend never touches the filesystem or database directly; it only calls local `/api/*`.
- GitHub and Google Calendar are opt-in. Their tokens are stored encrypted at rest and used only
  for the configured enrichment workflows.
- Tests and normal dashboard usage do not require network access, except for explicit integration
  syncs and developer-time package/component installation.

## Architecture

The repo is a polyglot monorepo with a hard backend/frontend boundary.

| Layer                   | Role                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crates/harness-core`   | Pure Rust library for provider parsing, incremental scans, deduplication, SQLite schema/migrations, read queries, pricing, git data, DORA, incidents, surveys, skills, tips, and secrets. |
| `crates/harness-server` | Thin axum server over the core: CLI, `AppState`, local API, SSE stream, background scans, GitHub/Google integration orchestration, and static frontend serving.                           |
| `apps/web`              | Next.js App Router dashboard, client-rendered and exported as static assets. It talks only to `/api/*` and `/api/stream`.                                                                 |
| SQLite                  | Local derived store. The original provider files and local repositories remain the source of truth.                                                                                       |

In development, the Rust API runs on `:8080` and the Next.js UI runs on `:3000`. In release, the
web app is exported to static files, embedded into the Rust binary, and served with the API and SSE
stream from one local port.

The scanner is incremental: it tracks file mtimes, byte offsets, and per-source fingerprints so it
can read new bytes/items without replaying everything. For streaming snapshot providers, the
load-bearing invariant is that repeated assistant snapshots are deduplicated on
`(session_id, message_id)` and tool calls from superseded siblings are preserved on the keeper.

## Data Sources

| Source          | Default path / setup                               | Env override                                 | Notes                                                                    |
| --------------- | -------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| Claude Code     | `~/.claude/projects`                               | `CLAUDE_PROJECTS_DIR`                        | Exact usage tokens, estimated API cost, tools, prompts, snapshot dedup.  |
| Codex           | `~/.codex/sessions`                                | `CODEX_SESSIONS_DIR`                         | Exact usage tokens, estimated API cost, tools, prompts.                  |
| Gemini CLI      | `~/.gemini/tmp`                                    | `GEMINI_CHATS_DIR`                           | Exact usage tokens, estimated API cost, tools, prompts.                  |
| Cursor          | Cursor `state.vscdb` under user global storage     | `CURSOR_STATE_DB`                            | Provider-reported usage and cost where present.                          |
| Antigravity     | `~/.gemini/antigravity/brain`                      | `ANTIGRAVITY_TRANSCRIPTS_DIR`                | Tool/activity visibility; token and cost fields may be unavailable.      |
| GitHub Copilot  | Copilot Chat OTel DB and/or `~/.copilot` CLI state | `COPILOT_OTEL_DB`, `COPILOT_HOME`            | Provider-reported usage where available; cost may be unavailable.        |
| opencode        | `~/.local/share/opencode`; optional JSONL run logs | `OPENCODE_DATA_DIR`, `OPENCODE_RUN_LOGS_DIR` | Provider-reported usage/cost where available.                            |
| Local Git       | Repositories discovered from observed workspaces   | n/a                                          | Commits, authors, co-authors, tags/deployments, AI-assisted heuristics.  |
| GitHub          | Connect with a token in Settings                   | n/a                                          | Opt-in PR, release, workflow, incident, repo, and rate-limit enrichment. |
| Google Calendar | OAuth loopback flow in Settings                    | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`   | Opt-in primary-calendar event timing for meeting/focus analysis.         |

Provider paths can also be edited from Settings. Cost figures are estimates unless the provider
reports a cost directly.

## Quick Start

Prerequisites:

- Rust stable. The workspace pins Rust 1.85 in `Cargo.toml`.
- Node.js >= 24.
- pnpm >= 10. The repo pins `pnpm@10.33.2`.
- A C toolchain for crates that compile bundled native dependencies.

Install dependencies:

```bash
pnpm install
```

Run the dashboard in development:

```bash
pnpm dev
```

Then open <http://127.0.0.1:3000>. The Rust API listens on <http://127.0.0.1:8080>.

For LAN development:

```bash
pnpm dev:lan
```

Run only the API:

```bash
pnpm dev:api
```

## Build The Single Binary

```bash
pnpm build
```

This runs the Next.js static export first, then builds the Rust server with the embedded frontend.
Run the packaged dashboard:

```bash
./target/release/harness-dashboard
```

On Windows:

```powershell
.\target\release\harness-dashboard.exe
```

The packaged app serves UI, API, and SSE from <http://127.0.0.1:8080> by default and does not
require Node.js at runtime.

## Configuration

Core runtime configuration:

| Variable                      | Default                                     | Purpose                                                      |
| ----------------------------- | ------------------------------------------- | ------------------------------------------------------------ |
| `PORT`                        | `8080`                                      | Server port.                                                 |
| `HOST`                        | `127.0.0.1`                                 | Bind address.                                                |
| `HARNESS_DB`                  | `~/.claude/harness-dashboard.db`            | SQLite database path.                                        |
| `TOKEN_DASHBOARD_DB`          | unset                                       | Legacy alias for `HARNESS_DB`.                               |
| `CLAUDE_DIR`                  | `~/.claude`                                 | Claude root used for legacy defaults and secret-key storage. |
| `CLAUDE_PROJECTS_DIR`         | `~/.claude/projects`                        | Claude Code projects JSONL root.                             |
| `CODEX_SESSIONS_DIR`          | `~/.codex/sessions`                         | Codex sessions root.                                         |
| `GEMINI_CHATS_DIR`            | `~/.gemini/tmp`                             | Gemini CLI chats root.                                       |
| `CURSOR_STATE_DB`             | platform Cursor user storage                | Cursor state database.                                       |
| `ANTIGRAVITY_TRANSCRIPTS_DIR` | `~/.gemini/antigravity/brain`               | Antigravity transcripts root.                                |
| `COPILOT_OTEL_DB`             | auto-detected VS Code/Cursor global storage | Copilot Chat OTel database.                                  |
| `COPILOT_HOME`                | `~/.copilot`                                | Copilot CLI state root.                                      |
| `OPENCODE_DATA_DIR`           | `~/.local/share/opencode`                   | opencode storage root.                                       |
| `OPENCODE_RUN_LOGS_DIR`       | unset                                       | Optional opencode JSONL run log directory.                   |
| `GOOGLE_CLIENT_ID`            | unset                                       | Required only for Google Calendar OAuth.                     |
| `GOOGLE_CLIENT_SECRET`        | unset                                       | Required only for Google Calendar OAuth.                     |

Development-only configuration:

| Variable               | Purpose                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_BASE` | API origin used by `next dev`; leave empty for release builds.                     |
| `SHADCNBLOCKS_API_KEY` | Component-registry key used only when installing/updating shadcnblocks components. |

CLI flags mirror the core server settings and keep the public interface stable:

```bash
harness-dashboard --port 8080 --host 127.0.0.1 --db ./harness.db --projects-dir ~/.claude/projects --no-open
```

Additional flags:

- `--dev`: enable local dev CORS and avoid opening a browser.
- `--no-scan`: skip the initial scan.

Pricing lives in [`pricing.json`](./pricing.json). Settings can persist a selected plan so the UI
can show API-equivalent cost next to subscription context.

## Verification

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm exec eslint .
pnpm --filter @harness/web typecheck
pnpm --filter @harness/web test:coverage
pnpm --filter @harness/web build
pnpm --filter @harness/web e2e
```

For a fast local sanity check after starting the API:

```bash
curl http://127.0.0.1:8080/api/overview
curl http://127.0.0.1:8080/api/settings
```

## Contributing

- Keep runtime behavior local-first. New network access must be explicit, user-initiated, and
  clearly documented.
- Keep business logic in Rust. The web app should stay presentation-focused and use local `/api/*`
  endpoints.
- Use SQLite parameter binding for user-derived values.
- Preserve streaming-snapshot dedup semantics for providers that emit repeated snapshots.
- Add focused tests for scanner, aggregation, pricing, DORA, integrations, and user-facing UI
  behavior when changing those areas.
- Follow Conventional Commits and keep changes scoped.

See [`AGENTS.md`](./AGENTS.md), [`docs/architecture.md`](./docs/architecture.md),
[`docs/data-source.md`](./docs/data-source.md), and
[`.specify/memory/constitution.md`](./.specify/memory/constitution.md) for deeper project rules.

## License

[AGPL-3.0-or-later](./LICENSE). harness-dashboard is free and open source. If you run a modified
version as a network service, the AGPL requires you to offer users the corresponding source.

A separate commercial license for teams and enterprises may be offered later. Until then, all use
is under the AGPL.
