# AGENTS.md

Guidance for Codex and other agents working in this repository.

## Project overview

**harness-dashboard** is a local-first dashboard for AI coding usage, cost, productivity, DORA,
DevEx, and team analytics. It reads local provider artifacts and repositories, stores derived rows
in SQLite, serves a Rust API, and ships a client-rendered Next.js UI as a single binary.

## Development workflow
  
  - Work directly in this repository with local inspection, planning, edits, and tests.
  - Keep project context, implementation decisions, and verification evidence grounded in the local
    repository state.
  
## Architecture

- Polyglot monorepo: Cargo workspace under `crates/`, pnpm/turbo workspace under `apps/`.
- `crates/harness-core` is the pure Rust library for provider parsing, incremental scans,
  streaming-snapshot dedup, SQLite schema/migrations/summaries, read queries, pricing/cost, local
  git, DORA/impact/productivity metrics, paths, secrets, skills, and tips.
- `crates/harness-server` is thin axum glue over the core: CLI, `AppState`, `/api/*`, SSE
  `/api/stream`, scan loops, GitHub/Google integration orchestration, and embedded static frontend
  serving in release.
- `apps/web` is a client-rendered Next.js App Router dashboard (`output: 'export'`) using shadcn/ui
  and Tailwind v4. It fetches only from the Rust `/api/*` surface.

## Data sources

Supported AI coding providers are Claude Code, Codex, Gemini CLI, Cursor, Antigravity, GitHub
Copilot, and opencode. Local git is scanned for commits, repos, tags/deployments, and authors.
GitHub and Google Calendar are opt-in integrations and are the only intended runtime network data
sources.

Provider artifacts, editor databases, repositories, and integration APIs are the source of truth.
SQLite stores derived data and settings.

## Conventions

- **Local-first.** No telemetry, remote logging, hosted backend, or data egress. Runtime network
  access must be explicit and user-configured.
- **Backend in Rust.** Scanning, parsing, importing, cost, persistence, and shared business logic
  belong in Rust. The frontend never touches the filesystem or database directly.
- **SQLite parameter binding always.** User-reachable values go through bound parameters, never
  SQL string interpolation.
- **Streaming-snapshot dedup.** For providers that emit repeated assistant snapshots, dedup on
  `(session_id, message_id)`, never the per-line `uuid`. Do not sum repeated usage totals. Preserve
  tool calls from superseded siblings by re-pointing them onto the keeper.
- **Behavioral parity is the correctness bar.** Match documented behavior and cover tricky cases
  with fixture tests.
- **Small modules, one concern each.**

## Speckit

The repo is speckit-first. The constitution (`.specify/memory/constitution.md`) is authoritative
over this file. Feature work lives under `specs/<NNN>-<slug>/`.

## Verifying changes

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm exec eslint .
pnpm --filter @harness/web typecheck
pnpm --filter @harness/web test:coverage
pnpm --filter @harness/web build
```
