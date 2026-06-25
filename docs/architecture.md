# Architecture

harness-dashboard is a local-first analytics app for AI coding work. It reads local provider
artifacts, editor databases, and git repositories; optionally enriches them with user-configured
GitHub and Google Calendar data; stores derived rows in SQLite; and serves a client-rendered
dashboard from a single Rust binary.

The hard constraints are unchanged: user data is local by default, runtime network access is opt-in
and visible, the frontend never reads the filesystem or database directly, and the release artifact
is one executable serving UI, API, and SSE.

## Backend Crates

The backend is a Cargo workspace with two crates and a strict separation of concerns.

**`crates/harness-core`** is a pure Rust library. It owns the behavioral surface:

- provider parsers and adapters for Claude Code, Codex, Gemini CLI, Cursor, Antigravity, GitHub
  Copilot, and opencode;
- incremental file/source scanning, high-water marks, fingerprints, and streaming-snapshot dedup;
- SQLite schema, migrations, summary tables, read queries, and parameter-bound persistence;
- pricing/cost estimation and provider-reported cost handling;
- local git scanning, repository discovery, commit classification, deployments from tags, and
  GitHub remote parsing;
- DORA, AI-impact, allocation, incident, survey, skills, tips, and workspace computations;
- at-rest encryption helpers for opt-in integration tokens.

It has no HTTP server and no frontend dependency. Keeping this logic in Rust means scanner,
aggregation, cost, and metric behavior can be tested directly with `cargo test`.

**`crates/harness-server`** is process and transport glue over the core:

- axum router and local `/api/*` JSON surface;
- `AppState`, pricing, scan coordination, SSE broadcast, and background loops;
- CLI flags and environment override resolution;
- filesystem watcher for fast local refresh after transcript changes;
- GitHub REST sync orchestration and Google Calendar OAuth/Calendar orchestration;
- release static-asset serving, with the web export embedded by `rust-embed`.

The server crate is the only place allowed to perform opt-in runtime network calls.

## Web App

`apps/web` is a Next.js App Router application, fully client-rendered and exported statically with
`output: 'export'`. It uses React, shadcn/ui, Tailwind v4, recharts, TanStack Table, i18next,
Radix primitives, and lucide icons.

The dashboard is organized into four navigation groups:

- **Usage:** Overview, Prompts, Sessions, Projects.
- **Tools & agents:** Tools, Skills, Subagents, Workspaces.
- **Performance:** Productivity, AI Impact, DORA, Allocation, DevEx, Team.
- **More:** Tips and Settings, with RTK inserted when the external `rtk` binary is detected.

Global shell controls handle date ranges, custom ranges, provider filters on provider-scoped
screens, live/pause behavior, language, theme, and manual refresh. The web app fetches local
`/api/*` endpoints and subscribes to `/api/stream`; it does not open local files or SQLite.

## Data Flow

```text
Local provider files / editor DBs / git repos
        |
        v
harness-core scanners and provider adapters
        |
        v
SQLite derived store  <---- optional GitHub / Google syncs
        |
        v
harness-server /api/* and /api/stream
        |
        v
client-rendered Next.js dashboard
```

1. **Discover.** Provider defaults and Settings determine which sources are enabled and which
   paths are active. Local git repositories are discovered from observed workspaces.
2. **Scan.** File-based providers track mtimes and byte offsets. Mutable source adapters use
   source-item fingerprints and replacement/pruning. Local git reads repository history
   incrementally.
3. **Normalize.** Rows are normalized into provider-tagged messages, tool calls, commits, PRs,
   deployments, incidents, calendar events, survey responses, and derived summaries.
4. **Store.** SQLite is the local derived store. Original provider files and repositories remain
   the source of truth and can be replayed.
5. **Serve.** API handlers open read connections, compute cost and metrics, and return JSON with
   `Cache-Control: no-store`.
6. **Refresh.** Scan and integration events are broadcast over SSE; the web shell refetches the
   current view when live updates are enabled.

## Provider Adapters

Provider adapters map different local artifacts into a shared provider-aware message model.

| Provider       | Source style                    | Usage/cost fidelity                                               |
| -------------- | ------------------------------- | ----------------------------------------------------------------- |
| Claude Code    | JSONL projects tree             | Exact usage tokens, estimated API cost.                           |
| Codex          | JSONL sessions tree             | Exact usage tokens, estimated API cost.                           |
| Gemini CLI     | JSONL chats                     | Exact usage tokens, estimated API cost.                           |
| Cursor         | SQLite state database           | Provider-reported usage/cost where present.                       |
| Antigravity    | Transcript files                | Tool/activity visibility; usage/cost may be unavailable.          |
| GitHub Copilot | Chat OTel DB and CLI state      | Provider-reported usage where available; cost may be unavailable. |
| opencode       | Storage and optional JSONL logs | Provider-reported usage/cost where available.                     |

The shared model records provenance with `usage_source` and `cost_source`, so the UI can avoid
pretending all providers have equal fidelity.

For streaming snapshot providers, deduplication is load-bearing. Usage totals are not summed across
snapshot siblings. The keeper is keyed by `(session_id, message_id)`, and tool calls from superseded
siblings are re-pointed onto the keeper.

## Git, GitHub, And Calendar Enrichment

Local git scanning is offline. It discovers repositories from workspaces, reads commits with
vendored `libgit2`, classifies conventional commit types, parses co-authors, maps GitHub remotes,
and treats tags as local deployment signals.

GitHub is opt-in. A user-provided token is validated, encrypted at rest, and used to fetch selected
repositories, pull requests, releases, workflow runs, and incident-labeled issues. Sync uses
backfill windows, high-water marks, ETags, rate-limit awareness, and SSE progress updates.

Google Calendar is opt-in. OAuth uses a loopback redirect and requires `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` on the server. Stored tokens are encrypted at rest. Calendar data is used
for meeting overlap, focus, warm-up, and productivity analysis.

## Single-Binary Distribution

`pnpm build` exports the web app to `apps/web/out` and builds `harness-server` with the
`release-embed` feature. The release binary embeds the static web assets, bundles SQLite, and
serves UI, API, and SSE from one local port. Node.js, a separate web server, and a system SQLite
installation are not required at runtime.

In development, `pnpm dev` runs two processes:

- Rust API on `127.0.0.1:8080`, with dev CORS enabled.
- Next.js dev server on `127.0.0.1:3000`, with hot reload.

`pnpm dev:lan` binds the API to `0.0.0.0` for LAN testing.
