# Research — harness-dashboard v0.1

Phase-0 decision record. Each section states a single decision, the rationale, and the
alternatives considered. These decisions are constrained by the constitution
(`.specify/memory/constitution.md`) — chiefly local-first/offline, single-binary distribution,
the Rust↔TypeScript boundary, and cross-platform support — and they are the basis for the
implementation plan (`plan.md`).

---

## D-001 — Single Rust binary serving an embedded static export

**Decision.** The shipped artifact is one Rust executable. In release builds it embeds the
prebuilt web UI and serves both the `/api/*` surface and the UI from a single local port. There is
no Node.js runtime, no system SQLite, and no second process at runtime.

**Rationale.** Principle III (Single-Binary Distribution) makes one self-contained executable the
contract with the user: `./harness-dashboard` and nothing else. A single process also keeps the
local-first promise auditable — there is one thing to inspect for network behavior, and the UI and
API are same-origin, so no CORS surface ships. It maps cleanly onto the Rust↔TypeScript boundary
(Principle II): the binary owns all scanning, parsing, cost, and persistence; the embedded web app
is pure presentation talking to `/api/*`.

**Alternatives considered.**
- *Ship the Node server alongside the binary.* Adds a runtime dependency and a second process —
  rejected by the Single-Binary Gate.
- *Tauri / webview shell.* Introduces a platform GUI dependency and a heavier toolchain for what is
  a localhost web app; contradicts Simplicity (Principle VII).
- *Two artifacts (API binary + static site served separately).* Pushes deployment complexity onto
  the user and breaks the one-command promise.

---

## D-002 — Next.js `output: 'export'`, client-rendered, with `?id=` for session detail

**Decision.** The web app is Next.js (App Router) configured with `output: 'export'`, fully
client-rendered (`"use client"`), so `next build` emits a static `apps/web/out/` tree the Rust
binary can embed. Every page fetches `/api/*` on mount. The one dynamic view — session detail — is
**not** a dynamic route segment; it is a static client page that reads a `?id=<uuid>` query
parameter and calls `/api/sessions/:id`.

**Rationale.** A static export has no Node server at runtime, which is what lets a single Rust
binary serve it (D-001). Client rendering keeps all data-fetching on the documented HTTP surface
and keeps business logic out of the web app (Principle II). The session-detail problem is specific:
`output: 'export'` requires every dynamic route to enumerate its params at build time via
`generateStaticParams`, but session ids are unknown until a user has transcripts on their own
machine. Encoding the id in a query string (`/sessions?id=…`) sidesteps static enumeration entirely
while keeping a stable, deep-linkable URL (FR-031).

**Alternatives considered.**
- *Dynamic route `sessions/[id]`.* Cannot be statically exported without enumerating ids, which do
  not exist at build time — rejected.
- *Server-side rendering / server actions.* Requires a Node runtime at request time; incompatible
  with the single-binary model.
- *Hash routing (`#id=…`).* Works, but a query parameter is the more conventional deep link and is
  trivially readable from `useSearchParams`/`location.search` in a client component.

---

## D-003 — `rust-embed` for static assets (over `tower-http` ServeDir and `include_dir`)

**Decision.** Embed `apps/web/out/` into the binary with **`rust-embed`** (compression feature
enabled), behind a `release-embed` cargo feature. In debug builds, `rust-embed`'s debug mode reads
the assets from disk so the frontend can change without recompiling Rust. A `build.rs` guard fails
the release build if `apps/web/out/index.html` is missing. The static handler resolves an exact
asset, then falls back to `index.html`, then returns a JSON 404 for unknown `/api/*` paths.

**Rationale.** Embedding is what makes the export part of the single binary (Principle III); a
filesystem-served directory (`ServeDir`) would require shipping the `out/` tree next to the
executable, which breaks the one-file contract. `rust-embed` gives compile-time embedding plus
optional compression to keep the binary small (a real risk once a JS bundle is inlined), and its
debug-from-disk mode preserves fast frontend iteration. `include_dir` embeds bytes too but offers
no built-in compression or HTTP/debug ergonomics, so it would mean re-implementing what
`rust-embed` provides.

**Alternatives considered.**
- *`tower-http` `ServeDir`.* Serves from disk — convenient in dev, but the assets are no longer
  part of the binary, defeating single-binary distribution.
- *`include_dir`.* Embeds at compile time but without compression or HTTP niceties; more glue to
  reach parity with `rust-embed`.
- *Manual `include_bytes!` per file.* Unmaintainable for a multi-file export.

---

## D-004 — `rusqlite` with the `bundled` feature (over `sqlx`)

**Decision.** Persistence is `rusqlite` with the **`bundled`** feature (SQLite compiled into the
binary), in WAL mode, with an `r2d2_sqlite` reader pool and a single guarded writer for the scanner.
The query layer is hand-written analytic SQL.

**Rationale.** `bundled` compiles SQLite into the executable — no system library, no install step,
identical behavior on Windows/macOS/Linux — which is exactly what Principle III and Principle VIII
require. The port is built on hand-written analytic SQL (CTEs, window functions, `GROUP_CONCAT`,
chunked `IN (…)` lists for dedup) that maps one-to-one onto `rusqlite`'s synchronous API.
`harness-core` is deliberately pure and synchronous (no async runtime) so it is fully covered by
plain `cargo test` (Principle V); `sqlx` would pull in async and, in its compile-time-checked mode,
a developer database — both contrary to Simplicity (Principle VII) and to keeping the core
test-only-against-fixtures.

**Alternatives considered.**
- *`sqlx`.* Async by default and oriented toward compile-time-checked queries against a live dev
  database; adds a runtime and a build-time dependency the core does not need.
- *`rusqlite` against a system SQLite (no `bundled`).* Reintroduces a system-library requirement —
  rejected by the Single-Binary Gate.
- *A non-SQL store.* Loses the analytic SQL that the parity port is expressed in, and adds a second
  storage model against Principle VII.

---

## D-005 — recharts for charts (drop ECharts)

**Decision.** Charts are rendered with **recharts**, which is already in the chosen frontend stack.
ECharts is **not** used.

**Rationale.** The embedded export ships inside the binary, so every frontend dependency adds to
binary size (a named Phase-0 risk). recharts is already present via the dashboard base and covers
the chart types the v0.1 views need (daily trend, by-model split, per-project/per-tool bars). Adding
ECharts as a second charting library would inflate the bundle for no behavioral gain and violate
Simplicity (Principle VII). Behavioral parity (Principle IV) is about *what* is computed, not which
charting library draws it, so the original tool's choice of ECharts is not binding.

**Alternatives considered.**
- *ECharts (as in the reference tool).* Heavier, redundant with recharts, grows the embedded
  bundle — dropped.
- *Both libraries.* Two charting stacks for one app — rejected on Simplicity grounds.

---

## D-006 — `NEXT_PUBLIC_API_BASE` build-time inlining and the empty-at-release mitigation

**Decision.** The web app reads its API origin from `NEXT_PUBLIC_API_BASE`. In **dev** it is set to
the Rust server's origin (e.g. `http://127.0.0.1:8080`) in `apps/web/.env.local`, and the server
attaches a permissive CORS layer for `localhost:3000` **only** under `--dev`. In **release**, the
web is built with `NEXT_PUBLIC_API_BASE` **empty**, so all calls are same-origin and no CORS layer
is attached. CI asserts the exported `out/` contains no hardcoded `127.0.0.1:8080`.

**Rationale.** `NEXT_PUBLIC_*` variables are inlined into the JavaScript at build time, not read at
runtime. If a release build were produced with the dev value set, the shipped binary would point the
UI at a developer's machine — a correctness bug and, worse, a latent egress path that offends the
Offline Gate (Principle I). Building release with the variable empty makes every fetch relative
(`/api/*`), which is correct for the same-origin single binary (D-001) and removes the CORS surface.
The CI grep on `out/` is a cheap, durable guard against the value leaking back in.

**Alternatives considered.**
- *Read the API base at runtime from a config endpoint or global.* More moving parts than an empty
  same-origin default; the same-origin case needs no configuration at all.
- *Hardcode `/api` in the client and drop the env var.* Loses the dev split that lets `next dev`
  on `:3000` talk to the Rust server on `:8080`. Keeping the var (empty in release, set in dev) is
  the smaller change.

---

## D-007 — Cross-platform path and slug handling

**Decision.** Resolve the home directory and `~/.claude` through a portable API (the `dirs` crate).
Treat Claude Code's on-disk project slug — the encoded transcript directory name, in which drive
letters, colons, and path separators are replaced with hyphens — as **opaque**: reproduce its exact
encoding and decoding rather than normalizing it through path APIs. Workspace classification of a
file target is a longest-prefix match against the index of observed `(cwd, project_slug)` pairs. CI
runs the path and slug logic on Windows, macOS, and Linux.

**Rationale.** Principle VIII makes all three operating systems first-class. The slug is not a path
the tool controls — it is an identifier Claude Code already wrote to disk, and on Windows it encodes
drive colons and backslashes. Round-tripping it through `Path` normalization would corrupt it and
break the join back to the real `cwd`, so INV-6 (data model) requires reproducing the encoding
byte-for-byte. Using `dirs` for the home directory avoids hand-rolled `$HOME`/`%USERPROFILE%`
branching. Running the logic in CI on all three OSes is the only way to keep the parity honest, per
the cross-platform gate.

**Alternatives considered.**
- *Normalize slugs with `std::path` / `dunce` / canonicalization.* Mutates an identifier that must
  match what is already on disk — rejected by INV-6.
- *Hand-rolled home-directory resolution.* Per-OS string handling that `dirs` already solves
  correctly; against Simplicity (Principle VII).
