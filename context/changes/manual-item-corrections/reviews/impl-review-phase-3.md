<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Ręczne korekty, których nie da się zgubić

- **Plan**: `context/changes/manual-item-corrections/plan.md`
- **Scope**: Phase 3 of 3 — Confirmation before regenerate (shipped `76a2b22`, reviewed against the current working tree)
- **Date**: 2026-09-12
- **Verdict**: REJECTED → **RESOLVED** (triaged 2026-09-12; 9 fixed, 1 recorded as a rule, 0 outstanding)
- **Findings**: 1 critical, 4 warnings, 5 observations

## Post-triage gate run (2026-09-12)

`npm test` 320 passed · `npx astro check` 0 errors · `npm run build` complete, `dist/client/index.html`
present · `npm run lint` exit 0.

The critical (F1) is closed: the FR-006 guard no longer stands down on a record whose last write
failed. F3 then unified the predicate so the gate and the cross-tab notice cannot disagree, and
F2 recorded the one path that genuinely cannot be gated. F6 became lesson **L-04** rather than a
code change.

**Caveat carried forward:** F1's fix is verified by reading, not by execution — the logic lives in
the island and the Vitest glob is Node-only with no jsdom. Manual row 3.5 should be extended to
exercise it (open a saved merchant, make storage fail, correct a price, press Stwórz — the dialog
must appear). All eight Phase 3 manual rows remain unchecked.

## Review lens

Phase 3 shipped in `76a2b22`. `ConfirmDialog.tsx` has **not been edited once since** — `git diff 76a2b22 -- src/components/ConfirmDialog.tsx` is empty across seven later commits. `MerchantGenerator.tsx` has been modified by all three later slices plus uncommitted work. This review asks whether the Phase 3 contract still holds today, and attributes each deviation to the commit that caused it.

**The verdict is REJECTED on one finding (F1), and the fix is about three lines.** That is not alarmism about the component — the component is the strongest code in this change. It is that the guarantee the whole slice exists to provide has a reachable hole.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

### What holds

`ConfirmDialog` satisfies its contract in full, including both lifecycle details the plan singled out:

- **`showModal()`/`close()` are properly guarded** — `open && !dialog.open` and `!open && dialog.open`, so `InvalidStateError` is unreachable, mounting with `open` already true works, and a StrictMode double-invoke is a no-op.
- **The `cancel` event is wired to the element, not just the button** (`:67-71`), with `preventDefault()` so React state owns `open` — exactly the divergence the plan warned would read as "Stwórz stopped working". `onCancel()` is called unconditionally, so even where a browser ignores `preventDefault` on a close request, state and DOM stay in sync.
- **Backdrop dismissal is handled explicitly** (`:79-81`) with a correct note that native `<dialog>` does not light-dismiss.
- **`destructive` keeps Enter off the damaging button** via DOM order plus an explicit `cancelRef.focus()`.

**The "generic with one caller" bet paid off.** Three logical callers arrived — Generate, Open (S-04, `32e1317`), Delete (S-05, `d42b7d0`) — through one JSX element driven by a `PendingAction` union. Zero renames, zero call-site sweeps, and the collapse is *stronger* than the plan predicted: one `<dialog>` makes two simultaneous modals impossible, and the pending action carries its `Merchant` as data so a confirm cannot mis-target.

**Cancel genuinely changes nothing** (`:775-781`) — verified against every `recentIds`, `setRows`, `setCorrections`, `setCategory`, `setWealth`, `setHeader` and `setSession` write. `recentIds` is written only inside `draw()`, so a cancelled Generate cannot consume the recency bias, and that holds for all three actions.

### Automated success criteria — re-run 2026-09-12

| # | Criterion | Result |
|---|---|---|
| 3.1 | `npm test` | PASS — 320 tests |
| 3.2 | `npx astro check` | PASS — 0 errors, 0 warnings |
| 3.3 | `npm run build` | PASS — `dist/client/index.html` regenerated |
| 3.4 | `npm run lint` | PASS — exit 0 |

All eight manual rows (3.5–3.12) remain unchecked. Nothing is rubber-stamped.

## Findings

### F1 — A failed autosave silently suppresses the FR-006 dialog

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:677-679`, `:623-648`, `src/lib/merchant-session.ts:314`
- **Detail**: The guard now asks `wouldLoseCorrections(hasCorrections(...), session.openedSavedId)` — suppressing the dialog whenever a saved record is open, on the reasoning that "an open record auto-saves every correction, so replacing it costs nothing."

  That reasoning is right in principle and well documented (`corrections-autosave/change.md:59-66`: a warning that cries wolf gets click-through-trained away). **But `openedSavedId` means "was opened", not "is durably saved", and the two come apart whenever the autosave write fails.**

  `autosaveOpened` is best-effort (`:632-638`): on failure it raises a notice and returns — **`openedSavedId` is untouched**. I checked the reducer for an escape hatch and there is none: `nextOpenedSavedId` (`merchant-session.ts:265-275`) clears only on `opened` / `cleared-open` / `generated`; everything else hits `default: return current`.

  So: open a saved merchant → correct a price → the write fails → the correction lives only in React state → press Stwórz → `wouldLoseCorrections(true, "m-1")` is `false` → `draw()` runs with no dialog and the correction is gone. The transient `persist()` at `:901` fails for the same reason, so a reload does not recover it.

  **Three reachable failure modes, and two of them are fully silent:**

  | Failure | Notice shown? | Dialog suppressed? |
  |---|---|---|
  | `quota-exceeded` / `unavailable` | Yes — `StorageNotice` banner | Yes |
  | `read-only` | **No** — `conditionFromFailure` returns `null` (`:188-191`) | Yes |
  | `not-found` (record deleted in another tab) | **No** — returns `null` (`:193-196`) | Yes |
  | `stood-down` session | No — `persist` early-returns (`:498`); `autosaveOpened` does not even check | Yes |

  The `not-found` row is the Phase 2 review's F9 compounding with this one: the record is gone, nothing is written, nothing is said, and the guardrail is still suppressed.

  FR-006 states "no correction is ever discarded without the GM being asked first". On these paths it is. A storage banner is not the same thing as being asked before work is destroyed — and on two of the four it is not even that.

- **Fix A ⭐ Recommended**: Track autosave success and OR its failure back into the guard — set a `lastAutosaveFailed` flag when `autosaveOpened` returns early, clear it on a successful write, and use `wouldLoseCorrections(hasCorrections(...) , failed ? null : session.openedSavedId)` (or add it as a third argument).
  - Strength: Restores the guarantee at the predicate, so every current and future caller of `losesWork()` inherits it — and there are already two. Keeps the anti-cry-wolf behaviour intact for the overwhelmingly common case where the write succeeds.
  - Tradeoff: One more piece of state in an island that already holds nine, and the flag has to be cleared on every success path or the dialog starts over-firing.
  - Confidence: HIGH — I traced all four failure paths and confirmed the reducer has no clearing branch.
  - Blind spot: Haven't checked whether `handleRename`'s failure path needs the same treatment.
- **Fix B**: Clear `openedSavedId` on a failed autosave, via a new session event, so the record stops counting as open the moment it stops being durable.
  - Strength: No new state — the existing session already models this, and one predicate keeps meaning one thing.
  - Tradeoff: Much wider blast radius. `openedSavedId` also drives the save button's copy, whether Zapisz renders at all, and the rename flow; clearing it would make the UI claim the record was never opened, and a later successful write would need to re-establish it.
  - Confidence: MEDIUM — the predicate change is right, but the downstream consumers were not audited in this review.
  - Blind spot: Whether the GM could then create a duplicate record by pressing Zapisz after a transient failure.
- **Decision**: FIXED via Fix A. Added `autosaveFailed` state (`:236`), set `true` when `autosaveOpened` returns early (`:659`) and `false` on a successful write (`:663`). `losesWork()` (`:705`) now passes `holdingTheWork ? session.openedSavedId : null` into the unchanged `wouldLoseCorrections`, so the pure predicate keeps its tested meaning and the correction is localised at the call site.

  Cleared in two places so it cannot go stale and over-fire: `adopt` (`:316`), which is the single funnel for every restore — mount, cross-tab and open — and `draw` (`:887`). Verified that every route to a non-null `openedSavedId` passes through `adopt`, so the flag is always `false` at the moment a record becomes open. If it were ever stale-true while `openedSavedId` is `null`, `holdingTheWork` is already `false` and the guard falls back to plain `hasCorrections` — the conservative direction.

  **Not covered by a test.** The logic is in the island and the Vitest glob is `src/**/*.test.ts` with no jsdom, a deliberate S-01 decision this slice does not reverse. Verified by reading the four failure paths, not by execution. Manual row 3.5 should be extended to cover it: open a saved merchant, fill storage (or delete the record in a second tab), correct a price, press Stwórz — the dialog must now appear.

### F2 — The cross-tab replacement path is not gated

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/components/MerchantGenerator.tsx:431-435`
- **Detail**: Phase 3's own criterion is that "the guardrail is only closed if **every** path into a row replacement is gated". There are exactly two `setRows` writers: `draw` (`:848`) and `adopt` (`:296`). Every route into them is gated *except* the `storage` listener, added by `d278711`:

  ```ts
  if (rows !== null && hasCorrections(rows, corrections)) {
    setStorageStatus("superseded");
  }
  adopt(incoming, reopenEvent(read.doc));
  ```

  Another tab drawing a merchant replaces this tab's rows *and* corrections with no prompt; the GM is told afterwards. The code comment shows this was considered, and a modal genuinely cannot gate a cross-tab event — "notice instead of gate" is probably the right answer. The defect is that no plan records it as an accepted exception to a criterion stated in absolute terms.
- **Fix**: Record it as a deliberate carve-out — a note in this plan's Phase 3 contract (and ideally in `last-merchant-persists`) saying the cross-tab path is covered by an after-the-fact notice rather than the gate, and why a modal cannot apply there.
- **Decision**: FIXED — a dated "Accepted exception" block now sits directly under the "every path into a row replacement is gated" criterion in `plan.md`, stating that the cross-tab path is covered by an after-the-fact `superseded` notice, why it cannot be gated (the replacement originates elsewhere, there is no gesture here to interrupt, and asking permission for something already written to storage is the wrong question), and that it is the only carve-out — both gesture-driven paths still share one `losesWork()` predicate.

### F3 — The two guard predicates diverged

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:431` vs `:678`
- **Detail**: `e5575a0` moved the Generate/Open gate to `wouldLoseCorrections` but left the cross-tab handler on the bare `hasCorrections`. The same question now has two answers in one file. With a record open, the incoming document's corrections *are* the saved ones, so `:431` fires "your corrections were superseded" over a loss that did not happen — precisely the cry-wolf behaviour `e5575a0` existed to remove, at the other site.
- **Fix**: Use `losesWork()` at `:431` so both sites ask one question. (Note the ordering: it must be evaluated against pre-`adopt` state, which it already is.)
- **Decision**: FIXED, but not by calling `losesWork()` directly — that would have been a stale-closure trap. `losesWork()` closes over `session` and `autosaveFailed`, neither of which was in the `storage` effect's dependency array, so the listener would have answered with whatever values were current when it was last attached.

  Instead the predicate is extracted to a module-scope `wouldLoseWork(rows, corrections, openedSavedId, autosaveFailed)` that is explicit about its inputs. `losesWork()` is now a one-line call to it, the `storage` handler calls the same function, and the effect's deps gained `session.openedSavedId` and `autosaveFailed`. Taking arguments rather than closing over state is what makes the dependency requirement visible instead of hidden. One question, one implementation, two call sites — and the cross-tab notice inherits the F1 fix for free.

### F4 — Closing the dialog flashes the wrong copy

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/ConfirmDialog.tsx:45-59`, `src/components/MerchantGenerator.tsx:933`
- **Detail**: `const copy = confirmCopyFor(pending ?? { kind: "generate" })` recomputes during the same render that sets `open={false}`, while a passive `useEffect` — not `useLayoutEffect` — does the imperative `close()`. Confirming or cancelling a **delete** therefore commits with the generate fallback copy while the DOM dialog is still open, and a paint can land in that gap: the GM sees "Usunąć kupca?" mutate into "Odrzucić ręczne korekty?" on its way out. The comment at `:931-932` ("nothing renders it, because `open` is false") is right about visibility but wrong about this one frame.
- **Fix**: Switch the effect to `useLayoutEffect` — it is DOM synchronisation, not a subscription, and the same change removes the one-frame delay on open.
- **Decision**: FIXED — switched to `useLayoutEffect` with a comment explaining why this one is layout rather than passive (it must land in the same frame as the render that changed `open`, precisely because the caller recomputes its copy from a cleared pending action).

  **Checked the SSR risk rather than assuming it away:** the island mounts `client:load` (`index.astro:15`), so Astro server-renders it at build time, and `useLayoutEffect` is the classic source of a "does nothing on the server" warning there. The build is clean — no such warning — and `dist/client/index.html` still contains the prerendered `<dialog>` and its copy, so criterion 3.3/2.4 are unaffected.

### F5 — The destructive dialog's Cancel button has an effectively invisible border

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/ConfirmDialog.tsx:102`
- **Detail**: `variant="outline"` resolves to `"border bg-background …"` (`ui/button.tsx:16-17`) with **no border colour**, so it falls through to the base rule `@apply border-border` (`global.css:119`) → `--border: oklch(0.922 0 0)`, roughly **1.2:1 against white**. AGENTS.md states the floor explicitly: control borders need 3:1 (`neutral-500`, not `neutral-300`).

  This is the *safe* action — the one the component deliberately focuses on a destructive dialog — and it currently reads as unstyled text beside a solid red button. The confirm button passes AA at ~4.8:1, so the contrast failure is on the wrong one.
- **Fix**: `className="h-11 border-neutral-500 bg-white"`, matching the selects at `MerchantGenerator.tsx:955, :975`.
- **Decision**: FIXED — Cancel now carries `border-neutral-500 bg-white`, with a comment recording that `variant="outline"` supplies no border colour of its own and why the safe, focused action in particular must not be the one that reads as unstyled text.

### F6 — `eslint-plugin-jsx-a11y` does not cover `.tsx` at all

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `eslint.config.js:83`
- **Detail**: The config spreads `eslintPluginAstro.configs["flat/jsx-a11y-recommended"]`, whose rules are namespaced `astro/jsx-a11y/*` and scoped to `.astro` files. **Every interactive surface in this product is a React island**, so none of it is covered.

  I verified this rather than inferring it: a probe component in `src/components/` containing `<img src="x.png" />`, an `href`-less clickable `<a>`, and an unlabelled `<input>` lints **clean** — only a TypeScript rule fired.

  This matters beyond Phase 3. The Phase 2 plan justified its accessible-name requirement by citing this very line — *"`eslint.config.js:83` enables `flat/jsx-a11y-recommended`, so the project has already opted into caring about this."* That premise is false for islands. Every a11y finding in this review round (Phase 2's F2 and F3, Phase 3's F5 and F7) was invisible to CI and always would have been.
- **Fix**: Add `eslint-plugin-jsx-a11y` proper for `**/*.tsx`, or record that React-island a11y is reviewed by hand. Strong `/10x-lesson` candidate — it is a false-confidence pattern, not a one-off bug.
- **Decision**: ACCEPTED-AS-RULE: L-04 "Bramka, która wygląda na włączoną, a nie obejmuje niczego" — appended to `context/foundation/lessons.md`, cross-linked to `[[L-03]]` (the same class of failure in test scope rather than lint scope). The rule is to check a gate's *file scope*, not merely that it is configured, and the cheap proof is a probe file.

  **Code deliberately not changed.** Enabling the plugin one day before the hard deadline would surface existing violations across every island and block lint until each was fixed or silenced. The config stays as is; React-island a11y is reviewed by hand, and the four findings from this round (Phase 2 F2/F3, Phase 3 F5/F7) were all fixed on that basis.

### F7 — The dialog body is not programmatically associated

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/ConfirmDialog.tsx:84-97`
- **Detail**: The dialog has `aria-labelledby` but no `aria-describedby`. On `showModal` focus moves straight to Cancel, so a screen reader announces the dialog's name and the focused control — and the sentence saying *what is about to be destroyed*, which is the entire point of this gate, is not guaranteed to be read.
- **Fix**: Add `id="confirm-dialog-body"` to the `<p>` at `:97` and `aria-describedby` to the `<dialog>`.
- **Decision**: FIXED — `aria-describedby="confirm-dialog-body"` on the `<dialog>` and the matching `id` on the body `<p>`, with a comment recording why the body specifically matters here (focus goes straight to Cancel, and for a delete that sentence is the only place the merchant's name appears).

### F8 — No `onClose` backstop against a DOM/state desync

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/ConfirmDialog.tsx:45-59`
- **Detail**: The desync is **not reachable today** — every close path funnels through `onCancel` — but it is unguarded rather than prevented. If any future path closes the dialog natively (a `form method="dialog"`, a programmatic `close()`), `open` stays `true`, the effect never re-runs because its deps are unchanged, and the gate becomes permanently un-openable, silently disabling the guardrail.
- **Fix**: `onClose={() => { if (open) onCancel(); }}` closes the class permanently.
- **Decision**: FIXED — `onClose` backstop added, with a comment marking it as a backstop rather than a live path. Checked that it cannot double-fire on the normal routes: by the time the layout effect calls `close()`, the component has re-rendered with `open === false`, so the attached handler's guard returns. Both the button and Escape paths were traced.

### F9 — Plan contract is stale in three places

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/manual-item-corrections/plan.md`, Phase 3 § Changes Required
- **Detail**: Three contract statements no longer describe the code, the same traceability gap as Phase 2's marker finding:
  1. *"Add `confirmOpen: boolean` to state"* — it is a three-variant `PendingAction | null` union (`32e1317`, `d42b7d0`). A deliberate superset, and better: the pending action carries its `Merchant` as data.
  2. *"The Generate handler calls `hasCorrections(rows, corrections)`"* — it calls `wouldLoseCorrections` (`e5575a0`). Documented in the autosave slice, not here.
  3. Props are enumerated as **seven**; the shipped component has **eight** — `cancelLabel`, present since `76a2b22`. The right call (baking in "Anuluj" would contradict "copy is supplied by the caller"), but never reconciled with the plan.
- **Fix**: One dated addendum to the Phase 3 contract covering all three, pointing at the commits.
- **Decision**: FIXED — a dated three-point addendum now sits at the end of the Phase 3 contract, covering the `PendingAction` union, the `wouldLoseCorrections` → `wouldLoseWork` trigger change (with a pointer to the autosave slice's reasoning and to F1's correction), and the eighth prop. The `recentIds` sentence above it is marked as re-verified rather than left ambiguous.

### F10 — Two lone exceptions to stated hard rules, plus a stale `pending` on cross-tab

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/ConfirmDialog.tsx:91`, `:102`, `:105`; `src/components/MerchantGenerator.tsx:420-442`
- **Detail**: Three small consistency items, batched because each is one line:
  - **`h-11 sm:h-10`** is the only tap-target downgrade in the codebase; AGENTS.md's 44px rule is unqualified and every sibling uses bare `h-11` / `min-h-11` / `size-11`. Defensible on a mouse, but it is a lone exception to a hard rule.
  - **`backdrop:bg-black/40`** is the only `black` in the app; the palette rule is literal `neutral-*` with `red-*`/`amber-*` as the only accents. `neutral-900/40` is the on-palette equivalent. Separately the panel declares no background at all, relying on the UA's `Canvas` — the one surface in the project whose colour it does not own.
  - **`pending` survives a cross-tab `adopt`**: the `storage` listener does not clear it, so confirming an `open` after another tab deleted that merchant puts a record on screen that is no longer in `saved`. The `delete` branch is already safe. `setPending(null)` in the storage handler closes it.
- **Fix**: Apply the three one-liners, or record the two palette/tap-target exceptions deliberately.
- **Decision**: FIXED, all three. (a) `sm:h-10` dropped from both buttons, so the dialog matches the unqualified 44px rule every sibling follows. (b) The scrim is now `backdrop:bg-neutral-900/40` and the panel states `bg-white` instead of inheriting the UA's `Canvas`, with a comment recording both reasons. (c) The `storage` listener clears `pending`, so a dialog asking about a record another tab just deleted or rewrote is closed rather than left to confirm against a stale `Merchant` snapshot.

  Note: (a) shortened the Cancel button enough that Prettier wanted it on one line — `npm run lint` failed on formatting until `npm run lint:fix` reflowed it. Caught by the gate, not by inspection.

## Not findings

- **Double-fire or dropped action** — impossible. The dialog is modal so the page is inert, and `handleConfirm` (`:728-746`) snapshots `pending` before clearing.
- **`showModal()` throwing** — unreachable; both guards are correct, including on StrictMode double-invoke and first-mount-open.
- **Escape stranding the dialog** — `onCancel()` is called unconditionally, so state clears even where `preventDefault` is ignored.
- **`destructive` passed unconditionally** at the only call site, leaving the `= false` default dead — harmless and justified by the component's generic intent.
- **Backdrop mis-fire on a drag** that starts in the panel and ends on the backdrop dismisses the dialog mid-selection. It fails in the safe direction (cancel, never confirm), so it is noise rather than a defect.
