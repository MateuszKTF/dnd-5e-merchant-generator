<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Lista, która wytrzymuje miesiące kampanii — Phase 1

- **Plan**: `context/changes/merchant-search-and-delete/plan.md`
- **Scope**: Phase 1 of 2 — "Delete" (landed as `d42b7d0`)
- **Date**: 2026-09-13
- **Verdict**: NEEDS ATTENTION at review — **all 8 findings fixed in triage, 2026-09-13**
- **Findings**: 0 critical, 4 warnings, 4 observations (8 fixed, 0 skipped, 0 accepted as risk)

## Triage outcome (2026-09-13)

All eight fixed. Gates after triage: `npm test` **362 passed**, `npm run lint` exit 0,
`npx astro check` 0 errors 0 warnings, `npm run build` complete with `dist/client/index.html`
present.

**Two of the four warnings (F2, F3) were defects in this session's own earlier triage** — the
delete fixes applied while reviewing `saved-merchants-library`. Finding them here is the review
chain working: the focus move was inert-blocked and the announcement could not repeat, so the
original F7/F10 fixes were partly cosmetic until now.

Verification beyond the gates:
- **F5** — confirmed `pr-13` is actually emitted into the built CSS rather than silently dropped by
  Tailwind, by grepping `dist/client/_astro/`.
- **F1** — the fix uses `readDocument`, **not** `listSaved`, because S-04's plan explicitly forbids a
  sibling `listSaved()` call; the component already owns `readDocument` at two other sites.

## Scope note

Reviewed against the **working tree**, which carries uncommitted fixes from this session's triage of
the `saved-merchants-library` change. Several of those touch delete directly and are treated as
already-decided rather than as findings — but F2 and F3 below are defects *in that triage's own
work*, found here. Later commits `89367e9`, `c511e47`, `e5575a0` and `9aa3ed8` also changed these
files.

**Phase 1's own contract came out strong.** The row is removed only after the write answers, the
pending action carries the merchant as data so a confirm cannot retarget, cancel changes nothing,
and the scope guardrails held exactly — `d42b7d0` touched five files and added no storage operation,
no schema change, no undo/trash, and no new dependency.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

Automated criteria verified on this tree: `npm test` 362 passed / 7 files, `npx astro check` 0
errors 0 warnings, `npm run lint` exit 0, `npm run build` complete with `dist/client/index.html`
present. All five criteria pass — but see F8 on their numbering.

## Findings

### F1 — `not-found` treated as success can announce a delete over a library that was silently wiped

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:1160`, with `src/lib/merchant-storage.ts:563-567` and `:703-712`
- **Detail**: The plan authorises treating `not-found` as success, on the stated grounds that
  "another tab deleted the merchant while this tab's confirmation was open". That is not
  `not-found`'s only producer. `loadForWrite` maps **both `empty` and `quarantined`** to
  `{status:"ok", doc: emptyDocument()}`; `deleteMerchant` then filters an empty `saved`, the lengths
  match, and it returns `not-found` **without ever calling `save`**.

  Two reachable paths:
  - **Quarantine** — the payload became unparseable, so `quarantine()` copied it aside and
    **overwrote the main key with a fresh empty document**. The whole library is gone from storage.
  - **Site data cleared in another tab** — `readDocument` returns `empty`, and the `storage` handler
    deliberately leaves local state alone (`:609-611`), so the screen still lists every merchant.

  In both, the GM taps delete, the row disappears, and the new announcement says *"Usunięto kupca:
  X."* — a success — while nothing says the other N−1 merchants no longer exist anywhere.
  `MutationResult` cannot express the difference, so this phase never learns of it. That is the
  shape the PRD guardrail forbids.

  Live in the working tree; present since `d42b7d0` and untouched by the triage.
- **Fix A ⭐ Recommended**: On `not-found`, re-read the document and adopt the result instead of blind-filtering one row.
  - Strength: A substituted-empty document then shows honestly as an empty library, and the genuine cross-tab case behaves identically to today. No storage-layer change.
  - Tradeoff: One extra parse on a path that is already rare; the component gains a read where it previously had none.
  - Confidence: MEDIUM — correct for both producers, but the adopt path has its own status handling to get right.
  - Blind spot: Have not checked whether re-reading inside the delete handler can race the `storage` listener's own re-read.
- **Fix B**: Widen `MutationResult` so `deleteMerchant` distinguishes "the record was absent from a document I really read" from "there was no document".
  - Strength: Fixes the class at the source; every future caller inherits the distinction rather than re-deriving it.
  - Tradeoff: Amends F-01's storage module, which every slice so far has deliberately consumed without amending; widens a union five call sites switch on exhaustively.
  - Confidence: MEDIUM — the right layer, but the blast radius is larger than this phase.
  - Blind spot: Have not enumerated how many `switch` statements would need a new arm.
- **Decision**: FIXED via Fix A — `not-found` now has its own branch that re-reads with `readDocument()` and adopts the result (`ok`/`read-only` → `read.doc.saved`, `empty` → `[]`, anything else → `handleFailedRead`), so a substituted-empty document shows honestly as an empty library instead of one row vanishing over a silent wipe. The `ok` path keeps its cheap filter, so the common case gains no extra parse. **`readDocument`, not `listSaved`** — S-04's plan forbids a sibling `listSaved()` call, and the component already uses `readDocument` at mount and cross-tab, so this adds no new read surface. Blind spot resolved: both are synchronous and a `storage` event never fires in the tab that wrote, so there is no race. The announcement was extracted to a shared `announceDeleted(name)` used by both branches.

### F2 — The post-delete focus move is a no-op; focus still lands on `<body>`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:1178`
- **Detail**: `document.getElementById(LIBRARY_TOGGLE_ID)?.focus()` runs **synchronously inside the
  React click handler**, before React flushes `setPending(null)`. At that moment the `<dialog>` is
  still open and modal, which makes every element outside it **inert** — and an inert node cannot be
  focused, so the call does nothing. React then commits: the row unmounts, and `ConfirmDialog`'s
  `useLayoutEffect` calls `dialog.close()`, whose focusing steps restore focus to the element saved
  at `showModal()` time — the row's delete button, now detached. Focus falls to `<body>`.

  So the exact failure the comment at `:1169-1176` describes is still the shipped behaviour. The
  rest of the fix (the live region, the always-mounted toggle, the exported `LIBRARY_TOGGLE_ID`) is
  sound; only the ordering defeats it.

  This is a defect in **this session's own triage work**, not in `d42b7d0`. Neither the harness nor
  the linter can catch it: no jsdom, and L-04.
- **Fix**: Move the focus after the dialog closes — a `focusRequest` state plus a passive `useEffect` in `MerchantGenerator` (passive effects run after every layout effect in the commit, `dialog.close()` included). The file currently contains zero `setTimeout`/`requestAnimationFrame`/`await`, so an async deferral would break its established pattern; an effect would not.
- **Decision**: FIXED — `announceDeleted` now *requests* the focus move (`setFocusRequest((n) => n + 1)`) rather than performing it, and a passive `useEffect` keyed on that counter does the focusing. Passive effects run after every layout effect in the commit, `ConfirmDialog`'s `dialog.close()` included, so the toggle is focusable by then and the browser's own focusing steps have already run. A **counter, not a boolean**: two deletes in a row must each move focus, and a flag already `true` would not re-run the effect. A layout effect would not work either — children commit first, so it would focus the toggle and then watch `close()` take focus away again; that reasoning is recorded in the code. No `setTimeout`/`requestAnimationFrame` introduced, so the file keeps its zero-async character.

### F3 — A second delete with the same name announces nothing

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:249`, `:1177`
- **Detail**: `deletedNotice` is set and never cleared, so deleting two merchants that share a name
  writes the identical string twice. React bails out on `Object.is`, the DOM text does not change,
  and a `role="status"` region announces nothing. Duplicate names are permitted **by design** and
  this codebase says so in at least three places, so this is not a contrived case. The same applies
  to two consecutive deletes that both fall to the nameless branch.

  Also a defect in this session's triage work.
- **Fix**: Hold `{ text, seq }` and render `text`, incrementing `seq` per delete so the element always re-renders.
- **Decision**: FIXED — `deleteNotice` is now `{ text, seq }`, and the region renders `<span key={deleteNotice.seq}>{text}</span>`. Keying the **inner span** rather than the region itself is deliberate: re-keying the `role="status"` element would re-insert it, which is the *other* way an announcement gets skipped. The subtree changes; the live region stays mounted.

### F4 — A failed delete can produce zero observable change

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:1183`, with `:296-298`
- **Detail**: On failure the handler calls `raiseWriteFailure`, which routes through `raise` — and
  `raise` de-duplicates. So when the relevant condition is already standing (the ordinary case: the
  `unavailable` banner is already up, or a `future-version` latch already recorded its reason and
  `raiseWriteFailure` deliberately stays quiet), confirming a delete closes the dialog, leaves the
  row, adds nothing to `conditions`, and touches no live region. **Nothing in the DOM changes at
  all.** The success path now announces itself; the failure path does not.

  The plan's manual criterion 1.11 — "With storage blocked, a delete raises a notice and the row
  stays in the list" — is satisfied on the *first* such delete and not on any subsequent one.
- **Fix**: Give the failure branch a message in the same `role="status"` region, so a confirm always produces an outcome the GM can perceive.
- **Decision**: FIXED — the failure branch now calls `announceDelete("Nie udało się usunąć kupca — zobacz komunikat o pamięci.")` alongside `raiseWriteFailure`, so a confirmed delete always changes something perceivable even when `raise` de-duplicates the condition away. Focus deliberately stays put on this path: the row is still there, so moving focus to the panel toggle would be wrong.

### F5 — The three tap zones are separated horizontally but not vertically

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/components/MerchantLibrary.tsx:307-336` (name input) and `:374-387` (delete)
- **Detail**: The plan: the delete control "must not sit where a mis-tap while renaming would land
  on it". The name input is `flex-1` across the full width of row 1; delete sits at the right of
  row 2 with only a zero-height `sr-only` paragraph between them. There is no vertical gap and no
  horizontal offset, so the delete target is immediately below the right-hand end of the rename
  field. A thumb sliding *sideways* off the input lands on nothing — the commit message's claim, and
  true — but a thumb sliding *downward* from the right end lands on delete. Manual criterion 1.14 is
  ticked, so this was checked by hand at 360 px; recorded as an observation rather than a defect.
- **Fix**: A small vertical gap or a horizontal offset between the rename field's right edge and the delete control, if hand-testing at 360 px agrees it is reachable by a downward slide.
- **Decision**: FIXED — `pr-13` on the name row reserves the delete column's width (44px plus the row below's `gap-2`), so the name field's right edge now stops above the **open** target rather than above delete. Sideways was always safe; downward was not, and now is. Verified the class is actually emitted rather than silently dropped: `pr-13` appears in the built CSS under `dist/client/_astro/`.

### F6 — A cross-tab rename leaves the open dialog naming the old name

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:668-671`, `:1108`, `:1156`
- **Detail**: `setPending(null)` sits after the transient-equality early return, and a rename leaves
  the transient slot untouched — so those bytes compare equal, the handler returns early, and
  `pending` survives. Correct for the delete itself, which is id-based. But the dialog body was
  snapshotted at `:1108`, so after another tab renames the target the dialog says *"„Stary Sklep"
  zniknie…"* while the announcement at `:1156` reads the *current* name from `saved`. The two
  disagree about the same record.
- **Fix**: Resolve the name at render time from `saved` (falling back to the snapshot), so the dialog and the announcement agree.
- **Decision**: FIXED — `confirmCopyFor` now takes `currentName`, resolved at render time from `saved` with the snapshotted name as the fallback. The delete itself was always id-based and correct; only the sentence went stale. The reason a cross-tab rename reaches an open dialog at all (a rename leaves the transient slot untouched, so the `storage` handler returns early and `pending` survives) is recorded at the function.

### F7 — The confirm button uses the shadcn tokens AGENTS.md bans

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/ConfirmDialog.tsx:138` → `src/components/ui/button.tsx:13-14`
- **Detail**: `variant={destructive ? "destructive" : "default"}` resolves to `bg-destructive` /
  `bg-primary` — precisely the token family AGENTS.md bans, and the same fallthrough the file's own
  comment at `:130-134` identifies and fixes *only* for the Cancel button's border. Contrast happens
  to pass (white on `--destructive` ≈ 4.76:1), and it predates `d42b7d0` — but this phase makes the
  "Usuń" button the most prominent instance of it.
- **Fix**: State the colours literally on the confirm button as the Cancel button already does; or record it as a recurring rule via `/10x-lesson` if the shadcn-token fallthrough keeps recurring.
- **Decision**: FIXED — the confirm button now states `bg-red-700 text-white hover:bg-red-800` literally when `destructive`, through `cn()`, the way the Cancel button's border already had to. `red-700` is the palette's semantic destructive accent and the same token the library row's delete control uses, so the two read as one action. The `variant` is left in place so the non-destructive call sites are untouched.

### F8 — Progress row 1.5 does not exist

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/merchant-search-and-delete/plan.md` § Progress, Phase 1 Automated
- **Detail**: Phase 1 has five automated criteria, and all five are stamped — but the rows are
  numbered 1.1, 1.2, 1.3, 1.4, **1.6**. Nothing is missing; one label is wrong. The defect
  originates at planning time in `ca73a67`, not in `d42b7d0`, which only ticked the boxes. Manual
  rows then run 1.7–1.14, so the numbering is internally consistent around the gap.

  Two related convention notes: the ` — d42b7d0` sha suffixes were appended by `89367e9` (the Phase
  2 *feature* commit) rather than by a dedicated docs commit as Phase 2 got (`aa5e291`), and manual
  rows 1.7–1.14 were ticked only in `5cfa093`, the epilogue.
- **Fix**: Renumber to 1.5, or leave it and note that Progress numbering is a label, not an index.
- **Decision**: FIXED — renumbered to `1.5`, keeping its ` — d42b7d0` stamp. Nothing else moves, since the manual rows already start at 1.7 and the gap was the only irregularity.

## Phase 1's contract — verified MATCH

| Plan clause | Evidence |
|---|---|
| Row removed **only** after the write answers | `:1160-1166` — `deleteMerchant` first, `setSaved` only inside the success branch. No optimistic removal on any path. Identical since `d42b7d0`. |
| `not-found` treated as success, no notice | `:1160` — shares the success branch, raises nothing. (Correct per the plan; see F1 for why the rule is too broad.) |
| All four non-`ok` statuses handled | `MutationResult` = `unavailable \| quota-exceeded \| read-only \| not-found`; all four covered. |
| `openedSavedId` cleared as a rule about the **list** | Implemented as a **derived value** (`:381-388`) rather than the planned `cleared-open` dispatch — which satisfies the plan's intent *more* totally, since it covers the local delete, the cross-tab refresh, rename's `not-found` and autosave's `not-found` by one rule instead of four handlers remembering. Uses `nextSaveState(…, "cleared-open")` so the transition table stays the single authority. |
| `destructive` set, and meaningful | Verified in `ConfirmDialog.tsx:61`, not inferred from the prop name: `if (destructive) cancelRef.current?.focus()`, with Cancel first in DOM order and `flex-col-reverse` handling visual order. A stray Enter fires Cancel. Passed unconditionally at the single call site. |
| Cancel changes nothing | `handleCancel` is `setPending(null)` and nothing else — no list mutation, no session dispatch, no storage call. Escape and backdrop both route through it, with an `onClose` backstop. |
| Pending carries the merchant **as data** | `PendingAction` is `{kind:"delete", merchant: Merchant}`; `handleConfirm` reads `pending` into a local before clearing it. A cross-tab re-sort or filter change under the open dialog cannot retarget the delete. |
| Delete control: trailing edge, 44px, named | `size-11` (exactly 44px), `shrink-0`, `text-red-700` (6.42:1 on white, 5.88:1 on `bg-red-50` — both pass), `aria-label={"Usuń: " + name}`, `Trash2 aria-hidden`. |
| "No `ConfirmDialog` change required" | `git log` shows only `76a2b22` (S-02) and `9aa3ed8`. `d42b7d0` did not touch it. |
| Scope guardrails | `d42b7d0` touched five files — the two components plus plan/change/roadmap. No storage operation, no schema change, no undo/trash/soft delete, no bulk delete, no generator/table/correction change, no test-glob change. `lucide-react` was already a dependency; `Trash2` is its first use. |
| Plan edit in the implementation commit | Five `[ ]`→`[x]` flips. No prose, contract or criteria text touched. |

Also verified clean: **no stale closures** (handlers are re-created per render and read live state; the
`storage` listener's deps are honest and `react-hooks/exhaustive-deps` is active on `.tsx` and
silent); **double-confirm is safe** (clicks and Enter repeat are separate tasks, React has flushed
`setPending(null)` first, and `deleteMerchant` is idempotent anyway); **a full store still deletes**
— `probeWritable` returns `"full"`, which does not latch, and `writeDocument` writes a *smaller*
string, so delete genuinely works as the product's only remedy for a full store (11 `deleteMerchant`
assertions in `merchant-storage.test.ts` cover `ok`, `not-found`, `unavailable`, the `read-only`
latch and `future-version`); **the dialog** is a native `<dialog>` with `showModal()`, so focus trap,
Escape and backdrop come from the platform, and `aria-labelledby`/`aria-describedby` are both wired.

## Repaired before this review

- **`read-only` delete failures were silent in `d42b7d0`.** `conditionFromFailure` returned `null`
  for `read-only` unconditionally, so a delete refused by a latch engaged *inside a write* raised no
  notice — contradicting both the plan's contract and its manual criterion 1.11. Repaired by this
  session's `raiseWriteFailure`. (The plan's own named scenario, a `future-version` document, was
  always covered, because that read raises its own condition first.)
- **The save button did not revert after deleting the open record.** `d42b7d0` derived only the
  *id*, not `state`, so `session.state` stayed `"saved"` and the button kept reading "Zapisano",
  disabled, over a merchant no record held — contradicting manual criterion 1.10, which is ticked.
  Repaired in `9aa3ed8` by deriving both halves from the same question.
- **`d42b7d0`'s `pending ?? { kind: "generate" }` fallback forced an upstream change.** It recomputes
  the dialog's copy the instant `pending` clears, so `9aa3ed8` had to convert `ConfirmDialog` from
  `useEffect` to `useLayoutEffect` — otherwise a delete confirmation was visibly turning into a
  regenerate confirmation on its way out. The plan's "no component change required" was true as
  written; the design choice made under it invalidated it one commit later.

## Documentation inaccuracy (no code impact)

Comments at `MerchantGenerator.tsx:369-373` and `:1161-1165` claim "the local delete papered over
that with its own explicit `cleared-open`" and "No `cleared-open` dispatch here any more". No such
dispatch ever existed in `deleteSavedMerchant` — `git show d42b7d0:… | grep cleared-open` returns
only the `draw()` site. The code is right; the comment misdescribes its own history.
