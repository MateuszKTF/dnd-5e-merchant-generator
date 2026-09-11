# Lista, która wytrzymuje miesiące kampanii — Plan Brief

> Full plan: `context/changes/merchant-search-and-delete/plan.md`
> Upstream contracts: `saved-merchants-library` (S-04), `merchant-storage-contract` (F-01),
> `last-merchant-persists` (S-03), `manual-item-corrections` (S-02) — all planned, none built

## What & Why

Roadmap slice **S-05**: the GM can delete a saved merchant they no longer need, and find one by
name once the library has grown to dozens over months of campaign (US-02, FR-012, FR-013).

Delete is not a guardrail violation — US-02's own criterion says a merchant does not disappear
*"bez wyraźnej akcji usunięcia przez MG"*, which makes an explicit delete the sanctioned action.
The PRD weighed and rejected the objection. Only the confirmation question was left open, and this
plan settles it.

## Starting Point

Nothing is implemented; every prerequisite exists as a plan. Both operations are already
specified upstream — F-01 implements `deleteMerchant`, S-04 built the library panel, the row
projection and `merchant-library.ts`. This slice adds a confirmation, a control, a filter input,
and the matching rules behind it. It is the smallest slice in the roadmap.

## Desired End State

Months into a campaign, the GM types "kuznia" — no diacritics, on a phone, one-handed — and the
list narrows to the shops whose name or kind match. They tap the trailing delete control on a
merchant they no longer run, confirm a dialog that names it, and it is gone. Deleting the merchant
they currently have open leaves the assortment on screen and quietly returns the save button to
offering to add it as a new entry.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Delete confirmation | ConfirmDialog naming the merchant (3rd call site) | The delete is genuinely irreversible — no trash, no undo in storage — and the dialog component already exists, so it is a third call site rather than new work. |
| Deleting the open merchant | Clear `openedSavedId`, keep the table | Nothing the GM is reading vanishes, and the save button stops pointing at a record that no longer exists. |
| Matching | Case- and diacritic-insensitive substring | A GM typing at the table writes "kuznia", not "Kuźnia"; without this, search silently returns nothing. |
| Search field | Name **and** category label | Auto-names carry the category but GM-chosen names do not, so FR-010's rename would otherwise blind FR-012's search. |
| Delete affordance | Small icon button at the row end | Always visible without a gesture; the confirmation absorbs the mis-tap risk of a small target. |
| Priority if cut | **Delete first, search second** | A library nothing can be removed from is a worse v1 than one without search; search pressure arrives after months, a mistaken save on day one. |
| Rules location | Extend S-04's `merchant-library.ts` | Same concern, and the Vitest glob is `src/**/*.test.ts` with no jsdom. |

## Scope

**In scope:** a third call site for the existing `ConfirmDialog`; a per-row delete control;
`deleteMerchant` wiring with honest failure handling; clearing `openedSavedId` wherever a record
leaves `saved` (local or cross-tab); `normalizeForSearch` / `matchesQuery` / `filterMerchants`; a filter input at the top of
the panel.

**Out of scope:** undo, trash, soft delete; bulk delete or multi-select; sorting controls, tags or
folders; searching assortment contents; fuzzy matching; persisting the query; any schema change or
new storage operation; jsdom or island tests.

## Architecture / Approach

```
MerchantLibrary
 ├─ [search input]  ──► filterMerchants(saved, query)
 │                        └─ normalizeForSearch()  lowercase + NFD strip + ł→l
 │                           matchesQuery()        name OR category label
 └─ row: [editable name] [open target] [🗑 delete]
                                          │
                          pending id ──► ConfirmDialog (3rd call site)
                                          │ confirm
                                          ▼
                              deleteMerchant(id) ──► ok ? remove row : keep row + StorageNotice
                                    openedSavedId gone from `saved` → "cleared-open" (any route)
```

Two phases ordered by what survives a deadline cut rather than by the slice's title. Each closes
one functional requirement on its own. Matching rules extend S-04's existing module; normalization
is the only tricky code and it is pure, so it is fully covered by tests.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Delete | Confirmation + row control + wiring — **completes FR-013, shippable alone** | Optimistic row removal showing a merchant as deleted while still in storage |
| 2. Search | Normalization + filter input — **completes FR-012, closes US-02** | `ł` surviving NFD, so every `ł`-named merchant is unfindable while the rule looks correct |

**Prerequisites:** S-04 complete — which transitively means all of F-01, S-01, S-02 and S-03. This
is the last item in the milestone and depends on every other one.

**Estimated effort:** ~1 session across 2 phases. The smallest slice in the roadmap.

## Open Risks & Assumptions

- **`ł` does not decompose under Unicode NFD.** Every other Polish diacritic (ą ć ę ń ó ś ź ż)
  strips cleanly, but `ł`/`Ł` are distinct letters needing an explicit mapping. A test suite
  covering only the decomposable ones passes while the feature fails — hence a dedicated test case.
- **Delete must not remove the row before the write succeeds.** F-01 can return `quota-exceeded`,
  `unavailable` or `read-only`; an optimistic removal would show a merchant as gone that a reload
  brings back.
- **This slice amends no upstream file.** `deleteMerchant` exists in F-01 and `ConfirmDialog` is
  already generic in S-02, so this slice only consumes both. `ConfirmDialog` is the shared touch
  point across S-02, S-04 and S-05 — three call sites, one component.
- **Until this ships, F-01's quota path has no remedy.** F-01 never evicts and assumes the GM can
  free space; without delete, a full store can only be cleared by wiping site data — which destroys
  the whole campaign.
- **Category matching is slightly wider than FR-012's literal wording.** A query of "kowal" returns
  every smithy, not only one named that. The alternative was letting FR-010 and FR-012 undercut
  each other.
- **Deadline exposure.** Roadmap Open Question #1 names this slice as the one that hurts least if
  2026-09-13 presses — while stating it is *not* a candidate for deletion, only for shipping last.
  The phase order exists so a partial ship still leaves the library usable.

## Success Criteria (Summary)

- A merchant the GM no longer needs can be removed, after a confirmation that names it, and it
  stays gone across a reload.
- A merchant can be found by typing part of its name or kind — without diacritics, on a phone.
- Nothing disappears silently: a failed delete leaves the row in place with a notice, and deleting
  an open merchant leaves the assortment on screen.
