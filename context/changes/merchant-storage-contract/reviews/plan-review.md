<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Kontrakt encji kupca i trwałości w przeglądarce (F-01)

- **Plan**: `context/changes/merchant-storage-contract/plan.md`
- **Mode**: Deep
- **Date**: 2026-09-11
- **Verdict**: REVISE → **SOUND** after fixes
- **Findings**: 1 critical, 4 warnings, 2 observations — all 7 fixed

## Verdicts

| Dimension | Before | After fixes |
|-----------|--------|-------------|
| End-State Alignment | PASS | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | WARNING | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

3/3 paths ✓, 3/3 symbols ✓, `crypto.randomUUID` available in Node ✓, brief↔plan ✓.
Progress contract ✓ — re-verified after all edits: 1 heading, 3/3 phase names matching,
22 criteria = 22 Progress items, no checkbox leaks.

## Findings

### F1 — Quarantine can fail, and the plan proceeds to destroy anyway

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3, change 2 — Corrupt payload quarantine
- **Detail**: The contract read "copy the raw string to a timestamped side key derived from
  STORAGE_KEY, then start a fresh document", with no branch for the copy failing. A full store
  is exactly what Phase 3 change 1 exists to detect, and a quarantine write is a *second* full
  copy of the payload — so it is more likely to hit quota than an ordinary write. On that path:
  parse fails → quarantine throws → "start a fresh document" overwrites the corrupt but possibly
  recoverable data. The guardrail failing in the one scenario the guardrail exists for.
- **Fix A ⭐ Recommended**: Quarantine must succeed before anything is overwritten
  - Strength: Makes the destructive step conditional on the preserving step, which is the
    invariant the whole slice claims; the detection code already exists in change 1.
  - Tradeoff: A GM with a full store *and* a corrupt document cannot use persistence until they
    intervene — a hard stop rather than a degraded start.
  - Confidence: HIGH — same DOMException Phase 3 change 1 already handles.
  - Blind spot: Whether a quota-exhausted store can hold even a small refusal marker is unverified.
- **Fix B**: Quarantine in memory for the session, then start fresh
  - Strength: The app always boots and the payload is retrievable during that session.
  - Tradeoff: "Preserved" then means until the tab closes, which is weaker than the plan's promise.
  - Confidence: MEDIUM.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — added `{ status: "unreadable" }` to the read union; the
  overwrite is now explicitly conditional on the quarantine copy succeeding; on failure the
  read-only latch engages and the corrupt bytes are left in place. Added a Phase 3 test (a fake
  that throws only on the quarantine key) and manual criterion 3.8. Desired End State updated.

### F2 — Module-level read-only latch will contaminate the test suite

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3, change 3 vs the Phase 2/3 test files
- **Detail**: The latch is a module-level flag — correct for production (one page load), but the
  storage object is injectable precisely so failure paths become unit tests, and Phase 3 adds the
  version-skew tests to the same file Phase 2 created. Vitest isolates module state per *file*,
  not per test, so the first test that latches refuses every write in every test after it and the
  suite silently becomes order-dependent.
- **Fix**: Give the latch an explicit test-only reset (or key it to the injected storage object),
  and require a `beforeEach` reset in the test contract.
- **Decision**: FIXED — added a paragraph specifying `resetReadOnlyLatch()`, why it exists, and
  that nothing in the app calls it.

### F3 — Operation set omits the one S-04 needs

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 2, change 1 — storage operations
- **Detail**: F-01 declared seven operations and shipped `renameMerchant` and `deleteMerchant`
  ahead of their consumers, but omitted `updateSavedMerchant(id, patch)` — which S-04's plan
  needs for save-in-place, and which S-04 therefore specifies adding to this module. The set was
  assembled from the PRD's FR list rather than from what downstream slices actually call, which
  is why two unused operations shipped and one needed operation did not.
- **Fix A ⭐ Recommended**: Add `updateSavedMerchant` here
  - Strength: F-01 becomes the single owning slice for the storage API — mirroring what S-01 did
    for `format-price` — and removes a cross-slice amendment from S-04.
  - Tradeoff: A third operation ships before its consumer exists.
  - Confidence: HIGH — S-04's plan specifies the signature.
  - Blind spot: If S-04 is cut, three operations go unused instead of two.
- **Fix B**: Leave it to S-04
  - Strength: Least code now.
  - Tradeoff: "F-01 owns the storage contract" stops being true the moment S-04 runs.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `updateSavedMerchant` added with its identity-field constraint
  and not-found-without-append rule, a matching Phase 2 test, and a rewritten scope bullet stating
  that F-01 ships the *complete* storage API so no later slice edits this module.

### F4 — The StoredRow / AssortmentRow split is asserted but not enforced

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1, change 1 — `toStoredRows` / `fromStoredRows`
- **Detail**: `StoredRow` is declared separately from S-01's `AssortmentRow` so the persisted
  format cannot drift — sound reasoning. But the two are specified identically, the mappers are
  "typed structurally so this module needs no import from S-01", and the only test is "round-trip
  without loss", which tests `StoredRow` against itself. Nothing connects the two types: if S-01
  later adds a field to `AssortmentRow`, an identity mapper drops it on save and no test fails.
  The decoupling is real; the *detection of divergence* was not.
- **Fix**: Add a compile-time assertion in the test file that the two types are mutually
  assignable, so divergence is a type error rather than silent data loss.
- **Decision**: FIXED — contract now requires the assertion (noting tests may import
  `AssortmentRow` even though the module may not), and both test lists carry it.

### F5 — Lint criterion wording is stale after S-01's fix

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: All three phases + Current State
- **Detail**: Six criteria/Progress lines read "Lint shows no non-CRLF errors" and the Current
  State bullet said to judge by non-CRLF errors only. S-01's review added `.gitattributes` +
  renormalize. **F-01-specific wrinkle:** this slice runs in *parallel* with S-01, so if F-01
  starts first the file has not landed and lint is still noisy — the plan needs to say so.
- **Fix**: Reword all six; rewrite the Current State bullet including the parallel-track note.
- **Decision**: FIXED — all six now read "Linting passes: `npm run lint`"; the constraint bullet
  states that whichever of F-01/S-01 starts first must land `.gitattributes`.

### F6 — STORAGE_KEY and the quarantine key are never named

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 change 1, Phase 3 change 2
- **Detail**: "one stable, namespaced key" and "a timestamped side key derived from STORAGE_KEY"
  left the implementer to invent both strings — for a value the plan itself calls stable and
  version-free, and which cannot be changed later without orphaning every GM's data. The manual
  steps also ask the reviewer to hand-edit "the key" in devtools without saying which.
- **Fix**: Name both explicitly.
- **Decision**: FIXED — `"dnd-merchant-generator"` and
  `"dnd-merchant-generator:corrupt:<ISO timestamp>"`.

### F7 — Test double lives in src/lib as an app module

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2, change 2
- **Detail**: The in-memory Storage fake sat in `src/lib/storage-fake.ts` "so the glob and the
  alias both reach it" — but neither actually requires that placement. The effect was a
  non-product module in the app's lib directory, typechecked and linted as production code, with
  nothing marking it test-only.
- **Fix**: Rename or co-locate.
- **Decision**: FIXED — renamed to `src/lib/storage-fake.test-helper.ts`; brief updated.

## Note on cross-plan effects

**F3 removes a cross-slice amendment from S-04.** Its plan (Phase 1, change 1) still describes
adding `updateSavedMerchant` to this module; that step is now pre-satisfied, leaving only the
call sites. This is the second such cleanup — S-02's review did the same for the dialog rename —
and both suggest re-reviewing S-04 and S-05 to strip steps that upstream slices now cover.

**F5's parallel-track note matters operationally.** F-01 and S-01 both claim Vitest setup
"whichever starts first", and `.gitattributes` now has the same property. Whoever begins
implementation should decide the order deliberately rather than discovering the overlap twice.
