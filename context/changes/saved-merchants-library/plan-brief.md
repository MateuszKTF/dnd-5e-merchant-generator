# Biblioteka zapisanych kupców — Plan Brief

> Full plan: `context/changes/saved-merchants-library/plan.md`
> Upstream contracts: `merchant-storage-contract` (F-01), `last-merchant-persists` (S-03),
> `manual-item-corrections` (S-02) — all planned, none built

## What & Why

Roadmap slice **S-04**: the GM returns to a list of saved merchants, recognises the right one,
renames it to something of their own, and opens it to find the assortment exactly as it was saved
— corrections included (US-02, FR-010, FR-011).

The roadmap calls this the slice where the product stops being another one-shot generator. Every
existing 5e shop generator can produce a list; none can hand back last session's smithy.

## Starting Point

Nothing is implemented; all prerequisites exist as plans. Most of the machinery is already
specified upstream — F-01 gives `listSaved`, `renameMerchant` and the auto-name rule, S-03 gives
the save action, restore path and `StorageNotice`, S-02 gives the discard-corrections dialog. The
app has exactly one route, which `AGENTS.md` calls "the single view". This slice is the view over
what already exists — and it is the **only roadmap item with `Unknowns: —`**, because the hard
decisions were pulled forward into F-01.

## Desired End State

The GM opens the app next session, expands the saved-merchants panel, and sees their shops newest
first — name, kind of shop, item count, when it was saved. They rename "Kowal, 11.09.2026 20:15"
to "Kuźnia u Borysa" by typing in the row. Tapping a row brings that merchant back exactly as
saved, with the controls set to match; if unsaved corrections were on screen, they are asked
first. Once open, Zapisz says it will save changes to *that* merchant, and does so in place.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Placement | Collapsible panel on the one page | Opening becomes a state change, not a navigation that would discard unsaved work; a freshly saved merchant appears without a round-trip. | Plan |
| Open over unsaved corrections | Reuse S-02's confirmation | Identical class of loss to regenerating, so it deserves the identical guard — a second call site, not a second component. | Plan |
| Open then save | Update the opened record in place | Promoting would leave two near-identical entries in a list the GM is looking at, and US-02 says a saved assortment stays identical to what was saved. | Plan |
| Rename validation | Trim, reject empty, **allow duplicates** | Two smithies in one town legitimately share a name, and the row's other fields disambiguate; S-05's search must therefore show multiple matches. | Plan |
| Delete | Stays in S-05 | Holds the roadmap's boundary; `deleteMerchant` already exists in F-01, so S-05 is a button over an existing operation. | Plan |
| Rename UX | Inline in the row | Reuses S-02's blur-commit inline-edit idiom so the app has one editing pattern, not two. | Plan (defaulted) |
| Row content | Name + category + item count + save time | The three fields that tell apart two merchants sharing a name. | Plan (defaulted) |
| Rules location | Pure `.ts` modules | Matches F-01, S-02 and S-03; the Vitest glob is `src/**/*.test.ts` with no jsdom. | Plan (defaulted) |

## Scope

**In scope:** `restoreFromMerchant` factored
out of S-03's restore; `merchant-library.ts` (rename validation, sort, row projection);
`MerchantLibrary.tsx` panel; open with the discard guard; inline rename; save-in-place.

**Out of scope:** delete and search (S-05, FR-012/FR-013); a second route; any schema change;
persisting `openedSavedId`; bulk operations, export, reordering, tags; virtualisation; jsdom or
island tests.

## Architecture / Approach

```
MerchantGenerator (island)
 ├─ saved: Merchant[]          ← from S-03 mount read, refreshed after every write
 ├─ openedSavedId: string|null ← session state only, never persisted
 │
 ├─ MerchantLibrary (collapsed by default)
 │     rows: sortForLibrary() → libraryRow()   name · category · count · savedAt
 │     tap row ──► hasCorrections() ? ConfirmDialog : open
 │     open ──► restoreFromMerchant() + putTransient() + set openedSavedId  [one commit]
 │
 └─ Zapisz ──► openedSavedId ? updateSavedMerchant(id, …) : promoteTransient()
    Stwórz ──► clears openedSavedId first
```

The panel shares the island's state rather than re-reading storage — that is the whole reason it
lives on the same page, and `saved` comes from S-03's single mount read rather than a second
`listSaved()` call, so there is one read and one failure path. No upstream file is amended.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Rules | `restoreFromMerchant`, rename/sort/row rules, tests | Rename validation that blanks a name, or a sort that reshuffles between renders |
| 2. List panel and open | The library + guarded open — **completes FR-011** | `openedSavedId` landing late, so a Zapisz right after opening duplicates instead of updating |
| 3. Rename and save-in-place | Inline rename + in-place write — **completes FR-010 and US-02** | Generate failing to clear `openedSavedId`, overwriting a saved merchant with an unrelated shop |

**Prerequisites:** F-01 complete, S-01 phases 1–2, **S-02 complete** (its dialog is reused), S-03
complete. This is the second-deepest chain in the milestone.

**Estimated effort:** ~1–2 sessions across 3 phases. Phase 1 is small now that upstream ships the
storage operation; phases 2–3 are mostly UI over rules that are already tested.

## Open Risks & Assumptions

- **No upstream file is amended any more.** F-01's review added `updateSavedMerchant` and S-02's
  named its dialog `ConfirmDialog` from the start, so this slice only consumes both — earlier
  drafts specified a rename and an API addition that are now moot.
- **`openedSavedId` cannot survive a reload** without adding a field to a forward-only schema, so
  after reloading, an opened merchant is an ordinary transient and Zapisz reverts to promoting a
  copy — the same limitation S-03 already accepted, now reachable by a second route.
- **Generate clearing `openedSavedId` is load-bearing.** If it does not, the next Zapisz
  overwrites a saved merchant with a completely different shop — silent destruction of saved
  data, not merely a duplicate.
- **Duplicate names are permitted by design**, so FR-012's search in S-05 must present multiple
  matches rather than assume one.
- **If S-05 is cut, v1 ships a list that only grows.** Roadmap Open Question #1 names S-05 as the
  first candidate to drop against the 2026-09-13 deadline — which would leave the guardrail's own
  escape hatch, removal by explicit GM action, absent from the product.
- **Vertical pressure at 360 px is real.** The page now carries controls, a 25-row table and the
  library; the panel is collapsed by default specifically to protect the one NFR.

## Success Criteria (Summary)

- The GM finds last session's merchant in the list, recognises it, and opens it to an assortment
  identical to what was saved — corrections and all.
- A merchant can be renamed to something the GM will recognise, and the rename survives a reload.
- Opening or saving never silently destroys work: unsaved corrections prompt first, and saving an
  opened merchant updates it rather than duplicating it.
