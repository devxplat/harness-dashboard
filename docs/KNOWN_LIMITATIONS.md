# Known Limitations

harness-dashboard is intentionally local-first and transparent about the precision of its metrics.
These limitations are current product boundaries, not hidden failure modes.

## Provider Fidelity Varies

Not every AI coding provider exposes the same data. Claude Code, Codex, and Gemini CLI can provide
exact usage tokens from local JSONL-like records. Cursor and some opencode/Copilot sources rely on
provider-reported values. Antigravity currently exposes useful activity/tool signals but may not
expose tokens, prompts, or costs.

The database records `usage_source` and `cost_source` so the UI can label unavailable, reported,
and estimated values rather than pretending all providers are equivalent.

Context-window and plan-usage fidelity also varies. Claude Code can expose official current
context and plan windows through the user-enabled Status Line snapshot command. Most other
providers do not currently expose equivalent local quota snapshots, so those panels render
best-effort estimates or explicit unavailable states.

## Pricing Is Best Effort

Costs are analytics estimates, not billing records. For sources with exact usage but no reported
cost, harness-dashboard estimates API-equivalent cost from `pricing.json`. Unknown models may use
tier fallbacks; models without a tier produce `null` cost and render as unavailable.

Provider-reported cost is used when present, but provider billing models and subscriptions can
differ from API-equivalent rates.

The provider plan catalog is embedded in `pricing.json` with a `source_checked_at` date and source
URLs. It is not a billing-system sync and it does not refresh prices at runtime.

## Integrations Are Opt-In Network Sources

Normal local scanning does not need network access. GitHub and Google Calendar do make runtime
network calls after the user configures them.

GitHub sync is limited by token scopes, selected repositories, rate limits, backfill windows, and
the fields available from the REST API. Google Calendar requires server-side OAuth credentials and
only uses calendar event timing for productivity analysis.

## DORA And Productivity Metrics Are Approximate

DORA metrics combine local git, tags, GitHub PRs/releases/workflows, and incident issues when
available. Some values are exact for a configured source; others are approximations from available
local data. The UI labels exact vs approximate metrics.

Focus, flow, warm-up, and meeting-overlap metrics are estimates from observable activity and
calendar timing. They should be used for trend awareness, not individual performance scoring.

## RTK Is External

The RTK view is feature-detected. It appears only when an external `rtk` binary is available. The
dashboard reports `available: false` rather than failing when RTK is absent, and it does not bundle
or install RTK.

## Single User, Single Machine

There is no multi-user support, authentication layer, remote storage, or hosted sync. The intended
deployment is one local user on one machine, with one scanner writer and many local read queries.

## Source Layouts Can Change

AI coding tools and editor storage formats are not stable public standards. If a provider changes
its transcript, database, or telemetry layout, the corresponding adapter may need to be updated.
