<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Biblioteka zapisanych kupców — Phase 1

- **Plan**: `context/changes/saved-merchants-library/plan.md`
- **Scope**: Phase 1 of 3 — "Contract and rules" (landed as `0f28225`)
- **Date**: 2026-09-13
- **Verdict**: REJECTED at review — **all 8 findings fixed in triage, 2026-09-13**
- **Findings**: 1 critical, 4 warnings, 3 observations (8 fixed, 0 skipped, 0 accepted as risk)

## Triage outcome (2026-09-13)

All eight findings fixed. Gates after triage: `npm test` **354 passed** (up from 350 — three new
tests plus one widened), `npm run lint` exit 0, `npx astro check` 0 errors 0 warnings,
`npm run build` complete with `dist/client/index.html` present.

Every code fix was **mutation-checked per L-03** — the change was reverted and the suite confirmed
to fail on the intended test:

| Finding | Mutation | Failure observed |
|---|---|---|
| F1 / F2 | remove `case "restored":` | `expected 'm-saved' to be null` |
| F3 | revert `?? null` in the comparator | `expected [ 'm-older', 'm-absent', 'm-newer' ]` — absent sorted to the middle |
| F4 | stub `Intl.Segmenter` away | no throw, cap still 60 (fallback confirmed live) |
| F5 | remove the invisible-character strip | `expected '<ZWSP>' to be null` |

Files changed in triage: `src/lib/merchant-session.ts`, `src/lib/merchant-session.test.ts`,
`src/lib/merchant-library.ts`, `src/lib/merchant-library.test.ts`, and a Phase-1 addendum in
`plan.md`.

## Scope note

Phase 1's files have moved four commits past `0f28225` (`89367e9`, `c511e47`, `e5575a0`, `9aa3ed8`).
Findings below are stated against **HEAD**, because that is what ships. Issues introduced by this
phase and already repaired by `9aa3ed8` are listed under "Closed by earlier triage" and are not
findings.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Automated criteria re-run at HEAD: `npm test` 350 passed / 7 files, `npx astro check` 0 errors
0 warnings, `npm run lint` exit 0, `npm run build` complete with `dist/client/index.html` present.

## Findings

### F1 — A stale `openedSavedId` survives `restored`, so a saved merchant can be overwritten with a different shop

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-session.ts:298-308`
- **Detail**: `nextOpenedSavedId` clears the id on `generated` and `cleared-open` and returns
  `current` for everything else. `restored` falls into the `default` branch — but `restored` is the
  one event in that branch that **replaces the merchant on screen**. The docstring justifies the
  branch as "a correction, a promote, a failed promote, a stand-down — because the GM is still
  looking at the same merchant", which is false for `restored`.

  Reachable without hand-editing storage: tab A opens *Kuźnia u Borysa* (`openedSavedId = "m-kuznia"`);
  tab B presses Generate; tab A's `storage` listener (`MerchantGenerator.tsx:647`) calls
  `adopt(incoming, reopenEvent(read.doc))`; `reopenEvent` (`:166-169`) returns `{ event: "restored" }`
  because the fresh transient id is not in `saved`; the reducer keeps `m-kuznia`. The next correction
  runs `autosaveOpened` (`:888-896`), which builds the patch from the **current on-screen** rows and
  calls `updateSavedMerchant("m-kuznia", patch)`.

  `updateSavedMerchant` refuses to touch `id`, `createdAt` and `name`, so the library row still reads
  *"Kuźnia u Borysa"* while its entire assortment is now a different shop's. No press is required and
  there is no visible cue. The reconciliation at `MerchantGenerator.tsx:341-345` does not catch it —
  it clears only when the record has left `saved`, and `m-kuznia` is still there.

  Verified by probe: `nextSaveSession({ state: "armed", openedSavedId: "m-kuznia" }, { event: "restored" })`
  returns `openedSavedId: "m-kuznia"`.

  This is Phase 1's reducer contract — the plan's Critical Implementation Details assign the reducer
  exactly this job ("Leaving the id set means the next Zapisz overwrites a saved merchant with a
  completely different shop"). The exploit path only became live once `corrections-autosave` added an
  unattended writer.
- **Fix A ⭐ Recommended**: Add `case "restored":` to the clearing branch alongside `generated` and `cleared-open`.
  - Strength: Restores the module's own stated rule — an event that replaces what is on screen is no longer the opened record — and makes the guarantee unreachable from a call site. Matches how `generated` was already handled for the same reason.
  - Tradeoff: A same-record cross-tab restore (both tabs on one open merchant) would drop the open marking and re-arm the button, costing a re-open. `reopenEvent` already re-dispatches `opened` in that case, so the cost is one render.
  - Confidence: HIGH — the reducer is pure, the fix is one case label, and the mutation is directly testable.
  - Blind spot: Have not enumerated whether any UI copy reads `openedSavedId` in a way that would flicker on the same-record path.
- **Fix B**: Keep the reducer as-is and document the invariant that `reopenEvent` never dispatches `restored` while an id is set — then enforce it at the call site.
  - Strength: Preserves current behaviour; no transition-table change to re-verify.
  - Tradeoff: Makes a *component* load-bearing for a *pure exported reducer's* safety — the exact "two call sites diverge" failure this module works hard elsewhere to prevent. The invariant is currently false, so this option requires a call-site fix anyway.
  - Confidence: MEDIUM — depends on every present and future `adopt` caller honouring it.
  - Blind spot: `adopt` has three call sites (mount, cross-tab, open); have not audited whether a fourth is planned.
- **Decision**: FIXED via Fix A — `case "restored":` added to the clearing branch in `nextOpenedSavedId`, with a docstring paragraph naming the cross-tab path and why re-opening the same record cross-tab is unaffected (`reopenEvent` returns `opened`). `npm test` 350 passed — unchanged either way, which is exactly F2.

### F2 — No test pins `restored`'s effect on `openedSavedId` in either direction

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-session.test.ts:428-517`
- **Detail**: Mutation replay against the `nextSaveSession` suite: making `restored` clear the id
  leaves the suite green; making `persistence-off` clear it leaves the suite green. Controls
  (`generated` no longer clearing; `corrected` clearing) are caught, so the suite is not inert — it
  simply does not cover this axis. Three tests look like coverage and are not:
  `"never invents an opened record"` (`:480`) starts from `fresh`, whose id is already `null`, so it
  cannot fail for any implementation returning `current` or `null`; `"moves the state exactly as
  nextSaveState does"` (`:490`) walks all 32 combinations but asserts only `.state`;
  `"answers for every event from every state"` (`:502`) starts from a `null` id. This is lesson L-03
  in its exhaustive-loop disguise.
- **Fix**: Add one loop asserting `.openedSavedId` for every event from `{ state, openedSavedId: "m-saved" }`, with the expected value written out per event — the same write-the-whole-table discipline `nextSaveState` received in `9aa3ed8`.
- **Decision**: FIXED — added `"answers for the opened record on every event, from every state"` (`merchant-session.test.ts:490-524`), a `Record<SaveEvent, string | null>` literal looped over all four states, so a new event is a compile error rather than a silent gap. Mutation-checked per L-03: removing `case "restored":` fails this test with `expected 'm-saved' to be null`. Suite 351 passed, lint clean.

### F3 — `sortForLibrary` is an inconsistent comparator when `savedAt` is absent

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-library.ts:120-131`
- **Detail**: The branch handles `savedAt === null` but not `undefined` — an absent field, the normal
  shape of forward-only or hand-edited data. Every relational comparison against `undefined` is
  `false`, so `a.savedAt < b.savedAt ? 1 : -1` always answers `-1`, making `cmp(U,A)` and `cmp(A,U)`
  both negative. Two consequences contradict the docstring: an absent `savedAt` sorts **first or
  middle, never last** (the docstring promises "sorts last … burying it is better than crashing"),
  and the result depends on input order — the list reshuffles between renders, which is the exact
  glitch the `id` tiebreak was added to prevent, re-entering through the other door.
  `isMerchant` (`merchant.ts:139`) rejects `savedAt: undefined` at the storage boundary today, so this
  is defensive code that does not defend rather than a live break — but `sortForLibrary` is exported,
  takes a bare `readonly Merchant[]`, and the null branch is justified on "a hand-edited document can
  produce one".
- **Fix**: Normalize both sides with `?? null` before comparing, and add a test using a record whose `savedAt` key is absent, asserted from two different input orders.
- **Decision**: FIXED — `const aAt = a.savedAt ?? null` / `bAt` added ahead of the branch in `sortForLibrary`, with a comment naming why the old form was not a valid comparator. Test `"buries a merchant whose savedAt key is absent, whatever order it arrives in"` added, asserting from two input orders. Mutation-checked: reverting the `?? null` fails with `expected [ 'm-older', 'm-absent', 'm-newer' ]` — the inconsistent-comparator symptom exactly. 352 passed, lint clean, 0 type errors.

### F4 — `Intl.Segmenter` is constructed with no guard and no fallback

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/merchant-library.ts:38-48`
- **Detail**: The lazy construction correctly keeps the global off the import path, and the build/SSR
  route never reaches it — `normalizeName` is called only from the rename handler
  (`MerchantLibrary.tsx:185`). The browser is the uncovered case. `Intl.Segmenter` reached Firefox
  only in **125 (April 2024)**; on a Firefox ESR or an older Android WebView the constructor throws
  `TypeError` inside a React event handler and the rename dies silently.

  This is a pattern mismatch with the sibling that faced the same question: `newMerchantId`
  (`merchant.ts:169-190`) degrades `randomUUID` → `getRandomValues` → `Math.random`, with a docstring
  saying an unguarded ambient global would make "the product look wholly broken". The house answer to
  this exact problem is a fallback chain, not a bare call.
- **Fix A ⭐ Recommended**: Guard the construction and fall back to `[...collapsed]` (code points).
  - Strength: Follows the established `newMerchantId` degradation pattern. Code-point truncation can sever a combining mark — worse than graphemes, far better than a thrown rename — and it never produces a lone surrogate, which the module's own docstring names as the unrecoverable corruption.
  - Tradeoff: Two truncation semantics in one function; the cap's meaning becomes browser-dependent.
  - Confidence: HIGH — three lines, and the fallback is strictly the pre-Segmenter behaviour.
  - Blind spot: Have not measured what share of this product's GMs are on a browser without `Intl.Segmenter`.
- **Fix B**: Accept the requirement and state it — document `Intl.Segmenter` as a supported-browser floor.
  - Strength: Keeps one truncation semantic; the baseline is nearly two years old and mainstream.
  - Tradeoff: A GM on an old WebView gets a rename that does nothing, with no message — the silent-failure class the PRD guardrail exists to prevent.
  - Confidence: MEDIUM — depends on a browser-support decision nothing in `context/` currently records.
  - Blind spot: No documented browser baseline exists to hang this on.
- **Decision**: FIXED via Fix A — `graphemeSegmenter()` resolves the constructor once behind a `typeof api?.Segmenter === "function"` guard (the `newMerchantId` idiom) and caches the miss; `toGraphemes` falls back to code points. The fallback trips `@typescript-eslint/no-misused-spread`, whose warning *is* the accepted tradeoff, so it carries a targeted `eslint-disable-next-line` with the reason stated rather than a silent `Array.from` dodge. Probe with `Intl.Segmenter` stubbed out: `normalizeName` does not throw and still caps at 60. 352 passed, lint clean, 0 type errors.

### F5 — Zero-width characters bypass the blank-name guard, persisting a nameless row

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/merchant-library.ts:73`
- **Detail**: The plan's contract is `normalizeName` "returns `null` for an empty result so the caller
  restores the previous name". JS `\s` does not match U+200B (ZWSP) or U+200D (ZWJ), so a name of
  zero-width characters survives the guard. Probed at HEAD: three U+200B characters return a
  3-character string, not `null`; two U+200D characters return a 1-grapheme string. NBSP and U+FEFF
  are handled correctly and return `null`.
  The result reaches storage: `MerchantLibrary.tsx:183-192` commits whenever
  `next !== null && next !== merchant.name`, so `renameMerchant` writes an invisible name and the row
  renders blank across reloads — the failure mode plan step 3.6 ("clearing a name restores the
  previous one") exists to prevent.
- **Fix**: Strip zero-width characters (U+200B–U+200D, U+FEFF) before the blank check, ahead of the existing `\s+` collapse.
- **Decision**: FIXED, narrowed during triage — stripping U+200D unconditionally would mangle a ZWJ emoji sequence inside a legitimate name, so `INVISIBLE_NAME_CHARS` strips only U+200B/U+200C/U+FEFF and `BLANK_NAME` (`/^[\s‍]*$/u`) treats a joiner-only string as blank while leaving joiners intact inside real names. `BLANK_NAME` subsumes the old `collapsed === ""` check rather than adding a second guard. Two tests added: six zero-width-only inputs return `null`, and a name containing 👨‍👩‍👧 survives unchanged. Mutation-checked: removing the strip fails with `expected '<ZWSP>' to be null`. 354 passed, lint clean, 0 type errors.

### F6 — `saveActionFor` is a Phase 3 helper that landed in Phase 1

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/lib/merchant-session.ts` (`saveActionFor`, with `SaveAction`)
- **Detail**: Phase 1's contract names `restoreFromMerchant`, the `openedSavedId` concept, and the two
  new events. `saveActionFor` serves Phase 3's "the button's label states which action it will take"
  (progress step 3.9). It is pure and harmless, but it is scope the phase boundary did not authorise
  and it shipped untested against its Phase 3 purpose. The related restructure (`SaveSession`,
  `SaveSessionEvent`, `nextSaveSession`) is a genuine improvement over the plan's looser wording and
  broke no S-03 call site — `nextSaveState` kept its name and signature, and the widened `SaveEvent`
  union is additive.
- **Fix**: None needed in code — note it in the plan as a Phase-1 addendum so the phase boundaries stay honest for future reviews.
- **Decision**: FIXED — "Addendum (recorded 2026-09-13, impl review of Phase 1)" added to `plan.md` under Phase 1 item 3, recording both departures: the unmodified `merchant-storage.test.ts` (F-01's coverage verified, the plan's "(modify)" was stale) and the reducer restructure including `saveActionFor` / `SaveAction` serving Phase 3 step 3.9. No code change.

### F7 — Dead branch whose comment asserts a reachability that does not exist

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-library.ts:87-89`
- **Detail**: `// Only reachable if the cap lands inside a run of spaces …` then
  `return truncated === "" ? null : truncated;`. `collapsed` is already trimmed, so `characters[0]` is
  never whitespace and the 60-grapheme slice can never `trimEnd()` to `""`. The branch is unreachable
  outright, not "only reachable if" — and it is untested. Harmless, but a wrong reachability claim in
  a comment is the kind of thing a future agent trusts instead of re-deriving.
- **Fix**: Correct the comment to say the branch is unreachable and kept as a total-function guard, or drop the branch.
- **Decision**: FIXED — comment rewritten to state the branch is unreachable (`collapsed` is trimmed, so the first grapheme is never whitespace), that the guard is kept to keep the function total over its return type rather than leaning on that argument surviving a future edit, and that nothing should be written as though it were live. Branch retained.

### F8 — Comparator returns non-zero for equal ids

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-library.ts:129`
- **Detail**: `a.id < b.id ? -1 : 1` answers `1` when `a.id === b.id`, so `cmp(x,y) === cmp(y,x) === 1`.
  Ids are unique in practice and `newMerchantId` guarantees it, so nothing breaks — flagged only
  because the identical shortcut is what produced F3 one branch above.
- **Fix**: Return `0` for equal ids, or leave as-is with a one-line note that uniqueness is the guarantee.
- **Decision**: FIXED — `if (a.id === b.id) return 0;` added ahead of the tiebreak, with a comment noting it is unreachable through the library but that a comparator disagreeing with itself is precisely what F3 was.

## Closed by earlier triage (`9aa3ed8`) — no action

Introduced by this phase, already repaired. Listed so the phase's record is complete.

| Issue | Was | Now |
|---|---|---|
| `saved × promote-failed → saved` — a failed write wearing a green "Zapisano" with no retry | `merchant-session.ts:207` @`0f28225` | cell is `armed` |
| `saved × cleared-open → saved` — button disabled reading "Zapisano" over a deleted record | same row | cell is `armed` |
| Transition test `continue`d past the `saved` row containing its own counterexample (23 of 32 cells asserted; `saved × restored → saved` mutation stayed green) | `merchant-session.test.ts:271-281` @`0f28225` | all 32 cells written out as a typed literal |
| `restoreFromMerchant` guard accepted `rows: [null, 3]`, then threw a `TypeError` one line later inside a mount effect | `merchant-session.ts:94` @`0f28225` | uses `isMerchant`, tested |
| `nextSaveState` returned `undefined` typed as `SaveState` on an out-of-contract value | `merchant-session.ts:215` @`0f28225` | `?? "unavailable"` |
| `formatSavedAt` re-implemented `pad2` and the wall-clock format already exported as `formatWallClock` | `merchant-library.ts:173-199` @`0f28225` | imports `formatWallClock` (`:17`, `:274`) |
| Progress steps 1.1–1.4 stamped `[x]` without the ` — <sha>` suffix the plan's own convention requires | `plan.md` @`0f28225` | `— 0f28225` present |

## Checked and found clean

- **`restoreFromMerchant` extraction** — a genuine move, not a retype; `restoreFromDocument` is a
  one-expression wrapper and the equivalence is asserted (`merchant-session.test.ts:194`).
- **`merchant-storage.test.ts` omitted from the diff** — the commit message's claim that F-01 already
  covered `updateSavedMerchant` is **true**. All four plan-named properties are asserted at
  `merchant-storage.test.ts:218-270`. The plan's "(modify)" was the stale item; skipping it was right.
- **Out-of-scope check** — no UI, no JSX, no React import, no schema change, no new storage operation,
  no jsdom, no Vitest glob widening. `SCHEMA_VERSION` untouched. The "amends no upstream file"
  constraint targets F-01's storage module and S-02's dialog; neither was touched.
- **Plan and roadmap edits inside the implementation commit** were progress-checkbox and status
  stamping only — the Phase 1 contract prose is byte-identical before and after.
- **Grapheme-cap tests are non-vacuous** — the literals genuinely contain multi-unit graphemes
  (U+1F5E1; NFD combining marks), and both a UTF-16 slice and a code-point slice fail the assertions.
- **Stable-sort and no-mutation tests are non-vacuous** — inputs are deliberately unsorted, so an
  in-place sort or a missing `id` tiebreak is detectable.
- **Reducer purity, cap off-by-one, `Intl.Segmenter` memoization, naming, `@/*` import style, and the
  throw-vs-union choice** all conform. `normalizeName`'s `string | null` matches `corrections.ts`'s
  `clampQuantity` / `parseDraft`.
- **`openedSavedId` transition table** — all 8 events checked against "does this replace the merchant
  on screen?". `restored` is the only hole (F1).
- **The "Every page is prerendered" docstring** (`merchant-library.ts:33`) is accurate —
  `src/pages/index.astro:8` carries `export const prerender = true`.
