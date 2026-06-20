# Quickstart — harness-dashboard v0.1

How to install, run in development, and build the single binary. Everything here is local and
offline; the only network access is developer-time tooling (package installs and the shadcnblocks
component registry), which never ships in the binary.

## Prerequisites

- **Rust** (stable). The release build compiles SQLite from source via `rusqlite`'s `bundled`
  feature, so a C toolchain is required: MSVC on Windows, Xcode command-line tools on macOS, a
  system C compiler on Linux.
- **Node** ≥ 24.
- **pnpm** ≥ 10 (the repo pins `pnpm@10.33.2` via `packageManager`).

A populated `~/.claude/projects/` (Claude Code's transcripts) is what the dashboard scans, but the
app starts and renders empty states without it.

## Install

```bash
pnpm install
```

This installs the JS workspace (`apps/*`). Rust dependencies are fetched on first `cargo` build.

## Run in development (two ports)

Dev mode runs the Rust API and the Next.js UI as separate processes:

```bash
pnpm dev
```

- Rust API (`harness-server --dev`) listens on **:8080**.
- Next.js dev server listens on **:3000** with hot reload.
- The web app reads `NEXT_PUBLIC_API_BASE` and fetches `${API_BASE}/api/*` plus
  `EventSource(${API_BASE}/api/stream)`. Under `--dev` the server attaches a permissive CORS layer
  for `localhost:3000` only.

Set the API base for dev in `apps/web/.env.local`:

```bash
# apps/web/.env.local  (gitignored)
NEXT_PUBLIC_API_BASE=http://127.0.0.1:8080
```

Open <http://127.0.0.1:3000>. To run only the API:

```bash
pnpm dev:api        # cargo run -p harness-server -- --dev
```

## Build the single binary

The release artifact embeds the exported web UI into the Rust binary and serves API + UI on one
port. Build the web first, then the server:

```bash
pnpm build:web      # pnpm --filter @harness/web build  →  apps/web/out/
pnpm build:server   # cargo build --release -p harness-server --features release-embed
```

`pnpm build` runs both in order. Then run the binary:

```bash
./target/release/harness-dashboard      # serves UI + API + SSE on http://127.0.0.1:8080
```

In release the web is built with `NEXT_PUBLIC_API_BASE` **empty**, so all calls are same-origin and
no CORS layer is attached. The `build.rs` guard fails the release build if `apps/web/out/index.html`
is missing, so always run `build:web` before `build:server`.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | server port |
| `HOST` | `127.0.0.1` | bind address |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | transcript root to scan |
| `HARNESS_DB` | `~/.claude/harness-dashboard.db` | SQLite database path |
| `TOKEN_DASHBOARD_DB` | — | accepted alias for `HARNESS_DB` |

CLI flags mirror these (port, host, database path, projects directory) and add `--dev` and a
no-open mode; flags take precedence over environment variables.

## shadcnblocks setup note

The frontend uses shadcn/ui ("new-york") with the `@shadcnblocks` component registry. Installing or
updating blocks at dev time requires `SHADCNBLOCKS_API_KEY`, sent as an `Authorization: Bearer`
header by the shadcn registry configuration in `components.json`.

- Put the key in a local, gitignored `.env.local`; reference it as a placeholder in `.env.example`.
- It is **install/dev-time only**. It is never read at runtime and never enters the shipped binary
  or the exported `out/` tree.

## Verify

```bash
cargo test                                  # Rust unit + fixture tests (harness-core)
pnpm test                                   # web unit tests (vitest)
curl http://127.0.0.1:8080/api/overview     # sanity-check an endpoint
```
