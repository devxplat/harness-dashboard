# Tasks — [FEATURE NAME]

Granular task breakdown, grouped by the phases in `plan.md`. Each task names the crate/module or
path it touches. Tasks marked `[P]` are parallelizable (no ordering dependency on a sibling in the
same group). Tasks where silent wrongness is costly are ordered **test-first**: the failing test
precedes the implementation it guards.

Conventions: [define short aliases for the paths used below]. Acceptance for [risk-bearing] tasks is
a passing fixture test.

## Phase 0 — [bootstrap]

- [ ] T000 [task — path].

## Phase 1 — [spec & docs]

- [ ] T010 [task — path]. `[P]`

## Phase 2 — [first implementation slice]

### [subgroup]
- [ ] T100 [failing test — path].
- [ ] T101 [implementation that makes T100 pass — path].
- [ ] T102 [task — path]. `[P]`

## Phase N — [final slice / CI]

- [ ] T400 [task — path]. `[P]`
