<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Ręczne korekty, których nie da się zgubić (S-02)

- **Plan**: `context/changes/manual-item-corrections/plan.md`
- **Mode**: Deep
- **Date**: 2026-09-11
- **Verdict**: REVISE → **SOUND** after fixes
- **Findings**: 0 critical, 4 warnings, 2 observations — all 6 fixed

## Verdicts

| Dimension | Before | After fixes |
|-----------|--------|-------------|
| End-State Alignment | PASS | PASS |
| Lean Execution | WARNING | PASS |
| Architectural Fitness | WARNING | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

3/3 existing paths ✓, 4 upstream-pending paths ✓ (created by S-01, correctly declared as
contracts rather than code), radix claim ✓ (only `@radix-ui/react-slot` installed),
Progress contract ✓, brief↔plan ✓.

Contract re-verified after all edits: 1 `## Progress` heading, 3/3 phase names matching,
32 criteria = 32 Progress items, no checkbox leaks.

**Context:** this plan was written before F-01 and before S-01's own plan review. Three of the
six findings are staleness relative to plans that have since changed — a class of defect that
only becomes visible once the whole milestone is planned.

## Findings

### F1 — Dialog naming forces two renames in later slices

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 3, change 1 — `ConfirmRegenerate.tsx`
- **Detail**: This plan created `src/components/ConfirmRegenerate.tsx`. S-04's plan renames it
  to `ConfirmDiscardCorrections.tsx` and sweeps call sites
  (`saved-merchants-library/plan.md:291, :478`); S-05 renames it again to `ConfirmDialog.tsx`
  with caller-supplied copy (`merchant-search-and-delete/plan.md:68, :380`). Both downstream
  plans also carry a grep-for-stale-references criterion because of it. Three names for one
  component across three slices.
- **Fix A ⭐ Recommended**: Name it `ConfirmDialog.tsx` with caller-supplied copy now
  - Strength: Removes two renames, two call-site sweeps and two automated criteria from slices
    that already carry deadline exposure.
  - Tradeoff: One call site today, so this is generality ahead of need; props grow to
    title/body/confirmLabel/destructive.
  - Confidence: HIGH — both downstream plans are written and name the renames explicitly.
  - Blind spot: If S-04/S-05 are cut by the deadline, the generality never pays off.
- **Fix B**: Keep `ConfirmRegenerate.tsx`; let later slices generalize
  - Strength: Strict YAGNI, matching the project's convention elsewhere.
  - Tradeoff: Two renames stay on the critical path of S-04 and S-05.
  - Confidence: HIGH — costs fully enumerated in the two plans.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — renamed to `ConfirmDialog.tsx` with a generic prop surface
  (`open`, `title`, `body`, `confirmLabel`, `destructive`, `onConfirm`, `onCancel`), plus a
  rationale paragraph and a downstream note telling S-04/S-05 implementers to treat their
  rename steps as already satisfied. Brief updated.

### F2 — Phase 1 change 1 is now redundant work

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Current State, Phase 1 changes 1 and 4, Testing Strategy, Migration Notes, brief
- **Detail**: The plan stated `formatPrice` "as specified is insufficient… needs a small
  amendment to an S-01 module that has not been written yet". No longer true — S-01's plan
  review added `priceParts`, `partsToGp`, the round-trip invariant and its tests directly to
  S-01 Phase 1. This plan's Phase 1 change 1 and half of change 4 duplicated work that now
  arrives already done.
- **Fix**: Delete the redundant change item and test additions; rewrite the Current State
  bullet; renumber; update the brief.
- **Decision**: FIXED — Phase 1 change 1 deleted and remaining changes renumbered 1–2; the
  `format-price.test.ts (modify)` reference and both `priceParts` test bullets removed; Current
  State bullet, contract table row, Phase 1 overview, Migration Notes surface list and the brief
  all updated. `format-price.ts` is now consumed, not modified, by this slice.

### F3 — No labelling story for ~50 editable cells

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2, change 1 — `PriceQuantityCell`
- **Detail**: A 25-row table gains two number inputs per row. The plan specified styling, draft
  handling, `inputMode` and the corrected marker, but nothing about how each input identifies
  itself — a screen reader announces 50 anonymous spin buttons with no indication of which item
  or field. `eslint.config.js:83` enables `flat/jsx-a11y-recommended`, and S-04's plan does
  specify an accessible label for its delete button, so this plan was the outlier.
- **Fix**: Add an accessible-name prop to the cell contract and a manual verification criterion.
- **Decision**: FIXED — the cell contract now requires an accessible name combining row and
  field ("Cena — Bag of Holding"), supplied by the table since it is the only component that
  knows the item name. Also added: the corrected marker must not be conveyed by colour alone.
  New manual criterion 2.14 covers both.

### F4 — Lint criterion wording is stale after S-01's fix

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: All three phases + Current State (7 lines)
- **Detail**: Six criteria/Progress lines read "Lint shows no non-CRLF errors", and the Current
  State bullet said "Judge by non-CRLF errors only". S-01's review added `.gitattributes` +
  renormalize as its Phase 1 change 5, so by the time S-02 runs `npm run lint` passes cleanly.
- **Fix**: Reword all six; replace the Current State bullet.
- **Decision**: FIXED — all six now read "Linting passes: `npm run lint`"; the constraint bullet
  now records that S-01 normalizes line endings and that lint is a real gate here.

### F5 — Migration Notes claim a decision that F-01 has since made

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Migration Notes; "What We're NOT Doing"; brief risk list and decision table
- **Detail**: "This plan deliberately does not make that choice" — whether F-01 persists
  generated rows plus overlay, or the merged result. F-01's plan chose the former
  (`merchant-storage-contract/plan.md:191`). Leaving it phrased as open invites re-litigating a
  settled decision.
- **Fix**: Record F-01's decision and its consequence for this slice.
- **Decision**: FIXED — Migration Notes, the scope bullet, the brief's risk list and its
  decision table all now state that F-01 persists rows plus overlay, so the corrected-cell
  marker survives a reload once S-03 lands.

### F6 — clampPriceGp upper bound left to the implementer

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — `clampPriceGp`
- **Detail**: "an upper bound comfortably above the catalog's 21000 gp maximum" — the
  implementer had to invent a number, and the test "above the ceiling → null" could not be
  written without one. Every other bound in the plan was concrete.
- **Fix**: Name the ceiling explicitly.
- **Decision**: FIXED — range is now **0.01 gp to 999 999 gp** inclusive, with the rationale for
  both ends; the two test bullets now assert `999999` legal and `1000000` → `null`.

## Note on cross-plan effects

Two fixes reach outside this plan:

- **F1** deletes rename work from S-04 (Phase 2 change 3) and S-05 (Phase 1 change 1), along
  with their two grep criteria. Those plans still *describe* the renames; a note in this plan
  tells their implementers the steps are already satisfied. Re-reviewing S-04 and S-05 would
  clean up the descriptions.
- **F2** confirms S-01 now owns the price parts API, so `format-price.ts` has exactly one
  owning slice instead of two.
