<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Kontrakt encji kupca i trwałości w magazynie przeglądarki

- **Plan**: `context/changes/merchant-storage-contract/plan.md`
- **Scope**: Phase 1 of 3 — Entity and naming (commit `85f277a`)
- **Date**: 2026-09-12
- **Verdict**: NEEDS ATTENTION → **RESOLVED** (triaged 2026-09-12; 8 fixed, 1 skipped, 0 outstanding)
- **Findings**: 0 critical, 4 warnings, 5 observations

## Post-triage gate run (2026-09-12)

`npm run typecheck` 0 errors · `npm test` **334 passed** (was 320) · `npm run lint` exit 0 ·
`npm run build` complete, `dist/client/index.html` present.

**CI now runs the type check** (`npm run typecheck`, added between `astro sync` and `npm test`),
which is what makes the phase's compile-time contract load-bearing rather than documentary. The
contract also gained a key-exactness half, mutation-verified to catch the optional-field case that
previously passed with zero errors.

Fixed: F1 (CI gate + key-exact assertion), F2 (`crypto.randomUUID` fallback chain), F3 (correction
mappers moved into the module that owns them), F4 (shared `formatWallClock`), F5 (misleading test
name), F6 (invalid-date guard), F7 (`| undefined`, brought forward as blocking), F8 (`isMerchant` /
`isStoredRow`). Skipped by decision: F9 (`readonly` contracts).

**Carried forward:** F8's guards are exported and tested but not yet wired into
`merchant-storage.ts`'s `isStorageDocument` — that is a later slice's file and changes what happens
to a document that fails validation. Both manual rows (1.5, 1.6) remain unchecked.

## Review lens

Clean single-commit scope: `src/lib/merchant.ts` and `src/lib/merchant.test.ts` have no later commits and no uncommitted changes. Both are consumed today by six downstream modules, so the vocabulary this phase defined has been exercised rather than left theoretical.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

### What holds

Every planned export exists with the stated shape: `Merchant`'s eight fields, `savedAt: string | null` as the durable marker rather than a separate boolean, ISO strings rather than `Date`, `StoredRow`/`StoredCorrection`/`StoredCorrections` exactly as specified. `newMerchantId` is lazy — the module body contains only imports, types and function declarations, nothing executed at import. The phase guardrail holds completely: no `localStorage`, `window` or `document` reference anywhere, and no storage import.

**`autoName` avoids the trap this project has already been bitten by.** It builds from local date parts (`getDate`/`getMonth`/`getHours`) rather than `Intl`, so the string is byte-stable across Node, workerd and the browser — the exact hazard `format-price.ts:119-125` warns about and that L-04's sibling lesson concerns. Format is pinned to the character in tests.

**The test suite is unusually honest.** The "two saves in the same minute collide" case asserts `toBe` (collision), documenting the known limit rather than asserting a weaker inequality that would pass either way — it would fail the moment seconds entered the format. The aliasing test mutates a returned row and asserts the source is untouched. The fractional-price test pins `0.06` against mapper rounding. Each reaches a real assertion that breaks under a plausible mutation.

### Automated success criteria — re-run 2026-09-12

| # | Criterion | Result |
|---|---|---|
| 1.1 | `npm test` | PASS — 320 tests |
| 1.2 | `npx astro check` | PASS — 0 errors, 0 warnings |
| 1.3 | `npm run build` | PASS |
| 1.4 | `npm run lint` | PASS — exit 0 |

Both manual rows (1.5, 1.6) unchecked. Nothing rubber-stamped.

## Findings

### F1 — The phase's centrepiece guard is not in CI, and misses optional fields

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `.github/workflows/ci.yml:18-22`, `src/lib/merchant.test.ts:12, :29-30`
- **Detail**: The plan spends its longest passage on one safeguard: because the mappers are identity functions today, a round-trip test proves nothing, so the test file must carry a **compile-time assertion** that `StoredRow` and `AssortmentRow` stay mutually assignable — *"a future divergence then becomes a type error at the moment it is introduced."*

  The assertion itself is well built — a tuple-wrapped `MutuallyAssignable<A, B>` checking both directions, applied to both `StoredRow` and `UiRow`. Two problems sit around it, both verified empirically rather than reasoned about:

  **(a) Nothing in CI ever evaluates it.** `ci.yml` runs `npm ci`, `npx astro sync`, `npm test`, `npm run lint`, `npm run build`. It never runs `npx astro check`, and no `package.json` script invokes it either. I added `readonly attunement: boolean` to `AssortmentRow` — a hard divergence — and confirmed:

  | Command | Result with the guard actively firing |
  |---|---|
  | `npx astro check` | **6 errors**, incl. `merchant.test.ts:29:7 ts(2322): Type 'true' is not assignable to type 'never'` |
  | `npm test` | 320 passed ✅ |
  | `npm run lint` | exit 0 ✅ |
  | `npm run build` | Complete ✅ |

  Vitest transpiles without type-checking and `astro build` does not type-check `.ts`. So the guard fires only when a human runs `astro check` locally. The plan lists `npx astro check` under **Automated** Verification; CI does not honour that.

  **(b) It does not catch an optional field.** I added `readonly attunement?: boolean` instead: `astro check` reports **0 errors**. Both directions of assignability still hold — a missing optional property is assignable, and an extra optional property is assignable outside object-literal freshness — yet `toStoredRows` (which maps field by field, deliberately) would silently drop it on every save. Optional is the normal way a UI type grows, so this is the likely shape of the very divergence the guard exists to catch.

  Together: the plan's "silent data loss dressed as decoupling" scenario remains reachable, by the most probable route, with CI green.

  (Both mutations were reverted; `src/lib/assortment.ts` is byte-identical to its pre-test state, md5 verified, and `astro check` is back to 0 errors.)

- **Fix A ⭐ Recommended**: Put the type check in the gate — add `"typecheck": "astro check"` to `package.json` and `- run: npm run typecheck` to `ci.yml` after `astro sync`.
  - Strength: Makes the phase's primary safeguard actually load-bearing, and it is already green today so it costs nothing to turn on. Closes the same class for every other type in the project, not just this one.
  - Tradeoff: Adds ~30s to CI, and any future type error blocks the pipeline rather than being discovered locally.
  - Confidence: HIGH — verified that `astro check` passes cleanly right now, so enabling it does not surface a backlog.
  - Blind spot: Does not address (b); an optional field still slips through even with CI running the check.
- **Fix B**: Also close the optional-field hole by making the assertion key-exact — e.g. compare `keyof` sets, or assert `Exclude<keyof AssortmentRow, keyof StoredRow>` and its inverse are both `never`.
  - Strength: Catches the likely divergence shape, which (a) alone does not. Keeps the guarantee the plan actually wrote down.
  - Tradeoff: A more intricate type-level assertion to read and maintain; worthless on its own unless (a) is also done, since nothing would evaluate it.
  - Confidence: MEDIUM — the `keyof` approach is standard, but I have not written and run it here.
  - Blind spot: Key-exactness still would not catch a *type change* to an existing field (e.g. `priceGp: number` → `string`); the existing mutual-assignability check does catch that, so the two are complementary rather than alternatives.
- **Decision**: FIXED — both applied.

  **(a)** `"typecheck": "astro check"` added to `package.json`, and `- run: npm run typecheck` added to `ci.yml` between `astro sync` and `npm test`, with a comment recording *why* the three existing steps cannot see a type error. Verified green: `npm run typecheck` → 0 errors.

  **(b)** A `SameKeys<A, B>` conditional type added beside `MutuallyAssignable`, applied to both `StoredRow`↔`AssortmentRow` and `UiRow`↔`AssortmentRow`. Mutation-verified: the optional `readonly attunement?: boolean` that previously produced **0 errors** now fails on both key-exactness lines. `assortment.ts` restored byte-identical (md5 confirmed).

  The two checks are documented as complementary: `SameKeys` catches an added or removed key, `MutuallyAssignable` catches a changed type on a key that stays.

### F2 — `crypto.randomUUID()` is secure-context only, and the fallback is a total failure

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant.ts:90-92`
- **Detail**: The lazy call is right and its comment is accurate about Node 22 and workerd. The gap is the browser: `randomUUID()` is `[SecureContext]`, so on `http://192.168.x.x` — which is what `astro dev --host` serves — `crypto` exists but `crypto.randomUUID` is `undefined` and the call throws `TypeError`.

  The failure is total and mislabelled. `newMerchantId()` runs inside `draw()`'s `try`, so **every** Generate lands in the catch and shows "Coś poszło nie tak przy tworzeniu asortymentu." Nothing ever persists, and the message blames the assortment pool.

  This is not hypothetical for *this week*: the outstanding manual criteria across these slices require exactly that workflow — "the numeric keypad appears on a mobile device", "at 360 px on a real phone-sized viewport". A phone reaching the dev server over LAN http is the standard way to do that, and the product would appear completely broken.

  Production is HTTPS on Workers, so this is not a shipping defect — which is why it is a WARNING and not critical.
- **Fix**: Add a fallback chain inside `newMerchantId`: `typeof crypto?.randomUUID === "function"` → else `crypto.getRandomValues`-based v4 → else `Date.now().toString(36) + Math.random().toString(36).slice(2)`. These ids are local document keys, not security tokens, so a non-crypto last resort is acceptable — say so in the JSDoc, and add a test that stubs a `crypto` without `randomUUID`.
- **Decision**: FIXED — three-step chain implemented, with JSDoc stating both why the fallbacks exist (secure-context gating, and that a bare call turns every Generate into a mislabelled pool failure) and why degrading is acceptable (these ids name a row in this browser's storage; nothing authorises off them). The last resort is deliberately **not** UUID-shaped — `m-<base36>-<base36>` — so nothing downstream reads it as a guarantee it cannot make.

  Two tests added, stubbing `globalThis.crypto` and restoring it in `afterEach`. **The `getRandomValues` test needed proving, not just writing:** its regex matches any v4 UUID, so it would have passed vacuously had the stub silently failed and the real `randomUUID` been used. Mutation-verified — breaking the hex assembly fails exactly that test and nothing else, so the stub genuinely takes effect.

  Lint caught what inspection did not: the `bytes[6]!` non-null assertions were both forbidden *and* unnecessary (`noUncheckedIndexedAccess` is off, so the index is already typed `number`). Removed. 322 tests pass.

### F3 — The `StoredCorrections` mapper is missing, so it was written in a React component

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `src/lib/merchant.ts:9-10`, `:139-158`; `src/components/MerchantGenerator.tsx:179-193`
- **Detail**: The module header claims the row mappers "are the single place the two vocabularies meet." They are not — `merchant.ts` also owns `StoredCorrections` (`:59`) and ships no mapper for it.

  The consequence landed downstream: a later phase had to write `toStoredCorrections` **inside a React component**. It is a pure function sitting in `src/components/`, which is outside the Vitest glob (`src/**/*.test.ts`), so it is untestable where it sits — in a project that deliberately extracts pure logic into `src/lib` precisely so it can be tested. The reverse direction has no mapper at all: `MerchantGenerator.tsx` assigns `merchant.corrections` straight into UI state, safe today only because it is a fresh `JSON.parse` product.
- **Fix**: Move both directions into `merchant.ts` beside the row mappers and test them there. The phase boundary holds — they are pure.
- **Decision**: FIXED — `toStoredCorrections` moved out of `MerchantGenerator.tsx` into `merchant.ts`, and `fromStoredCorrections` written for the direction that never existed. The island now imports both; the adopt path no longer assigns a parsed storage object straight into UI state.

  The phase boundary is kept the same way `UiRow` keeps it: a structural `UiCorrection` / `UiCorrections` restatement rather than an import from `corrections.ts`, so the persisted format still does not depend on S-02's vocabulary.

  Five tests added — round-trip, an entry present but `undefined` dropped, an absent field staying absent (via `toStrictEqual`, the only form that distinguishes absent from present-and-undefined), a corrected `0` surviving, and non-aliasing in both directions. None of these could have existed while the function lived in `src/components/`.

### F4 — `pad2` and the wall-clock format are duplicated in a second module

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/merchant.ts:94-96, :114-115` and `src/lib/merchant-library.ts:255-284`
- **Detail**: `pad2` and the whole `DD.MM.YYYY, HH:MM` construction appear verbatim in `merchant-library.ts`, whose own JSDoc admits it: *"The same shape `autoName` builds."* Two copies of one user-visible format that must agree — auto-names and `savedAt` labels sit side by side in the same list, so a divergence is immediately visible to the GM. Phase 1 owns this vocabulary.
- **Fix**: Export `formatWallClock(when: Date): string` from `merchant.ts` (with F6's invalid-date guard) and compose both `autoName` and the library's label from it.
- **Decision**: FIXED — `formatWallClock(when: Date): string | null` exported from `merchant.ts`, which now owns the format. `autoName` composes from it, and `merchant-library.ts`'s `formatSavedAt` delegates to it; both private `pad2` copies and the duplicated construction are gone. All 330 tests still pass, so the delegation is behaviour-preserving.

  A test pins the two surfaces to each other directly — `autoName("kowal", when)` must equal `` `Kowal — ${formatWallClock(when)}` `` — so the thing that mattered (they agree character for character in the same list) is asserted rather than assumed.

### F5 — The type-contract test is vacuous at runtime while its name claims otherwise

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/lib/merchant.test.ts:37-44`
- **Detail**: The test is named *"keeps StoredRow, UiRow and AssortmentRow mutually assignable"*, but its body is `expect(storedMatchesAssortment).toBe(true)` where the const is literally `= true`. It cannot fail under `npm test`. Confirmed: with a live required-field divergence in the tree, this test passed green along with the other 319.

  The in-file comment is honest about this (the `expect` exists only to keep the consts referenced for lint), so this is not deception — but the name is what shows up in `npm test` output, and it reads as a guarantee the running test does not provide. This is L-03's shape, softened by the fact that the real assertion exists and works; it is the *reporting* that misleads.
- **Fix**: Rename to something like "keeps the type-contract assertions referenced (the real check is `astro check`)", so a green line does not overclaim.
- **Decision**: FIXED — renamed to "keeps the type-contract assertions referenced (the real check is `npm run typecheck`)", with a comment stating plainly that a green line here must not be read as the contract holding. The name now describes what the case does rather than what the file guarantees.

### F6 — `autoName` has no invalid-date guard, unlike its sibling

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant.ts:112-118`
- **Detail**: `autoName("kowal", new Date("x"))` returns `"Kowal — NaN.NaN.NaN, NaN:NaN"`, which would be persisted as the merchant's name. The sibling `formatSavedAt` (`merchant-library.ts:278-281`) has exactly that guard. Unreachable today — every caller passes `new Date()` — so this is a robustness note, not a live defect.
- **Fix**: Guard on `Number.isNaN(when.getTime())` and fall back to the bare label; folds naturally into F4's shared helper.
- **Decision**: FIXED as part of F4, exactly as the fix line predicted. The guard lives in the shared `formatWallClock`, which returns `null` for an unusable date, and `autoName` degrades to the bare label (`"Kowal"`) rather than persisting `"Kowal — NaN.NaN.NaN, NaN:NaN"`. Both behaviours are tested. One guard now serves both surfaces instead of only the library's.

### F7 — `StoredCorrections` lacks the `| undefined` its sibling documents

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/merchant.ts:59`
- **Detail**: `Record<string, StoredCorrection>` with no `| undefined`, while the sibling `CorrectionMap` (`corrections.ts`) has it and documents exactly why: `noUncheckedIndexedAccess` is off (tsconfig extends `astro/tsconfigs/strict`, not `strictest`), so without it TypeScript types every lookup as a present value. Nothing indexes a `StoredCorrections` today, so it is latent — but the first `doc.transient.corrections[itemId].priceGp` will type-check and throw at runtime.
- **Fix**: `Record<string, StoredCorrection | undefined>`, matching `corrections.ts`.
- **Decision**: FIXED — brought forward out of severity order because F3's fix made it **blocking**. `fromStoredCorrections` carries a real `if (!entry) continue;` guard (these documents come from `JSON.parse`), and ESLint flagged it as *"Unnecessary conditional, value is always falsy"* — correctly, because the declared type said entries are never undefined. The type was lying, and the choice was to make it honest or delete a guard that protects parsed data.

  Added `| undefined` with JSDoc giving both reasons: the latent `corrections[itemId].priceGp` that would compile and throw, and keeping the absence guard honest rather than dead. The change then forced three test-file type errors that were themselves papering over the same lie — fixed without non-null assertions (which this project forbids).

### F8 — `Merchant` is typed as trusted data but arrives from `JSON.parse`

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant.ts:72-81`
- **Detail**: Every field is declared required, but documents arrive from `JSON.parse` and — under AGENTS.md's forward-only storage rule — from older or hand-edited builds. `isStorageDocument` validates only `schemaVersion`, `saved` and `transient`, shallowly, so a `Merchant` with `rows: undefined` type-checks and reaches `fromStoredRows(rows)` → `rows.map` throws inside a render.

  The evidence that this is a real gap rather than a theoretical one: two downstream modules independently re-derived the missing check (`merchant-session.ts`, `merchant-library.ts`). The module that owns the shape should own its guard.
- **Fix**: Export an `isMerchant` / `isStoredRow` type guard from `merchant.ts`. A type guard is pure, so the phase boundary holds.
- **Decision**: FIXED — `isStoredRow` and `isMerchant` exported from `merchant.ts`, the module that owns the shape, with four tests including the `rows: undefined` case both downstream modules had each guarded against on their own.

  **Deliberately shallow on `rarity`, `category` and `wealth`** — validated as strings, not against the catalog's current membership. A tier or category this build does not recognise is exactly what the forward-only rule in `AGENTS.md` says to expect and preserve, so rejecting a whole merchant over one would discard a GM's saved work to enforce a vocabulary that is allowed to change. Two tests pin that: an unknown `category` and an unknown `rarity` both still pass.

  **Scope note:** the guards are exported and tested, but **not yet wired into `merchant-storage.ts`'s `isStorageDocument`**. That is a later slice's file and a broader behavioural change (it decides what happens to a document that fails validation), so it was left out one day before the deadline. The existing downstream `Array.isArray(merchant.rows)` checks were also left in place — they are now redundant with the guard but harmless, and removing them is the same wiring job.

### F9 — `StoredRow` fields are mutable where every sibling contract is `readonly`

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/merchant.ts:34-40, :47-50, :72-81`
- **Detail**: `StoredRow`, `StoredCorrection` and `Merchant` declare plain mutable fields, while `UiRow` (same file), `AssortmentRow` and `Correction` are all `readonly`. A caller can therefore mutate a row of a document that a later `writeDocument` will persist. The promote path is already protected by a `structuredClone`, so this is latent rather than live.
- **Fix**: Mark the three interfaces' fields `readonly` to match the siblings. Costs nothing — the mappers already build fresh objects.
- **Decision**: SKIPPED — conscious call. The exposure is latent (the promote path already `structuredClone`s), and `readonly` would break the two aliasing tests that deliberately mutate a `StoredRow` and a `StoredCorrection` to prove the mappers copy. Keeping those tests would mean casting the readonly away inside them, which weakens the guarantee it was supposed to add. Worth revisiting when the aliasing behaviour can be asserted some other way.

## Not findings

- **XSS / injection** — none. No markup is produced here; `autoName` interpolates a literal from `CATEGORIES` or the raw id, and React escapes text children. `astro/no-set-html-directive` is an error rule and `dangerouslySetInnerHTML` appears nowhere in `src/`.
- **Mapper aliasing** — clean, and tested. Both mappers build fresh objects field by field over five primitive fields; no shared nested reference, new array each call.
- **Entity migration-soundness** — good. `savedAt: string | null` rather than a boolean that could disagree with the timestamp, ISO strings rather than `Date`, optional fields only where absence is semantic, and denormalization of `name`/`rarity` justified against a real regeneration failure.
- **`UiRow` and the `?? category` label fallback** are exports the plan did not name, but both are how the plan's own instructions ("typed structurally so this module needs no import from S-01") were realised, and the fallback carries its own test. Not scope creep.
- **`autoName` local-time vs UTC `createdAt`** — a merchant created 00:30 CEST is named `11.09` and stamped `2026-09-10T22:30Z`. Correct for a browser-local product; worth a sentence of doc, not a change.

## Note on review method

Two findings in this report rest on claims one sub-agent made that I could not take at face value: it reported a *live* `attunement` divergence in `assortment.ts`, which was in fact a transient mutation made by the other agent running concurrently. I re-verified the tree independently (`grep`, `astro check`, md5) and re-ran both mutations myself with nothing else running. The false claim is excluded; F1(a) and F1(b) are what survived direct verification.
