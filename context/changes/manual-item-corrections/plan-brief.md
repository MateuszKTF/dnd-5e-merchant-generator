# Ręczne korekty, których nie da się zgubić — Plan Brief

> Full plan: `context/changes/manual-item-corrections/plan.md`
> Upstream contracts: `context/changes/first-generated-assortment/plan.md` (S-01, not yet built)

## What & Why

Roadmap slice **S-02**: the GM corrects the price or quantity of a single row (FR-008), and
"Stwórz" asks before discarding those corrections instead of wiping them silently (FR-006).
The PRD bundles the two deliberately — a manual correction is the only work in the product the
tool **cannot recreate**. Every generated value can be re-drawn; a GM's judgement about a price
cannot. So FR-006 is not a courtesy dialog, it is the guardrail applied to the one genuinely
unrecoverable thing.

## Starting Point

**S-01 is planned but not implemented.** `src/lib/` holds only `utils.ts`; there is no
`assortment.ts`, no `format-price.ts`, no island, no Vitest, and `index.astro` still renders the
starter placeholder. Every contract this slice attaches to — `AssortmentRow`,
`MerchantGenerator`, `MerchantTable`, `formatPrice` — exists only in the S-01 plan. If those
shift during S-01 implementation, this plan shifts with them.

## Desired End State

The GM generates a shop, taps a wrong price, types a new number in the unit already shown, and
moves on — the corrected cell is quietly marked. Quantity works the same way, and 0 records a
shelf the players cleared. Nonsense or a cleared field restores the previous value instead of
breaking the table. Pressing "Stwórz" then asks whether to discard the corrections; cancelling
leaves everything exactly as it was. Edit a value back to its original and the warning stops —
because nothing is actually at risk.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Edit UX | Always-editable borderless number inputs | No edit-mode state machine, no tap target to discover, no modal — cheapest credible path for the FR the PRD calls the most expensive in v1. |
| Price unit | The unit already displayed (gp/sp/cp) | The GM never types a decimal and never sees a unit they did not already read. |
| Quantity range | Integer 0–99, **0 = sold out** | Matches how a shop behaves once players clear a shelf; the ceiling stops a fat-finger from wrecking column width. |
| Invalid input | Snap back to previous value on blur | The table can never enter a broken state and no error UI is needed; nothing is lost, only an incomplete entry discarded. |
| Dirty detection | Compare against the generated value | The GM is never warned about nothing — repeated false warnings are how a confirm dialog becomes something people click through blindly. |
| Confirm trigger | **Any** Generate that would discard corrections | FR-006's literal "same category" reading leaves a real loss path open, since changing category and generating destroys corrections just as thoroughly. |
| Dialog | Generic `ConfirmDialog` on native `<dialog>` | Focus trapping, Escape and a backdrop for zero new dependencies; only `@radix-ui/react-slot` is installed today. |
| State shape | Overlay keyed by `itemId`, rows immutable | Originals survive, so honest dirty checking and a future revert are free; F-01 mirrors this shape in storage. |
| Marking | Subtle per-cell marker | The GM can see what the confirmation is about to discard — the guardrail's intent, not just its letter. |
| Revert | None in this slice | The PRD does not ask for it and the roadmap names this slice the first scope-cut candidate; the overlay makes it trivial to add later. |
| Tests | Pure module in `src/lib`, no jsdom | The S-01 Vitest glob only collects `.ts`, and the cases that decide whether the dialog fires are exactly the ones that fail silently. |

## Scope

**In scope:** `src/lib/corrections.ts` (merge, dirty detection in integer copper, clamping);
a reusable editable cell; overlay state in the island; corrected-cell marking; a generic
`ConfirmDialog` on native `<dialog>` gating every Generate.

**Out of scope:** any persistence (F-01, S-03 — including making corrections survive a save or a
closed tab); revert/undo of any kind; editing names, rarity, or the row set; adding or deleting
rows; edit history; changes to the generator or catalog; island/browser tests; saved-merchant
list, naming, search, delete (S-04, S-05).

## Architecture / Approach

```
generated rows (immutable)  ─┐
                             ├─► mergeCorrections() ─► MerchantTable ─► PriceQuantityCell
CorrectionMap {itemId: {…}} ─┘                              │              (local draft,
        ▲                                                   │               commit on blur)
        └────────── onCorrect(itemId, patch) ◄──────────────┘

Generate ─► hasCorrections() ? ConfirmDialog (<dialog>) : draw
                                   confirm ─► draw + clear overlay (one commit)
                                   cancel  ─► nothing changes
```

Generated rows are never mutated; an overlay keyed by `itemId` holds the overrides and every
render merges the two. That one choice buys honest dirty detection, a clean F-01 handoff, and a
cheap future revert. All the rules that decide whether the dialog fires live in a pure `.ts`
module so they are unit-testable.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Correction logic + tests | `corrections.ts` + unit tests — no UI | Float price comparison; a reverted edit must not stay dirty forever, or the dialog fires on a clean list |
| 2. Editable cells | Editable quantity/price with markers — **completes FR-008** | Two edit fields at 360 px against the one NFR; the draft-on-blur pattern is what makes snap-back work |
| 3. Confirmation | Gated Generate — **completes FR-006**, closes the guardrail | Escape and backdrop must behave as Cancel, or the pending Generate is dropped silently |

**Prerequisites:** **S-01 must be implemented first** — at minimum its Phases 1–2, since this
slice modifies `MerchantTable.tsx` and `MerchantGenerator.tsx`, consumes `format-price.ts`, and relies on
Vitest being configured. The roadmap marks S-02 `Ready for /10x-plan: no` for exactly this
reason.

**Estimated effort:** ~1–2 sessions across 3 phases. Phase 2 is the bulk; Phase 3 is small but
carries the guardrail and deserves its own manual gate.

## Open Risks & Assumptions

- **This plan targets contracts that do not exist yet.** S-01 must ship first; it already
  provides `priceParts`/`partsToGp`, so no amendment to an upstream module is needed — but if
  S-01's contracts shift during implementation, this plan shifts with them.
- **The price unit is pinned to the generated value, not recomputed.** Otherwise the field's
  unit would flip mid-edit and break the input. Accepted cost: a 1 cp candle corrected to 5 gp
  renders as `500 cp`.
- **Dirty detection depends on integer-copper comparison.** Prices are routinely fractional
  (base 0.01 gp × a 1.2 wealth modifier), so naive float equality would leave a reverted edit
  permanently dirty and fire the dialog on a list with no corrections.
- **`itemId` uniqueness within a list is load-bearing** — it is both the React key and the
  overlay key. If S-01's FR-004 uniqueness guarantee ever weakens, this slice breaks silently.
- **F-01 has settled the flatten question**: it persists generated rows plus the overlay, so the
  corrected-cell marker survives a reload once S-03 lands.
- **This is the declared scope-cut candidate.** Both PRD Open Question #1 and roadmap Open
  Roadmap Question #1 name FR-008 as the most expensive item in v1 against a 2026-09-13
  deadline. Phase 3 alone is nearly worthless without Phase 2, but Phase 2 without Phase 3
  ships a known silent-loss path — so if this slice is cut, cut it whole.

## Success Criteria (Summary)

- The GM can fix a wrong price or quantity in place, on a phone, and see which cells they
  changed.
- No correction is ever discarded without the GM being asked first — on any Generate, not just
  a same-category reroll.
- The GM is never asked about corrections that no longer exist.
