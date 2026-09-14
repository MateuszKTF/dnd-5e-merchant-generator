---
change_id: testing-island-reachability
title: "Rollout Phase 1: island test reachability and save-failure reporting"
status: implementing
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
