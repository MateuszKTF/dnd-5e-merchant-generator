# Lista, która wytrzymuje miesiące kampanii — Implementation Plan

## Overview

Deliver roadmap slice **S-05**: the GM can delete a saved merchant they no longer need, and find
one by name once the library has grown to dozens over months of campaign (US-02, FR-012, FR-013).

Both operations sit on machinery that already exists — F-01 implements `deleteMerchant`, and S-04
built the library panel, the row projection and `merchant-library.ts`. This slice adds a
confirmation, a control, a filter and the matching rules behind it.

**Delete ships first.** Without it the library only grows, and the escape hatch US-02 itself
names — *"nie znika bez wyraźnej akcji usunięcia przez MG"* — does not exist in the product.
Search only bites once the list is large, which is months away. That ordering reverses the slice's
title and is deliberate.

## Current State Analysis

**Nothing is implemented.** `src/lib/` holds only `utils.ts`; `src/pages/index.astro` still renders
the starter placeholder. Every prerequisite exists as a plan only.

This slice attaches to planned contracts:

| Contract | From | Used here for |
| --- | --- | --- |
| `deleteMerchant(id, storage?)`, write-status union | F-01 `src/lib/merchant-storage.ts` | the delete itself |
| `MerchantLibrary.tsx`, `libraryRow`, `sortForLibrary` | S-04 | the row that gains a control |
| `merchant-library.ts` | S-04 | gains the matching rules |
| `openedSavedId`, `"cleared-open"` event | S-04 / S-03 `merchant-session.ts` | dangling-reference fix |
| `ConfirmDialog.tsx` | S-02 | third call site (generic, caller-supplied copy) |
| `StorageNotice.tsx` | S-03 | delete failures |
| `CATEGORIES` labels | `src/data/items.ts:25-30` | category matching |

**Constraints discovered:**

- **Delete does not break the guardrail.** US-02's criterion reads *"Zapisany kupiec nie znika bez
  wyraźnej akcji usunięcia przez MG"* — an explicit delete **is** the sanctioned action. The PRD
  weighed "deleting breaks the guardrail" as a counterargument to FR-013 and did not accept it
  (`prd.md:201-204`). Only the confirmation question was left open, and this plan settles it.
- **S-04 permits duplicate names**, so search must present every match rather than assume one.
- **F-01 never evicts.** The collection grows until the GM deletes; this slice is the only way
  anything leaves storage.
- **Forward-only storage** (`AGENTS.md:15`) — nothing here changes the schema. Delete and search
  are an operation and a view.
- **The Vitest glob is `src/**/*.test.ts`** with no jsdom, so matching rules go in a `.ts` module,
  consistent with all four earlier slices.
- **Line endings are normalized by S-01 Phase 1** (`.gitattributes`), and this slice runs last of
  all, so `npm run lint` is a real gate with no caveat.

### Key Discoveries:

- **`ł` does not decompose under Unicode NFD.** Polish ą ć ę ń ó ś ź ż all strip cleanly via
  `normalize("NFD")` plus combining-mark removal, but `ł`/`Ł` (U+0142 / U+0141) are distinct
  letters with no canonical decomposition. Without an explicit mapping, a GM typing "Luk" never
  finds "Łuk" — and the normalization would look correct in every other test.
- **Deleting the currently opened merchant leaves a dangling reference.** S-04 tracks
  `openedSavedId` so Zapisz can save in place; after a delete that id points at nothing, and
  S-04's `updateSavedMerchant` returns not-found rather than appending — so Zapisz would quietly
  fail to save with no visible cause.
- **Renaming degrades category search.** Auto-names contain the category ("Kowal, 11.09.2026
  20:15"), so a query of "kowal" finds auto-named shops — but the moment a GM uses FR-010 to
  rename one to "Kuźnia u Borysa", a name-only search misses it. FR-010 and FR-012 would quietly
  undercut each other.
- **Delete must not optimistically remove the row.** F-01's write can return `quota-exceeded`,
  `unavailable` or `read-only`; removing the row before the write succeeds shows a merchant as
  deleted while it is still in storage — a lie in the direction the guardrail cares about least,
  but a lie the GM would act on.
- **The confirmation dialog is already generic.** S-02 ships `ConfirmDialog` with caller-supplied
  copy and S-04 adds a second call site; this slice adds a third. Earlier drafts of this plan
  renamed the component a third time — that work no longer exists.

## Desired End State

Months into a campaign, the GM opens the library and types "kuznia" — without diacritics, on a
phone, one-handed — and the list narrows to the two shops whose names or kind match. They tap the
trailing delete control on a merchant they no longer run, confirm a dialog that names it, and it
is gone from the list and from storage.

If they delete the merchant they currently have open, the assortment stays on screen and the save
button quietly goes back to offering to add it as a new entry, rather than pointing at a record
that no longer exists.

**Verification:** `npm test` covers normalization (including `ł`), matching and filtering;
`npx astro check` and `npm run build` pass; manual testing covers delete-with-failure, deleting
the open merchant, and diacritic-free queries at 360 px.

## What We're NOT Doing

- **No undo, no trash, no soft delete.** A confirmation naming the merchant is the protection; F-01
  has no soft-delete concept and adding one would mean a schema change to a forward-only document.
- **No bulk delete or multi-select.** FR-013 is singular, and the roadmap sizes the list at dozens.
- **No sorting controls, no filters beyond the text query, no tags or folders.**
- **No search across assortment contents.** FR-012 is by name; matching also covers the category
  label so a rename does not blind it, and stops there — searching item names is a different
  feature nothing asks for.
- **No fuzzy or typo-tolerant matching.** Normalized substring is the decision; scoring libraries
  and edit distance are out.
- **No persistence of the query.** It is transient view state, not merchant data.
- **No schema change of any kind**, and no new storage operation — `deleteMerchant` already exists.
- **No changes to the generator, the correction rules, or the assortment table.**
- **No jsdom, no widening of the Vitest glob.**

## Implementation Approach

Two phases, ordered by what survives a deadline cut rather than by the slice's title. Each is
independently shippable: Phase 1 closes FR-013 on its own, Phase 2 closes FR-012 on its own.

**Phase 1 is deliberately first** because a library nothing can be removed from is a worse v1 than
a library without search. A GM can want a mistaken save gone on day one; the search pressure the
PRD describes arrives after months.

**Matching rules go in `merchant-library.ts`** alongside S-04's sort and row projection —
the same module, extended rather than a new one, because they are the same concern. Normalization
is the only genuinely tricky code in this slice and it is pure, so it is fully covered by tests.

**No upstream file is amended.** `deleteMerchant` already exists in F-01 and `ConfirmDialog` is
already generic in S-02, so this slice only consumes both — a third call site and a button over an
existing operation. Earlier drafts specified renaming the dialog; that was settled upstream.

## Critical Implementation Details

**`ł` needs explicit handling in normalization.** `"Łuk".normalize("NFD")` leaves `Ł` intact
because U+0141 has no canonical decomposition — unlike every other Polish diacritic. Map `ł→l` and
`Ł→L` before or after the NFD pass. A test suite that only covers ź, ą and ę will pass while the
feature fails for any merchant named with an `ł`.

**Normalization must be applied to both sides, identically.** Normalizing the stored name but not
the query (or vice versa) silently under-matches, and the bug looks like "search is flaky" rather
than a rule error. Route both through the same function.

**State sequencing — remove the row only after the write returns `ok`.** On any other status the
row stays and a notice appears. Optimistic removal would show a merchant as deleted while it is
still in storage, and a reload would resurrect it.

**State sequencing — clear `openedSavedId` whenever a record leaves `saved`, not just on a local
delete.** If the deleted merchant was the open one, S-04's save button must stop offering to save
in place before the GM can press it; dispatching S-04's existing `"cleared-open"` event is what
flips its label back to adding a new entry.

State it as a rule about the *list*, not about this slice's delete handler, because there is a
second route: a delete performed in another tab reaches this one through S-03's `storage`
listener and S-04's list refresh, never touching the handler below. The check belongs where
`saved` is replaced — if `openedSavedId` is no longer present in the new list, clear it. That
covers the local delete, the cross-tab delete, and any future path that removes a record.

**User experience spec — separate the row's three tap zones.** After S-04 the row already carries
an inline-editable name and an open target; the delete control is a third. At 360 px they must not
overlap, and the delete control must not sit where a mis-tap while renaming would land on it.

## Phase 1: Delete

### Overview

Remove a saved merchant behind a confirmation that names it, handling write failures honestly and
fixing the dangling reference when the deleted merchant is the one currently open.
Completes **FR-013**, and is shippable without Phase 2.

### Changes Required:

#### 1. Third call site for the confirmation dialog

**File**: `src/components/MerchantGenerator.tsx` (modify)

**Intent**: A delete is irreversible here — no trash, no undo in storage — so it gets the same
confirmation S-02 built for discarding corrections and S-04 reused for opening a merchant. A third
call site, not a third component.

**Contract**: `ConfirmDialog` already takes `open`, `title`, `body`, `confirmLabel`, `destructive`,
`onConfirm` and `onCancel` (S-02 Phase 3), so **no change to the component is required**. Supply
copy naming the merchant about to be deleted, and set `destructive` so the confirming button is
not the one a stray Enter fires. The `cancel` event — Escape and backdrop — resolves to "do
nothing" on this path as it does on the other two.

**No rename.** Earlier drafts of this plan renamed the dialog a third time. S-02's plan review
named it `ConfirmDialog` with a generic prop surface from the start and S-04's removed its rename
step, so there is nothing to rename and no call site to sweep.

#### 2. Delete control

**File**: `src/components/MerchantLibrary.tsx` (modify — created by S-04 Phase 2)

**Intent**: Give each row a way to remove that merchant, without crowding the inline-editable name
S-04 put there.

**Contract**: A compact, destructive-styled icon button at the trailing edge of each row, using
`lucide-react` (already a dependency). Props gain an `onDelete(id)` callback.

The row now has three interaction zones — edit the name, open the merchant, delete it — which at
360 px must be visually and physically separated, with the delete control placed where a mis-tap
while renaming will not land on it. An accessible label naming the merchant, since an icon alone
does not say what it deletes.

#### 3. Delete wiring

**File**: `src/components/MerchantGenerator.tsx` (modify)

**Intent**: Perform the delete, tell the truth about whether it worked, and repair the opened-record
reference when the deleted merchant was the open one.

**Contract**: A pending-delete id in island state drives `ConfirmDialog` with copy naming the
merchant. Confirming calls F-01's `deleteMerchant`; cancelling clears the pending id and changes
nothing.

**The row is removed from `saved` only on `{ status: "ok" }.`** Any other status leaves the list
untouched and raises the matching `StorageNotice` — a `read-only` latch from a `future-version`
document must refuse the delete rather than appear to succeed.

**Clearing `openedSavedId` is a rule about the list, not about this handler.** Wherever `saved` is
replaced — after a local delete, and in S-04's cross-tab refresh — check whether `openedSavedId`
is still present in the new list and clear it via S-04's existing `"cleared-open"` event if it is
not. A delete performed in another tab reaches this one through S-03's `storage` listener without
passing through the handler here, so a rule scoped to the local delete would leave exactly the
dangling reference this slice exists to prevent.

Either way the assortment stays on screen; the save button reverts to offering to add it as a new
entry, which S-04's label contract already expresses.

A pending delete can also outlive its target: if another tab deletes the merchant while this tab's
confirmation is open, `deleteMerchant` is called on a record that is already gone. Treat a
not-found result as success for UI purposes — the GM's intent was for it to be absent and it is —
refreshing the list and raising no notice.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Route still prerendered: `index.html` exists under `dist/client/`
- Linting passes: `npm run lint`

#### Manual Verification:

- Deleting a merchant shows a confirmation naming it; cancelling leaves the list unchanged
- Confirming removes it from the list and from storage, verified after a reload
- The regenerate guard and the open guard still work with their own copy alongside the new delete call site
- Deleting the merchant currently open leaves the assortment on screen and flips the save button
  back to adding a new entry
- With storage blocked, a delete raises a notice and **the row stays in the list**
- Deleting the last merchant returns the panel to its empty state
- With two tabs open, deleting a merchant in one clears the other tab's opened-merchant state
  if that was the record deleted
- The three tap zones in a row are comfortably separated at 360 px, and renaming never triggers
  delete

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 2: Search

### Overview

Let the GM find a merchant by typing part of its name or kind, without diacritics.
Completes **FR-012** and closes **US-02**.

### Changes Required:

#### 1. Matching rules

**File**: `src/lib/merchant-library.ts` (modify — created by S-04 Phase 1)

**Intent**: The normalization and filter that decide whether search actually works at a table, kept
pure so the diacritic cases are assertable.

**Contract**:

- `normalizeForSearch(value: string): string` — lowercase, `normalize("NFD")` with combining marks
  stripped, **plus an explicit `ł`/`Ł` → `l` mapping**, and whitespace collapsed. `ł` has no
  canonical decomposition, so NFD alone leaves it intact and every `ł`-named merchant becomes
  unfindable while the rest of the rule appears to work.
- `matchesQuery(merchant, normalizedQuery, categoryLabel): boolean` — substring match of the
  normalized query against the normalized name **and** the normalized category label. Category is
  included because FR-010's rename otherwise blinds category-shaped searching: an auto-name
  carries "Kowal", a GM-chosen name does not.
- `filterMerchants(merchants, query)` — normalizes the query once, returns every match in
  `sortForLibrary` order. An empty or whitespace-only query returns the full list. Duplicate names
  all appear, since S-04 permits them.

#### 2. Filter input

**File**: `src/components/MerchantLibrary.tsx` (modify)

**Intent**: A place to type, at the top of the panel, that narrows the list as the GM types.

**Contract**: A `type="search"` input at the head of the panel, shown whenever the list is
non-empty, with a clear affordance. The query is component-local view state — not persisted, not
in F-01's document.

Filtering is immediate on input; no debounce is warranted over dozens of rows. While a query is
active, show how many merchants match, and replace an empty result with a short hint rather than a
blank panel. Deleting a row while filtered simply removes it from the filtered view and leaves the
query in place.

#### 3. Matching tests

**File**: `src/lib/merchant-library.test.ts` (modify — created by S-04 Phase 1)

**Intent**: Cover the normalization cases whose failure is invisible — the feature returns zero
results and looks like a GM typo.

**Contract**: `normalizeForSearch` strips every Polish diacritic — ą ć ę ń ó ś ź ż — **and has its
own explicit case for `ł` and `Ł`**, asserted separately so an NFD-only implementation fails the
suite. Case is folded; whitespace collapsed.

`filterMerchants`: an empty and a whitespace-only query return everything; a diacritic-free query
finds a diacritic-bearing name ("kuznia" finds "Kuźnia"); the reverse also holds; a category-label
query finds a renamed merchant whose name no longer contains it; **two merchants sharing a name are
both returned**; a non-matching query returns an empty array; results keep `sortForLibrary` order.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the explicit `ł` case: `npm test`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Typing part of a name narrows the list as you type
- Typing without diacritics finds a merchant whose name has them — specifically, a name containing
  `ł` is found by typing `l`
- Typing a category word finds a merchant that was renamed away from it
- Two merchants sharing a name both appear
- Clearing the query restores the full list
- A query matching nothing shows a hint, not a blank panel
- Deleting a row while a query is active removes it and leaves the query in place
- The input and the narrowed list are comfortable at 360 px and do not push the assortment below
  the fold

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- `normalizeForSearch`: every Polish diacritic stripped; **`ł` and `Ł` asserted in their own case**
  so an NFD-only implementation fails; case folded; whitespace collapsed
- `filterMerchants`: empty and whitespace-only queries return all; diacritic-free query matches a
  diacritic-bearing name and vice versa; a category-label query matches a renamed merchant;
  duplicate names both returned; no-match returns empty; order preserved from `sortForLibrary`
- `matchesQuery`: matches on name, matches on category label, rejects a query matching neither

### Integration Tests:

None. The panel, dialog and effects are `.tsx` and the harness has no jsdom — the same boundary
every earlier slice drew. Covered by the manual steps.

### Manual Testing Steps:

1. Save three merchants, one with `ł` in its name and one renamed away from its category
2. Delete one; confirm the dialog names it; cancel and confirm nothing changed
3. Repeat and confirm; reload and confirm it is gone from storage
4. Verify the regenerate guard and the open guard still work alongside the new delete call site
5. Open a merchant, then delete it; confirm the assortment stays and the save button reverts to
   adding a new entry; press it and confirm a new entry appears
6. Block site data; attempt a delete; confirm a notice appears and the row stays
7. Delete every merchant; confirm the panel shows its empty state
8. Type part of a name; confirm the list narrows
9. Type the `ł` name without the `ł`; confirm it is found
10. Type a category word; confirm the renamed merchant is found
11. Give two merchants the same name; confirm a query returns both
12. Clear the query; confirm the full list returns
13. Type something matching nothing; confirm a hint, not a blank panel
14. Repeat 2–13 at 360 px, checking that renaming never triggers delete
15. `npm run build` then `npx wrangler dev`; confirm the same behaviour on the workerd runtime

## Performance Considerations

Filtering runs over dozens of in-memory records on each keystroke — microseconds, so no debounce
and no memoization are warranted. Normalizing the query once per keystroke rather than per row is
the only thing worth getting right, and it falls out of `filterMerchants` taking the raw query.

Delete is one `deleteMerchant`, which rewrites F-01's single document. At v1 scale that is
immaterial and is the trade F-01 made for atomic writes.

Nothing here touches the PRD's 5-second criterion, which concerns generation.

## Migration Notes

**No schema change and no new storage operation.** `deleteMerchant` already exists in F-01, the
query is transient view state, and nothing is added to the document — so `AGENTS.md`'s forward-only
rule is untouched.

This slice is where a merchant can finally leave storage. F-01 deliberately never evicts, and its
quota-exhaustion path assumes the GM has a way to free space; until this ships, that assumption is
unmet and the only remedy for a full store is clearing site data — which destroys everything.

**This slice renames nothing and amends no upstream file.** Earlier drafts renamed the
confirmation dialog a third time; S-02's plan review named it `ConfirmDialog` with a generic prop
surface from the start, and S-04's review dropped its rename. `ConfirmDialog` is still the shared
touch point across S-02, S-04 and S-05 — three call sites, one component — so if any of those
plans is re-planned, that is the file to check.

## References

- Roadmap item: `context/foundation/roadmap.md:235-252` (S-05), backlog row at line 263; its listed
  unknown — whether delete needs a confirmation — is settled by this plan
- Change identity: `context/changes/merchant-search-and-delete/change.md`
- **Upstream contracts**: `context/changes/saved-merchants-library/plan.md` (library panel,
  `merchant-library.ts`, `openedSavedId`, duplicate names permitted),
  `context/changes/merchant-storage-contract/plan.md` (`deleteMerchant`, write-status union, never
  evicts), `context/changes/last-merchant-persists/plan.md` (`StorageNotice`, `"cleared-open"`),
  `context/changes/manual-item-corrections/plan.md` (the dialog's origin)
- PRD: `context/foundation/prd.md:194-205` — FR-012 and FR-013 with their Socrates rationale;
  US-02's criterion that a merchant does not disappear without an explicit delete
- Category labels for matching: `src/data/items.ts:25-30`
- Deadline context: roadmap Open Roadmap Questions #1 and the S-05 risk note — sequenced last, but
  explicitly *not* a candidate for deletion
- Forward-only storage rule: `AGENTS.md:15`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Delete

#### Automated

- [ ] 1.1 Unit tests pass: `npm test`
- [ ] 1.2 Type checking passes: `npx astro check`
- [ ] 1.3 Production build succeeds: `npm run build`
- [ ] 1.4 Route still prerendered: `index.html` under `dist/client/`
- [ ] 1.6 Linting passes: `npm run lint`

#### Manual

- [ ] 1.7 Delete shows a confirmation naming the merchant; cancel changes nothing
- [ ] 1.8 Confirm removes it from the list and from storage, verified after reload
- [ ] 1.9 Regenerate guard and open guard still work alongside the new delete call site
- [ ] 1.10 Deleting the open merchant keeps the assortment and reverts the save button
- [ ] 1.11 Storage blocked: notice appears and the row stays in the list
- [ ] 1.12 Deleting the last merchant returns the panel to its empty state
- [ ] 1.13 Cross-tab delete clears the other tab's opened-merchant state
- [ ] 1.14 Three tap zones separated at 360 px; renaming never triggers delete

### Phase 2: Search

#### Automated

- [ ] 2.1 Unit tests pass including the explicit `ł` case: `npm test`
- [ ] 2.2 Type checking passes: `npx astro check`
- [ ] 2.3 Production build succeeds: `npm run build`
- [ ] 2.4 Linting passes: `npm run lint`

#### Manual

- [ ] 2.5 Typing part of a name narrows the list
- [ ] 2.6 A name containing `ł` is found by typing `l`
- [ ] 2.7 A category word finds a merchant renamed away from it
- [ ] 2.8 Two merchants sharing a name both appear
- [ ] 2.9 Clearing the query restores the full list
- [ ] 2.10 A no-match query shows a hint, not a blank panel
- [ ] 2.11 Deleting while filtered removes the row and keeps the query
- [ ] 2.12 Input and narrowed list comfortable at 360 px without pushing the table below the fold
