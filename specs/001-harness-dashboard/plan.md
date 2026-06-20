# Implementation Plan — harness-dashboard v0.1

**Feature branch:** `001-harness-dashboard`
**Spec:** `specs/001-harness-dashboard/spec.md`
**Inputs:** `data-model.md`, `contracts/api.md`, `research.md`, `quickstart.md`

This plan translates the v0.1 spec into a phased build. It is governed by the constitution
(`.specify/memory/constitution.md`); the Constitution Check below maps the work to each principle
and gate.

## Technical Context

- **Backend language:** Rust (stable). Two crates in a Cargo workspace.
  - `crates/harness-core` — a pure, synchronous library: JSONL parsing, incremental scan + snapshot
    dedup, SQLite schema/migrations/summaries/queries, pricing/cost, paths (slug + workspace),
    skills, tips. No HTTP, no async runtime — fully covered by `cargo test`.
  - `crates/harness-server` — the axum HTTP server, `AppState`, SSE stream, background scan loop,
    `clap` CLI, and (in release) the embedded static frontend. Thin glue over `harness-core`. Ships
    the `harness-dashboard` binary.
- **Storage:** `rusqlite` with the `bundled` feature (SQLite compiled in), WAL mode, an
  `r2d2_sqlite` reader pool and a single guarded writer (`spawn_blocking`) for the scanner.
- **Static assets:** `rust-embed` (compression) behind a `release-embed` cargo feature; debug mode
  reads `apps/web/out/` from disk; a `build.rs` guard fails release if `apps/web/out/index.html`
  is missing.
- **Frontend:** Next.js (App Router) + React 19, client-rendered with `output: 'export'`. Tailwind
  v4, shadcn/ui "new-york" with the `@shadcnblocks` registry, dashboard18 base block and shadcn
  default tokens. Charts with recharts. Builds to a static `apps/web/out/`.
- **Workspaces:** Cargo workspace (`crates/*`) and a pnpm/turbo workspace (`apps/*`) at one root.
- **Testing:** `cargo test` (core, golden fixtures), `vitest` (web), a Playwright smoke test against
  a running server.
- **Decisions of record:** see `research.md` (D-001 … D-007).

## Repository Structure

```
harness-dashboard/
├── Cargo.toml                  # [workspace] members=["crates/*"]; shared [workspace.dependencies]
├── rust-toolchain.toml         # pin stable
├── package.json                # packageManager pnpm; turbo scripts
├── pnpm-workspace.yaml         # packages: ["apps/*"]
├── turbo.json / tsconfig.base.json / eslint.config.mjs / prettier.config.mjs
├── vitest.workspace.ts / playwright.config.ts
├── components.json             # root shadcn config (@shadcnblocks registry)
├── pricing.json                # cost table
├── apps/web/                   # the only JS package in v0.1
│   ├── next.config.ts          # output:'export', images.unoptimized, trailingSlash
│   ├── app/                    # all "use client": Overview (page), prompts/, sessions/ (+ ?id detail),
│   │   │                       #   projects/, tools/, skills/, subagents/, workspaces/, tips/, settings/, rtk/
│   │   └── globals.css         # Tailwind v4 + shadcn default tokens
│   ├── components/{shell/,charts/,ui/}
│   ├── hooks/{use-api.ts,use-stream.ts}
│   └── lib/{api-base.ts,api-client.ts,format.ts,utils.ts}
├── crates/
│   ├── harness-core/           # lib, no HTTP
│   └── harness-server/         # bin `harness-dashboard`: axum, AppState, SSE, scan loop, CLI, embed
├── .specify/{memory/constitution.md, templates/, scripts/}
├── specs/001-harness-dashboard/{spec.md, plan.md, data-model.md, contracts/api.md, research.md, quickstart.md, tasks.md}
├── docs/{architecture.md, data-source.md, KNOWN_LIMITATIONS.md}
├── .github/workflows/{ci.yml, release.yml}
└── LICENSE (AGPL-3.0-or-later) / NOTICE / README.md / CLAUDE.md / .gitignore
```

## Constitution Check

Each principle and gate, with how this plan satisfies it.

- **I. Local-First & Fully Offline.** No runtime network call and no data egress. Dev-time package
  installs and the shadcnblocks registry never ship (`SHADCNBLOCKS_API_KEY` is dev-only;
  `quickstart.md`). The release web is built with `NEXT_PUBLIC_API_BASE` empty so every call is
  same-origin (research D-006); CI greps `apps/web/out/` for any leaked host. **Offline Gate: pass.**
- **II. Rust Backend, TypeScript Client.** All scanning/parsing/cost/persistence lives in
  `harness-core`; the web app only calls `/api/*` (`contracts/api.md`) and never touches the
  filesystem or DB. **Boundary Gate: pass.**
- **III. Single-Binary Distribution.** Release embeds `apps/web/out/` via `rust-embed` and serves
  API + UI on one port; SQLite is bundled (no system lib), no second process (research D-001, D-003,
  D-004). **Single-Binary Gate: pass.**
- **IV. Behavioral Parity Is the Correctness Bar.** Phase 2 ports the dedup, expensive-prompt
  attribution, and cost tiers from the documented invariants (`data-model.md` INV-1 … INV-6), proven
  by golden fixtures — never by copying source. The `(session_id, message_id)` dedup with
  tool-call re-pointing is the load-bearing invariant. **Parity Gate: pass** (every scan/aggregation
  task ships a fixture test).
- **V. Test-First Engineering.** Scanner/dedup/cost are written test-first against fixtures
  (`tasks.md` orders the failing test before the implementation). `cargo test` covers core, `vitest`
  covers web, a Playwright smoke test covers the running dashboard.
- **VI. SQLite Safety.** All user-derived values use bound parameters (FR-008); schema changes go
  through an ordered, idempotent migration runner; a schema bump may clear and replay derived tables
  from the JSONL source of truth.
- **VII. Simplicity & YAGNI.** One storage engine (SQLite), one language boundary, recharts only
  (drop ECharts, research D-005), no speculative config. **Simplicity Gate: pass.**
- **VIII. Cross-Platform by Default.** Home/`~/.claude` via `dirs`; the project slug is reproduced
  exactly, never normalized (research D-007, INV-6). CI runs the suite on Windows, macOS, Linux.
- **IX. Documentation & Library Currency.** Phase 1 produces `specs/` and `docs/`; library work
  consults current docs (Context7). A view is not done until documented.
- **X. Conventional Git.** Feature branch `001-harness-dashboard`; Conventional Commits; linear
  history.

No deviations to justify.

## Phased Approach

### Phase 0 — Bootstrap (done)
Repo scaffold, Cargo + pnpm/turbo workspaces, shared TS/lint/format/test configs,
`components.json`, `pricing.json`, `.gitignore`, `LICENSE`/`NOTICE`/`README.md`/`CLAUDE.md`, public
remote. Establishes the structure above.

### Phase 1 — Spec & docs
The speckit-first deliverable: `.specify/memory/constitution.md` and
`specs/001-harness-dashboard/` (`spec.md`, `data-model.md`, `contracts/api.md`, `research.md`,
`quickstart.md`, `plan.md`, `tasks.md`), plus `docs/{architecture,data-source,KNOWN_LIMITATIONS}.md`.

### Phase 2 — `harness-core` (test-first)
In dependency order, each with fixture tests before trust:
1. `db`: schema, ordered/idempotent migration runner, `r2d2_sqlite` pool, WAL.
2. `jsonl` parse + incremental scan (mtime + byte-offset high-water mark, INV-2) + **both dedup
   layers** (within batch and across stored rows; keeper + tool-call re-point, INV-1) with a golden
   fixture asserting message count and token totals.
3. `summaries`: materialized `summary_*` tables, full and incremental, with the raw-aggregation
   fallback (FR-007).
4. `pricing`/cost (INV-5), `paths` (slug + workspace, INV-6), `skills`, `tips`.
5. Read queries backing every `/api/*` payload, against a seeded fixture DB.

### Phase 3 — `harness-server` API/SSE
`AppState` + `clap` CLI (flags + env: `PORT`, `HOST`, `CLAUDE_PROJECTS_DIR`, `HARNESS_DB` /
`TOKEN_DASHBOARD_DB`) → all GET/POST handlers mirroring `contracts/api.md` with the in-state,
query-keyed response cache cleared on scan → `/api/stream` SSE + background scan loop + async
`/api/refresh` → `/api/rtk` feature-detection of the external `rtk` binary (FR-024) → `--dev` CORS.

### Phase 4 — Frontend
Adapt the dashboard18 shell + shadcn "new-york" primitives → `api-base`/`use-api`/`use-stream`
(`EventSource('/api/stream')`) → build all v0.1 views as client pages with recharts; session detail
via `?id`; RTK view hidden when `/api/rtk` reports unavailable → `vitest` unit + a Playwright smoke
test against a running axum.

### Phase 5 — Embed & CI
`rust-embed` + the static handler (exact asset → `index.html` fallback → JSON 404 for unknown
`/api/*`) + the `build.rs` guard → `next build` export → `cargo build --release --features
release-embed` → CI: `ci.yml` (Rust fmt/clippy/test matrix on three OSes + web lint/typecheck/
vitest), `release.yml` (build web with empty API base, assert no leaked host in `out/`, embed,
per-OS release binaries).
