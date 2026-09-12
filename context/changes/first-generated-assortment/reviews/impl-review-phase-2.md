<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Pierwszy wygenerowany asortyment — Phase 2

- **Plan**: `context/changes/first-generated-assortment/plan.md`
- **Scope**: Phase 2 of 3 — "Visible generator" (commit `e030b42`)
- **Date**: 2026-09-12
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 5 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

**Automated verification (re-run at HEAD `8fe687d`):** `npm test` 279/279 pass · `npx astro check` 0 errors · `npm run build` complete · `dist/client/index.html` exists (criterion 2.4) · `grep -rn "Welcome\|Banner\|LibBadge" src` returns nothing (criterion 2.5) · `npm run lint` exit 0. All six Phase-2 automated criteria hold.

**Manual criteria:** all six have observable evidence in the diff. Criterion 2.10 ("no repeated item name within a single list") was additionally verified structurally rather than by eye — the domain rule guarantees unique `itemId`, and a direct scan of `src/data/items.generated.ts` found zero duplicate *names* across all 160 catalog entries, so name-uniqueness follows from id-uniqueness. No rubber-stamping found.

**Plan adherence note:** the island's state shape, first-entry seeding, null-vs-empty empty state, try/catch, `recentIds` replace-on-draw and clear-on-control-change (both controls), native selects, the shadcn `Button`, the three-column semantic table, `formatPrice` in the price cells, the row count, the absence of a rarity column, `prerender = true`, `client:load` inside `Layout`, and all three starter deletions with zero dangling references — all verified MATCH. No guardrail was breached and no Phase-1 assumption was broken.

## Findings

### F1 — No React error boundary; the island is the whole page

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/index.astro:14`
- **Detail**: `git grep -i "ErrorBoundary\|componentDidCatch\|getDerivedStateFromError" -- src` returns nothing, at this commit and at HEAD. The plan required a try/catch around `generateAssortment` because "an uncaught throw here would blank the only page the product has" — and that catch is correctly implemented. But it covers the *handler* only. A throw during **render** — `MerchantTable` mapping a row whose `priceGp` went non-numeric after a `npm run data:build`, or any future reshape of `AssortmentRow` — unmounts the island and leaves the prerendered shell with no heading and no controls. There is no server to catch it and no second route to fall back to. The plan identified the failure mode correctly and then guarded only one of its two paths.
- **Fix**: Add one class-component boundary (`getDerivedStateFromError`) around the `MerchantGenerator` tree, rendering a Polish fallback plus a reload affordance.
  - Strength: Closes the exact hole the plan's own rationale describes, at roughly 20 lines, with no change to the generator itself.
  - Tradeoff: Adds the repo's first class component to an otherwise function-only codebase; React has no hook equivalent.
  - Confidence: HIGH — standard React pattern, and the blast radius (one wrapper) is small.
  - Blind spot: Not verified how an Astro island behaves when its root throws during hydration specifically, as opposed to during a later render.
- **Decision**: FIXED — new src/components/GeneratorIsland.tsx wraps MerchantGenerator in a class error boundary inside React (an Astro slot would not have caught its errors); index.astro mounts it client:load. Route still prerenders.

### F2 — The catch discards the table the GM is currently reading

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:40` (at HEAD: `:870`)
- **Detail**: The error handling is otherwise exemplary — the narrowing on `AssortmentPoolError` is correct, both messages are Polish and human, and neither leaks `cause.message` or a stack. The problem is the state reset that accompanies it: `setRows(null)` runs before `setError(...)`, so a failure concerning the *new* draw wipes the *previous* one. A GM mid-session presses Stwórz, the draw throws, and the table they were narrating disappears, replaced by a single sentence. Nothing is persisted at this phase, so that shop is unrecoverable. The render already gates the table on `error === null` (`:103`), which means `setRows(null)` is redundant to the display and destructive only to state. This decision survived to HEAD, where it also clears `header` and `corrections` — so it is now a two-site fix.
- **Fix**: Leave `rows` untouched and render the error above the existing table, or gate the wipe on `rows === null`.
  - Strength: Turns a destructive failure into a non-destructive one; the GM keeps the list they were reading and can retry at leisure.
  - Tradeoff: The screen then shows an error banner and a stale table simultaneously, which needs a word of copy to explain ("nie udało się wylosować nowego asortymentu — poniżej poprzedni").
  - Confidence: HIGH — the render guard already exists; this is a deletion plus a condition swap.
  - Blind spot: At HEAD the same handler also clears `corrections`, and whether stale corrections should survive a failed reroll is an S-02 question this review did not settle.
- **Decision**: FIXED — the catch no longer clears rows/header/corrections, and the error renders above the surviving table with „Poniżej poprzedni asortyment — nie został zmieniony.”

### F3 — At HEAD `MerchantTable` is no longer presentational and no longer calls `formatPrice`

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `src/components/MerchantTable.tsx:12-19`, `:92-105`
- **Detail**: Phase 2 delivered exactly what the plan specified: `{ rows: readonly AssortmentRow[] }`, no state, price cells through `formatPrice`. Later slices changed both halves of that contract. The prop surface is now `{ rows, corrections, onCorrect }` (`:14-19`), so the component merges an overlay and emits committed edits upward rather than being presentation-only. And the price path no longer goes through `formatPrice` at all — `:12` imports `partsToGp` and `priceParts`, cells render `PriceQuantityCell` (`:92-105`), and the unit decision is reimplemented via `priceParts` plus `priceInUnit`. The Phase-1 rationale for the three-way split was that the rendered string and the parts "can never disagree about a boundary"; with the string half unused in production, that protection is now structural only. See Phase-1 finding F10 for the dead-export half of this.
- **Fix**: Decide the intended end state — either route read-only price display back through `formatPrice`, or retire it and record that `priceParts` is the single production entry point.
  - Strength: Either answer removes an ambiguity that currently costs a reader real time: the module documents a contract its main consumer no longer uses.
  - Tradeoff: Rewiring means touching S-02's editable cells, which are working and tested; retiring means deleting tests that currently guard boundary behaviour nothing exercises.
  - Confidence: MEDIUM — the facts are certain, the right destination is a design call.
  - Blind spot: Not assessed whether a future read-only view (print, share, saved-merchant preview) would want the string form back.
- **Decision**: FIXED (documented, not rewired) — format-price.ts now states that priceParts is the production entry point, why formatPrice is unused, when to reach for it, and to delete it with its tests if it is still unused at v1.

### F4 — A standing error hides the empty-state hint and never clears

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:51-59`, with `:99-103`
- **Detail**: `error` is cleared only on a *successful* generate — neither `handleCategoryChange` nor `handleWealthChange` resets it. Both the table and the empty-state hint are gated on `error === null`, so once an error is showing, changing category and wealth leaves the page as one error sentence with no instruction and no table. The recovery path ("wybierz kategorię i zamożność, potem kliknij Stwórz") is exactly what is hidden. Strictly the plan only promised that a successful draw clears the error, so this is not a contract breach — but it makes the documented empty state unreachable while an error stands.
- **Fix**: Call `setError(null)` in both change handlers, and render the hint independently of `error`.
- **Decision**: FIXED — setError(null) added to both control change handlers; the table and the empty-state hint are also no longer gated on error === null (landed with F2).

### F5 — The planned column alignment and width policy did not land in Phase 2

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/components/MerchantTable.tsx` (at commit `e030b42`)
- **Detail**: The Phase-2 contract for the table says "Numeric columns right-aligned and sized to content; the name column absorbs remaining width." The committed file carries **zero** styling — no `className` on `table`, `th`, `tr` or `td` anywhere — so the shipped table used browser defaults: everything left-aligned, no width policy. The implementer appears to have deferred all table styling to Phase 3's narrow-screen work rather than splitting it, which is defensible sequencing; the utilities did land in the very next commit `7839d6e` (`w-px … text-right whitespace-nowrap` on the numeric headers, `break-words` on the name cell). The cost was ten minutes of a visibly unstyled page on `main`, and a Phase-2 contract silently satisfied by Phase 3. Nothing is outstanding in the code — this is a bookkeeping gap, not a functional one.
- **Fix**: Note the deferral in the plan (move that bullet from Phase 2 to Phase 3) so the phase boundary matches what actually shipped.
- **Decision**: FIXED — the alignment/width bullet moved from the Phase 2 table contract to Phase 3, where it actually shipped (Phase 3 already carried the same requirement).

### F6 — The generated table is announced to nobody

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantTable.tsx:18-20`
- **Detail**: The error path is handled properly (`role="alert"` at `MerchantGenerator.tsx:99`), but the success path has no live region and no focus move: a screen-reader or keyboard user presses Stwórz and gets silence while 18 rows appear below the fold. Everything else here is above the standard the plan set — `htmlFor`/`id` pairs on both selects, `th scope="col"` on all three columns, a named `section aria-label="Asortyment kupca"` landmark, and a correct three-form Polish plural in `rowNoun` including the 12-14 exception. Worth noting because the PRD's single NFR is phone readability, where assistive tech use is common.
- **Fix**: Add `aria-live="polite"` to the row-count paragraph — it already reads "18 pozycji", which is the right announcement, and it steals no focus.
- **Decision**: FIXED — aria-live="polite" added to the row-count paragraph.

### F7 — Two undeclared additions: a section landmark and a pluralization helper

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/components/MerchantTable.tsx:17`, `:44-51`
- **Detail**: `section aria-label="Asortyment kupca"` (`:17`) and `rowNoun()` (`:44-51`), a three-form Polish pluralization helper, are both absent from the plan, which only said "include the row count near the table". Both are presentation-only, self-contained and correct. Recording them because they are the only unplanned code in the phase, and because `rowNoun` is the kind of helper that later gets copy-pasted rather than shared — it is currently local to this file with no test.
- **Fix**: No action needed; if a second component ever needs Polish pluralization, promote `rowNoun` to `src/lib/` with a test rather than duplicating it.
- **Decision**: SKIPPED — both additions are correct and self-contained; rowNoun stays local until a second caller needs it.

## HEAD drift (context, not findings)

Six slices later, `MerchantGenerator.tsx` has grown 106 → 1041 lines. Two Phase-2 guarantees are *deliberately* reversed by design in later slices, which is expected progression rather than drift: "no effects on mount, no persistence, no localStorage" (S-03 adds three `useEffect`s and a mount-time restore that rehydrates `recentIds`), and "Stwórz regenerates freely with no confirmation" (S-02 adds a `ConfirmDialog` gate). Everything else from Phase 2 survives intact at HEAD: default export and prop-less signature, all four original state fields with the same types, first-entry seeding, the try/catch with the same two messages, `recentIds` replaced on draw and cleared by both control handlers, the null-vs-empty empty state, `role="alert"`, labelled selects, and three columns with no rarity. `src/pages/index.astro` is byte-identical to `e030b42` — `prerender = true` and `client:load` both survived all six slices.

## Post-triage state (2026-09-12)

Gates re-run after the fixes landed: `npm test` **314 passed** (was 279) · `npx astro check` 0 errors · `npm run lint` exit 0 · `npm run build` complete, `dist/client/index.html` present and still carrying the prerendered empty state.

Two fixes were proven by mutation rather than by a passing suite: reverting `quotas[largest] += residual` now fails 24 tests, and turning the recency weight into a filter now fails the tier-exhaustion test. Both mutations passed silently before.

Changes are in the working tree, uncommitted.
