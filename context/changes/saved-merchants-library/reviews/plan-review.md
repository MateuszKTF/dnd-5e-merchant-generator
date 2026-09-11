<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Biblioteka zapisanych kupców (S-04)

- **Plan**: `context/changes/saved-merchants-library/plan.md`
- **Mode**: Deep
- **Date**: 2026-09-11
- **Verdict**: REVISE → **SOUND** after fixes
- **Findings**: 0 critical, 5 warnings, 1 observation — all 6 fixed

## Verdicts

| Dimension | Before | After fixes |
|-----------|--------|-------------|
| End-State Alignment | PASS | PASS |
| Lean Execution | WARNING | PASS |
| Architectural Fitness | WARNING | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

Progress contract ✓, brief↔plan ✓. All source paths upstream-pending by design.
Verified that S-03 still has no `restoreFromMerchant`, so Phase 1's extraction is genuinely
needed and **not** stale — worth checking rather than assuming, given two neighbouring steps were.

Contract re-verified after all edits: 1 heading, 3/3 phase names, 34 criteria = 34 Progress
items, no checkbox leaks, zero remaining stale references.

## Findings

### F1 — Phase 1 change 1 is now redundant

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Current State, Phase 1 change 1, "What We're NOT Doing", Migration Notes, brief
- **Detail**: "F-01 has no operation for updating a saved record's contents" — no longer true.
  F-01's review added `updateSavedMerchant(id, patch)` with the identity-field constraint, the
  not-found-without-append rule and a Phase 2 test. This plan's Phase 1 change 1 duplicated it.
- **Fix**: Delete the change item; rewrite the Current State bullet; renumber; clean Migration
  Notes and the brief.
- **Decision**: FIXED — Phase 1 change 1 deleted and changes renumbered 1–3; Current State now
  records that F-01 provides the operation; the forward-only and scope bullets updated to "no
  storage operation and no schema field"; Migration Notes and brief rewritten.

### F2 — The dialog rename no longer exists to do

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Contracts table, Phase 2 change 3, an automated criterion, Migration Notes,
  Progress 2.5
- **Detail**: Five places described renaming `ConfirmRegenerate.tsx` to
  `ConfirmDiscardCorrections.tsx` and sweeping call sites. S-02's review named it `ConfirmDialog`
  with caller-supplied copy from the start, so there was nothing to rename — only a second call
  site to add. The criterion `grep -r "ConfirmRegenerate" src` would have passed vacuously, and
  Progress 2.5 checked for a file that never existed.
- **Fix**: Rewrite the change as "add a second call site"; delete the dead criterion and Progress
  item; fix the contracts table; clean Migration Notes and brief.
- **Decision**: FIXED — Phase 2 change 3 is now "Second call site for the discard guard" and
  states explicitly that no component change is required; dead criterion and Progress 2.5 removed
  with Phase 2 renumbered; all five references cleaned.

### F3 — Mount performs two reads with two failure paths

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 2, change 2
- **Detail**: "Populate `saved` from `listSaved()` on mount alongside S-03's restore." But S-03's
  mount already calls `readDocument()` and holds the whole `StorageDocument`, on which `saved` is
  a plain field. The separate call parses the same key twice and creates a second failure surface:
  when the mount read returns `quarantined`, `future-version` or `unreadable`, there is no
  sensible answer to what the sibling call returns or which wins. Same class of gap S-03's review
  closed for its cross-tab handler — one union, two call sites, one specified.
- **Fix A ⭐ Recommended**: Derive `saved` from S-03's single mount read
  - Strength: One read, one failure path, no reconciliation question; F-01's `StorageDocument`
    carries `saved` directly.
  - Tradeoff: Couples list population to S-03's restore effect, which must expose the document.
  - Confidence: HIGH.
  - Blind spot: Whether S-03's effect shape makes that awkward is unverified; neither is built.
- **Fix B**: Keep `listSaved()` and specify its failure handling
  - Strength: Keeps the two concerns independent.
  - Tradeoff: Two reads per mount, plus a which-wins rule that only exists because of the
    duplication.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — the contract now populates `saved` from S-03's mount read,
  explains why a sibling call has no sensible failure answer, and requires S-03's effect to expose
  the document. Cross-tab refresh now also gated on `ok`, matching S-03's post-review rule.

### F4 — Saving an opened merchant moves its row under the GM

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: `updateSavedMerchant` patch vs `sortForLibrary`
- **Detail**: The patch carries "a refreshed `savedAt`" and `sortForLibrary` orders newest first,
  so an in-place save re-sorts the list under the GM — the row they are looking at jumps to the
  top of a panel they may have scrolled. Never mentioned in the plan.
- **Fix**: Decide and record it.
- **Decision**: FIXED via "keep the refresh, state the movement" — `sortForLibrary`'s contract now
  says the row moves and why (freezing `savedAt` would make the column mean "first saved" and bury
  a just-edited merchant), and notes that the opened-row marking is what keeps it findable, so the
  two features must ship together. New manual criterion 3.13.

### F5 — Lint criterion wording is stale after S-01's fix

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: All three phases + Current State
- **Detail**: Six criteria/Progress lines read "Lint shows no non-CRLF errors". S-04 runs late,
  well after S-01's `.gitattributes`, so lint is a real gate with no caveat.
- **Fix**: Reword all six; replace the Current State bullet.
- **Decision**: FIXED.

### F6 — normalizeName's length cap is never given

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — `normalizeName`
- **Detail**: "caps length for layout" left the number to the implementer, and the "caps" test had
  no boundary to assert. Same class as F-01's unnamed `STORAGE_KEY` and S-02's unnamed price
  ceiling, both named during their reviews.
- **Fix**: Name it.
- **Decision**: FIXED — 60 characters, with the rationale (fits a long Polish shop name without
  wrapping a row at 360 px).

## Note on cross-plan effects

F1 and F2 were both **predicted** after the S-02 and F-01 reviews — those reviews pulled work
upstream and explicitly flagged that S-04 and S-05 would still describe it. Confirming and
clearing them here cost minutes; discovering them mid-implementation would have cost an
implementer a confused hour wondering why a rename target did not exist.

F3 is the more interesting one: it is the *same defect shape* S-03's review found in its cross-tab
handler — a discriminated union handled at one call site and assumed at another. That shape has
now appeared twice across two plans, which suggests checking it deliberately in S-05 rather than
hoping to notice it.
