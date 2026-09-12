<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Pierwszy wygenerowany asortyment — Phase 1

- **Plan**: `context/changes/first-generated-assortment/plan.md`
- **Scope**: Phase 1 of 3 — "Domain rule and test harness" (commit `020c671`)
- **Date**: 2026-09-12
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 7 warnings · 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

**Automated verification (re-run at HEAD `8fe687d`):** `npm test` 279/279 pass · `npx astro check` 0 errors · `npm run lint` exit 0 · `npm run build` complete. All four Phase-1 automated criteria hold.

**Plan adherence note:** every numeric contract was verified literally — all 15 `WEALTH_CONFIG` values, the three `QUANTITY_BANDS`, the spill preference table row-for-row, zero-share tier ineligibility (quota *and* spill destination), the typed error class, the three price thresholds, the vitest `include` glob, and the `npm test` position in CI. All MATCH. All eight Phase-1 files are byte-identical at HEAD despite 30 later commits.

## Findings

### F1 — Manual criterion 1.6 is checked, but the run it certifies produced implausible assortments

- **Severity**: WARNING
- **Impact**: HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Success Criteria
- **Location**: `context/changes/first-generated-assortment/plan.md` Progress 1.6; `src/lib/assortment.ts:53-74`
- **Detail**: Criterion 1.6 reads "Scratch run of all 12 (category, wealth) pairs produces plausible assortments" and is marked `- [x] — 020c671`. The project's own `context/foundation/lessons.md` L-01 records what that run actually produced: a `nędzna` settlement stocking **84 720 gp** of `przedmioty-magiczne` (including 4x Belt of Hill Giant Strength at 5760 gp each) and 34 897 gp at the alchemist. The rarity proportions are exact; the absolute values are not defensible. L-01 itself names this "the most serious known threat" to the PRD's primary success criterion ("8 of 10 GMs accept the assortment without manual edits"). A criterion whose text says "plausible" is checked complete against evidence that says "not plausible".
- **Fix A (Recommended)**: Leave the code as is; change the checkbox to reflect reality — mark 1.6 as met-with-exception and link L-01 from the Progress line, so the next reader sees the accepted gap instead of a clean tick.
  - Strength: Zero code risk, and it restores the Progress section as an honest record — which is the one thing `/10x-archive` and future reviews read. L-01 already documents the decision and its three candidate fixes, so nothing is lost.
  - Tradeoff: The underlying product gap stays open; the north-star criterion remains at risk until a later slice closes it.
  - Confidence: HIGH — the acceptance is already written down and dated; this only aligns the checkbox with it.
  - Blind spot: Whether the deadline actually permits shipping with this gap is a product call, not one this review can make.
- **Fix B**: Implement L-01's cheapest candidate now — make quantity price-sensitive so expensive items appear 1-2 at a time rather than 4.
  - Strength: Attacks the largest single contributor (4x a 5760 gp belt is 23 040 gp of the 84 720) without touching the rarity rule the PRD settled in Open Question #3.
  - Tradeoff: Changes `QUANTITY_BANDS` semantics, which Phase 1 tests pin and which S-02's correction logic reads; it reopens a settled contract mid-slice.
  - Confidence: MEDIUM — the arithmetic is obvious, but nobody has checked the effect on the other 11 pairs.
  - Blind spot: Not verified whether `bogata` lists become too thin once quantities drop.
- **Decision**: FIXED via Fix A — plan.md Progress 1.6 now records the exception and links lessons.md L-01.

### F2 — The seeded-rng sweeps explore exactly one row count, so the quota-residual branch is never tested

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `src/lib/assortment.test.ts:24-30`, `:56`, `:115`, `:127`
- **Detail**: `seeded()` is an LCG whose increment dominates for small seeds, so the first value — the one that picks `size` — barely moves: seeds 1..50 yield 0.23646..0.25545. Consequences, all probe-verified: the 50-seed `nędzna` sweep at `:115` draws size 11 every time; the 20-seed spill sweep at `:127` returns the byte-identical draw `{pospolite:6, niezwykłe:5, rzadkie:0}` twenty times; the 12-pair invariants block at `:56` (seed 12345, first value 0.02040) always draws the **band minimum** (10/14/18). The residual-correction branch at `assortment.ts:167-174` only fires at sizes 15, 19, 21 and 22 — none of which any test reaches. `assortment.ts:49-51` claims the mix is "feasible at the top of every size band"; the top of the band is never drawn. The line meant to guard the quota sum, `:82` `expect(counts.pospolite + counts.niezwykłe + counts.rzadkie).toBe(rows.length)`, is a tautology — `countByTier` bins every row into exactly one bucket, so it holds regardless of what the quotas did.
- **Fix A (Recommended)**: Spread the seeds (`seeded(s * 2654435761)`) and add explicit cases at sizes 15/19/21/22; replace the tautology at `:82` with an assertion that the row count equals the size the rng selected.
  - Strength: Keeps the existing structure and the existing rng helper, and turns three sweeps that are one case each into sweeps that are actually 50/20/12. Directly exercises the only non-trivial arithmetic in the module.
  - Tradeoff: Widening the seed spread may surface a genuine failure at band-top sizes — which is the point, but it turns a green suite red until resolved.
  - Confidence: HIGH — probes confirmed both the collapse and which sizes trigger the branch.
  - Blind spot: Not verified that every category has the depth to satisfy band-top quotas; the plan asserts it, the tests never checked it.
- **Fix B**: Make `size` injectable via `GenerateOptions` and drive the sweeps off it directly instead of through the rng.
  - Strength: Removes the coupling between "which seed" and "which size" entirely, so the test says what it means.
  - Tradeoff: Widens the public option surface further — the same objection already raised against `pools` in F9.
  - Confidence: MEDIUM — clean, but it trades a test problem for an API problem.
  - Blind spot: Whether S-02/S-03 would start depending on an injectable size.
- **Decision**: FIXED via Fix A — seeded() now hashes the seed; new "quota allocation at pinned sizes" block covers sizes 15/19/21/22 and every band top; the tautology is replaced by a row-count-equals-drawn-size assertion. Mutating `quotas[largest] += residual` now kills 24 tests (it killed none before).

### F3 — An unknown category or wealth escapes as a raw TypeError, bypassing the typed-error path

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/assortment.ts:123-124`
- **Detail**: `const config = WEALTH_CONFIG[wealth];` and `const pool = pools[category];` are unguarded index reads. Probe: an unknown id throws `TypeError: Cannot read properties of undefined (reading 'length')`. This mattered less in Phase 1 than it does now — `src/components/MerchantGenerator.tsx:875` branches on `cause instanceof AssortmentPoolError` to choose the user-facing message, and `merchant-session.ts` exists precisely because these values round-trip through `JSON.parse` of `localStorage`. A hand-edited or downgraded stored document carrying a retired category id therefore takes the un-branded branch and misses the intended error UI.
- **Fix A (Recommended)**: Validate both inputs at the top of `generateAssortment` and throw `AssortmentPoolError` — reusing the existing `isKnownCategory` / `isKnownWealth` guards.
  - Strength: Fixes it at the source, so every present and future caller inherits the branded error; the error class and the catch site already exist, so nothing new is introduced.
  - Tradeoff: The rule takes on input validation that the type system nominally already provides — a few lines of "impossible" code.
  - Confidence: HIGH — the guards exist, the call site already discriminates on the class.
  - Blind spot: Have not checked whether any caller currently relies on the raw TypeError propagating.
- **Fix B**: Validate at the storage boundary instead, in `merchant-session.ts`, so nothing invalid ever reaches the rule.
  - Strength: Keeps the domain rule free of defensive code and puts the check where untrusted data actually enters.
  - Tradeoff: Any future entry point has to remember to validate; the rule stays unsafe by itself.
  - Confidence: MEDIUM — depends on `localStorage` remaining the only untrusted source.
  - Blind spot: Not audited whether every read path already funnels through that module.
- **Decision**: FIXED via Fix A, with one deviation — validated against WEALTH_CONFIG and the pools record rather than importing isKnownCategory/isKnownWealth, because that would make the pure rule depend on a storage-adjacent module. Same branded outcome; two regression tests added.

### F4 — `formatPrice` clamps negative, NaN and Infinity down to "1 cp"

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/format-price.ts:34`
- **Detail**: `const safe = Number.isFinite(gp) ? Math.max(gp, MIN_GP) : MIN_GP;` — probe output: `-5` renders "1 cp", `-0.01` renders "1 cp", `NaN` renders "1 cp", `Infinity` renders "1 cp". Clamping downward is the worst available direction: the GM is shown a definite, plausible, tiny price where the truth was "wrong" or "unbounded". The plan's requirement was "never render 0", and this satisfies it — but it also silently launders bad input into good-looking output. `src/components/MerchantTable.tsx:68` feeds this from `generated.priceGp`, which S-02 subsequently made GM-editable. The existing tests at `format-price.test.ts:37-40` only assert `> 0`, which a wrong answer satisfies; there is no negative-input test at all.
- **Fix A (Recommended)**: Keep the 1 cp floor for small positive values; return a distinguishable marker for negative or non-finite input, and add those cases to the suite.
  - Strength: Preserves the contract the plan actually asked for while making bad data visible instead of plausible. The floor logic stays in the one place the plan required.
  - Tradeoff: Callers must tolerate a non-numeric string; `priceParts` and `partsToGp` need a decided answer for the same inputs so the trio stays consistent.
  - Confidence: MEDIUM — the change is small, but it touches the contract S-02's editing path parses back.
  - Blind spot: Have not traced whether any S-02 code path would render the marker into an editable input.
- **Fix B**: Leave the formatter and reject the input upstream in `clampPriceGp`, treating a negative price as a validation failure at the edit boundary.
  - Strength: Keeps the formatter total and the display layer dumb; validation lives where the user types.
  - Tradeoff: Generated (non-edited) prices are still unguarded, and a future data:build producing a negative price would render "1 cp" silently.
  - Confidence: MEDIUM — covers the S-02 path but not the catalog path.
  - Blind spot: Not verified what `clampPriceGp` currently does with a negative.
- **Decision**: FIXED via Fix A — added isRenderablePrice() and UNRENDERABLE_PRICE; formatPrice returns the marker for negative/NaN/Infinity. Two tests added.

### F5 — Three tests do not reach the code they name (recurrence of lesson L-03)

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/lib/assortment.test.ts:182-189`, `:162-165`, `:75-83`
- **Detail**: (a) `:182-189` "can still fill a tier the recent list covers entirely" asserts only `rows.length >= 18`. Probe: with the rare tier made entirely unavailable — exactly what a recency *filter* would do — the draw still returns 19 rows, because spill refills from the 40-deep tiers. The mutation this test exists to catch does not break it. Its own comment claims the case needs all ten rare items; `seeded(5)` gives size 19, so the rare quota is 7. (b) `:162-165` names the spill-exhaustion throw at `assortment.ts:222` but its 6-item pool trips the earlier pre-flight throw at `:127` first; `.toThrow(AssortmentPoolError)` cannot tell them apart. (c) `:75-83` applies its ±1 mix tolerance to the zero-share tier too, so under `nędzna` it would accept one rare item — the guarantee survives only because of the separate test at `:113`. This is the same class of defect L-03 was written about, in the same file.
- **Fix**: Assert tier composition rather than row count at `:182-189` (`expect(countByTier(rows).rzadkie).toBe(7)`), assert on the message at `:162-165` to distinguish the two throws, and special-case the zero-share tier at `:75-83` with `expect(counts[tier]).toBe(0)`.
- **Decision**: FIXED — recency test now pins size 25 and asserts all ten rare items are drawn (a true filter mutation now kills it); the two throws are distinguished by message and the spill-exhaustion case gets its own test; the zero-share tier is asserted exactly 0.

### F6 — `randomInt` overruns its band if an injected rng returns exactly 1

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/assortment.ts:268`
- **Detail**: `return min + Math.floor(rng() * (max - min + 1));` assumes `rng()` is `[0,1)`, but `GenerateOptions.rng` at `:110-111` documents only "Injectable for deterministic tests" — the half-open requirement is written nowhere. Probe with `rng = () => 1`: 26 rows for `bogata` (band max 25), `pospolite` quantity 13 (max 12), `niezwykłe` 5 (max 4), and `rzadkie` 2 — breaking the "exactly one of any rare item" invariant the suite asserts at `:93` and the "no 7x Amulet of the Planes" promise at `:80-84`. `Math.random` never returns 1, so production is safe; the exposed test seam is not.
- **Fix**: Document `[0, 1)` on the `rng` option and clamp defensively — `Math.min(max, min + Math.floor(rng() * (max - min + 1)))`.
- **Decision**: FIXED — randomInt clamps to max, the [0,1) contract is documented on the rng option, and a degenerate-rng regression test was added.

### F7 — `AGENTS.md` contradicts the code this phase landed, and still does at HEAD

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `AGENTS.md:13`, `AGENTS.md:38`
- **Detail**: Line 38 states "No test framework is configured, so there is no `npm test`" — this phase added Vitest, `test`, `test:watch` and a CI step. Line 13 states `npm run lint` is unusable and "there is no `.gitattributes`", instructing readers to "judge lint by non-CRLF errors only" — this phase added `.gitattributes`, and lint now exits 0 (verified this session). `.gitattributes:5` even says "See AGENTS.md; this file is what makes that note obsolete" while the note stays in place. `AGENTS.md` is the first file every agent reads, so both lines actively mislead: one hides a working gate, the other denies a working test runner. A third convention is simply unrecorded — `src/lib/assortment.ts:28-34` throws `AssortmentPoolError` while `src/lib/merchant-storage.ts:4-9` declares "Nothing here throws. Every read and every write answers with a discriminated union." The split is defensible (invariant violation vs. expected I/O failure) but nothing tells the next module which to follow.
- **Fix**: Correct `AGENTS.md:13` and `:38` to state that `.gitattributes` and `npm test` exist and that lint is a real gate, and add one line recording when to throw versus when to return a discriminated union.
- **Decision**: FIXED — AGENTS.md:13 now states lint is a real gate and .gitattributes exists; the commands section documents npm test; a new hard rule records throw-vs-discriminated-union.

### F8 — Latent correctness edges in the draw: identity de-dup, a dead clamp, an unchecked share sum

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/assortment.ts:243`, `:171-173`, `:159-177`
- **Detail**: (a) `:243` `candidates.filter((item) => !picked.includes(item))` de-duplicates by **object reference**, so FR-004 ("every row is a distinct item") rests on `ITEM_POOLS` never holding two objects with the same `id` — and that file is regenerated by `npm run data:build`. Verified clean today: 160 ids, zero duplicates, and zero duplicate *names* either. `corrections.ts` keys its `CorrectionMap` by `itemId` and warns in its own docstring that corrections would leak between rows with no visible symptom if the guarantee weakened. (b) `:171-173` the comment promises "clamp and push the difference back onto the largest share" but the code only clamps; if it ever fired, quotas would no longer sum to `size` and the draw would silently return the wrong row count. Unreachable today (|residual| <= 1, largest quota >= 3) — dead code with a comment that lies. (c) `allocateQuotas` assumes the eligible shares sum to 1 and never checks; all three rows do today, but a future row summing to 0.9 would dump the difference onto one tier and, per F2, no test would notice.
- **Fix**: Key de-duplication off `item.id` via a `Set`, delete the dead clamp and its comment, and add a one-line test asserting every `WEALTH_CONFIG` row's eligible shares sum to 1 within an epsilon.
- **Decision**: FIXED — de-duplication is keyed by item.id via a Set (twins within a tier collapse too), the dead clamp and its inaccurate comment are deleted, and a WEALTH_CONFIG share-sum test was added.

### F9 — Undeclared `pools` option and pre-flight throw; normalization not split into its own commit

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/lib/assortment.ts:107-114`, `:127-131`; commit `020c671`
- **Detail**: The plan specified `opts?: { recentIds?; rng? }`. The code adds a third member, `pools?: Record<CategoryId, readonly CatalogItem[]>` (`:113`), used only by tests (`assortment.test.ts:126,147,187`) — a public widening of a contract surface for a test seam, though the plan's own demand for synthetic-pool tests made some injection necessary. There is also a second, earlier throw at `:127-131` (`pool.length < size`) that the plan did not describe; same error type, defensible guard, but it is what makes F5(b)'s test ambiguous. Separately, the plan said `.gitattributes` "must land as its own commit, separate from the domain rule, so the rule's diff stays reviewable" and "land this first in the phase" — it landed inside `020c671` with everything else. The stated risk did not materialise: the blobs were already LF in the object store, so `git add --renormalize .` was a genuine no-op and the commit is 13 files, not the predicted repo-wide churn. `.gitattributes:8-15` also adds binary rules for images and fonts that the plan did not mention — benign and arguably correct.
- **Fix**: Document `pools` and the pre-flight throw in the plan as an addendum, or mark `pools` `@internal`; no code change warranted for the commit-splitting deviation.
- **Decision**: FIXED — `pools` marked @internal, and a `## Addenda` section in plan.md records the option, the pre-flight throw, the extra .gitattributes binary rules, and the unfollowed commit-splitting instruction.

### F10 — `formatPrice` has no production callers, and its unit band is chosen before rounding

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `src/lib/format-price.ts:68`, `:36-47`, `:63-65`, `:79-81`
- **Detail**: (a) At HEAD, `grep -rn formatPrice src/` returns only `format-price.test.ts` plus one comment. `MerchantTable.tsx:12` now imports `priceParts` and `partsToGp` and renders through `PriceQuantityCell`, so the entire `Intl.NumberFormat` path exists solely for its own tests. The plan's rationale for the three-way split — "so the rendered string and the parts can never disagree about a boundary" — still holds structurally, but the wrapper it protects is no longer used, and the guarantee is unexercised in production. (b) `:36-47` picks the unit *before* rounding, so `0.099` renders "10 cp" while `0.1` renders "1 sp", and `0.999` renders "10 sp" while `1` renders "1 gp". `format-price.test.ts:16` locks this in, so it is deliberate — but `MerchantTable.tsx:68` derives the *edit* unit from `priceParts`, so the GM edits a copper field for a value the same function calls silver one thousandth higher. (c) Two comments about the locale are wrong: `:63` says "non-breaking space" and `:79` says "narrow no-break space"; Node 22 ICU emits U+00A0. The grouping character for `pl-PL` has moved between CLDR releases and will differ across Node / workerd / browser — the test at `:85` correctly asserts only `not.toContain("21000")`, and this string must never be parsed back (`pl-PL` uses a comma decimal separator, so `parseFloat("9,5")` reads 9).
- **Fix**: Decide whether `formatPrice` is wired back into the read-only display path or dropped with its tests; fix the two locale comments either way.
- **Decision**: FIXED (comments only) — the two inaccurate locale comments are corrected and now warn against parsing the formatted string back. The wiring decision was deferred to P2-F3 and resolved there as document-don’t-rewire.

## Post-triage state (2026-09-12)

Gates re-run after the fixes landed: `npm test` **314 passed** (was 279) · `npx astro check` 0 errors · `npm run lint` exit 0 · `npm run build` complete, `dist/client/index.html` present and still carrying the prerendered empty state.

Two fixes were proven by mutation rather than by a passing suite: reverting `quotas[largest] += residual` now fails 24 tests, and turning the recency weight into a filter now fails the tier-exhaustion test. Both mutations passed silently before.

Changes are in the working tree, uncommitted.
