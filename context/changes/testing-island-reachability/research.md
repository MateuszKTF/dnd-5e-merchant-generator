---
date: 2026-09-14T02:30:00+02:00
researcher: Mateusz Kotowicz
git_commit: 86fb852362dffc9c5ea3c3b106b077ae3e63415c
branch: main
repository: dnd-5e-merchant-generator
topic: "Grounding the test-plan risk map: uncovered risks and the target behaviors that mitigate them"
tags: [research, codebase, test-plan, risk-map, coverage, storage, islands, a11y]
status: complete
last_updated: 2026-09-14
last_updated_by: Mateusz Kotowicz
---

# Research: Grounding the test-plan risk map

**Date**: 2026-09-14T02:30:00+02:00
**Researcher**: Mateusz Kotowicz
**Git Commit**: `86fb852362dffc9c5ea3c3b106b077ae3e63415c`
**Branch**: `main`
**Repository**: `MateuszKTF/dnd-5e-merchant-generator`

## Research Question

Ground the §2 risk map of `context/foundation/test-plan.md` (Risks #1–#7) against the
current codebase. For each risk: locate the real failure path; separate what the existing
suite actually covers from what is only assumed covered; state the concrete target
behaviors a test must demonstrate before the risk counts as mitigated; verify or correct
the Risk Response Guidance; and flag speculative risks or misleading evidence. Also
identify risks the map missed.

## Summary

The risk map survives grounding, but four of its seven rows need correction and the map
missed a whole class of failure. Five findings dominate:

1. **The compensating control for untested `.tsx` does not exist.** Every plan in the
   storage chain reaffirms the same convention — the islands are covered by *manual
   verification steps in the plan*, not by the runner (`vitest.config.ts:15-17`, restated
   in six plans). Three of eight change folders show that manual verification was
   **never performed**: roughly 40 unticked manual rows, including every browser-only
   failure-mode check in the slice whose own plan calls them *"the half of this slice
   that justifies its existence"* (`merchant-storage-contract/plan.md:375`). The islands
   are therefore covered by typecheck and non-a11y lint only. This is the single most
   important finding in this document and it is not a test-design problem — it is a
   missing control the plan assumed was present.

2. **Risk #1 has a confirmed live defect, and it is exactly the failure the user named.**
   `raiseWriteFailure("not-found")` maps to `null` (`MerchantGenerator.tsx:238`), so a
   failed promote produces zero visible change while the `sr-only` region instructs the
   user to read a storage message that was never rendered (`:988-998`).

3. **Risk #5 is substantially over-stated and Risk #7's premise was wrong.** There is no
   uncaught-throw path at the read/parse boundary — every hazard is guarded, and the five
   lib modules contain zero `throw` statements. And the 44px rule is enforced on all 13
   interactive controls. Both rows need rewriting rather than defending.

4. **The map missed the cross-tab path entirely** — the one destructive path that does not
   route through `ConfirmDialog` (`MerchantGenerator.tsx:811`), which also cancels an
   in-flight confirmation mid-answer (`:809`) and reports the resulting loss through a
   notice classified episodic, so the GM's next successful write erases it
   (`StorageNotice.tsx:115-126`).

5. **Six defects from the prior storage audit are still present** (F5–F10), deliberately
   scoped out at `storage-layer-consistency-audit/plan.md:79-82`. Three of them
   (F5, F7, F8) are live user-visible bugs, not code smells.

Counts in `test-plan.md` and `lessons.md` are stale: the suite is **368 tests, not 366**,
and the dark `.tsx`/`.astro` surface is **3 068 lines, not 2 979** — it grew by 89 lines
in the days since the audit that first measured it.

## Detailed Findings

### Risk #1 — A failed write reported as success

**Verdict: confirmed, with one live defect. Cheapest layer corrected: component, not integration.**

The storage half is sound and well covered. Every write returns an explicit discriminated
union (`src/lib/merchant-storage.ts:114-121`), every variant is constructed by real
detection logic, and quota is distinguished from a disabled store at
`merchant-storage.test.ts:500-506`.

The reporting half is entirely untested and contains the defect. The component collapses
storage statuses into its own vocabulary at `src/components/MerchantGenerator.tsx:214`,
maps them at `:223-240`, and renders through `src/components/StorageNotice.tsx:59-96`.

**CONFIRMED DEFECT.** `conditionFromFailure` returns `null` for `"not-found"`
(`MerchantGenerator.tsx:238`), so `raiseWriteFailure` raises nothing (`:395-398`). The
transition table sends `armed --promote-failed--> armed`
(`src/lib/merchant-session.ts:219`), so the button does not change either. Net DOM change
for a sighted user is zero, while the assistive announcement at `:988-998` says
*"zobacz komunikat o pamięci"* — pointing at a message that was never rendered.

**The inverse fear is unfounded, and this is worth recording.** The UI cannot show "saved"
before confirming a write. `"saved"` is reachable only via the `promoted` event, and every
`promote-failed` cell in the table is `armed` or `dead`
(`merchant-session.ts:218-220`, asserted at `merchant-session.test.ts:334-346`). The
affirmation region is gated on the same value (`MerchantGenerator.tsx:1676-1678`).

**Three `persist()` results are discarded** — `:1434` (`openMerchant`), `:1497` (`draw`),
`:1536` (`handleCorrect`). This does *not* produce a silent banner-less failure, because
`persist` raises its own notice internally at `:927`. What it loses is second-order state,
which matters for Risk #3 (below).

**Prior-audit F2/F3 are still live here**: a `read-only` write surfaces to the GM as
`"unavailable"` (wrong message), and pressing Save after a `read-only` read produces net
zero DOM change.

### Risk #2 — Last merchant not auto-persisted

**Verdict: confirmed. The map's "must challenge" was right; the mechanism is different from what the wording implied.**

There is **no effect-based autosave and no debounce**. Persistence is imperative only,
from the sites listed above, and the code says why at `MerchantGenerator.tsx:591-594` —
an effect watching `rows` would turn every page load into a write, which in a two-tab
session puts older data over newer. So the plan's "debounce window" concern is void.

The mount restore effect (`:600-677`) runs exactly once per mount — all three deps are
`useCallback`s with transitively empty dep chains, and no `StrictMode` is configured
anywhere. Exhaustiveness is compiler-enforced at `:673`.

What is untested is the **trigger**, which is precisely the anti-pattern the plan named:
nothing in the runner connects "an edit happened" to "`putTransient` was called". Both ends
are proven (`merchant-storage.test.ts:92-100`, `merchant-session.test.ts:62-149`); the wire
between them is not.

**Real loss window, and it is not a debounce.** Text typed into a cell lives only in
`PriceQuantityCell`'s local `draft` state (`:65`) until blur or Enter (`:84-119`). The
lifecycle net is `commitActiveEdit` on `pagehide`/`visibilitychange`
(`MerchantGenerator.tsx:837-858`), and a mobile OS killing a backgrounded tab fires
neither. The PRD's only NFR names the phone as the primary device, and US-03 is exactly
"closes the tab mid-session" — so this window sits on the intersection of the two.

### Risk #3 — Corrections lost or corrupted

**Verdict: confirmed. Module logic is the best-covered code in the repo; the guard's call sites are not covered at all.**

Corrections are an overlay keyed by `itemId`, never a mutated row list
(`src/lib/corrections.ts:24-50`, `src/lib/merchant.ts:47-66`), merged at render time
(`corrections.ts:85-98`), and crossed over the storage boundary field-by-field
(`merchant.ts:299-339`). The dirty rule compares on a whole-copper grid so float drift
cannot make a reverted edit permanently dirty (`corrections.ts:111-123`).

The gate is two-part: `hasCorrections` (`corrections.ts:154-159`) feeding
`wouldLoseCorrections` (`merchant-session.ts:340-342`), wrapped for the component at
`MerchantGenerator.tsx:141-155` and called as `losesWork()` at `:1194-1196`.

Both in-tab destructive paths are guarded: regenerate (`:1206-1213`) and open-from-library
(`:1224-1231`). `setRows` is called in exactly two places (`:481`, `:1477`), which makes
that enumeration complete and verifiable.

**CONFIRMED guard blind spot.** `openMerchant` discards its `persist` result (`:1434`)
while `adopt` has already set `setAutosaveFailed(false)` and `openedSavedId` (`:489`). If
that write fails, `holdingTheWork` at `:149` evaluates `true` and the FR-006 guard stands
down over a transient slot that no longer matches the screen.

**Prior-audit F5 is still present and is a live bug.** `toStoredCorrections`
(`merchant.ts:296-309`) promises in its docblock to drop empty entries; the code only skips
falsy, so `{}` is persisted. That inflates `Object.keys(a.corrections).length` in
`sameStoredWork`, so `openedSavedIdFor` returns `null` for a record that *is* open — which
in turn stands the FR-006 guard down. No test feeds `toStoredCorrections` an empty object.

### Risk #4 — Transient↔standing lifecycle

**Verdict: confirmed, and materially better than the map assumed. The L-05 precedent is fixed.**

`promoteTransient` always mints a new id and never touches the transient slot
(`merchant-storage.ts:616-652`). The link is deliberately **not persisted**
(`merchant-session.ts:266-270`); it is re-derived by `openedSavedIdFor` (`:391-413`) from
id equality plus a content check.

**The L-05 defect is fixed.** `merchant-session.test.ts:624-643` now states that it cannot
see whether promote still mints, and points at its replacement:
`merchant-storage.test.ts:199-216` drives the real
`putTransient → promoteTransient → readDocument → openedSavedIdFor` chain with two
anti-vacuous guards at `:212-213`. Risk #4's mechanical anchor exists.

**Duplicate entries remain possible, guarded only by UI state.** `promoteTransient` always
appends (`:646`) with no dedupe. The only guard is the session machine routing a second
press to `autosaveOpened` (`MerchantGenerator.tsx:954-970`).

**LATENT DEFECT — missing guard.** `openedSavedIdFor` (`merchant-session.ts:391`) does not
run `isMerchant`, unlike its sibling `restoreFromMerchant` (`:93`), and dereferences
`a.rows.length` (`:367`) and `Object.keys(a.corrections)` (`:379`). It is safe today only
because both call sites pass a salvaged document. That precondition is recorded in neither
the types nor a comment. A future call site would blank the only page the product has.

**Eleven cross-module invariants are held by prose alone**, against exactly one enforced
mechanically (`MutuallyAssignable` at `merchant.test.ts:67-70`). The correction types have
no equivalent assertion (`merchant.ts:276-283`), so adding a third correctable field would
compile everywhere and silently never persist.

### Risk #5 — Untrusted stored document

**Verdict: OVER-STATED. Rewrite the row. This is the best-covered risk on the map.**

The "throws uncaught, blank application" half **does not exist**. Every hazard is guarded:
`JSON.parse` at `merchant-storage.ts:440-444`, `getItem` at `:428-432`, the `localStorage`
property access itself at `:184-188`, the probe at `:244-250`, the quarantine side-write at
`:372-384`. There are **zero `throw` statements and zero non-null assertions** across all
five lib modules; the only production error class is `AssortmentPoolError`
(`assortment.ts:29`), which is a broken-invariant case and correct under the AGENTS.md rule.

Coverage is correspondingly strong, and the fixture discipline the plan asked for is
already in place: every hostile fixture is a hand-written literal
(`merchant-storage.test.ts:510-541`, `:701-731`, `:750-767`, `:796`), while only the
happy-path fixture is serializer-produced (`:77-81`).

What survives is narrow and should be the row's new wording: the **silent-discard** half,
plus the `openedSavedIdFor` guard gap above. One branch is untestable today —
`probeWritable`'s `removeItem` path, because the fake never throws from `removeItem`
(`storage-fake.test-helper.ts:102-104`).

### Risk #6 — Schema change / rollback asymmetry

**Verdict: confirmed, and the anti-pattern the plan warned about is already present.**

Behaviour is covered well: `needs-migration` refuses without relabelling
(`merchant-storage.test.ts:769-788`), `future-version` leaves bytes byte-identical
(`:804-811`), a restructured v2 reads as future rather than corrupt (`:790-802`), and the
latch covers all six write operations (`:813-831`).

**The migration seam is a comment, not code.** `merchant-storage.ts:470-486` says
*"MIGRATION SEAM — the first v1→v2 step goes here … No runner, no registry."* Nothing in
`src/` matches `migrat`. Bumping `SCHEMA_VERSION` without writing one first gives every
existing device `needs-migration` plus a permanent read-only latch.

**No frozen per-version fixtures exist.** Every version fixture is computed as
`SCHEMA_VERSION ± 1` (`:633`, `:650`, `:686`, `:775`, `:796`). The day the constant becomes
2, those fixtures move with it: the "older document" test silently starts describing
v1→v2, and no pinned literal v1 document remains to prove a v2 build can read one. This is
verbatim the anti-pattern in the plan's own Risk #6 row.

**F10 is still present, narrowed.** `writeDocument`'s read-only-latch promise
(`merchant-storage.ts:517-523`) is pinned for the first call only; a self-clearing latch
still passes the suite.

### Risk #7 — Phone usability

**Verdict: PREMISE WRONG. Rewrite the row. Tap targets are enforced; the real defect is focus contrast, and the gate is inert rather than merely narrow.**

All 13 interactive controls meet 44px — `h-11` on both selects
(`MerchantGenerator.tsx:1597`, `:1617`), both primary buttons (`:1627`, `:1665`), both
dialog buttons (`ConfirmDialog.tsx:136`, `:147`), `min-h-11`/`size-11` throughout
`MerchantLibrary.tsx` and `PriceQuantityCell.tsx:129`. The table layout is sound at 360px
(`MerchantTable.tsx:49-118`).

**CONFIRMED DEFECT — no usable focus indicator on four buttons.**
`src/components/ui/button.tsx:8` sets `outline-none` and then
`focus-visible:ring-ring/50`, where `--ring: oklch(0.708 0 0)` (`src/styles/global.css:25`)
at 50% alpha over white composites to roughly 1.3:1 — far under the 3:1 WCAG floor, with
the UA ring already removed. It also degrades Zapisz on focus, replacing its explicit
`border-neutral-500` (3:1) with `--ring` (~2.6:1). This affects Stwórz, Zapisz and **both**
`ConfirmDialog` actions. Every other control in the app uses an explicit
`focus-visible:outline-neutral-800`.

**CONFIRMED DEFECT — live region mounted with its first message.**
`MerchantTable.tsx:45-47` renders `aria-live="polite"` inside a conditionally-rendered
table (`MerchantGenerator.tsx:1717`), so the region is inserted *with* its content on the
first "Stwórz" — the pattern `MerchantLibrary.tsx:166-168` explicitly calls out as the one
screen readers skip, while asserting that `MerchantTable` does not do it. That claim is
false.

**The a11y gate is inert, not merely narrow — L-04 understated it.** `eslint.config.js:83`
spreads `flat/jsx-a11y-recommended`, and the 31 `astro/jsx-a11y/*` rules *are* configured
for `.tsx` at severity 2. They return an empty visitor on any non-Astro file
(`eslint-plugin-astro/lib/index.mjs:3524`). An empirical probe with an alt-less `<img>` and
an empty anchor in a real `.tsx` path produced zero a11y findings.
`eslint-plugin-jsx-a11y@6.10.2` is a direct devDependency (`package.json:50`) but is never
registered as a plugin for React files.

**Horizontal-scroll risk is outside the island.** `Layout.astro:45,52` renders two
unbreakable ~51-character URLs at `text-xs` with no wrap utility and no page-level
`overflow-x` containment.

## Risks the Map Missed

| ID | Risk | Impact | Likelihood | Evidence |
|---|---|---|---|---|
| **M-1** | Two tabs on one device: the second tab's write replaces the first tab's rows **and entire correction overlay** with no confirmation, and cancels a confirmation the GM is mid-answer on | High | Medium | `MerchantGenerator.tsx:794-811`; `:809 setPending(null)`; carve-out recorded at `manual-item-corrections/plan.md:173-183` |
| **M-2** | The documented compensating control for untested `.tsx` — manual verification in each plan — was never performed for ~40 criteria across three changes | High | High (already occurred) | `merchant-storage-contract/plan.md:632-665`; `last-merchant-persists/plan.md:597-640`; `manual-item-corrections/plan.md:599-627` |
| **M-3** | A loss notice that reports irreversible damage is classified episodic and erased by the GM's next successful write | High | Medium | `StorageNotice.tsx:115-126` omits `superseded`/`record-gone` from `STANDING`; `clearEpisodic` runs on every successful write (`MerchantGenerator.tsx:925`, `:1138`, `:1166`, `:1383`) |
| **M-4** | An uncommitted cell draft is lost when a mobile OS kills a backgrounded tab — neither `pagehide` nor `visibilitychange` fires | Medium | Medium | `PriceQuantityCell.tsx:65`; `MerchantGenerator.tsx:823-835` (acknowledged in-source) |
| **M-5** | Backgrounding the tab mid-rename performs an irreversible rename the GM never confirmed | Medium | Medium | `commitActiveEdit` (`MerchantGenerator.tsx:838-843`) blurs the library name field (`MerchantLibrary.tsx:389-397`) |
| **M-6** | A throw in the native `storage` listener or any event handler bypasses the error boundary entirely and leaves a tab that has silently stopped syncing | Medium | Low | `MerchantGenerator.tsx:692-812` registered via `window.addEventListener`; boundary covers render only (`GeneratorIsland.tsx:24-60`); `componentDidCatch` logs to console with no sink (`:31-36`) |
| **M-7** | A merchant saved under a category whose label falls back to the raw id cannot be found by search (prior-audit F8, still present) | Medium | Medium | `merchant-library.ts:288` falls back to `przedmioty-magiczne`; `normalizeForSearch:311-325` never collapses the hyphen; `matchesQuery:338-347` searches the label |

M-1, M-2 and M-3 all belong on the map. M-2 in particular is not a testing gap — it is a
control the plan credited as existing.

## Target Behaviors — what a test must demonstrate

These are the acceptance conditions for calling each risk mitigated. They are written as
observable behavior so the oracle comes from the requirement, not from the code under test.

### Risk #1 — mitigated when

1. For **each** of the four `WriteFailure` variants, a failed write produces a visible,
   non-empty notice, and the four are mutually distinguishable. `not-found` currently
   fails this. *(Layer: component, once the runner reaches `.tsx`.)*
2. A `read-only` write surfaces the `read-only` message, not the `unavailable` one
   (prior-audit F2). *(Component.)*
3. The Save button's rendered text never reads "Zapisano" unless a `promoted` event was
   dispatched downstream of a confirmed `ok`. *(Component, asserting rendered text — the
   state machine itself is already covered at `merchant-session.test.ts:334-346`.)*
4. Pressing Save after a `read-only` read produces at least one observable DOM change
   (prior-audit F3). *(Component.)*
5. `isStandingCondition` keeps a standing notice across a successful write and clears an
   episodic one — asserted against the requirement that a notice describing irreversible
   loss is standing. *(Pure unit; `StorageNotice.tsx:115-128` is exported and testable
   today without any harness.)*

### Risk #2 — mitigated when

6. Committing a price or quantity edit through the **cell's own blur/Enter path** results
   in the new value being present in the transient slot — the assertion reads storage, not
   the handler. *(Component + real storage fake.)*
7. A fresh mount against a document written by step 6 renders the edited value. *(Component.)*
8. The mount restore effect performs **no write** — asserted by a storage fake that counts
   `setItem` calls during mount. *(Component; this is the invariant `:591-594` claims.)*
9. `pagehide` with a focused, uncommitted cell draft commits that draft. *(Component.)*

### Risk #3 — mitigated when

10. Regenerate with corrections present opens the confirmation dialog; regenerate without
    them does not. Asserted on the rendered dialog, not on `wouldLoseCorrections`, which is
    already covered at `merchant-session.test.ts:646-664`. *(Component.)*
11. Open-from-library with corrections present opens the dialog. *(Component.)*
12. Cancelling the dialog leaves rows and the correction overlay byte-identical. *(Component.)*
13. `toStoredCorrections` drops an **empty** entry `{}`, matching its docblock
    (`merchant.ts:296-298`). Currently fails — prior-audit F5. *(Pure unit, no harness needed.)*
14. A failed transient write during `openMerchant` leaves the FR-006 guard armed — i.e.
    `autosaveFailed` reflects the failure. *(Component.)*

### Risk #4 — mitigated when

15. One press of Zapisz produces exactly one library entry, asserted by reading the
    document after the press. *(Component.)*
16. A second press of Zapisz on the same merchant does not append a second entry. *(Component.)*
17. After promotion, the transient slot's id equals the new library entry's id — the
    relink at `MerchantGenerator.tsx:1044-1069`, currently untested. *(Component.)*
18. `openedSavedIdFor` returns `null` rather than throwing when handed an unsalvaged
    document. Currently throws. *(Pure unit.)*
19. The `StoredCorrection`/`UiCorrection` correspondence is asserted mechanically, matching
    the existing `MutuallyAssignable` pattern at `merchant.test.ts:67-70`. *(Compile-time
    assertion; no harness.)*

### Risk #5 — mitigated when

20. A document whose `transient` is structurally invalid is discarded **with a visible
    notice**, never silently — the silent-discard half is the only part still open.
    *(Component; the module half is already covered.)*
21. `probeWritable` handles a throwing `removeItem`. Requires extending
    `storage-fake.test-helper.ts:102-104` first. *(Pure unit.)*

### Risk #6 — mitigated when

22. A **frozen literal** v1 document — hand-written bytes committed to the repo, never
    computed from `SCHEMA_VERSION` — is read successfully by the current build. This is the
    one fixture that must not move when the constant does. *(Pure unit.)*
23. `writeDocument` called twice on a latched store is refused both times (prior-audit F10).
    *(Pure unit.)*
24. Bumping `SCHEMA_VERSION` without a registered migration fails a gate rather than
    shipping. *(Gate, §3 Phase 4 — not a test.)*

### Risk #7 — mitigated when

25. Every interactive control exposes a focus indicator meeting 3:1 against its background.
    Currently fails for all four `<Button>`s. *(Deterministic assertion on computed styles,
    or an axe rule once a11y linting reaches React.)*
26. An a11y rule set actually fires on `.tsx` — proven the way L-04 says to prove it: a
    file with a deliberate violation, lint run, exit code checked. *(Gate probe, §3 Phase 4.)*
27. The assortment live region is present in the DOM **before** its first message.
    *(Component.)*
28. No horizontal scroll at 360px on the page as a whole, including the footer. *(Viewport
    check, §3 Phase 5.)*

### Missed risks — mitigated when

29. **M-1**: a cross-tab document change that would discard corrections does not replace
    them without the GM's acknowledgement, and does not cancel an open dialog. *(Component.)*
30. **M-3**: `superseded` and `record-gone` survive a subsequent successful write. *(Pure
    unit on `isStandingCondition` — cheapest test on this entire list.)*
31. **M-5**: backgrounding the tab does not commit an unconfirmed library rename. *(Component.)*
32. **M-7**: a merchant in a fallback-labelled category is findable by typing the label
    with a space. *(Pure unit, no harness — prior-audit F8.)*

**Nine of these 32 need no harness at all** (items 5, 13, 18, 19, 21, 22, 23, 30, 32). They
are pure `.ts` units that can land before any decision about jsdom versus Browser Mode, and
four of them close live defects.

## Corrections to `context/foundation/test-plan.md`

To be backported into §2, §4 and §5. None adds a file anchor to §2; the anchors stay here.

| Section | Correction |
|---|---|
| §2 Risk #5 | Drop the "throws uncaught (blank application)" clause — no such path exists. Narrow the row to silent discard. Downgrade Likelihood to Low; this is the best-covered risk on the map |
| §2 Risk #7 | Drop the tap-target clause — 44px is enforced on all 13 controls. Replace with the focus-indicator contrast failure. Keep the horizontal-scroll clause but note the risk is the footer, not the table |
| §2 Risk #6 | Add that the migration seam is comment-only and that no frozen fixture exists — the anti-pattern is present, not hypothetical |
| §2 | Add M-1 (cross-tab), M-2 (manual verification never performed), M-3 (episodic loss notice) as new rows. Append at the bottom; do not renumber |
| §2 Response Guidance #1 | Cheapest layer is **component**, not integration — the mapping is a pure function of props |
| §2 Response Guidance #2 | Remove the debounce concern; there is no debounce. The real window is the uncommitted cell draft |
| §4 | `.tsx` **is** linted with type-aware rules (212 active) and **is** type-checked by `astro check`. Only tests and a11y are absent. The accessibility row should read "inert over React", not "scoped to `.astro`" |
| §4 | Suite is 368 tests, not 366. Dark surface is 3 068 lines, not 2 979 |
| §5 | The Supabase bundle row is **inert today**, verified: nothing imports `@supabase/*`, the env fields are `context: "server"` + `access: "secret"` (`astro.config.mjs:21-22`), and `dist/client/` contains no match. Reframe the gate as "assert the env classification is preserved", and lower its priority |
| §5 | Add a gate: `eslint .` has no `--max-warnings`, so every warn-level rule passes CI silently. `no-console` is warn (`eslint.config.js:23`) |
| §5 | Add a gate: `scripts/**` is hard-ignored by ESLint (`eslint.config.js:75`) while still being type-checked |
| §7 | The economic-plausibility exclusion stands and was re-confirmed; no change |

## Code References

- `src/lib/merchant-storage.ts:96-132` — the read/write/mutation result unions
- `src/lib/merchant-storage.ts:440-444` — guarded `JSON.parse`; the reason Risk #5 has no throw path
- `src/lib/merchant-storage.ts:470-486` — the comment-only migration seam
- `src/lib/merchant-storage.ts:616-652` — `promoteTransient`, always mints, always appends
- `src/lib/merchant-session.ts:340-342` — `wouldLoseCorrections`, the FR-006 gate
- `src/lib/merchant-session.ts:391-413` — `openedSavedIdFor`, missing the `isMerchant` guard
- `src/lib/merchant.ts:296-309` — `toStoredCorrections`, docblock/code mismatch (F5)
- `src/components/MerchantGenerator.tsx:223-240` — the variant→condition map; `not-found` → `null`
- `src/components/MerchantGenerator.tsx:794-811` — the unguarded cross-tab adopt (M-1)
- `src/components/MerchantGenerator.tsx:1194-1231` — the two guarded destructive paths
- `src/components/StorageNotice.tsx:115-126` — `STANDING`, omitting `superseded` (M-3)
- `src/components/ui/button.tsx:8` + `src/styles/global.css:25` — the 1.3:1 focus ring
- `src/lib/merchant-storage.test.ts:199-216` — the cross-module invariant that closed L-05
- `vitest.config.ts:15-23` — the scope decision that makes 3 068 lines dark

## Architecture Insights

- **The union-vs-throw rule is real and consistently applied.** AGENTS.md:14 is not
  aspirational — the storage module genuinely never throws, and the one error class in the
  repo guards a broken invariant rather than an expected failure. Tests should preserve this
  boundary rather than flatten it.
- **The session state machine is the strongest asset in the codebase.** A 4×8 table written
  as an independent typed literal (`merchant-session.test.ts:275-316`) is a genuine oracle.
  The gap is not the machine; it is that nothing asserts a component ever calls it with the
  right event or renders its output.
- **The link between transient and standing is derived, not stored** — a deliberate design
  that trades a persisted pointer for a content check. It is sound only while promote keeps
  minting, which is now pinned mechanically. This is the repo's one worked example of
  converting a prose invariant into a test, and it is the pattern the other ten should follow.
- **Discarding a `persist()` result is safe for notices but not for state.** The wrapper
  raises its own notice, so the visible half is covered; what leaks is `autosaveFailed`,
  which feeds the FR-006 guard. That is a non-obvious coupling worth a comment.

## Historical Context (from prior changes)

- `context/changes/storage-layer-consistency-audit/research.md` — F1–F11. F1–F4 fixed and
  verified; **F5–F11 deliberately scoped out** at `plan.md:79-82` and still present.
- `context/changes/storage-layer-consistency-audit/research.md:381-386` — nine prose-only
  cross-module invariants; this pass counts eleven.
- `context/changes/generator-island-decomposition/research.md:226-228` — jsdom would close
  both F11 and the L-04 a11y gap in one move; **cost was never assessed**. This is a direct
  input to rollout Phase 1's harness decision.
- `context/changes/manual-item-corrections/plan.md:173-183` — the cross-tab path is a
  deliberate carve-out from "every path is guarded". M-1 is therefore a known gap being
  re-raised with evidence, not a new discovery.
- `context/changes/merchant-storage-contract/plan.md:441-446` — Vitest isolates module state
  per file, so the read-only latch needs `resetReadOnlyLatch`; making it a no-op kills 26
  tests. Any harness change must preserve this.
- `context/changes/last-merchant-persists/reviews/impl-review-phase-2.md:68` — *"the island
  is covered by exactly zero automated tests and always will be under this config"*.

## Related Research

- `context/changes/storage-layer-consistency-audit/research.md` — the mutation audit this
  pass builds on
- `context/changes/generator-island-decomposition/research.md` — the harness cost question
- `context/foundation/lessons.md` — L-03, L-04, L-05 are the methodological priors for this
  document

## Open Questions

1. **jsdom or Vitest Browser Mode for rollout Phase 1?** Browser Mode is stable from Vitest
   v4 and an Astro island hydration helper exists, but every target behavior above is
   reachable with jsdom plus Testing Library, which is cheaper to run in CI. The one
   argument for Browser Mode is item 25 (computed focus-ring contrast), which jsdom cannot
   answer. Recommend jsdom for Phase 1 and defer contrast to Phase 5's viewport layer.
2. **Should M-2 be closed by deleting the manual criteria or by running them?** Roughly 40
   rows across three plans were never executed. Automating the subset that the new harness
   makes reachable is cheaper than re-running them by hand, but some are genuinely
   browser-only.
3. **Is an empty correction entry `{}` reachable from the UI path?** Carried over
   unresolved from the prior audit. `handleCorrect` (`MerchantGenerator.tsx:1527`) sits in
   the untested file; item 13 closes the unit half regardless.
4. **Does `assortment.ts` actually guarantee `itemId` uniqueness?** `corrections.ts:32-34`
   warns that corrections leak between rows with no visible symptom if it weakens. Still
   unverified.
5. **Twelve existing tests cannot fail for the right reason** (three delegation
   tautologies, one L-03-shaped reachability hole at `merchant-session.test.ts:241-256`, and
   `assortment.test.ts:48-51` restating the implementation's own formula). Out of scope for
   this rollout phase — worth a dedicated pass or a lesson entry.
