<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-05 Phase 2 — follow-up review of the triage fixes

- **Plan**: `context/changes/merchant-search-and-delete/plan.md`
- **Scope**: Phase 2 of 2 — **re-review of the fixes applied during triage**, not of `89367e9`
- **Date**: 2026-09-13
- **Verdict**: REJECTED at review — **all 10 findings fixed in triage, plus one note, 2026-09-13**
- **Findings**: 1 critical, 9 warnings (10 fixed, 0 skipped)

## Triage outcome (2026-09-13)

All ten fixed, plus the `frozenOrder` unmount-release from the notes. Gates after triage:
`npm test` **366 passed**, `npm run lint` exit 0, `npx astro check` 0 errors 0 warnings,
`npm run build` complete with `dist/client/index.html` present.

**Two fixes had to be reshaped once the code pushed back**, which is worth recording:

- **F1** — the obvious fix (move the notice into the passive effect as state) trips the project's own
  `react-hooks/set-state-in-effect` at error level. The working shape holds the text in a **ref** and
  has the effect write `textContent` onto a **childless** `role="status"` node, so React never owns it
  and the write cannot land in the mutation phase.
- **The `frozenOrder` cleanup** first assigned a ref *during render*. Lint did not object, but a
  render-phase ref write is impure and would run twice per commit under StrictMode; it was moved into
  an effect keyed on `draft`.

**F2 and F5 were both regressions from this session's own earlier triage**, and both were corrected
toward the opposite trade than the one originally chosen — in each case the fix had optimised a
cosmetic or post-reload concern at the cost of a data one.

## What this reviews

`impl-review-phase-2.md` remains the record of the original review and its triage (6 fixed, 4
skipped). This is a **separate, adversarial review of the fixes themselves** — plus the S-04 and
S-05 Phase 1 triage fixes they sit alongside, all still uncommitted. None of that work had been
reviewed by anyone.

The premise was earned: twice earlier in this session a triage fix turned out to be defective when
reviewed afterwards. **It happened twice more here**, including once in the same commit as the fix
that diagnosed the identical trap.

Gates: `npx tsc --noEmit` clean, `npx eslint` clean, `npm test` 366/366, `npm run build` succeeds.

**Process note.** Both agents again shared one working tree. This time file ownership was assigned
up front — lib to one, components to the other, neither mutating the other's — and both confirmed
their files byte-identical afterwards. Cross-file suite failures were explicitly flagged as likely
in-flight mutations rather than findings. The earlier collision did not recur.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## What held up

Before the findings, the parts that were verified rather than assumed:

- **All six Phase 2 search fixes are functionally correct**, and **every new test was
  mutation-checked red** — eight separate mutations, each verified as actually applied. Unexporting
  `matchesQuery` lost no coverage (the category arm still reddens a `filterMerchants` test). The
  renamed test's premise was confirmed empirically: the `[łŁ]` mutation left the *old* test green,
  so its name really did promise coverage the fixture never provided.
- **The passive-effect focus fix is correct** — confirmed against the react-dom bundle, not inferred.
  Passive effects cannot run before a child's layout effect in the same commit, `close()` restores
  focus synchronously, so the effect has the last word.
- **`keepId` composes safely with `holdOrder`**: the kept row is always in the frozen snapshot, and
  `renameMerchant` deliberately does not refresh `savedAt`, so the row does not move.
- **`pr-13` verified in the built CSS** with the arithmetic checked (52px = the 44px delete control
  plus the 8px gap; the input still gets ~266px at 360px).
- **Contrast claims verified by measurement**: `bg-red-700` 6.4:1, `text-neutral-600` 7.17:1 on the
  opened row, and the `neutral-500` figures the comments cite (4.74:1 / 4.35:1) are exactly right.
- **The edit-idiom port lost nothing** with the `abandoned` ref removed — no stale draft, no double
  commit.
- **`exhaustive-deps` silence is earned**, mutation-proven: changing `[focusRequest]` to `[]` does
  produce a warning, so the rule is live on these files.
- **L-04 re-confirmed a fourth time**: an `<img>` with no alt inserted into `MerchantLibrary.tsx`
  drew only a prettier error. `jsx-a11y/alt-text` never fired.

## Findings

### F1 — The delete announcement is written while its region is inert — the same trap, one phase earlier

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:1558-1560`, with `:1206-1210`
- **Detail**: The triage correctly diagnosed that focusing inside the click handler is inert-blocked
  by the still-open modal `<dialog>`, and deferred the focus to a passive effect. But
  `setDeleteNotice` is set in that **same handler**, and React applies it in the **mutation phase** —
  strictly earlier than `dialog.close()`.

  Verified in `node_modules/react-dom/cjs/react-dom-client.development.js`:

  ```js
  flushMutationEffects();   // the <span key> swap lands here — dialog still open + modal
  flushLayoutEffects();     // ConfirmDialog's useLayoutEffect → dialog.close()
  flushSpawnedWork();
  ```

  with passive effects scheduled separately afterwards. So at the instant the `<span key={seq}>` is
  removed and reinserted, the `<p role="status">` is still outside an open modal dialog — inert, and
  therefore hidden from assistive technology. The live-region mutation happens in a subtree the AT is
  not observing, and re-exposure at `close()` is not itself a content change.

  **The announcement that is the entire point of the `{text, seq}` fix most likely never reaches the
  user — by exactly the mechanism the sibling fix in the same commit was written to avoid.** The DOM
  and commit ordering are verified; the AT consequence is a strong inference, not observed against a
  real screen reader.
- **Fix**: Drive both off the one counter in the passive effect — focus the toggle there, then set the notice — so the text changes only once the dialog has closed and the region is live again. See F7: the notice should land *after* the focus move, not with it.
- **Decision**: FIXED, and the obvious shape had to be abandoned. Moving the notice into the passive effect as *state* tripped the project's own `react-hooks/set-state-in-effect` (error level) — a fair rule, and one I had not accounted for. The working shape keeps no state for the text at all: `announceDelete` queues `{ text, moveFocus }` into a **ref** and bumps a tick; the passive effect focuses the toggle, then writes `textContent` directly onto a **childless** `<p id role="status">`. React never owns that node's text, so it renders empty and is left alone on later renders, and the write cannot land in the mutation phase. This also folds in **F7**: focus happens first in the same effect, text second. Residual risk stated honestly — NVDA/JAWS may still preempt the notice with the toggle's own announcement, and separating them further would need a timer, which this file deliberately has none of.

### F2 — Skipping the `opened` dispatch on a failed relink re-opens the duplicate-promote path

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/components/MerchantGenerator.tsx:975-979`
- **Detail**: This is a **regression introduced by this session's own triage** (S-04 Phase 2, F9). The
  fix made `addMerchant` skip its `{ event: "opened" }` dispatch when the second `persist` fails, on
  the grounds that claiming a link the slot does not back is the class of bug `openedSavedIdFor`'s
  content check exists to catch.

  Verified against `nextOpenedSavedId`: `promoted` falls to `default: return current`. So when the
  relink fails, `openedSavedId` stays `null`, `handleSave` dispatches `promoted` →
  `{state: "saved", openedSavedId: null}`. The next correction arms the button; `autosaveOpened`
  returns immediately because `openedId === null`, so the library record is never updated; the button
  renders and is enabled; pressing it calls `addMerchant()` again and **appends a second
  near-identical record**.

  That is the exact duplicate this slice exists to prevent, and the old unconditional dispatch did
  not have it. The window is real — `promoteTransient` has just grown the document, so
  `quota-exceeded` on the immediately following `persist` is a plausible ordering. The harm the fix
  avoided only bites after a reload, where the content check already catches it.
- **Fix**: Restore the unconditional `opened` dispatch and set `autosaveFailed = true` instead — the retry control introduced in the same session is exactly the right landing place for it.
- **Decision**: FIXED as recommended — the `opened` dispatch is unconditional again, and a failed relink now sets `autosaveFailed = true`, which re-arms the FR-006 discard guard and renders the retry control. The comment records why skipping the dispatch looked safer and was in fact much worse, so the next reader does not re-derive the same wrong conclusion: it trades a mismatch that only shows after a reload (and that `openedSavedIdFor`'s content check already catches) for a duplicate append, which is the failure the slice exists to prevent.

### F3 — The rename live region announces success for a rename that failed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantLibrary.tsx:250-267`
- **Detail**: `commit()` sets `notice` **before** calling `onRename`, and `onRename` returns `void`.
  `renameMerchant` can answer `quota-exceeded`, `unavailable` or `read-only`; on those `handleRename`
  leaves `saved` untouched, so the field snaps back to the old name while the sr-only region says
  *"Nowa nazwa: X"*. When the condition is already standing, `raise` de-duplicates and
  `StorageNotice` does not change either — so **the only AT-perceivable output of a failed rename is
  a false success.**

  This is precisely the reasoning the delete path applied one file over ("`raise` de-duplicates … the
  failure path has to announce as well"). Rename got no equivalent.
- **Fix**: Have `onRename` return the status and set the notice from it.
- **Decision**: FIXED — `handleRename` in the generator now returns `boolean`, the `Props.onRename` type and the library's own wrapper both forward it, and `commit()` announces **after** the write, from its result: `"Nowa nazwa: …"` on success, `"Nie udało się zmienić nazwy — zobacz komunikat o pamięci."` otherwise. The wrapper forwarding was the easy thing to miss — `tsc` caught it, which is why the prop type change was worth making rather than threading a callback.

### F4 — `raiseWriteFailure`'s `read-only` guard is over-broad and leaves open the hole it was written to close

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:338-345`
- **Detail**: The guard is `current.some(isStandingCondition)`, but `STANDING` is
  `future-version, needs-migration, unreadable, quarantined, records-dropped` — and only the first
  three engage the read-only latch. Reachable sequence: a mount read returns `ok` with `dropped`, so
  `records-dropped` is raised (standing); later the store is blocked mid-session; a write returns
  `read-only`; the guard sees `records-dropped` and **stays silent**. The GM is left with a banner
  about unreadable records and nothing saying writes have stopped — the docblock's own stated failure.
- **Fix**: Test for the three latch-engaging conditions specifically, rather than `isStandingCondition`.
- **Decision**: FIXED — a new module-scope `engagesReadOnlyLatch` naming `future-version`, `needs-migration` and `unreadable` explicitly, with a comment recording that `STANDING` also carries `quarantined` and `records-dropped` and that neither latches. `isStandingCondition` keeps its own, different job (surviving a successful write).

### F5 — The `not-found` re-read adopts a document without the notices the other two read sites raise

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:1233-1243`
- **Detail**: Another regression from this session's triage (S-05 Phase 1, F1). `ReadResult` carries
  `dropped?: number` on both `ok` and `read-only`. The mount read and the `storage` handler both
  raise `records-dropped` on it, and both raise `unavailable` on `read-only`. This new branch does
  neither — it calls `setSaved(read.doc.saved)` and announces success. So a salvaging re-read here
  silently drops records and the next write makes the loss permanent, inside the branch whose own
  comment says *"the panel now tells the truth about everything else."*
- **Fix**: Raise `records-dropped` when `read.dropped !== undefined`, and `unavailable` on `read-only`, matching the two sibling read sites.
- **Decision**: FIXED as specified — the `not-found` re-read now raises both, with a comment noting it is the same shape as the other two read sites and therefore owes the same notices.

### F6 — Soft hyphen and word joiner still defeat search, and the comment claims otherwise

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-library.ts:280`
- **Detail**: The zero-width fix closed U+200B–U+200D and U+FEFF, and its comment says the symmetry
  gap is closed. Measured against the real function, several invisibles still return **0 hits**:
  U+00AD soft hyphen, U+2060 word joiner, U+180E, and the bidi marks U+200E/U+200F/U+2066.

  **U+00AD is the realistic one** — Word, PDFs and hyphenating browsers emit it on copy, which is
  exactly the "pasted out of session notes" route the comment itself cites as the motivating case.
- **Fix**: Replace the enumerated class with `\p{Cf}`, a superset covering U+00AD, U+200B–U+200F, U+2060, U+2066–2069 and U+FEFF — it keeps U+200D stripped as intended and makes the rule one concept instead of a list. Otherwise narrow the comment's claim to what it actually covers.
- **Decision**: FIXED — a named `FORMAT_CHARS = /\p{Cf}/gu` replaces the inline enumerated class (which also closes the naming inconsistency noted separately: its siblings `COMBINING_MARKS`, `INVISIBLE_NAME_CHARS`, `BLANK_NAME` were all named constants and this one was anonymous). The docstring records why a category beats a list — a list is a guess about which invisibles a GM will paste — and why it is deliberately wider than `INVISIBLE_NAME_CHARS`.

  **Probed**: U+00AD, U+200B, U+200C, U+200D now return 1 in *both* directions; the ZWJ emoji case still normalizes to `"kuznia 👨👩"` and NBSP still collapses to a space. **Mutation-checked**: reverting `\p{Cf}` to the old enumerated class fails exactly the new soft-hyphen assertion.

### F7 — The focus move and the polite announcement land together, and focus wins

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:1206-1210` with `:1558`
- **Detail**: Even once F1 is fixed, `announceDeleted` bumps the notice text and the focus counter
  together. NVDA and JAWS cancel pending speech on a focus change, so the toggle's own announcement
  ("Zapisani kupcy, przycisk…") will very likely preempt or truncate "Usunięto kupca: X". **The two
  fixes made in this commit can cancel each other.**
- **Fix**: Sequence them — focus in the passive effect, then set the notice a beat later — rather than firing both at once.
- **Decision**: FIXED as part of F1 — the passive effect focuses the toggle first, then writes the region's text. Residual risk recorded honestly rather than claimed closed: NVDA and JAWS may still preempt the notice with the toggle's own announcement. Separating them further would need a timer, and this file deliberately contains no `setTimeout`/`requestAnimationFrame`/`await` at all.

### F8 — `keepVisibleId` is not cleared when the panel is collapsed and reopened

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantLibrary.tsx:77`, `:134`
- **Detail**: It is cleared on exactly one path — the search input's `onChange`. The panel uses
  `hidden`, so state survives a collapse: the GM closes the panel, reopens it, and a row that does
  not match the still-active query is sitting in the list with no explanation. Other staleness cases
  were checked and are benign — a `keepId` naming an absent merchant is a verified no-op, and
  `renameMerchant` never leaves a row in `saved` that should not be there.
- **Fix**: Also clear it in the panel toggle's `onClick`.
- **Decision**: FIXED as specified, with the reason recorded at the call site: the panel is `hidden` rather than unmounted, so its state survives a collapse.

### F9 — The match count includes the kept row, so it announces one more match than matches

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantLibrary.tsx:151`
- **Detail**: `{merchants.length} z {saved.length}` counts `filterMerchants(saved, query, keepVisibleId)`,
  which includes the row held over from a rename. After a rename that drops a row out of the active
  query, the live region reports one more match than actually matches.
- **Fix**: Count `filterMerchants(saved, query)` without `keepId` for the label, or accept it — it is a single row and self-corrects on the next keystroke.
- **Decision**: FIXED — a derived `matchCount` counts without `keepVisibleId`, and only pays the second filter pass while a row is actually held (`keepVisibleId === null` short-circuits to `merchants.length`).

### F10 — The new retry button has no failure feedback on a repeat press

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/MerchantGenerator.tsx:886-892`, `:1525`
- **Detail**: The delete path explicitly gained `announceDelete("Nie udało się usunąć kupca…")`
  because `raise` de-duplicates and a repeated failure changes nothing in the DOM. The
  `autosaveFailed` retry button added in the same session has exactly that shape: press →
  `autosaveOpened` → `raiseWriteFailure` → condition already standing → the button stays "Zapisz",
  enabled, and nothing changes anywhere. **The same reasoning was applied to one control and not its
  sibling.**
- **Fix**: Announce the retry failure the way the delete path does.
- **Decision**: FIXED — the retry branch in `handleSave` now announces `"Nie udało się zapisać zmian — zobacz komunikat o pamięci."` when `autosaveOpened` reports failure, with the same reasoning the delete path records: `raise` de-duplicates, so a control whose job is "try again" has to answer when the answer is no.

## Notes (not findings)

- **`<span key={seq}>` is sound at the DOM layer, genuinely uncertain at the AT layer.** Changing the
  key does produce a real `childList` mutation and `role="status"` carries implicit
  `aria-atomic="true"`, so the idiom is plausible — but identical-text re-announcement is exactly
  where screen readers diverge, and it could not be verified against a real AT here. The
  more widely recommended idiom is clearing to `""` and setting the text on a later tick. Moot until
  F1 is fixed. Recorded as "probably works, unverified" rather than settled.
- **No notice is ever cleared**, so both new regions leave permanent sr-only residue in the DOM;
  `role="status"` content is also read as ordinary text in browse mode, so a GM arrowing through the
  library later hears "Nazwa pusta — przywrócono poprzednią." embedded in the row indefinitely.
- **Live regions now number 4 + N** (one per row). Idle regions are not announced and browsers handle
  this fine, so it is not a defect — but the per-row choice is what multiplies it.
- **`frozenOrder` has no unmount release.** If the edited row unmounts mid-edit, Chrome fires no
  `focusout` for a removed focused element, so `endEdit` never runs and the list stays ordered by a
  stale snapshot for the rest of the page load. Narrow; a cleanup effect in the row closes it.
- **The `bg-destructive` ban is only half-lifted.** `twMerge` correctly drops `bg-destructive`, but
  the emitted class list still ends with `focus-visible:ring-destructive/20` — a ~1.3:1 pink ring as
  the focus indicator on the irreversible confirm button. Pre-existing, but the fix's stated
  rationale was the token ban.
- **`border-neutral-300`** satisfies the weaker of AGENTS.md's two floors (1.48:1) but the row
  boundary is still not really perceivable; it reads more like a control border than a table rule.
- **`hover:border-neutral-500` breaks the "both files actually agree" claim** it sits next to — the
  affordance exists only in `MerchantLibrary`, and a hover-only cue does nothing for touch or
  keyboard.
- **The `keepId` test pipes ids through `.sort()`**, making it order-insensitive; the property that
  matters (the kept row holds its sorted slot) is correct when probed but unasserted.
- **The zero-width strip joins tokens rather than separating them** — `"Kowal​Alchemik"` is
  findable by `"kowalalchemik"` but not `"kowal alchemik"`. A ZWSP is semantically a line-break
  opportunity, so mapping it to `" "` would be defensible. Negligible for pasted junk.
- **The search normalizer's class is inlined and anonymous** while its siblings are named constants,
  so the deliberate widening relative to `INVISIBLE_NAME_CHARS` exists only in prose.
- `ConfirmDialog.tsx:142` says "the Cancel button below"; Cancel is above it in the DOM.
