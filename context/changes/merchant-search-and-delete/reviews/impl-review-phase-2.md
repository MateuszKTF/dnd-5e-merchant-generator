<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Lista, która wytrzymuje miesiące kampanii — Phase 2

- **Plan**: `context/changes/merchant-search-and-delete/plan.md`
- **Scope**: Phase 2 of 2 — "Search" (landed as `89367e9`)
- **Date**: 2026-09-13
- **Verdict**: REJECTED at review — **6 of 10 findings fixed in triage, 4 consciously skipped, 2026-09-13**
- **Findings**: 1 critical, 8 warnings, 1 observation (6 fixed, 4 skipped, 0 accepted as risk)

## Triage outcome (2026-09-13)

Fixed: F1, F2, F3, F4, F5, F10. **Skipped by decision: F6, F7, F8, F9** — all four accessibility or
consistency nits on the search input; none is a data-safety issue. F7 and F8 are each a one-line
change and are the cheapest things left on this change if it is revisited.

Gates after triage: `npm test` **366 passed**, `npm run lint` exit 0, `npx astro check` 0 errors
0 warnings, `npm run build` complete with `dist/client/index.html` present. (The count moves 362 → 368
→ 366: six tests added, then four `matchesQuery` tests removed with F10's unexport.)

Both code fixes were **mutation-checked** — and one mutation run is worth recording as a lesson in
itself. The first attempt to delete the zero-width strip reported the suite green, which reads
exactly like a vacuous test. It was an **ineffective mutation**: the deletion pattern treated
`\u200B` as a regex escape rather than as literal source text, so the file was never modified. Re-run
as a literal string replace, it fails 5 tests. *An ineffective mutation and a vacuous test are
indistinguishable from the pass count alone* — the mutation has to be verified as applied.

The lint gate also caught a literal U+200B I had pasted into a test comment
(`no-irregular-whitespace`) — the very class of character this finding is about, caught by a gate
rather than by review.

## Scope note

Reviewed against the **working tree**, which carries this session's uncommitted triage fixes for
`saved-merchants-library` and S-05 Phase 1. F8 is an interaction between that triage and search; the
rest are live and attributable to `89367e9` or to the plan's own scope.

**Process note, recorded because it is my error.** The two review agents ran in parallel against one
working tree and both performed in-place mutation testing, so each briefly polluted the other's
baseline. The second agent detected this and switched to isolated copies. The tree has been verified
intact afterwards — both mutation sites (`matchesQuery`'s empty-query guard, the `[łŁ]` mapping) are
present, no untracked files remain under `src/`, and the suite is 362/362. Future parallel reviews
that mutate source must not share a working tree.

**The normalization rules themselves are correct and well tested.** All eight decomposing Polish
diacritics, both cases, and `ł`/`Ł` — the plan's most-emphasised point — work, and the test block is
genuinely load-bearing: every one of four required mutations reddens it, on exactly the tests you
would expect. The `ł` mapping even carries a meta-assertion proving NFD alone would not have stripped
it, so it cannot quietly become dead code. The critical finding is not in what the rule does; it is
in what it does not reach.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Automated criteria (2.1–2.4) verified on this tree: `npm test` 362 passed, `npx astro check` 0
errors 0 warnings, `npm run build` complete, `npm run lint` exit 0.

## Findings

### F1 — Zero-width characters defeat search entirely, on both sides

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-library.ts:268-280` (`normalizeForSearch`)
- **Detail**: `normalizeForSearch` relies on `/\s+/gu` and `.trim()` to remove invisible characters,
  but `\s` matches **neither U+200B (ZWSP) nor U+200C (ZWNJ)** — it happens to match U+FEFF and
  NBSP, which is why the gap looks closed. Probed against the real functions:

  ```
  ZWSP matches \s          -> false
  normalizeForSearch("Ku<ZWSP>znia") -> "ku<ZWSP>znia"   (survives)
  stored name with ZWSP, query "kuznia"        -> 0 hits
  clean stored name, query with ZWSP           -> 0 hits
  ```

  Both directions are live, and the second is not covered by anything:

  1. **Stored side.** `normalizeName`'s `INVISIBLE_NAME_CHARS` strip (added by this session's triage)
     only runs on the *rename* path, and only from now on. A name saved before it, or arriving by any
     other route, keeps its ZWSP and is permanently unfindable by any query spanning it.
  2. **Query side.** `normalizeName` is never applied to the query and never will be. A GM pasting a
     merchant name out of session notes — Google Docs, Notion and Discord all emit U+200B — matches
     nothing, forever, with nothing on screen explaining why.

  The UI symptom confirms it: a query of a lone ZWSP passes `query.trim() !== ""` but not
  `normalizeForSearch(query) === ""`, so the panel renders *"Żaden kupiec nie pasuje do „​”"* — a
  nothing-matches message quoting an empty-looking string, over a fully populated library. That is
  exactly the "search is flaky" failure the module's own docstring says the design exists to prevent.
- **Fix**: Hoist `INVISIBLE_NAME_CHARS` to module scope and strip as the first step of `normalizeForSearch` — but with a **wider set than the storage rule uses**. `normalizeName` deliberately preserves U+200D so a ZWJ emoji survives in a stored name; search normalization is throwaway and never persisted, so it should strip U+200D too, or a name carrying a family emoji stays unfindable by its plain letters. One line, both sides, symmetric.
- **Decision**: FIXED — `.replace(/[\u200B-\u200D\uFEFF]/gu, "")` is now the **first** step of `normalizeForSearch`, deliberately a wider range than `INVISIBLE_NAME_CHARS`, with the reason for the difference recorded at the line: the storage rule keeps U+200D because it holds an emoji sequence together in a name the GM chose, while this result is discarded after the comparison, so keeping it would only make that name unfindable by its plain letters. Written as escapes, not literals. **Mutation-checked**: deleting the line fails 5 tests — both match directions, the joiner case, and the empty-query case.

### F2 — Sort order is never tested on the filtered path

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-library.test.ts:393-396`
- **Detail**: `keeps sortForLibrary's order` asserts with an **empty** query, which returns early at
  `merchant-library.ts:320` before the filter ever runs — so nothing tests ordering on the filtered
  path. Mutation-proven: rewriting `filterMerchants` to sort only on the empty-query branch
  (`return [...merchants].filter(...)` otherwise) leaves the suite **fully green**. The duplicate-name
  test would catch it only by coincidence, because its input order already happens to agree with
  sorted order.

  What would ship: a panel that reorders to oldest-first the moment the GM types. `saved` reaches the
  panel in insertion order — `MerchantGenerator` appends with `setSaved((c) => [...c, promoted])` —
  so the unsorted order is genuinely different, not incidentally equal. Textbook L-03.
- **Fix**: One extra assertion — a query matching ≥2 merchants over a deliberately unsorted input, asserting newest-first.
- **Decision**: FIXED — added `"keeps sortForLibrary's order on the filtered path too"`, matching two merchants from a deliberately oldest-first input. **Mutation-checked**: replacing `sortForLibrary(merchants)` with `merchants` fails 2 tests, where before it left the suite entirely green.

### F3 — A test does not test what its name says

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-library.test.ts:369-372`
- **Detail**: `it("finds a diacritic-free name from a diacritic-bearing query")` searches a fixture
  named `"Łuk i Cięciwa"` — itself diacritic-**bearing**. There is no diacritic-free stored name
  anywhere in the block. Proven empirically: stripping the `ł`→`l` mapping leaves this test **green**,
  because both sides then keep their `ł` and still match.

  Its real value is catching *asymmetric* normalization (it is the only test that reddens when the
  query is passed raw), which is worth having — but the name promises coverage the suite does not
  have. The plan explicitly listed "the reverse also holds" as a required case.
- **Fix**: Rename it to what it does (`"normalizes the query, not just the stored name"`) and add the case it claims — a merchant named `"Luk"` found by query `"Łuk"`. Probed: that direction works, so it will be green on arrival; it simply is not pinned.
- **Decision**: FIXED as specified — the existing test is renamed to `"normalizes the query, not just the stored name"`, which is what it actually guards, and a new `"finds a genuinely diacritic-free name from a diacritic-bearing query"` covers the direction the old name promised, using a stored name (`"Luk i Cieciwa"`) that carries no diacritic at all, so only normalizing the *query* can make it match.

### F4 — Zero-width has no test coverage on either side

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-library.test.ts:271-406`
- **Detail**: `normalizeName` has a dedicated zero-width test and an emoji-ZWJ test; the search block
  has neither, so nothing in the suite would have caught F1. Any fix for F1 needs a test on **both**
  sides — a stored name containing U+200B, and a *query* containing U+200B — or the same gap reopens
  the next time someone touches the normalizer.
- **Fix**: Add both cases alongside the F1 fix.
- **Decision**: FIXED — a `normalizeForSearch` block asserting that `\s` genuinely does not match U+200B (so the premise itself is pinned, not just the consequence) plus the strip on U+200B/U+200C and the joiner, and a `filterMerchants` block covering **both** directions — a stored name carrying a ZWSP, a clean name found by a ZWSP-bearing query — and a query of nothing but zero-width returning the whole list. Six tests, 368 total.

  Worth recording: the first mutation run reported the suite green, which looked like vacuous tests. It was an **ineffective mutation** — the deletion pattern read `\u200B` as a regex escape rather than as literal source text, so the file was never changed. Re-run as a literal string replace, it fails 5 tests. An ineffective mutation and a vacuous test are indistinguishable from the pass count alone.

### F5 — A rename that leaves the filter destroys its own announcement

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantLibrary.tsx:228-253`, `:348-350`, with `:71-72`
- **Detail**: `handleRename` is synchronous, so the row's `setNotice("Nowa nazwa: X")` and the
  parent's `setSaved` land in **one React 19 batch**. Rename a row while a filter is active such that
  the new name no longer matches, and in that single commit `filterMerchants` drops the merchant, the
  `<li>` unmounts, and the per-row `role="status"` region is removed **before it ever renders its
  content**. The announcement is not missed — it never exists. Sighted GMs get the same problem in
  another form: the row they were renaming silently vanishes with no explanation.

  This is not a defect in the per-row live region, which is correctly always-mounted for its own
  lifetime. It is that lifetime being scoped to a row search can delete underneath it. Attribution:
  this session's triage interacting with Phase 2's filter.
- **Fix A ⭐ Recommended**: Keep a just-renamed merchant in the filtered list until the query next changes.
  - Strength: Fixes the sighted failure and the screen-reader one together, and matches the plan's own instinct elsewhere — "deleting a row while filtered simply removes it from the filtered view and leaves the query in place" treats the filter as a view the GM controls, not a rule that reacts mid-edit.
  - Tradeoff: The panel briefly shows a row that does not match the query, which needs to not look like a bug.
  - Confidence: MEDIUM — the mechanism is clear, but "until the query next changes" needs a precise trigger.
  - Blind spot: Have not checked how this composes with `holdOrder`'s frozen order, which is released on the same commit.
- **Fix B**: Hoist the rename notice to a panel-level region that outlives the row.
  - Strength: Strictly smaller; the announcement survives regardless of what happens to the row.
  - Tradeoff: Fixes only the screen-reader half — the row still vanishes silently for everyone else.
  - Confidence: HIGH — a region one level up plainly outlives the row.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `filterMerchants` gained an optional third argument `keepId`, defaulting to `null`, so the rule stays in the pure module where it is testable rather than becoming component logic. `MerchantLibrary` wraps `onRename` to record the id and drops it on the next `onChange` of the query — the precise trigger the blind spot asked for. Two tests: the held merchant survives a query it no longer matches, and without the id it is filtered out as usual.

  The `holdOrder` blind spot resolved favourably on inspection: the frozen order is snapshotted at the rename's *first keystroke*, so the held row is already in it and keeps its position rather than being appended at the end.

### F6 — A stale query ambushes the next save after the library empties

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantLibrary.tsx:111`, `:58`
- **Detail**: The search input is mounted only while `saved.length > 0`, but `query` lives in the
  component, which stays mounted. Delete every merchant while a query is active: the input unmounts
  and the query is retained. Save a new merchant, the input remounts **carrying the stale query**,
  and the brand-new merchant is filtered out of view — so the GM sees *"Żaden kupiec nie pasuje do
  „kuznia”"* immediately after a successful save, in a product whose stated guardrail is that saved
  merchants do not vanish.

  The commit message's "a delete while filtered leaves the query alone for free" is right for a
  partial delete and wrong at the delete-all boundary.
- **Fix**: Clear `query` when `saved.length` reaches 0, or move the input outside the length guard.
- **Decision**: SKIPPED — conscious triage decision, not an oversight. Reachable only by deleting every merchant while a filter is active and then saving a new one.

### F7 — The accessible name hides that category is searchable

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantLibrary.tsx:119-120`
- **Detail**: `aria-label="Szukaj kupca"` alongside `placeholder="Szukaj po nazwie lub rodzaju"`.
  `aria-label` **wins** for the accessible name, so a sighted GM reads "search by name or kind" while
  a screen-reader user is told only "search for a merchant" — and is never informed that typing
  `kowal` finds a shop renamed away from its category. That is the single most useful thing about
  this feature and the entire justification for the category arm in `matchesQuery`.
- **Fix**: `aria-label="Szukaj kupca po nazwie lub rodzaju"`.
- **Decision**: SKIPPED — conscious triage decision. Worth revisiting: it is a one-string change, and it is the only signal a screen-reader user gets that category is searchable at all.

### F8 — The search input is the only control in the panel with no focus indicator

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/MerchantLibrary.tsx:123`
- **Detail**: Every other interactive element in this file carries
  `focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-800` — the
  panel toggle, the name input, the open button, the delete button. The search input has none and
  falls back to `global.css`'s `outline-ring/50`, which measures roughly 1.3:1 on white, well under
  the 3:1 floor WCAG 2.4.11 sets. Nothing in CI can see it (L-04).
- **Fix**: Copy the sibling class string onto the search input.
- **Decision**: SKIPPED — conscious triage decision. Note this leaves the search input as the only control in the panel without the house focus token, against four siblings that carry it.

### F9 — Component and library disagree on what an empty query is

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantLibrary.tsx:73` vs `src/lib/merchant-library.ts:319`
- **Detail**: `filtering = query.trim() !== ""` and `normalizeForSearch(query) === ""` are two
  different emptiness rules, and they diverge in **both** directions. A query of a lone combining
  acute: `trim()` says filtering, the library strips the mark and returns everything — so the header
  announces `3 z 3` while nothing is filtered. A query of a lone ZWSP: `trim()` says filtering, the
  library filters to zero — the F1 symptom. The component is asking a question the library answers
  differently.
- **Fix**: Derive `filtering` from the library's own rule rather than re-implementing it — becomes free once F1 is fixed.
- **Decision**: SKIPPED — conscious triage decision. The F1 fix removed the worst divergence (the zero-width query that filtered to nothing while `trim()` called it a filter); what remains is the combining-mark case, where the header can read `3 z 3` while nothing is filtered.

### F10 — `matchesQuery` is exported with an unenforced precondition and no production caller

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `src/lib/merchant-library.ts:293`
- **Detail**: `normalizedQuery: string` is typed as any string but silently under-matches unless
  pre-normalized — re-introducing at the API boundary exactly the asymmetry the module's docstring
  says the design exists to prevent. Its only callers are `filterMerchants` and the test file;
  nothing in `src/components` imports it. `categoryLabelFor` directly above is kept private for a
  weaker reason. The plan did specify `matchesQuery` as part of the contract, so exporting it is not
  drift — but nothing consumes it.
- **Fix**: Unexport and test it through `filterMerchants` (removing the category arm reddens a `filterMerchants` test, not only the `matchesQuery` one, so coverage does not depend on the export); or keep it exported and add a test pinning the precondition.
- **Decision**: FIXED — `matchesQuery` is now private, and its four direct tests were removed since the behaviour is fully reachable through `filterMerchants`. Coverage did not depend on the export: the category arm's mutation reddens a `filterMerchants` test either way. The unenforceable `normalizedQuery` precondition is no longer a public API surface.

## Phase 2's contract — verified MATCH

| Plan clause | Evidence |
|---|---|
| `normalizeForSearch` handles **`ł`/`Ł`** | Probed against the real function: `"Łuk"`/`"ŁUK"`/`"łuk"` → `"luk"`; `"ĄĆĘŁŃÓŚŹŻ"` → `"acelnoszz"`. Order is `toLowerCase → NFD → strip \p{M} → [łŁ]→l → collapse → trim`. |
| The `ł` case asserted **separately** | Its own test, plus a meta-assertion that `"Ł".normalize("NFD")` really is still `"Ł"` — so the mapping cannot quietly become dead code. Mutation: removing the mapping fails exactly two tests and nothing else, as the commit message claims. |
| Both sides through one normalizer | `filterMerchants` normalizes the query once; `matchesQuery` normalizes name and label. Mutation: passing the query raw reddens the suite, so the symmetry is genuinely guarded. |
| Category-label matching | `categoryLabelFor` is shared with `libraryRow`, so display and search labels cannot diverge. Probed across all four categories: a merchant renamed to "Zupelnie inna nazwa" is found by each label. |
| `filterMerchants` shape | Query normalized once outside the predicate; `sortForLibrary` applied before filtering; empty/whitespace-only returns the full sorted list. |
| Filter input | `type="search"`, first element in the panel, gated on `saved.length > 0` (the full list, so it does not vanish when the query matches nothing), local `useState`, no debounce, never reaches F-01's document, count while filtering, and a distinct zero-match hint keyed off `merchants.length === 0` versus `saved.length === 0`. |
| Scope | `89367e9` touched four files. No fuzzy matching (normalized `includes` only), no assortment-content search, no query persistence, no storage call, no schema change, no jsdom or glob change. |
| Plan edit in the commit | Progress stamping only — Phase 1's five boxes annotated with `— d42b7d0`, Phase 2's four flipped. No contract text altered. |

Also verified clean and **not worth acting on**: non-Polish input is not mangled (`Schrödinger` →
`schrodinger`, `école` → `ecole`, emoji and CJK preserved, non-decomposing `Æ`/`ß` correctly left
alone for a Polish product); a stored name that arrives already NFD-decomposed still matches; no
catastrophic backtracking (100k whitespace chars 0 ms, 100k diacritics 16 ms); and **performance is
negligible** — the query is normalized once, `CATEGORIES.find` runs over a four-element array, and at
the PRD's "dozens" this is tens of microseconds. Adding `useMemo` would cost readability for no
measurable gain.

## Repaired before this review

- **The match-count live region was mounted conditionally** in `89367e9` — `{filtering && <p
  role="status">…}` — so the first announcement landed as the region was inserted, which screen
  readers skip. This session's triage made it always-mounted and filled later. A real accessibility
  defect in the as-landed commit.

## Lower-value notes (not findings)

- **`type="search"`'s clear affordance is only partly real.** Chrome and Safari render
  `::-webkit-search-cancel-button` (not suppressed by any project CSS); **Firefox renders none**, and
  the WebKit one is mouse-only and not exposed to assistive tech. Clearing by any route does restore
  the full list. An explicit clear button would be more honest; a reasonable conscious skip.
- **A comment describes an unreachable line** (`merchant-library.ts:274-276`): `[łŁ]`'s `Ł` arm
  cannot fire because `.toLowerCase()` runs first. The comment says so and defends keeping it as
  order-robust — a fair call, noted so triage sees it was considered rather than missed.
- **`\p{M}` strips all marks**, so Japanese `が` would fold to `か`. Irrelevant for this product.
- The comment explaining the `[łŁ]` line sits *below* it, reading as though it annotates the
  whitespace-collapse line instead.
