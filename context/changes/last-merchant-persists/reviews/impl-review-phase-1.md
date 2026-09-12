<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Automatyczne utrwalenie ostatniego kupca i jawny zapis

- **Plan**: `context/changes/last-merchant-persists/plan.md`
- **Scope**: Phase 1 of 3 — Session decision module (commit `5106527`)
- **Date**: 2026-09-12
- **Verdict**: NEEDS ATTENTION → **RESOLVED** (triaged 2026-09-12; 10 fixed, 0 skipped, 0 outstanding)
- **Findings**: 0 critical, 6 warnings, 4 observations

## Post-triage gate run (2026-09-12)

`npm run typecheck` 0 errors · `npm test` **349 passed** (was 346) · `npm run lint` exit 0 ·
`npm run build` complete, `dist/client/index.html` present.

**The transition table is now fully pinned.** The previous suite asserted an exact value for 23 of
32 cells; one `EXPECTED` literal now covers all 32, and the typed `Record` makes a new state or
event a compile error until someone decides what its cells answer. Mutation-verified on four cells
that were previously silent, including `saved × restored` — the module's own named failure mode.

Three cells changed, all away from presenting a failure as a success: `saved × cleared-open` and
`saved × promote-failed` now re-arm, and `nextSaveState` falls back to `unavailable` for input
outside its contract instead of returning `undefined` and throwing on the next call.

**F2 was mine** — this morning's storage fix had disarmed Save for a write-refusing store, the one
condition this slice's asymmetry says must stay armed. Reverted; exactly one `persistence-off`
caller remains, the sanctioned `future-version` one.

**Carried forward:** manual rows 1.5 and 1.6 remain unchecked, though both are readability claims
this review assessed directly and found substantively satisfied.

## Review lens

`merchant-session.ts` has **no uncommitted changes**, so unlike this morning's storage reviews this is an independent audit of the module itself. Three later commits extended it (`0f28225` added `opened`/`cleared-open` and the `SaveSession` pair; `c511e47` and `e5575a0` added `openedSavedIdFor` and `wouldLoseCorrections`) — planned work by other slices, attributed below.

One finding (F2) *is* mine: an uncommitted line from this morning's `merchant-storage-contract` triage that bends this slice's documented rule.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

### What holds

The module delivers its contract. `restoreFromDocument` returns exactly the six named fields or `null`; a stale enum degrades **only the controls** — the merchant is returned by reference and `recentIds` reads the rows without rewriting them — and the tests assert identity (`toBe`) rather than equality, so a copy would fail them. `isKnownCategory`/`isKnownWealth` are genuine type predicates. `recentIds` is seeded with exactly the row ids, and the test pins contents *and* order against a fixture whose ids differ from its names.

**Criterion 1.5 is substantively met.** `SAVE_TRANSITIONS` is a literal `Record<SaveState, Record<SaveEvent, SaveState>>`, one row per line with single-letter aliases so the columns align, `prettier-ignore` to keep it that way. A reviewer genuinely can see `armed × promote-failed → A` at a glance. The typing is well built too: `SaveState` and `SaveEvent` are derived *from* the exported arrays, so the runtime lists and the type unions cannot diverge, and a missing cell is a compile error.

**`promote-failed` stays armed, and it is guarded.** Mutation-verified: flipping that cell to `S` fails three tests — a direct assertion, a structural one, and the pair reducer inheriting it.

A failed *write* correctly never stands persistence down: `quota-exceeded` and `unavailable` route to a notice only, and `armed × promote-failed → A` leaves the button pressable. That is the plan's asymmetry working as designed.

### Automated success criteria — re-run 2026-09-12

| # | Criterion | Result |
|---|---|---|
| 1.1 | `npm test` | PASS — 346 tests |
| 1.2 | `npx astro check` | PASS — 0 errors |
| 1.3 | `npm run build` | PASS |
| 1.4 | `npm run lint` | PASS — exit 0 |

Manual rows 1.5 and 1.6 unchecked. Both are readability claims about this module, and both are substantively satisfied by the code as written — 1.5 by the literal table, 1.6 by the `restoreFromMerchant` comment — though 1.6's *rationale* is now stale (F8).

## Findings

### F1 — A merchant deleted right after saving still reads "Zapisano", and the button is dead

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-session.ts:208`, `src/components/MerchantGenerator.tsx:282-288`
- **Origin**: `5106527` (the cell) meeting `0f28225`/`d42b7d0` (the delete path)
- **Detail**: The per-render reconciliation repairs only half the pair:

  ```ts
  const session: SaveSession = {
    state: storedSession.state,        // never reconciled
    openedSavedId: … saved.some(…) ? … : null,
  };
  ```

  Sequence: press Zapisz → `promoted` then `opened` → `{state: "saved", openedSavedId: "m-x"}`. Delete that merchant from the library. `deleteSavedMerchant` fires **no session event** (verified — it is absent from every `setSession` call site), so `openedSavedId` is nulled by the reconciliation while `state` stays `"saved"`. The button re-renders reading **"Zapisano"**, `disabled` because the state is not `armed`, for a merchant that is no longer in the library and cannot be re-saved. Recovery needs a reload. Same hole for a cross-tab delete.

  `saved × cleared-open → S` is the cell that would otherwise catch it, and nothing fires `cleared-open` on delete anyway.
- **Fix**: Make `saved × cleared-open → armed` — nothing else fires `cleared-open` except `draw()`, where `generated` already yields `armed`, so the change is inert elsewhere — and fire `cleared-open` when the opened id leaves `saved`.
- **Decision**: FIXED — `saved × cleared-open → armed`, and `deleteSavedMerchant` now fires `cleared-open` when the deleted id is the one the button last wrote to. The table's comment was corrected too: the column is no longer the identity, and it now states why `saved` is the exception — `saved` means "the record I wrote to is in the library", so once it is gone the claim is false.

  The test asserting the old identity behaviour was rewritten rather than deleted: it still pins the identity for the other three states and now pins the exception explicitly. **Mutation-verified** — reverting the cell to `S` fails two tests.

### F2 — My storage fix disarms Save for exactly the store this plan says must stay armed

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/components/MerchantGenerator.tsx:388` (uncommitted)
- **Origin**: **this morning's `merchant-storage-contract` Phase 2 triage — mine**
- **Detail**: This module states the rule in its own JSDoc, and the plan states it twice:

  > The asymmetry is deliberate: a **disabled or full** store does not stand persistence down. Those mean *the write will fail*, which is worth letting the GM discover by pressing Save and reading the notice — the condition is recoverable (re-enable site data, free some space) and hiding it behind a dead control hides the remedy with it.

  There were two `persistence-off` call sites. One is `future-version` — sanctioned. The other is the `read-only` read I added this morning, and `read-only` **is** the disabled-store case: Safari private mode, where the store reads fine and refuses writes. It is recoverable (leave private mode), and it now lands in `stood-down`, which is **absorbing** — the button is dead for the rest of the page load.

  So my fix, which existed to stop a write-refusing store hiding the GM's library, also hid the remedy behind a dead control. The line is uncommitted, confirmed by `git diff HEAD`.

  One sub-agent read this call site as `future-version` and declared the asymmetry intact; the other caught it. I verified it myself before reporting.
- **Fix A ⭐ Recommended**: Drop the `persistence-off` dispatch from the `read-only` branch, keeping the `setStorageStatus("unavailable")` notice. The GM sees the banner, the button stays armed, and a press produces the storage failure the plan wants them to read.
  - Strength: Restores the documented rule exactly, and the notice — the part of my fix that mattered — is untouched. The press genuinely fails, so nothing is claimed falsely.
  - Tradeoff: The GM presses a button that cannot succeed. That is the plan's deliberate choice, not an oversight.
  - Confidence: HIGH — the rule is stated in two places and the call site is one line.
  - Blind spot: With F-01's read-only latch also engaged, the write fails at the storage layer too; I have not checked which notice the GM ends up reading first.
- **Fix B**: Keep the stand-down and amend this plan's asymmetry to admit `read-only` as a third stand-down condition.
  - Strength: A latched store genuinely cannot accept the write, so an armed button is arguably the lie.
  - Tradeoff: Contradicts the plan's reasoning on its own terms — Safari private mode is recoverable, and the plan's point is that a dead control hides the remedy.
  - Confidence: MEDIUM — defensible, but it argues against a rule the author wrote down deliberately.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — the `persistence-off` dispatch is gone from the `read-only` branch; the `setStorageStatus("unavailable")` notice stays. Verified: exactly one live `persistence-off` caller remains, the `future-version` one, which is the only condition the asymmetry sanctions.

  The branch now carries a comment stating the rule and pointing at `merchant-session.ts`'s `SaveState` doc, so the next person to touch it sees why the obvious-looking dispatch is deliberately absent. That is what was missing when I added it this morning — I was reading the storage contract, not this one.

### F3 — `nextSaveState` is total over its types but not at runtime

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-session.ts:212-214`
- **Origin**: `5106527`
- **Detail**: `return SAVE_TRANSITIONS[current][event];` — no default, no fallback. An unknown event returns `undefined` *typed as* `SaveState`; the **next** call then does `SAVE_TRANSITIONS[undefined][…]` and throws `TypeError`, inside a `setSession` updater — a render-phase crash that blanks the only page the product has. That is the exact outcome `restoreFromMerchant`'s guard exists to prevent one function up.

  Not reachable today: every call site passes a literal and neither type is persisted. The JSDoc's "Total — every cell is filled" is true of the declared domain only.
- **Fix**: `return SAVE_TRANSITIONS[current]?.[event] ?? "unavailable";` — fails toward the state that offers no press, matching the module's own asymmetry argument.
- **Decision**: FIXED — the lookup falls back to `unavailable`, and the JSDoc now distinguishes "total over the declared types" from "total at runtime", naming the failure direction as deliberate: a state nobody recognises must not offer a press.

  A plain `?.` tripped `no-unnecessary-condition` — correctly, since the declared types say the lookup cannot miss. Rather than suppress the rule I read the table through a widened local, the same move `merchant-storage.ts` makes for `globalThis.localStorage`, with a comment saying the defence is against a caller who broke the contract rather than a hole in it.

  A test exercises both out-of-contract shapes and asserts the result is itself a valid state, so a second call cannot throw. **Mutation-verified** — restoring the bare lookup fails that test and only that test.

### F4 — The test named "reaches saved only by an actual promote" excludes the counterexample

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/lib/merchant-session.test.ts:272-282`
- **Origin**: `5106527`
- **Detail**:

  ```ts
  for (const state of SAVE_STATES) {
    if (state === "saved") continue;
  ```

  That `continue` skips **the entire `saved` row** — eight cells — and the `promoted` guard skips three more: 11 of 32. The one cell that can put "Zapisano" over a write that failed, `saved × promote-failed → S` (F6), is structurally excluded by the guard whose name promises to cover it.

  This is L-04's shape exactly: a gate whose scope is narrower than its label, in the module the plan calls "the whole point."
- **Fix**: Drop both `continue`s and assert the full 4×8 matrix against an expected table literal in one test. Shorter than the five tests it replaces, and it cannot develop a blind spot.
- **Decision**: FIXED — replaced with one `EXPECTED: Record<SaveState, Record<SaveEvent, SaveState>>` literal asserted cell by cell, plus the `reaches saved only` test rewritten to state its exception instead of skipping the row that contains it. The typed literal is what keeps it honest: adding a state or event makes it a compile error until someone decides what the new cells answer — the decision that should not be made by omission.

### F5 — Nine of thirty-two cells have no exact-value assertion

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/lib/merchant-session.test.ts`
- **Origin**: `5106527` plus later cells
- **Detail**: The plan's test contract says `nextSaveState` "covers every event from every state." Every combination is *exercised* by the table-driven test, but that test asserts membership (`toContain`), not value. Nine cells are pinned by nothing: `unavailable × {corrected, promoted, promote-failed}`, `armed × {generated, corrected, restored}`, `saved × {restored, promoted, promote-failed}`.

  **Mutation-verified on the one that matters most:** changing `saved × restored` from `A` to `S` leaves **49/49 passing**. That cell is the module's own named failure mode — a reload presenting "Zapisano" over a merchant that was never promoted. Unreachable in today's island (`restored` fires only from `unavailable` on mount), so the impact is low; the coverage claim is what is wrong.
- **Fix**: Folded into F4 — one expected-table assertion pins all 32.
- **Decision**: FIXED by F4. **Mutation-verified on four previously-unpinned cells**: `saved × restored`, `armed × generated`, `unavailable × promoted` and `saved × promote-failed` each now fail. Before the change, `saved × restored` and `unavailable × promoted` left the suite fully green.

### F6 — `saved × promote-failed → saved` contradicts the doc above it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-session.ts:208`, doc at `:186-189`
- **Origin**: `5106527`
- **Detail**: The table's own comment says:

  > No cell in the `promote-failed` column reaches `S` from a state that was not already `saved`, so a failed save can never present as a save that happened.

  The first clause is true; the second is stronger than it supports. From `saved`, a failed save *does* present as a save that happened — the button keeps reading "Zapisano" after a write that failed. Not reachable in today's island (`handleSave` renders only when nothing is open and is disabled unless `armed`), so this is a latent trap rather than a live bug. It is also the single most important cell F4's test excludes.
- **Fix A ⭐ Recommended**: `saved × promote-failed → armed`. A write that failed is a write the GM should be invited to retry, and it makes the doc's second clause true.
  - Strength: Removes the one cell where a failure presents as a success, in the module whose stated purpose is making exactly that impossible. Consistent with `armed × promote-failed → armed`.
  - Tradeoff: A GM who saved successfully, then hit a failing save, sees the button re-arm — mildly alarming, but accurate.
  - Confidence: HIGH — the cell is unreachable today, so the change cannot regress live behaviour.
  - Blind spot: Haven't traced whether S-04's save-in-place path could reach it once opened records can be re-saved.
- **Fix B**: Keep `S` and pin it with an explicit test plus a comment saying why staleness beats a false re-arm.
  - Strength: Preserves "saved" as a record of what actually happened once; no behaviour change.
  - Tradeoff: Leaves the doc's claim overstated unless reworded too.
  - Confidence: MEDIUM — defensible, but it argues for the harder-to-explain option.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `saved × promote-failed → armed`. The doc's claim is now true without qualification: no cell in the `promote-failed` column reaches `S` from any state. The comment says why the old reading was wrong — the button does not say "saved once", it says "saved", and a write that just failed makes that false however many succeeded before it.

  The `reaches saved only by an actual promote` test no longer needs its `saved`-row exception at all, so the skip is gone entirely. **Mutation-verified** — restoring the cell to `S` fails three tests, including the full-matrix one from F4.

### F7 — The row guard is shallow and can throw on the mount path

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-session.ts:87`, `:103`
- **Origin**: `5106527`
- **Detail**: `!Array.isArray(merchant.rows)` accepts `rows: [null, 3]`, and `merchant.rows.map((row) => row.itemId)` then throws `TypeError` — out of a module whose siblings promise never to throw, on the mount path. Safe today because `readDocument` → `salvage` → `isMerchant` validates elements upstream (as of this morning), but `restoreFromMerchant` is a public export with a second call site.
- **Fix**: Replace the hand-rolled check with `isMerchant` from `merchant.ts` — which that module's JSDoc already names `restoreFromMerchant` as a place that re-derived it. Closes F7 and F8 together.
- **Decision**: FIXED — the guard is now `isMerchant`, giving that function the second production caller its own JSDoc anticipated. A test covers `rows: [null, 3]`, the shape the old check let through; **mutation-verified** — restoring `Array.isArray` fails it.

### F8 — The guard's stated rationale is now factually wrong

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/merchant-session.ts:78-84`
- **Origin**: `5106527`, invalidated by **this morning's** storage triage
- **Detail**: The comment says `readDocument` "validates the *document* … and deliberately does not walk into the merchant. A hand-edited `"transient": {}` therefore reads back as `ok`, and mapping over an absent `rows` would throw inside a mount effect."

  That was true when written. Phase 2's `isMerchant` element validation and Phase 3's `salvage()` changed it: a `"transient": {}` now reads back as `ok` with **`transient: null`** and `dropped: 1`. The guard is now redundant — harmlessly, and I would keep it on the same "don't depend on the boundary" reasoning I used to leave the other re-derived guards in place — but its only stated justification describes behaviour that no longer exists, and a future reader will build on it.
- **Fix**: Reword to say the guard is deliberate redundancy against a boundary that *currently* validates elements, rather than against one that does not.
- **Decision**: FIXED with F7. The rationale now says F-01 *does* validate merchants (via `salvage`), notes in parentheses that it did not when the guard was written, and gives the two reasons the guard stays anyway: the function is exported with a second call site, and a throw here happens inside a mount effect.

### F9 — A comment credits an assertion that cannot fail

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/lib/merchant-session.test.ts:258-260`, repeated at `:409-420`
- **Origin**: `5106527`
- **Detail**:

  > The count is asserted, not just the membership: a table with a hole would push `undefined` and still satisfy a loop that never checks it ran.

  `visited.push(...)` runs unconditionally once per iteration of the same two arrays, so `visited.length` **is** `SAVE_STATES.length * SAVE_EVENTS.length` by construction. The assertion cannot fail under any mutation. The hole it describes is caught by the *next* line, `toContain`.

  Harmless as a test; misleading as a rationale, in a repo that has L-03 and L-04 written down precisely about this.
- **Fix**: Delete the length assertion and its comment, or re-point the comment at `toContain`, which is doing the work.
- **Decision**: FIXED — the `nextSaveState` copy was removed outright by F4's full-matrix rewrite. The `nextSaveSession` copy's comment is re-pointed: it now names `toContain` as the assertion doing the work and says plainly that the length is true by construction and cannot fail, kept only to catch a refactor that stops iterating both lists.

### F10 — The plan still describes a three-state machine, and one JSDoc block is orphaned

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `plan.md` Phase 1 contract; `src/lib/merchant-session.ts:285-318`
- **Origin**: `5106527` (states), `e5575a0` (doc)
- **Detail**: Two bookkeeping items:
  1. The plan specifies `SaveState = "unavailable" | "armed" | "saved"` and `persistence-off → unavailable`. The code shipped **four** states — with `stood-down` as an absorbing latch — **in commit `5106527` itself**, not in a later slice. The commit message argues for it ("Three cannot work…"), so the deviation is conscious and recorded in git; the plan's contract text was never reconciled, and the plan diff in that commit touched only the four automated checkboxes. `stood-down` is the better design — an absorbing state is what stops a later Generate re-arming a button whose press cannot succeed — but the plan now describes code that does not exist.
  2. Two JSDoc blocks stack above `wouldLoseCorrections`; the first documents `openedSavedIdFor`, which `e5575a0` inserted a function in front of. So `wouldLoseCorrections` carries a doc about a different function, and `openedSavedIdFor` — the only undocumented export in the file — carries none. The stranded block holds the load-bearing soundness argument ("sound for exactly as long as promote keeps minting") that a test explicitly cites.
- **Fix**: A dated addendum reconciling the plan with the four-state machine, and move the orphaned block down onto `openedSavedIdFor`.
- **Decision**: FIXED — a dated addendum now sits under the Phase 1 contract explaining why `stood-down` needs a state of its own (it is absorbing; `unavailable × generated → armed` would re-arm a dead button), confirming the asymmetry is unaffected, and recording the two cells this triage moved (F1, F6). The orphaned JSDoc was moved onto `openedSavedIdFor`, so each function now carries its own and the soundness argument a test cites is back with the code it describes.

## Not findings

- **Non-string enum values** — `category: 42`, `wealth: {}` fall back cleanly, both `*WasReset` flags set, nothing throws.
- **`recentIds` bounds** — bounded by `rows.length`; duplicates collapse into a `Set` downstream; junk ids are harmless because recency is a weight, never a filter, so an oversized or garbage list can bias a draw but cannot make one impossible.
- **The table-driven test cannot silently skip a new state or event** — it iterates the exported arrays that the types are derived from, and `Record<SaveState, Record<SaveEvent, SaveState>>` makes a missing cell a compile error. A new cell is exercised automatically; it just is not *checked* beyond membership (F5).
- **AGENTS.md union-vs-throw** — not violated. `| null` for "nothing to restore" is an absence, not a failure, and matches the sibling convention.

## Note on review method

The two sub-agents disagreed about whether the plan's asymmetry still holds: one reported it "correctly restricted to `future-version`", citing a line that is in fact the `read-only` branch; the other identified that branch correctly. I read the call site myself and confirmed the second reading, then confirmed via `git diff HEAD` that the line is mine and uncommitted (F2). Three further claims — the unreconciled `state` in F1, the tautological length assertion in F9, and the unpinned `saved × restored` cell in F5 — I verified directly, the last by mutation with the file's md5 checked before and after.
