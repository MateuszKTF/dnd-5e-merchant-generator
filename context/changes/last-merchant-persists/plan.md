# Ostatni kupiec wraca sam — Implementation Plan

## Overview

Deliver roadmap slice **S-03**: the GM can close the browser tab mid-session and, on reopening,
find the last generated merchant exactly as they left it — manual corrections included — and
mark it durable with an explicit save (US-03, FR-009).

This is the slice that closes the PRD's hardest guardrail: *"zapisany kupiec nigdy nie znika po
cichu"*. The PRD calls losing a saved merchant a heavier regression than a weak assortment, and
FR-009's own rationale names the realistic failure — a GM mid-session does not click save, they
close the tab.

Architecturally this slice is **wiring**. F-01 owns the storage contract and every failure mode,
S-01 the generator, S-02 the corrections. S-03 connects them and surfaces what F-01 reports.

## Current State Analysis

**Nothing is implemented yet.** `src/lib/` holds only `utils.ts`; `src/components/` holds the
starter placeholder. All three prerequisite slices exist as plans only.

This slice therefore attaches to planned contracts:

| Contract | From | Used here for |
| --- | --- | --- |
| `Merchant`, `StoredRow`, `StoredCorrections`, `autoName`, row mappers | F-01 `src/lib/merchant.ts` | the restored/persisted value |
| `readDocument`, `putTransient`, `promoteTransient`, status unions | F-01 `src/lib/merchant-storage.ts` | every read and write |
| `MerchantGenerator.tsx` state (`category`, `wealth`, `rows`, `recentIds`) | S-01 | host for restore and persist |
| `corrections: CorrectionMap`, `hasCorrections` | S-02 | corrections must survive (US-03) |
| `ConfirmDialog` gating Generate | S-02 | the draw happens on confirm, not on the button |
| `CATEGORIES`, `WEALTH_LEVELS` | `src/data/items.ts:25-35` | validating a restored enum |

**Constraints discovered:**

- **The roadmap's named unknown for this slice is already closed.** `roadmap.md:208-211` asks
  whether explicit save creates a new entry or flags the existing automatic one. F-01 settled it
  as **promote a copy into the saved set**, because it determined the entity shape. This plan
  does not reopen it — but it does own the consequence (see Key Discoveries).
- **S-01 reserved the mount path for this slice.** Its plan states the island must not
  auto-generate on mount, explicitly so S-03 can restore there instead. The two plans agree and
  this slice takes that path over.
- **The island mounts `client:load`** (S-01 plan), which Astro also renders server-side during
  prerender. Any client-only read during the first render is a hydration mismatch.
- **Forward-only storage** (`AGENTS.md:15`) means this slice must not add fields to F-01's
  document to solve a UI problem.
- **The S-01 Vitest glob is `src/**/*.test.ts`** with no jsdom, so `.tsx` wiring is
  unreachable — hence the extracted decision module.
- **Line endings are normalized by S-01 Phase 1** (`.gitattributes`, `* text=auto eol=lf`), and
  S-03 runs strictly after S-01, so `npm run lint` is a real gate here with no caveat.

### Key Discoveries:

- **Promote-a-copy creates a double-save hazard that only exists here.** F-01 gives the
  operation; nothing upstream guards it. Two taps on Save produce two identical entries in
  S-04's list, and FR-013 delete is the only remedy. The guard is this slice's job.
- **A failed promote must not disarm the Save button.** If `promoteTransient` returns
  `quota-exceeded` or `read-only`, nothing was saved — showing "Zapisano" over an unsaved
  merchant is the guardrail violation wearing a green checkmark.
- **Persisting via an effect on state would write back the restore.** An effect keyed on
  `rows`/`corrections` fires immediately after restore populates them. Harmless alone, but in a
  cross-tab race it overwrites a newer document with older data. Writing imperatively at the two
  action sites removes the problem instead of managing it.
- **Restore must be read-only and idempotent.** React 19 runs effects twice under dev
  StrictMode; a restore that wrote would double-write.
- **`recentIds` does not survive a reload.** S-01 keeps the recency bias in React state only, so
  the first Generate after reopening is the one most likely to hand back the list the GM is
  staring at — precisely what the bias was added to prevent.
- **Self-contained rows make a stale enum survivable.** Because F-01 denormalizes `name` and
  `rarity` into each row, a restored merchant whose `category` is no longer in `CATEGORIES`
  still renders its table; only the select cannot match it.
- **Multi-tab clobbering is unaddressed anywhere upstream.** One key, two tabs auto-persisting:
  the later write destroys the earlier tab's merchant and its corrections. The PRD never raises
  it, but "corrections silently lost" is inside the guardrail regardless of the route.
- **`future-version` must stand the whole write path down**, not just Save — F-01 latches
  read-only for the page load, and persisting anyway would overwrite the data that latch exists
  to protect.

## Desired End State

A GM generates a shop mid-session, corrects two prices, and closes the tab because the players
moved on. Reopening the app later, the merchant is already on screen — same rows, same
corrections, still marked as corrected — with the category and wealth controls set to match. No
action was required to get it back. Pressing "Stwórz" produces a visibly different shop rather
than the one just restored.

A "Zapisz" button marks the merchant durable and then reads as saved until the merchant changes.
Pressing it twice cannot produce two copies.

If storage is off, full, holding data from a newer build, or was found corrupt, the GM is told
which of those happened in plain Polish, and the app keeps working. If another tab overwrites
the merchant, this tab notices rather than silently diverging.

**Verification:** `npm test` covers the restore, stale-enum and save-armed rules;
`npx astro check` and `npm run build` pass; manual testing covers tab close/reopen, blocked site
data, a hand-edited document, and two tabs.

## What We're NOT Doing

- **No saved-merchant list, no rename, no search, no delete UI** — S-04 and S-05. This slice
  writes into the saved collection but never displays it. A GM can save and will not see the
  result until S-04 lands; that is the intended boundary.
- **No changes to F-01's document schema.** Forward-only means no field is added to solve a UI
  problem here — this is why the promoted flag is session state and the recency set is not
  persisted.
- **No new storage operations.** `readDocument`, `putTransient` and `promoteTransient` are used
  as F-01 defines them; `renameMerchant` and `deleteMerchant` are left for S-04/S-05.
- **No cross-session double-save guard.** The promoted flag is session state, so saving the same
  restored merchant again in a later session produces a second copy. Accepted and documented —
  closing it would mean either a schema field or a content-equality rule inside F-01, neither of
  which this slice owns.
- **No export/import, no cloud sync** — PRD Open Question #3, parked to v2.
- **No changes to the generator or the correction rules.** `assortment.ts` and `corrections.ts`
  are read, not modified.
- **No jsdom, no widening of the Vitest glob**, and no tests of effects or the storage listener.
- **No debouncing or write batching.** The chosen policy writes on discrete GM actions, which
  are already infrequent because S-02 commits on blur.

## Implementation Approach

Three phases: the decision rules first as a pure module, then the invisible half (restore and
auto-persist), then the visible half (Save and the notices).

**Decisions are extracted into a pure `.ts` module** because the `.tsx` island is unreachable by
the test harness, and because F-01 and S-02 both did the same for the same reason. What restores,
whether a stale enum needs resetting, and whether Save is armed are rules — assertable in
isolation. The effects and the storage listener stay in the island and stay covered by manual
steps only; that split is deliberate, not an oversight.

**Writes happen imperatively at the two action sites** — after a draw and after a committed
correction — not in an effect watching state. This matches the chosen policy exactly and avoids
writing back what restore just read.

**Every storage outcome is surfaced.** F-01 deliberately returns a discriminated union instead
of throwing, so this slice `switch`es over it exhaustively and renders one notice per case. That
is the whole reason F-01 shipped no UI.

## Critical Implementation Details

**State sequencing — restore writes nothing, and persistence must not fire on it.** The restore
effect reads storage and sets state; it must not call `putTransient`, and no effect may persist
in response to the state it sets. Persist only from the generate handler and the correction
handler. Getting this wrong turns every page load into a write, which in a two-tab session
overwrites the newer document with the older one.

**Timing & lifecycle — the restore effect must be idempotent.** React 19 double-invokes effects
in dev StrictMode. Restoring twice from the same document is harmless only because restore is
read-only; keep it that way rather than guarding with a ref.

**State sequencing — Save disarms only on a successful promote.** Check
`promoteTransient`'s returned status. On `quota-exceeded`, `unavailable` or `read-only`, leave
Save armed and raise the matching notice. A disarmed button over an unsaved merchant is worse
than no button.

**Timing & lifecycle — the `storage` event fires only in other documents.** It never fires in
the tab that wrote, so it needs no self-filtering — but it does fire for *any* key on the
origin, so the handler must check the key before re-reading.

**User experience spec — the empty state is reachable and must stay distinguishable from a
restore that found nothing.** A first-ever visit and a visit after the GM cleared site data both
render empty, and neither is an error. Only F-01's `quarantined` and `future-version` statuses
mean "you had data and it is not being shown".

## Phase 1: Session decision module

### Overview

The rules that govern restore and the save button, as a pure module. No React, no storage
access, no UI.

### Changes Required:

#### 1. Session decisions

**File**: `src/lib/merchant-session.ts` (new)

**Intent**: Hold every decision this slice makes as a pure function, so the stale-enum and
save-armed rules are unit-testable despite the island being unreachable by the test glob.

**Contract**:

- `restoreFromDocument(doc)` → `{ merchant, category, wealth, recentIds, categoryWasReset, wealthWasReset }`
  or `null` when the document has no transient record. Derives the controls from the merchant,
  falling back to the first entry of `CATEGORIES` / `WEALTH_LEVELS` when the stored value is not
  a member, and flags that it did so. Seeds `recentIds` from the merchant's own row ids so the
  first Generate after reopening produces a different shop.
- `isKnownCategory(value) / isKnownWealth(value)` — membership checks against
  `src/data/items.ts`. Narrow types so the caller gets `CategoryId` / `Wealth`, not `string`.
- `SaveState` — `"unavailable" | "armed" | "saved"`. `"unavailable"` when there is nothing
  generated or persistence is standing down; `"armed"` when a merchant exists and has not been
  promoted; `"saved"` after a successful promote.

  **Only `future-version` stands persistence down — not `unavailable` or `quota-exceeded`, and
  the asymmetry is deliberate.** `future-version` means *do not write, a write would destroy data
  a newer build owns*, so the button must not invite the attempt. A disabled or full store means
  *the write will fail*, which is worth letting the GM discover by pressing Save and reading the
  notice — disarming there would hide a recoverable condition (free some space, re-enable site
  data) behind a dead control.
- `nextSaveState(current, event)` where `event` is `"generated" | "corrected" | "promoted" | "promote-failed" | "restored" | "persistence-off"`.
  Arms on `generated`, `corrected` and `restored`; moves to `saved` only on `promoted`; **stays
  armed on `promote-failed`**; goes to `unavailable` on `persistence-off`.

  The transition table is the whole point of this module: a promote that failed must not present
  as saved, and that is the one rule most likely to be written wrong inline.

  **Addendum (2026-09-12, impl review) — the shipped machine has four states, not three.**
  `5106527` itself added `stood-down` and made `persistence-off` reach it rather than
  `unavailable`; the commit message argues for it, so the deviation was conscious, but this
  contract text was never reconciled. The reason it needs a state of its own: `stood-down` is
  **absorbing**, and `unavailable` is not. A later Generate must not re-arm a button whose press
  cannot succeed, and with three states it would — `unavailable × generated → armed`. The
  asymmetry above is unaffected and still holds: only `future-version` fires `persistence-off`.

  Two further cells changed during the same review, both away from presenting a failure as a
  success. `saved × promote-failed` now re-arms instead of staying `saved` — the button does not
  say "saved once", and a write that just failed makes "saved" false however many succeeded
  before it. `saved × cleared-open` now re-arms too: `saved` means "the record I wrote to is in
  the library", so deleting that record makes the claim false, and leaving it as `saved` left the
  button reading "Zapisano" *and disabled* over a merchant nothing held.

#### 2. Module tests

**File**: `src/lib/merchant-session.test.ts` (new)

**Intent**: Assert the rules that would otherwise ship unverified on the slice closing the
guardrail.

**Contract**: `restoreFromDocument` returns `null` for an empty document; restores controls from
a valid merchant; resets an unknown `category` to the default **and** still returns the merchant
with its rows intact, with `categoryWasReset` true; same for `wealth`; seeds `recentIds` with
exactly the restored row ids. `nextSaveState` covers every event from every state, with explicit
assertions that `promote-failed` leaves `armed` and that `corrected` re-arms from `saved`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- The `nextSaveState` table is readable as a table — a reviewer can see at a glance that a
  failed promote does not reach `saved`
- `restoreFromDocument` makes clear that a stale enum degrades the controls, never the rows

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 2: Restore and auto-persist

### Overview

The invisible half. Restore the last merchant on mount with no GM action; persist on every
generate and every committed correction. Delivers US-03's first two acceptance criteria.

Storage-failure notices land in Phase 3 — during this phase a GM with storage disabled sees the
app work and persist nothing, silently. That gap is deliberate and closed next phase.

### Changes Required:

#### 1. Restore on mount

**File**: `src/components/MerchantGenerator.tsx` (modify — created by S-01 Phase 2)

**Intent**: Bring back the last merchant without any GM action, taking over the mount path S-01
deliberately left empty.

**Contract**: An effect after mount calls `readDocument()`, and on `{ status: "ok" }` passes the
document through `restoreFromDocument`, setting `rows`, `corrections`, `category`, `wealth` and
`recentIds` from the result. The effect is **read-only** — it must not call `putTransient` —
and must be safe to run twice under dev StrictMode.

Restoring in an effect rather than a lazy `useState` initializer is required: the island is
server-rendered during prerender, so a client-only read during first render is a hydration
mismatch. The cost is a brief empty state before the swap, which is acceptable because
`localStorage` is synchronous and the swap lands in the same frame as hydration.

Non-`ok` statuses are read here and held in state for Phase 3 to render; this phase may leave
them unrendered but must not discard them.

#### 2. Persist on action

**File**: `src/components/MerchantGenerator.tsx` (modify)

**Intent**: Make sure nothing the GM does exists only in memory, because the realistic loss is
a mobile OS killing a backgrounded tab — an event that fires no lifecycle hook.

**Contract**: Call `putTransient` from exactly two places: **the confirmed-draw path**, after new
rows are set, and S-02's `onCorrect` handler, after the overlay is updated. Build the `Merchant`
with F-01's `toStoredRows` and `autoName`, preserving the restored merchant's `id` and
`createdAt` when correcting a restored merchant, and minting new ones on a fresh draw.

**"Confirmed-draw path", not "the Generate button."** By the time this slice runs, S-02 has
wrapped Generate in `ConfirmDialog`: pressing the button when corrections exist opens the dialog
and draws nothing. The write belongs where the draw actually happens — the ungated branch when
no corrections exist, and the dialog's confirm callback when they do. Wiring it to the button
handler would persist stale rows on a gated press and skip the write on the confirmed one.

**No effect may persist in response to state changes** — see Critical Implementation Details.
Corrections commit on blur in S-02, not per keystroke, so this is a handful of writes per
session.

The returned status is held in state for Phase 3. A failed write never throws and never blocks
generation or editing.

#### 3. Save-state plumbing

**File**: `src/components/MerchantGenerator.tsx` (modify)

**Intent**: Track the save-armed state through `nextSaveState` so Phase 3's button has something
truthful to render.

**Contract**: Add `saveState: SaveState` to island state, driven exclusively by
`nextSaveState` — dispatch `"restored"` after a successful restore, `"generated"` after a draw,
`"corrected"` after a committed correction. No button exists yet in this phase.

**Addendum (2026-09-12, impl review) — four places the shipped code has moved past this phase's
contract. All four were deliberate; recorded here because this plan is what the next reader
treats as ground truth, and because Phase 1's contract got exactly this treatment while its
sibling did not.**

1. **`saveState` became `SaveSession`.** S-04 replaced the bare `SaveState` with
   `{ state, openedSavedId }` driven by `nextSaveSession`, which computes `state` by delegating to
   `nextSaveState`. The contract's "driven exclusively by `nextSaveState`" therefore still holds,
   one layer up — `setSaveState` does not exist and no call site assigns state directly.

2. **`putTransient` has four call sites, not two.** The two named here (confirmed draw, committed
   correction) plus two new *actions* that did not exist when this was written: opening a saved
   merchant (S-04) and relinking the transient after a promote (`corrections-autosave`). The
   invariant this clause protects — writes are imperative and attached to actions, never to an
   effect watching state — is intact.

3. **Criterion 2.11 was false as written and has been reworded.** "None on page load" was never
   true: `readDocument` probes writability with a real `setItem`/`removeItem` pair, which the plan
   never mentioned. "One per correction" stopped being true when correction autosave landed — a
   correction to an *open* record writes twice, deliberately, transient first. A criterion that
   always fails for reasons unrelated to any regression gets ignored, and then catches nothing.

4. **The write-and-session block is the extraction candidate.** `persist`, `handleSave`,
   `addMerchant`, `autosaveOpened`, `handleRename`, `deleteSavedMerchant`, `conditionFromFailure`
   and the `storedSession`/`saved`/`storageStatus`/`autosaveFailed` quartet are ~300 lines with no
   JSX, and five of this review's ten findings lived in them. They are untested only because they
   sit in a `.tsx` the Vitest glob cannot see. Lifted to `src/lib/merchant-writes.ts` as a reducer
   (state + event in, `{ state, writes[] }` out) they would fall inside the existing gate with no
   jsdom. Recorded as follow-up work, not done here.

### Success Criteria:

#### Automated Verification:

- Unit tests still pass: `npm test`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Route still prerendered: `index.html` exists under `dist/client/`
- Linting passes: `npm run lint`

#### Manual Verification:

- Generate a shop, close the tab, reopen: the same merchant is on screen with no GM action
- Correct two values, close the tab, reopen: the corrections are present **and still marked as
  corrected**
- The category and wealth controls come back matching the restored merchant
- Pressing "Stwórz" on a restored merchant produces a visibly different list
- No hydration warning appears in the browser console on load
- Devtools shows exactly one write per generate and one per committed correction — **none on
  page load**
- A first-ever visit shows the normal empty state, not an error

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 3: Explicit save and storage notices

### Overview

The visible half: the durability marker FR-009 requires, the four storage failure states F-01
reports, and cross-tab awareness. Completes FR-009 and closes the guardrail.

### Changes Required:

#### 1. Save action

**File**: `src/components/MerchantGenerator.tsx` (modify)

**Intent**: FR-009's explicit save — mark the current merchant durable — with a state the GM can
read, and without the double-save hazard promote-a-copy introduces.

**Contract**: A "Zapisz" button using the existing `Button` from `@/components/ui/button`,
rendered from `saveState`: hidden or disabled when `"unavailable"`, active when `"armed"`,
disabled and reading as saved when `"saved"`.

On press, call `promoteTransient` and dispatch `"promoted"` **only** on `{ status: "ok" }`;
anything else dispatches `"promote-failed"` and raises the matching notice. Any subsequent
generate or committed correction re-arms the button, so a changed merchant can be saved again.

The GM cannot see the saved collection until S-04 lands; the button's own state is the entire
feedback available, which is why its honesty matters.

#### 2. Storage notices

**File**: `src/components/StorageNotice.tsx` (new)

**Intent**: Tell the GM, in plain Polish, which storage problem occurred — the four statuses mean
genuinely different things and imply different actions.

**Contract**: Props take the current storage condition; renders nothing when there is none.
Distinct copy per case:

- `unavailable` — persistence is off on this device; the app works but merchants are not saved
- `quota-exceeded` — storage is full; deleting merchants would free space
- `future-version` — this device holds data from a newer version of the app; nothing will be
  written until the app is updated, and the existing data is untouched
- `quarantined` — saved data could not be read and has been set aside rather than deleted
- `unreadable` — saved data could not be read **and could not be set aside**, so nothing was
  changed; the data is still there and freeing space may make it recoverable. This is the
  quota-plus-corruption case F-01 added to protect: distinct from `quarantined` precisely
  because nothing was moved, and the GM should not be told their data was "set aside" when it
  was not
- cross-tab supersede (from change 3) — another tab replaced the current merchant

Persistent rather than a toast: a GM who misses it loses the session. It must not push the table
below the fold at 360 px.

#### 3. Cross-tab awareness

**File**: `src/components/MerchantGenerator.tsx` (modify)

**Intent**: Close the silent-loss path where a second tab's write destroys this tab's merchant
and its corrections.

**Contract**: An effect registers a `storage` event listener, filtered to F-01's key — the event
fires for every key on the origin and never in the tab that wrote, so it needs a key check but
no self-filtering.

The re-read returns the **same union as the mount read** and must be routed through the same
status handling: adopt the incoming transient record only on `ok`; on any other status raise the
matching notice and **leave local state untouched**. A tab that was working fine can re-read into
`quarantined`, `future-version` or `unreadable` mid-session — another tab may be running a newer
build, or the store may have filled since mount — and in none of those cases is there an
"incoming record" to adopt. Clearing the table on a failed re-read would destroy a merchant the
GM is reading from, using a failure in a *different* tab as the trigger.

On a successful adopt, if the local merchant had corrections that are being superseded, raise the
cross-tab
notice so the divergence is visible rather than silent. Remove the listener on unmount.

#### 4. Persistence stand-down

**File**: `src/components/MerchantGenerator.tsx` (modify)

**Intent**: Honour F-01's read-only latch. A `future-version` document must not be written to by
any path.

**Contract**: When the mount read returns `future-version`, dispatch `"persistence-off"` to the
save state and skip `putTransient` at both call sites for the remainder of the page load.
Generation and editing stay fully functional; only persistence stands down.

### Success Criteria:

#### Automated Verification:

- Unit tests still pass: `npm test`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Save marks the merchant durable; the button then reads as saved and cannot be pressed again
- Correcting a value or generating re-arms the button
- Pressing Save twice in a row produces exactly one entry in the stored document (checked in
  devtools, since S-04's list does not exist yet)
- With site data blocked, the `unavailable` notice appears and the app still generates and edits
- With a hand-edited higher `schemaVersion`, the `future-version` notice appears, Save is
  unavailable, and devtools shows **no writes at all** afterwards
- With a hand-edited garbage document, the `quarantined` notice appears and the side key holds
  the original bytes
- With two tabs open, a write in one is noticed by the other, and a superseded correction raises
  the cross-tab notice
- With a full store and a hand-corrupted document, the `unreadable` notice appears and says the
  data was left in place, not set aside
- A failed cross-tab re-read raises a notice and leaves the table on screen untouched
- Every notice is readable at 360 px and does not push the table below the fold

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- `restoreFromDocument`: `null` on an empty document; controls derived from a valid merchant;
  unknown `category` reset to default with the merchant and rows intact and `categoryWasReset`
  true; same for `wealth`; `recentIds` seeded with exactly the restored row ids
- `nextSaveState`: every event from every state, with explicit coverage that `promote-failed`
  leaves `armed`, `corrected` re-arms from `saved`, and `persistence-off` reaches `unavailable`
  from any state
- `isKnownCategory` / `isKnownWealth` narrow correctly and reject unknown strings

### Integration Tests:

None. The risky behaviour here is lifecycle — mount effects, the storage listener, hydration —
which the harness cannot reach without jsdom, and adding jsdom reverses a deliberate S-01
decision. Those paths are covered by the manual steps, which is why this slice has more manual
criteria than automated ones.

### Manual Testing Steps:

1. `npm run dev`, generate a shop, close the tab, reopen — the merchant returns unprompted
2. Correct two values, close the tab, reopen — corrections present and still marked
3. Confirm the controls match the restored merchant
4. Press "Stwórz" on a restored merchant — a visibly different list
5. Check the console for hydration warnings on load — there must be none
6. Watch devtools storage: one write per generate, one per committed correction, none on load
7. Press Save, confirm the button reads as saved; press again and confirm it cannot fire
8. Correct a value, confirm Save re-arms
9. Block site data in browser settings, reload — `unavailable` notice, app still usable
10. Hand-edit `schemaVersion` higher, reload — `future-version` notice, Save unavailable, and
    **no writes** thereafter
11. Replace the document with garbage, reload — `quarantined` notice, side key holds the original
12. Open two tabs, generate in one, confirm the other notices; correct in one and generate in the
    other, confirm the cross-tab notice
13. Repeat steps 1–8 at 360 px on a phone-sized viewport
14. `npm run build` then `npx wrangler dev` — same behaviour on the workerd runtime

## Performance Considerations

A write is one `JSON.stringify` of a document holding at most dozens of merchants plus one
synchronous `setItem` — sub-millisecond, fired on discrete GM actions rather than per keystroke.
F-01's single-key layout means each write rewrites the whole document; at v1 scale that is
immaterial and is the accepted trade for atomic writes.

Restore is one synchronous read during hydration, which is why the empty-state flash is a frame
rather than a spinner.

Nothing here touches the PRD's 5-second criterion, which concerns generation.

## Migration Notes

**This slice adds no fields to F-01's document and must not.** The format is forward-only
(`AGENTS.md:15`), so two pieces of state stay deliberately outside it:

- the **promoted flag**, which is why the double-save guard is session-scoped and why saving the
  same restored merchant in a later session produces a second copy — accepted, documented, and
  removable by FR-013 once S-05 lands;
- the **recency set**, which is reseeded from the restored rows on every mount rather than
  stored.

This slice is also the first real writer, so it is where F-01's format meets live data. After it
ships, every device that has used the app holds a v1 document, and the forward-only rule is
active for real: a later schema change needs its migration written first.

Rollback is a plain Worker rollback (`context/deployment/deploy-plan.md`) — and F-01's
`future-version` path plus this slice's persistence stand-down is exactly what makes that
survivable rather than destructive.

## References

- Roadmap item: `context/foundation/roadmap.md:198-216` (S-03), backlog row at line 261; note the
  item's listed unknown is closed by F-01
- Change identity: `context/changes/last-merchant-persists/change.md`
- **Upstream contracts**: `context/changes/merchant-storage-contract/plan.md` (entity, storage,
  status unions, promote-a-copy), `context/changes/first-generated-assortment/plan.md`
  (`AssortmentRow`, island state, the reserved mount path),
  `context/changes/manual-item-corrections/plan.md` (`CorrectionMap`, blur-commit timing)
- PRD: `context/foundation/prd.md` — US-03 with all three acceptance criteria, FR-009 and its
  Socrates rationale, `## Success Criteria / Guardrails`
- Enum sources for restore validation: `src/data/items.ts:25-35`
- Forward-only storage rule: `AGENTS.md:15`; `src/lib/` naming: `AGENTS.md:42`
- Rollback mechanics: `context/deployment/deploy-plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Session decision module

#### Automated

- [x] 1.1 Unit tests pass: `npm test` — 5106527
- [x] 1.2 Type checking passes: `npx astro check` — 5106527
- [x] 1.3 Production build succeeds: `npm run build` — 5106527
- [x] 1.4 Linting passes: `npm run lint` — 5106527

#### Manual

- [ ] 1.5 `nextSaveState` readable as a table; failed promote visibly cannot reach `saved`
- [ ] 1.6 `restoreFromDocument` makes clear a stale enum degrades controls, never rows

### Phase 2: Restore and auto-persist

#### Automated

- [x] 2.1 Unit tests still pass: `npm test` — 23bcabb
- [x] 2.2 Type checking passes: `npx astro check` — 23bcabb
- [x] 2.3 Production build succeeds: `npm run build` — 23bcabb
- [x] 2.4 Route still prerendered: `index.html` under `dist/client/` — 23bcabb
- [x] 2.5 Linting passes: `npm run lint` — 23bcabb

#### Manual

- [ ] 2.6 Generate, close tab, reopen: same merchant returns with no GM action
- [ ] 2.7 Corrections survive a tab close and are still marked as corrected
- [ ] 2.8 Controls come back matching the restored merchant
- [ ] 2.9 Generate on a restored merchant produces a visibly different list
- [ ] 2.10 No hydration warning in the console on load
- [ ] 2.11 One write per generate, one per correction, none on page load — **reworded 2026-09-12, see the Phase 2 addendum**: one write to `STORAGE_KEY` per generate; one per correction, or two when a saved record is open; and none to `STORAGE_KEY` on page load, though the writability probe does write and remove its own key on every read
- [ ] 2.12 First-ever visit shows the normal empty state, not an error

### Phase 3: Explicit save and storage notices

#### Automated

- [x] 3.1 Unit tests still pass: `npm test` — d278711
- [x] 3.2 Type checking passes: `npx astro check` — d278711
- [x] 3.3 Production build succeeds: `npm run build` — d278711
- [x] 3.4 Linting passes: `npm run lint` — d278711

#### Manual

- [ ] 3.5 Save marks durable; button then reads as saved and cannot re-fire
- [ ] 3.6 Correcting or generating re-arms the button
- [ ] 3.7 Two Save presses produce exactly one stored entry
- [ ] 3.8 Site data blocked: `unavailable` notice, app still generates and edits
- [ ] 3.9 Higher `schemaVersion`: `future-version` notice, Save unavailable, no writes at all
- [ ] 3.10 Garbage document: `quarantined` notice, side key holds original bytes
- [ ] 3.11 Two tabs: the other tab notices, and a superseded correction raises the notice
- [ ] 3.12 Full store + corrupt document: `unreadable` notice says data was left in place
- [ ] 3.13 Failed cross-tab re-read notices and leaves the table untouched
- [ ] 3.14 Every notice readable at 360 px without pushing the table below the fold
