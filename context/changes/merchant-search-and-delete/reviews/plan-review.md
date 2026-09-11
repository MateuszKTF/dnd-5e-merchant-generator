<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Lista, która wytrzymuje miesiące kampanii (S-05)

- **Plan**: `context/changes/merchant-search-and-delete/plan.md`
- **Mode**: Deep
- **Date**: 2026-09-11
- **Verdict**: REVISE → **SOUND** after fixes
- **Findings**: 0 critical, 3 warnings, 1 observation — all 4 fixed

## Verdicts

| Dimension | Before | After fixes |
|-----------|--------|-------------|
| End-State Alignment | PASS | PASS |
| Lean Execution | WARNING | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

Progress contract ✓, brief↔plan ✓. Verified `merchant-library.ts` and its test file are still
created by S-04 Phase 1 after that plan's renumbering.

Contract re-verified after all edits: 1 heading, 2/2 phase names, 25 criteria = 25 Progress items,
no checkbox leaks, zero remaining stale references.

## Findings

### F1 — A cross-tab delete leaves openedSavedId dangling

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 change 3; Critical Implementation Details
- **Detail**: This slice exists partly to fix one hazard: deleting the merchant the GM has open
  leaves `openedSavedId` pointing at nothing, so Zapisz calls `updateSavedMerchant` on a missing id
  and quietly fails. The fix was applied in the local delete handler only. But the plan contained
  **zero references to cross-tab anything**, while S-03 added a `storage` listener and S-04
  refreshes `saved` from it — so a delete performed in another tab removes the row here without
  ever passing through this handler, leaving exactly the dangling reference the slice set out to
  prevent. Third appearance of the same shape: a repair or union handled at one call site and
  assumed at the other (S-03's cross-tab re-read, S-04's mount read).
- **Fix A ⭐ Recommended**: Clear `openedSavedId` wherever a record leaves `saved`
  - Strength: Fixes the class rather than the instance; any future removal path inherits it.
  - Tradeoff: The cross-tab refresh must compare before/after rather than blindly replacing.
  - Confidence: HIGH — S-04's handler has both lists in hand at that moment.
  - Blind spot: Neither slice is implemented, so S-04's refresh shape is still on paper.
- **Fix B**: Add an explicit cross-tab branch to this slice's delete section
  - Strength: Narrowest edit, contained in S-05.
  - Tradeoff: Leaves the general rule unstated, so the next removal path reintroduces the dangle.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — both the Critical Implementation Details entry and the delete
  contract now state the rule as a property of the *list*: wherever `saved` is replaced, clear
  `openedSavedId` if it is no longer present. Explicitly names the cross-tab route as the reason a
  handler-scoped rule is insufficient. New manual criterion 1.13.

### F2 — The dialog rename is obsolete twice over

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Contracts table, Key Discoveries, Phase 1 change 1, an automated criterion,
  Migration Notes, Progress 1.5, plus two criteria referring to "the dialog rename"
- **Detail**: Seven places described renaming `ConfirmDiscardCorrections.tsx` to
  `ConfirmDialog.tsx`, framed as "the confirmation dialog needs its third name". S-02's review
  named it `ConfirmDialog` with a generic prop surface from the start, and S-04's review removed
  its rename step — so there is no first rename, no second, and nothing to sweep. The criterion
  `grep -r "ConfirmRegenerate\|ConfirmDiscardCorrections" src` would have passed vacuously, and
  Progress 1.5 checked for two files that will never exist.
- **Fix**: Rewrite Phase 1 change 1 as a third call site; delete the dead criterion and Progress
  item; clean the contracts table, Key Discoveries, Implementation Approach and Migration Notes.
- **Decision**: FIXED — Phase 1 change 1 is now "Third call site for the confirmation dialog" and
  states no component change is required; dead criterion and Progress 1.5 removed with Phase 1
  renumbered; the two "after the dialog rename" criteria reworded to "alongside the new delete
  call site"; brief updated. `ConfirmDialog` is now described as the shared touch point across
  S-02, S-04 and S-05 — three call sites, one component.

### F3 — Lint criterion wording is stale after S-01's fix

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Both phases + Current State
- **Detail**: Four criteria/Progress lines read "Lint shows no non-CRLF errors". S-05 runs last of
  all, long after S-01's `.gitattributes`.
- **Fix**: Reword all four; replace the Current State bullet.
- **Decision**: FIXED.

### F4 — A pending delete can outlive its target

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 change 3 — pending-delete id
- **Detail**: The confirmation holds a pending-delete id until the GM confirms. If another tab
  deletes that merchant while the dialog is open, confirming calls `deleteMerchant` on a record
  already gone. F-01 specifies not-found behaviour for `updateSavedMerchant` but not for
  `deleteMerchant`, so the outcome was undefined — and it decides whether a spurious failure
  notice appears.
- **Fix**: Treat a not-found delete as success for UI purposes.
- **Decision**: FIXED — the delete contract now states that a not-found result refreshes the list
  and raises no notice, since the GM's intent was for the record to be absent and it is.

## Note on the review sequence

This was the sixth and last plan reviewed, and the pattern held to the end: **two of four findings
were staleness relative to upstream plans reviewed earlier** (F2, F3), both predicted after the
S-02 and S-04 reviews.

F1 is the more instructive one. The same defect shape — a discriminated union or a repair handled
at one call site and assumed at another — appeared in **three consecutive plans**: S-03's cross-tab
re-read, S-04's mount read, and S-05's delete. In each case the plan was internally coherent and
the gap only existed at a seam between slices. That is worth carrying into implementation as a
standing check rather than trusting it to be noticed: whenever state is mutated or a union is
consumed, ask which *other* path reaches the same state.
