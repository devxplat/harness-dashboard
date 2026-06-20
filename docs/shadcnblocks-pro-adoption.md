# shadcnblocks pro adoption — handoff & next steps

Working note for continuing the UI upgrade in a **new Claude Code session with the
shadcnblocks MCP connected**. Not user-facing product docs.

## Progress — 2026-06-20 (session 2)

Env key fixed: the working `9INhn…` key is now in the shell/process env (`.env`
was already correct). shadcnblocks **auth** works (HTTP 200), but the **MCP
server still doesn't register its tools** this session — harvest via
`curl -H "Authorization: Bearer $SHADCNBLOCKS_API_KEY" https://www.shadcnblocks.com/r/<name>.json`
and adapt, or `shadcn add` (CLI auth works). `components.json` now targets the
canonical `www` host (non-www 308-redirects).

Chunks landed (each green: tsc · vitest ≥98% · eslint · build · e2e 13/13):

- **Charts** (`20ef736`): daily chart → gradient stacked area, harvested from
  `@shadcnblocks/chart-card9`.
- **KPI cards** (`ab66729`): genuine period-over-period deltas — a 2nd fetch to
  the existing `/api/overview` previous window (no backend change) — plus Lucide
  icons; trend row from `@shadcnblocks/stats-card1`, rendered muted (cost up
  isn't "good"). `all` range has no prior window → no delta.
- **Data table** (`4d3a73e`, `d96a2a3`): reusable `components/data-table.tsx` on
  `@tanstack/react-table` v8 (column sort, global search, pagination, right-align
  via column `meta`, filtered-rows footer). Sessions + Prompts reworked onto it;
  Prompts keeps the server-side By tokens / Recent toggle (which-50 semantics).

Remaining:

- **Empty states / filter toolbar** — largely covered by DataTable (search box +
  empty states). A dedicated standalone filter toolbar is optional.
- **Broad primitive swap** — button/badge/switch/skeleton/progress/slider/
  pagination/hover-card/input/select → pro variants (~30 files). Not started.

## Where the project stands

harness-dashboard is **functionally complete and shipping** on `main`
(`github.com/devxplat/harness-dashboard`, AGPL-3.0):

- Phases 0–5 done: Rust core (scanner + `(session_id, message_id)` snapshot dedup
  + cost engine + every read query incl. skills/subagents/workspaces/tips), axum
  API + SSE, Next.js frontend (all 11 views), single embedded binary, CI.
- Tests green: **8 Rust + 65 vitest (98.8% line cov, enforced) + 13 Playwright e2e**.
- Frontend stack: Next 16 + React 19 + Tailwind v4 + shadcn (new-york, **neutral**
  tokens) + recharts 3. Custom shell (`components/shell/`), not a pro block.

## shadcnblocks status (done this session)

- **Registry key works**: `sk_live_9INhnK2WmwfABAnH0zsn798dMc3dAnn4` → HTTP 200 at
  `https://www.shadcnblocks.com/r/...`. (Old key `sk_live_JOggn…` was MCP-only / 401.)
- **Key propagated** to all local configs (gitignored): harness-dashboard
  `apps/web/.env` + `.env.local`; `gngc-monorepo/.env.local`;
  `pixelmancer-monorepo/.mcp.json` + `.env.local`.
- **MCP configured**: `.mcp.json` at repo root runs `npx shadcn@latest mcp` with
  `SHADCNBLOCKS_API_KEY` via **env-var** (no secret committed — public repo).
  ⚠ To use it, export `SHADCNBLOCKS_API_KEY` in the environment before launching
  Claude Code (the `${…}` reference resolves from the process env).
- **dashboard18 evaluated and dropped**: it's a hotel-booking demo block (icons
  BedDouble/DoorOpen/UtensilsCrossed) with strict-TS + recharts-3 type errors —
  not a token dashboard. Its reusable parts (shadcn primitives + neutral tokens)
  are already what the shell uses. The `collapsible` primitive it pulled was kept.

## What shadcnblocks pro actually is

A catalog of ~1,684 **styled variants** (Button ×126, Chart ×68, Form ×85, …),
installed from the `@shadcnblocks` registry. NOT canonical replacements — you pick
specific variants by id. Many are marketing-flavored (Social Button, Marquee).

## Decision (from the user)

**Targeted high-value first, THEN broad swap of primitives.**

## Next steps (new session, MCP on)

1. **Confirm MCP is live**: the `shadcnblocks` MCP should expose search/view/add.
   Use it to discover real component ids (we don't have them; don't guess slugs).
2. **Targeted high-value** (do these first, one chunk + commit each):
   - **Charts**: replace `components/charts/daily-chart.tsx` (hand-wired recharts)
     with a pro chart; also add by-model / cache charts on Overview.
   - **KPI / stat cards**: upgrade `components/kpi-card.tsx` usage on Overview.
   - **Data table**: pro table (sort + filter + pagination) for Sessions and
     Prompts (replaces the hand-rolled `Table` + client filter).
   - **Empty states / filter toolbar**: pro empty + a filter bar for Sessions.
3. **Broad swap of primitives** (after the above): button, badge, switch,
   skeleton, progress, slider, pagination, hover-card, input, select → pro variants
   from `@shadcnblocks`. Expect ~30 files of churn.
4. **Per chunk, keep green**: after each `shadcn add`, run
   `pnpm --filter @harness/web typecheck` (pro components often need strict-null
   fixes — dashboard18 did), then update vitest unit tests + Playwright e2e
   selectors, keep coverage ≥98%, `eslint`, `next build`, then commit.

## Gotchas

- `shadcn add` once **corrupted `@playwright/test` to `3.8.0`** in
  `apps/web/package.json` — always diff package.json after an add and fix versions.
- e2e is deterministic via `apps/web/e2e/fixture/projects/` + the Rust server;
  changing view structure means updating `apps/web/e2e/*.spec.ts` selectors.
- vitest thresholds live in `apps/web/vitest.config.ts` (lines/statements 98).
- `tsc --noEmit` is the gate the dev loop missed once — run it after UI changes.

## Key files

- Views: `apps/web/app/**/page.tsx` (+ `*.test.tsx`)
- Shell: `apps/web/components/shell/{app-shell,app-sidebar,range-selector,scan-status}.tsx`
- Charts: `apps/web/components/charts/daily-chart.tsx`
- Primitives: `apps/web/components/ui/*` (shadcn) · registry in `components.json`
- API contract the UI depends on: `specs/001-harness-dashboard/contracts/api.md`
