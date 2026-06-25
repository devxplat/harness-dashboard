# harness-dashboard Constitution

This constitution defines the non-negotiable operating principles for harness-dashboard. It is
authoritative: it supersedes `CLAUDE.md`, READMEs, and habit. Any pull request may be measured
against it, and any deviation must be justified in writing in the PR description.

harness-dashboard is a **local-first, multi-provider AI coding analytics** tool. It reads local
agent transcripts, editor databases, and repositories on the user's own machine; optionally enriches
them with explicitly configured integrations; and turns them into usage, cost, productivity, DORA,
DevEx, and team insights. It has no hosted backend, no account, and no reason to phone home unless
the user has deliberately connected a network integration.

---

## Core Principles

### I. Local-First & User-Controlled Network Access (NON-NEGOTIABLE)

The tool must work from local data with no account and no hosted service. It must never transmit
the user's transcripts, code, git history, metrics, or database to an unconfigured service. No
telemetry, analytics beacons, remote logging, or anonymous usage stats.

The only acceptable runtime network access is explicit, labeled, user-initiated integration work
such as GitHub sync or Google Calendar sync. Developer-time tooling, package installs, and component
registry access never ship in the binary. Tests must not depend on live network access.

### II. Rust Backend, TypeScript Client

All scanning, parsing, importing, cost computation, persistence, and shared business logic are
implemented in **Rust**. The frontend is a **client-rendered** TypeScript/Next.js dashboard that
talks to the Rust server only through the documented `/api/*` HTTP surface and `/api/stream`.

The frontend never reads the filesystem or SQLite directly. Business logic lives in Rust;
presentation and interaction live in the web app.

### III. Single-Binary Distribution

The shipped artifact is one self-contained executable. In release builds the Rust server embeds the
prebuilt web UI and serves the API, SSE stream, and UI on a single local port. A user runs one
command with no Node.js, external SQLite, or second runtime process.

Runtime dependencies that break the single-binary promise require explicit written justification.

### IV. Behavioral Parity & Provenance Are The Correctness Bar

harness-dashboard is a clean-room implementation of observable behavior. Correctness is defined by
documented behavior, fixture tests, and source provenance, not by copying another project's source.

Provider adapters must preserve source fidelity. Rows must indicate whether usage and cost are
exact, provider-reported, estimated, or unavailable. For streaming snapshot providers, the
load-bearing invariant is deduplication on `(session_id, message_id)`, not the per-line `uuid`;
usage totals are repeated and must not be summed, and tool calls from superseded siblings must be
preserved on the keeper.

### V. Test-First Engineering

Non-trivial logic ships with tests. For scanner, dedup, cost, attribution, DORA, integration
parsing, and metric aggregation, silent wrongness is costly, so changes must be proven with focused
unit or fixture tests before they are trusted.

`cargo test` covers core behavior; `vitest` covers web logic/components; Playwright smoke tests
exercise the dashboard against a running server.

### VI. SQLite Safety

Persistence is SQLite via a bundled engine. Every value that can originate from user data or a
request goes through bound parameters, never SQL string interpolation. Schema changes go through an
ordered, idempotent migration runner.

Provider files, editor databases, local repositories, and integration APIs are the source of truth.
SQLite is derived state and may be cleared and replayed when that is safer than fragile migration.

### VII. Simplicity & YAGNI

Prefer the direct solution. One storage engine, one backend/frontend boundary, no speculative
abstractions, no unused configuration surface, and no wrapper with one caller unless it removes real
complexity. Small modules should have one responsibility. Added complexity must pay for itself and
be justified in review.

### VIII. Cross-Platform By Default

Windows, macOS, and Linux are first-class. Resolve home directories and provider defaults through
portable APIs. Treat provider-specific path encodings and IDs as opaque when the provider owns
them; do not normalize strings in a way that corrupts identity. CI should run meaningful checks on
all three operating systems.

### IX. Documentation & Library Currency

Public behavior is documented in `specs/`, `docs/`, and the README. The CLI should be
self-describing. When working with external libraries, frameworks, cloud APIs, or SDKs, consult
current documentation rather than relying on memory. A feature is not done until its user-visible
surface and limitations are documented.

### X. Conventional Git

Branches are named `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, or `docs/<slug>`. Commits follow
Conventional Commits (`type(scope): subject`). History stays linear and readable; each commit
should build and pass its own tests where practical.

---

## Engineering Gates

- **Offline Gate.** Does the change introduce runtime network access or data egress? If yes, it is
  rejected unless it is explicit, labeled, user-configured integration behavior.
- **Boundary Gate.** Does the frontend reach past `/api/*` into the filesystem or database, or does
  shared business logic leak into the web app? If yes, move it into Rust.
- **Parity Gate.** Does the change touch scanning, dedup, attribution, or aggregation? If yes, it
  must preserve provider provenance and ship a focused test for the behavior.
- **Single-Binary Gate.** Does the change add a runtime dependency, second process, system library,
  or hosted service requirement? If yes, justify in writing or redesign.
- **Simplicity Gate.** Is there a speculative abstraction, unused config knob, or wrapper with one
  caller? If yes, remove it.
- **Documentation Gate.** Does the change alter public behavior, setup, providers, integrations, or
  limitations? If yes, update the relevant docs in the same change.

---

## Governance

This constitution supersedes other process documents in this repository. Amendments are made by
pull request that (a) states the rationale, (b) updates this file, and (c) bumps the version below
using semantic versioning: **MAJOR** for removing or redefining a principle, **MINOR** for adding or
broadening a principle or gate, **PATCH** for clarifications. When an amendment changes day-to-day
rules, update `AGENTS.md` and `CLAUDE.md` in the same PR.

**Version:** 1.1.0 - **Ratified:** 2026-06-20 - **Last amended:** 2026-06-25
