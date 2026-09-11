<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Ostatni kupiec wraca sam (S-03)

- **Plan**: `context/changes/last-merchant-persists/plan.md`
- **Mode**: Deep
- **Date**: 2026-09-11
- **Verdict**: REVISE → **SOUND** after fixes
- **Findings**: 0 critical, 4 warnings, 1 observation — all 5 fixed

## Verdicts

| Dimension | Before | After fixes |
|-----------|--------|-------------|
| End-State Alignment | WARNING | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

Progress contract ✓, brief↔plan ✓. All referenced source paths are upstream-pending by design
and correctly declared as plan contracts rather than code.

Contract re-verified after all edits: 1 `## Progress` heading, 3/3 phase names matching,
32 criteria = 32 Progress items, no checkbox leaks.

**Context:** F-01's review added a sixth read status (`unreadable`) after this plan was written,
and S-02's review changed how Generate is gated. Three of the five findings follow from those.

## Findings

### F1 — StorageNotice misses the `unreadable` status

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 3, change 2 — `StorageNotice.tsx`
- **Detail**: The Implementation Approach promises "Every storage outcome is surfaced… this slice
  switches over it exhaustively and renders one notice per case", then enumerates four F-01
  statuses plus cross-tab. F-01's review added a fifth: `unreadable` — the quota-plus-corruption
  case where the quarantine copy itself could not be written, so the corrupt bytes were left in
  place. That is the case where the GM most needs telling. An unhandled member either trips TS
  exhaustiveness (caught at build) or renders nothing (silence, which is the guardrail).
- **Fix**: Add an `unreadable` case with copy distinguishing it from `quarantined`, plus a manual
  criterion.
- **Decision**: FIXED — added with copy stating the data was **left in place, not set aside**,
  and that freeing space may make it recoverable. New manual criterion 3.12. Brief updated to
  five statuses throughout.

### F2 — Cross-tab re-read assumes the read succeeds

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3, change 3 — Cross-tab awareness
- **Detail**: "On a matching event, re-read the document and adopt the incoming transient record."
  That re-read returns the same six-member union as the mount read, but only the `ok` shape was
  described. A tab working fine can re-read mid-session into `quarantined`, `future-version` or
  `unreadable` — another tab may be running a newer build, or the store may have filled since
  mount — and in none of those is there an "incoming record" to adopt. The mount path and the
  event path handle the same union; only one was specified.
- **Fix**: Route the event handler's read through the same status handling as mount.
- **Decision**: FIXED — adopt only on `ok`; any other status raises the matching notice and
  leaves local state untouched. Added the reasoning that clearing the table on a failed re-read
  would destroy a merchant the GM is reading from, triggered by a failure in a *different* tab.
  New manual criterion 3.13.

### F3 — Persist site is ambiguous once S-02's dialog gates Generate

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2, change 2; upstream contracts table
- **Detail**: "Call `putTransient` from exactly two places: the generate handler, after new rows
  are set…" — but by the time S-03 runs, S-02 has wrapped Generate in `ConfirmDialog`. The button
  handler no longer draws; the dialog's confirm path does. The plan never mentioned that dialog
  anywhere — zero references in the document, and the contracts table listed `corrections` and
  `hasCorrections` from S-02 but not the gating. An implementer reading "the generate handler"
  could reasonably wire the write to the button, where a gated press has no new rows yet.
- **Fix**: Name the confirmed-draw path as the persist site; add `ConfirmDialog` to the contracts
  table.
- **Decision**: FIXED — contract now says **confirmed-draw path**, explains that the write belongs
  in the ungated branch and the dialog's confirm callback, and names the failure mode of getting
  it wrong. Contracts table gained a `ConfirmDialog` row.

### F4 — Lint criterion wording is stale after S-01's fix

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: All three phases + Current State
- **Detail**: Six criteria/Progress lines read "Lint shows no non-CRLF errors" and the Current
  State bullet said to judge by non-CRLF errors only. S-01's Phase 1 now adds `.gitattributes`.
  Unlike F-01 there is no parallel-track caveat here — S-03 runs strictly after S-01.
- **Fix**: Reword all six; replace the Current State bullet.
- **Decision**: FIXED — all six read "Linting passes: `npm run lint`"; the constraint bullet notes
  S-01 normalizes line endings and that lint is a real gate here with no caveat.

### F5 — Save disarms on future-version but not on unavailable

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 (`SaveState`) vs Phase 3, change 4
- **Detail**: `SaveState` is `"unavailable"` when "persistence is standing down", and change 4
  dispatches `"persistence-off"` only for `future-version`. So with storage disabled, Save stays
  armed and fails on every press with a notice. The asymmetry is defensible but undocumented, and
  the next reader will assume one of the two is a bug.
- **Fix**: Add one sentence explaining why the statuses differ.
- **Decision**: FIXED — the plan now states that `future-version` means *do not write, a write
  would destroy data a newer build owns*, while a disabled or full store means *the write will
  fail* — worth letting the GM discover, since disarming would hide a recoverable condition
  behind a dead control.

## Note on cross-plan effects

This is the third consecutive review where the most valuable findings came from *between* plans
rather than within one. F1 and F3 exist only because F-01 and S-02 changed after S-03 was
written; neither is a defect in S-03's own reasoning.

The pattern is now consistent enough to be worth naming: **reviewing a plan whose upstream has
since been reviewed will surface staleness every time.** S-04 and S-05 are the remaining two, and
both are known to carry at least two pre-satisfied steps (the dialog rename, `updateSavedMerchant`)
plus the lint wording.
