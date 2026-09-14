---
change_id: testing-island-reachability
title: "Rollout Phase 1: island test reachability and save-failure reporting"
status: implemented
created: 2026-09-14
updated: 2026-09-14
archived_at: null
---

## Notes

Rollout Phase 1 of `context/foundation/test-plan.md` (§3). Covers Risk #1: a merchant
write fails (quota exhausted, storage blocked, document unreadable) and the interface
reports success anyway, so the GM discovers the loss on the next session.

The structural precondition comes first. `vitest.config.ts` pins `environment: "node"`
and `include: ["src/**/*.test.ts"]`, so no `.tsx` file is ever collected by the runner —
the entire island layer is excluded by configuration, not by omission. Lesson L-05
records this. This phase must decide between a jsdom harness and Vitest Browser Mode,
and record that decision plus the glob and naming convention in test-plan.md §6.2.

The upstream research deliberately exceeds this phase's scope: it grounds the whole
§2 risk map (Risks #1–#7), so later rollout phases inherit verified anchors and target
behaviors instead of re-deriving them. See `research.md`.

## Scope change — 2026-09-14, after the plan completed

The plan's `## What We're NOT Doing` parked the island-layer defects, including
the mute `not-found` notice, for a follow-up change. That was reversed with the
owner's agreement in the same session, and the defect was closed test-first:

- **RED** — the parked `it.fails` entry was already a genuine failing test,
  asserting the requirement rather than a weakened version of it.
- **GREEN** — `conditionFromFailure` maps `not-found` to `unavailable`, whose
  copy is already exactly true for a store that accepts a write and drops it.
- **REFACTOR** — the entry graduated, the ledger dropped to zero, and its
  premise-guard was rewritten so it no longer depends on an entry existing.

Consequence: Risk #1 is closed rather than partially mitigated, and
`test-plan.md` §3 no longer carries the "complete but not closed" caveat.
