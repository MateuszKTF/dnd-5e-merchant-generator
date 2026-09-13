<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Biblioteka zapisanych kupców — Phase 3

- **Plan**: `context/changes/saved-merchants-library/plan.md`
- **Scope**: Phase 3 of 3 — "Inline rename and save-in-place" (landed as `5a2eb03`)
- **Date**: 2026-09-13
- **Verdict**: NEEDS ATTENTION at review — **all 9 findings fixed in triage, 2026-09-13**
- **Findings**: 0 critical, 5 warnings, 4 observations (9 fixed, 0 skipped, 0 accepted as risk)

## Triage outcome (2026-09-13)

All nine fixed. Gates after triage: `npm test` **362 passed** (up from 357 — five new `holdOrder`
tests), `npm run lint` exit 0, `npx astro check` 0 errors 0 warnings, `npm run build` complete with
`dist/client/index.html` present.

**Three fixes changed shape while being applied**, each because the finding's proposed remedy turned
out to be wrong or incomplete:

- **F2** — Fix A was attempted and abandoned: `relatedTarget` is `null` both for a React-driven node
  move and for a click on non-focusable background, so it would have abandoned renames users expect
  to be saved. Switched to Fix B, which removes the trigger instead of classifying the blur.
- **F3** — rendering the button was not enough; `handleSave` would have promoted a duplicate. It now
  branches to the autosave retry.
- **F5** — a "shortened" flag would have put a second owner on `normalizeName`'s rules, so it
  announces the stored name instead.

New pure rule `holdOrder` landed in `merchant-library.ts` with five tests, **mutation-checked**:
replacing its comparator with `() => 0` fails the hold-order and newcomer tests.

## Scope note

Eleven commits landed since `5a2eb03` (`MerchantGenerator.tsx` +731/−145, `MerchantLibrary.tsx`
+98/−30), plus this session's Phase 1 and Phase 2 triage fixes, which are in the working tree
uncommitted. Findings are stated **against HEAD**.

**Half this phase's contract was deliberately replaced.** `change.md` records that Progress rows
**3.8** and **3.9** describe behaviour `corrections-autosave` (`c511e47`, `e5575a0`) removed: the
"Zapisz zmiany" button for an open record no longer exists, because a correction now saves itself,
and the label has only one variant. Those rows were "odhaczone jako domknięte, nie jako zweryfikowane
w oryginalnym brzmieniu". This review treats them as superseded, not unmet — and checks whether the
supersession preserved the plan's underlying intent. It mostly did; F3 is the clause that did not
survive.

**Phase 3's own work was faithful.** Every clause of the inline-rename contract MATCHes, and the
save-in-place contract MATCHed on every clause as landed. The idiom it was told to copy was copied
*verbatim* — `git show 5a2eb03` shows `PriceQuantityCell` and `MerchantLibrary` running identical
code. The divergence in F1 opened later, when `9aa3ed8` improved the reference and did not port the
change to the copy.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Automated criteria (3.1–3.4) verified at HEAD after Phase 1 and 2 triage: `npm test` 357 passed,
`npx astro check` 0 errors 0 warnings, `npm run build` complete, `npm run lint` exit 0.

## Findings

### F1 — The rename no longer matches the idiom it claims, in a comment, to share

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: `src/components/MerchantLibrary.tsx:213-226` and `:250-256`, against `src/components/PriceQuantityCell.tsx:76-119`
- **Detail**: The plan told Phase 3 to follow `PriceQuantityCell`'s idiom "so the app has one editing
  idiom rather than two", and **as landed it did — literally**. `git show 5a2eb03` shows both files
  running the same code: the same `abandoned` ref, the same `blur()` on Enter and Escape, the same
  unguarded `onBlur`.

  `9aa3ed8` then rewrote the reference and did not port the change here. Three divergences are live:

  | | `PriceQuantityCell` (HEAD) | `MerchantLibrary` (HEAD) |
  |---|---|---|
  | Enter | `commit()` in place, **no blur** (`:85-87`) | `event.currentTarget.blur()` |
  | Escape | `setDraft(null)`, no blur, no flag (`:90-92`) | `abandoned.current = true` + `blur()` |
  | Blur | `if (draft === null) return;` (`:117`) | commits unconditionally |

  The reference documents *why* it stopped blurring (`:76-79`): blurring drops focus to `<body>`, so
  the next Tab restarts at the top of the document. That reasoning applies here too — Enter or Escape
  on a rename throws a keyboard user back past both selects, Stwórz, Zapisz and the panel bar.

  The row's own comment still asserts parity: *"the same idiom as the assortment's editable cells, so
  a GM who learns that Escape abandons an edit in one place is right about the other."* That is now
  false, and it is the sentence a future reader would trust instead of re-deriving. The `abandoned`
  ref exists solely to undo a blur the sibling's design no longer performs.
- **Fix**: Port the HEAD idiom wholesale — Enter commits in place, Escape sets `draft = null` in place, neither blurs, `onBlur` guards on `draft === null`, and the `abandoned` ref is deleted. This also resolves F6 for free.
- **Decision**: FIXED — ported wholesale. Enter commits in place, Escape ends the edit in place, neither blurs, `onBlur` returns early on `draft === null`, and the `abandoned` ref plus its `useRef` import are gone. The row comment no longer asserts bare parity; it names the shared rule (`draft === null` is what says the edit is over) and notes that the claim holds only while both files actually agree. Parity verified mechanically: both files now contain zero `currentTarget.blur()` calls and one `if (draft === null) return;` each.

### F2 — A cross-tab write can commit a half-typed name

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:634` → `src/components/MerchantLibrary.tsx:49`, `:116`, `:250-256`
- **Detail**: Every `storage` event calls `setSaved(read.doc.saved)`. `filterMerchants` sorts by
  `savedAt`, so another tab's autosave **re-orders the list**. React reconciles by key and *moves* the
  `<li>` DOM node; moving a focused element resets focus per the HTML spec, which fires `blur`, which
  commits the in-progress draft to storage. The GM is typing a new name in one tab, another tab
  autosaves an unrelated correction, and the half-typed name is written.

  The draft *state* is safe — `key={merchant.id}` is correct and `value={draft ?? merchant.name}`
  keeps the draft ahead of an incoming name — so this is specifically focus-loss-commits, not stale
  identity. Note `PriceQuantityCell`'s `draft === null` guard would **not** help here (the draft is
  non-null); the table simply never re-sorts, so the reference has never had to face this. A rename
  itself does not re-sort (`renameMerchant` leaves `savedAt` alone), so the same-tab case is clean.
- **Fix A ⭐ Recommended**: Commit only from an explicit end-of-edit — Enter, or a blur whose `relatedTarget` shows the user moved focus themselves — so a programmatic focus loss abandons the draft instead of writing it.
  - Strength: Addresses the actual rule ("a rename is what the GM ended, not what the DOM did"), and composes with F1's port rather than fighting it.
  - Tradeoff: A blur caused by clicking outside the app entirely (another window) would abandon rather than commit, which is a behaviour change on a path that currently saves.
  - Confidence: MEDIUM — `relatedTarget` is reliable for in-page focus moves but `null` for several legitimate cases, so the predicate needs care.
  - Blind spot: Haven't verified what `relatedTarget` is during a React-driven DOM move specifically.
- **Fix B**: Skip the re-sort while any row holds a draft.
  - Strength: Removes the trigger outright and keeps every current commit path working; also stops the list jumping under the GM mid-edit, which is its own annoyance.
  - Tradeoff: The library needs to know a row is being edited — state lifted out of `MerchantRow`, which is where the draft deliberately lives.
  - Confidence: MEDIUM — simple in principle, but it adds cross-component state for a narrow case.
  - Blind spot: Whether deferring the re-sort can leave the list stale if the GM never ends the edit.
- **Decision**: FIXED via **Fix B**, after Fix A was tried and abandoned. Implementing Fix A surfaced that `relatedTarget` is `null` both when React moves the focused node **and** when the GM clicks non-focusable page background — a normal way to end an edit — so it could not separate the two and would have abandoned renames users expect to be saved. That is a worse regression than the bug, so the approach was changed (with the user's agreement) to removing the trigger instead of classifying the blur after the fact.

  New pure rule `holdOrder(merchants, ids)` in `merchant-library.ts` re-orders to a snapshot, keeping post-freeze arrivals at the end in incoming order (`sort` is stable) rather than dropping them, so the panel cannot hide a merchant because the GM is renaming another. `MerchantLibrary` snapshots the on-screen order at the **first keystroke** — not at focus, since tabbing through is not an edit and would leave the list stale — and releases it through a single `endEdit()` in the row, so commit, Escape and blur all release on every path. Five tests added; **mutation-checked**: replacing the comparator with `() => 0` fails the hold-order and newcomer tests. The blind spot is closed by construction: the freeze is released by `endEdit()`, which every termination path runs.

### F3 — A failed autosave leaves no save affordance at all

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/components/MerchantGenerator.tsx:1333` (render condition), `:949`
- **Detail**: Phase 3's contract ends: "S-03's rule that a failed write leaves the button armed
  applies unchanged." That rule is the one clause of the save-in-place contract the supersession did
  **not** preserve.

  The Zapisz button renders only when `session.openedSavedId === null || session.state === "saved"`.
  After a failed autosave with a record open, neither holds — **no control exists to retry**. Under
  `quota-exceeded` the transient write in `handleCorrect` fails for the same reason, so the correction
  lives in React state alone and a reload loses it. The banner says to delete merchants to free space;
  after the GM does that, there is no way to act on it except by making another correction.

  Compensations are present and deliberate: a persistent `StorageNotice`, `setAutosaveFailed(true)`
  feeding `wouldLoseWork` so the discard dialog guards Generate and Open, the `not-found` case
  re-arming by construction, and the decision recorded in code (`:918-922`, dated 2026-09-12). So the
  deeper rule — *a failed write must never present as a save that happened* — does survive: with a
  record open there is no button to lie, and `promote-failed` can never reach `saved`. What is missing
  is only the retry affordance, which is exactly what the plan's sentence promised.
- **Fix**: Render the save button when `autosaveFailed` is true, so the one remedy the notice names has somewhere to land.
- **Decision**: FIXED, and it needed more than the render condition. Rendering alone would have made the button **promote a copy** — `handleSave` was written on the premise "only ever reachable with nothing open", so a press with a record open would have appended the near-identical duplicate this whole slice exists to prevent. `handleSave` now branches: with `openedSavedId` set it routes to `autosaveOpened` (the retry) instead of `addMerchant`. `autosaveOpened` returns whether the write landed, so a successful retry dispatches `promoted` and the button confirms it the way it confirms any other save. The 2026-09-12 "no retry control" decision comment is rewritten to record the revision and why.

### F4 — The rename input is the only row control with no row identity

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantLibrary.tsx:223`
- **Detail**: `aria-label="Nazwa kupca"`, identical on every row. The reference component's prop is
  documented as *"Accessible name identifying the column **and the row**"* (`PriceQuantityCell.tsx:10`),
  and `MerchantTable.tsx:91,115` honour it. Both sibling controls in this very row carry the merchant:
  `Otwórz: ${name}` and `Usuń: ${name}`. The input is the one that does not — and duplicate names are
  permitted by design, so the field's own value does not disambiguate either. A screen-reader user
  tabbing the panel hears "Nazwa kupca" on every row with nothing to tell them apart. This was a
  divergence at `5a2eb03` too. Nothing in CI can see it (L-04).
- **Fix**: Name it by the row's disambiguators rather than by the value, which mutates as the user types — e.g. `aria-label={\`Nazwa kupca — ${row.categoryLabel}, ${row.savedAtLabel ?? "brak daty"}\`}`.
- **Decision**: FIXED as specified — the label now carries category and save time, so it differs per row without depending on the value the GM is editing.

### F5 — A rejected or truncated rename is announced nowhere

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantLibrary.tsx:201-211`
- **Detail**: Two outcomes end in a bare `setDraft(null)` with no feedback: `normalizeName` returning
  `null` (blank, whitespace-only, or — since Phase 1 triage — invisible-only input), and silent
  truncation at 60 graphemes. A sighted GM sees the snap-back; a screen-reader user gets nothing, and
  the field's value simply differs from what they typed. Two always-mounted live regions now exist
  (`MerchantGenerator.tsx:1392` and `:1400`, the latter added in Phase 2 triage) and neither is used
  for this.
- **Fix**: Announce "name restored" / "name shortened" in an sr-only `role="status"`, reusing the pattern the delete announcement now uses.
- **Decision**: FIXED, with the message simplified from the proposal. A "shortened" flag would have needed the component to re-derive `normalizeName`'s cap and collapse rules — a second owner for the rule Phase 1's review already warned about — so it announces **what was actually stored** (`Nowa nazwa: …`) instead, which is simpler and tells the user more. A blank input still announces the restore explicitly. The region is per-row and always mounted, so an announcement cannot outlive its row or be overwritten by a rename two rows down.

### F6 — A tab-through can silently rewrite a stored name

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantLibrary.tsx:201-211`, `:250-256`
- **Detail**: Because the blur handler has no `draft === null` guard (F1), merely focusing and leaving
  the field runs `commit(merchant.name)`. The unchanged-name guard compares the **normalized** value
  against the **raw stored** one, so whenever a stored name is not already normalization-stable, a
  focus-and-Tab performs a full document write and renames the merchant with no GM action: names with
  doubled or leading whitespace, zero-width characters, or over 60 graphemes. Not reachable through
  this app's own writes — only a hand-edited or forward-version document. **Fixed for free by F1.**
- **Fix**: Take F1; no separate change needed.
- **Decision**: FIXED by F1 — the `draft === null` blur guard means a focus-and-Tab no longer reaches `commit`, so the normalization-instability rewrite is unreachable. No separate change made.

### F7 — Nothing signals that the name is editable

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantLibrary.tsx:245`
- **Detail**: `border-transparent bg-transparent` with no hover or rest affordance. In a 25-row table
  "cells are editable" is a column-wide convention a GM learns once; in a list row the name reads as a
  title, and the only way to discover FR-010's rename is to click it. The plan chose the
  reads-as-text treatment deliberately, so this is a refinement of that choice, not a reversal of it.
- **Fix**: `hover:border-neutral-500` — already the house 3:1 token — which makes the affordance visible without breaking the read-as-text treatment.
- **Decision**: FIXED as specified — same token the focus border already uses, so no new colour enters the palette.

### F8 — Detail line fails AA on the opened row

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantLibrary.tsx:262`
- **Detail**: `text-xs text-neutral-500` — 12px, so the 4.5:1 normal-text floor applies. On white it
  measures 4.74:1 and passes. On the opened row's `bg-neutral-100` it measures **4.35:1** and fails.
  Only the opened row, only the detail line.
- **Fix**: `text-neutral-600` on that line.
- **Decision**: FIXED as specified, with the measurement recorded in a comment so the reason survives the next palette edit.

### F9 — The supersession is recorded in `change.md` but not in the plan

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/saved-merchants-library/plan.md` §Phase 3 and Progress rows 3.8–3.9; `src/components/MerchantGenerator.tsx:800-804`
- **Detail**: `plan.md` still reads as the binding contract — "The Zapisz handler branches on
  `openedSavedId`", "The button's label states which action it will take" — with 3.8 and 3.9 ticked,
  describing a button that no longer exists. The supersession lives only in `change.md`. Phase 1 and
  Phase 2 both got in-plan addenda during this review cycle; Phase 3 did not.

  The same drift exists in code: `handleSave`'s comment still says "`openedSavedId` survives a promote
  … a further correction re-arms the button for another in-place save." The button cannot perform an
  in-place save any more.
- **Fix**: Add a Phase 3 addendum to `plan.md` recording what `corrections-autosave` replaced and what survived, and correct the stale `handleSave` comment.
- **Decision**: FIXED — an addendum under the Phase 3 contract in `plan.md` records that every clause was implemented as written and then half deliberately replaced, names what survived (the no-duplicate intent, strengthened), what was deleted (`saveActionFor`, the second label variant, rows 3.8/3.9), and that the "failed write leaves the button armed" clause did **not** survive and was restored by F3 in this triage. `handleSave`'s comment now says a correction re-arms into `autosaveOpened`, not back into the button.

## Phase 3's own contract — verified MATCH

| Plan clause | Evidence |
|---|---|
| Editable field reading as text until focused | `border-transparent bg-transparent` + `focus:border-neutral-500` |
| Local draft | `useState<string \| null>(null)`; `value={draft ?? merchant.name}` |
| Commits on blur, commits on Enter | `onBlur → commit`; Enter delegates via `blur()` |
| **Reverts on Escape** | The `abandoned` ref is set before `blur()`, and `onBlur` checks it, resets it and returns **without committing**. Escape genuinely cannot commit — ugly (F1) but correct. |
| `normalizeName` on commit; `null` restores the previous name | `next === null` → no `onRename`, `setDraft(null)`, value falls back to the parent's prop |
| Duplicates accepted | No dedupe in the row, in `handleRename`, or in `renameMerchant` |
| **One write per commit, never per keystroke** | `onChange` only calls `setDraft`. Repo-wide, `renameMerchant` has exactly one call site. |
| Failed write leaves the previous name on screen | `saved` is mutated only on `ok`; the draft is already `null`, so the field renders the parent's unchanged name. The screen cannot show a name that was never written. |
| Every non-`ok` rename status handled | All five of `ok`/`unavailable`/`quota-exceeded`/`read-only`/`not-found` covered at HEAD |
| Save-in-place, as landed | Branched on `openedSavedId`; both arms returned the same union and dispatched `promoted`/`promote-failed` identically; `updateSavedMerchant` patched rows+corrections only; label derived from the same value the handler branched on |
| `openedSavedId` survives a save; a correction re-arms | Stronger at HEAD — `addMerchant` now dispatches `opened` so even a promote leaves a record open |
| Generate clears `openedSavedId` | `draw()` dispatches `cleared-open` then `generated`; the reducer clears on both |
| Scope guardrails | `5a2eb03` touched three files (plan + the two components). No new storage operation, no second route, no schema change, `assortment.ts`/`corrections.ts` untouched, no jsdom or glob change. Delete and search are `d42b7d0`/`89367e9`. |
| Plan edit in the implementation commit | Progress stamping only — no contract text altered |

`saveActionFor` / `SaveAction`, which Phase 1's review flagged as Phase-3 helpers landing early, were
**deleted in `c511e47`**. They are not vestigial dead code at HEAD; they do not exist.

## Repaired since the phase landed — not actionable

- **A rename against a record another tab had deleted failed in total silence.** As landed,
  `handleRename` routed every non-`ok` through `conditionFromFailure`, which returned `null` for
  `not-found`: the field just snapped back, with no message anywhere, while the record stayed gone.
  That is the PRD guardrail failing on the one FR-010 path. Unreachable at the time (delete did not
  exist until `d42b7d0`), so it was a latent hole rather than a live bug. Repaired in `9aa3ed8`.
- **No focus indicator on the rename input, at ~28px.** As landed: `focus:outline-none` plus a
  `neutral-400` border measuring 2.52:1 — WCAG 2.4.7 removed outright, under the 3:1 control floor,
  on the one field whose blur writes irreversibly. It was a *faithful* copy; `PriceQuantityCell` had
  the identical defect at `5a2eb03`. Both repaired in `9aa3ed8`; the input is now `min-h-11` with
  `neutral-500` (4.74:1) and the house focus tokens.
- **`StorageNotice` returned `null` when empty**, so the first message and its region were inserted in
  one commit — the classic case screen readers skip. Now always mounted, with L-04 cited in the
  comment.
- **The row border** (`neutral-200`, ~1.26:1) was **fixed in this session's Phase 2 triage** as that
  report's F8, so it is not repeated here.

## Verified clean

- **No per-keystroke writes**; **no double commit on Enter** (`blur()` → one `onBlur` → one `commit`).
- **Autosave status handling is complete**: `ok` → clear failure + episodic conditions + local
  `savedAt` refresh; `not-found` → drop the row + `record-gone`, which re-arms the button through the
  derived session; everything else → `raiseWriteFailure` (which this session's Phase 2 triage fixed to
  stop swallowing `read-only`). No silent autosave failure exists at HEAD.
- **Keyboard reachability**: three distinct tab stops per row, all native elements. Splitting the
  input out of the row button was correct and forced — an `<input>` inside a `<button>` is invalid
  HTML.
- **Tap targets**: `h-11` / `min-h-11` / `size-11` on every control in the component.
- **Pattern conformance otherwise**: `@/*` imports, PascalCase components, `readonly` props matching
  `StorageNotice`/`ConfirmDialog`, `cn()` for conditional classes, caller-supplied copy, no `console`,
  no shadcn tokens, no `gray-`/`slate-`/`zinc-`.
- **L-04 confirmed at source**, not merely cited: `eslint-plugin-astro`'s `defineWrapperListener`
  opens `if (!getSourceCode(context).parserServices?.isAstro) return {};`, and all 34
  `astro/jsx-a11y/*` rules are built from it. The config block does apply to every file, but each rule
  short-circuits to an empty listener on a `.tsx` parse. Combined with the `src/**/*.test.ts` glob and
  no jsdom, nothing but this review covers these two components.
