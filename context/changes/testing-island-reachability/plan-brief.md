# Island Test Reachability and Save-Failure Reporting — Plan Brief

> Full plan: `context/changes/testing-island-reachability/plan.md`
> Research: `context/changes/testing-island-reachability/research.md`

## What & Why

Rollout Phase 1 of the project's test strategy. The React islands — 3 068 lines carrying
every storage-failure message the GM ever sees — are excluded from the test runner by
configuration, and the documented compensating control (manual verification steps in each
plan) was never actually executed. This phase closes four live defects that need no new
infrastructure, builds the jsdom harness that makes `.tsx` reachable, and spends it on the
highest risk: a failed write that reports success.

## Starting Point

`vitest.config.ts` pins `environment: "node"` and collects only `src/**/*.test.ts`. The
368 existing tests are genuinely strong — a prior mutation audit killed 21 of 23 planted
mutants — but they all live in `src/lib/`. No coverage tooling exists anywhere to report
what is dark. Six defects from that audit (F5–F10) were deliberately left open.

## Desired End State

The runner reaches `.tsx` through a second Vitest project. Four defects are fixed, each
proven by a test that failed first for a documented reason. Four contracts that currently
hold are pinned. Risk #1 is asserted at the island layer, its three island-layer defects
quarantined executably. Coverage reports the remaining dark surface as 0% instead of
omitting it.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Oracle discipline | Every expected value traces to the PRD guardrail, an FR, a US criterion, or a docblock | Eight target behaviors currently fail; matching current behavior would encode four live bugs as expected values | Plan |
| Currently-failing behaviors | Fix the cheap pure-module ones; quarantine island-layer ones | Keeps an infrastructure phase from becoming a bug-fix phase across a 1 735-line untested component | Plan |
| Quarantine mechanism | `it.fails()`, not `it.skip()` | A skipped test never executes — the L-03 failure mode this repo hit twice. `it.fails()` runs the assertion and breaks the build when the defect is fixed, forcing the entry to graduate | Plan |
| Harness | jsdom via `test.projects`, not Browser Mode | `environmentMatchGlobs` and `vitest.workspace.ts` were removed in Vitest 4; the docblock alternative cannot scope `setupFiles`, which would push RTL setup onto all 368 node tests | Research + Plan |
| `.ts` importing `.tsx` | Allowed for non-rendering exports | Verified no DOM is reached — `StorageNotice.tsx` has zero imports and the JSX runtime stops at `react`. Unblocks the cheapest test with no harness | Research |
| Coverage | Wire now, report-only, no threshold | L-05 recurred twice because nothing measured the dark surface; measure it during the phase that shrinks it | Plan |
| Node floor | `.nvmrc` → 22.22.2, engines raised, CI follows the pin | `jsdom@30` requires `^22.22.2`; the repo pinned `22.14.0` | Research + Plan |
| Backport | Final sub-phase | The guide stops being wrong at the first moment anyone acts on it | Plan |

## Scope

**In scope:** four defect fixes (M-3 notice classification, F5 empty corrections, the
`openedSavedIdFor` guard, F8 search); four contract pins (frozen v1 fixture, F10 latch,
`removeItem` probe, correction-type correspondence); the jsdom harness; coverage reporting;
four Risk #1 island assertions; the cookbook and the research backport.

**Out of scope:** fixing the island-layer defects (quarantined, owned by a follow-up);
cross-tab `storage`, modal dialog semantics, `pagehide`/`visibilitychange` triggers, and
colour contrast — jsdom cannot exercise any of them honestly; the a11y gate scope (§3
Phase 4); the 12 existing tests that cannot fail for the right reason.

## Architecture / Approach

One `vitest.config.ts` with two projects over naturally disjoint globs: `.test.ts` → node
(unchanged, 368 tests), `.test.tsx` → jsdom (new). Coverage stays root-level because Vitest
rejects it inside a project. Storage failures reach the component by spying on
`Storage.prototype`, since the component calls `readDocument()` with no argument and offers
no injection seam. Cheap, independent work lands first so the riskiest change — the runner
config — arrives after the suite has already grown.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Close the cheap defects | Four live bugs fixed, each proven failing first | A fix ripples into a pre-existing assertion |
| 2. Pin the contracts that hold | Frozen v1 fixture, F10 latch, probe branch, type correspondence | Pins that pass on day one give false comfort if the mutation check is skipped |
| 3. Test infrastructure | Node bump, DOM stack, projects split, coverage, smoke render | Vitest 5's `extends: true` leaks root config into the jsdom project and silently breaks 368 tests |
| 4. Risk #1 at the island layer | Four assertions, three quarantined defects, count gate | `it.fails()` passes when a test fails for the wrong reason |
| 5. Cookbook and backport | §6.2, research corrections, L-06, status flip | Strategy edits mixed into an implementation diff |

**Prerequisites:** Node ≥ 22.22.2 available via nvm; network access for six new
devDependencies.
**Estimated effort:** ~4–5 sessions across 5 phases; Phases 1–2 are short and independent.

## Open Risks & Assumptions

- **Risk #1 is not fully mitigated when this plan ends.** Four of five behaviors are
  asserted; three are quarantined. The §3 flip to `complete` means the rollout phase
  shipped, not that the risk is closed.
- jsdom's dialog stub removes exactly the behavior it appears to provide. The plan forbids
  any future test from claiming modal coverage through it.
- The `it.fails()` count gate is a text scan. It catches growth, not misuse.
- Coverage without a threshold can be ignored. The real gate is still §3 Phase 4.

## Success Criteria (Summary)

- A GM-facing write failure cannot render as success in any variant the harness can reach —
  and the three that still can are named, executable, and impossible to forget.
- Adding an island test requires reading §6.2 alone, not this plan.
- The number reported by `npm test` and the number of lines actually exercised stop being
  different questions with the same answer.
