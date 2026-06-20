# harness-dashboard Constitution

This constitution defines the non-negotiable operating principles for harness-dashboard. It is
authoritative: it supersedes `CLAUDE.md`, READMEs, and habit. Any pull request may be measured
against it, and any deviation must be justified in writing in the PR description.

harness-dashboard is a **local-first** tool: it reads the JSONL transcripts that Claude Code
writes on the user's own machine and turns them into usage, cost, and session analytics. It has
no backend service, no account, and no reason to phone home. Every principle below flows from
that identity.

---

## Core Principles

### I. Local-First & Fully Offline (NON-NEGOTIABLE)
The tool must work with no network connection and must never transmit the user's data anywhere.
No telemetry, no analytics beacons, no remote logging, no "anonymous usage stats". All user data
(transcripts, derived metrics, the SQLite database) stays on the user's disk. The only acceptable
network access is (a) developer-time tooling (package installs, the shadcnblocks component
registry) which never ships in the binary, and (b) explicit, user-initiated actions that are
clearly labeled as such. Tests run offline.

### II. Rust Backend, TypeScript Client
All scanning, parsing, importing, cost computation, and persistence is implemented in **Rust**.
The frontend is a **client-rendered** TypeScript/Next.js dashboard that talks to the Rust server
only through the documented `/api/*` HTTP surface. The frontend never reads the filesystem or the
database directly. This boundary is a hard line: business logic lives in Rust, presentation lives
in the web app.

### III. Single-Binary Distribution
The shipped artifact is one self-contained executable. In release builds the Rust server embeds
the prebuilt web UI and serves the API and the UI on a single local port. A user runs one command
with no Node.js, no external SQLite, and no system dependencies. Decisions that would break the
single-binary promise (requiring a separate runtime, a system library, or a second process at
runtime) require explicit written justification.

### IV. Behavioral Parity Is the Correctness Bar
harness-dashboard is a clean-room reimplementation. Correctness is defined by **observable
behavior**, not by any other project's source. We reproduce *what* the reference tool computes
(the data model, the dedup invariant, expensive-prompt attribution, cost tiers) by specifying it
here and in `specs/`, and we verify it with fixtures — never by copying code. The load-bearing
invariant: streaming-snapshot dedup keys on `(session_id, message_id)`, not the per-line `uuid`;
usage totals are repeated across snapshot siblings (never summed) and parallel `tool_use` blocks
are spread across siblings and must be re-pointed onto the keeper, not dropped. Any change to
scanning or aggregation must keep this invariant and prove it with a test.

### V. Test-First Engineering
Non-trivial logic ships with tests, and for the parts where silent wrongness is costly
(scanning, dedup, cost, attribution) tests are written against fixtures before the implementation
is trusted. `cargo test` covers `harness-core`; `vitest` covers the web app; a Playwright smoke
test exercises the dashboard against a running server. A bug fix starts with a failing test that
reproduces it.

### VI. SQLite Safety
Persistence is SQLite via a bundled, in-binary engine. Every value that can originate from user
data or a request goes through bound parameters — never string interpolation. Schema changes go
through an ordered, idempotent migration runner. Because the JSONL transcripts on disk are the
source of truth, a schema bump may clear and replay derived tables rather than perform a fragile
in-place data migration.

### VII. Simplicity & YAGNI
Prefer the direct solution. One storage engine (SQLite), one language boundary (Rust ↔ TS), no
speculative abstractions, no premature generality, no configuration knobs without a real use
case. Use frameworks directly rather than wrapping them. Small modules with a single
responsibility. Functions take a small number of parameters; reach for a struct before a long
positional list. Added complexity must pay for itself and be justified in review.

### VIII. Cross-Platform by Default
Windows, macOS, and Linux are first-class. Resolve the home directory and `~/.claude` through a
portable API. Treat Claude Code's on-disk project slugs (which encode drive letters, colons, and
path separators) as opaque and reproduce their exact encoding rather than "normalizing" them.
CI runs the test suite on all three operating systems.

### IX. Documentation & Library Currency
Public behavior is documented in `specs/` and `docs/`; the CLI is self-describing. When working
with an external library, framework, or API, consult current documentation (e.g. via Context7)
rather than relying on memory — versions move. A feature is not done until its surface is
documented.

### X. Conventional Git
Branches are named `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`. Commits follow
Conventional Commits (`type(scope): subject`). History stays linear and readable; each commit
builds and passes its own tests where practical.

---

## Engineering Gates

These are checks a reviewer applies before approving a change.

- **Offline Gate.** Does the change introduce any runtime network call or data egress? If yes, it
  is rejected unless it is an explicit, labeled, user-initiated action.
- **Boundary Gate.** Does the frontend reach past `/api/*` into the filesystem or database, or
  does business logic leak into the web app? If yes, move it into Rust.
- **Parity Gate.** Does the change touch scanning, dedup, or aggregation? If yes, it must preserve
  the `(session_id, message_id)` dedup invariant and ship a fixture test demonstrating it.
- **Single-Binary Gate.** Does the change add a runtime dependency, a second process, or a system
  library requirement? If yes, justify in writing or redesign.
- **Simplicity Gate.** Is there a speculative abstraction, an unused config surface, or a wrapper
  with one caller? If yes, remove it.

---

## Governance

This constitution supersedes other process documents in this repository. Amendments are made by
pull request that (a) states the rationale, (b) updates this file, and (c) bumps the version below
using semantic versioning: **MAJOR** for removing or redefining a principle, **MINOR** for adding
a principle or gate, **PATCH** for clarifications. When an amendment changes day-to-day rules,
update `CLAUDE.md` in the same PR.

**Version:** 1.0.0 · **Ratified:** 2026-06-20 · **Last amended:** 2026-06-20
