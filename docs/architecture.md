# Architecture

harness-dashboard is a local-first tool: it reads the JSONL transcripts Claude Code writes on the
user's own machine and turns them into usage, cost, and session analytics. There is no backend
service, no account, and no network access for user data. This document describes how the parts fit
together — the two-crate Rust backend, the web app, the request/scan/SSE flow, and how a release
collapses everything into a single binary.

## The two-crate backend

The backend is a Cargo workspace with two crates and a hard separation of concerns.

**`crates/harness-core`** is a pure, synchronous library. It owns the entire behavioral surface:

- JSONL parsing of Claude Code transcript records;
- the incremental scan and streaming-snapshot dedup;
- the SQLite schema, an ordered migration runner, materialized summary tables, and all read
  queries;
- the pricing/cost engine;
- path handling (project slug encoding, workspace classification);
- the skills and tips logic.

It has no HTTP and no async runtime. That is deliberate: keeping the core pure and synchronous means
the load-bearing logic — scanning, dedup, cost, attribution — is fully exercised by plain
`cargo test` against fixtures, which is where correctness is defined (behavioral parity, proven by
tests, not by copying source).

**`crates/harness-server`** is thin glue over the core and produces the `harness-dashboard` binary.
It owns:

- the axum router and `AppState` (the connection pool, the scan handle, and an in-process,
  query-keyed response cache);
- the `/api/*` HTTP handlers that call into `harness-core`;
- the `/api/stream` Server-Sent Events stream and the background scan loop;
- the `clap` CLI (flags and environment overrides);
- in release builds, the embedded static frontend and the static-asset handler.

The boundary is a hard line: business logic lives in `harness-core`, transport and process concerns
live in `harness-server`, and presentation lives in the web app. The web app never reads the
filesystem or the database directly — only the documented `/api/*` surface.

## The web app

`apps/web` is a Next.js (App Router) dashboard, fully client-rendered. Every page is a client
component that fetches `/api/*` on mount and live-refreshes from the SSE stream. It is configured
with `output: 'export'`, so `next build` emits a static `apps/web/out/` tree with no Node server at
runtime — which is what allows the Rust binary to embed and serve it.

The views cover the full v0.1 surface: Overview, Prompts, Sessions (list and detail), Projects,
Tools, Skills, Subagents, Workspaces, Tips, and Settings, plus a feature-detected RTK view. The UI
uses shadcn/ui ("new-york") with the dashboard18 base block and shadcn default tokens; charts are
drawn with recharts. Session detail is a static client page that reads a `?id=<uuid>` query
parameter rather than a dynamic route segment, because a static export cannot enumerate session ids
at build time.

## Request, scan, and SSE flow

```
Claude Code transcripts            harness-server                 web app
(~/.claude/projects/*.jsonl)   ┌────────────────────────┐   (client-rendered)
        │                      │  scan loop / /api/refresh │        │
        │  read new bytes      │           │              │        │
        ▼                      │           ▼              │        │
   ┌──────────┐  parse+dedup   │   ┌──────────────┐       │  GET   │
   │harness-  │───────────────▶│   │   SQLite     │◀──────┼────────┤ /api/*
   │  core    │  write rows    │   │  (WAL, bundled)│ read │        │
   └──────────┘                │   └──────────────┘       │        │
        │                      │           │  scan event  │  SSE   │
        └──────────────────────┼───────────┴─────────────▶┼───────▶│ /api/stream
                               └────────────────────────┘        live refresh
```

1. **Scan.** A scan runs on startup, on a periodic background loop, and on demand via `/api/refresh`
   (async) or `/api/scan` (blocking). `harness-core` discovers `*.jsonl` files, reads only the bytes
   past each file's recorded high-water mark, parses records, deduplicates streaming snapshots, and
   writes rows. Summary tables are then (re)materialized.
2. **Store.** Rows land in a single SQLite database (WAL mode), with a reader pool and one guarded
   writer for the scanner. The JSONL transcripts on disk remain the source of truth; every table is
   derived and may be cleared and replayed.
3. **Serve.** GET handlers run read queries and annotate cost, with responses cached in-process by
   query string and the cache cleared on each scan. POST handlers update the pricing plan, settings,
   dismissed tips, or trigger a refresh.
4. **Live refresh.** `/api/stream` emits a `scan` event each time a scan completes (plus `scan-skip`,
   `error`, and a periodic keep-alive ping). The web app holds an `EventSource` and re-fetches the
   current view's data when a scan event arrives.

## Single-binary embedding

In a release build the web app is exported to `apps/web/out/` and embedded into `harness-server`
via `rust-embed` (with compression), behind a `release-embed` cargo feature. A `build.rs` guard
fails the release build if `apps/web/out/index.html` is missing. At runtime the static-asset handler
resolves an exact asset, falls back to `index.html` (so client routes resolve), and returns a JSON
404 for unknown `/api/*` paths. The result is one self-contained executable: SQLite is bundled
(compiled into the binary, no system library), the UI is embedded, and the API, UI, and SSE stream
are all served from a single local port — no Node.js and no second process.

## Dev versus packaged

The same code runs in two shapes:

- **Dev (two ports).** `harness-server --dev` serves the API on `:8080`; the Next.js dev server
  serves the UI on `:3000` with hot reload. The web app reads `NEXT_PUBLIC_API_BASE` (set to the
  server's origin in `apps/web/.env.local`) and the server attaches a permissive CORS layer for
  `localhost:3000` — only under `--dev`. `rust-embed`'s debug mode reads `apps/web/out/` from disk,
  so the frontend can change without recompiling Rust.
- **Packaged (one port).** The web is built with `NEXT_PUBLIC_API_BASE` empty, so every call is
  same-origin (`/api/*`) and no CORS layer is attached. The single binary serves UI, API, and SSE
  together. CI asserts the exported `out/` contains no hardcoded dev host, so the dev value can never
  leak into a shipped artifact.
