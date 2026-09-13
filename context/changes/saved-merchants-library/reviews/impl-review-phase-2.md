<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Biblioteka zapisanych kupców — Phase 2

- **Plan**: `context/changes/saved-merchants-library/plan.md`
- **Scope**: Phase 2 of 3 — "List panel and open" (landed as `32e1317`)
- **Date**: 2026-09-13
- **Verdict**: REJECTED at review — **all 10 findings fixed in triage, 2026-09-13**
- **Findings**: 1 critical, 7 warnings, 2 observations (10 fixed, 0 skipped, 0 accepted as risk)

## Triage outcome (2026-09-13)

All ten fixed. Gates after triage: `npm test` **357 passed** (up from 354 — three new tests),
`npm run lint` exit 0, `npx astro check` 0 errors 0 warnings, `npm run build` complete with
`dist/client/index.html` present.

Two fixes were **narrowed or corrected while being applied**, both recorded in their Decision
fields: F9 (propagating the failure would have denied a save that really landed — only the
`opened` dispatch is skipped) and F7 (reusing the existing live region would have masked every
later save announcement, so the delete got its own).

Verification beyond the gates:
- **F1** — probe with a storage fake (`throwOn: true`, no prior read): `deleteMerchant` returns
  `read-only` and the record survives, i.e. pre-fix a confirmed delete silently did nothing.
- **F4** — mutation-checked per L-03: replacing the content gate with a bare `return transient.id`
  fails both divergence tests while the identical-work test stays green (no cry-wolf).
- **L-04 re-confirmed at source** this session: every `astro/jsx-a11y/*` rule is built from a
  wrapper that opens `if (!parserServices?.isAstro) return {};`, so all 34 short-circuit to an empty
  listener on a `.tsx` parse. Five of these ten findings were accessibility defects that no gate in
  this repo can see.

## Scope note

Phase 2's two files have drifted heavily since `32e1317` — `MerchantGenerator.tsx` +805/−110 and
`MerchantLibrary.tsx` +215/−51 across six later commits (`5a2eb03`, `d42b7d0`, `89367e9`,
`c511e47`, `e5575a0`, `9aa3ed8`). Findings are stated **against HEAD**, because that is what ships;
each carries its attribution. Issues that were wrong as landed and have since been repaired are
listed under "Repaired since the phase landed" and are not findings.

**Phase 2's own contract came out remarkably clean: 8 of 8 planned items MATCH, verified at HEAD.**
Every finding below is either a later commit's regression against Phase 2's contract, or a defect in
code Phase 2 introduced that no later commit touched.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated criteria verified at HEAD: `npm test` 354 passed / 7 files, `npx astro check` 0 errors
0 warnings, `npm run lint` exit 0, `npm run build` complete, `dist/client/index.html` present
(criterion 2.4). All five Progress rows 2.1–2.5 are honestly stamped.

## Findings

### F1 — A `read-only` write failure is completely silent, and the comment justifying that is wrong

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:193-197`
- **Detail**: `conditionFromFailure` maps `read-only` to `null` — no notice — on the stated grounds
  that "the latch is already engaged, and whatever engaged it … recorded its own condition when the
  read hit it." That premise holds only when the latch was engaged by a **read**. It can also engage
  **inside a write**, through a `readDocument` the component never sees:

  `loadForWrite` (`merchant-storage.ts:548-556`) → `readDocument` → `probeWritable` returns
  `"unavailable"` (`:243-251`) → `readOnly = true` and `{status:"read-only", doc}` at `:492-500` →
  `loadForWrite` maps it to `{status:"read-only"}` (`:571-576`). Trigger: the store stops accepting
  writes *after* mount — site data blocked mid-session, or any non-quota `setItem` exception
  (`isQuotaError` at `:221-229` deliberately routes anything it cannot classify to `"unavailable"`,
  which latches). A merely *full* store returns `quota-exceeded` and does raise a notice, so the
  common case is covered; this is the "store disabled mid-session" case.

  The two sites that *do* raise `unavailable` for `read-only` — the mount read
  (`MerchantGenerator.tsx:476`) and the cross-tab re-read (`:562-571`, whose comment names this exact
  hazard and claims to cover it) — are both **read** paths. Neither runs on a write. So from that
  moment, for the rest of the page load:

  - `deleteSavedMerchant` (`:1070-1089`) — the GM confirmed an irreversible "Usuń", the dialog
    closes, the row stays, **and nothing is said at all**.
  - `handleSave` (`:802-807`) — `promote-failed` re-arms the button (honest) but raises no notice;
    the GM presses Zapisz repeatedly into total silence.
  - `persist` (`:762-767`) and `autosaveOpened` (`:911-916`) — corrections stop reaching storage with
    nothing on screen saying so. This is the PRD guardrail ("zapisany kupiec nigdy nie znika po
    cichu") failing in the manner it forbids.
  - `handleRename` (`:964-967`) — same silence.

  `session.state` is not stood down on this path either (only `handleFailedRead` does that, and only
  from a read), so `persist`'s `stood-down` early return at `:725` never engages.

  Attribution: `conditionFromFailure` originates in S-03 (`d278711`) and was extended by Phase 3 and
  `d42b7d0`; the delete leg is `d42b7d0`. Not Phase 2's code, but it is the failure surface Phase 2's
  contract routed every one of its storage failures through ("Storage failures from any of these go
  through S-03's existing `StorageNotice`").
- **Fix A ⭐ Recommended**: Map `read-only` to `"unavailable"` in `conditionFromFailure` unless a standing condition is already recorded in `conditions`.
  - Strength: One function, and it restores the invariant the rest of the file already assumes — that every non-`ok` write outcome reaches the GM. Preserves the original intent (don't replace a reason with its consequence) in the case where that reason genuinely exists.
  - Tradeoff: Needs a read of the current `conditions` set, so the mapping stops being a pure function of the status.
  - Confidence: HIGH — the failure path is fully traced above and the two read sites show the intended copy already exists.
  - Blind spot: Have not checked whether `StorageNotice` de-duplicates a condition raised twice from different sites.
- **Fix B**: Raise `"unavailable"` and dispatch `persistence-off` at the first write that returns `read-only`.
  - Strength: Also disarms the save button, so the UI stops offering an action that cannot work.
  - Tradeoff: `stood-down` is absorbing, so it kills the button for the rest of the page load — which the mount read's comment (`:469-475`) explicitly rejects as hiding the remedy for a recoverable Safari-private-mode store.
  - Confidence: MEDIUM — correct about the notice, but it re-opens a tradeoff this codebase already decided the other way.
  - Blind spot: Whether a mid-session latch is as recoverable as the mount-time one that reasoning was written for.
- **Decision**: FIXED via Fix A — added `raiseWriteFailure(status)` (`MerchantGenerator.tsx:293-325`), which handles `read-only` by raising `"unavailable"` unless a standing condition is already recorded, reading the set **inside the `setConditions` updater** so a condition raised moments earlier cannot be missed through a stale closure. All five `conditionFromFailure` call sites collapsed onto it (they were five copies of the same four lines); `conditionFromFailure` keeps `read-only → null` with a comment pointing at the new owner. The blind spot resolved on inspection: `raise` already de-duplicates (`current.includes(condition) ? current : …`), and the four standing conditions are exactly the latch-engagers. All five sites are plain component-body functions, not `useCallback`s, so no dependency array needed updating — confirmed by `react-hooks/exhaustive-deps` being enabled (warn) and lint reporting zero warnings. **Probe** (storage fake, `throwOn: true`, no prior read): `deleteMerchant` returns `read-only` and the record survives — i.e. pre-fix the GM's confirmed delete silently did nothing. 354 passed, lint exit 0, 0 type errors.

### F2 — `adopt` claims the transient slot before the write that would justify it has landed

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:382`, with `:1126-1141`
- **Detail**: `persist` goes to lengths to set `lastTransient.current` only after a successful write,
  and says why at `:746-755`: setting it first "made that claim false after every failed write … the
  next `storage` event … adopted the older stored merchant over the corrections that had just failed
  to persist." `adopt` re-introduces exactly that, unconditionally.

  For the two read paths it is harmless — `restoreFromDocument` returns `doc.transient` verbatim, so
  the bytes match the slot. For `openMerchant` it is wrong by construction: `merchant` is a **saved**
  record (`savedAt` non-null) while the `persist` two lines later writes a different object with
  `savedAt: null` (`:736-737`). On success `persist` corrects the ref; **on failure it does not**, and
  `openMerchant` ignores `persist`'s return value entirely (`:1126`).

  Consequence: `lastTransient.current` matches neither the slot nor anything else. The next `storage`
  event from any unrelated write in another tab computes `incomingBytes !== lastTransient.current`
  (`:602-605`), takes the replacement path, and adopts the **stale previous transient** over the
  merchant the GM just opened — closing any open dialog (`:645`) and, with Phase 1 triage's
  `restored → null` change to `nextOpenedSavedId`, dropping the tab out of the open record.

  Attribution: introduced in `32e1317` — **this is Phase 2's own defect**, and it survived the
  `9aa3ed8` sweep.
- **Fix**: Move the `lastTransient.current` assignment out of `adopt` and make it the caller's business — the storage handler already sets it at `:606`; the mount read and `openMerchant` would set it only on a landed write. Alternatively have `openMerchant` check `persist`'s return and reset the ref on failure.
- **Decision**: FIXED via Fix A — the assignment is gone from `adopt` (replaced by a comment stating why the claim cannot be made there) and now lives with each caller. Blind spot resolved by tracing all three: the cross-tab handler already set it itself *before* calling `adopt` (`:655`), so it needed nothing; the mount read is the one path that legitimately claims the slot without writing and now does so explicitly (`:542`); `openMerchant` claims nothing, so `persist` sets it to the bytes it actually wrote on success (`:806`) and on failure it correctly keeps pointing at the previous transient — which is still what the slot holds. Three assignment sites, each true by construction. 354 passed, lint exit 0, 0 type errors.

### F3 — The whole row is no longer the open target; the name opens a rename field instead

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/components/MerchantLibrary.tsx:255-268`, name input at `:245`
- **Detail**: Phase 2's contract: "The whole row is the open target, sized as a comfortable tap
  target." As landed in `32e1317` that was exactly true — a single `<button className="flex min-h-11
  w-full …">` wrapped name and detail. At HEAD only the *detail* line opens the merchant; the name
  line is a rename input. The name — the row's most prominent element — is no longer part of the open
  target, so a GM tapping the merchant's name focuses a rename field instead of opening it. At 360 px
  the full-width 44px rename strip sits directly above the narrower open strip, so a thumb aiming at
  "the row" lands on rename.

  The cause is structural and documented at `:141-158`: HTML forbids `<input>` inside `<button>`.
  Attribution: `5a2eb03` (Phase 3 rename) and `d42b7d0` (S-05 delete) — a deliberate, reasoned
  regression against Phase 2's contract, not an accident. Mitigations present: the open button carries
  `aria-label={"Otwórz: " + name}` and the detail line is `min-h-11 flex-1`.
- **Fix A ⭐ Recommended**: Accept and record it — amend Phase 2's contract sentence in the plan with the HTML constraint and the mitigation, so a future review does not read it as unimplemented.
  - Strength: The constraint is real and the current split is already reasoned in code; nothing is gained by re-litigating it, and the plan stops asserting something false.
  - Tradeoff: The 360 px mis-tap stands. The PRD's only NFR is phone readability, so this is the cost that actually matters.
  - Confidence: HIGH — the `<input>`-in-`<button>` constraint is not negotiable.
  - Blind spot: No measurement of how often a GM taps the name expecting to open.
- **Fix B**: Make the name open-on-tap and move rename behind an explicit affordance (an edit icon, or double-tap).
  - Strength: Restores the plan's interaction; open is the frequent action and rename the rare one, so the common case gets the big target.
  - Tradeoff: Introduces a second editing idiom, which the plan's Phase 3 explicitly set out to avoid; a new icon button also competes for width at 360 px.
  - Confidence: MEDIUM — the interaction is better, but it trades against a different plan commitment.
  - Blind spot: Haven't prototyped whether an edit affordance fits the row at 360 px alongside delete.
- **Decision**: FIXED via Fix A — an addendum under the Phase 2 contract sentence in `plan.md` records that the clause held exactly as landed, that `<input>`-inside-`<button>` is what broke it, that the sentence is therefore **superseded rather than unmet**, and what the accepted cost at 360 px is alongside the three mitigations. No code change.

### F4 — After a reload, the discard guard stands down over a correction that reached only the transient slot

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:379` and `:1225-1230`; `src/lib/merchant-session.ts:361-368`
- **Detail**: Phase 2's item 3 built the discard guard. `corrections-autosave` replaced its predicate
  with `wouldLoseCorrections(hasCorrections, openedSavedId)` = `hasCorrections && openedSavedId === null`
  (`merchant-session.ts:340-342`), wrapped by `wouldLoseWork` (`:133-147`), which re-arms the guard
  when `autosaveFailed` is true. That is coherent in-session and covers three cases the original did
  not — a deleted open record, a failed autosave, and another tab replacing the record.

  The hole survives a reload. `handleCorrect` (`:1225-1230`) writes the transient slot **first**, then
  attempts `updateSavedMerchant`; if the second fails, the transient holds a correction the library
  record does not. In-session `autosaveFailed = true` re-arms the guard. But on the next page load:

  - `adopt` sets `setAutosaveFailed(false)` unconditionally (`:379`) — "whatever is arriving came out
    of storage, so it is by definition already stored." True of the *transient* slot, not of the
    *saved record*.
  - `reopenEvent` (`:166-169`) infers `opened` from `openedSavedIdFor`, which matches purely on id
    (`merchant-session.ts:361-368`) and never compares `rows` or `corrections`.

  So the restored screen reports `openedSavedId != null, autosaveFailed == false`, the guard stands
  down, and a Generate silently discards corrections that live only in the transient slot — which the
  draw then overwrites. Narrow (needs a failed in-place write, a successful transient write, and a
  reload), but it is precisely the loss class the guard exists for.

  Attribution: `c511e47` / `e5575a0`, not Phase 2 — but it is Phase 2's guard that was replaced.
- **Fix**: Have `openedSavedIdFor` (or `reopenEvent`) compare the transient's `rows`/`corrections` against the matching saved record and decline to report the record as "open" when they differ — the divergence is exactly the state `autosaveFailed` tracked in-session.
- **Decision**: FIXED — `openedSavedIdFor` now finds the record and gates on a new `sameStoredWork(transient, record)`, which compares only the two fields `updateSavedMerchant` patches (`rows`, `corrections`) field-by-field rather than by `JSON.stringify` — a stringify comparison answers "differs" on a bare key-order change, and a false divergence here fires the discard dialog over safe work, which is the cry-wolf failure `wouldLoseCorrections` exists to stop. Identity fields are deliberately excluded (`savedAt` is `null` on the transient copy, so comparing them would report every open record as diverged). Reporting `null` re-arms both the guard and the save button, so the GM can still get the correction into the library. Three tests added: corrections fallen behind → `null`, rows no longer matching → `null`, identical work → still open. **Mutation-checked**: replacing the gate with a bare `return transient.id` fails both divergence tests (`expected 'm-kowal' to be null`) while the identical-work test stays green. 357 passed, lint exit 0, 0 type errors.

### F5 — No usable focus indicator on any of the library's three buttons

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantLibrary.tsx:54-63` (panel toggle), `:255-262` (open), `:273-279` (delete)
- **Detail**: `src/styles/global.css:117-120` applies `outline-ring/50` to `*` —
  `oklch(0.708 0 0 / 50%)`, roughly 1.3:1 on white, well under the 3:1 floor WCAG 2.4.11 sets for
  focus indicators. Every control in this codebase that went through an a11y pass overrides it:
  `PriceQuantityCell.tsx:284-285`, the rename input in this very file (`:245`), and
  `ui/button.tsx:8`. These three raw `<button>` elements do neither, so keyboard focus is drawn in
  that washed-out grey. The delete button is worst: its only non-default affordance is
  `hover:bg-red-50` (`:279`), and hover does not exist on the phone the PRD's only NFR is about.

  Nothing in CI can catch this — per lesson **L-04**, `flat/jsx-a11y-recommended` is namespaced
  `astro/jsx-a11y/*` and applies only to `.astro` files. Re-verified for this review with a probe
  component containing an unlabelled `<input>`, an `<img>` with no alt and a `<div onClick>`: zero
  eslint output.
- **Fix**: Add the same `focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-800` the rename input directly above them already carries.
- **Decision**: FIXED — the house focus token added to all three buttons (panel toggle, open, delete), matching `PriceQuantityCell.tsx:137` and the rename input in the same file token for token.

### F6 — The search-result live region is mounted together with its first content

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantLibrary.tsx:98-102`, with `:113`
- **Detail**: `{filtering && (<p role="status">{merchants.length} z {saved.length}</p>)}` inserts the
  region and its first message in one commit. This is the exact failure two siblings document and
  avoid — `StorageNotice.tsx:158-167` says a polite live region "has to be in the accessibility tree
  **before** its content changes; inserting the region and its first message in one commit is the
  classic case screen readers skip", and names L-04 as why nothing would catch it.
  `MerchantTable.tsx:45` and `MerchantGenerator.tsx:1358` both mount their regions unconditionally
  and empty. Here the first filtered count is very likely never announced; the region is also nested
  inside `hidden={!expanded}` (`:78`), so it leaves and re-enters the tree with the panel. Separately,
  the "no matches" message (`:113`) sits in no live region at all, so filtering to zero results is
  announced by nothing. Attribution: `89367e9` (S-05 search).
- **Fix**: Mount `<p role="status">` unconditionally next to the input, render `{filtering ? \`${merchants.length} z ${saved.length}\` : ""}` inside it, and move the zero-match copy into the same region.
- **Decision**: FIXED (partially) — the region is now mounted unconditionally and filled later, with the reason and the two sibling precedents recorded in a comment. The zero-match copy was **left where it is**: it is a visible paragraph that replaces the list rather than a status update alongside it, and folding it into the count region would mean announcing it twice. Noted here rather than silently narrowed.

### F7 — Delete drops focus to `<body>` and announces nothing

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantLibrary.tsx:273-282` with `src/components/MerchantGenerator.tsx:1070-1082`
- **Detail**: Native `<dialog>` restores focus to the invoking element on close — but that element is
  the row's delete button, unmounted in the same commit that closes the dialog (`setSaved(filter…)`
  at `:1079`). Focus therefore lands on `<body>` and a keyboard user is thrown to the top of the
  document. Nothing announces the deletion either: the only sr-only live region
  (`MerchantGenerator.tsx:1358`) speaks for saves, and `StorageNotice` stays silent because the delete
  succeeded. Attribution: `d42b7d0`.
- **Fix**: Announce the removal in the existing always-mounted sr-only `role="status"` paragraph, and move focus to the panel toggle (which always exists) after a successful delete.
- **Decision**: FIXED, with one correction found while applying it — reusing the *existing* sr-only region meant a delete masked every later save announcement, because `deletedNotice` has no moment at which it becomes false. It now has its own always-mounted region, one fact each. The merchant's name is read out of `saved` **before** the write (afterwards the row is gone), falling back to a nameless sentence. Focus moves to the panel toggle via a new exported `LIBRARY_TOGGLE_ID` — a shared id rather than a ref prop, matching the `aria-controls="merchant-library-panel"` idiom already in that file.

### F8 — Row border is below the project's own contrast floor

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantLibrary.tsx:212`
- **Detail**: `border-neutral-200` on the resting row. `AGENTS.md` is explicit: any rule carrying
  meaning needs `neutral-300` or darker, and control borders need `neutral-500` for 3:1 on white.
  `neutral-200` is `oklch(0.922)` — about 1.2:1, effectively invisible — and in a `gap-1` stack
  (`:115`) this border is the only thing separating one interactive row from the next.

  This is the half the `9aa3ed8` sweep missed: the panel toggle's border **was** repaired in that
  commit (`32e1317:52` `border-neutral-300` → HEAD `:63` `border-neutral-500`), but the row border
  introduced in the same original commit was left at `neutral-200`. Attribution: `32e1317` — Phase 2's
  own value. The *open* marking needs no change: `aria-current` (`:260`), the "otwarty" text badge
  (`:248`) and `border-neutral-800` mean that state is not colour-only.
- **Fix**: `border-neutral-300` at minimum for the resting row; `neutral-500` if it reads as a control boundary.
- **Decision**: FIXED — `border-neutral-300`, with a comment naming the AGENTS.md floor and why this rule carries meaning (in a `gap-1` stack it is the only separator between interactive rows). The open row keeps `border-neutral-800`.

### F9 — `addMerchant`'s second `persist` return is dropped

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:862-864`
- **Detail**: If that write fails, the slot keeps the pre-promote id while `header` and session moved
  to the promoted one, so a reload right then shows the merchant as *not* opened (`openedSavedIdFor`
  finds no id match) even though it is in the library. Self-heals on the next correction, and
  `persist` does raise a notice for quota/unavailable. The *first* `persist` in the same function
  (`:836-839`) **is** checked, so the asymmetry looks accidental rather than decided.
- **Fix**: Check the return the same way the first call does.
- **Decision**: FIXED, narrowed during triage — the return is now checked, but **not** propagated as a save failure: the promote has already landed, so reporting `promote-failed` would deny a save that really happened. What failed is only the transient relink, so the fix is to skip the `{ event: "opened" }` dispatch in that case. Claiming it would point `openedSavedId` at a record the slot does not hold — the same class of bug F4's content check catches after a reload. `persist` already raises its own notice.

### F10 — A cross-tab delete of the open record is correct but silent

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:585` with `:340-346`
- **Detail**: Handled by design — `setSaved` at `:585` runs before the transient-equality early return
  at `:603`, so `openRecordGone` re-arms the button with no handler needed. But both sibling
  discoveries of the same fact do speak: `handleRename`'s `not-found` (`:958-961`) and
  `autosaveOpened`'s (`:898-910`) each `raise("record-gone")`. This path raises nothing, so the
  merchant quietly stops being the open record and the next Zapisz appends a copy. The failure
  direction is safe — a duplicate, not an overwrite — hence OBSERVATION.
- **Fix**: `raise("record-gone")` on this path too, matching the two siblings.
- **Decision**: FIXED — the cross-tab handler now raises `record-gone` when the open record is absent from an `ok` re-read, before `setSaved`. `session.openedSavedId` was already in the effect's dependency list, so no dependency change was needed (confirmed: `react-hooks/exhaustive-deps` is enabled and lint reports zero warnings).

## Phase 2's own contract — verified MATCH at HEAD

| Plan item | Evidence |
|---|---|
| `saved` from S-03's **single mount read**, never a sibling `listSaved()` | `grep -rn "listSaved" src/` returns zero call sites outside `merchant-storage.test.ts`; the only two hits in `MerchantGenerator.tsx` (`:269`, `:487`) are comments naming the rejected alternative. Set from `read.doc.saved` at exactly two sites — mount (`:490`) and cross-tab re-read (`:585`). **The plan's most emphatic architectural instruction, honoured as landed and never violated since.** |
| Opening is **one commit** | `openMerchant` (`:1112-1142`) is plain synchronous: `restoreFromMerchant` → `adopt` (7+ setters, `:368-395`) → `persist`. `grep` for `await\|setTimeout\|Promise\|async\|queueMicrotask\|requestAnimationFrame` across both files returns nothing but one doc-comment. Both callers are React event handlers, so `openedSavedId` cannot land a render late. |
| Generate clears `openedSavedId` | `draw()` `:1182-1184` dispatches `cleared-open` then `generated` in one updater; the reducer clears on both anyway. |
| Panel collapsed by default | `useState(false)` at `:42`. |
| Opened row marked | `aria-current` (`:260`), "otwarty" text badge (`:248`), `border-neutral-800` — not colour-only. |
| Empty list shows a hint | `:106-109`, plus a separate no-match hint at `:113`. |
| Cross-tab refresh gated on `ok` | `:585` sits below an early return for every non-`ok` status; `empty` returns without touching `saved`. |
| Cancelled open changes nothing | `handleCancel` (`:1095-1097`) is a one-line `setPending(null)` — no rows, no corrections, no session, no `putTransient`. `openMerchant` is unreachable from the cancel path. |
| Scope guardrails | `32e1317` touched exactly three files (plan.md + the two components): no second route, no schema change, no new storage operation, no `assortment.ts`/`corrections.ts` edit, no virtualisation, no test-glob widening, no `ConfirmDialog.tsx` change. `src/pages/` still holds only `index.astro`. |
| "No component change required" for `ConfirmDialog` | `git log -- src/components/ConfirmDialog.tsx` shows only `76a2b22` (S-02) and `9aa3ed8` (later sweep). Claim held. |
| Plan edit inside the implementation commit | 18 lines, all checkbox stamping (2.1–2.5 flipped, sha appended to 1.1–1.4). No contract text altered. |

Also clean and verified: effect dependency honesty (both effects' deps bottom out correctly; all
listeners removed; no timers or async, so no state-after-unmount path), status-union exhaustiveness
at every other call site (two `const unhandled: never` guards at `:519` and `:1052`), keyboard
operability (no `onClick` on a `div`/`li`; the toggle is a real button with `aria-expanded` **and**
`aria-controls` pointing at an element that always exists), tap targets (`h-11`/`min-h-11`/`size-11`
throughout — no 44px violation), icon-only naming (`Trash2` is `aria-hidden` inside a button labelled
with the merchant's name), and palette compliance (no `gray-`/`slate-`/`zinc-`, no shadcn tokens).

## Repaired since the phase landed — not actionable

Recorded so a future reader does not re-open them. All were wrong in `32e1317`:

- Promoted the transient **without re-persisting first** (could append the wrong merchant after a
  failed write) and **without adopting the promoted record** (corrections after a save went only to
  the transient) — both fixed by `addMerchant` (`:825-868`).
- `openedSavedId` was not re-derivable on mount: the restore effect dispatched a bare
  `{event:"restored"}`, and neither `openedSavedIdFor` nor `wouldLoseCorrections` existed. **Open a
  merchant, reload, press Zapisz → a near-identical copy was appended** — the exact duplicate the
  plan's "three writes must land together" note exists to prevent, arriving by the one route the plan
  did not consider: the reload, not the render gap. Criterion **2.14** is stamped `[x]` and reads
  "Reload after opening restores the opened merchant, not the previous one" — true of the *rows*,
  which is presumably what was checked, but the *opened marking* did not survive. Fixed by
  `reopenEvent` (`:166-169`) in `c511e47`.
- No transient-changed guard, so any rename or delete in another tab replaced this tab's screen and
  cried "superseded" — fixed by the byte comparison at `:602-605`.
- `openMerchant` passed the raw stored correction map to `persist` instead of `fromStoredCorrections`.
- `handleOpen` gated on bare `hasCorrections` instead of the shared `losesWork()`.
- `StorageNotice` took a single condition slot that dropped the second of two simultaneous facts.
- The toggle bar's `border-neutral-300` is now `neutral-500`.

## Lower-value notes (not findings)

- **Label-in-name on the open button** (`MerchantLibrary.tsx:260-267`): visible text is
  `Kowal · 18 poz. · …`, accessible name is `Otwórz: ${name}` — no shared word (WCAG 2.5.3, speech
  input). `MerchantTable.tsx:91,115` builds names that *contain* the visible content.
- **No memoisation of the filtered list** (`:49`): `filterMerchants` runs every render, doing a full
  sort copy plus `normalizeForSearch` and a `CATEGORIES.find` per merchant per keystroke. Genuinely
  negligible at the plan's scale — noted only so a future virtualisation discussion starts correctly.
- **Three callbacks, three prop shapes**: `onOpen(merchant)`, `onDelete(id)`, `onRename(id, name)`.
  The id form forces `handleDelete` to re-find the record (`:1023-1024`) with a silent `return` on a
  miss that cannot happen.
- **Minor**: the toggle's accessible name `"Zapisani kupcy 3 ▾"` duplicates the region's own name and
  the bare `3` has no unit; the search field's `aria-label` is less informative than its placeholder,
  so a screen-reader user never learns category is searchable; `libraryRow`'s `name` and `id` are now
  dead (the input reads `merchant.name`, the key uses `merchant.id`).
