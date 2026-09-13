# Biblioteka zapisanych kupców — Implementation Plan

## Overview

Deliver roadmap slice **S-04**: the GM returns to a list of saved merchants, recognises the right
one, renames it to something of their own, and opens it to find the assortment exactly as it was
saved — manual corrections included (US-02, FR-010, FR-011).

The roadmap calls this the slice where the product stops being another one-shot generator: every
existing 5e shop generator can produce a list, and none can hand back last session's smithy.
It sits after S-03 because the list needs the explicit-save action to have something to show,
and after F-01 because a mistake in the stored shape would be paid for here.

## Current State Analysis

**Nothing is implemented.** `src/lib/` holds only `utils.ts`; `src/pages/` holds the single
`index.astro` still rendering the starter placeholder. All prerequisite slices exist as plans.

This slice attaches to planned contracts:

| Contract | From | Used here for |
| --- | --- | --- |
| `Merchant`, `autoName`, row mappers | F-01 `src/lib/merchant.ts` | list rows, open, rename |
| `listSaved`, `renameMerchant`, write-status union | F-01 `src/lib/merchant-storage.ts` | reading and renaming |
| `promoteTransient`, `putTransient` | F-01 | save semantics this slice redirects |
| `restoreFromDocument`, `SaveState`, `nextSaveState` | S-03 `src/lib/merchant-session.ts` | extended here |
| `ConfirmDialog`, `hasCorrections` | S-02 | the open guard (generic dialog, caller-supplied copy) |
| `MerchantGenerator.tsx`, `StorageNotice.tsx` | S-01 / S-03 | host and failure surface |

**Constraints discovered:**

- **This is the only roadmap item with `Unknowns: —`** (`roadmap.md:228`). The decisions that
  would have been open here were deliberately pulled into F-01.
- **F-01 provides the save-in-place operation.** Its review added `updateSavedMerchant(id, patch)`
  alongside `putTransient`, `promoteTransient`, `renameMerchant`, `deleteMerchant` and
  `listSaved`, with the identity-field constraint and the not-found-without-append rule. This
  slice consumes it; no upstream module is amended.
- **The app has exactly one route.** `AGENTS.md` describes `src/pages/index.astro` as "the single
  view", and there is no reason for this slice to change that.
- **Forward-only storage** (`AGENTS.md:15`) — this slice adds no storage operation and no schema
  field, so the migration rule is untouched. No field may be added to solve a UI problem.
- **The Vitest glob is `src/**/*.test.ts`** with no jsdom, so rules go in `.ts` modules. This
  matches what F-01, S-02 and S-03 all did.
- **Line endings are normalized by S-01 Phase 1** (`.gitattributes`), so `npm run lint` is a real
  gate by the time this slice runs.

### Key Discoveries:

- **Opening a saved merchant is a second silent-loss path.** A GM with an unsaved, corrected
  merchant on screen who taps a list row loses those corrections. S-02 built a confirmation for
  exactly this class of loss on the Generate button — "open" is a different button doing the same
  damage, and nothing upstream gates it.
- **Open-then-save collides with promote-a-copy.** F-01 chose promote-a-copy so a *reroll* can
  never touch a saved record. But an explicit save on a record the GM is looking at is not a
  reroll — promoting there would leave two near-identical entries, and US-02's own criterion says
  a saved assortment stays identical to what was saved.
- **`openedSavedId` cannot be persisted**, because forward-only forbids adding a field for a UI
  concern. So a reload turns an opened merchant into an ordinary transient and Zapisz reverts to
  promoting — the same accepted limitation S-03 documented for its promoted flag.
- **Opening must write to the transient slot.** Otherwise a reload restores the *previous*
  transient merchant rather than the one the GM opened, which would read as the app forgetting a
  deliberate action.
- **Stale enums arrive by a second route.** S-03 normalises an unknown `category`/`wealth` when
  restoring the transient record; opening a saved merchant hits the same problem, so that logic
  has to be factored rather than duplicated.
- **Duplicate names are allowed and S-05 inherits the consequence.** Two smithies in one town
  legitimately share a name, and the row carries category, item count and save time to
  disambiguate — but FR-012's search must therefore present multiple matches rather than assume
  one.

## Desired End State

The GM opens the app on the next session, expands the saved-merchants panel, and sees their
shops newest first — each row showing the name, what kind of shop it is, how many items it holds
and when it was saved. They rename "Kowal, 11.09.2026 20:15" to "Kuźnia u Borysa" by typing in
the row.

Tapping a row brings that merchant back into the table exactly as it was saved, corrections and
all, with the controls set to match. If they had unsaved corrections on screen, they are asked
first. Once open, Zapisz says it will save changes to *that* merchant and does so in place,
rather than leaving a second copy in the list.

**Verification:** `npm test` covers the rename rules, the open normalisation and the extended
save-state transitions; `npx astro check` and `npm run build` pass; manual testing covers
save → reload → open → confirm identical, and the open-over-corrections guard.

## What We're NOT Doing

- **No delete.** FR-013 stays in S-05, as the roadmap sequences it. F-01 already implements
  `deleteMerchant`, so S-05 is a button over an existing operation. The consequence is recorded
  in Open Risks: if S-05 is cut, v1 ships a list that only grows.
- **No search or filtering** — FR-012, S-05.
- **No second route.** The panel lives on `index.astro`; `AGENTS.md`'s single-view description
  stands.
- **No schema change and no new storage operation.** F-01 owns the complete storage API,
  `updateSavedMerchant` included. `openedSavedId` stays in session state for the same reason.
- **No cross-session open tracking.** After a reload, an opened merchant is an ordinary
  transient. Closing that would mean persisting UI state into a forward-only schema.
- **No bulk operations, no export, no reordering, no folders or tags.**
- **No virtualisation.** The PRD sizes the list at dozens; rendering all rows is correct here.
- **No changes to the generator or the correction rules.** `assortment.ts` and `corrections.ts`
  are untouched.
- **No jsdom, no widening of the Vitest glob.**

## Implementation Approach

Three phases: the contract and rules first, then the list and open, then rename and
save-in-place — each of the last two completing one functional requirement.

**No upstream file is amended.** F-01 ships `updateSavedMerchant` and S-02 ships a generic
`ConfirmDialog` with caller-supplied copy, both settled in their own plan reviews. This slice
only *consumes* them — it adds a second call site to the dialog and calls the storage operation.
Earlier drafts of this plan specified renaming and amending both; those steps are now moot.

**Rules go in `.ts` modules**, consistent with F-01, S-02 and S-03. Rename validation, the
opened-record save-state transitions, and the stale-enum normalisation on open are all assertable
in isolation; the panel's rendering and the effects are covered manually.

**The panel shares state with the generator** rather than re-reading storage, which is the whole
reason it lives on the same page: a merchant saved a moment ago appears in the list without a
round-trip, and opening one is a state change rather than a navigation that would discard
unsaved work.

## Critical Implementation Details

**State sequencing — opening is three writes that must land together.** Setting the rows and
corrections, writing the transient slot, and setting `openedSavedId` have to happen in one
commit. If `openedSavedId` lands late, a Zapisz pressed immediately after opening promotes a copy
instead of updating in place — producing exactly the duplicate this slice exists to avoid.

**State sequencing — Generate must clear `openedSavedId`.** A fresh draw is no longer the opened
record. Leaving the id set means the next Zapisz overwrites a saved merchant with a completely
different shop, which is a silent destruction of saved data rather than a duplicate.

**User experience spec — the save button must say which action it will take.** With a record
open the button saves changes to that merchant; otherwise it adds a new one. Since the GM can see
the list, a button that silently does one or the other is worse here than it was in S-03, where
no list existed to contradict it.

**User experience spec — the panel is collapsed by default.** The page already carries controls
and a 25-row table; at 360 px an expanded library would push the assortment below the fold,
against the PRD's only NFR.

**Timing & lifecycle — rename writes on commit, not per keystroke.** Follow S-02's blur-commit
pattern so a rename is one storage write rather than one per character.

## Phase 1: Contract and rules

### Overview

Add the one storage operation this slice needs, factor the normalisation it shares with S-03, and
express the rename and save-state rules as pure functions. No UI.

### Changes Required:

#### 1. Shared normalisation

**File**: `src/lib/merchant-session.ts` (modify — created by S-03 Phase 1)

**Intent**: Opening a saved merchant hits the same stale-enum problem S-03 solved for restore, so
the logic is factored rather than duplicated.

**Contract**: Extract `restoreFromMerchant(merchant)` returning the same shape S-03's
`restoreFromDocument` returns — normalised `category` and `wealth` with their `wasReset` flags,
and `recentIds` seeded from the merchant's rows. `restoreFromDocument` becomes a thin wrapper that
pulls the transient record and delegates.

Extend `SaveState` handling with the opened-record case: add an `openedSavedId: string | null`
concept and the events `"opened"` (arms the button and marks it as an in-place save) and
`"cleared-open"` (fired by Generate). `nextSaveState` must keep S-03's rule that a failed write
leaves the button armed.

#### 2. Rename rules

**File**: `src/lib/merchant-library.ts` (new)

**Intent**: The list's own rules, kept pure so the validation and ordering are assertable.

**Contract**:

- `normalizeName(raw): string | null` — trims, collapses internal whitespace, caps length at
  **60 characters** (enough for "Kuźnia u Borysa przy Bramie Wschodniej" without wrapping a row
  at 360 px), and returns `null` for an empty result so the caller restores the previous name.
  Duplicates are **permitted**: two smithies in one town legitimately share a name, and the row
  carries category, item count and save time to tell them apart.
- `sortForLibrary(merchants): Merchant[]` — newest `savedAt` first, with a stable tiebreak on
  `id` so equal timestamps do not reorder between renders.

  **An in-place save moves its row to the top, and that is intended.** `updateSavedMerchant`
  refreshes `savedAt`, so saving a merchant the GM has open re-sorts the list under them — a row
  they may have scrolled to jumps to the head of the panel. The alternative, freezing `savedAt`
  at first-save, would make the column mean "first saved" rather than "last written" and would
  leave a just-edited merchant buried. Recency ordering is the point of the sort; the movement is
  the cost. The opened-row marking (Phase 2) is what keeps the merchant findable after it moves,
  so the two features have to ship together for this to read as deliberate rather than as a glitch.
- `libraryRow(merchant)` — the display projection: name, category label from `CATEGORIES`, item
  count, and a formatted save time.

#### 3. Tests

**File**: `src/lib/merchant-library.test.ts` (new), `src/lib/merchant-session.test.ts` (modify),
`src/lib/merchant-storage.test.ts` (modify)

**Intent**: Cover the rules whose failure is silent — a rename that blanks a name, a sort that
reshuffles, and an update that hits the wrong record.

**Contract**: `normalizeName` trims, collapses, caps, returns `null` for empty and
whitespace-only, and **accepts a duplicate**. `sortForLibrary` orders by `savedAt` descending and
is stable on ties. `updateSavedMerchant` replaces rows and corrections of exactly one record,
leaves `id`, `createdAt` and `name` untouched, leaves every other record byte-identical, and
returns not-found for an unknown id without appending. `restoreFromMerchant` normalises an unknown
`category` while keeping the rows intact. `nextSaveState` covers `"opened"` and `"cleared-open"`,
including that a failed in-place write leaves the button armed.

#### Addendum (recorded 2026-09-13, impl review of Phase 1)

Two departures from the contract above, both accepted at review rather than corrected:

- **`src/lib/merchant-storage.test.ts` was not modified.** F-01 already shipped all four
  `updateSavedMerchant` properties named above (`merchant-storage.test.ts:218-270`), so the
  "(modify)" here was the stale item. Verified, not assumed.
- **The reducer restructure went further than "an `openedSavedId` concept".** Phase 1 landed
  `SaveSession`, `SaveSessionEvent` and `nextSaveSession` — a genuine improvement, since the pair
  cannot then move separately — and `nextSaveState` kept its name, signature and every S-03 call
  site. It also landed **`saveActionFor` / `SaveAction`, which serve Phase 3's step 3.9**. Pure and
  harmless, but scope this phase boundary did not authorise; noted so a future review does not read
  it as Phase 3 work that never happened. **Both were deleted again in `c511e47`** when
  `corrections-autosave` removed the two-variant button label — they do not exist at HEAD, so do not
  go looking for them.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- `updateSavedMerchant` reads as obviously unable to change a merchant's identity
- The save-state rules make clear when Zapisz updates versus adds

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 2: List panel and open

### Overview

The library itself: a collapsible panel listing saved merchants, and opening one back into the
table behind the discard-corrections guard. Completes **FR-011**.

### Changes Required:

#### 1. Library panel

**File**: `src/components/MerchantLibrary.tsx` (new)

**Intent**: Show the GM what they have saved, in a form they can recognise a specific shop from.

**Contract**: Props take the saved merchants, the currently opened id, and callbacks for open and
rename (rename lands in Phase 3). Renders a collapsible section, **collapsed by default** so the
assortment stays above the fold at 360 px.

Rows come from `sortForLibrary` and `libraryRow`: name prominent and truncating, with category,
item count and save time as secondary detail — the three fields that let the GM tell apart two
merchants sharing a name. The currently opened row is marked. An empty list shows a short hint
rather than an empty container.

The whole row is the open target, sized as a comfortable tap target.

**Addendum (recorded 2026-09-13, impl review of Phase 2).** This held exactly as landed in
`32e1317` — one `<button>` wrapped name and detail. It does **not** hold at HEAD. Phase 3's inline
rename (`5a2eb03`) made the name an `<input>`, and HTML forbids an `<input>` inside a `<button>`, so
the row necessarily split: the name line renames, the detail line opens, and `d42b7d0` added a third
control for delete. The constraint is not negotiable, so the contract sentence above is superseded
rather than unmet. Accepted cost: at 360 px the full-width 44px rename strip sits directly above the
narrower open strip, so a thumb aiming at "the row" lands on rename — and phone readability is the
PRD's only NFR. Mitigations in place: the open button carries `aria-label={"Otwórz: " + name}`, the
detail line is `min-h-11`, and all three controls are separate tab stops.

#### 2. Panel wiring and open

**File**: `src/components/MerchantGenerator.tsx` (modify)

**Intent**: Hold the saved list in the island's state so a freshly saved merchant appears
immediately, and make opening a state change rather than a navigation.

**Contract**: Add `saved: Merchant[]` and `openedSavedId: string | null` to island state.

**Populate `saved` from S-03's single mount read, not from a separate `listSaved()` call.**
S-03's restore effect already calls `readDocument()` and holds the whole `StorageDocument`, on
which `saved` is a plain field. A sibling `listSaved()` would parse the same key twice and — more
importantly — create a second failure surface: when the mount read returns `quarantined`,
`future-version` or `unreadable`, there is no sensible answer to what the sibling call returns or
which result wins. One read, one status, one decision. This requires S-03's restore effect to
expose the document rather than only the restored merchant, so the two land together.

Refresh `saved` from in-memory state after any save, rename or in-place update. On S-03's
cross-tab `storage` event, refresh it only when that handler's re-read returns `ok` — the same
rule S-03 applies to adopting the transient record.

Opening a merchant passes it through `restoreFromMerchant`, then in **one commit** sets rows,
corrections, controls and `recentIds`, writes the transient slot via `putTransient`, and sets
`openedSavedId`. Generate dispatches `"cleared-open"`, clearing `openedSavedId` before drawing.

Storage failures from any of these go through S-03's existing `StorageNotice`; nothing here
introduces a new failure surface.

#### 3. Second call site for the discard guard

**File**: `src/components/MerchantGenerator.tsx` (modify)

**Intent**: Opening over unsaved corrections destroys the same irreplaceable work that
regenerating does, so it gets the same gate — a second call site, not a second component.

**Contract**: `ConfirmDialog` already takes `title`, `body`, `confirmLabel` and `destructive`
from its caller (S-02 Phase 3), so **no change to the component is required**. Supply copy naming
what is lost — the GM's manual corrections — and what is about to happen: opening a different
merchant, as distinct from S-02's regenerate wording.

The open handler runs the same `hasCorrections` check Generate runs; false opens immediately,
true opens the dialog with the pending merchant held until confirm or cancel. A cancelled open
changes nothing — not the rows, not the corrections, not `openedSavedId`. The `cancel` event must
resolve to "do nothing" on this path as it does on S-02's.

**No rename.** Earlier drafts of this plan renamed S-02's dialog; S-02's plan review named it
`ConfirmDialog` with a generic prop surface from the start, so there is nothing to rename and no
call site to sweep.

### Success Criteria:

#### Automated Verification:

- Unit tests still pass: `npm test`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Route still prerendered: `index.html` exists under `dist/client/`
- Linting passes: `npm run lint`

#### Manual Verification:

- Save two merchants; both appear in the panel, newest first, without a reload
- Each row shows name, category, item count and save time, and the name truncates rather than
  wrapping the row
- Opening a merchant restores its rows, corrections (still marked) and controls
- Opening with unsaved corrections present shows the confirmation; cancelling changes nothing;
  confirming opens
- Opening with no corrections opens immediately with no dialog
- The opened row is visibly marked in the list
- Pressing Stwórz after opening produces a new shop and the opened marking clears
- The panel is collapsed by default and the assortment is above the fold at 360 px
- Reloading after opening restores the opened merchant, not the previous one

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 3: Inline rename and save-in-place

### Overview

Rename a merchant to something the GM will recognise, and make Zapisz update an opened record
rather than duplicate it. Completes **FR-010** and closes **US-02**.

### Changes Required:

#### 1. Inline rename

**File**: `src/components/MerchantLibrary.tsx` (modify)

**Intent**: FR-010's rename, in the row, following the inline-edit pattern S-02 already
established rather than introducing a dialog.

**Contract**: The name becomes an editable field styled to read as text until focused, holding a
local draft and committing on blur and Enter, reverting on Escape — the same interaction
`PriceQuantityCell` uses, so the app has one editing idiom rather than two.

On commit, run `normalizeName`: a string calls `renameMerchant`, `null` restores the previous
name. Duplicates are accepted. A failed write leaves the previous name on screen and raises the
matching `StorageNotice`.

#### 2. Save-in-place

**File**: `src/components/MerchantGenerator.tsx` (modify)

**Intent**: Saving a merchant the GM has open should update that merchant, not leave a second
near-identical entry in the list they are looking at.

**Contract**: The Zapisz handler branches on `openedSavedId`: set means `updateSavedMerchant`,
null means `promoteTransient`. Both return the same status union, so both dispatch `"promoted"`
on `ok` and `"promote-failed"` otherwise — S-03's rule that a failed write leaves the button
armed applies unchanged.

The button's label states which action it will take, since the GM can see the list and a silently
ambiguous button would be contradicted by it. After an in-place save, `openedSavedId` stays set —
the GM is still looking at that merchant — and a further correction re-arms the button for
another in-place save.

Generate clears `openedSavedId`, so the next Zapisz adds a new merchant rather than overwriting
the opened one with an unrelated shop.

#### Addendum (recorded 2026-09-13, impl review of Phase 3)

**Every clause above was implemented as written, and then half of it was deliberately replaced.**
`corrections-autosave` (`c511e47`, `e5575a0`) removed the "Zapisz zmiany" button for an open record:
a correction now saves itself, with no press. The supersession is recorded here as well as in
`change.md`, because this section — not that one — is what a future review reads as the contract.

What changed, and what survived:

- **The Zapisz handler no longer branches on `openedSavedId` for a normal save.** The in-place update
  is `autosaveOpened`, called from `handleCorrect`. The intent ("update that merchant, don't leave a
  second near-identical entry") is preserved and strengthened — it now holds without the GM
  remembering to press anything.
- **`saveActionFor` / `SaveAction` were deleted in `c511e47`.** The label has one variant, because
  the button only appears for a merchant outside the library. Progress rows **3.8** and **3.9**
  describe this removed behaviour and are ticked as closed out, not as verified in their original
  wording.
- **"A failed write leaves the button armed" did NOT survive the replacement**, and was restored in
  this review's triage. Between `c511e47` and 2026-09-13 a failed autosave left *no* save control at
  all: the button renders only when nothing is open or the state is `saved`, so a GM told by the
  banner to free space had nothing to press afterwards. The button is now also rendered while
  `autosaveFailed` is true, and in that state it routes to `autosaveOpened` rather than promoting —
  promoting there would append the duplicate this whole slice exists to prevent.

### Success Criteria:

#### Automated Verification:

- Unit tests still pass: `npm test`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Renaming in the row persists across a reload
- Clearing a name and blurring restores the previous name
- Two merchants can be given the same name, and the row's other fields still tell them apart
- Opening a merchant, correcting a price and pressing Zapisz updates that record — the list still
  holds one entry, and reopening shows the correction
- The button's label makes clear whether it will update or add
- Pressing Stwórz after opening, then Zapisz, adds a **new** merchant and leaves the previously
  opened one untouched
- With storage blocked, a rename and an in-place save both surface a notice and leave the list as
  it was
- Save, reload, open: the assortment and corrections are identical to what was saved (US-02)
- Saving an opened merchant moves its row to the top of the list and the opened-row marking
  keeps it findable
- Rename and open are both comfortable at 360 px

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- `normalizeName`: trims, collapses internal whitespace, caps length, `null` for empty and
  whitespace-only, **accepts a duplicate**
- `sortForLibrary`: newest `savedAt` first, stable on equal timestamps
- `libraryRow`: category label resolved from `CATEGORIES`, item count matches the row count
- `updateSavedMerchant`: replaces rows and corrections of exactly one record; leaves `id`,
  `createdAt` and `name` untouched; leaves other records byte-identical; returns not-found for an
  unknown id **without appending**
- `restoreFromMerchant`: normalises an unknown `category`/`wealth` while keeping rows intact;
  seeds `recentIds` from the merchant's rows
- `nextSaveState`: `"opened"` arms as in-place; `"cleared-open"` reverts to promote; a failed
  in-place write leaves the button armed

### Integration Tests:

None. The panel, the effects and the dialog wiring are `.tsx` and the harness has no jsdom — the
same boundary F-01, S-02 and S-03 drew. Covered by the manual steps below.

### Manual Testing Steps:

1. Save two merchants; confirm both appear newest-first without a reload
2. Reload; confirm the list survives
3. Open the older one; confirm rows, corrections and controls come back
4. Correct a price, then tap the other merchant; confirm the discard dialog appears; cancel and
   confirm nothing changed
5. Repeat and confirm; the other merchant opens
6. Rename a merchant; reload; confirm the new name persisted
7. Clear a name and blur; confirm the previous name returns
8. Rename two merchants identically; confirm both remain distinguishable by the row's other fields
9. Open a merchant, correct a price, press Zapisz; confirm the list still shows one entry and
   reopening shows the correction
10. Open a merchant, press Stwórz, press Zapisz; confirm a **new** entry appears and the opened
    one is unchanged
11. Block site data; attempt a rename and an in-place save; confirm notices appear and nothing is
    silently lost
12. Repeat 1–10 at 360 px; confirm the panel is collapsed by default and the table stays above the
    fold
13. `npm run build` then `npx wrangler dev`; confirm the same behaviour on the workerd runtime

## Performance Considerations

The list is dozens of rows of plain markup rendered from state the island already holds; no
virtualisation is warranted and the PRD sizes the collection accordingly. Opening a merchant is a
state assignment plus one `putTransient`, both sub-millisecond.

`listSaved` parses F-01's single document, so the list is refreshed from in-memory state after
writes rather than re-read from storage on every render — re-reading per render would parse the
whole document on each keystroke of a rename.

Nothing here touches the PRD's 5-second criterion, which concerns generation.

## Migration Notes

**No schema change.** `updateSavedMerchant` is an API addition to F-01's module; the document
shape and `schemaVersion` are untouched, so `AGENTS.md`'s forward-only migration rule is not
engaged and no migration is required.

`openedSavedId` stays in session state for the same reason F-01 kept the promoted flag out of the
document: adding a field for a UI concern to a forward-only schema is the worst available trade.
The consequence is that a reload turns an opened merchant into an ordinary transient, and Zapisz
reverts to promoting a copy — the same limitation S-03 recorded, now reachable by a second route.

**This slice amends no upstream file.** Earlier drafts renamed S-02's dialog and added an
operation to F-01's storage module; both plan reviews settled those upstream instead — S-02 now
creates `ConfirmDialog` with a generic prop surface, and F-01 now ships `updateSavedMerchant`.
This slice consumes both. If S-02 or F-01 are re-planned, those are still the touch points, but
nothing here edits them.

## References

- Roadmap item: `context/foundation/roadmap.md:218-233` (S-04), backlog row at line 262; note it
  is the only item with `Unknowns: —`
- Change identity: `context/changes/saved-merchants-library/change.md`
- **Upstream contracts**: `context/changes/merchant-storage-contract/plan.md` (entity, storage
  operations, promote-a-copy, status unions),
  `context/changes/last-merchant-persists/plan.md` (`merchant-session.ts`, save-state machine,
  `StorageNotice`, storage event), `context/changes/manual-item-corrections/plan.md`
  (`hasCorrections`, the confirmation dialog, the inline-edit idiom)
- PRD: `context/foundation/prd.md` — US-02 and all five of its acceptance criteria, FR-010,
  FR-011; FR-012/FR-013 belong to S-05
- Category labels for rows: `src/data/items.ts:25-30`
- Scope-cut context: roadmap Open Roadmap Questions #1 (S-05 is the first candidate to drop)
- Forward-only storage rule: `AGENTS.md:15`; naming conventions: `AGENTS.md:42`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Contract and rules

#### Automated

- [x] 1.1 Unit tests pass: `npm test` — 0f28225
- [x] 1.2 Type checking passes: `npx astro check` — 0f28225
- [x] 1.3 Production build succeeds: `npm run build` — 0f28225
- [x] 1.4 Linting passes: `npm run lint` — 0f28225

#### Manual

- [x] 1.5 `updateSavedMerchant` reads as unable to change a merchant's identity
- [x] 1.6 Save-state rules make clear when Zapisz updates versus adds

### Phase 2: List panel and open

#### Automated

- [x] 2.1 Unit tests still pass: `npm test` — 32e1317
- [x] 2.2 Type checking passes: `npx astro check` — 32e1317
- [x] 2.3 Production build succeeds: `npm run build` — 32e1317
- [x] 2.4 Route still prerendered: `index.html` under `dist/client/` — 32e1317
- [x] 2.5 Linting passes: `npm run lint` — 32e1317

#### Manual

- [x] 2.6 Two saved merchants appear newest-first without a reload
- [x] 2.7 Rows show name, category, item count and save time; name truncates
- [x] 2.8 Opening restores rows, corrections (still marked) and controls
- [x] 2.9 Opening with corrections confirms; cancel changes nothing; confirm opens
- [x] 2.10 Opening with no corrections opens with no dialog
- [x] 2.11 The opened row is visibly marked
- [x] 2.12 Stwórz after opening produces a new shop and clears the opened marking
- [x] 2.13 Panel collapsed by default; assortment above the fold at 360 px
- [x] 2.14 Reload after opening restores the opened merchant, not the previous one

### Phase 3: Inline rename and save-in-place

#### Automated

- [x] 3.1 Unit tests still pass: `npm test` — 5a2eb03
- [x] 3.2 Type checking passes: `npx astro check` — 5a2eb03
- [x] 3.3 Production build succeeds: `npm run build` — 5a2eb03
- [x] 3.4 Linting passes: `npm run lint` — 5a2eb03

#### Manual

- [x] 3.5 Rename persists across a reload
- [x] 3.6 Clearing a name restores the previous one
- [x] 3.7 Two merchants can share a name and stay distinguishable
- [x] 3.8 Open, correct, Zapisz updates in place — one entry, correction present on reopen
- [x] 3.9 The button's label says whether it will update or add
- [x] 3.10 Stwórz then Zapisz adds a new merchant, leaving the opened one untouched
- [x] 3.11 Storage blocked: rename and in-place save both surface a notice, nothing lost
- [x] 3.12 Save, reload, open: assortment and corrections identical to what was saved (US-02)
- [x] 3.13 In-place save moves the row to the top; opened-row marking keeps it findable
- [x] 3.14 Rename and open comfortable at 360 px
