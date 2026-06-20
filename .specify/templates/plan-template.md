# Implementation Plan — [FEATURE NAME]

**Feature branch:** `[NNN]-[slug]`
**Spec:** `specs/[NNN]-[slug]/spec.md`
**Inputs:** `data-model.md`, `contracts/`, `research.md`, `quickstart.md`

This plan translates the spec into a phased build. It is governed by the constitution
(`.specify/memory/constitution.md`); the Constitution Check below maps the work to each principle
and gate.

## Technical Context

- **Languages / runtimes:** [versions]
- **Key dependencies:** [libraries and why]
- **Storage:** [engine and mode]
- **Structure:** [crates / apps / packages and their responsibilities]
- **Testing:** [test runners and what each covers]
- **Decisions of record:** see `research.md`.

## Repository Structure

```
[abridged tree showing only the directories/files this feature adds or touches]
```

## Constitution Check

[For each principle and gate, one line stating how the plan satisfies it, or an explicit,
justified deviation. Resolve all gates before implementation begins.]

- **[Principle I]:** [how satisfied]. **[Gate]: pass.**
- **[Principle II]:** [how satisfied].
- …

[List deviations and their written justification, or state "No deviations to justify."]

## Phased Approach

### Phase 0 — [bootstrap / prerequisites]
[What exists or must exist before feature work starts.]

### Phase 1 — [spec & docs]
[The specification and documentation deliverables.]

### Phase 2 — [first implementation slice, test-first where wrongness is costly]
[Ordered steps; name the modules/paths touched.]

### Phase N — [final slice / packaging / CI]
[Integration, build, and CI work that closes the feature.]
