# Data source — Claude Code JSONL

harness-dashboard's only data source in v0.1 is the JSONL transcripts Claude Code writes on the
user's own machine. Nothing is fetched over the network; the files on disk are the source of truth,
and everything in the SQLite database is derived from them and can be cleared and replayed.

## Where the files live

Claude Code writes one JSONL file per session:

```
~/.claude/projects/<project-slug>/<session-id>.jsonl
```

The scanner discovers `*.jsonl` files recursively under the projects root, which defaults to
`~/.claude/projects/` and can be overridden with `CLAUDE_PROJECTS_DIR`. The home directory and
`~/.claude` are resolved through a portable API, so the same logic works on Windows, macOS, and
Linux. Scanning is incremental: each file's mtime and byte offset are tracked, and only the bytes
past the last fully-parsed line are read on a subsequent scan.

## The slug encoding caveat

The `<project-slug>` directory name is **not** a path the tool controls — it is an identifier Claude
Code already wrote to disk by encoding the project's working-directory path, with drive letters,
colons, and path separators replaced by hyphens. On Windows it therefore encodes drive colons and
backslashes.

The slug is treated as **opaque**. The scanner reproduces Claude Code's exact encoding and decoding
rather than normalizing the string through path APIs, because normalization would corrupt the
identifier and break the join back to the real working directory. Workspace classification of a file
target is a longest-prefix match against the index of observed `(cwd, project_slug)` pairs, not a
path-library operation.

## Source record fields

Each transcript line is a JSON object (one message record). The fields the scanner consumes, and the
columns they map to:

| Source path | Meaning | Maps to |
| --- | --- | --- |
| `uuid` | per-line id (NOT the dedup key) | `messages.uuid` (PK) |
| `parentUuid` | previous message link | `messages.parent_uuid` |
| `sessionId` | session id | `messages.session_id` |
| `type` | `user` \| `assistant` \| … | `messages.type` |
| `timestamp` | ISO 8601 | `messages.timestamp` |
| `cwd`, `gitBranch`, `version`, `entrypoint` | context (optional) | `messages.cwd`, `git_branch`, `cc_version`, `entrypoint` |
| `isSidechain`, `agentId` | subagent dispatch markers | `messages.is_sidechain`, `agent_id` |
| `message.id` | **snapshot dedup key** (with `sessionId`) | `messages.message_id` |
| `message.model` | model id (may be null) | `messages.model` |
| `message.usage.input_tokens` | fresh input | `messages.input_tokens` |
| `message.usage.output_tokens` | output | `messages.output_tokens` |
| `message.usage.cache_read_input_tokens` | cache reads | `messages.cache_read_tokens` |
| `message.usage.cache_creation.ephemeral_5m_input_tokens` | 5m cache writes | `messages.cache_create_5m_tokens` |
| `message.usage.cache_creation.ephemeral_1h_input_tokens` | 1h cache writes | `messages.cache_create_1h_tokens` |
| `message.content[]` | text / `tool_use` / `tool_result` blocks | parsed into `tool_calls` rows |

`tool_use` blocks become `tool_calls` rows with a per-tool target (file path, command, url, query,
pattern, subagent type, or skill), and `tool_result` content sizes the result tokens. The project
slug (the encoded directory name) is recorded as `messages.project_slug`.

Slash commands appear inside user-message content as `<command-name>/slug</command-name>` and are
synthesized into a `Skill` tool-call row, so manual slash-command use can be distinguished from
assistant-initiated Skill tool calls.

## The dedup invariant

Claude Code writes several JSONL lines per assistant response: each carries a distinct top-level
`uuid` but the same `message.id`, and each repeats the **final** usage totals. The scanner therefore
keys dedup on `(session_id, message_id)`, **not** the per-line `uuid`:

- keep exactly one row per `(session_id, message_id)` — the latest snapshot (the keeper);
- never sum usage across siblings (the totals are already final on each snapshot);
- when a sibling is superseded, re-point its `tool_calls` onto the keeper rather than dropping them,
  because parallel tool calls are spread across snapshot siblings.

Getting this wrong silently inflates every token and cost number, so it is covered by a golden
fixture test. The full schema and invariants are in
`specs/001-harness-dashboard/data-model.md`.
