# Tasks — harness-dashboard v0.1

Granular task breakdown, grouped by the phases in `plan.md`. Each task names the crate/module or app
path it touches. Tasks marked `[P]` are parallelizable (no ordering dependency on a sibling in the
same group). Scanner, dedup, and cost tasks are ordered **test-first**: the fixture/failing test
precedes the implementation it guards (constitution Principle V; parity per `data-model.md`).

Conventions: `core` = `crates/harness-core`, `server` = `crates/harness-server`, `web` =
`apps/web`. Acceptance for scan/aggregation tasks is a passing fixture test (Parity Gate).

## Phase 0 — Bootstrap (done)

- [x] T000 Repo scaffold, Cargo + pnpm/turbo workspaces, shared configs, `pricing.json`, license, remote.

## Phase 1 — Spec & docs

- [x] T010 `.specify/memory/constitution.md` — operating principles and gates.
- [x] T011 `specs/001-harness-dashboard/spec.md` — user stories, FRs, success criteria.
- [x] T012 `specs/001-harness-dashboard/data-model.md` — schema + invariants.
- [x] T013 `specs/001-harness-dashboard/contracts/api.md` — `/api/*` contract.
- [x] T014 `specs/001-harness-dashboard/research.md` — Phase-0 decision record.
- [x] T015 `specs/001-harness-dashboard/quickstart.md` — getting started.
- [x] T016 `specs/001-harness-dashboard/plan.md` — implementation plan + Constitution Check.
- [x] T017 `specs/001-harness-dashboard/tasks.md` — this file.
- [x] T018 `.specify/templates/{spec,plan,tasks}-template.md` — reusable scaffolds.
- [x] T019 `docs/{architecture.md, data-source.md, KNOWN_LIMITATIONS.md}` — prose docs. `[P]`

## Phase 2 — `harness-core` (test-first)

### Database & migrations
- [ ] T100 `core/db`: connection open (WAL), `r2d2_sqlite` reader pool + single guarded writer.
- [ ] T101 `core/db`: ordered, idempotent migration runner; schema for `messages`, `tool_calls`,
      `files`, `summary_*`, `plan`, `settings`, `dismissed_tips` with the indexes from `data-model.md`.
- [ ] T102 `core/db`: migration-runner test — apply twice, assert idempotence and full index set.
- [ ] T103 `core/db`: SQLite-safety test — assert user-derived values bind as parameters (FR-008).

### JSONL parsing
- [ ] T110 `core/jsonl`: fixture transcripts (single + multi-snapshot + partial trailing line + null model).
- [ ] T111 `core/jsonl`: failing test — parse a record into the source field set (`data-model.md` table).
- [ ] T112 `core/jsonl`: parser for `message.usage`, `message.model`, content blocks (`tool_use`/`tool_result`).
- [ ] T113 `core/jsonl`: synthesize `Skill` rows from `<command-name>/slug</command-name>` (FR-006). `[P]`
- [ ] T114 `core/jsonl`: extract `tool_use` targets (path/command/url/query/pattern/subagent/skill) + `tool_result` sizing (FR-005). `[P]`

### Incremental scan & dedup (load-bearing)
- [ ] T120 `core/scan`: failing test — high-water mark sits behind a partial line; resume is exact, no double count (INV-2, SC-002).
- [ ] T121 `core/scan`: incremental discovery + read of new bytes only, tracked in `files` (FR-001, FR-002).
- [ ] T122 `core/scan`: **golden-fixture** test — multi-snapshot JSONL yields correct, non-inflated message count and token totals (INV-1, SC-003).
- [ ] T123 `core/scan`: dedup layer 1 (within parse batch) — keeper = latest `(session_id, message_id)`, usage never summed.
- [ ] T124 `core/scan`: dedup layer 2 (across stored rows) — re-point superseded siblings' `tool_calls` onto the keeper; chunk `IN (…)` lists under SQLite's variable limit.
- [ ] T125 `core/scan`: idempotence test — re-scanning unchanged files changes nothing (SC-002).

### Summaries
- [ ] T130 `core/summaries`: failing test — `summary_*` rollups equal raw aggregation for a fixture DB.
- [ ] T131 `core/summaries`: full rebuild of daily/projects/models/tools/sessions + `summary_meta.last_rebuild` (FR-007).
- [ ] T132 `core/summaries`: incremental update path + raw-aggregation fallback when `summary_meta` is absent.

### Cost, paths, skills, tips
- [ ] T140 `core/pricing`: failing test — cost from `pricing.json`; unknown model → tier fallback `estimated`; no tier → null (INV-5, FR-010/011, SC-004).
- [ ] T141 `core/pricing`: cost engine + billable = input + output + cache_create_5m + cache_create_1h; cache reads priced separately.
- [ ] T142 `core/paths`: slug encode/decode reproduced exactly (no normalization) + cross-OS test (INV-6, SC-006). `[P]`
- [ ] T143 `core/paths`: workspace classification by longest-prefix match over observed `(cwd, project_slug)` (INV-6). `[P]`
- [ ] T144 `core/skills`: "you ran" (manual slash-command) vs "Claude invoked" (Skill tool) split + percentiles. `[P]`
- [ ] T145 `core/tips`: rule-based tips (cache discipline, repeated targets, right-sizing, outliers, skill budgets) with estimated savings; dismissal window. `[P]`

### Read queries (one per API payload)
- [ ] T150 `core/queries`: failing tests against a seeded fixture DB for each payload below.
- [ ] T151 `core/queries`: overview totals + overview-bundle (FR-020). `[P]`
- [ ] T152 `core/queries`: expensive prompts — attribution by session + time window, subagent spend excluded (INV-3, INV-4). `[P]`
- [ ] T153 `core/queries`: projects, tools, recent sessions. `[P]`
- [ ] T154 `core/queries`: single-session messages in timestamp order. `[P]`
- [ ] T155 `core/queries`: daily series + by-model. `[P]`
- [ ] T156 `core/queries`: subagents (by kind/entrypoint, dispatch tree) + workspaces + cross-workspace edits. `[P]`
- [x] T157 `core/db/pricing`: provider plan selections, catalog extensions, latest context snapshots, and latest plan-usage windows.
- [x] T158 `core/queries`: session bundle with context-window provenance and provider plan-usage windows.

## Phase 3 — `harness-server` API/SSE

- [ ] T200 `server`: `AppState` (pool, scan handle, query-keyed response cache) + `clap` CLI (port, host, db, projects dir, `--dev`, no-open).
- [ ] T201 `server`: env overrides `PORT`, `HOST`, `CLAUDE_PROJECTS_DIR`, `HARNESS_DB` (+ `TOKEN_DASHBOARD_DB` alias) with flags taking precedence (FR-040/041).
- [ ] T202 `server`: GET handlers mirroring `contracts/api.md`; `since`/`until` parsing; `limit` clamp ≤ 1000; `Cache-Control: no-store`. `[P]`
- [ ] T203 `server`: POST handlers — `/api/plan`, `/api/settings`, `/api/tips/dismiss`, `/api/refresh`; body clamp ≤ 1 MB. `[P]`
- [x] T203a `server`: `/api/provider-plans`, `/api/sessions/:id/bundle`, and `statusline-snapshot` CLI.
- [ ] T204 `server`: response cache keyed by query string, cleared on scan (FR-023).
- [ ] T205 `server`: `/api/scan` blocking rescan + `/api/refresh` async scan via `spawn_blocking`.
- [ ] T206 `server`: `/api/stream` SSE — `scan` / `scan-skip` / `error` events + `: ping` keep-alive (FR-021).
- [ ] T207 `server`: background periodic scan loop emitting SSE scan events (FR-022).
- [ ] T208 `server`: `/api/rtk` feature-detects the external `rtk` binary; returns `available:false` (not error) when absent (FR-024). `[P]`
- [ ] T209 `server`: `--dev`-only permissive CORS layer for `localhost:3000`.

## Phase 4 — Frontend

- [ ] T300 `web`: shell adapted from dashboard18 + shadcn "new-york" primitives (default tokens, no copied design).
- [ ] T301 `web`: `lib/api-base.ts` (empty in release / `NEXT_PUBLIC_API_BASE` in dev) + `lib/api-client.ts` + `lib/format.ts`.
- [ ] T302 `web`: `hooks/use-api.ts` fetch wrapper + `hooks/use-stream.ts` `EventSource('/api/stream')` live refresh (FR-032).
- [ ] T303 `web`: Overview page — KPI cards + daily/by-model/by-project/by-tool recharts (US1, FR-030). `[P]`
- [ ] T304 `web`: Prompts page — sortable (`tokens`/`recent`) expensive-prompt table (US2). `[P]`
- [ ] T305 `web`: Sessions list — filter/sort + totals row (US3). `[P]`
- [ ] T306 `web`: Session detail — client page reading `?id=`, fetches `/api/sessions/:id`, deep-linkable (US3, FR-031).
- [x] T306a `web`: Session detail bundle — context-window header, provenance breakdown, and plan-usage bars.
- [ ] T307 `web`: Projects + Tools pages (US4). `[P]`
- [ ] T308 `web`: Skills + Subagents + Workspaces pages (US5). `[P]`
- [ ] T309 `web`: Tips page — categorized suggestions + dismiss (US6). `[P]`
- [ ] T310 `web`: Settings page — pricing plan, claude-dir override, refresh (US7). `[P]`
- [x] T310a `web`: Settings Plans & Usage section — provider-specific plan selection and Claude Status Line setup.
- [ ] T311 `web`: RTK page — hidden when `/api/rtk` reports unavailable (FR-033). `[P]`
- [ ] T312 `web`: empty-state rendering for missing/empty transcript directory (edge cases). `[P]`
- [ ] T313 `web`: `vitest` unit tests for hooks/lib + a Playwright smoke test against a running axum.

## Phase 5 — Embed & CI

- [ ] T400 `server`: `rust-embed` (compression) behind `release-embed`; debug-from-disk for `apps/web/out/`.
- [ ] T401 `server`: static handler — exact asset → `index.html` fallback → JSON 404 for unknown `/api/*` (research D-003).
- [ ] T402 `server`: `build.rs` guard fails release if `apps/web/out/index.html` is missing.
- [ ] T403 root: `next build` export wiring (`pnpm build:web` → `apps/web/out/`) + `pnpm build:server`.
- [ ] T404 `.github/workflows/ci.yml`: Rust fmt/clippy/test matrix on Linux/macOS/Windows + web lint/typecheck/vitest (SC-006). `[P]`
- [ ] T405 `.github/workflows/release.yml`: build web with empty `NEXT_PUBLIC_API_BASE`; assert `out/` has no `127.0.0.1:8080` (research D-006); embed; per-OS release binaries. `[P]`
- [ ] T406 Packaged smoke: run the single binary with no Node present; UI + API + SSE serve same-origin on one port (SC-005).
