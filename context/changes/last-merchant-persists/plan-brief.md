# Ostatni kupiec wraca sam — Plan Brief

> Full plan: `context/changes/last-merchant-persists/plan.md`
> Upstream contracts: `merchant-storage-contract` (F-01), `first-generated-assortment` (S-01),
> `manual-item-corrections` (S-02) — all planned, none built

## What & Why

Roadmap slice **S-03**: the GM closes the browser tab mid-session and, on reopening, finds the
last generated merchant exactly as they left it — manual corrections included — and can mark it
durable with an explicit save (US-03, FR-009).

This is the slice that closes the PRD's hardest guardrail, *"zapisany kupiec nigdy nie znika po
cichu"* — named there as a heavier regression than a weak assortment. FR-009's rationale states
the realistic failure plainly: a GM mid-session does not click save, they close the tab.

## Starting Point

Nothing is implemented — `src/lib/` holds only `utils.ts`. All three prerequisites exist as
plans. Architecturally the hard work is already absorbed: F-01 owns the entity and every storage
failure mode, S-01 the generator, S-02 the corrections. **S-03 is wiring** — and S-01 already
reserved the mount path for it by declining to auto-generate there.

## Desired End State

A GM generates a shop, corrects two prices, closes the tab because the players moved on.
Reopening later, the merchant is already on screen — same rows, same corrections, still marked
as corrected, controls matching. No action needed to get it back, and pressing "Stwórz" gives a
visibly different shop rather than the one just restored. A "Zapisz" button marks it durable and
then reads as saved; pressing twice cannot make two copies. If storage is off, full, holding
newer data, or was found corrupt, the GM is told which — in plain Polish — and the app keeps
working.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Save semantics | Promote a copy into the saved set | Settled upstream because it determined the entity shape — the roadmap listed this as S-03's own unknown. | F-01 |
| Write timing | On generate and each committed correction | The only policy that survives a mobile OS killing a backgrounded tab, which fires no lifecycle hook. | Plan |
| Restore strategy | Effect after mount, brief empty state | The island is server-rendered during prerender, so a client-only first-render read is a hydration mismatch. | Plan |
| Stale enum | Show the table, reset the select | F-01 stores self-contained rows precisely so a readable merchant survives metadata the build no longer knows. | Plan |
| Double save | Track promoted state, disable the button | Promote-a-copy makes two taps into two entries, and the button's state is the GM's only feedback until S-04. | Plan |
| Failed promote | Leave Save armed | "Zapisano" over an unsaved merchant is the guardrail violation wearing a green checkmark. | Plan |
| Storage notices | Distinct copy per status (five, incl. `unreadable`) | The five statuses imply different GM actions; F-01 built the union so this switch is exhaustive. | Plan |
| Multi-tab | Listen to the `storage` event | One key and two tabs means the later write destroys the other's corrections — silent loss by an unanticipated route. | Plan |
| Recency after reload | Seed from the restored rows | Otherwise the first Generate after reopening is the one most likely to repeat the list on screen. | Plan |
| Cross-session double save | Accepted and documented | Closing it needs a schema field or a content-equality rule inside F-01 — neither is this slice's to own. | Plan |
| Tests | Extract decisions to a `.ts` module | The `.tsx` island is unreachable by the `src/**/*.test.ts` glob; F-01 and S-02 made the same split. | Plan |

## Scope

**In scope:** `src/lib/merchant-session.ts` (restore rules, stale-enum normalization, recency
seeding, save-state transitions) + tests; restore on mount; imperative persist on generate and
on committed correction; the "Zapisz" button and its states; `StorageNotice.tsx` with copy for
all five statuses plus cross-tab supersede; a `storage`-event listener; persistence stand-down
on `future-version`.

**Out of scope:** the saved-merchant list, rename, search, delete (S-04, S-05) — this slice
*writes* into the saved collection but never displays it; any change to F-01's schema; new
storage operations; a cross-session double-save guard; export/import (PRD Open Question #3);
jsdom or island tests; debouncing.

## Architecture / Approach

```
mount ──► readDocument() ──► status?
            ok ──► restoreFromDocument() ──► rows, corrections, category, wealth, recentIds
            empty ──────────► normal empty state
            unavailable / quota / future-version / quarantined / unreadable ──► StorageNotice
                                    └─ future-version also ──► persistence stands down

generate ─┐
          ├─► putTransient()   ← imperative, at the action sites only (never an effect)
correct ──┘

Zapisz ──► promoteTransient() ──► ok ? saveState="saved" : stay "armed" + notice

storage event (other tabs, key-filtered) ──► re-read, adopt, notice if corrections superseded
```

Decisions live in a pure module; effects and the listener stay in the island and are covered by
manual steps. Writes are imperative at the two action sites — an effect watching state would
write back what restore just read, and in a two-tab race overwrite a newer document with older
data.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Session decision module | `merchant-session.ts` — restore rules + save-state table, tested | The `promote-failed` transition: written wrong inline, a failed save reads as saved |
| 2. Restore and auto-persist | Close the tab, lose nothing — **US-03's first two criteria** | Hydration mismatch on restore; and any effect-based persist writing back on load |
| 3. Save and notices | Durability marker + five failure states + cross-tab — **completes FR-009** | Double-save producing duplicates; `future-version` writes overwriting protected data |

**Prerequisites:** F-01 complete (all three phases), S-01 phases 1–2, S-02 phases 1–2 minimum —
US-03 requires corrections to survive, so they must exist first. This is the deepest dependency
chain in the milestone.

**Estimated effort:** ~1–2 sessions across 3 phases. Phase 3 carries most of the manual
verification, since its failure states can only be reached by blocking site data, hand-editing
the document, and opening two tabs.

## Open Risks & Assumptions

- **The roadmap's listed unknown for this slice is already closed** by F-01 (explicit save
  promotes a copy). Anyone reading `roadmap.md:208-211` should not treat it as open.
- **Promote-a-copy's hazard lands here, not in F-01.** Two taps on Save make two entries, and the
  GM cannot see the saved list until S-04 — so the button's own state is the only feedback, which
  is why a failed promote must not disarm it.
- **A restored merchant can still be saved twice across sessions.** The promoted flag is session
  state by design, to keep F-01's forward-only schema untouched. Accepted; removable via FR-013
  once S-05 lands.
- **Persist must never run from an effect on state.** That is the single most likely
  implementation slip, and its failure mode — overwriting a newer document with older data —
  only shows up with two tabs.
- **Phase 2 ships a deliberate silent gap:** with storage disabled, the app persists nothing and
  says nothing until Phase 3's notices land. Acceptable between dev gates, not shippable alone.
- **Lifecycle behaviour is verified manually, not by tests.** Mount effects, hydration and the
  storage listener are where the real risk lives, and covering them would mean adding jsdom —
  reversing a deliberate S-01 decision two days from the deadline.
- **This slice is the first real writer**, so after it ships every device holds a v1 document and
  F-01's forward-only rule becomes active against live data.

## Success Criteria (Summary)

- Closing the tab mid-session loses nothing — the merchant and its corrections come back with no
  GM action.
- An explicit save marks a merchant durable, is legible as having done so, and cannot
  accidentally duplicate it.
- When storage cannot be used, the GM is told which problem occurred and the app keeps working.
