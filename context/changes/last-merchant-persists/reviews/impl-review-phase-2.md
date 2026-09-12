<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Automatyczne utrwalenie ostatniego kupca i jawny zapis

- **Plan**: `context/changes/last-merchant-persists/plan.md`
- **Scope**: Phase 2 of 3 — Restore and auto-persist (commit `23bcabb`)
- **Date**: 2026-09-12
- **Verdict**: REJECTED → **RESOLVED** (triaged 2026-09-12; 10 fixed, 0 skipped, 0 outstanding)
- **Findings**: 1 critical, 5 warnings, 4 observations

## Post-triage gate run (2026-09-12)

`npm run typecheck` 0 errors · `npm test` **350 passed** · `npm run lint` exit 0 · `npm run build`
complete, `dist/client/index.html` present.

**Three of the ten were mine**, and the critical one was an incomplete fix from this morning: I
added `salvage()` and the `dropped` count and never wired the consumer, so the next Generate would
have erased the records permanently. Fixing it surfaced a second instance the typecheck caught —
`read-only` also salvages and also dropped the count.

Two fixes needed a better answer than the one the report proposed. F3's obvious version (compare
merchant ids) would have silently dropped a real cross-tab correction, so it compares the transient
by value against a ref. F7's obvious version (keep the button mounted) would have made it pressable
with a record open and appended a duplicate, so it gates on `saved` rather than on `openedSavedId`.

**Carried forward:** manual rows 2.6–2.12 remain unchecked, and 2.11 has been reworded — it could
not have passed as written. The `merchant-writes.ts` extraction is recorded in the plan as
follow-up rather than attempted today.

## Review lens

`MerchantGenerator.tsx` has moved a long way since `23bcabb`: six later commits, plus **+144/−42 uncommitted lines from today's review triages** — which touched the mount effect directly. Every finding is attributed: `23bcabb`, a later commit, or **today's triage (mine)**.

**Three findings are mine, and the critical one is an incomplete fix I made this morning.**

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

### What holds — and it is the important part

**Everything the plan shouted about survived six commits of drift and today's edits.**

- **The mount effect is read-only.** Traced through `adopt`, `reopenEvent`, `restoreFromDocument`, `handleFailedRead` — no `putTransient`, no `persist`, no `writeDocument`, no direct `setItem`.
- **It is safe to run twice.** `adopt` is nine unconditional setters derived from its argument; `setSaved` replaces rather than merges; the dispatch is idempotent in both its `restored` and `opened` variants (both land on `armed`, and `nextOpenedSavedId` returns the same id twice).
- **The write is on the confirmed-draw path, not the button.** A gated press returns before `draw()` and writes nothing; a confirmed press writes exactly once. This was the plan's loudest warning and it is intact.
- **No effect persists in response to a state change.** All three effects checked. The `pagehide` handler reaches storage transitively, but via a lifecycle event with `[]` deps — not the hazard the rule names (an effect watching `rows` that turns every page load into a write).
- **`saveState` is driven exclusively by the reducer.** `setSaveState` no longer exists; all nine `setSession` calls go through `nextSaveSession` → `nextSaveState`. Zero direct assignment.

`putTransient` now has four call sites rather than the planned two, but sites three and four are **new GM actions** (open a saved merchant; relink after a promote) that did not exist when the plan was written. The invariant being protected — writes are imperative and attached to actions — holds.

### Automated success criteria — re-run 2026-09-12

| # | Criterion | Result |
|---|---|---|
| 2.1 | `npm test` | PASS — 349 tests |
| 2.2 | `npx astro check` | PASS — 0 errors |
| 2.3 | `npm run build` | PASS |
| 2.4 | Route still prerendered | PASS — `dist/client/index.html` regenerated |
| 2.5 | `npm run lint` | PASS — exit 0 |

All seven manual rows (2.6–2.12) unchecked — and for this phase that matters more than elsewhere: **the island is covered by exactly zero automated tests and always will be under this config.** The 349 passing tests are evidence about the *contracts* Phase 2 consumes, not about the *wiring* that is Phase 2's entire deliverable.

## Findings

### F1 — Salvaged records are dropped silently, then permanently deleted by the next Generate

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:403`, `:478`
- **Origin**: **today's triage — my incomplete fix**
- **Detail**: This morning's `merchant-storage-contract` Phase 3 triage added `salvage()` and widened `ok` to `{ status: "ok"; doc; dropped?: number }`. The storage module's JSDoc states the contract:

  > Dropping is not silent: the count comes back so the read can say how many records this build could not read.

  **`dropped` is read nowhere.** Verified: `grep -rn "dropped" src/ --include=*.tsx` returns nothing, and `StorageCondition` has no member for it. Both read sites just call `setSaved(read.doc.saved)`.

  The consequence is worse than a missing banner. Every write goes `persist` → `putTransient` → `loadForWrite` → `readDocument` → `salvage`, and then `save({ ...loaded.doc, transient: merchant })` writes the **salvaged** document back. So the very next Generate — Phase 2's own write, the one this phase exists to make automatic — **permanently erases the dropped records**. No notice at any point.

  That is the slice's headline guardrail, *"zapisany kupiec nigdy nie znika po cichu"*, failing by construction, in the phase whose write triggers it. I wrote the mechanism and the promise this morning and left the promise unkept.

  **No criterion in any phase would catch it.** 3.10 covers *quarantine*, not *salvage*.
- **Fix A ⭐ Recommended**: Add a `"records-dropped"` `StorageCondition` naming the count, and set it at both read sites when `read.dropped` is present.
  - Strength: One line per site plus a message; makes the storage module's stated contract true at its only consumer. The enum and the notice component already have room, and the pattern is identical to the five conditions already handled.
  - Tradeoff: The GM is told records were unreadable but cannot recover them from the UI — the bytes are gone from `saved` already, though the pre-salvage document is not yet overwritten until the next write.
  - Confidence: HIGH — I traced the erasure path end to end and confirmed no consumer exists.
  - Blind spot: Haven't decided whether the notice should also *prevent* the next write until acknowledged, which would be the stronger guarantee.
- **Fix B**: Have `salvage` leave the document alone and report, so nothing is dropped from `saved` until the GM has been told.
  - Strength: Nothing is lost even if the notice is missed; the read stays non-destructive in fact as well as in name.
  - Tradeoff: Reopens the defect `salvage` was written to close — `listSaved` hands junk out typed as `Merchant[]` and `renameMerchant` throws.
  - Confidence: MEDIUM — it trades a silent-loss bug for a throw-in-render bug unless the consumers are hardened first.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — a `"records-dropped"` `StorageCondition` with Polish copy that says both halves of the truth: the rest of the library is safe, *and* the next save will persist the list without the missing records. Set at both read sites.

  **The typecheck found a second instance of the same bug while I was fixing the first.** `read-only` also carries a document and also goes through `salvage`, but its return dropped the count — so the loss would have stayed silent for precisely the GM who cannot re-save to recover from it. Fixed at the source: `ReadResult["read-only"]` now carries `dropped` and `readDocument` passes it through.

  A storage test covers that branch (seeded document, one damaged record, write-refusing fake) and is **mutation-verified** — reverting the pass-through fails it and only it. 350 tests pass.

### F2 — A failed persist followed by Save promotes the *previous* merchant

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:562`, `:649`
- **Origin**: `23bcabb` meeting `d278711`
- **Detail**: `persist` swallows its result — it declares no return type and its failure branch sets a notice and nothing else. Meanwhile `promoteTransient()` takes **no argument**: it promotes whatever is in the transient slot, and the component has no way to assert the slot holds what is on screen.

  The reachable path is the one the product's own remedy copy sends the GM down: store nearly full → `draw()`'s `persist` fails with `quota-exceeded` → the notice says *"Usuń zapisanych kupców, żeby zwolnić miejsce"* → the GM deletes one → presses Zapisz. There is room now, so `promoteTransient` **succeeds** — promoting the merchant still in the slot, which is the *previous* one. `addMerchant` then moves the header onto that stale record while the screen shows the un-persisted rows. The library gains a merchant the GM never saw, reported as success.

  Adjacent, same root: if the failed draw was the first, the slot is `null`, `promoteTransient` returns `not-found`, `conditionFromFailure` maps it to `null`, and `promote-failed` leaves the button armed — so Zapisz does nothing, forever, with no message.
- **Fix**: Make `persist` return `WriteResult["status"]` and have `handleSave` re-persist and abort on failure before promoting — or change the storage signature to `promoteTransient(merchant)` so the record promoted is the one the caller is looking at.
- **Decision**: FIXED via Fix A. `persist` now returns `WriteFailure | "ok"` — reusing the module's existing local type rather than importing another — including `"read-only"` for the stand-down early return. `addMerchant` re-persists before promoting and aborts on failure, so a successful promote provably copies what is on screen.

  Both JSDoc blocks say why: `promoteTransient` takes no argument, so without this a promote can append a merchant the GM is not looking at — and the path there is the one the product's own remedy copy recommends. On the happy path the re-persist rewrites bytes already present, which is the cheap half of the trade.

  This also closes the adjacent case: a first-ever draw whose persist failed now returns its real failure from `addMerchant` instead of reaching `promoteTransient` and coming back `not-found`, which `conditionFromFailure` maps to no notice at all.

### F3 — A cross-tab write closes the GM's open dialog under their thumb

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:496`, `:503`
- **Origin**: **partly today's triage — the `setPending(null)` is mine**
- **Detail**: The `storage` listener filters on `event.key !== STORAGE_KEY`, but the whole document lives under one key. So a cross-tab **rename** or **delete of an unrelated merchant** — which never touches the transient slot — still reaches `setPending(null)` and `adopt(incoming, …)`.

  Concretely: the GM has *"Usunąć kupca? „Kowal…" zniknie z listy"* open in tab A; tab B renames a different merchant; **tab A's dialog closes under the GM's thumb** and the next tap lands on whatever is beneath it.

  My comment justifying the clear says the pending action's record *"may have* just been deleted or rewritten elsewhere" — and then clears unconditionally. "May have" is the tell. On the same path, `adopt` resets `autosaveFailed` to `false`, standing the FR-006 guard back down while an unsaved correction is still only in React state.
- **Fix**: Clear `pending` only when the pending action's merchant actually changed or is gone (`read.doc.saved.find(m => m.id === pending.merchant.id)`), and skip the `adopt` when the incoming transient is identical to what is on screen.
- **Decision**: FIXED — one guard now covers all three consequences. The listener compares the incoming transient against a `lastTransient` ref and returns early when it has not moved, so an unrelated rename or delete no longer clears `pending`, re-adopts, resets `autosaveFailed`, or raises a notice.

  **Compared by value, not by id** — and that distinction matters. My first version checked `incoming.merchant.id === header.id`, which would have silently dropped a *real* update: the other tab correcting the same open record. That trades this bug for a worse one. The ref holds the serialized transient and is kept current in the two places this tab changes it, `persist` and `adopt`.

  A ref rather than state, because nothing renders from it and the listener must read it without gaining a dependency that re-subscribes — `adopt`'s `[]` deps stay honest.

### F4 — The "superseded" notice cries wolf on unrelated cross-tab writes

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:491-493`
- **Origin**: `d278711`, predicate changed by `e5575a0` and by today's triage
- **Detail**: Same root as F3 on the notice side. `wouldLoseWork` is asked on every cross-tab document write, so *"Inna karta zapisała innego kupca i to on jest teraz na ekranie"* fires for a write that superseded nothing — a rename, a delete elsewhere.

  This is precisely the cry-wolf failure `wouldLoseWork`'s own docblock was extracted to prevent, reappearing one call site over. Fixed for the FR-006 gate this morning; not for this notice.
- **Fix**: Gate the notice on the incoming transient actually differing from what is on screen.
- **Decision**: FIXED by F3's guard — the early return sits above the `wouldLoseWork` call, so `superseded` can only fire once the transient has genuinely moved. The notice and the dialog-clear now share one discriminator, which is what stops them drifting apart again.

### F5 — `needs-migration` latches storage read-only but leaves Save live and inert

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:349`
- **Origin**: **today's triage — my asymmetry**
- **Detail**: `needs-migration` latches `readOnly` in storage identically to `future-version`, but `handleFailedRead` fires `persistence-off` **only** for `future-version`. So on an older document the session stays `armed`, Zapisz renders enabled, a press returns `read-only`, and `conditionFromFailure` maps that to `null` — no new notice.

  The standing `needs-migration` banner already says nothing will be saved, so the GM is not lied to, but the button is live and inert. Note this is the *opposite* asymmetry to the one I fixed an hour ago: there I removed a stand-down that should not have been there; here one is missing that arguably should be. The distinguishing rule is the plan's own — stand down only when the condition is **not recoverable from inside this build**, which `needs-migration` is not.
- **Fix**: Extend the `persistence-off` dispatch to `needs-migration`, which puts it alongside `future-version` where the recoverability rule says it belongs.
- **Decision**: FIXED — `needs-migration` now stands persistence down alongside `future-version`. The JSDoc states the rule that separates the two groups rather than listing members: **recoverability from inside this build**. A newer-format document and one older than any migration this build carries are both dead ends here; a disabled or full store is not.

  It also names the cost of getting the boundary wrong in either direction, because I got it wrong both ways in one day — standing down too eagerly hides a remedy behind a dead control (Phase 1's F2, mine), and not standing down leaves a live button whose press can only fail silently (this one, also mine).

### F6 — Criterion 2.11 is false as written, twice over

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/last-merchant-persists/plan.md` — manual row 2.11
- **Origin**: `23bcabb` (always true), compounded by `c511e47`
- **Detail**: 2.11 reads *"one write per generate, one per correction, none on page load"*. Both halves are wrong:
  1. **"None on page load"** was never true. `readDocument` probes writability with a real `setItem`/`removeItem` pair, so devtools shows a write on every load. The plan never mentions the probe — `grep -i probe` over it returns nothing.
  2. **"One per committed correction"** stopped being true when `corrections-autosave` landed: a correction to an *open* record writes twice, `persist` then `autosaveOpened`. Deliberate and documented in the code ("Transient first, deliberately"), but it contradicts the criterion.

  A criterion that always fails for reasons unrelated to any regression is worse than no criterion — it gets ignored, and then it catches nothing when something does break.
- **Fix**: Reword to "no write to `STORAGE_KEY` on page load" and "one write per generate; one or two per correction depending on whether a saved record is open", and name the probe in the contract.
- **Decision**: FIXED — 2.11 reworded in place with a pointer to the new Phase 2 addendum, which records both reasons it was false: the writability probe (never mentioned in the plan) and the deliberate double write when a saved record is open.

### F7 — "Zapisano" is unreachable

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:154`, `:673`, `:1091`
- **Origin**: `c511e47` / `32e1317`
- **Detail**: The save button renders only when `session.openedSavedId === null`. But `addMerchant` fires `{event: "opened", savedId: promoted.id}` and `handleSave` then fires `{event: "promoted"}` in the same commit — so the button **unmounts on the exact commit that would have shown the confirmation**. The `"Zapisano"` label is dead code.

  The only remaining feedback for a successful save is a new row inside a library panel that defaults to collapsed. For the one action the GM takes deliberately to protect their work, that is thin.
- **Fix**: Either render the button in a confirmed state briefly before it unmounts, or give the save a notice of its own.
- **Decision**: FIXED — the render condition gained an `|| session.state === "saved"` arm, so the button survives exactly long enough to show "Zapisano" and disappears again on the next correction.

  The obvious version of this fix has a trap I avoided: simply keeping the button mounted while a record is open would make it *pressable* once a correction re-armed the state, and that press appends a near-identical copy — the duplicate this slice exists to prevent. Gating on `saved` rather than on `openedSavedId` keeps it unpressable by construction, since `saved` is not `armed`.

### F8 — Two rename failures snap back silently

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx:734-746`
- **Origin**: `5a2eb03`
- **Detail**: `handleRename`'s docblock claims a failed write "says why". It does not for two of four outcomes: `conditionFromFailure` maps both `not-found` and `read-only` to `null`, so the row silently reverts to the old name. `not-found` is reachable — the storage listener skips `setSaved` on `empty` and on every non-`ok` status, so this tab's cache can name a record another tab deleted.
- **Fix**: Give rename's `not-found` its own condition, or refresh `saved` from a re-read before snapping back.
- **Decision**: FIXED — a `"record-gone"` condition, and `handleRename` now drops the record from the local list and raises it rather than letting the row revert in silence.

  `read-only` was deliberately left mapping to no notice: unlike `not-found`, it really is a consequence of a condition already on screen. `StorageNotice`'s docblock was corrected to say exactly that, since it previously claimed both were absent for the same reason — which stopped being true the moment rename got its own.

### F9 — `MerchantLibrary` missed the contrast and tap-target passes

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/MerchantLibrary.tsx:63`, `:93`, `:240`
- **Origin**: `32e1317` / `5a2eb03`
- **Detail**: Today's triage lifted `MerchantGenerator`'s selects to the `neutral-500` contrast floor and `PriceQuantityCell`'s focus ring. `MerchantLibrary` was not touched and still has:
  - the collapse bar and the search field at `border-neutral-300` — both interactive controls, below AGENTS.md's 3:1 floor;
  - the rename input at `px-1 py-1` (~28px) where every sibling control is `h-11`, carrying the **same** `focus:border-neutral-400` + `outline-none` combination I replaced in `PriceQuantityCell` this morning.

  The rename input is the worst of the three: its `onFocus` selects the whole name and blur commits irreversibly with no confirmation, so a mis-tap plus one keystroke renames a saved merchant.
- **Fix**: Apply the same two changes already made in the sibling components.
- **Decision**: FIXED — both control borders raised to `neutral-500`, and the rename input given `min-h-11` plus the same `focus-visible` outline `PriceQuantityCell` got this morning. Its comment records why this control deserved it most: focus selects the whole name and blur commits irreversibly, so it was the smallest target on the control that forgives least.

### F10 — Plan §3 never reconciled, and the untestable seam is now load-bearing

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `plan.md` Phase 2 §3; `src/components/MerchantGenerator.tsx:562-775`
- **Origin**: `0f28225`/`32e1317` (the refactor), today's triage (the omission)
- **Detail**: Two related items:
  1. Phase 2 §3 still says *"Add `saveState: SaveState` to island state, driven exclusively by `nextSaveState`"*. The shipped shape is `storedSession: SaveSession` driven by `nextSaveSession`, plus a derived `session` reconciled per render. **Phase 1's contract got exactly this addendum today and Phase 2's did not** — the same omission, fixed in one place and missed in its sibling.
  2. The **write-and-session policy** — `persist`, `handleSave`, `addMerchant`, `autosaveOpened`, `handleRename`, `deleteSavedMerchant`, `conditionFromFailure`, and the `storedSession`/`saved`/`storageStatus`/`autosaveFailed` quartet — is ~300 lines with no JSX. **F1, F2, F3, F5 and F8 all live in it**, and it is untested only because it is trapped in a `.tsx` the Vitest glob cannot see. Lifted to `src/lib/merchant-writes.ts` as a reducer (state + event in, `{state, writes[]}` out), all five would fall inside the existing gate with no jsdom.

  That is not a size complaint — the rest of the component is fine where it is. It is that the one region with five findings is the one region no test can reach.
- **Fix**: Add the Phase 2 §3 addendum now; record the extraction as follow-up work rather than doing it a day before the deadline.
- **Decision**: FIXED as scoped — a four-point addendum now closes Phase 2 §3, covering the `SaveSession` refactor, the four `putTransient` call sites, the 2.11 rewording, and the extraction candidate. The extraction itself is **recorded, not done**: it is a ~300-line move the day before the deadline, and the five findings that live there are now fixed, so the argument for doing it under time pressure is weaker than the argument against.

## Not findings

- **State batching** — clean. Every setter is in a handler or effect so React 19 batches; `adopt` lands its setters in one commit; `handleCorrect` passes *values* to both writes rather than re-reading state; the blur-then-click sequence means `handleGenerate` sees a just-committed correction.
- **Hydration** — clean. No browser API is read during render. (`ConfirmDialog`'s `useLayoutEffect` is SSR-visible, but the build is clean and the dialog is closed on first paint.)
- **The confirmation gate** — all three destructive actions are gated; no unconfirmed path mutates or replaces, with the documented exception that an *uncorrected* draw is replaced by design.
- **The `pagehide` effect** — reaches storage transitively but via a lifecycle event with `[]` deps, not the state-watching hazard the rule names. Compliant. Worth knowing it is the one place a failed write's notice can never render.
- **The exhaustiveness guard** — verified by mutation in an isolated probe, not by reading it: removing a case produces `TS2322` naming the missing member.

## Note on review method

Both sub-agents reached F1 independently, by different routes, and I verified the erasure chain myself (`grep` for the consumer, then the `loadForWrite` → `save` path). F3's `setPending(null)` and F5's asymmetry I confirmed as mine via `git diff HEAD`. The exhaustiveness guard was checked by mutation in a scratch file rather than in the working tree, which carries uncommitted work.
