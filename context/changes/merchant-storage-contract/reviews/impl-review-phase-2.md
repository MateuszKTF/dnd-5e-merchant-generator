<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Kontrakt encji kupca i trwałości w magazynie przeglądarki

- **Plan**: `context/changes/merchant-storage-contract/plan.md`
- **Scope**: Phase 2 of 3 — Happy-path storage contract (commit `9c35773`)
- **Date**: 2026-09-12
- **Verdict**: REJECTED → **RESOLVED** (triaged 2026-09-12; 8 fixed, 1 skipped, 0 outstanding)
- **Findings**: 3 critical, 3 warnings, 3 observations

## Post-triage gate run (2026-09-12)

`npm run typecheck` 0 errors · `npm test` **339 passed** (was 334) · `npm run lint` exit 0 ·
`npm run build` complete.

All three criticals are closed, each with a regression test that was mutation-verified to fail
without its fix. The `ReadResult` union gained two members (`read-only` carrying a document, and
`needs-migration`), and **the CI typecheck added in Phase 1 earned itself twice**: each union
extension surfaced consumers — `loadForWrite`, two `handleFailedRead` call sites, and
`StorageCondition`'s message map — that `npm test` alone would have sailed straight past.

Fixed: F1 (version before shape), F2 (element validation, giving `isMerchant` its first
production caller), F3 (quarantine no longer re-copies), F4 (plan corrected; Fix B proved
impossible and was withdrawn), F5 (a write-refusing store still shows its merchants), F6
(migration seam fails closed), F8 (`writeDocument` documented as not-for-callers), F9 (three tests
raised to match their names). Skipped by decision: the remainder of F7 (redundant downstream
guards left in place deliberately).

**Carried forward:** all three manual rows (2.5–2.7) remain unchecked, and two of the behaviours
this triage changed are only observable in a browser — a write-refusing store now shows the
library behind a banner, and a corrupt payload on a full store no longer accumulates copies.

## Review lens

Phase 2 shipped in `9c35773`; Phase 3 (`96f97dd`) later extended the same files with failure modes, which is planned rather than drift. `git diff 9c35773 -- merchant-storage.test.ts` confirms Phase 3 touched **no** Phase 2 test body — every Phase 2 assertion is as shipped.

Three findings are CRITICAL, and **all three were reproduced with a throwaway probe rather than reasoned about**. The probe has been deleted; the suite is back to 334 passing.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

### What holds

The contract is implemented faithfully. `STORAGE_KEY` carries no version (a versioned key would orphan the previous document — the plan's reasoning, honoured). `SCHEMA_VERSION = 1`. `StorageLike` is exactly three methods. **Storage is resolved inside `resolveStorage()` per call, never at module scope** — and the code uses `globalThis.localStorage` rather than the plan's `window.localStorage`, which is strictly better for the workerd/Node prerender.

**No cap, no eviction, no trimming anywhere.** The only array-shortening call in the module is `deleteMerchant`'s `filter`. That is what makes "a saved merchant never disappears without an explicit action" structurally true, and the plan was right to forbid it absolutely.

`updateSavedMerchant` cannot touch `id`, `createdAt` or `name` — they are structurally unreachable in the spread — and its not-found guard returns before `save` is ever called, so an unknown id cannot append. Its no-append test is the strongest in the file: it snapshots raw bytes from the fake's backing map and asserts byte equality.

**The storage fake does not ship.** Verified against a real build: `createStorageFake`, `throwOnGet`, `storage-fake` and `resetReadOnlyLatch` all have zero hits anywhere in `dist/`, while the control string `dnd-merchant-generator` does appear — so the grep genuinely reaches the bundled storage code. The `src/lib/` placement is safe as built.

### Automated success criteria — re-run 2026-09-12

| # | Criterion | Result |
|---|---|---|
| 2.1 | `npm test` | PASS — 334 tests |
| 2.2 | `npx astro check` | PASS — 0 errors |
| 2.3 | `npm run build` (proves no `window` at import) | PASS |
| 2.4 | `npm run lint` | PASS — exit 0 |

All three manual rows (2.5–2.7) unchecked. Nothing rubber-stamped.

## Findings

### F1 — A future-version document with a changed shape is destroyed, not protected

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-storage.ts:294-305`
- **Detail**: The structural check runs **before** the version check:

  ```ts
  if (!isStorageDocument(parsed)) { return quarantine(store, raw); }   // :294
  if (parsed.schemaVersion > SCHEMA_VERSION) { readOnly = true; … }    // :298
  ```

  `isStorageDocument` demands v1's exact shape — a `saved` array and a present `transient` key. A v2 document that renames or restructures those fields is exactly what a version bump is *for*, and it fails at `:294` and is treated as corrupt.

  **Reproduced:**

  ```
  input : {"schemaVersion":2,"merchants":[{"id":"a"}]}
  result: {"status":"quarantined"}
  main key after read: {"schemaVersion":1,"transient":null,"saved":[]}
  ```

  The rolled-back build **overwrites the newer document under the main key** with an empty one, never latches read-only, and `MerchantGenerator.tsx` stands persistence down only on `future-version` — so writes stay armed. The GM sees an empty library; their merchants survive only under a timestamped `:corrupt:` key that no UI exposes.

  This is precisely the scenario AGENTS.md's forward-only hard rule exists for, and the `future-version` branch's own comment promises the opposite: *"Leave the document strictly untouched — no rewrite, no field-stripping, no quarantine."* It does all three.
- **Fix**: Check the version first. Validate `typeof candidate.schemaVersion === "number"`, branch on `> SCHEMA_VERSION` (latch + `future-version`) **before** any shape validation. Shape validation should only apply to documents this build claims to own.
- **Decision**: FIXED — a new `isFutureVersion` guard reads *only* the version number and now runs ahead of `isStorageDocument`. Its JSDoc states why it looks at nothing else: a document this build does not own is not this build's to validate. The old, now-unreachable `> SCHEMA_VERSION` branch was removed and its rationale folded into the new gate.

  A test was added for the case the existing fixture missed — the old one kept v1's layout, so it passed a shape check by accident. The new one uses `{schemaVersion: 2, merchants: […]}` and asserts `future-version`, that the main key is byte-identical, and that no `:corrupt:` key was created. **Mutation-verified:** swapping the two checks back to shape-first fails that test and only that test.

### F2 — Junk in `saved` makes the module that "never throws" throw

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-storage.ts:228-233`, used at `:434`, `:457`, `:483`
- **Detail**: `isStorageDocument` validates only `Array.isArray(candidate.saved)` — never its elements. Every mutation then assumes `Merchant`:

  ```ts
  if (!loaded.doc.saved.some((merchant) => merchant.id === id))   // :434, :457
  ```

  **Reproduced** with `saved: [null, 42]` (reachable by hand edit, by a newer build, or by a truncated document):

  ```
  readDocument   -> ok
  listSaved      -> {"status":"ok","merchants":[null,42]}
  renameMerchant -> THREW TypeError: Cannot read properties of null (reading 'id')
  ```

  `listSaved` also hands the junk out typed as `Merchant[]`, and `merchant-library.ts` dereferences `merchant.rows` on it. A throw out of `renameMerchant` inside a React handler trips the error boundary on the product's only page.

  Two rules are broken at once: the module header's "Nothing here throws", and the AGENTS.md hard rule that names **this file** as the discriminated-union exemplar.
- **Fix**: Add `candidate.saved.every(isMerchant)` to `isStorageDocument`. `isMerchant` already exists and is fully tested in `merchant.ts` — the Phase 1 triage exported it for exactly this boundary, and it currently has no production caller.
- **Decision**: FIXED — `isStorageDocument` now validates every element of `saved` with `isMerchant`, giving that guard its first production caller (see F7). The `transient` slot got the same treatment for the same reason: it is restored onto the screen on mount, where `fromStoredRows` would map over an absent `rows`. `isMerchant` subsumes the old `typeof === "object"` check, so an absent `transient` still fails.

  A test pins the behaviour end to end: a `saved: [null, 42]` document now reads as `quarantined`, `renameMerchant` does **not** throw, and `listSaved` returns an empty list rather than junk typed as `Merchant[]`.

  **Consequence worth naming:** a document with one bad element is now quarantined whole rather than partially trusted. That is the right call for this module — the corrupt bytes are copied aside and recoverable — but it does mean one malformed record costs the whole document rather than itself.

### F3 — A failed quarantine reset re-copies the corrupt payload on every subsequent read

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-storage.ts:250-265`
- **Detail**: Quarantine is two steps. Step 1 (copy aside) latches read-only on failure; step 2 (reset the main key) does not:

  ```ts
  if (writeDocument(emptyDocument(), store).status !== "ok") {
    // ... "the next read will quarantine them again"
    return { status: "unreadable" };   // :261 — no `readOnly = true`
  }
  ```

  The comment predicts the re-quarantine but not its cost: each re-entry writes another timestamped `:corrupt:` key. `readDocument` runs on mount, on every `storage` event, and inside `loadForWrite` for every mutation, so a corrupt document plus a near-full store turns ordinary use into a slow quota bomb — in a module whose stated premise is that nothing is ever evicted.

  **Reproduced, with one correction to the severity:**

  ```
  corrupt copies after 4 reads: 2   | main key still: {{{garbage
  ```

  Two copies, not four — the `Date.now()` key collides for reads inside the same millisecond. So growth is **one copy per distinct millisecond of reading**, not per read. Still unbounded over a session, and still never reclaimed, but slower than a naive reading suggests.

  It also contradicts `:73-78`, which promises `unreadable` means "nothing was touched".
- **Fix A ⭐ Recommended**: Set `readOnly = true` on the `:261` path too, matching `:254`, so the latch stops both further writes and further copies.
  - Strength: One line, and it makes the two failure paths of one operation agree. The latch already exists and already means "stop writing"; this is the case it was built for.
  - Tradeoff: The corrupt bytes stay under the main key, so the GM stays in a degraded read-only session until they intervene — which is arguably the honest state.
  - Confidence: HIGH — the latch's effect on subsequent writes is already tested on the sibling path.
  - Blind spot: Haven't checked how the UI presents `unreadable` + latched versus `unreadable` alone.
- **Fix B**: Key the copy off a hash of `raw` instead of `Date.now()`, making re-quarantine idempotent.
  - Strength: Fixes the duplication at its cause, and survives the case where a latch is reset or a new tab starts fresh.
  - Tradeoff: Needs a hash function this project does not have; more code than the real problem warrants.
  - Confidence: MEDIUM — correct in principle, but it leaves the second write attempt happening at all.
  - Blind spot: Two different corrupt payloads would still produce two copies, which may be desirable.
- **Decision**: FIXED via Fix A — **but Fix A as written was not sufficient, and I verified that rather than assuming it.** Setting `readOnly = true` on the failed-reset path alone changed nothing: the quarantine copy calls `store.setItem` directly, not `writeDocument`, so the latch never gated it. Measured: still 2 copies from 4 reads.

  The complete fix adds a `readOnly` check at the **top of `quarantine`**, so a latched session stops re-copying at the source. Measured after: **1 copy regardless of read count.** Not retrying costs nothing — the previous attempt failed because the store was full, and the bytes stay under the main key, recoverable by hand either way.

  A regression test covers the nastiest combination (unparseable bytes in a store too full to overwrite them): five reads, all `unreadable`, exactly one `:corrupt:` key, and the original bytes still intact.

  > **Correction (Phase 3 review, same day).** This paragraph originally said the test was "mutation-verified — deleting the guard fails that test and only that test." **That claim was false when written.** Re-running the mutation three times showed the test passing every time: the side key was `` `${prefix}${ISO}` `` at millisecond resolution, and the loop's five reads execute inside one millisecond, so every copy landed on the same key and the count stayed 1 whether the guard existed or not. My single earlier run happened to straddle a millisecond boundary and caught the mutation by luck, and I recorded that as verification.
  >
  > The test **does** bind now, but for a different reason than the clock: Phase 3's F2 fix gave the side key a unique id suffix, so each re-quarantine mints a distinct key and the count genuinely grows. Deleting the guard now fails that test and only that test — verified after the change, not before.
  >
  > Recorded rather than quietly edited: a verification claim that turns out to be luck is worth more as a correction than as a deletion.

  Worth recording: my first mutation attempt used a `perl` substitution that silently failed to match, and the suite passed. I only caught it by checking the md5 before and after. A mutation test that does not change the file proves nothing.

### F4 — The plan's "single most important test" does not guard the mechanism the plan credits

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `src/lib/merchant-storage.test.ts:139-164`, `src/lib/merchant-storage.ts:414`
- **Detail**: The plan calls the deep copy *"the structural fix for the aliasing hazard"* and names this test as what proves it. **Mutation-verified: replacing `...structuredClone(transient)` with `...transient` leaves all 38 file tests — and all 334 suite tests — passing.**

  The test is not vacuous. It carries its own anti-vacuity guard (`expect(savedBefore).toContain("Zapisany")`) and it does fail on a real regression: deleting `id: newMerchantId()` fails it. But the property it pins is **separate identity**, not deep-copy independence — and the test's own comment says so plainly: *"Everything here round-trips through JSON, so object-level aliasing cannot survive a write anyway — a shared id is the form the hazard would actually take."*

  That comment is correct. The `JSON.stringify`/`JSON.parse` boundary is what makes object aliasing unreachable across a write; `structuredClone` is defence-in-depth for the object `promoteTransient` *returns* to its caller — and the caller does put it into React state. I traced that path: `transient` is itself a fresh parse, so the clone protects nothing live today. It is cheap, correct insurance, but it is untested and the plan overstates it.
- **Fix A ⭐ Recommended**: Correct the plan's claim — the structural fix is the JSON boundary plus the fresh id; `structuredClone` is documented belt-and-braces.
  - Strength: Makes the plan describe the mechanism that actually holds, so the next reader does not trust a guarantee to the wrong line of code. Costs nothing and removes a false sense of coverage.
  - Tradeoff: Leaves the clone untested, so a future refactor could drop it silently.
  - Confidence: HIGH — I traced the caller and confirmed the clone is not load-bearing today.
  - Blind spot: If a future caller mutates the returned record, the clone becomes load-bearing and this decision would need revisiting.
- **Fix B**: Add an in-memory assertion — mutate `promoted.merchant.rows[0]` and assert the document's transient row is unchanged — so the clone is actually guarded.
  - Strength: Makes the plan's claim true instead of adjusting it; fails under the mutation that currently passes.
  - Tradeoff: Pins an implementation detail that the JSON boundary makes unobservable in practice, which is arguably over-testing.
  - Confidence: HIGH — the mutation I ran shows exactly what such a test would catch.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A. **Fix B was attempted and proved impossible — that is the more useful result.**

  I wrote the in-memory test (mutate `promoted.merchant.rows`, assert the document is untouched) and mutation-tested it: **it passes with and without `structuredClone`.** The reason is structural — `save()` serializes the whole document to JSON before any caller mutation can reach it, and `transient` is itself a fresh `JSON.parse` product, so no array is shared with anything outliving the call. There is no observable difference between the cloned and uncloned versions, so no test can pin one.

  The test was therefore **removed** rather than kept: it asserted something true but unrelated to the line it was named for, which is exactly the L-03 pattern this review round has been flagging.

  Fix A's plan correction is applied and is now better supported than when written — the plan records that the fresh id plus the JSON boundary is the real mechanism, and that `structuredClone` is defence-in-depth. The code carries the same note, including an explicit instruction not to add a test for it: a test that passes with and without the line it names is worse than no test.

### F5 — A store that reads fine but refuses writes hides merchants that are right there

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-storage.ts:272-274`
- **Detail**: `readDocument` probes writability and abandons the read before `getItem` is ever attempted:

  ```ts
  if (probeWritable(store) === "unavailable") { return { status: "unavailable" }; }
  ```

  `probeWritable`'s own doc argues that a **full** store must stay readable because *"refusing to read it would lose merchants that are sitting right there."* The identical argument applies to a write-refusing store — and here it is not applied. The GM's library disappears behind a "storage off" banner while the bytes are intact and readable.
- **Fix**: Run the probe, keep its result, but still read; report the write-refusal as a separate condition (the `read-only` vocabulary already exists) with `doc` attached.
- **Decision**: FIXED — `readDocument` now keeps the probe result and reads anyway. A store that reads but refuses writes returns a new `{ status: "read-only"; doc }` member **carrying the document**, and latches so later writes report the refusal instead of appearing to succeed. An *empty* store that refuses writes still returns `unavailable` — there is nothing to show, so the refusal is the only news.

  **The CI typecheck added in Phase 1 earned itself here.** Extending the union surfaced two consumers I would otherwise have missed: `loadForWrite`'s exhaustive switch, and two `handleFailedRead` call sites in the island. Both now route `read-only` onto the *adopt* path rather than the failure path — the document is real, so the merchants are shown while the banner says they cannot be added to. `npm test` alone would have stayed green through all of it.

  A test covers the Safari-private shape end to end: seed a real document, read through a `throwOn: true` fake, assert `read-only`, assert the saved merchant comes back by name, and assert the next write reports `read-only`.

### F6 — `save()` stamps the current version onto an un-migrated document

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/merchant-storage.ts:307-313`, `:369-371`
- **Detail**: The `< SCHEMA_VERSION` branch is an empty migration seam that falls through carrying the *old* `schemaVersion`, and `save()` then relabels it: `writeDocument({ ...doc, schemaVersion: SCHEMA_VERSION }, storage)`.

  No live case at v1. But the first write after v2 ships will silently mark a v1 document as v2 whether or not a migration ran — precisely the failure the forward-only rule exists to prevent, and invisible when it happens.
- **Fix**: Make the `< SCHEMA_VERSION` branch fail closed (latch + a `needs-migration` status) until a migration is registered, rather than falling through.
- **Decision**: FIXED — the seam now latches and returns a new `{ status: "needs-migration"; found }`, with a comment stating why: falling through hands back an un-migrated document still carrying its old version, and `save` stamps `SCHEMA_VERSION` onto whatever it writes, so the first write after v2 would relabel it silently and permanently. Refusing to write is the only behaviour that cannot corrupt by omission.

  The typecheck again surfaced the consumers — `loadForWrite` and `StorageCondition` — and `StorageNotice` gained a Polish message for the case. It is unreachable at v1, and the comment says so; it exists so that the day someone bumps the version, a GM holding an older document is told rather than losing it.

  A test covers the branch that has no live case: a `SCHEMA_VERSION - 1` document reads as `needs-migration`, the bytes are untouched, and a subsequent `putTransient` is refused with the bytes still untouched.

### F7 — `isMerchant` was centralized in Phase 1 and is still called by nothing

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/merchant.ts` (the guard), `merchant-library.ts:166`, `merchant-session.ts:87`
- **Detail**: Today's Phase 1 triage pulled `isMerchant` up because two downstream modules had each re-derived a partial version. The guard now exists and is tested — but `merchant-storage.ts`, the boundary where parsed bytes become typed values, does not call it, and both partial re-derivations are still in place.

  This is the same finding as F2 seen from the other side: adopting the guard at the boundary fixes the throw **and** lets those two ad-hoc checks go.
- **Fix**: Wire `isMerchant` into `isStorageDocument` (F2's fix), then remove the now-redundant `Array.isArray(merchant.rows)` checks downstream.
- **Decision**: HALF FIXED BY F2, remainder SKIPPED. F2's fix gave `isMerchant` its first production caller at the boundary where it belongs, which was the substance of this finding. The two downstream re-derivations were deliberately left in place: they are harmless, and keeping them means `merchant-library.ts` and `merchant-session.ts` do not silently depend on the storage boundary having validated for them. If anything ever builds a `Merchant` without going through storage, those guards still hold.

### F8 — Three exported functions have no production caller, one of which can clobber `saved`

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/merchant-storage.ts:149`, `:318`, `:496`
- **Detail**: `resetReadOnlyLatch`, `writeDocument` and `listSaved` have no production caller — the island explicitly avoids `listSaved`, and `resetReadOnlyLatch` is documented as test-only but still ships in the type surface.

  `writeDocument` matters more than the other two: it is the only exported function that can shrink `saved` **without re-reading**, i.e. the single wholesale-clobber affordance in an API whose entire guarantee is that merchants do not vanish. Every safe operation goes through `loadForWrite` → `save`; this one does not.
- **Fix**: Keep `writeDocument` module-private (tests can reach it through `putTransient`), or document it explicitly as not-for-callers.
- **Decision**: FIXED by documentation rather than by narrowing the export. `writeDocument` now carries a JSDoc marking it **not for callers outside this module**, stating that it is exported for tests, that application code must use the named operations (which all re-read via `loadForWrite` → `save` so a change from another tab is never overwritten blind), and that it is the only wholesale-clobber affordance in the public surface. It still honours the latch and still reports quota failures — the hazard is the caller, not the write. `listSaved` and `resetReadOnlyLatch` were left alone; both are already documented and neither can destroy data.

### F9 — Three Phase 2 tests prove less than their names claim

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/lib/merchant-storage.test.ts:186`, `:207`, `:244`
- **Detail**: An L-03 pass over the Phase 2 tests. The fake is genuinely exercised throughout — `storedBytes` reads the backing map directly, so "unchanged" claims are about real bytes — and most tests reach real assertions. Three are weaker than their names:
  - `:244` *"touches exactly one record and leaves its neighbours byte-identical"* asserts only that `merchants[1]` is unchanged. An `updateSavedMerchant` that did nothing at all would pass it. The positive half lives in the sibling test at `:221`, so the suite is not blind.
  - `:207` `renameMerchant` not-found checks only `merchants.length === 1`, where its `updateSavedMerchant` and `deleteMerchant` counterparts use the stronger raw-byte comparison.
  - `:186` `listSaved` *"never contains the transient record"* expects `[]`, which a `listSaved` hard-coded to return `[]` would satisfy. Covered in practice by `:166`.

  Also missing, and directly responsible for F1 and F3 passing the suite: no test uses a future-version document whose **shape** differs from v1, and none re-reads after a quarantine whose reset write failed.
- **Fix**: Raise `:207` and `:244` to the raw-byte comparison the sibling tests already use, and add the two missing fixtures alongside whichever of F1/F3 is fixed.
- **Decision**: FIXED, all three. The `renameMerchant` not-found case now compares raw bytes like its siblings (a length check would miss a rename that hit the *wrong* record — the failure actually worth guarding). The neighbours case gained its positive half, so an `updateSavedMerchant` that did nothing can no longer pass on the neighbour assertion alone. The `listSaved` case now runs against a non-empty saved list, so it cannot be satisfied by a function that always returns nothing.

  **Mutation-verified:** making `updateSavedMerchant` a no-op now fails **two** tests where it previously failed one. The two missing fixtures were added as part of F1 and F3.

## Not findings

- **Atomicity** — the document itself is always one `setItem` of the whole value, and `save()` is the only path callers reach, so "lands whole or not at all" holds. Two caveats worth stating: `quarantine` performs two writes (F3), and `readDocument` *does* write on every call via `probeWritable`, so "a read never mutates the store" is not true.
- **Quota handling** — correct everywhere except inside quarantine. A throwing `setItem` leaves the prior document byte-identical, and that is asserted.
- **`structuredClone`** — used once, on a value fresh from `JSON.parse`, so every shape is cloneable; present in browsers, Node 22 and workerd; called at runtime only.
- **Prototype pollution** — not reachable. `JSON.parse` defines `__proto__` as an own data property and does not walk the prototype chain; the own key survives spreads and re-serializes inertly. The real parse-side risk is validation depth (F2).
- **Performance** — one parse, one stringify and one probe write per operation over tens of merchants × 25 rows. Sub-millisecond. The only unbounded growth path is F3.
- **Cross-tab read-modify-write** — every mutation re-reads immediately before writing inside one synchronous block, and no caller holds a document across a tick. The residual gap across processes cannot be closed with `localStorage` alone and is already acknowledged in the island. Recorded as an accepted risk, not a fix.

## Note on review method

All three CRITICAL findings were reproduced with a throwaway Vitest probe rather than reasoned about, and one severity was corrected in the process: F3 amplifies per *millisecond* of reading, not per read, because the `Date.now()` copy key collides within a tick. F4's mutation was run twice — once by a sub-agent, once by me independently — with `merchant-storage.ts` md5-verified identical before and after. The probe file has been deleted and the suite is back to 334 passing.
