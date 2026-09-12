<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Ręczne korekty, których nie da się zgubić

- **Plan**: `context/changes/manual-item-corrections/plan.md`
- **Scope**: Phase 1 of 3 — Correction logic and tests (commit `f30dd7b`)
- **Date**: 2026-09-12
- **Verdict**: NEEDS ATTENTION → **RESOLVED** (triaged 2026-09-12; 5 fixed, 1 documented, 0 outstanding)
- **Findings**: 0 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | At review | After triage |
|-----------|-----------|--------------|
| Plan Adherence | PASS | PASS |
| Scope Discipline | WARNING | PASS — `parseDraft` documented in the plan contract (F3) |
| Safety & Quality | WARNING | PASS — F1 guarded, F5 quantized, F6 documented |
| Architecture | PASS | PASS |
| Pattern Consistency | WARNING | PASS — `CP_PER_GP` has one owner (F4) |
| Success Criteria | WARNING | PASS — the vacuous float test now guards (F2) |

## Post-triage gate run (2026-09-12)

`npm test` 317 passed · `npx astro check` 0 errors · `npm run build` complete, `dist/client/index.html`
present · `npm run lint` exit 0.

Two fixes were mutation-verified rather than assumed green, per lesson L-03: reverting the F1 guard
to `value !== undefined` fails the new null-overlay test and only that test; reverting the price
comparison to raw floats now fails the F2 test, which passed under that same mutant before.

## Success criteria — re-run 2026-09-12

| # | Criterion | Result |
|---|---|---|
| 1.1 | `npm test` | PASS — 7 files, 314 tests |
| 1.2 | `npx astro check` | PASS — 0 errors, 0 warnings, 4 hints |
| 1.3 | `npm run build` | PASS — `/index.html` prerendered |
| 1.4 | `npm run lint` | PASS — exit 0 |
| 1.5 | `corrections.ts` makes the dirty-detection rule obvious | Substantiated — module JSDoc and `toCopper` state the rule explicitly |
| 1.6 | Clamp bounds justified by the catalog's real range | Substantiated — catalog scan confirms min `0.01` gp, max `21000` gp, matching the comment at `corrections.ts:47-55` |

Both manual rows were ticked in the same commit that introduced the code, but each is a code-reading
criterion whose evidence is in the diff and independently checkable — 1.6 was re-verified against
`src/data/items.generated.ts`. Not treated as rubber-stamping.

## Findings

### F1 — `isCorrected` and `mergeCorrections` disagree on a null overlay field

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/corrections.ts:88-89` and `src/lib/corrections.ts:109-110`
- **Detail**: The merge path is nullish-tolerant, the dirty path is not:

  ```ts
  quantity: correction.quantity ?? row.quantity,                                    // :88
  quantity: correction.quantity !== undefined && correction.quantity !== row.quantity, // :109
  ```

  For an overlay entry of `{ quantity: null }`, `??` falls back to the generated value so the table
  renders the generated number — while `isCorrected` evaluates `null !== undefined` → true and
  `null !== 4` → true, marks the cell corrected, and `hasCorrections` returns true. The FR-006
  confirmation dialog then fires over a shop where nothing visibly differs, permanently, because no
  edit the GM can make will clear it. The same split hits wrong-typed values: `{ priceGp: "15" }`
  coerces through `Math.round("15" * 100)` and reads clean, while `{ quantity: "2" }` merges a string
  into a field typed `number` and stays dirty forever.

  This is the exact failure the guardrail exists to prevent, inverted: a dialog that fires on a clean
  list is how a confirm dialog becomes something people click through blindly — the plan's own
  rationale for integer-copper comparison.

  No code path writes `null` today (`onCommit` only ever passes a validated `number`), so this is
  latent rather than live. But it is reachable from storage: `MerchantGenerator.tsx` feeds
  `merchant.corrections` straight from a `JSON.parse`d document, and `isStorageDocument`
  (`src/lib/merchant-storage.ts:221-233`) validates only `schemaVersion`, `saved` and `transient` —
  it never inspects correction values. Under the forward-only browser-storage rule in `AGENTS.md`, a
  hand-edited or future-format document delivering a null is not hypothetical.

- **Fix A ⭐ Recommended**: Guard `isCorrected` on the value being a finite number, so any malformed overlay field reads as "not corrected" rather than "eternally corrected".
  - Strength: One function, two lines, inside the module under review; `corrections.ts` is the shared touch point for S-02, S-04 and S-05, so hardening it covers every present and future caller. Fails safe — a corrupt overlay yields no dialog rather than an inescapable one.
  - Tradeoff: The bad value still merges through `mergeCorrections`, so `AssortmentRow`'s `number` typing remains nominally violated; it just no longer has a visible consequence.
  - Confidence: HIGH — behaviour traced by hand through both functions and confirmed against the merge/compare asymmetry in the source.
  - Blind spot: Does not stop a malformed value from being written back out on the next save.
- **Fix B**: Validate correction values at the storage boundary in `merchant-storage.ts`'s `isStorageDocument`.
  - Strength: Fixes it at the source — nothing malformed enters the app at all, and the document validator is where shape validation already lives.
  - Tradeoff: Touches a later slice's file, outside this change's scope; leaves `corrections.ts` still asymmetric for any non-storage caller.
  - Confidence: MEDIUM — the validator is the right place, but the per-merchant validation depth there has not been reviewed as part of this phase.
  - Blind spot: Haven't checked what a rejected document does to an existing saved merchant — it may discard more than the bad field.
- **Decision**: FIXED via Fix A — `isCorrected` now guards both fields through an `isOverride` type predicate (`typeof === "number" && Number.isFinite`), so a `null` or wrong-typed overlay field reads as absent, matching `mergeCorrections`. A regression test was added at `corrections.test.ts` covering `{ quantity: null, priceGp: null }`; mutation-verified — reverting the guard to `value !== undefined` fails that test and only that test. `npm test` 315 passed, `astro check` 0 errors, `npm run lint` exit 0.

### F2 — Plan-mandated float-equality test does not exercise float equality

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/lib/corrections.test.ts:99-106`
- **Detail**: The plan names this case explicitly: "a 0.5 gp row whose correction round-trips through
  `sp` is not dirty". The test's own comment claims "Float equality would call this dirty" — it would
  not. `priceParts(0.5)` returns `{ value: 5, unit: "sp" }` and `partsToGp(5, "sp")` is `5 / 10`,
  which is exactly `0.5`, so raw float comparison passes it too. Mutation-tested: replacing the
  integer-copper comparison with `correction.priceGp !== row.priceGp` leaves this test green.

  This is lesson **L-03** ("a test that never reaches the code under test passes") recurring in the
  same project. The behaviour itself is genuinely covered — two *unplanned* tests the implementer
  added do catch the mutant (`:107-121`, `3 * 1.2 === 3.5999999999999996` retyped as `3.6`, guarded
  by `expect(retyped).not.toBe(generated)` so the fixture is provably non-trivial; and `:122-127`,
  `0.01 * 1.2` retyped as 1 cp), as does `:128-131`. So the risk is nil and the gap is in the plan's
  chosen example, not in coverage. What is left is a test that reads as a guarantee and is not one.
- **Fix**: Re-point `:99-106` at a value whose `sp` round-trip is not bit-exact (or delete it, since `:107-121` already covers the case), and correct the misleading comment.
- **Decision**: FIXED — re-pointed at `0.75 * 1.2 === 0.8999999999999999`, which displays as `9 sp` and returns from the field as exactly `0.9`. Added the `expect(retyped).not.toBe(generated)` guard the sibling test at `:107-121` already uses, so the fixture proves its own non-triviality, and rewrote the comment to say why `ROWS[1]`'s flat `0.5` gp would not do. Mutation-verified: under a raw-float comparison this test now fails (it passed before the change), alongside the three that already caught it.

### F3 — `parseDraft` shipped but absent from the plan's contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/lib/corrections.ts:162-165`
- **Detail**: The plan's Phase 1 "Changes Required" enumerates six exports; `parseDraft` is a seventh.
  It exists to repair a genuine flaw in the plan's own contract: `clampQuantity(n: number)` was
  required to return `null` for "empty", a string condition a `number` parameter cannot express,
  because `Number("")` is `0` and `0` is a legal quantity. Splitting the text-to-number step out is
  the right call — the alternative was widening the clamp signature.

  It is pure, three lines, tested (`:169-184`), and consumed correctly at both call sites
  (`MerchantTable.tsx:95` and `:111` both compose `clampQuantity(parseDraft(draft))`). No guardrail
  is breached. The issue is bookkeeping: `plan.md` was edited in commit `f30dd7b`, but only to tick
  success-criteria checkboxes — the contract was never updated, so the plan and the shipped API
  disagree on the export list, and the next review reads the plan as ground truth. A residual risk
  rides along: the empty-field guard now lives *outside* the clamp, so a future caller writing
  `clampQuantity(Number(text))` silently turns a cleared field into "shelf cleared".
- **Fix**: Add `parseDraft` to the Phase 1 contract in `plan.md` as an addendum noting why the clamp signature could not absorb it, and add a `{@link parseDraft}` cross-reference to `clampQuantity`'s own JSDoc so the composition requirement is visible at the function, not only in the prose above it.
- **Decision**: FIXED — `plan.md` Phase 1 contract now carries a dated addendum documenting `parseDraft`, why the clamp signature could not absorb the empty case, and the requirement that callers compose the two. `clampQuantity`'s JSDoc now states the same at the function, so the trap is visible on hover rather than only in the module prose.

### F4 — `CP_PER_GP` duplicated across the two modules coupled by it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/corrections.ts:44` and `src/lib/format-price.ts:25`
- **Detail**: Both modules declare a private `const CP_PER_GP = 100`. These two files are coupled
  precisely *by* that grid — `corrections.ts` compares in copper, `format-price.ts` converts in
  copper, and `corrections.test.ts` round-trips one through the other to assert they agree. A silent
  divergence would break every round-trip with no compile error and no failing type check.
- **Fix**: Export `CP_PER_GP` from `format-price.ts` — the owner of the coin scale — and import it in `corrections.ts`.
- **Decision**: FIXED — `CP_PER_GP` is now exported from `format-price.ts` with a JSDoc naming the invariant and the symptom of drift (a dialog firing over an uncorrected shop); `corrections.ts` imports it and its private copy is gone. One constant, one owner.

### F5 — `clampPriceGp` does not quantize to the copper grid it is compared on

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/corrections.ts:188-192`
- **Detail**: `clampPriceGp` range-checks and returns `gp` unchanged — the only function in the module
  that does not speak in whole copper. With `step="any"` on the price input, sub-copper input commits
  as typed. Typing `5.05` into an `sp` field stores `0.505` gp while the field immediately redisplays
  `5.1`: the number stored is not the number shown. Typing `5.004` on a generated `0.5` gp row stores
  `0.5004`, which rounds to the same 50 cp, so the cell reads clean and a later regenerate discards it
  with no confirmation.

  Both divergences are below 1 cp and the copper grid is documented as the source of truth, so this is
  defensible as designed and the plan did not ask for quantization. Worth knowing because F-01
  persists raw `priceGp`.
- **Fix**: `return Math.round(gp * CP_PER_GP) / CP_PER_GP;` after the range checks, so the value stored, displayed and compared is one number.
- **Decision**: FIXED — `clampPriceGp` now quantizes to whole copper after the range checks, with JSDoc naming both symptoms (a stored value that differs from the displayed one, and a sub-copper edit silently discarded on regenerate). Two tests added: one asserting the quantization (`5.05 sp → 0.51 gp`, `0.5004 → 0.5`, `3 * 1.2 → 3.6`), one pinning the check-then-round order so `0.004` and `999999.4` still return `null` rather than being rounded into range.

### F6 — Bare index access on `CorrectionMap` resolves prototype keys

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/corrections.ts:81` and `src/lib/corrections.ts:123`
- **Detail**: `corrections[row.itemId]` on a plain `Record` means an `itemId` of `"toString"`,
  `"constructor"` or `"__proto__"` resolves to an inherited `Object.prototype` member instead of
  missing. Blast radius traced and benign: the inherited value is truthy, so `mergeCorrections` skips
  its `return row` fast path and rebuilds an identical object (values unchanged, only referential
  identity lost), and `isCorrected` reads `undefined` for both fields, so dirty detection stays
  correct. The write path is safe too — a computed key in an object literal creates an own property
  and never invokes the `__proto__` setter.

  Not reachable in practice: all 160 catalog ids are kebab slugs from the generated SRD catalog, none
  colliding with a prototype member. Raised only because the module's JSDoc at `:32-38` reasons
  explicitly about key safety and covers uniqueness but not prototype keys.
- **Fix**: Either `Object.hasOwn(corrections, row.itemId)` at the two lookups, or one sentence in the existing key-safety JSDoc block. No change required for correctness.
- **Decision**: DOCUMENTED — no code change. The `CorrectionMap` JSDoc now records the prototype-key case alongside the uniqueness guarantee it already reasons about: why it is harmless, why it is unreachable while ids are generated SRD slugs, and the trigger for revisiting (`Object.hasOwn` at both lookups) if ids ever become GM-nameable.
