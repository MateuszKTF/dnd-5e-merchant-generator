# Island Test Reachability and Save-Failure Reporting — Implementation Plan

## Overview

Rollout Phase 1 of `context/foundation/test-plan.md`. Two jobs, in this order: close the
defects that need no new infrastructure, then build the jsdom harness that makes the React
islands reachable at all and use it against Risk #1.

The governing rule for every test in this plan: **the expected value comes from an
independent oracle — the PRD guardrail, a numbered FR, a US acceptance criterion, or a
documented contract in a docblock — never from reading the implementation and asserting
what it currently returns.** Research found eight target behaviors the code currently
fails; a plan written to match current behavior would encode four live bugs as expected
values.

## Current State Analysis

- `vitest.config.ts:18,23` pins `environment: "node"` and `include: ["src/**/*.test.ts"]`.
  **3 068 lines of `.tsx`/`.astro` are structurally unreachable by the runner**, and the
  dark surface grew 89 lines since the audit that first measured it.
- The suite is **368 tests across 7 files**, all in `src/lib/`. A prior mutation audit
  killed 21 of 23 planted mutants, so depth where it exists is genuine.
- **No coverage tooling exists anywhere** — confirmed absent from `vitest.config.ts`,
  `package.json`, and `.github/workflows/ci.yml`. Nothing reports the dark surface.
- The documented compensating control — manual verification steps in each plan — **was
  never executed** for roughly 40 criteria across three change folders
  (`merchant-storage-contract/plan.md:632-665`, `last-merchant-persists/plan.md:597-640`,
  `manual-item-corrections/plan.md:599-627`).
- Six defects from the prior storage audit (F5–F10) remain, deliberately scoped out at
  `storage-layer-consistency-audit/plan.md:79-82`.

### Key Discoveries

- **`isStandingCondition` is importable from a node test today.** `StorageNotice.tsx` has
  zero `import` statements; the compiled JSX runtime reaches `react` but never
  `react-dom`, so nothing touches the DOM (`StorageNotice.tsx:128`, `:31`). `STANDING`
  itself is private (`:115`) and must be probed through the exported function.
- **Vitest 5 removed both alternatives to `test.projects`.** `environmentMatchGlobs` and
  `vitest.workspace.ts` were removed in Vitest 4. The per-file `@vitest-environment`
  docblock still works but cannot scope `setupFiles` or `globals`, which would force
  Testing Library's setup onto all 368 node tests.
- **`extends` defaults to `true` in Vitest 5** — the opposite of v3.2/v4. Root
  `environment`/`include` leak into every project unless explicitly overridden. This is
  the single most likely way to silently break the existing suite.
- **`coverage` is banned inside project configs** and must stay root-level. `coverage.all`
  does not exist in Vitest 5; the mechanism is `coverage.include`.
- **jsdom 30 requires Node `^22.22.2 || ^24.15.0 || >=26`.** `.nvmrc` pins `22.14.0` and
  `package.json` engines says `>=22.12.0` — both below the floor.
- **jsdom cannot do four things this rollout will eventually need**: the `storage` event
  never fires (`Storage-impl.js` filters out the originating window, and there is only
  one), `HTMLDialogElement.showModal`/`close` are unimplemented (the impl class is an
  empty body, jsdom#3294 still open), `pagehide`/`visibilitychange` never fire on their
  own, and `getComputedStyle` cannot answer color contrast without a paint engine.
- **Module state is per-file, not per-test.** `resetReadOnlyLatch` exists for this reason
  (`merchant-storage.ts:161-166`); making it a no-op kills 26 tests
  (`merchant-storage-contract/plan.md:441-446`).
- **Type-level assertions are invisible to `npm test`.** `merchant.test.ts:64-65` states it
  outright — Vitest transpiles without type-checking, so only `astro check` sees them.

## Desired End State

The runner reaches `.tsx`. Four live defects are fixed, each proven by a test that failed
before the fix for the documented reason. Four contracts that currently hold are pinned
against future regression. Risk #1 is asserted at the island layer, with its three
island-layer defects quarantined executably rather than silently. Coverage reports the
remaining dark surface as 0% instead of omitting it.

Verify by: `npm test` green across both projects; `npm run test -- --coverage` reporting
non-zero line counts for `src/components/*.tsx`; and the quarantine count gate passing.

**Risk #1 will not be fully mitigated when this plan ends.** Four of its five behaviors are
asserted; three known failures are quarantined and owned by a later defect-fix change. The
§3 status flip to `complete` means this rollout phase shipped, not that Risk #1 is closed.

## What We're NOT Doing

- Not fixing the island-layer defects (`not-found` mute notice, F2 wrong message, F3 no DOM
  change, the live-region mount pattern, the focus-ring contrast). They are quarantined here
  and owned by a follow-up change.
- Not testing the cross-tab `storage` path, the `ConfirmDialog` modal semantics, or
  `pagehide`/`visibilitychange` triggers — jsdom cannot exercise any of them honestly.
- Not checking color contrast — deferred to §3 Phase 5, which has a real browser.
- Not adding coverage thresholds or a ratchet. Report only.
- Not touching the a11y gate scope (L-04) — that is §3 Phase 4.
- Not fixing the 12 existing tests that cannot fail for the right reason. Recorded as an
  open question in research; out of scope here.
- Not decomposing `MerchantGenerator.tsx`. Testing it as it stands is the point.

## Implementation Approach

Cheap and independent first. Phases 1 and 2 need no new dependency, no config change, and
no harness — they land four bug fixes and four contract pins inside the existing green
suite, so the riskiest change (the runner config) arrives after the suite has already
grown. Phase 3 splits the runner. Phase 4 spends the new capability on the single highest
risk. Phase 5 writes down what was learned.

### Quarantine mechanism

Quarantined defects use `it.fails()`, not `it.skip()`. A skipped test never executes — the
L-03 failure mode this repo has already hit twice. `it.fails()` runs the assertion, stays
green while the defect stands, and **breaks the build the moment someone fixes the
defect**, forcing the entry to graduate. Its weakness is that it passes when the test fails
for the wrong reason, so every quarantined test names its expected failure in a comment, and
Phase 4 adds a gate pinning the total count.

## Critical Implementation Details

**Ordering.** `npm run typecheck` must stay ahead of `npm test` in CI
(`.github/workflows/ci.yml:25-26`). The correction-type assertion in Phase 2.4 is
compile-time only; if the order flips, it silently stops being checked.

**State sequencing.** Every test file touching the read-only latch must call
`resetReadOnlyLatch()` in `beforeEach`. Vitest isolates module state per file, not per
test, so a latch engaged by one test persists into the next in the same file.

---

## Phase 1: Close the cheap defects

### Overview

Four defects whose fix is a few lines in a pure module. Each sub-phase writes the test
first, runs it against unfixed code, records that it fails for the stated reason, then
fixes the code. No new dependencies; the existing `src/**/*.test.ts` glob already collects
all of these.

### Changes Required:

#### 1. Standing-versus-episodic notice policy

**File**: `src/components/StorageNotice.tsx`, new test `src/components/storage-notice-policy.test.ts`

**Intent**: A notice reporting an irreversible loss is erased by the GM's next successful
write, because `superseded` and `record-gone` are missing from `STANDING`. Fix the
classification and pin it.

**Contract**: `isStandingCondition(condition: StorageCondition): boolean`
(`StorageNotice.tsx:128`). `STANDING` is private (`:115`) — the test must probe through the
exported function, never by reading the array.

- **Behavior asserted**: a condition that is still true after a successful write is standing.
- **Oracle**: `StorageNotice.tsx:100-103`, the file's own stated rule — *"a standing
  condition describes something that is still true after a successful write"* — plus the
  PRD guardrail *"zapisany kupiec nigdy nie znika po cichu"*. Not the current membership.
- **Regression caught**: cross-tab correction loss is reported once, then wiped by the next
  edit, because `clearEpisodic` runs on every successful write
  (`MerchantGenerator.tsx:925`, `:1138`, `:1166`, `:1383`).
- **Research item**: 5 and 30 · anchor `StorageNotice.tsx:115-126`.
- **Edge case**: `record-gone` — a subsequent successful save creates a new record but does
  not un-delete the old one, so it is standing by the same rule.
- **Anti-pattern avoided**: asserting the contents of `STANDING`. The test states the rule
  and asks the function; it does not mirror the list.

#### 2. `toStoredCorrections` drops empty entries

**File**: `src/lib/merchant.ts`, test added to `src/lib/merchant.test.ts`

**Intent**: The docblock promises empty entries are dropped; the code only skips falsy, so
`{}` is persisted. Make the code keep its documented promise.

**Contract**: `toStoredCorrections(corrections: UiCorrections): StoredCorrections`
(`merchant.ts:299`). The skip condition is at `:303`; the assignment at `:309`. Mirror the
same gap at `:329` in `fromStoredCorrections`.

- **Behavior asserted**: an entry carrying neither `quantity` nor `priceGp` is absent from
  the result.
- **Oracle**: the docblock at `merchant.ts:296-298`.
- **Regression caught**: F5 — an empty entry inflates `Object.keys(a.corrections).length`
  in `sameStoredWork`, so `openedSavedIdFor` returns `null` for a record that *is* open,
  which stands the FR-006 confirmation guard down.
- **Research item**: 13 · anchor `merchant.ts:296-309`.
- **Edge case**: distinguish `{}` from `{ quantity: undefined }` from an entry that is
  itself `undefined`; assert with `toStrictEqual` so a present-but-undefined key fails.
- **Anti-pattern avoided**: round-tripping through `fromStoredCorrections`. That proves
  self-consistency only. Assert the stored object's keys directly.

#### 3. `openedSavedIdFor` rejects an unsalvaged document

**File**: `src/lib/merchant-session.ts`, test added to `src/lib/merchant-session.test.ts`

**Intent**: `openedSavedIdFor` dereferences `a.rows.length` and
`Object.keys(a.corrections)` without the `isMerchant` guard its sibling applies. Add the
guard so a malformed document yields `null` instead of a `TypeError`.

**Contract**: `openedSavedIdFor(doc: StorageDocument): string | null`
(`merchant-session.ts:391`). The guard pattern to follow is `restoreFromMerchant`'s at
`:93`. `sameStoredWork` (`:366`) is module-private and must not be exported to make this
testable.

- **Behavior asserted**: a document whose transient or saved entries are structurally
  invalid returns `null` and never throws.
- **Oracle**: AGENTS.md:14 — *"throw for a broken invariant, return a discriminated union
  for an expected failure"*. A hand-edited document is an expected failure.
- **Regression caught**: a `TypeError` inside `reopenEvent` inside the mount effect, which
  blanks the only page the product has.
- **Research item**: 18 · anchor `merchant-session.ts:391-413`, `:367`, `:379`.
- **Edge case**: transient present but `rows` absent; `corrections` absent; a malformed
  entry inside `saved` while the transient is well-formed.
- **Anti-pattern avoided**: building the malformed document with the serializer. Use
  hand-written literals cast through `unknown`, matching the existing hostile-fixture
  discipline at `merchant-storage.test.ts:525-541`.

#### 4. A fallback-labelled category is searchable

**File**: `src/lib/merchant-library.ts`, test added to `src/lib/merchant-library.test.ts`

**Intent**: When a category id is unknown to `CATEGORIES`, the label falls back to the raw
id (`przedmioty-magiczne`), and search never collapses the hyphen — so the merchant is
unfindable by typing the words. Normalize separators so display and query agree.

**Contract**: `normalizeForSearch(value: string): string` (`merchant-library.ts:311`) —
treat `-` and `_` as word separators before the existing whitespace collapse at `:322`.
Both sides already route through the same helper (`:288` for display, `:381` for filtering),
so one change fixes both. `matchesQuery` (`:338`) is private and stays private.

- **Behavior asserted**: a merchant saved under an unknown category id is returned by
  `filterMerchants` when the GM types that id's words separated by spaces.
- **Oracle**: FR-012 *"MG może wyszukać zapisanego kupca po nazwie"* and the US-02
  acceptance criterion *"Zapisanego kupca da się odnaleźć po nazwie, gdy lista urośnie"*.
- **Regression caught**: F8 — a saved merchant that exists, displays, and cannot be found.
- **Research item**: 32 · anchor `merchant-library.ts:288`, `:311-325`.
- **Edge case**: query typed with the hyphen still matches; a multi-hyphen id; a query with
  Polish diacritics against a fallback label, exercising both folds at once.
- **Anti-pattern avoided**: asserting `normalizeForSearch`'s output string. That is an
  implementation mirror. Assert findability through `filterMerchants`, which is what FR-012
  actually promises.

#### 5. Correct the runner's scope comment

**File**: `vitest.config.ts`

**Intent**: The comment at `:20-22` says a React file is never pulled into the runner. Phase
1.1 makes that false, and it was always stricter than the real constraint. State what is
actually forbidden — rendering without a DOM — rather than importing.

**Contract**: comment only. `include` and `environment` are unchanged in this phase.

### Success Criteria:

#### Automated Verification:

- Each of the four new tests fails before its fix, for the reason named in its sub-phase
- Full suite passes: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Test count increased from 368 by the number of tests added

#### Manual Verification:

- Reading each new test in isolation, the expected value is traceable to its cited oracle without opening the implementation
- The four fixes did not change any pre-existing assertion

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding.

---

## Phase 2: Pin the contracts that hold

### Overview

Four behaviors the code already gets right and nothing currently guards. These pass on
first run — they exist to catch tomorrow's regression, not today's bug. Still no harness.

### Changes Required:

#### 1. Frozen v1 document fixture

**File**: new `src/lib/merchant-storage.schema-compat.test.ts`

**Intent**: Every existing version fixture is computed as `SCHEMA_VERSION ± 1`, so the day
the constant becomes 2 they all move with it and no pinned v1 document remains. Commit one
that cannot move.

**Contract**: a raw JSON string literal carrying `"schemaVersion":1` and a complete
well-formed merchant, with a banner comment forbidding regeneration. Read through
`readDocument` against a seeded fake; assert `status: "ok"` and that the merchant's fields
survive.

- **Behavior asserted**: the current build reads a document written by a v1 build.
- **Oracle**: AGENTS.md:16 — *"Browser-storage schema changes are forward-only … the
  reverted code must still read it"* — plus the PRD guardrail.
- **Regression caught**: the fixture-drift anti-pattern named in the test plan's own Risk #6
  row, which is already present.
- **Research item**: 22 · anchor `merchant-storage.test.ts:633`, `:650`, `:686`, `:775`, `:796`.
- **Edge case**: the literal must not reference `SCHEMA_VERSION`; a reviewer should be able
  to bump the constant to 2 locally and watch this test still describe v1.
- **Anti-pattern avoided**: generating the fixture from the serializer or the constant.

#### 2. `writeDocument` honours the latch across repeated calls

**File**: test added to `src/lib/merchant-storage.test.ts`

**Intent**: The latch promise is pinned for the first call only; a self-clearing latch still
passes the suite. Pin the second call.

**Contract**: `writeDocument(doc, storage)` (`merchant-storage.ts:520`), latch check at
`:521-523`. Engage the latch, then call `writeDocument` twice **without an intervening
`readDocument`** — an intervening read would re-derive the refusal from `loadForWrite`
(`:554-556`) and prove nothing about the latch.

- **Behavior asserted**: once engaged, the latch refuses every subsequent write.
- **Oracle**: the docblock promise at `merchant-storage.ts:517-518`.
- **Regression caught**: F10 — the mutant that made the check self-clearing survived the
  whole suite.
- **Research item**: 23 · anchor `merchant-storage.ts:517-523`.
- **Edge case**: a second, clean store object passed to the second call — the latch is
  module state and must cross store instances.
- **Anti-pattern avoided**: the intervening read described above.
- **Constraint**: `resetReadOnlyLatch()` in `beforeEach`.

#### 3. `probeWritable` survives a throwing `removeItem`

**File**: `src/lib/storage-fake.test-helper.ts`, test added to `src/lib/merchant-storage.test.ts`

**Intent**: The fake cannot make `removeItem` throw, so one branch of `probeWritable` is
unreachable from any test. Extend the fake, then reach it.

**Contract**: add `throwOnRemove?: KeyRule` to `StorageFakeOptions` (`:34`), mirroring
`throwOn` (`:47`) and throwing a `SecurityError` `DOMException` from `removeItem` (`:102`).

- **Behavior asserted**: a store whose `removeItem` throws is classified unavailable, not
  writable.
- **Oracle**: the probe's documented contract at `merchant-storage.ts:232-250`.
- **Regression caught**: a browser that permits `setItem` but refuses `removeItem` being
  treated as healthy, so failures surface later and less clearly.
- **Research item**: 21 · anchor `storage-fake.test-helper.ts:102-104`.
- **Edge case**: the probe key must not be left behind when the cleanup throws.
- **Anti-pattern avoided**: widening the fake beyond what a real browser can do. The new
  option models a documented browser behavior, not a convenience.

#### 4. Correction types correspond

**File**: test added to `src/lib/merchant.test.ts`

**Intent**: `UiRow`/`StoredRow` correspondence is enforced mechanically; the correction
types claim the same correspondence in prose and have no assertion. Add one.

**Contract**: copy `MutuallyAssignable` (`merchant.test.ts:24`) and `SameKeys` (`:40`) —
they are local to that file and not exported — and apply both to `StoredCorrection` and
`UiCorrection`, following the four-const pattern at `:67-70`.

- **Behavior asserted**: the two correction types have identical keys and are mutually
  assignable.
- **Oracle**: the docblock claim at `merchant.ts:276-283`.
- **Regression caught**: adding a third correctable field compiles everywhere and silently
  never persists, because `toStoredCorrections`/`fromStoredCorrections` carry hardcoded
  field lists (`:306-307`, `:332-333`).
- **Research item**: 19 · anchor `merchant.ts:276-283`, `merchant.test.ts:64-70`.
- **Edge case**: none — this is a compile-time claim.
- **Anti-pattern avoided**: believing `npm test` checks it. It does not
  (`merchant.test.ts:64-65`); only `npm run typecheck` does. The test file must carry that
  warning in a comment, as the existing block does.

### Success Criteria:

#### Automated Verification:

- All four pass on first run without any production change: `npm test`
- Type checking passes: `npm run typecheck`
- Bumping `SCHEMA_VERSION` to 2 locally leaves the frozen fixture describing v1 (revert after)
- Reverting the `writeDocument` latch check to self-clearing fails the new test
- Linting passes: `npm run lint`

#### Manual Verification:

- The frozen fixture carries a regeneration ban that a future contributor will actually see
- The correction-type assertion warning about `npm test` blindness is present

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding.

---

## Phase 3: Test infrastructure

### Overview

Raise the Node floor, install the DOM stack, split the runner into two projects, and wire
coverage. The existing 368 node tests must come through with zero behavioral change.

### Changes Required:

#### 1. Node floor

**File**: `.nvmrc`, `package.json`, `.github/workflows/ci.yml`

**Intent**: `jsdom@30` requires Node `^22.22.2 || ^24.15.0 || >=26`; the repo pins `22.14.0`
and declares `>=22.12.0`. Raise both to the lowest satisfying version on the 22 line, and
make CI follow the pin instead of drifting.

**Contract**: `.nvmrc` → `22.22.2`; `package.json` `engines.node` → `>=22.22.2`;
`ci.yml:15-17` → `node-version-file: .nvmrc` replacing the unpinned `node-version: 22`.

#### 2. Dependencies

**File**: `package.json`

**Intent**: Install the DOM test stack and the coverage provider.

**Contract**: devDependencies — `jsdom@^30.0.1`, `@testing-library/react@^16.3.3`,
`@testing-library/dom@^10.4.2` (a peer of RTL 16, not a transitive dependency, so it must
be explicit), `@testing-library/user-event@^14.6.7`, `@testing-library/jest-dom@^7.0.1`,
`@vitest/coverage-v8@5.0.0` (peer-pinned to the exact vitest version). No
`--legacy-peer-deps`; React 19.2 satisfies RTL 16's peer range.

#### 3. Runner split

**File**: `vitest.config.ts`

**Intent**: Run `.ts` in node and `.tsx` in jsdom without touching a single existing test
file. The globs are naturally disjoint.

**Contract**: `test.projects` with two entries — `node` (`environment: "node"`,
`include: ["src/**/*.test.ts"]`) and `dom` (`environment: "jsdom"`,
`include: ["src/**/*.test.tsx"]`, `globals: true`, `setupFiles`). Both `environment` and
`include` **must be restated in each project**: `extends` defaults to `true` in Vitest 5, so
the root values otherwise leak in. `coverage` stays root-level — it is rejected inside a
project config.

#### 4. DOM setup file

**File**: new `vitest.setup.dom.ts`

**Intent**: Register jest-dom matchers and Testing Library cleanup for the DOM project only.
Auto-cleanup is not automatic — RTL registers it only if a global `afterEach` exists at
import time, and Vitest's `globals` defaults to `false`.

**Contract**: import `@testing-library/jest-dom/vitest`; call `cleanup()` in `afterEach`.
Add a `HTMLDialogElement.prototype.showModal`/`close` stub — jsdom's implementation class is
an empty body — with a comment stating plainly that the stub removes the behavior
(top-layer, focus trap, Escape, inert background), so no future test may claim to cover
modal semantics with it.

#### 5. Coverage

**File**: `vitest.config.ts`

**Intent**: Make the dark surface visible. Untested `.tsx` must report 0%, not vanish.

**Contract**: root-level `coverage` — `provider: "v8"`,
`include: ["src/**/*.{ts,tsx}"]`, `exclude` for test files and `.d.ts`,
`reporter: ["text", "html"]`. No thresholds. `coverage.all` does not exist in Vitest 5;
`coverage.include` is the mechanism that pulls in files no test imports.

#### 6. CI wiring

**File**: `.github/workflows/ci.yml`

**Intent**: Run both projects and emit the coverage summary, keeping typecheck ahead of test.

**Contract**: `npm test` already runs every project; add `--coverage` to the run. Do not
reorder `typecheck` (`:25`) relative to `test` (`:26`) — the Phase 2.4 assertion depends on
it.

#### 7. Smoke render

**File**: new `src/components/StorageNotice.test.tsx`

**Intent**: Prove the harness actually renders a `.tsx` island before any behavior depends
on it. A harness unexercised by a real assertion is usually subtly wrong.

**Contract**: render `StorageNotice` with one known condition; assert a non-empty message is
in the document. Oracle: the component's purpose — a raised condition must reach the user.

### Success Criteria:

#### Automated Verification:

- Node floor consistent: `.nvmrc`, `engines`, and CI all satisfy jsdom's range
- Install completes with no peer warnings: `npm ci`
- The node project still reports exactly the Phase 2 test count: `npm test -- --project node`
- The dom project runs the smoke test: `npm test -- --project dom`
- Coverage reports `src/components/*.tsx` at 0% rather than omitting them: `npm test -- --coverage`
- Type checking passes: `npm run typecheck`
- Linting passes, including the new config and setup files: `npm run lint`

#### Manual Verification:

- A deliberately broken assertion in the smoke test fails the dom project, proving the harness executes
- The dialog stub carries its fidelity warning
- CI log shows both project names

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding.

---

## Phase 4: Risk #1 at the island layer

### Overview

Spend the new harness on the single highest risk: a failed write reported as success. Four
behaviors are asserted; three known defects are quarantined with `it.fails()` and owned by a
follow-up change.

Storage failures are injected by making the ambient store throw — the component calls
`readDocument()`/`putTransient()` with no argument, so there is no seam to pass a fake
through. Spy on `Storage.prototype.setItem`/`getItem` and throw the same `DOMException`
names the real thing uses.

### Changes Required:

#### 1. Every write-failure variant is visible and distinguishable

**File**: new `src/components/MerchantGenerator.test.tsx`

**Intent**: A write that did not happen must not look like one that did, and the GM must be
able to tell one failure from another well enough to act.

**Contract**: for each of the four `WriteFailure` variants
(`MerchantGenerator.tsx:214`), drive a save and assert the rendered notice is non-empty and
textually distinct from the other three.

- **Oracle**: the PRD guardrail, plus the fact that `StorageCondition`
  (`StorageNotice.tsx:31`) models these as separate conditions — conflating them tells the
  GM to take the wrong action.
- **Regression caught**: a failure mode that renders nothing, or renders the same thing as
  an unrelated one.
- **Research item**: 1 · anchor `MerchantGenerator.tsx:223-240`, `:376-401`.
- **Edge case**: `not-found` — **quarantined with `it.fails()`**. It maps to `null`
  (`:238`), so nothing is raised while the assistive text at `:988-998` tells the user to
  read a message that was never rendered.
- **Anti-pattern avoided**: asserting the exact Polish copy from `MESSAGES`
  (`StorageNotice.tsx:59-96`). That is an implementation mirror and breaks on any wording
  change. Asserting *non-empty and mutually distinct* tests the requirement instead.

#### 2. `read-only` surfaces the read-only condition

**File**: `src/components/MerchantGenerator.test.tsx`

**Intent**: A write refused by a latched store currently reports `unavailable`, which tells
the GM storage is missing when it is present but locked.

**Contract**: **quarantined with `it.fails()`** — prior-audit F2. Named expected failure:
the rendered notice matches the `unavailable` copy rather than the read-only copy.

- **Oracle**: the two conditions are distinct members of `StorageCondition`, and the
  recovery action differs.
- **Research item**: 2 · anchor `MerchantGenerator.tsx:376-401`.

#### 3. The Save button never claims success it does not have

**File**: `src/components/MerchantGenerator.test.tsx`

**Intent**: Assert at the rendered layer what the state machine already guarantees
internally — that "Zapisano" appears only downstream of a confirmed `ok`.

**Contract**: drive a failing save; assert the button's rendered text is not the saved
label and the `role="status"` affirmation is empty. This passes today and must keep passing.

- **Oracle**: the PRD guardrail and FR-009.
- **Regression caught**: a future refactor wiring the label to an optimistic local flag
  instead of `session.state`.
- **Research item**: 3 · anchor `MerchantGenerator.tsx:162-164`, `:1676-1678`.
- **Edge case**: quota failure and refused-store failure both checked — different paths to
  the same guarantee.
- **Anti-pattern avoided**: asserting `nextSaveState` again. It is already covered as an
  independent table at `merchant-session.test.ts:275-326`; re-asserting it here would prove
  nothing new about whether the component renders its output.

#### 4. A refused save produces observable feedback

**File**: `src/components/MerchantGenerator.test.tsx`

**Intent**: Pressing Save after a read-only read currently changes nothing in the DOM. An
action the user took must produce feedback.

**Contract**: **quarantined with `it.fails()`** — prior-audit F3. Named expected failure:
the DOM before and after the press is identical.

- **Oracle**: the PRD guardrail — silence after a destructive-looking action is the
  "po cichu" the guardrail forbids.
- **Research item**: 4 · anchor `MerchantGenerator.tsx:986-998`.

#### 5. Quarantine count gate

**File**: new `src/quarantine.test.ts`

**Intent**: `it.fails()` cannot rot, but the *list* can grow. Pin its size so a new
quarantine entry requires a deliberate edit to this number.

**Contract**: scan `src/` for `it.fails(` occurrences; assert the count equals the expected
constant, with a comment listing each entry, its defect, and its owning change.

- **Oracle**: the decision recorded in this plan.
- **Anti-pattern avoided**: a reason-string convention with nothing enforcing it — the L-04
  shape, where a gate exists but covers nothing.

### Success Criteria:

#### Automated Verification:

- Four asserted behaviors pass: `npm test -- --project dom`
- Three quarantined entries pass as `it.fails()`, and each fails for its documented reason
- The quarantine gate passes, and fails when a fourth entry is added
- Coverage for `src/components/MerchantGenerator.tsx` is above 0%
- Full suite, typecheck and lint pass

#### Manual Verification:

- Fixing any one quarantined defect by hand turns its `it.fails()` red, proving the mechanism graduates entries
- The distinguishability assertion survives rewording a message in `StorageNotice.tsx`
- No test asserts a literal Polish string from `MESSAGES`

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding.

---

## Phase 5: Cookbook and backport

### Overview

Write down what shipped, and correct the strategy document that research proved wrong in
four places.

### Changes Required:

#### 1. Cookbook §6.2

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.2 placeholder with the shipped pattern so the next contributor
does not re-derive it.

**Contract**: location (`src/**/*.test.tsx`), the `dom` project and why the split exists,
naming, reference test (`src/components/MerchantGenerator.test.tsx`), run command
(`npm test -- --project dom`), the storage-injection pattern, and the four things jsdom
cannot do honestly. Add a §6.6 note recording the `it.fails()` quarantine convention.

#### 2. Backport the research corrections

**File**: `context/foundation/test-plan.md`

**Intent**: The guide currently over-states Risk #5, has Risk #7's premise wrong, misses
three risks, and carries stale counts.

**Contract**: apply the corrections table in
`context/changes/testing-island-reachability/research.md` — narrow Risk #5, rewrite Risk #7
around focus-indicator contrast, add M-1/M-2/M-3 as new rows appended without renumbering,
correct §4 (`.tsx` is linted with type-aware rules and type-checked; only tests and a11y are
absent; 368 tests; 3 068 dark lines), and reframe the §5 Supabase row as inert with the
gate restated as preserving the env classification. No file anchors enter §2.

#### 3. Lessons

**File**: `context/foundation/lessons.md`

**Intent**: Correct the stale count and record the finding that outlives this phase.

**Contract**: fix `366` → `368` at `:119`. Add **L-06**: a compensating control you never
executed is not a control — ~40 manual criteria across three plans stood in for the entire
island layer and were never run. Link `[[L-04]]` and `[[L-05]]`.

#### 4. Status

**File**: `context/foundation/test-plan.md` §3, `context/changes/testing-island-reachability/change.md`

**Intent**: Flip rollout Phase 1 to `complete` and the change to `implemented`, with the
explicit note that Risk #1 retains three quarantined defects owned by a follow-up change.

### Success Criteria:

#### Automated Verification:

- `test-plan.md` §3 row 1 reads `complete`
- No `file:line` anchor appears anywhere in §2
- Markdown formatting passes: `npm run lint`

#### Manual Verification:

- A fresh reader can add an island test from §6.2 alone, without reading this plan
- The Risk #1 caveat is visible in the guide, not only in this plan
- L-06 reads as a rule, not a postmortem

**Implementation Note**: This is the final phase. After it lands, `/10x-test-plan` selects
rollout Phase 2.

---

## Testing Strategy

### Unit Tests

- Four defect-closing tests (Phase 1), each proven to fail before its fix
- Four contract pins (Phase 2), each proven to fail under a deliberate mutation

### Integration Tests

- Four island behaviors against a throwing ambient store (Phase 4)

### Manual Testing Steps

1. Bump `SCHEMA_VERSION` to 2 locally; confirm the frozen fixture still describes v1; revert.
2. Revert the `writeDocument` latch check to self-clearing; confirm the new test fails; revert.
3. Fix one quarantined defect by hand; confirm its `it.fails()` turns red; revert.
4. Break the smoke test's assertion; confirm the dom project fails; revert.
5. On a machine pinned to Node 22.14.0, confirm `npm ci` fails with a clear engines error.

## Migration Notes

The Node floor bump is the only change affecting contributors. Anyone on the old `.nvmrc`
must `nvm install` before `npm ci`; the failure mode is an engines error at install, not a
runtime surprise. No storage schema change, so the forward-only rule is not engaged.

## References

- Research: `context/changes/testing-island-reachability/research.md`
- Strategy: `context/foundation/test-plan.md` §2, §3
- Prior audit: `context/changes/storage-layer-consistency-audit/research.md` (F5–F10)
- Isolation constraint: `context/changes/merchant-storage-contract/plan.md:441-446`
- Harness cost question: `context/changes/generator-island-decomposition/research.md:226-228`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Close the cheap defects

#### Automated

- [x] 1.1 Each of the four new tests fails before its fix, for the reason named in its sub-phase — 157f5b4
- [x] 1.2 Full suite passes: `npm test` — 157f5b4
- [x] 1.3 Type checking passes: `npm run typecheck` — 157f5b4
- [x] 1.4 Linting passes: `npm run lint` — 157f5b4
- [x] 1.5 Test count increased from 368 by the number of tests added — 157f5b4

#### Manual

- [ ] 1.6 Each new test's expected value is traceable to its cited oracle without opening the implementation
- [ ] 1.7 The four fixes did not change any pre-existing assertion

### Phase 2: Pin the contracts that hold

#### Automated

- [x] 2.1 All four pass on first run without any production change: `npm test` — c56e83c
- [x] 2.2 Type checking passes: `npm run typecheck` — c56e83c
- [x] 2.3 Bumping `SCHEMA_VERSION` to 2 locally leaves the frozen fixture describing v1 — c56e83c
- [x] 2.4 Reverting the `writeDocument` latch check to self-clearing fails the new test — c56e83c
- [x] 2.5 Linting passes: `npm run lint` — c56e83c

#### Manual

- [ ] 2.6 The frozen fixture carries a regeneration ban a future contributor will see
- [ ] 2.7 The correction-type assertion warns that `npm test` cannot check it

### Phase 3: Test infrastructure

#### Automated

- [x] 3.1 Node floor consistent across `.nvmrc`, `engines`, and CI
- [x] 3.2 Install completes with no peer warnings: `npm ci`
- [x] 3.3 Node project reports exactly the Phase 2 test count: `npm test -- --project node`
- [x] 3.4 Dom project runs the smoke test: `npm test -- --project dom`
- [x] 3.5 Coverage reports `src/components/*.tsx` at 0% rather than omitting them
- [x] 3.6 Type checking passes: `npm run typecheck`
- [x] 3.7 Linting passes, including the new config and setup files: `npm run lint`

#### Manual

- [ ] 3.8 A deliberately broken smoke assertion fails the dom project
- [ ] 3.9 The dialog stub carries its fidelity warning
- [ ] 3.10 CI log shows both project names

### Phase 4: Risk #1 at the island layer

#### Automated

- [ ] 4.1 Four asserted behaviors pass: `npm test -- --project dom`
- [ ] 4.2 Three quarantined entries pass as `it.fails()`, each failing for its documented reason
- [ ] 4.3 The quarantine gate passes, and fails when a fourth entry is added
- [ ] 4.4 Coverage for `src/components/MerchantGenerator.tsx` is above 0%
- [ ] 4.5 Full suite, typecheck and lint pass

#### Manual

- [ ] 4.6 Fixing a quarantined defect by hand turns its `it.fails()` red
- [ ] 4.7 The distinguishability assertion survives rewording a message in `StorageNotice.tsx`
- [ ] 4.8 No test asserts a literal Polish string from `MESSAGES`

### Phase 5: Cookbook and backport

#### Automated

- [ ] 5.1 `test-plan.md` §3 row 1 reads `complete`
- [ ] 5.2 No `file:line` anchor appears anywhere in §2
- [ ] 5.3 Markdown formatting passes: `npm run lint`

#### Manual

- [ ] 5.4 A fresh reader can add an island test from §6.2 alone
- [ ] 5.5 The Risk #1 caveat is visible in the guide, not only in this plan
- [ ] 5.6 L-06 reads as a rule, not a postmortem
