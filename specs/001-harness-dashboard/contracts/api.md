# API Contract — harness-dashboard v0.1

All endpoints are served by the Rust binary under `/api`. Responses are JSON with
`Cache-Control: no-store`. Endpoints that span time accept `since` and `until` (ISO 8601; `since`
inclusive, `until` exclusive). Responses are cached in-process with a short TTL, cleared on scan.

## GET

| Endpoint | Query | Returns |
| --- | --- | --- |
| `/api/overview` | `since,until` | `{ sessions, turns, input_tokens, output_tokens, cache_read_tokens, cache_create_5m_tokens, cache_create_1h_tokens, cost_usd, cost_estimated }` |
| `/api/overview-bundle` | `since` | `{ totals, projects, sessions, tools, daily, byModel }` (one batched payload for the Overview page) |
| `/api/prompts` | `limit, sort=tokens\|recent` | `[{ user_uuid, session_id, project_slug, timestamp, prompt_text, prompt_chars, model, billable_tokens, cache_read_tokens, estimated_cost_usd, cost_estimated }]` |
| `/api/projects` | `since,until` | `[{ project_slug, sample_cwd, sessions, turns, input_tokens, output_tokens, billable_tokens, cache_read_tokens }]` |
| `/api/tools` | `since,until` | `[{ tool_name, calls, result_tokens }]` |
| `/api/sessions` | `limit, since, until` | `[{ session_id, project_slug, sample_cwd, started, ended, turns, tokens, cost_usd, cost_estimated }]` |
| `/api/sessions/:id` | — | `[{ uuid, parent_uuid, type, timestamp, model, is_sidechain, agent_id, input_tokens, output_tokens, cache_read_tokens, cache_create_5m_tokens, cache_create_1h_tokens, prompt_text, prompt_chars, tool_calls_json, project_slug, cwd }]` (timestamp order) |
| `/api/daily` | `since,until` | `[{ day, input_tokens, output_tokens, cache_read_tokens, cache_create_tokens }]` |
| `/api/by-model` | `since,until` | `[{ model, turns, input_tokens, output_tokens, cache_read_tokens, cost_usd, cost_estimated }]` |
| `/api/skills` | `since,until` | `[{ skill, manual_sessions, tool_invocations, sessions, last_used, total_cost_usd, ... }]` |
| `/api/subagents` | `since,until` | `{ breakdown, top_sessions, by_kind, by_entrypoint, sdk_runs, dispatch_tree }` |
| `/api/workspaces` | `since,until` | `{ nodes, links, total_calls, self_loop_calls, cross_workspace_calls }` |
| `/api/cross-workspace-leaks` | `limit, since, until` | `[{ source, target, calls, sessions, top_files }]` |
| `/api/tips` | — | `[{ key, category, severity, title, body, scope, links, estimated_savings_usd }]` |
| `/api/plan` | — | `{ plan, pricing }` |
| `/api/settings` | — | `{ claude_dir, projects_dir, projects_overridden, claude_dirs }` |
| `/api/rtk` | — | `{ available, install_url, summary, daily, weekly, monthly }` (`available:false` when no `rtk`) |
| `/api/scan` | — | `{ messages, tools, files, scan_seconds, summary_seconds }` (blocking rescan) |

## POST

| Endpoint | Body | Returns |
| --- | --- | --- |
| `/api/plan` | `{ plan }` | `{ ok: true }` |
| `/api/settings` | `{ plan?, claude_dir?, reset_scan_data? }` | `{ ok: true, ...settings }` |
| `/api/tips/dismiss` | `{ key }` | `{ ok: true }` |
| `/api/refresh` | `{}` | `{ ok: true }` (async scan; returns immediately) |

## SSE

`GET /api/stream` — `text/event-stream`. Events:
- `{ type: "scan", n: {messages,tools,files,...}, ts }`
- `{ type: "scan-skip", reason: "already-running" }`
- `{ type: "error", message }`
- a `: ping` comment every ~15s as keep-alive.

## Limits
- `limit` clamped to ≤ 1000.
- POST bodies clamped to ≤ 1 MB.

## Dev vs. packaged
- **Dev:** the web app reads `NEXT_PUBLIC_API_BASE` (e.g. `http://127.0.0.1:8080`) and the server
  adds a permissive CORS layer for `localhost:3000` **only** under `--dev`.
- **Packaged:** `NEXT_PUBLIC_API_BASE` is empty; all calls are same-origin and no CORS layer is
  attached.
