<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Ręczne korekty, których nie da się zgubić

- **Plan**: `context/changes/manual-item-corrections/plan.md`
- **Scope**: Phase 2 of 3 — Editable cells (shipped `717af4a`, reviewed against the current working tree)
- **Date**: 2026-09-12
- **Verdict**: NEEDS ATTENTION → **TRIAGED** (2026-09-12; 7 fixed, 3 skipped, 0 outstanding)
- **Findings**: 0 critical, 5 warnings, 5 observations

## Post-triage gate run (2026-09-12)

`npm test` 320 passed · `npx astro check` 0 errors · `npm run build` complete, `dist/client/index.html`
present · `npm run lint` exit 0.

Fixed: F1 (no-op commit guard), F2 (unit in accessible name), F3 (focus indicator), F4 (plan
amended), F7 (`cn()`), F8 (focus kept on Enter/Escape, `abandoned` ref removed), F10 (pl-PL number
parsing). Skipped by decision: F5 (mid-edit cross-tab restore), F6 (manual pass — user will run it),
F9 (later slice's `not-found` mapping).

**Two Phase 2 manual rows now need re-verification against the working tree rather than `717af4a`:**
2.9 (Enter/Escape no longer blur) and 2.14 (the price field's accessible name changed). 2.13 was
already in that position before triage.

## Review lens

Phase 2 shipped in `717af4a`. Since then **eight commits from four later slices**
(`last-merchant-persists`, `saved-merchants-library`, `merchant-search-and-delete`,
`corrections-autosave`) plus uncommitted work have modified the same three files;
`MerchantGenerator.tsx` has grown to 1050 lines. This review therefore asks **"does the Phase 2
contract still hold in the code that ships today?"** rather than auditing a superseded commit, and
attributes every deviation to the commit that caused it.

Two findings (F9, and the note under F1) sit in code added by *later* slices. They are reported
because they bear directly on FR-008's promise, but they are not Phase 2's debt.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

### What holds

Every behavioural specific in the Phase 2 contract survives today, verified in the working tree:
local draft (`PriceQuantityCell.tsx:57`), commit on blur **and** Enter through one shared path
(`:73-78`, `:105-111`), Escape reverts and blurs without double-committing via the `abandoned` ref
(`:59-62`, `:80-84`), validator `null` → snap-back (`:64-71`), `inputMode` per column, row keys =
`itemId`, three columns only, overlay initialised empty (`MerchantGenerator.tsx:218`).

Two load-bearing requirements deserve explicit credit:

- **The price unit is still pinned to the *generated* price** — `priceParts(generated.priceGp)`
  (`MerchantTable.tsx:72`), never the merged value. The plan called this its loudest critical
  detail; it survived all eight later commits unchanged.
- **The overlay still clears in the same state commit as the new rows** —
  `MerchantGenerator.tsx:848-849`. The restore path added later by S-04 (`adopt`, `:294-313`)
  independently honours the same rule.

All four Phase 2 scope guardrails hold: no revert affordance, no row add/delete, no name/rarity
editing, and the Vitest glob is still `src/**/*.test.ts` in a Node environment with no jsdom.

### Automated success criteria — re-run 2026-09-12

| # | Criterion | Result |
|---|---|---|
| 2.1 | `npm test` | PASS — 7 files, 317 tests |
| 2.2 | `npx astro check` | PASS — 0 errors, 0 warnings |
| 2.3 | `npm run build` | PASS |
| 2.4 | Route still prerendered | PASS — `dist/client/index.html` regenerated this run |
| 2.5 | `npm run lint` | PASS — exit 0 |

## Findings

### F1 — A blur commits a cell the GM only tabbed through

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/components/PriceQuantityCell.tsx:64-71`
- **Detail**: `commit` fires `onCommit` whenever the validator returns a number — including when
  the GM typed nothing and `raw` is just `String(value)`:

  ```tsx
  function commit(raw: string) {
    const next = validate(raw);
    if (next !== null) onCommit(next);
  ```

  Downstream, `handleCorrect` (`MerchantGenerator.tsx:895-906`) does four things per commit:
  `setCorrections`, `setSession({event: "corrected"})`, `persist(...)` and `autosaveOpened(...)`.
  The last two are each a full document read-modify-write — `probeWritable` (a `setItem` +
  `removeItem`), `getItem`, `JSON.parse`, structural validation, `JSON.stringify`, `setItem` —
  over the entire storage document, transient plus every saved merchant. Tabbing across a 25-row
  table is 50 blurs and therefore on the order of 200 synchronous `setItem` calls and 100 full
  document serializations on the main thread.

  The user-visible defect is not the write volume, though: **the save session moves `saved` →
  `armed` because the GM tabbed past a cell**, and the overlay accumulates keys for cells nobody
  edited. `hasCorrections` still answers correctly (it compares values, so the FR-006 dialog does
  not misfire), but the storage state and the notice the GM reads both change on a no-op.

  The sibling component already solves exactly this and documents why —
  `MerchantLibrary.tsx:187-191`: *"An unchanged name is not a rename. Without this, every blur —
  including one where the GM only tapped the field — would rewrite the document."*

  **Correction to the obvious fix:** an in-cell guard of `next !== value` works for quantity and
  **silently never fires for price**. `value` is in display units
  (`priceInUnit(row.priceGp, unit)`, `MerchantTable.tsx:103` — e.g. `9` for 9 sp) while `validate`
  returns gp (`0.9`), so the comparison is across two scales and is always unequal. Either fix
  below avoids that trap; the naive one does not.

- **Fix A ⭐ Recommended**: Guard in `MerchantTable`'s two `onCommit` callbacks, where both values are in gp and in scope — `if (quantity !== row.quantity)` and, for price, compare on the copper grid `Math.round(priceGp * 100) !== Math.round(row.priceGp * 100)`.
  - Strength: Compares committed value against committed value, so it catches a no-op however the GM produced it — tabbing through, or retyping the same number in a different but equivalent form. Copper-grid comparison is already the module's rule for "did this change", so the guard and `isCorrected` can never disagree.
  - Tradeoff: The guard lives at both call sites rather than once in the cell, so a third column added later must remember it.
  - Confidence: HIGH — `row` carries the merged gp value at both sites; I verified the scale mismatch that rules out the in-cell version.
  - Blind spot: Does not stop a commit when the *generated* value changes under an open draft (that is F5).
- **Fix B**: Short-circuit in the cell on the raw string — `if (raw === String(value)) { setDraft(null); return; }` before validating.
  - Strength: One line, one place, unit-agnostic; kills the tab-through case exactly, which is the one that actually happens.
  - Tradeoff: String equality, so `9` vs `9.0` vs ` 9 ` read as edits and still commit; weaker than comparing numbers.
  - Confidence: MEDIUM — correct for the common path, leaky at the edges.
  - Blind spot: Haven't checked what `type="number"` normalizes `event.target.value` to across browsers, which is what this comparison rests on.
- **Decision**: FIXED via Fix A — both `onCommit` callbacks in `MerchantTable.tsx` now return early when the committed value equals the merged one: quantity by `!==`, price on the copper grid using the `CP_PER_GP` exported from `format-price.ts` in the Phase 1 triage. Comparing against the *merged* row is what makes edit-and-revert still commit (so the overlay records the restored value and `isCorrected` reads clean) while a tab-through commits nothing.

### F2 — The price field's unit is not in its accessible name

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantTable.tsx:105`, `src/components/PriceQuantityCell.tsx:126`
- **Detail**: The unit is rendered as a bare sibling span —
  `{unit !== undefined && <span className="text-neutral-500">{unit}</span>}` — with no `id` and no
  `aria-describedby`, so it is not part of the input's accessible name. The name is
  `` `Cena — ${generated.name}` ``. A screen-reader user hears *"Cena — Bag of Holding, spin
  button, 4.2"* with nothing saying whether the field is gp, sp or cp — a factor-of-100
  difference in what they are about to type. The number does not disclose it either, precisely
  because the unit is pinned to the generated price: a 2 cp candle corrected to 5 gp shows `500`
  in a cp field.

  This is a correctness defect, not a nicety — typing `5` into an unlabelled cp field records
  0.05 gp. It also undercuts manual criterion 2.14's first clause: the field announces its row
  and its column's *title*, but the column here is "Cena in sp", not "Cena".
- **Fix**: `` label={`Cena (${unit}) — ${generated.name}`} `` at `MerchantTable.tsx:105` — the table already composes the name and already knows the unit.
- **Decision**: FIXED — the price field's accessible name now carries the pinned unit, e.g. "Cena (sp) — Bag of Holding", with a comment recording that the unit cannot be inferred from the number because it is pinned to the generated price. Criterion 2.14's first clause is now satisfiable for both columns.

### F3 — Focus indicator is removed and replaced with a sub-threshold border

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/PriceQuantityCell.tsx:118-122`
- **Detail**: `focus:outline-none` removes the default focus ring and replaces it with a 1px
  `neutral-400` border. `neutral-400` on white is ≈2.6:1 — below the 3:1 floor `AGENTS.md` states
  explicitly for this project: *"control borders need 3:1 against white (`neutral-500`, not
  `neutral-300`)"*. The result is up to 50 keyboard tab stops whose focus is marked by a
  hairline the rule says is not visible enough.

  Both sibling control families get this right: the selects use `border-neutral-500`
  (`MerchantGenerator.tsx:955, :975`) and `Button` uses `focus-visible:ring-[3px]`
  (`ui/button.tsx:8`). `focus:bg-white` also contributes nothing here, since `Layout.astro`
  already paints `bg-white` on `<body>`.
- **Fix**: Drop `focus:outline-none` in favour of `focus-visible:outline-2 focus-visible:outline-neutral-800`, or at minimum raise the focus border to `neutral-500` and add a ring.
- **Decision**: FIXED — `focus:outline-none` is gone; the focus border is raised to the `neutral-500` the selects use, and a `focus-visible:outline-2 outline-offset-1 outline-neutral-800` does the real work. `focus-visible` rather than `focus` so a tap does not draw a ring. Also dropped the dead `focus:bg-white` (the input is `bg-transparent` over a `bg-white` body, and rows carry no background of their own).

### F4 — The corrected-cell marker is gone; this plan still promises it in four places

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `context/changes/manual-item-corrections/plan.md:88`, `:108`, `:495-497`, and the Phase 2 contract at `:272, :283-284, :291-292, :307`
- **Detail**: Phase 2 specified a `corrected` prop driving a marker that must not be conveyed by
  colour alone. `717af4a` shipped it correctly — an amber dashed underline plus a `(skorygowano)`
  suffix in the accessible name. Commit **`e5575a0`** (`corrections-autosave` p2, 2026-09-12)
  removed the prop, the styling and the name suffix; `MerchantTable` no longer calls `isCorrected`
  at all, which today has exactly one live caller — `hasCorrections`, feeding the FR-006 guard.

  **This was a deliberate, well-recorded decision, not drift.** `corrections-autosave/change.md:79`
  captures it as an explicit user decision — amber is also this app's `StorageNotice` colour, so
  the marker read as a warning, and once corrections autosave, the "unsaved" reading became
  flatly false. `corrections-autosave/plan.md:213-221` plans the removal, and
  `PriceQuantityCell.tsx:33-38` carries the rationale and date in its own docblock.

  The defect is traceability. **This plan was last edited 2026-09-11, a day before the reversal**,
  so it was never back-annotated, and it still states:
  - `:88` (Desired End State) — "the corrected cell is quietly marked so they can see what they changed"
  - `:108` and `:495-497` (Migration Notes) — "the corrected-cell marker keeps working after a reload once S-03 lands — the marker is not a session-only affordance"

  Consequence: Progress rows **2.10**, **2.12** and half of **2.14** describe a feature that no
  longer exists, so they can never be checked, and anyone reading this plan alone concludes FR-008
  shipped incomplete. The whole decision record lives in another slice's folder.
- **Fix A ⭐ Recommended**: Amend this plan — strike or annotate rows 2.10/2.12 and the marker clause of 2.14 with a pointer to `e5575a0`, and add a dated reversal note to Desired End State and Migration Notes.
  - Strength: Keeps the plan usable as the ground truth the next review reads, and leaves the reasoning where someone looking for it will be standing. Matches how this repo already handles discovered scope (the Phase 1 addendum added in this review round).
  - Tradeoff: Edits a plan for a slice already marked reviewed, so its text no longer matches what was approved at plan time.
  - Confidence: HIGH — the decision itself is settled and documented; only its location is wrong.
  - Blind spot: None significant.
- **Fix B**: Leave this plan frozen as the historical record and rely on the autosave slice's folder plus the component docblock.
  - Strength: Plans stay immutable artefacts of what was agreed when; no retroactive editing.
  - Tradeoff: Three Progress rows stay permanently unfalsifiable, and `/10x-archive` or a later reader sees an unfinished slice.
  - Confidence: MEDIUM — defensible as a policy, but it leaves a standing trap for the next reader.
  - Blind spot: Haven't checked whether `/10x-archive` refuses to close a change with unchecked Progress rows.
- **Decision**: FIXED via Fix A — four annotations added to `plan.md`: a dated reversal block under Desired End State (with the reason and a pointer to `corrections-autosave/change.md:79`), an inline note on the "What We're NOT Doing" marker clause, an amendment paragraph in Migration Notes recording that the *storage* decision the marker justified is unaffected, and ` — VOID: …` suffixes on Progress rows 2.10, 2.12 and the second clause of 2.14.

  **Residual, deliberately left:** the three VOID rows stay `- [ ]` rather than `[x]` or a new marker. `references/progress-format.md` defines `- [ ]`/`- [x]` as a mechanical contract read by `/10x-status`, `/10x-archive` and this skill, and says not to rename step titles; inventing a `[~]` state would break that parse, and `[x]` would claim a verification that never happened. Consequence: Phase 2 will keep reporting 5/9 manual rows complete even once the six live ones are checked. That is the honest reading — the rows are unresolvable, not done.

### F5 — An open draft is detached from its `value` prop, so a mid-edit restore can lose the edit

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/components/PriceQuantityCell.tsx:97`
- **Detail**: `value={draft ?? String(value)}` means that while a draft is open the cell ignores
  its `value` prop entirely and nothing reacts to it changing underneath. Two live paths in
  today's code can change it mid-edit — a cross-tab `storage` event calling `adopt`
  (`MerchantGenerator.tsx:398-443`), and the mount restore.

  If the row survives by `itemId`, the field keeps showing the GM's draft over a value that has
  since changed, and blur commits the draft over it. If the row does not survive, the `<tr>`
  unmounts, the half-typed edit vanishes with no blur and therefore no commit — and the
  "superseded" notice at `:432` only fires when `hasCorrections` is already true, which an
  uncommitted draft is not. So a GM mid-edit with no prior committed correction loses that edit
  with no notice at all.

  The window is narrow (it needs a second tab), and this is a later slice's path meeting Phase 2's
  component. But silent loss of a manual correction is the exact class of failure this slice
  exists to prevent.
- **Fix**: Drop the draft when the committed value changes beneath it — the cheapest version is a `key` on `PriceQuantityCell` that includes the merged value, which remounts and resets the draft. Alternatively extend the `superseded` condition at `MerchantGenerator.tsx:432` to also fire when a table field currently has focus.
- **Decision**: SKIPPED — conscious triage call. Requires a second tab open on the same device and an edit in flight at the moment the other tab writes; the loss is one uncommitted keystroke sequence, not a committed correction. Left unfixed one day before the hard deadline. If it is revisited, the `key`-on-merged-value option is the cheap one.

### F6 — All nine manual criteria still unchecked, one day before the hard deadline

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `context/changes/manual-item-corrections/plan.md:546-554`
- **Detail**: 2.6 through 2.14 are all `- [ ]`. Nothing is rubber-stamped — the honest state is
  that Phase 2's browser and device verification never happened, while `change.md` reads
  `impl_reviewed` and the PRD's `hard_deadline` is 2026-09-13.

  Six of the nine are verifiable today (2.6, 2.7, 2.8, 2.9, 2.11, 2.13 and the first clause of
  2.14); three cannot be (F4). **2.13 in particular should be re-tested against the working tree,
  not the commit** — uncommitted changes move exactly what a 360 px pass looks like: `min-h-11` on
  the input (`PriceQuantityCell.tsx:118`), `wrap-anywhere` on the name cell
  (`MerchantTable.tsx:84`), and row-separator contrast raised to `neutral-300`.
- **Fix**: Run the six verifiable rows against the working tree before this slice is archived; resolve the other three via F4.
- **Decision**: SKIPPED — the user will run the browser and device pass themselves. The three VOID rows were resolved separately via F4. Note when running: this triage changed the focus styling (F3) and the price field's accessible name (F2), so 2.13 and 2.14 must be checked against the working tree, not against `717af4a`.

### F7 — Hand-rolled className composition instead of the project's `cn()`

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/PriceQuantityCell.tsx:113-124`
- **Detail**: Classes are composed as an array `.join(" ")` with `className ?? ""`, while `cn()`
  (clsx + tailwind-merge) exists at `@/lib/utils` and is the idiom in `MerchantLibrary.tsx:6,70,212`
  and `ui/button.tsx:47`. Concrete consequence rather than style: a caller passing a conflicting
  utility (`px-2` against the baked-in `px-1`) gets both classes, with the winner decided by
  stylesheet order instead of by tailwind-merge. `MerchantTable` already passes `w-12` / `w-20`
  through this prop.
- **Fix**: `className={cn("min-h-11 …", "focus:…", className)}`.
- **Decision**: FIXED — switched to `cn()` from `@/lib/utils`, with a comment naming the concrete reason (the table passes width utilities through this prop, and only tailwind-merge lets a caller's utility beat the baked-in one). `className ?? ""` is no longer needed — `cn` handles `undefined`.

### F8 — Enter and Escape drop focus to `<body>`

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/PriceQuantityCell.tsx:73-85`
- **Detail**: Both keys end the edit with `event.currentTarget.blur()` and nothing takes focus
  afterwards, so focus lands on `<body>` and the next Tab restarts at the top of the document. A
  keyboard user who commits row 14 with Enter is thrown back to the first control on the page.
  The "both paths run identical code" rationale is sound for *committing* — it is what makes
  Enter and blur impossible to desync — but the focus cost was not part of that trade.
- **Fix**: Keep the shared commit path but stop blurring — on Enter call `commit(event.currentTarget.value)` directly and set a ref so the later real blur does not re-commit (the `abandoned` ref already generalizes); on Escape, `setDraft(null)` and leave focus in the field.
- **Decision**: FIXED, and it simplified the component rather than complicating it. Enter now commits in place and Escape clears the draft in place; neither blurs, so focus stays in the field. **The `abandoned` ref is gone entirely** — ending an edit always means `draft = null`, and the blur handler now reads exactly that (`if (draft === null) return`), which subsumes what the flag was for. That guard is also a second, independent line of defence for F1 at the cell level: a tab-through never sets a draft, so it never reaches `commit`. `commitActiveEdit`'s `pagehide` blur still works — an in-flight draft is non-null and commits as before.

  **Re-verify 2.8 and 2.9 against this change** — Enter/Escape semantics are the same, but focus behaviour is not.

### F9 — `not-found` is swallowed where it means "the record you are editing is gone"

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:181-197`, used at `:632` and `:663`
- **Detail**: Not Phase 2's code — this arrived with the persistence slices — but it lands on
  FR-008's promise. `conditionFromFailure` maps `not-found → null` (silent) with a rationale
  written for `promoteTransient`: *"There is no transient record to promote … that failure raised
  its own notice at the time."* `autosaveOpened` and `handleRename` reuse it verbatim, where
  `not-found` means something else entirely: the saved record the GM is editing no longer exists
  and their correction was not written to it. Nothing is shown and nothing is retried.
  `deleteMerchant` (`:765`) correctly treats `not-found` as success; these two swallow it.

  The window is narrow — the `storage` listener refreshes `saved`, and the derived session then
  nulls `openedSavedId` so `autosaveOpened` early-returns — but the one commit between another
  tab's delete and the `storage` event discards a correction silently.
- **Fix**: Split the mapping per call site, or add a `StorageCondition` for "the open record is gone" and raise it from `autosaveOpened` and `handleRename`.
- **Decision**: SKIPPED — out of this phase's scope (the code belongs to the persistence slices) and the window needs a second tab deleting the open merchant between one commit and the `storage` event. Recorded here so the next review of `corrections-autosave` or `merchant-search-and-delete` inherits it rather than rediscovering it.

### F10 — Decimal comma is not accepted in a Polish-language price field

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/PriceQuantityCell.tsx:92-99`, `src/lib/corrections.ts:195-198`
- **Detail**: `parseDraft` uses `Number(trimmed)`, which rejects `"4,2"`. The document is
  `lang="pl"` and `format-price.ts` deliberately renders prices with a comma, so the GM reads
  `4,2 gp` and may well retype it that way. `type="number"` sanitizes unparseable input to `""`
  in a locale- and browser-dependent way, so whether a comma even reaches the handler varies.
  Worst case is a silent snap-back of an edit the GM plainly typed, and nothing in
  `corrections.test.ts` covers it.
- **Fix**: Normalize `,` → `.` in `parseDraft` and add a test, or switch to `type="text" inputMode="decimal"` and normalize there.
- **Decision**: FIXED in `parseDraft` rather than by changing the input type — `text.replace(/\s/g, "").replace(",", ".")`. It handles the thousands separator too, since `format-price` renders `1 500` with a no-break space whose codepoint its own comment warns is not stable across ICU builds; `\s` covers U+00A0 and U+202F without naming either. Only the first comma converts, so `1,2,3` still reads as unusable. Three tests added, including a round trip through the live `Intl.NumberFormat("pl-PL")` output with a fixture guard so it cannot pass vacuously. Mutation-verified: reverting to `text.trim()` fails exactly the two new tests.

## Not findings

- **`MerchantGenerator.tsx` at 1050 lines** — roughly 42% comment lines; the executable body is
  about 480 lines coordinating nine `useState`s, three effects and fifteen handlers. Ordinary for
  the state this island owns. There is one clean seam (the session/storage block would lift into
  a `useMerchantSession()` hook) but extracting it buys nothing testable, because the Vitest glob
  is Node-only with no jsdom. Revisit if a second consumer appears.
- **Double commits** — impossible. Escape sets `abandoned.current` before `blur()`, the blur
  handler consumes and resets it, and `commitActiveEdit` blurring an already-blurred element is a
  no-op.
- **Storage write safety** — every `JSON.parse` is guarded, quota is distinguished by
  `DOMException.name`, and `localStorage` access is wrapped for the Safari-private case. The
  problem in F1 is write *volume*, not write safety.
- **Colour palette** — compliant apart from F3. Literal `neutral-*`/`red-*`/`amber-*` throughout,
  no shadcn tokens leaking outside `ui/`, and row separators sit at the documented `neutral-300`
  floor for a rule that carries meaning.
