<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Kontrakt encji kupca i trwałości w magazynie przeglądarki

- **Plan**: `context/changes/merchant-storage-contract/plan.md`
- **Scope**: Phase 3 of 3 — Failure modes (commit `96f97dd`, plus today's uncommitted triage)
- **Date**: 2026-09-12
- **Verdict**: REJECTED → **RESOLVED** (triaged 2026-09-12; 10 fixed, 0 skipped, 0 outstanding)
- **Findings**: 3 critical, 5 warnings, 2 observations

## Post-triage gate run (2026-09-12)

`npm run typecheck` 0 errors · `npm test` **346 passed** (was 339) · `npm run lint` exit 0 ·
`npm run build` complete, `dist/client/index.html` present.

**Every finding fixed, and the two regressions I introduced this morning are reversed.** F1's
scenario now reads `ok` with the healthy merchant intact instead of quarantining and emptying the
main key. F3's missing case is handled, and the switch carries the codebase's first exhaustiveness
guard — mutation-verified to name the missing member.

The latch is now genuinely guarded: mutating each of the five `readOnly = true` sites fails a test,
where three of five previously failed none. The two legacy quota names the plan required are
load-bearing for the first time. Criterion 3.9 is satisfied again and enforced by the compiler.

**Corrections to the record:** the Phase 2 report carries a dated correction to its false
"mutation-verified" claim (F6), and `plan.md` carries a four-point addendum for the deviations this
triage and the last one introduced (F10).

**Carried forward:** manual rows 3.5–3.8 remain unchecked, and several now describe changed
behaviour — 3.5 in particular, since a write-refusing store with a document now reads `read-only`
rather than `unavailable`.

## Review lens — this is partly self-review

Phase 3 **is** the failure-modes phase, and this morning's Phase 2 triage changed exactly that code (+167/−26 in `merchant-storage.ts`). Reviewing it now means reviewing my own edits from a few hours ago. Every finding below is labelled with its origin — `96f97dd` (as shipped) or **today's triage** (mine) — so it is clear which parts are independent review and which are not.

**Two of the three criticals are regressions I introduced.** That is the main result of this review, and it is the argument for having run it.

`storage-fake.test-helper.ts` is unchanged since `96f97dd`.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | FAIL |

### What holds

The Phase 3 contract as shipped is sound. The probe is a genuine `setItem`/`removeItem` write rather than feature detection — mutation-confirmed load-bearing, and its cleanup is pinned by two tests. The quota-name set includes WebKit's and Firefox's legacy spellings as the plan required. `resetReadOnlyLatch` is exported, called from `beforeEach`, and has no caller in app code.

**The "destructive step is conditional on the preserving step" invariant holds on all three quarantine paths** — copy throws (nothing written), copy succeeds and reset fails (main key still corrupt, non-destructive), already latched (nothing written). Moving the wipe before the copy fails two tests. That was the plan's central safety claim for this phase and it is real.

All six exported writers are gated by the latch through `loadForWrite` → `save` → `writeDocument`.

### Automated success criteria — re-run 2026-09-12

| # | Criterion | Result |
|---|---|---|
| 3.1 | `npm test` | PASS — 339 tests |
| 3.2 | `npx astro check` | PASS — 0 errors |
| 3.3 | `npm run build` | PASS |
| 3.4 | `npm run lint` | PASS — exit 0 |

**Criterion 3.9 now FAILS** — see F3. Manual rows 3.5–3.8 remain unchecked, and 3.5 now contradicts the code (F6).

## Findings

### F1 — One malformed record destroys the entire library

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-storage.ts:267,272` → `:383-385` → `:311`
- **Origin**: **today's triage — a regression I introduced**
- **Detail**: Phase 2's triage tightened `isStorageDocument` to validate every element:

  ```ts
  candidate.saved.every(isMerchant) &&
  (candidate.transient === null || isMerchant(candidate.transient))
  ```

  The check was right. **The response to failure was not changed to match it.** A failed validation still runs `quarantine`, and quarantine writes `emptyDocument()` over the main key. So element-level validation is wired to document-level destruction.

  **Reproduced** with a document holding one healthy merchant and one whose row is missing `priceGp`:

  ```
  READ STATUS: quarantined
  LIST:        {"status":"ok","merchants":[]}
  MAIN KEY:    {"schemaVersion":1,"transient":null,"saved":[]}
  ```

  The healthy merchant is gone from the library and the main key is empty. The same happens when the *only* fault is in the throwaway `transient` slot — a whole saved library wiped because of the record the GM never asked to keep.

  Before this morning's change that document read `ok` and every good merchant survived. And it contradicts the rationale I wrote for `isMerchant` in Phase 1's triage, in that function's own JSDoc: *"rejecting the whole merchant over one would discard a GM's saved work to enforce a vocabulary that is allowed to change."* The same argument applies one level up, and I did not apply it.

  My Phase 2 report did note "one malformed record costs the whole document" — but recorded it as acceptable because "the corrupt bytes are copied aside and recoverable". That under-weighted it: the GM sees an empty app, and the side copy is itself exposed to F2 and F3 below.
- **Fix A ⭐ Recommended**: Separate the response from the check — quarantine only on document-level shape failure (`schemaVersion` missing, `saved` not an array); for element-level failures, drop the bad elements, keep the rest, and rewrite the surviving merchants.
  - Strength: Matches `isMerchant`'s own stated principle, and keeps the guarantee the slice exists for — a GM with one damaged record does not lose the other nineteen. The corrupt original is still copied aside.
  - Tradeoff: A new result shape (or a `dropped` count) so the GM can be told something was lost; more branches in the read path.
  - Confidence: HIGH — reproduced the loss directly, and the partial-keep path reuses machinery that already exists.
  - Blind spot: Have not decided what the UI should say when records are silently dropped; saying nothing would be its own quiet loss.
- **Fix B**: Revert element validation to document-level only, restoring the pre-triage behaviour.
  - Strength: Smallest change, and provably removes the regression.
  - Tradeoff: Reopens Phase 2's F2 — `listSaved` hands out junk typed as `Merchant[]` and `renameMerchant` throws a `TypeError` out of a module that promises it never throws.
  - Confidence: HIGH — that is exactly the state before this morning.
  - Blind spot: None; it is a straight trade of one defect for another.
- **Decision**: FIXED via Fix A. `isStorageDocument` now validates only the *document* — `schemaVersion`, `saved` is an array, `transient` is present and object-or-null — and a new `salvage()` decides what inside it is usable, filtering unreadable merchants and nulling a damaged `transient`. `ReadResult.ok` gained an optional `dropped` count so the loss is reportable rather than silent.

  The split is the point, and both functions now say so in their JSDoc: the two questions have different answers *and different consequences*, and wiring element damage to the document-level response is what destroyed the library.

  **Verified against the exact scenario from the report** — one healthy merchant plus one with a row missing `priceGp`:

  ```
  READ STATUS: ok                        (was: quarantined)
  LIST:        ["Dobry kowal"]           (was: [])
  MAIN KEY:    holds m-good              (was: empty document)
  ```

  Three tests: the `[null, 42]` case now asserts `ok` with `dropped: 2` and no throw from `renameMerchant`; a one-damaged-record case asserts the healthy merchant survives and **nothing is quarantined**; a damaged-`transient` case asserts the saved library is untouched. The Phase 2 test that asserted the old destructive behaviour was rewritten rather than deleted.

### F2 — The quarantine side key is not unique, so one corrupt payload can destroy another

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-storage.ts:305`
- **Origin**: `96f97dd`
- **Detail**: `` store.setItem(`${CORRUPT_KEY_PREFIX}${new Date().toISOString()}`, raw) `` — millisecond resolution, no existence check, and `Date.now()` is not monotonic (NTP step, manual clock change).

  Two *different* corrupt payloads quarantined inside the same millisecond leave exactly one key, holding the second. The first copy — at that moment the only surviving copy of the GM's library — is destroyed with no signal, by the routine whose entire purpose is to preserve it. Reachable through the storage-event re-read loop and through two tabs.
- **Fix**: `` `${CORRUPT_KEY_PREFIX}${ts}-${newMerchantId()}` ``, and refuse to write when `store.getItem(key) !== null`.
- **Decision**: FIXED — the side key is now `` `${prefix}${ISO}-${newMerchantId()}` ``, with the timestamp kept for the human reading devtools and the id doing the uniqueness. A belt-and-braces existence check refuses to write over an existing side key however the name was arrived at.

  **I walked into F6's trap while fixing this.** My first version of the test quarantined two payloads back to back and asserted two keys — and the mutation (timestamp-only key) **passed**, because the two reads happened to land in different milliseconds. Exactly the flaw I had just written up. The test now freezes the clock with `vi.setSystemTime`, which forces the collision; the mutation then fails it and only it. A guard that fires only when the machine happens to be slow is not a guard.

### F3 — `needs-migration` is unhandled at mount, and no switch is exhaustiveness-guarded

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/components/MerchantGenerator.tsx` mount switch
- **Origin**: **today's triage — a regression I introduced**
- **Detail**: The mount `switch` covers seven of `ReadResult`'s eight members. `needs-migration`, which I added this morning, is missing. The callback returns `void` and there is no `default` and no `never` guard, so TypeScript accepted it silently.

  Consequence: a GM whose device holds an older document sees an ordinary empty generator, no banner, no explanation — and then every write is refused as `read-only`, which `conditionFromFailure` maps to no notice. Completely silent. The Polish message I wrote for this case at `StorageNotice.tsx:53` is unreachable.

  **This directly fails criterion 3.9**, *"Read union exhaustive enough for S-03 to `switch` without a fallback case."* It was true before this morning; my change broke it and the typecheck could not see it.

  The durable problem is wider than the missing case: `grep` finds **no exhaustiveness guard anywhere in the codebase** — no `assertNever`, no `satisfies never`. The next union member added will fall through just as silently. The cross-tab path happens to handle `needs-migration` correctly, which is why the suite stays green.
- **Fix**: Add `case "needs-migration":` to the failure group, and close the switch with an exhaustiveness assertion (`default: { const _never: never = read; }`) so the next member is a compile error rather than silence.
- **Decision**: FIXED — `case "needs-migration":` joins the failure group, so the Polish message written for it is now reachable. The switch closes with `const unhandled: never = read;`, with a comment recording exactly how the gap arose (a `void` callback makes a missing case legal).

  **Mutation-verified:** deleting any case now produces `ts(2322): Type '{ status: "quarantined"; }' is not assignable to type 'never'` — naming the missing member. Criterion 3.9 is satisfied again, and now enforced by the compiler rather than by review. This was the first exhaustiveness guard in the codebase.

### F4 — The latch is invisible to readers, so cross-tab writes die silently

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-storage.ts:149`, `:405-413`, `:457-482`
- **Origin**: `96f97dd`, made more visible by today's `read-only` read member
- **Detail**: Two related gaps, both verified:

  **(a)** `readDocument` returns `read-only` only when *the probe* fails; it never reports the module-level latch. With the latch set by a `future-version` read on one store, `readDocument(healthyStore)` returns `{status:"ok"}` while every write returns `read-only`. Downstream, `conditionFromFailure` maps a `read-only` write to *no notice*, on the stated reasoning that "whatever engaged it recorded its own condition" — true only within one store. Cross-tab, the GM gets a clean-looking UI, `ok` reads, and every correction silently discarded.

  **(b)** `loadForWrite` never consults the latch either — it only translates the read status. With the latch engaged, `promoteTransient(healthyStore)` returns `not-found` and `deleteMerchant("x")` returns `not-found`, not `read-only`. `not-found` also maps to no notice, so the GM is told nothing twice over.
- **Fix**: `if (readOnly) return { status: "read-only" };` as the first line of `loadForWrite`, and have `readDocument` report the latch regardless of the probe. Keep the latching *cause* in a module field so the write result can name it.
- **Decision**: FIXED, both halves. `loadForWrite` now checks the latch before reading anything, so a latched page cannot answer `not-found` for a write that was never going to land. `readDocument` treats the latch as unwritable (`readOnly ? "unavailable" : probeWritable(store)`), so a latched page reports `read-only` **and still hands over the document** — a frozen page shows what it has.

  That second change also closes F9 as a side effect: the probe no longer runs when latched, so it stops being the one write that outlived "refuse every write for this page load".

  Two tests, both mutation-verified against the mutation each targets. Writing them surfaced an ordering subtlety worth recording: the healthy store must be seeded **before** the latch engages, because afterwards its own writes are refused — my first version seeded after and asserted `unavailable`, which is the correct answer for an empty store and the wrong test.

### F5 — Four "the latch holds" assertions prove the mapping, not the latch

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `src/lib/merchant-storage.test.ts` — the `read-only`, `needs-migration` and two quarantine latch cases
- **Origin**: two from `96f97dd`, two from **today's triage**
- **Detail**: Every one of these asserts the latch by calling `putTransient`, which goes through `loadForWrite` — and `loadForWrite` maps the *read status* to `read-only` independently of the latch. So the assertion is satisfied by the mapping whether or not the latch was ever set. Mutation-confirmed: deleting `readOnly = true` at the `read-only` branch, at the `needs-migration` branch, and at both quarantine paths each leaves **43/43 passing**.

  Only two tests genuinely pin the latch — the ones that use a *second, healthy* store, where the mapping cannot supply the answer.

  This is L-03's shape with a different mechanism: the code under test is reached, but a second path produces the same answer. Two of the four are tests I added this morning and reported as verifying the fix.
- **Fix**: Assert through `writeDocument` directly (exported, and it does not re-read), or against a second healthy store — the pattern the two working tests already use.
- **Decision**: FIXED — re-measured rather than assumed, which mattered. After F4's fix, mutating each of the five `readOnly = true` sites gave:

  | Latch site | Before F5 | After F5 |
  |---|---|---|
  | quarantine, copy failed | unguarded | **1 test fails** |
  | quarantine, reset failed | guarded by F4's change | 1 test fails |
  | future-version | guarded | 4 tests fail |
  | needs-migration | unguarded | **1 test fails** |
  | read-only from probe | unguarded | **1 test fails** |

  F4's fix had already rescued one of the four. The remaining three each gained a second-store assertion — the only construction that distinguishes the latch from the read-status mapping, since a clean store has nothing to map and can only be refused by the latch. Every latch site is now guarded.

### F6 — My Phase 2 "mutation-verified" claim for the re-copy guard was wrong

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/lib/merchant-storage.test.ts` — "does not re-copy the payload when the reset write failed"
- **Origin**: **today's triage — my error**
- **Detail**: The Phase 2 report states this test was mutation-verified to fail without its guard. **It is not a reliable guard.** Deleting the `if (readOnly)` early return now leaves 43/43 passing, across three consecutive runs.

  The cause is the same millisecond-resolution key as F2: the test's five reads execute inside one millisecond, so every copy lands on the same key and the count stays 1 whether the guard exists or not. My earlier run was against a slightly different code state and happened to straddle a millisecond boundary — it caught the mutation once, by luck, and I recorded that as verification.

  A timing-dependent guard that passes a mutation test once is worse than an obviously absent one, because it produces a confident claim in a report.
- **Fix**: Advance the clock inside the loop (`vi.setSystemTime`, or a short busy-wait past a millisecond) so the five reads cannot share a key. Then re-run the mutation. Correct the Phase 2 report's claim.
- **Decision**: FIXED — the code half resolved itself as a side effect of F2. Once the side key carries a unique id, each re-quarantine mints a distinct key and the count genuinely grows, so removing the guard now fails the test. Re-measured after F2 landed: mutation fails that test and only that test. No clock advance was needed in the end.

  The record half was corrected in place: `impl-review-phase-2.md` now carries a dated correction stating that the original "mutation-verified" claim was false when written, why (millisecond-resolution key, five reads inside one millisecond), and that it binds today for a different reason. Recorded as a correction rather than a silent edit — a verification claim that turns out to be luck is worth more visible than deleted.

### F7 — `instanceof DOMException` makes a full store unrecoverable

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-storage.ts:194-196`
- **Origin**: `96f97dd`
- **Detail**: `error instanceof DOMException && QUOTA_ERROR_NAMES.has(error.name)` misses any quota failure that is not a same-realm `DOMException` — a plain `Error` (some engines), or a cross-realm one (iframe, worker). Those fall through to `unavailable`, which **latches**.

  The consequence is not cosmetic. Verified: a full store throwing a plain `Error` named `QuotaExceededError` reads as `read-only`, latches, and then `deleteMerchant` returns `read-only`. The store is full, the notice says "site data is off", and the one recovery the product offers — delete merchants to free space — is refused. The correctly-classified path avoids this precisely, because `"full"` does not latch.

  Separately, the `instanceof` makes the two legacy names the plan specifically required unreachable: reducing the set to `["QuotaExceededError"]` alone changes no test.
- **Fix**: Match structurally rather than on the constructor — `QUOTA_ERROR_NAMES.has(name ?? "") || code === 22 || code === 1014`. This also removes a latent `ReferenceError` where the global is absent, out of a module that promises it never throws.
- **Decision**: FIXED — `isQuotaError` now reads `name` and `code` off an unknown object instead of testing the constructor. The JSDoc records why `instanceof` looked stricter and was strictly worse: misclassifying full as disabled does not just pick the wrong message, it **removes the way out**, because `unavailable` latches and `deleteMerchant` is the one remedy a full store has.

  A test covers all four spellings — WebKit's `QUOTA_EXCEEDED_ERR`, Firefox's `NS_ERROR_DOM_QUOTA_REACHED`, a plain `Error` named `QuotaExceededError` (the shape `instanceof` used to miss), and a code-only error. **Mutation-verified:** reducing the name set to the modern spelling alone now fails that test. Before this change the same mutation changed nothing — the legacy names the plan specifically required were unreachable.

### F8 — `listSaved` hides the library on a write-refusing store

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/merchant-storage.ts:625-635`
- **Origin**: **today's triage — incomplete fix**
- **Detail**: Phase 2's F5 fix taught `readDocument` to return the document on a write-refusing store. `listSaved` was not updated: it returns `read` unchanged for any non-`ok` status, so it answers `{status:"read-only", doc}` — a failure member carrying the merchants in a field named `doc`, not `merchants`. Verified: `"merchants" in list === false`.

  The two read surfaces now disagree about what `read-only` means. Any caller using `listSaved` hides a Safari-private-mode GM's whole library — the exact loss the status was added to prevent, fixed on one surface of two. The island dodges it only because it deliberately avoids `listSaved`.
- **Fix**: `if (read.status === "ok" || read.status === "read-only") return { status: "ok", merchants: read.doc.saved };`
- **Decision**: FIXED — `listSaved` now treats `read-only` alongside `ok`, with a comment stating the division: whether writes are refused is the *writer's* problem; this function answers "what is saved", and the answer is the same either way. A test seeds a real document, reads it through a write-refusing fake, and asserts the merchant comes back by name. **Mutation-verified** — narrowing the condition back to `ok` alone fails that test and only that test.

### F9 — The `unreadable` contract text is wrong in the case the plan called out

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/merchant-storage.ts:76-78`, `src/components/StorageNotice.tsx:35`
- **Origin**: `96f97dd`
- **Detail**: The doc comment says `unreadable` means the payload "could *not* be copied aside, so nothing was touched." On the copy-succeeded-reset-failed path it **was** copied aside successfully — the bytes exist in two places and the status claims neither. The GM-facing message propagates the same wrong claim, in precisely the case the plan names "the quota-plus-corruption case."
- **Fix**: Reword both to "could not be replaced with a fresh document" and, where the copy did land, say so — it is the difference between "your data is stuck" and "your data is stuck but also safely duplicated".
- **Decision**: FIXED — reworded in three places. The `ReadResult` doc now says `unreadable` means the main key could not be *replaced*, and states explicitly that it says nothing about whether the side copy landed, because it is reached on both paths. `StorageNotice`'s docblock was corrected the same way, and the Polish message dropped its "ani odłożyć ich na bok" claim ("nor set them aside"), which was the false half.

  I settled on not distinguishing the two paths for the GM rather than reporting both: they cannot act on the difference, and what they *can* act on — the original is still there, free up space and it may come back — is true either way. Claiming a side copy that may not exist is the failure mode worth avoiding.

### F10 — Two plan deviations from today's triage are undocumented, and one test title now misdescribes itself

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `plan.md:447-449`, `:463`; `merchant-storage.test.ts` — the "Safari private mode" case
- **Origin**: **today's triage**
- **Detail**: Three bookkeeping consequences of this morning's changes:
  1. `plan.md:447-449` specifies the `< SCHEMA_VERSION` branch ships as "a single documented seam … no runner, no registry". It now fails closed with a `needs-migration` status. I judge that the right call — `save` stamps the current version onto everything it writes, so a fall-through corrupts silently the day v2 ships, and the plan's own Migration Notes argue for failing closed. But the plan still describes code that does not exist. (It is not a *runner*, so the "NOT Doing" line is not breached.)
  2. `plan.md:463` says a write-refusing store reads `unavailable`; it now reads `read-only`.
  3. The test titled for Safari private mode asserting `unavailable` passes **only because its fake has no seed**. The adjacent new test proves a *seeded* store in the same condition reads `read-only`. Two neighbouring tests now assert opposite things about the same browser, distinguished only by seeding.
- **Fix**: One dated addendum covering both deviations (the plan already uses that convention), and retitle the unseeded test to say what it actually pins — an empty store that refuses writes.
- **Decision**: FIXED — a dated four-point addendum now closes the Phase 3 contract, covering the fail-closed migration seam, the `read-only` read status, F1's salvage-instead-of-quarantine change, and the new exhaustiveness guard. Each states its reason, and point 1 notes explicitly that the "no runner, no registry" boundary still stands.

  The misleading test is retitled "reads an EMPTY write-refusing store as unavailable — nothing to show either way", with a comment pointing at its neighbour. The two no longer look like they contradict each other: the seeding *is* the distinction, and now the titles say so.

## Not findings

- **Validation cost** — bounded and non-throwing. 20 000 merchants validate in 33 ms, linear, dominated by the `JSON.parse` that already walked the same bytes. No recursion, so deeply nested junk neither hangs nor throws. `__proto__` in a payload is inert.
- **`DOMException` in the prerender** — `isQuotaError` is only ever called inside a `catch` during a real `setItem` failure, never at module scope, and the prerender returns `unavailable` before reaching the probe. Latent, not live (and F7's fix removes it).
- **Probe cross-tab noise** — the probe fires `storage` events in other tabs, but the island filters on `event.key !== STORAGE_KEY`, so there is no feedback loop. The probe is ~58 bytes and released before the real write, so it cannot starve it.
- **Probe residue on a throwing `removeItem`** — possible and unhandled, but real `Storage.removeItem` does not fail independently of `setItem`. Two-line `finally` if it is ever touched.

## Note on review method

Both sub-agents ran throwaway Vitest probes and deleted them; I confirmed no stray probe files remain and that `merchant-storage.ts` is byte-identical to its pre-review state (md5 `ba81c683…`). F1 and F3 I reproduced myself. F6 is a correction to my own earlier work: I re-ran the mutation three times to be sure before contradicting the Phase 2 report.
