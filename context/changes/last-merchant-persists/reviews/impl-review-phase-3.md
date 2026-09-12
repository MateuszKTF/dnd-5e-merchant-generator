<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Automatyczne utrwalenie ostatniego kupca i jawny zapis

- **Plan**: context/changes/last-merchant-persists/plan.md
- **Scope**: Phase 3 of 3 — Explicit save and storage notices
- **Date**: 2026-09-12
- **Verdict**: REJECTED → **RESOLVED** (triaged 2026-09-13; 10 fixed, 0 skipped, 0 outstanding)
- **Findings**: 5 critical, 4 warnings, 1 observation

## Post-triage gate run (2026-09-13)

`npm run typecheck` 0 errors · `npm test` **350 passed** · `npm run lint` exit 0 ·
`npm run build` complete, `dist/client/index.html` present.

Two fixes turned out to need a different shape than the report proposed, and both would have been
wrong as written. F6's two-slot split does not solve the masking half at all — the pair that masks
(`unavailable` from a read-only store and `records-dropped`) are *both* standing, so a split would
still have thrown one away; the state is a set instead. F4's overlay comparison was unnecessary and
would have re-introduced the cry-wolf notice Fix B was rejected for, because the equality guard
above it already proves divergence.

Three findings were one rule stated three ways — F1, F2 and F8 are all "a status that means writes
have stopped reaches a site that says nothing". F1 is the same recoverability boundary got wrong for
the third time in two days.

**Carried forward:** manual rows 3.5–3.14 remain unchecked and must be run against the working
tree, not commit `d278711`. 3.14 (360 px fold) now has one more thing to check, since two notice
lines can be on screen at once — rare, deliberate, and still cheaper than dropping one of them.

Reviewed against the **working tree**, not commit `d278711`: the phase commit has three review
rounds of uncommitted fixes on top of it, and those are what ships.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Automated criteria 3.1–3.4 re-run against the working tree: `npm test` **350 passed**,
`npm run typecheck` **0 errors**, `npm run lint` **exit 0**, `npm run build` complete with
`dist/client/index.html` present. Manual criteria 3.5–3.14 are all still `- [ ]`; nothing is
rubber-stamped, but three of them (3.9, 3.11, 3.13) are exactly the paths the findings below say
would fail if run.

## Findings

### F1 — `unreadable` latches F-01 read-only but does not stand persistence down

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/MerchantGenerator.tsx:369-375
- **Detail**: Every `unreadable` return in `quarantine` either sets `readOnly = true`
  (merchant-storage.ts:377, 381, 397) or is itself guarded by `if (readOnly)` (:360), so
  `unreadable` **always** means the latch is engaged — `StorageNotice`'s own docblock says so
  ("the latch is engaged *by* `future-version`, `needs-migration` or `unreadable`"), and
  `conditionFromFailure`'s `read-only` comment names it. But `handleFailedRead` stands down only
  on the other two. After an `unreadable` mount read the session stays `armed`, Zapisz renders
  **enabled**, and the press runs `persist` → `putTransient` → `loadForWrite` → `read-only` →
  `conditionFromFailure` → `null`: no write, no notice, no state change, button re-arms. The
  standing `unreadable` copy talks only about reading ("Nie udało się odczytać…"), unlike
  `future-version` which states "Nic nie zostanie zapisane". The latch is absorbing for the page
  load — `clearReadOnlyLatch` is tests-only — so this is a dead end from inside this build, which
  is precisely the rule `handleFailedRead`'s own JSDoc states.
- **Fix**: Add `unreadable` to the stand-down condition, and add a "nothing will be written"
  clause to its copy so the banner matches the control.
  - Strength: Applies the rule the function already documents — recoverability from inside this
    build — instead of a list of members. Third instance of this boundary today; the first two
    (Phase 1's F2, Phase 2's F5) were both closed by restating the rule.
  - Tradeoff: A GM who frees space cannot retry until they reload. That is already true — the
    latch refuses the write either way; the only change is that the button stops inviting it.
  - Confidence: HIGH — every `unreadable` path in `quarantine` was traced to a latch set.
  - Blind spot: The copy change needs a Polish read-through; "nothing will be written" has to sit
    alongside "freeing space may make it recoverable" without contradicting it.
- **Decision**: FIXED — `unreadable` now stands persistence down with the other two, and its copy
  says "Nic nie zostanie zapisane do czasu odświeżenia strony: zwolnij miejsce i odśwież". The
  blind spot resolved itself once stated: the remedy was never "free space", it was "free space
  **and reload**", because the latch is absorbing for the page load.

  The JSDoc now also records why membership is not a judgement call — every `unreadable` return in
  `quarantine` either sets the latch or is guarded by it, so the status and the latch are one fact
  stated twice — and why `quarantined` stays on the other side: its copy-aside succeeded, which
  means the store took a write.

### F2 — Cross-tab `read-only` re-read adopts with no notice

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/MerchantGenerator.tsx:489
- **Detail**: `if (read.status !== "ok" && read.status !== "read-only")` routes `read-only` to the
  adopt path. Adopting is right — the document exists and hiding it would lose merchants sitting
  right there — but the mount read raises `setStorageStatus("unavailable")` for the same status
  (:418) and the listener raises nothing. Reachable: the store is writable at mount (`ok`),
  storage is later disabled or fills, another tab writes, this tab re-reads, `probeWritable`
  fails, `readDocument` latches and returns `read-only` (merchant-storage.ts:494-500). This tab
  adopts the new merchant, shows no banner, and from then on **every** write returns `read-only`,
  which `conditionFromFailure` maps to `null`. A tab whose persistence has stopped entirely, with
  nothing on screen saying so. The plan's contract for this handler is "routed through the same
  status handling" as the mount read.
- **Fix**: Set `"unavailable"` on the `read-only` branch of the listener, exactly as the mount
  read does.
- **Decision**: FIXED — the branch now raises the same notice the mount read raises, with a comment
  naming what is specific to this site: it is where the latch can engage for the **first** time
  mid-session, because `probeWritable` runs on every read and the store can fill after mount.

### F3 — `lastTransient` is recorded before the write, so a failed write poisons the cross-tab guard

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/MerchantGenerator.tsx:656
- **Detail**: `persist` assigns `lastTransient.current = JSON.stringify(merchant)` and *then*
  calls `putTransient`. The stated reason — "so the `storage` listener recognises this tab's own
  document if the event ever reaches it" — does not hold: the event never fires in the tab that
  wrote, as the listener's own docblock says (:477). What the ordering costs: after a failed
  write the ref holds bytes that are **not** in storage while the slot still holds the previous
  record. The next `storage` event from an unrelated write in another tab — a rename, precisely
  the case this ref was added to ignore — compares unequal at :534, falls through to
  `setPending(null)` and `adopt(incoming, …)` at :558, and replaces the GM's on-screen merchant
  with the older stored one, destroying the corrections that had just failed to persist.
- **Fix**: Assign the ref only when `putTransient` came back `ok`.
- **Decision**: FIXED — the assignment moved below the write and into an `ok` branch, with the
  failure notice as its `else`. The comment now states the ref's actual claim ("this is what the
  slot holds"), which is the sentence that makes the old ordering obviously wrong, and records
  that nothing is given up by waiting because the event never fires in the writing tab.


### F4 — Two tabs on the same saved record lose a correction with no notice

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/components/MerchantGenerator.tsx:547; src/lib/merchant-session.ts:330
- **Detail**: `wouldLoseCorrections` is `hasCorrections && openedSavedId === null`, so
  `wouldLoseWork` returns `false` whenever a record is open and its writes are landing — on the
  reasoning that "the incoming corrections ARE the saved ones". That holds only when the incoming
  write derives from this tab's. `updateSavedMerchant` (merchant-storage.ts:678) replaces `rows`
  and `corrections` **wholesale** from the writing tab's overlay; it does not merge. Tab A and
  tab B both open merchant X. A corrects a price. B corrects a quantity and writes X with only
  B's overlay. A receives the event, `wouldLoseWork` says nothing was lost, A silently adopts B's
  version — A's correction is gone from the screen *and* from the saved record. The guard at :534
  has already ruled out A's own write echoing back, so reaching :547 means the bytes genuinely
  differ from what A last wrote. This is the PRD guardrail failing in the case the notice exists
  for.
- **Fix A ⭐ Recommended**: Raise `superseded` when the incoming transient carries the *same* id
  as the open record and its corrections differ from the local overlay; keep the current
  suppression only for a genuinely different merchant arriving.
  - Strength: Narrow, and it targets the exact premise that is false — "same record open" was
    being read as "my work is safe", when only "different merchant arriving" implies that.
  - Tradeoff: Announces the loss without preventing it; last writer still wins.
  - Confidence: HIGH — `updateSavedMerchant`'s wholesale replacement is read directly from the
    source, and the notice copy already fits ("Ręczne korekty z tej karty zostały zastąpione").
  - Blind spot: Not exercised by any test — the listener lives in a `.tsx` the Vitest glob cannot
    see, so this is reasoning plus a manual two-tab check (criterion 3.11), not coverage.
- **Fix B**: Narrow `wouldLoseWork`'s stand-down the same way, so the FR-006 confirm gate and the
  cross-tab notice both stop trusting "a record is open".
  - Strength: Fixes both consumers at once and keeps the single-question invariant the helper was
    extracted to guarantee.
  - Tradeoff: Widens the confirm dialog's firing conditions, which is the cry-wolf failure the
    helper was written to remove — a dialog on every Generate over an open record would be worse
    than the bug.
  - Confidence: MEDIUM — the gate's inputs are the same, but its blast radius is every Generate,
    not just a cross-tab event.
  - Blind spot: Haven't traced how often the gate would newly fire in ordinary one-tab use.
- **Decision**: FIXED via Fix A — an `openRecordReplaced` arm now raises `superseded` when the
  incoming transient carries the open record's id and this tab holds hand corrections.

  The overlay comparison the fix option proposed turned out to be **unnecessary and worse**. The
  equality guard above has already established that these bytes differ from the last ones this tab
  wrote successfully, so divergence is proven; comparing two `StoredCorrections` objects by
  `JSON.stringify` would have added key-order sensitivity and produced exactly the cry-wolf notice
  Fix B was rejected for. The condition is four cheap terms and the comment says why no compare is
  needed.

  Fix B stays rejected on the record: widening `wouldLoseWork` would have put a confirm dialog in
  front of every Generate over an open record — the failure the helper was extracted to remove.

### F5 — A record can leave `saved` without re-arming: "Zapisano" over a merchant nothing holds

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/MerchantGenerator.tsx:275-292, :516, :839
- **Detail**: The derivation comment claims nulling `openedSavedId` on every render "makes the
  rule total — it holds for the local delete, the cross-tab delete, and any future path that
  removes a record". It does not: only the *id* is derived, not `state`, which is why the local
  delete needed an extra explicit dispatch at :954-956 whose comment describes this exact
  failure. `cleared-open` is fired at exactly two sites (:955, :1054). Two other paths shrink
  `saved` and fire nothing:
  - **Cross-tab delete** — `setSaved(read.doc.saved)` at :516, after which `deleteMerchant`
    leaves the transient untouched (merchant-storage.ts:703), so
    `incomingBytes === lastTransient.current` and the handler early-returns at :535 before
    reaching `adopt`.
  - **Rename `not-found`** — `setSaved((current) => current.filter(…))` at :839.

  In both, derived `openedSavedId` → `null` while `storedSession.state` stays `"saved"`, so the
  render condition at :1204 (`openedSavedId === null || state === "saved"`) shows the button,
  `disabled={state !== "armed"}` disables it, and the label reads **"Zapisano"** over a merchant
  no library record holds — with no way back short of a correction or a reload. That is the
  failure `merchant-session.ts` exists to make impossible, reached around the outside.
- **Fix**: Derive the re-arm where the id is nulled — when `storedSession.openedSavedId` is no
  longer in `saved`, derive `state` through `nextSaveState(state, "cleared-open")` as well — so
  the rule is total for real and :954-956 can be deleted.
  - Strength: Puts both halves of `SaveSession` under one derivation, which is what the comment
    already claims. Covers the two live paths and any future one.
  - Tradeoff: Moves logic out of an explicit handler into a derived value, which is harder to
    grep for — mitigated by deleting the now-redundant dispatch so there is one site, not two.
  - Confidence: HIGH — `grep` confirms exactly two `cleared-open` dispatches, and `nextSaveState`
    already makes `cleared-open` the identity from every state but `saved`.
  - Blind spot: `nextSaveState` is pure and tested, but the derived-session shape itself has no
    test — it lives in the `.tsx`.
- **Decision**: FIXED — one `openRecordGone` question now answers both halves of `SaveSession`, and
  the explicit dispatch in `deleteSavedMerchant` is deleted. The state is derived through
  `nextSaveState(state, "cleared-open")` rather than a literal, so the transition table stays the
  single authority on what `cleared-open` means from each state and this code does not restate it.

  The comment that made the wrong claim now names the two paths that went around it, which is what
  turned "looks total" into "is total": the local delete was papering over the gap for itself.


### F6 — One notice slot, never cleared, and one condition masks another

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/MerchantGenerator.tsx:273, :418-427
- **Detail**: `storageStatus` is written at eleven sites and cleared at none — there is no
  `setStorageStatus(null)` anywhere. So after `quota-exceeded` the GM follows the message,
  deletes merchants, the next save succeeds, and the banner still reads "Pamięć przeglądarki jest
  pełna — … Usuń zapisanych kupców", contradicting a success they can see. `superseded` and
  `record-gone` describe a past instant and never expire either. Separately, on mount both
  branches run in one commit: `if (read.status === "read-only") setStorageStatus("unavailable");`
  then `if (read.dropped !== undefined) setStorageStatus("records-dropped");` — so a
  write-refusing store that also dropped records shows only `records-dropped`, and the GM is told
  records vanished but not that the store will refuse the re-save that might recover them. That
  undoes merchant-storage.ts:499's deliberate decision to carry `dropped` on the `read-only`
  branch "so the loss is not silent for precisely the GM who cannot re-save to recover from it".
- **Fix**: Clear the recoverable conditions on the write that resolves them, and hold the latched
  / data-loss conditions (`future-version`, `needs-migration`, `records-dropped`, `unreadable`)
  separately from the transient ones so a recoverable notice cannot bury one.
  - Strength: Restores the meaning of "persistent, not a toast" — persistent was meant to survive
    inattention, not to survive the condition itself.
  - Tradeoff: Two slots instead of one, and a rule about which renders first.
  - Confidence: HIGH for the never-cleared half (grep is conclusive); MEDIUM for the split, which
    is a small design decision rather than a mechanical fix.
  - Blind spot: Two stacked banners make the 360 px fold constraint (criterion 3.14) tighter, and
    that has not been measured on a device.
- **Decision**: FIXED — but **not as a two-slot split**, because the split does not solve the
  masking half. The pair that masks — `unavailable` from a read-only store and `records-dropped` —
  are *both* standing, so two slots would still have thrown one away. The state is now a
  **set** (`conditions`), raised through `raise` and thinned by `clearEpisodic`, and
  `StorageNotice` takes a list and renders one line per condition inside one region, filtered
  through a fixed `ORDER` so two facts always read the same way round.

  `isStandingCondition` lives in `StorageNotice` and names the lifetime rule: a standing condition
  is still true after a write lands (`future-version`, `needs-migration`, `unreadable`,
  `quarantined`, `records-dropped`); everything else describes an *attempt* and is cleared by the
  next write that succeeds. `records-dropped` is standing for the sharpest reason — the successful
  write is what makes that loss permanent, so it is the worst possible moment to stop saying it.

  `unavailable` is deliberately episodic despite arriving from a read: a write that lands disproves
  it. When the store is latched no write ever lands, so it stays up anyway — the rule gets the
  right answer in both cases without a special case.

  Cleared at four success sites: `persist` (the choke point for its four callers), `autosaveOpened`,
  `handleRename`, `deleteSavedMerchant` — the last of which matters most, since deleting is the
  remedy `quota-exceeded` recommends.

### F7 — The live region is mounted with its message already inside it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/StorageNotice.tsx:96-104
- **Detail**: `if (condition === null) return null;` means the `role="status"` element and its
  text enter the accessibility tree in the same commit — the classic case screen readers do not
  announce, because a polite live region has to be observed before its content changes. Every one
  of these nine messages is the only signal the GM gets about lost or unwritable data. The
  sibling does it correctly: `MerchantTable.tsx:45` keeps its `aria-live="polite"` paragraph
  permanently mounted and swaps only the text. Nothing would catch this — per L-04, the
  `astro/jsx-a11y/*` rules cover `.astro` files only.
- **Fix**: Always render the container and gate only the text inside it.
- **Decision**: FIXED — the `role="status"` wrapper is now unconditional and paints nothing when
  empty; the amber panel and its margin moved inside. The comment names the rule (a polite region
  must be observed before its content changes) and cites L-04 for why nothing would ever have
  caught it.


### F8 — `autosaveOpened`'s `not-found` is silent, and `record-gone` is its message

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/MerchantGenerator.tsx:793-806
- **Detail**: A `not-found` from `updateSavedMerchant` means another tab deleted the record the GM
  has open. The handler sets `autosaveFailed = true` and raises nothing — its own comment concedes
  "`read-only` and `not-found` map to no notice at all, which makes this the only signal the GM
  gets before their work is replaced". This is the identical situation fixed for rename in the
  previous review (:838-841), where `not-found` raises `record-gone` because the row would
  otherwise "snap back… reading as a rename that failed for no reason". Here the correction stays
  on screen, never reaches the library, and the row for it has vanished — with no text anywhere.
  The `record-gone` copy fits exactly.
- **Fix**: Raise `record-gone` and drop the record from the list, as `handleRename` does, while
  keeping `setAutosaveFailed(true)`.
- **Decision**: FIXED — `not-found` now drops the row and raises `record-gone`; the other statuses
  keep the generic mapping, and `setAutosaveFailed(true)` still runs for all of them.

  It composes with F5 in a way worth recording: dropping the row makes the derived session re-arm
  the save button, so the correction the GM just made can be kept as a new record instead of being
  stranded on screen with nowhere to go. The stale half of the old comment — "`read-only` and
  `not-found` map to no notice at all" — now says `read-only` only, which is still true and is the
  one status where this flag remains the sole defence.


### F9 — Save button uses shadcn tokens, and "Zapisano" only ever renders disabled

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/MerchantGenerator.tsx:1205
- **Detail**: `variant="secondary"` resolves to `bg-secondary text-secondary-foreground`;
  `--secondary` is `oklch(0.97 0 0)` (global.css:16), roughly 1.05:1 against the white body, and
  the variant carries no border — so the control has no visible boundary. AGENTS.md's colour rule
  forbids reaching for those tokens, and `ConfirmDialog.tsx:135` already patches the same
  fall-through with a comment naming the 3:1 floor. It compounds: `state === "saved"` is never
  `"armed"`, so the sole visual confirmation of a successful save renders at
  `disabled:opacity-50` on an invisible surface, on a control that is also out of the tab order.
  This is the one action a GM takes deliberately to protect their work.
- **Fix**: Give it `bg-white border border-neutral-500 text-neutral-900` like the Cancel button,
  and once F7 lands, put the "Zapisano" confirmation in the status region as well.
- **Decision**: FIXED — literal `neutral-*` classes on the button, and the announcement given its
  own permanently-mounted `role="status"` line ("Kupiec zapisany w bibliotece.") rather than being
  folded into `StorageNotice`.

  Keeping it out of `StorageNotice` was deliberate: that component's whole contract is "a storage
  problem occurred", and putting a success message through it would make `StorageCondition` mean
  two different things. The line is `sr-only` — the visible confirmation is still the button's
  label, which is fine to *see*; what was missing was anything to *hear*, because a disabled
  control changing its text announces nothing and cannot be focused to read.


### F10 — Four small gaps against the file's own established patterns

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/MerchantGenerator.tsx:917-927, :1011; src/components/StorageNotice.tsx:93, :102
- **Detail**:
  - `handleConfirm`'s `switch (confirmed.kind)` has no `default: const unhandled: never` assert,
    although the mount switch at :454-463 carries one with a comment explaining it was added
    because a `void` callback makes a missing case invisible to the compiler. `handleConfirm`
    returns `void` too, so a fourth `PendingAction` kind would close the guardrail dialog with no
    action taken.
  - `MESSAGES[condition]` (StorageNotice.tsx:102) has no fallback, so a condition escaping the
    union renders an **empty amber banner** — an alarm with no content, strictly worse than a
    generic message. `nextSaveState`'s `?? "unavailable"` (merchant-session.ts:246) is the house
    answer, with a comment explaining the defence is against a caller who broke the contract.
  - `openMerchant` (:1011) passes raw `merchant.corrections` into `persist` while `adopt` two
    lines up uses `fromStoredCorrections`. Equivalent today, but it is the one call site that
    skips the defensive copy.
  - StorageNotice.tsx:93 says "generating and editing keep working in all six"; the union has
    nine members.
- **Fix**: Four small edits — add the `never` assert, add the `??` fallback, route through
  `fromStoredCorrections`, drop the stale count.
- **Decision**: FIXED — all four.

  The `??` fallback needed the house idiom in full, not just the operator: with `MESSAGES` typed
  `Record<StorageCondition, string>` the compiler proves the lookup total, so
  `@typescript-eslint/no-unnecessary-condition` rejected the guard as dead code. Widening through a
  `Record<string, string | undefined>` view first — exactly what `nextSaveState` does with
  `SAVE_TRANSITIONS` — is what makes the defence expressible. Caught by `npm run lint`, not by
  `npm run typecheck`.

