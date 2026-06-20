# harness-dashboard

A **local-first** dashboard for tracking [Claude Code](https://claude.com/claude-code) token
usage, costs, and session history. It reads the JSONL transcripts Claude Code writes to
`~/.claude/projects/` and turns them into per-prompt cost analytics, tool/file heatmaps,
subagent attribution, cache analytics, project comparisons, and a rule-based tips engine.

Everything runs on your machine. No telemetry, no account, no network calls for your data.

> Status: **v0.1, in development.** This is a clean-room reimplementation — a fresh codebase
> (Rust backend, Next.js frontend) that reproduces the behavior of an earlier Python tool.

## Why

Claude Code records rich usage data per session, but it's buried in line-delimited JSON.
harness-dashboard makes it legible: where your tokens (and dollars) actually go, which prompts
are expensive, how much cache you're reusing, and how subagents and skills contribute.

## How it's built

| Layer | Tech |
| --- | --- |
| Backend / scanner / parsing / cost / storage | **Rust** (axum, rusqlite-bundled SQLite) |
| Frontend | **Next.js** (App Router, client-rendered) + **shadcn/ui** + Tailwind v4 |
| Distribution | a **single binary** — the Rust server embeds the prebuilt UI and serves API + UI on one port |

The backend scans transcripts incrementally (tracking each file's mtime and byte offset),
deduplicates streaming snapshots on `(session_id, message_id)`, and materializes summary tables
for fast queries. The frontend is a static, client-rendered dashboard that talks to the local
`/api/*` endpoints.

## Quick start

> Prerequisites: Rust (stable), Node ≥ 24, pnpm ≥ 10.

```bash
# install JS deps
pnpm install

# dev: Rust API on :8080, Next.js UI on :3000 (hot reload)
pnpm dev

# or build the single binary (UI embedded) and run it
pnpm build
./target/release/harness-dashboard         # serves UI + API on http://127.0.0.1:8080
```

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | server port |
| `HOST` | `127.0.0.1` | bind address |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | transcript root to scan |
| `HARNESS_DB` | `~/.claude/harness-dashboard.db` | SQLite database path |

Pricing lives in [`pricing.json`](./pricing.json).

## Development

This is a polyglot monorepo: a Cargo workspace (`crates/`) and a pnpm/turbo workspace (`apps/`).

- `crates/harness-core` — parsing, incremental scan + snapshot dedup, SQLite schema & queries, cost engine. Pure and synchronous, covered by `cargo test`.
- `crates/harness-server` — the axum HTTP server, SSE stream, background scan loop, and the `harness-dashboard` binary.
- `apps/web` — the Next.js dashboard.

The project is **speckit-first**: see [`.specify/memory/constitution.md`](./.specify/memory/constitution.md)
for the operating principles and [`specs/001-harness-dashboard/`](./specs/001-harness-dashboard/)
for the v0.1 specification.

## License

[AGPL-3.0-or-later](./LICENSE). harness-dashboard is free and open source; if you run a modified
version as a network service, the AGPL requires you to offer your users the corresponding source.

A separate commercial license (for teams and enterprise that prefer not to be bound by the AGPL,
e.g. as part of a hosted devex-platform offering) is planned. Until it's available, all use is
under the AGPL.
