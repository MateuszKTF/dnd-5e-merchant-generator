# Ręczne korekty, których nie da się zgubić — Implementation Plan

## Overview

Deliver roadmap slice **S-02**: the GM can correct the price or quantity of a single row
(FR-008), and clicking "Stwórz" asks for confirmation before discarding those corrections
instead of wiping them silently (FR-006).

The PRD bundles these two requirements deliberately. A manual correction is the only work in
the product the tool cannot recreate — every generated value can be re-drawn, but a GM's
judgement about a price cannot. FR-006 is therefore not a courtesy dialog; it is the guardrail
("zapisany kupiec nigdy nie znika po cichu") applied to the one thing that is genuinely
unrecoverable.

Corrections are held as an **overlay over immutable generated rows**, so the generated value
survives every edit. That single choice is what makes dirty detection honest, gives F-01 and
S-03 a real choice about what to persist, and keeps a future revert affordance cheap.

## Current State Analysis

**S-01 is planned but not implemented.** This is the central fact about this plan.

- `src/lib/` contains only `utils.ts` (`cn`). There is no `assortment.ts`, no
  `format-price.ts`, no `MerchantGenerator.tsx`, no `MerchantTable.tsx`.
- No test runner: `vitest` does not appear in `package.json`, there are zero test files, and
  `npm test` does not exist.
- `src/pages/index.astro:1-8` still renders the starter placeholder
  `src/components/Welcome.astro`, whose CTAs point at the deleted `/auth/signin`.

Everything this slice attaches to is therefore a **contract from
`context/changes/first-generated-assortment/plan.md`**, not code that can be read today:

| Contract | Defined in S-01 plan as | This slice needs it for |
| --- | --- | --- |
| `AssortmentRow` | `{ itemId, name, rarity, quantity, priceGp }`, `itemId` unique per list | overlay key, merge target |
| `MerchantGenerator.tsx` | state `category`, `wealth`, `rows: AssortmentRow[] \| null`, `recentIds` | hosts the overlay and the dialog |
| `MerchantTable.tsx` | presentation-only over `{ rows }`, three columns Nazwa/Ilość/Cena | becomes editable |
| `format-price.ts` | `formatPrice`, `priceParts`, `partsToGp` | price cell unit + parsing back |
| Vitest | `include` restricted to `src/**/*.test.ts` | excludes `.tsx`, forces pure modules |

**Constraints discovered:**

- **`formatPrice` already exposes its parts.** S-01's plan ships `priceParts(gp)` and
  `partsToGp(value, unit)` alongside `formatPrice`, with the round-trip invariant and its
  tests. Editing a price in the unit the GM is reading needs exactly those, so this slice
  consumes them rather than adding them — there is no amendment to make.
- **The Vitest glob excludes `.tsx`** (S-01 plan, Phase 1). Any logic needing coverage must
  live in a `.ts` module. This is why the correction rules are extracted rather than written
  inline in the island.
- **No dialog primitive exists.** `@radix-ui/react-slot` is the only Radix package in
  `package.json`; `src/components/ui/` holds only `button.tsx`. The native `<dialog>` element
  supplies focus trapping, Escape handling and a backdrop for zero new dependencies.
- **Changing category or wealth does not clear the table** in the S-01 design — only Generate
  replaces `rows`. So corrections are at risk on *every* Generate, which is broader than
  FR-006's literal "dla tej samej kategorii".
- **Floating-point prices.** Base prices go as low as 0.01 gp and are multiplied by a wealth
  modifier (1.2 / 1.0 / 0.9), so `priceGp` is routinely fractional. Naive float equality would
  make a reverted edit look permanently dirty.
- **Line endings are normalized by S-01.** Its Phase 1 adds `.gitattributes`
  (`* text=auto eol=lf`), so by the time this slice runs `npm run lint` passes cleanly on
  Windows and on CI. It is a real gate here, not a judgement call.
- **Browser-storage changes are forward-only** (`AGENTS.md`), which is one more reason this
  slice persists nothing: the overlay shape must not be frozen into storage before F-01
  designs the merchant entity.

### Key Discoveries:

- **The price unit must be pinned to the generated value, not recomputed from the corrected
  one.** If the unit were derived from the current price, editing a row upward from `5 sp`
  would flip the field's unit to `gp` mid-edit and break the input. Pinning is correct; the
  cost is that a 1 cp candle corrected to 5 gp renders as `500 cp`.
- **Dirty detection must compare integer copper**, i.e. `Math.round(gp * 100)`. A 0.5 gp price
  edited to `5 sp` and back must compare equal, and float arithmetic would otherwise leave the
  row dirty forever — which would fire the confirmation dialog on a list with no corrections.
- **Corrections never survive a Generate.** A new draw is a new shop; the overlay clears
  wholesale. There is no coherent reading where a correction re-attaches to a re-rolled item,
  and the confirmation exists precisely because that loss is real.
- **Commit on blur, not on keystroke.** A per-cell string draft committed on blur/Enter and
  reverted on Escape is what makes snap-back-on-invalid trivial. Committing every keystroke
  would push intermediate values (`2` while typing `20`) through the overlay.
- **`itemId` uniqueness within a list** (guaranteed by S-01, FR-004) is what makes it safe as
  both the React key and the overlay key. If S-01's uniqueness guarantee ever weakens, this
  slice breaks silently.

## Desired End State

The GM generates a shop, sees a price that is wrong for their table, taps it, types a new
number in the unit already shown, and moves on — the corrected cell is quietly marked so they
can see what they changed. Quantity works the same way, and setting a quantity to 0 records a
shelf the players cleared out. Typing nonsense or clearing a field restores the previous value
rather than breaking the table.

When they then press "Stwórz" — for any category, not just the same one — a dialog asks
whether to discard the corrections. Cancelling leaves the table exactly as it was. Confirming
replaces it with a fresh shop. If they have made no corrections, or edited a value back to its
original, Generate proceeds without a dialog.

**Verification:** `npm test` covers the merge, dirty-detection and validation rules including
the edit-and-revert case; `npx astro check` and `npm run build` pass; manual testing at 360 px
confirms the inputs are usable and the dialog cannot be bypassed.

## What We're NOT Doing

- **No persistence.** No `localStorage`, no merchant entity, no save action. F-01
  (`merchant-storage-contract`) owns the stored shape and S-03 (`last-merchant-persists`) owns
  persistence — including making corrections survive a closed tab (US-03) and a save (US-02).
  This slice leaves the overlay in memory; F-01 persists generated rows plus the overlay, so
  the corrected-cell marker survives a reload once S-03 lands.
- **No revert affordance** — no per-row undo, no revert-all. The PRD does not ask for it and
  the roadmap names this slice the first scope-cut candidate. The overlay makes it near-trivial
  to add later.
- **No editing of item names, rarity, or the row set.** No adding rows, no deleting rows. FR-008
  is price and quantity only; adding items is homebrew, which is a PRD Non-Goal.
- **No edit history, no undo stack.** FR-006's own rationale rejects full state history as too
  expensive: "chroni jedyną pracę nie do odtworzenia, bez kosztu pełnej historii stanu."
- **No changes to the generator or the catalog.** `src/lib/assortment.ts`,
  `src/data/items.generated.ts` and `scripts/build-item-catalog.mjs` are untouched.
- **No island or browser tests.** The Vitest glob stays `src/**/*.test.ts`; no jsdom, no
  Testing Library. That was a deliberate S-01 decision and this slice does not reverse it.
- **No saved-merchant list, naming, search or delete** — S-04, S-05.

## Implementation Approach

Three phases, each completing something verifiable; phases 2 and 3 each close one functional
requirement.

The correction rules are extracted into a **pure `.ts` module** rather than written inline in
the island, for two reasons: the Vitest glob only collects `.ts`, and the cases that decide
whether the dialog fires — edit-and-revert, float-equal prices, cleared fields — are exactly
the ones that fail silently in a plausible-looking UI.

The island keeps generated rows immutable and holds a separate overlay keyed by `itemId`. Every
render merges the two. This costs one merge step and buys three things: honest dirty detection,
a clean handoff to F-01, and a cheap future revert.

The confirmation is a native `<dialog>`. It is the only place in the slice where imperative DOM
calls meet React state, and it is deliberately confined to one component so that awkwardness
does not spread.

## Critical Implementation Details

**State sequencing — the overlay must clear in the same commit as the new rows.** On a
confirmed Generate, clearing the overlay and setting the new rows have to land together. If
the overlay clears first, one render shows the old rows unedited; if rows land first, one render
merges a stale overlay onto a fresh draw, briefly showing corrections attached to items the GM
never edited. Both are visible flickers on the guardrail path.

**User experience spec — the price field's unit is pinned per row.** Derive the unit once from
the *generated* `priceGp` and keep it for that row's lifetime. Recomputing it from the corrected
value makes the field's unit change while the GM is typing in it. Accept that a 1 cp item
corrected to 5 gp renders as `500 cp`.

**Timing & lifecycle — do not let the dialog's Escape path diverge from Cancel.** A native
`<dialog>` fires `cancel` on Escape and on backdrop dismissal, separately from any button's
click handler. Both must resolve to "do not regenerate"; wiring only the Cancel button leaves
Escape closing the dialog and dropping the pending Generate on the floor, which reads as the
button not working.

**Debug & observability — verify the dialog cannot be bypassed, not just that it appears.** The
guardrail is only closed if *every* path into a row replacement is gated. Check Generate after
changing category, after changing wealth, and with the same inputs unchanged.

## Phase 1: Correction logic and tests

### Overview

Build the correction rules as a pure, unit-tested module, consuming the price parts API S-01
already provides. No UI in this phase.

### Changes Required:
#### 1. Correction overlay rules

**File**: `src/lib/corrections.ts` (new)

**Intent**: All the logic that decides what a corrected list looks like and whether
corrections exist. Pure — no React, no DOM — so the Vitest glob picks it up and the silent
failure cases become assertable.

**Contract**:

- `Correction` — `{ quantity?: number; priceGp?: number }`. Absent field means not corrected.
- `CorrectionMap` — `Record<string, Correction>` keyed by `AssortmentRow.itemId`, safe because
  S-01 guarantees uniqueness within a list (FR-004).
- `mergeCorrections(rows: readonly AssortmentRow[], corrections: CorrectionMap): AssortmentRow[]`
  — returns rows with overrides applied, preserving order. Ignores keys with no matching row,
  so a stale overlay can never inject phantom items.
- `isCorrected(row: AssortmentRow, correction: Correction | undefined): { quantity: boolean; price: boolean }`
  — per-cell, true only when the override **differs** from the generated value. Prices compare
  as integer copper, `Math.round(gp * 100)`, never as raw floats. This is what makes editing a
  value back to its original clear the correction.
- `hasCorrections(rows, corrections): boolean` — whether any cell is corrected by the test
  above. The confirmation dialog's trigger, and the reason an edit-and-revert produces no
  warning.
- `clampQuantity(n: number): number | null` — integer 0–99; `0` is legal and means the shelf
  is cleared. Returns `null` for anything unusable (empty, non-numeric, negative, fractional,
  over 99) so the caller can restore the previous value.
- `clampPriceGp(gp: number): number | null` — legal range **0.01 gp to 999 999 gp** inclusive.
  The floor is 1 cp, matching `formatPrice`'s floor so no legal price can render as `0`; the
  ceiling is far above the catalog's 21 000 gp maximum but still fits the price column without
  wrapping. `null` on anything outside that range or unparseable.

The two clamp functions returning `null` rather than a coerced value is what implements
snap-back: the caller restores what was there instead of inventing a number the GM never typed.

#### 2. Rule tests

**File**: `src/lib/corrections.test.ts` (new)

**Intent**: Cover the cases that would otherwise ship as a plausible-looking table with a
dialog that fires at the wrong times.

**Contract**:

- `mergeCorrections` applies quantity-only, price-only and both; preserves row order; ignores
  overlay keys that match no row.
- **Edit-and-revert**: a price set to a new value then back to the generated one yields
  `hasCorrections === false`. Assert the same for quantity.
- **Float equality**: a 0.5 gp row whose correction round-trips through `sp` is not dirty; a
  price differing by less than 1 cp is not dirty; a price differing by 1 cp is.
- `clampQuantity` boundaries: `0` legal, `-1`, `1.5`, `100`, `NaN` and empty all `null`, `99`
  legal.
- `clampPriceGp` boundaries: `0.01` and `999999` legal; `0`, negatives and `1000000` all `null`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Reading `corrections.ts` alone makes the dirty-detection rule obvious — specifically that
  editing a value back to its original clears the correction
- The clamp bounds are justified by the catalog's real range, not invented

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 2: Editable cells

### Overview

Turn the quantity and price columns into edit fields, hold the overlay in the island, and mark
corrected cells. Completes **FR-008**.

### Changes Required:

#### 1. Editable numeric cell

**File**: `src/components/PriceQuantityCell.tsx` (new)

**Intent**: One reusable cell that renders a number as text until focused, accepts an edit, and
restores the previous value on unusable input. Shared by both columns so the two can never
drift in behaviour.

**Contract**: Props take the current numeric value, a fixed unit suffix (empty for quantity,
`gp`/`sp`/`cp` for price), a `corrected` flag, a validator returning `number | null`
(`clampQuantity` or `clampPriceGp` composed with `partsToGp`), a commit callback, and an
**accessible name**.

Each input must carry an accessible name identifying both the row and the field — "Ilość —
Bag of Holding", "Cena — Bag of Holding" — supplied by the table, which is the only component
that knows the item name. Without it a 25-row table presents 50 anonymous spin buttons and a
screen-reader user cannot tell which price they are editing. The visible cell shows only the
number, so the name is for assistive technology rather than layout; `eslint.config.js:83`
enables `flat/jsx-a11y-recommended`, so the project has already opted into caring about this.

The `corrected` marker must not be conveyed by colour alone — pair it with a non-colour cue or
include the corrected state in the accessible name, so the GM's own edits are distinguishable
without relying on hue.

Behaviour: an `<input type="number">` styled borderless so it reads as table text until
focused, becoming visibly a field on focus. Holds the in-progress text as a **local draft**;
commits on blur and on Enter; reverts the draft and blurs on Escape. On commit, run the
validator — a `number` calls the callback, `null` restores the displayed value and discards the
draft. `inputMode` set for a numeric keypad on mobile. The `corrected` flag drives the subtle
marker.

The draft is what makes snap-back possible: without it, an intermediate keystroke would already
have been committed to the overlay.

#### 2. Table wiring

**File**: `src/components/MerchantTable.tsx` (modify — created by S-01 Phase 2)

**Intent**: Render the merged rows with editable quantity and price cells, and report edits
upward. The table stays presentation-plus-events; it owns no correction state.

**Contract**: Props extend to `{ rows, corrections, onCorrect }` where `rows` are the
**generated** rows, `corrections` is the `CorrectionMap`, and `onCorrect(itemId, patch)`
reports a committed edit. The component calls `mergeCorrections` for display and `isCorrected`
per cell for the marker. Row keys are `itemId`.

The price cell's unit comes from `priceParts` of the **generated** `priceGp`, not the merged
value — see Critical Implementation Details. The Nazwa column stays plain text; three columns
only (FR-007).

#### 3. Overlay state

**File**: `src/components/MerchantGenerator.tsx` (modify — created by S-01 Phase 2)

**Intent**: Own the correction overlay next to the generated rows, and keep the generated rows
immutable so originals survive.

**Contract**: Add `corrections: CorrectionMap` to state, initialised empty. `onCorrect` merges
a patch for one `itemId`. A committed edit that restores a generated value may leave the key
present with an equal value — `isCorrected` and `hasCorrections` handle that by comparison, so
no key-pruning is required and none should be added.

On a Generate that proceeds (no corrections exist, so no dialog — the gated path is Phase 3),
reset `corrections` to empty **in the same state commit** as the new rows. Changing category or
wealth does not touch the overlay, because it does not replace rows either.

### Success Criteria:

#### Automated Verification:

- Unit tests still pass: `npm test`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Route is still prerendered: `index.html` exists under `dist/client/`
- Linting passes: `npm run lint`

#### Manual Verification:

- A price can be corrected by typing in the unit already shown, and the value sticks
- A quantity can be corrected, including to 0, and 0 looks deliberate rather than broken
- Clearing a field or typing nonsense restores the previous value on blur
- Enter commits; Escape abandons the edit and leaves the previous value
- Corrected cells are visibly marked, and the marker is legible without dominating the column
- The numeric keypad appears on a mobile device, not the full keyboard
- Editing a value and typing it back to the original removes the marker
- At 360 px the two edit columns remain usable and the table still does not scroll horizontally
- Each edit field announces its row and column in an accessibility inspector or screen reader,
  and the corrected marker is perceivable without relying on colour

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 3: Confirmation before regenerate

### Overview

Gate every row replacement behind a confirmation when corrections exist. Completes **FR-006**
and closes the PRD guardrail for the one thing the tool cannot recreate.

### Changes Required:

#### 1. Confirmation dialog

**File**: `src/components/ConfirmDialog.tsx` (new)

**Intent**: Ask the GM to confirm a destructive action, using the native `<dialog>` element so
focus trapping, Escape and a backdrop come for free with no new dependency.

**Contract**: Props are `open`, `title`, `body`, `confirmLabel`, `destructive`, `onConfirm` and
`onCancel`. A `ref` to the `<dialog>` drives `showModal()` / `close()` from an effect on `open`.

The element's `cancel` event — fired by Escape and by backdrop dismissal — must be wired to
`onCancel`, not left to the Cancel button alone. Both paths resolve to "do nothing".

Copy is supplied by the caller, not baked in. Two buttons using the existing `Button` from
`@/components/ui/button`; when `destructive` is set, the confirming action must not be the one
that fires on a stray Enter.

**Why generic with only one caller today.** S-04 (`saved-merchants-library`) needs this same
gate when opening a saved merchant over unsaved corrections, and S-05
(`merchant-search-and-delete`) needs it again to confirm a delete. Earlier drafts of those plans
each specified *renaming* this file and sweeping its call sites, plus a grep criterion to catch
stale references. Naming it correctly here removed two renames, two call-site sweeps and two
automated criteria from slices that already carry deadline exposure. The cost is four props
instead of one.

**Downstream note:** S-04 and S-05 have both been updated to match — each simply adds a call
site. `ConfirmDialog` is the shared touch point across the three slices: one component, three
callers, no renames.

#### 2. Gated Generate

**File**: `src/components/MerchantGenerator.tsx` (modify)

**Intent**: Route every Generate through the guard so no path can replace corrected rows
silently.

**Contract**: Add `confirmOpen: boolean` to state. The Generate handler calls
`hasCorrections(rows, corrections)`: false regenerates immediately, true opens the dialog
instead. Confirm performs the draw, replacing rows and clearing the overlay in one commit, then
closes the dialog. Cancel closes the dialog and changes nothing — not the rows, not the
overlay, not category or wealth.

The guard is on the Generate **action**, not on whether category or wealth changed. This is
knowingly a superset of FR-006's literal "dla tej samej kategorii", because changing category
and then generating destroys corrections just as thoroughly, and the guardrail does not
distinguish.

The recency bookkeeping from S-01 (`recentIds`) updates only on a draw that actually happens,
so a cancelled Generate must not touch it.

### Success Criteria:

#### Automated Verification:

- Unit tests still pass: `npm test`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- With no corrections, Generate proceeds with no dialog
- With a correction, Generate opens the dialog; confirming produces a fresh list with no
  markers left over; cancelling leaves the table and every correction untouched
- Escape and a backdrop click both behave as Cancel, leaving the table intact
- The dialog also appears when category or wealth was changed before clicking Generate
- After an edit-and-revert back to the original value, Generate proceeds with no dialog
- A cancelled Generate does not consume the recency bias — the next confirmed Generate still
  produces a visibly different list
- The dialog is readable and its buttons are comfortably tappable at 360 px
- Focus is trapped in the dialog while it is open, and returns sensibly on close

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- `mergeCorrections`: quantity-only, price-only, both; order preserved; overlay keys with no
  matching row ignored
- `hasCorrections` / `isCorrected`: the edit-and-revert case for both fields; integer-copper
  comparison so a sub-cp difference is not dirty and a 1 cp difference is
- `clampQuantity`: 0 legal, 99 legal, and `null` for −1, 1.5, 100, NaN, empty
- `clampPriceGp`: 0.01 and 999999 legal; `null` for 0, negatives and 1000000

### Integration Tests:

None. The Vitest glob stays `src/**/*.test.ts` and no jsdom or Testing Library is added — a
deliberate S-01 decision this slice does not reverse. The island and dialog are covered by the
manual steps below.

### Manual Testing Steps:

1. `npm run dev`, generate a shop
2. Correct a price by typing in the displayed unit; confirm it sticks and the cell is marked
3. Correct a quantity to 0; confirm it reads as deliberate
4. Clear a field and blur; confirm the previous value returns
5. Type nonsense, press Enter; confirm the previous value returns
6. Start an edit, press Escape; confirm the previous value stands
7. Press Generate; confirm the dialog appears, cancel it, confirm nothing changed
8. Press Generate again, confirm it; confirm a fresh list with no markers
9. Edit a price, type it back to the original, press Generate; confirm **no** dialog
10. Change category with corrections present, press Generate; confirm the dialog still appears
11. Open the dialog and press Escape; confirm it behaves as Cancel
12. Repeat steps 2–8 at 360 px on a real phone-sized viewport, checking the numeric keypad and
    that the table still does not scroll horizontally
13. `npm run build` then `npx wrangler dev`; confirm the same behaviour on the workerd runtime

## Performance Considerations

`mergeCorrections` runs per render over at most 25 rows — trivial. Each keystroke re-renders
one cell's local draft, not the table, because the draft lives in the cell. A committed edit
re-renders the table, which is 25 rows of plain markup.

Nothing here approaches the PRD's 5-second criterion, which concerns generation. No
memoization is warranted; adding it would be complexity without a measurable gain.

## Migration Notes

Nothing to migrate — this slice writes no persistent data, so the forward-only browser-storage
rule in `AGENTS.md` does not engage and a Worker rollback has no data consequences.

The overlay shape is the handoff to the persistence track, and **F-01 has since made the
choice**: its plan persists generated rows *plus* the overlay rather than the merged result
(`context/changes/merchant-storage-contract/plan.md:191`), so the distinction between generated
and corrected survives a save. The practical consequence for this slice is that the
corrected-cell marker keeps working after a reload once S-03 lands — the marker is not a
session-only affordance. `CorrectionMap` keyed by `itemId` is the shape F-01 mirrors.

`AssortmentRow` and `format-price.ts` are unchanged by this slice. The only added surface is
`corrections.ts`.

## References

- Roadmap item: `context/foundation/roadmap.md:177-196` (S-02), backlog row at line 260
- Change identity: `context/changes/manual-item-corrections/change.md`
- **Upstream contracts this plan depends on**:
  `context/changes/first-generated-assortment/plan.md` — `AssortmentRow` and the
  `MerchantGenerator` / `MerchantTable` / `format-price.ts` contracts
- PRD: `context/foundation/prd.md` — FR-006 and FR-008 with their Socrates rationale, US-02 and
  US-03 acceptance criteria on corrections surviving, `## Success Criteria / Guardrails`
- Scope-cut context: roadmap Open Roadmap Questions #1; PRD Open Questions #1 (both name
  FR-008 as the most expensive item in v1)
- Existing UI primitive: `src/components/ui/button.tsx`
- Lint and storage constraints: `AGENTS.md` § Hard rules

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Correction logic and tests

#### Automated

- [x] 1.1 Unit tests pass: `npm test` — f30dd7b
- [x] 1.2 Type checking passes: `npx astro check` — f30dd7b
- [x] 1.3 Production build succeeds: `npm run build` — f30dd7b
- [x] 1.4 Linting passes: `npm run lint` — f30dd7b

#### Manual

- [x] 1.5 `corrections.ts` makes the dirty-detection rule obvious on its own — f30dd7b
- [x] 1.6 Clamp bounds justified by the catalog's real range — f30dd7b

### Phase 2: Editable cells

#### Automated

- [x] 2.1 Unit tests still pass: `npm test` — 717af4a
- [x] 2.2 Type checking passes: `npx astro check` — 717af4a
- [x] 2.3 Production build succeeds: `npm run build` — 717af4a
- [x] 2.4 Route still prerendered: `index.html` under `dist/client/` — 717af4a
- [x] 2.5 Linting passes: `npm run lint` — 717af4a

#### Manual

- [ ] 2.6 Price corrected in the displayed unit, value sticks
- [ ] 2.7 Quantity corrected including 0, and 0 looks deliberate
- [ ] 2.8 Cleared or nonsense input restores the previous value on blur
- [ ] 2.9 Enter commits, Escape abandons the edit
- [ ] 2.10 Corrected cells visibly marked without dominating the column
- [ ] 2.11 Numeric keypad appears on a mobile device
- [ ] 2.12 Editing back to the original removes the marker
- [ ] 2.13 Edit columns usable at 360 px with no horizontal scroll
- [ ] 2.14 Each edit field announces its row and column; marker not colour-only

### Phase 3: Confirmation before regenerate

#### Automated

- [x] 3.1 Unit tests still pass: `npm test` — 76a2b22
- [x] 3.2 Type checking passes: `npx astro check` — 76a2b22
- [x] 3.3 Production build succeeds: `npm run build` — 76a2b22
- [x] 3.4 Linting passes: `npm run lint` — 76a2b22

#### Manual

- [ ] 3.5 No corrections means no dialog on Generate
- [ ] 3.6 Confirm produces a fresh list with no leftover markers; Cancel changes nothing
- [ ] 3.7 Escape and backdrop click both behave as Cancel
- [ ] 3.8 Dialog also appears when category or wealth changed before Generate
- [ ] 3.9 After edit-and-revert, Generate proceeds with no dialog
- [ ] 3.10 A cancelled Generate does not consume the recency bias
- [ ] 3.11 Dialog readable and buttons tappable at 360 px
- [ ] 3.12 Focus trapped while open and returned sensibly on close
