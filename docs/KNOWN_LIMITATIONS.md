# Known limitations — v0.1

harness-dashboard v0.1 is honest about its boundaries. These are the things it does not do, or does
only approximately, in this version. None of them require network access to work around — the tool
stays fully local and offline.

## Claude Code only

The sole data source in v0.1 is Claude Code's JSONL transcripts under `~/.claude/projects/`. Other
agents or harnesses are out of scope. The architecture leaves room for additional sources later, but
none are supported now. If Claude Code changes its transcript layout or its `message.usage` /
`message.model` fields, scanning may need updating.

## Skill attribution for subagent-dispatched skills

Skill usage is split into "you ran" (manual slash commands, recognized from
`<command-name>/slug</command-name>` in user-message content) and "Claude invoked" (the Skill tool).
Token attribution for skills dispatched inside a subagent (a sidechain `Task`) may be incomplete:
subagent spend is tracked and reported under Subagents, but per-skill token attribution for those
dispatched invocations can be approximate.

## RTK view depends on an external binary

The RTK view is feature-detected. It appears only when an external `rtk` binary is present on the
system; the `/api/rtk` endpoint reports `available: false` (rather than erroring) when it is absent,
and the UI hides the view. harness-dashboard does not bundle or install `rtk`.

## Pricing is best-effort

Cost figures are computed from `pricing.json`, which reflects published rates and is user-editable.
They are estimates, not billing records, and they only stay accurate if `pricing.json` is kept
current. Billable tokens are input + output + cache-creation (5m + 1h); cache reads are priced
separately at the cache-read rate. A selected subscription plan is surfaced alongside the
API-equivalent cost for context.

## Cost is null for unknown-tier models

When a message's model is unknown, cost falls back to its tier rate and is flagged "estimated". When
no tier matches at all, the cost is `null` and is shown as "—" rather than guessed. A message with a
`null` model (for example an error or refusal) still has its tokens counted; only its cost is `null`.

## Single user, single machine

There is no multi-user support, no authentication, and no remote storage. The model assumes one user
on one machine, with a single scanner writer and many readers — no concurrency beyond that.
