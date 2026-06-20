# CLAUDE.md

Guidance for Claude Code and other agents working in this repository.

## Project overview

**harness-dashboard** — a local-first dashboard for Claude Code token usage, costs, and session
history. Rust backend (scanning/parsing/cost/storage), Next.js frontend, shipped as a single
binary. A clean-room reimplementation: reproduce behavior, don't port code line-for-line.

## Architecture

- Polyglot monorepo: Cargo workspace under `crates/`, pnpm/turbo workspace under `apps/`.
- `crates/harness-core` — pure, synchronous library: JSONL parsing, incremental scan + snapshot
  dedup, SQLite schema/migrations/summaries, read queries, pricing/cost, paths, skills, tips.
  No HTTP, no async runtime — so it's fully covered by `cargo test`.
- `crates/harness-server` — axum router, `AppState`, SSE `/api/stream`, background scan loop,
  `clap` CLI, and (in release) the embedded static frontend. Thin glue over `harness-core`.
- `apps/web` — Next.js App Router, **client-rendered** (`output: 'export'`), shadcn/ui + Tailwind
  v4. Fetches `/api/*` from the Rust server. No Clerk, no Prisma, no server actions.

## Data source

Claude Code writes one JSONL file per session to `~/.claude/projects/<slug>/<session>.jsonl`.
Usage fields live at `message.usage`; the model id at `message.model`. The scanner is incremental
(tracks each file's mtime + byte offset in a `files` table) and only reads new bytes per scan.

## Conventions

- **Fully local.** No telemetry, no remote calls for user data. Tests run offline.
- **Backend in Rust.** All scanning, parsing, importing, cost, and persistence is Rust. The
  frontend never touches the filesystem or the database directly — only the `/api/*` surface.
- **SQLite parameter binding always.** User-reachable values go through bound parameters, never
  string interpolation.
- **Streaming-snapshot dedup.** The dedup key is `(session_id, message_id)`, not the per-line
  `uuid`. Claude Code writes multiple snapshot lines per assistant response sharing one
  `message.id`; usage totals are repeated (never summed) and parallel `tool_use` blocks are
  spread across siblings — re-point tool calls onto the keeper, don't drop them. Getting this
  wrong silently inflates every token and cost number.
- **Behavioral parity is the correctness bar.** When in doubt about a query or computation,
  match the documented v0.1 spec; cover the tricky bits (dedup, expensive-prompt attribution,
  cost tiers) with fixture tests.
- **Small modules, one concern each.**

## Speckit

The repo is speckit-first. The constitution (`.specify/memory/constitution.md`) is authoritative
over this file. Feature work lives under `specs/<NNN>-<slug>/`.

## Verifying changes

```bash
cargo test                              # Rust unit + fixture tests
cargo fmt --check && cargo clippy       # format + lint
pnpm dev                                # API on :8080, UI on :3000
curl http://127.0.0.1:8080/api/overview # sanity-check an endpoint
```
