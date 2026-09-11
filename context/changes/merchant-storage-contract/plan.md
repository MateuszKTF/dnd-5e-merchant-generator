# Kontrakt encji kupca i trwałości w przeglądarce — Implementation Plan

## Overview

Deliver roadmap foundation **F-01**: the merchant entity shape and a versioned browser-storage
read/write contract, with explicitly defined behaviour when storage is unavailable, full, or
holds data a rolled-back build cannot read. Nothing in this slice is visible to the GM.

It exists ahead of S-03 rather than inside it for one reason: `AGENTS.md` makes this format
**forward-only**. A Worker rollback reverts the script and the static assets but not a GM's
`localStorage`, so any device that ever loaded a newer format keeps it, and the reverted code
must still cope. The moment one real merchant exists on one real device, a mistake in the shape
stops being cheap. S-03, S-04 and S-05 all read and write the same record, so the cost of being
wrong is paid three times over.

This slice also settles the PRD's heaviest named guardrail in code — *"zapisany kupiec nigdy nie
znika po cichu"* — by making every failure path either loud or non-destructive.

## Current State Analysis

**Browser persistence is entirely absent, and so is the merchant type.**

- Zero references to `localStorage`, `sessionStorage` or `indexedDB` anywhere in `src/`.
- No merchant type exists. The only mention is a comment: `src/env.d.ts:2-3` records that saved
  merchants live in browser storage on the GM's device, and that `App.Locals` is deliberately
  un-augmented because v1 has no server session.
- `src/lib/` contains only `utils.ts` (`cn`).
- **S-01 and S-02 are planned but not implemented** — no `assortment.ts`, no island, no Vitest.

**What this slice can build on:**

- `src/data/items.ts:6-13` exports `CategoryId` and `Wealth`. These are the only existing types
  F-01 needs, and both are stable.
- `AGENTS.md:42` names `merchant-storage.ts` as its own worked example of `src/lib/` kebab-case
  naming — the file name is effectively prescribed.

**Constraints discovered:**

- **Forward-only storage** (`AGENTS.md:15`) is the governing constraint. The read path must
  tolerate a document written by a *newer* build, and must never degrade it.
- **Astro prerenders every page** (`AGENTS.md` hard rule). The module is imported during a
  build that runs in Node/workerd where `window` does not exist, so nothing may touch
  `localStorage` at module-evaluation time.
- **No server storage exists or is permitted.** PRD Access Control: single user, no auth, data
  never leaves the device. `AGENTS.md` forbids reintroducing an auth layer or an API route to
  solve a v1 problem.
- **Vitest arrives with S-01 Phase 1.** The roadmap runs F-01 and S-01 in parallel with no
  dependency, which holds for the code — but the test runner is shared, and whichever slice
  starts first owns its setup.
- **The S-01 test glob is `src/**/*.test.ts` with no jsdom**, which is why the storage
  dependency is injected rather than referenced globally.
- **Line endings are normalized by S-01 Phase 1** (`.gitattributes`, `* text=auto eol=lf`), which
  turns `npm run lint` into a real gate. F-01 and S-01 run in parallel, so **whichever starts
  first must land that file** — until it does, lint reports ~1000 `Delete ␍` errors and zero
  real ones (`AGENTS.md`).

### Key Discoveries:

- **FR-009's rationale constrains the shape more than its text does.** The PRD's Socrates note
  says explicit save closes the guardrail *"bez zaśmiecania listy jednorazówkami"* — so the
  auto-persisted last merchant must **not** appear in the saved list. That forces two states:
  a transient slot and a durable collection.
- **There is an aliasing hazard in the obvious design.** If explicit save merely flags the
  transient record as durable, the next Generate overwrites that same slot and destroys a
  merchant the GM explicitly saved — precisely the guardrail violation this slice exists to
  prevent, and invisible until someone saves and then rerolls. Promoting a **copy** into the
  collection removes the hazard structurally rather than by discipline.
- **Storing only `itemId` would make saved merchants hostage to catalog regeneration.**
  `src/data/items.ts:17` promises ids are stable, but `npm run data:build` can *drop* items —
  `scripts/build-item-catalog.mjs` filters Legendary and Artifact, `Varies` parents, and
  unpriced entries. A saved row referencing a dropped id would fail to render, which is a row
  silently vanishing from a saved merchant.
- **Size is not a constraint.** A 25-row merchant is roughly 3.5 KB of JSON even fully
  denormalized; `localStorage`'s ~5 MB origin quota holds well over a thousand. A campaign
  produces dozens. Denormalizing for safety is free here.
- **The storage key must not carry the schema version.** A versioned key means a version bump
  orphans the previous document instead of upgrading it — the reader would not find the data it
  is supposed to migrate.
- **Storage availability must be probed by attempting a write.** Safari private mode exposes
  `localStorage` and throws on `setItem`, so `typeof localStorage !== "undefined"` proves
  nothing.

## Desired End State

A single module owns the merchant format. It reads a versioned document out of one
`localStorage` key and returns a typed result that names exactly what happened: data, empty,
storage unavailable, a document from a newer build, a corrupt payload that was moved aside, or
one that could not even be moved aside and was therefore left untouched.
Writes return the same kind of typed outcome, including quota exhaustion.

The transient last-merchant slot and the durable saved collection are separate, so a reroll can
never touch a saved shop. Every saved row is a self-contained snapshot that renders identically
years later regardless of what the catalog does. Manual corrections persist alongside the
generated values rather than flattened over them, so a reload can still show the GM which cells
they changed.

Nothing is ever deleted without an explicit GM action. Corrupt data is quarantined — and if the
quarantine copy itself cannot be written, the corrupt bytes are left alone rather than
discarded. A document from a newer build is left strictly untouched.

**Verification:** `npm test` exercises every read and write outcome against in-memory fakes,
including throwing ones; `npx astro check` and `npm run build` pass; the build proves nothing
touches `window` at import time.

## What We're NOT Doing

- **No UI of any kind.** The roadmap is explicit: "bez interfejsu i bez listy zapisanych". The
  storage-unavailable banner is *reported* by this contract as a typed status and *rendered* by
  S-03. F-01 ships no component, no hook, no banner.
- **No auto-persistence behaviour.** *When* to write — on generate, on correction, debounced —
  is S-03's decision. This slice provides the write, not the policy.
- **No saved-merchant list, rename, search or delete UI** — S-04 and S-05. This slice ships the
  *complete* storage API those slices call — including `renameMerchant`, `updateSavedMerchant`
  and `deleteMerchant`, none of which has a caller yet — so that F-01 remains the single owning
  slice for the persisted format. A later slice editing this module would make "F-01 owns the
  storage contract" false the moment it ran.
- **No migration runner.** The version field and skew detection ship; a documented seam marks
  where the first v1→v2 step will go. Building a migration framework with zero migrations means
  guessing at the shape it must support.
- **No export/import.** PRD Open Question #3 parks cross-device access as a v2 candidate.
- **No server-side storage, no Supabase, no API route.** PRD Access Control and an `AGENTS.md`
  hard rule both forbid it.
- **No eviction, no cap, no cleanup of quarantined payloads.** The guardrail permits deletion
  only by explicit GM action.
- **No changes to the catalog, the generator, or any S-01/S-02 file.** This slice declares its
  own storage types rather than importing `AssortmentRow`.
- **No jsdom, no widening of the Vitest glob.**

## Implementation Approach

Three phases: the entity, the happy path, then the failure modes — which are the risky half and
get their own verification gate.

**Storage types are declared here and owned here.** They are deliberately *not* `AssortmentRow`
re-exported. S-01 and S-02 are free to evolve their UI types; the persisted format must not move
when they do. A small mapper converts between them, and that mapper is the only place the two
vocabularies meet. This costs a few lines and is the entire point of a forward-only contract.

**Every operation returns a discriminated union, never a bare value or a thrown error.** The
read result is the contract S-03 consumes to decide what to render, which is how F-01 satisfies
"explicitly defined behaviour when storage is unavailable or full" while shipping no UI. Throwing
would push `try`/`catch` into three downstream slices and make the failure modes easy to ignore.

**The storage object is a parameter, not a global.** That is what makes quota exhaustion,
corruption and version skew ordinary unit tests instead of manual browser theatre — and those
three paths are the justification for the whole slice.

## Critical Implementation Details

**Timing & lifecycle — nothing may touch `window` at module scope.** Every page is prerendered,
so this module is imported during a build running in Node/workerd. The default storage must be
resolved *inside* each function, not as a module-level constant or a default parameter value
evaluated at import. Getting this wrong breaks `npm run build`, not runtime.

**State sequencing — the read-only latch must outlive the failing call.** Once a newer-schema
document is detected, writes must be refused for the remainder of the page load; otherwise the
next write overwrites exactly the data the detection was protecting. A module-level flag is the
right scope — per page load, reset on reload, deliberately not persisted.

**Promote-on-save must copy, not alias.** The saved record takes a fresh id and a
deep-independent copy of the rows. If it shares a reference with the transient slot, the next
Generate mutates a saved merchant. The whole point of choosing promote-a-copy over
flag-in-place was to remove this hazard structurally, and a shallow copy reintroduces it.

**Availability is probed by writing, never by feature detection.** Attempt a
`setItem`/`removeItem` of a throwaway key inside `try`/`catch`. Safari private mode exposes the
object and throws only on write, so any check short of an actual write reports storage as
available and then loses data.

**Distinguishing quota exhaustion from a disabled store matters** because they produce different
GM-facing messages in S-03. Both surface as a thrown `DOMException` on write; the name
(`QuotaExceededError`, and WebKit's legacy variant) is the only signal, and a write that fails
on a throwaway key but would have succeeded on real data is a disabled store, not a full one.

## Phase 1: Entity and naming

### Overview

Define the merchant entity as storage-owned types, plus id generation and the auto-name rule.
Pure and fully testable. No storage access in this phase.

### Changes Required:

#### 1. Merchant entity

**File**: `src/lib/merchant.ts` (new)

**Intent**: The canonical shape of a merchant as it is persisted, owned by the storage layer so
that S-01 and S-02 can evolve their UI types without moving the stored format.

**Contract**:

- `StoredRow` — `{ itemId: string; name: string; rarity: Rarity; quantity: number; priceGp: number }`.
  A self-contained snapshot: `name` and `rarity` are denormalized deliberately so a saved
  merchant renders identically even if `npm run data:build` later drops that item.
- `StoredCorrection` — `{ quantity?: number; priceGp?: number }`, and
  `StoredCorrections` — `Record<string, StoredCorrection>` keyed by `itemId`. Corrections are
  preserved *alongside* generated values, not flattened into them, so a reload can still mark
  which cells the GM changed (US-02 asserts corrections survive a save).
- `Merchant` —
  `{ id: string; name: string; category: CategoryId; wealth: Wealth; createdAt: string; savedAt: string | null; rows: StoredRow[]; corrections: StoredCorrections }`.
  Timestamps are ISO 8601 strings, not `Date`, because the document round-trips through JSON.
  `savedAt` is `null` for the transient record and set on promotion — it is the durable marker,
  so no separate boolean is needed.
- `newMerchantId(): string` — `crypto.randomUUID()`, called lazily so nothing runs at import.
- `autoName(category: CategoryId, when: Date): string` — FR-010's auto-name, built from the
  category's Polish label (`CATEGORIES` in `src/data/items.ts:25-30`) plus date **and time**.
  Time is included because FR-011 requires the GM to recognise a merchant by name and FR-012
  searches by it; three smiths saved in one session is the normal case at a table, and
  date-only names would collide.
- `toStoredRows(rows) / fromStoredRows(rows)` — the **only** place the storage vocabulary meets
  the UI's `AssortmentRow`. Typed structurally so this module needs no import from S-01.

  **The split must be enforced, not merely asserted.** `StoredRow` and `AssortmentRow` are
  identical today, so the mappers are effectively identity functions and a round-trip test
  proves nothing about the correspondence. If S-01 later adds a field to `AssortmentRow`, an
  identity mapper drops it on save and no test fails — silent data loss dressed as decoupling.
  The entity tests must therefore carry a **compile-time assertion** that the two types are
  mutually assignable (a `satisfies`/conditional-type check in the test file, which *may* import
  `AssortmentRow` — tests are allowed the dependency the module is not). A future divergence then
  becomes a type error at the moment it is introduced, and whoever introduces it has to decide
  consciously whether the new field belongs in storage.

#### 2. Entity tests

**File**: `src/lib/merchant.test.ts` (new)

**Intent**: Lock the auto-name format and the round-trip mapping, both of which downstream
slices will depend on.

**Contract**: `autoName` produces a stable, readable Polish string for each of the four
categories and includes enough precision to distinguish two saves minutes apart; two saves of
the same category in the same minute are asserted to collide, documenting the known limit rather
than pretending it does not exist. `toStoredRows`/`fromStoredRows` round-trip without loss, and a
compile-time assertion pins `StoredRow` and `AssortmentRow` as mutually assignable so a future
divergence is a type error rather than a silent dropped field.
`newMerchantId` returns distinct values across calls.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Reading `merchant.ts` alone makes clear which fields are persisted and why `name` and
  `rarity` are denormalized
- A sample auto-name reads well in a narrow list and is recognisable as a specific shop

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 2: Happy-path storage contract

### Overview

The versioned document, the transient/durable split, and the read/write/promote/delete
operations against an injectable storage. Failure modes come in Phase 3; this phase assumes a
working store.

### Changes Required:

#### 1. Storage document and operations

**File**: `src/lib/merchant-storage.ts` (new)

**Intent**: One module owning the persisted document — its version, its layout, and every
operation over it. The file name follows `AGENTS.md:42`, which uses it as its own naming example.

**Contract**:

- `STORAGE_KEY` — `"dnd-merchant-generator"`. One stable, namespaced key. It must **not** contain the schema version: a
  versioned key orphans the previous document instead of upgrading it.
- `SCHEMA_VERSION = 1`.
- `StorageDocument` — `{ schemaVersion: number; transient: Merchant | null; saved: Merchant[] }`.
  A single document under a single key so **every write is atomic**: one `setItem` either lands
  whole or not at all, which is what makes an orphaned or half-written record impossible.
- `StorageLike` — the minimal injectable surface, `{ getItem; setItem; removeItem }`. Every
  operation takes it as an optional last parameter, resolved to `window.localStorage`
  **inside** the function (see Critical Implementation Details).
- `readDocument(storage?)` — returns a discriminated union:
  `{ status: "ok"; doc }` | `{ status: "empty" }`. Phase 3 adds `"unavailable"`,
  `"future-version"` and `"quarantined"` to the same union; declare the type as extensible from
  the start so downstream `switch` statements do not need rewriting.
- `writeDocument(doc, storage?)` — `{ status: "ok" }`, with Phase 3's failure members added to
  the union.
- `putTransient(merchant, storage?)` — replaces the transient slot, leaving `saved` untouched.
  This is what S-03 calls on every generate.
- `promoteTransient(storage?)` — FR-009's explicit save. Copies the transient record into
  `saved` with a **fresh id**, a `savedAt` timestamp, and a deep-independent copy of `rows` and
  `corrections`. The transient slot is left in place. This is the structural fix for the
  aliasing hazard: a subsequent `putTransient` physically cannot reach the saved record.
- `renameMerchant(id, name, storage?)` — FR-010's rename, for S-04.
- `updateSavedMerchant(id, patch, storage?)` — replaces a saved record's `rows`, `corrections`
  and `savedAt`, for S-04's save-in-place. It must **not** touch `id`, `createdAt` or `name` —
  `renameMerchant` owns the name, and the identity fields are what make it the same merchant.
  An unknown id is a no-op returning a not-found status rather than an append, so a stale id
  from a deleted record cannot resurrect it.
- `deleteMerchant(id, storage?)` — FR-013's delete, for S-05. The **only** operation that
  removes a saved merchant, which is what makes "never disappears without an explicit action"
  true by construction.
- `listSaved(storage?)` — the durable collection only. The transient record is never included;
  FR-009's rationale requires the saved list not to fill with one-offs.

No cap and no eviction anywhere: the guardrail permits removal only by explicit GM action.

#### 2. In-memory storage fake

**File**: `src/lib/storage-fake.test-helper.ts` (new)

**Intent**: A `StorageLike` implementation for tests, including variants that throw, so Phase 3's
failure paths become ordinary unit tests rather than manual browser work.

**Contract**: A factory returning a `StorageLike` backed by a `Map`, with options to throw on
`setItem` (simulating a disabled store) and to throw a `QuotaExceededError`-named
`DOMException` (simulating a full one). Exported from `src/lib/` rather than a test folder so
the `src/**/*.test.ts` glob and the `@/*` alias both reach it without configuration changes.

#### 3. Happy-path tests

**File**: `src/lib/merchant-storage.test.ts` (new)

**Intent**: Prove the transient/durable split holds and that promotion cannot be undone by a
later generate — the aliasing hazard, asserted rather than assumed.

**Contract**: A first read of an empty store returns `empty`, not an error. `putTransient`
round-trips. **Promote, then `putTransient` again, then assert the saved record is byte-identical**
— the single most important test in this slice. Promotion assigns a new id and a `savedAt`.
`listSaved` never contains the transient record. `renameMerchant` changes only the name.
`updateSavedMerchant` replaces the rows and corrections of exactly one record, leaves `id`,
`createdAt` and `name` untouched, leaves every other record byte-identical, and returns
not-found for an unknown id **without appending**. `deleteMerchant` removes exactly one record
and leaves the rest intact. A write followed by a fresh read reconstructs the same document.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build` — proves nothing touches `window` at import time
- Linting passes: `npm run lint`

#### Manual Verification:

- In a browser console, a write followed by a reload and read returns the same merchant
- The stored JSON is legible when inspected in devtools, and its version field is present
- Promoting and then generating again visibly leaves the saved record untouched in devtools

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 3: Failure modes

### Overview

The half of this slice that justifies its existence: what happens when storage is disabled,
full, corrupt, or holds a document from a build newer than the running code. Each becomes a
typed result S-03 can render.

### Changes Required:

#### 1. Availability and quota

**File**: `src/lib/merchant-storage.ts` (modify)

**Intent**: Detect a store that cannot be written to, and distinguish "disabled" from "full",
because the two produce different GM-facing messages in S-03.

**Contract**: Add `{ status: "unavailable" }` to the read union and
`{ status: "unavailable" }` / `{ status: "quota-exceeded" }` to the write union. Probe by
attempting a `setItem`/`removeItem` of a throwaway key inside `try`/`catch` — never by feature
detection, since Safari private mode exposes the object and throws only on write. On a failed
real write, inspect the `DOMException` name (`QuotaExceededError` plus WebKit's legacy variant)
to choose between the two statuses.

The app must remain fully usable: a failed write is reported, never thrown, and never blocks
generation. The GM keeps working in memory with a persistent banner from S-03.

#### 2. Corrupt payload quarantine

**File**: `src/lib/merchant-storage.ts` (modify)

**Intent**: A present-but-unparseable document must not be discarded — the guardrail forbids
losing merchant data, and corruption may be partial and recoverable by hand.

**Contract**: Add `{ status: "quarantined" }` and `{ status: "unreadable" }` to the read union.
On a parse failure or a structurally invalid document, copy the raw string to a timestamped side
key `"dnd-merchant-generator:corrupt:<ISO timestamp>"`, **and only if that copy succeeds** replace the main key with a
fresh document. Quarantined payloads are **never** reclaimed automatically — consistent with
never evicting — and that accumulation is a documented, accepted cost.

**The destructive step is conditional on the preserving step.** If the quarantine write throws —
which is likelier than an ordinary write failing, because it is a second full copy of the payload
and a full store is exactly the condition change 1 detects — then nothing is overwritten. The
read returns `unreadable`, the read-only latch from change 3 engages for the page load, and the
corrupt bytes stay exactly where they are. Proceeding to "start a fresh document" after a failed
copy would destroy recoverable data in the one scenario this whole slice exists to survive.

`unreadable` is therefore the quota-plus-corruption case: the GM has data, it cannot be read, and
it has not been touched. S-03 renders it like the other read failures.

Validation must be structural, not just `JSON.parse` succeeding: a document missing
`schemaVersion` or with a non-array `saved` is corrupt even though it parses.

#### 3. Newer-schema detection and read-only latch

**File**: `src/lib/merchant-storage.ts` (modify)

**Intent**: Handle the exact scenario `AGENTS.md:15` names — a Worker rollback leaving a device
holding a document written by a newer build.

**Contract**: Add `{ status: "future-version"; found: number }` to the read union and
`{ status: "read-only" }` to the write union. A `schemaVersion` above `SCHEMA_VERSION` must
leave the document **strictly untouched** — no rewrite, no field-stripping, no quarantine — and
latch a module-level flag that refuses every write for the remainder of the page load.

The latch's scope is one page load, reset on reload, and deliberately not persisted. Without it,
the very next write would overwrite the data the detection exists to protect.

**The latch needs an explicit reset for tests.** Vitest isolates module state per *file*, not per
test, and Phase 3 adds the version-skew tests to the same file Phase 2 created — so the first
test that latches would refuse every write in every test after it, and the suite would silently
become order-dependent. Export a `resetReadOnlyLatch()` (or key the flag to the injected storage
object rather than the module) and call it from a `beforeEach`. Nothing in the app ever calls it;
it exists so the failure-path tests stay independent.

A `schemaVersion` *below* `SCHEMA_VERSION` is where a future migration will run. For v1 there is
no lower version to migrate from, so this phase ships the branch as a single documented seam
with an explicit comment naming it as the insertion point — no runner, no registry.

#### 4. Failure-mode tests

**File**: `src/lib/merchant-storage.test.ts` (modify)

**Intent**: Cover the three paths that cannot be exercised by hand without deliberately
breaking a browser.

**Contract**: Using the throwing fakes — a store that throws on write reads as `unavailable` and
writes as `unavailable`; a `QuotaExceededError` write reads as `quota-exceeded` and leaves the
prior document intact. Using a fake pre-seeded with garbage — the read returns `quarantined`,
the side key holds the original bytes verbatim, and the main key holds a valid fresh document.
A fake that throws only on the quarantine key → the read returns `unreadable`, **the main key is
byte-for-byte unchanged**, and every subsequent write is refused. Pre-seeded with `schemaVersion: SCHEMA_VERSION + 1` — the read returns `future-version` with the
found number, **the stored bytes are unchanged**, and every subsequent write returns `read-only`
while still leaving the bytes unchanged. A document that parses but is structurally invalid is
treated as corrupt, not as empty.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including all failure paths: `npm test`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- With site data blocked in browser settings, a read reports `unavailable` and the module does
  not throw
- With a hand-edited garbage value in the key, a read reports `quarantined`, the side key holds
  the original string, and the main key holds a valid document
- With a hand-edited higher `schemaVersion`, a read reports `future-version`, the stored value is
  byte-for-byte unchanged afterwards, and a subsequent write leaves it unchanged
- With a full store and a hand-corrupted document, the read reports `unreadable` and the main
  key is byte-for-byte unchanged afterwards
- The read union's members are exhaustive enough that S-03 can `switch` on them without a
  fallback case

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- `autoName` across all four categories; two saves minutes apart differ; two in the same minute
  collide (documenting the known limit)
- `toStoredRows` / `fromStoredRows` round-trip without loss; compile-time assertion that
  `StoredRow` and `AssortmentRow` stay mutually assignable
- **Promote then re-put the transient, then assert the saved record is unchanged** — the
  aliasing hazard
- `listSaved` never returns the transient record
- `renameMerchant` touches only the name; `deleteMerchant` removes exactly one record
- Empty store reads as `empty`, not as an error
- Throwing fake → `unavailable` on both read and write
- `QuotaExceededError` fake → `quota-exceeded`, prior document intact
- Garbage payload → `quarantined`, side key holds original bytes, main key valid
- Parses-but-invalid document → corrupt, not empty
- `schemaVersion + 1` → `future-version`, bytes unchanged, subsequent writes `read-only` and
  still non-destructive

### Integration Tests:

None. There is no UI in this slice and no jsdom in the harness. Cross-slice behaviour — close
the tab, reopen, merchant returns — is S-03's verification path, which this contract exists to
make possible.

### Manual Testing Steps:

1. `npm run build` and confirm it succeeds — this is the real check that nothing touches
   `window` at import time
2. `npx wrangler dev`, then in the console write a merchant, reload, read it back
3. Inspect the stored JSON in devtools: version field present, transient and saved separate
4. Promote a merchant, write a new transient, confirm in devtools the saved copy is untouched
5. Block site data in browser settings, reload, confirm reads report `unavailable` without
   throwing
6. Replace the stored value with garbage, reload, confirm quarantine to the side key and a valid
   fresh main document
7. Raise the stored `schemaVersion` by hand, reload, confirm `future-version` and that the bytes
   are unchanged afterwards; attempt a write and confirm the bytes are *still* unchanged
8. Delete a saved merchant and confirm the others survive

## Performance Considerations

A full document with dozens of merchants is a few hundred kilobytes of JSON; parse and
stringify are sub-millisecond. `localStorage` is synchronous and blocks the main thread, which
is the accepted cost of the layout chosen for atomicity.

The single-key layout means every save rewrites the whole document, so write cost grows with the
collection. That is immaterial at v1 scale and is the explicit trade for atomic writes — but it
is the real ceiling on this design, and the reason to revisit the layout is collection size, not
record size.

Nothing here is on the path of the PRD's 5-second criterion, which concerns generation.

## Migration Notes

**This slice defines the format that `AGENTS.md` makes forward-only.** Everything downstream
inherits its consequences:

- The key is version-free and stable, so a future version can find and upgrade the document.
- `schemaVersion` is written on every save and checked on every read.
- The below-version branch is the documented seam for the first migration. When a schema change
  ships, the migration must be written *before* it, per `AGENTS.md:15`.
- The above-version branch is what makes a Worker rollback survivable: a reverted build reads a
  newer document, refuses to write, and tells the GM — instead of silently stripping fields a
  newer version added.
- Quarantined payloads accumulate and are never auto-reclaimed. A future cleanup must be an
  explicit GM action, not a background sweep.

Nothing to migrate *from* — this is the first format. There is no existing data on any device,
so Phase 3's below-version branch has no live case in v1.

## References

- Roadmap item: `context/foundation/roadmap.md:125-148` (F-01), backlog row at line 258
- Change identity: `context/changes/merchant-storage-contract/change.md`
- PRD: `context/foundation/prd.md` — FR-009 with its Socrates rationale (the
  transient/durable split), FR-010 – FR-013, `## Access Control`,
  `## Success Criteria / Guardrails`, Open Question #3 (cross-device, parked to v2)
- **Forward-only storage rule**: `AGENTS.md:15`; `src/lib/` naming example: `AGENTS.md:42`
- Existing types this slice consumes: `src/data/items.ts:6-13` (`CategoryId`, `Wealth`),
  `src/data/items.ts:25-30` (`CATEGORIES` labels for auto-naming)
- Catalog regeneration behaviour that motivates self-contained rows:
  `scripts/build-item-catalog.mjs`, `src/data/ATTRIBUTION.md` § Changes made
- Downstream consumers: `context/changes/first-generated-assortment/plan.md` (`AssortmentRow`),
  `context/changes/manual-item-corrections/plan.md` (`CorrectionMap`) — this slice deliberately
  mirrors their shapes rather than importing them
- Rollback mechanics: `context/deployment/deploy-plan.md`
- `docs/reference/contract-surfaces.md` is referenced by `CLAUDE.md` but does not exist in the
  repo; the load-bearing names defined here are not registered anywhere yet

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Entity and naming

#### Automated

- [x] 1.1 Unit tests pass: `npm test`
- [x] 1.2 Type checking passes: `npx astro check`
- [x] 1.3 Production build succeeds: `npm run build`
- [x] 1.4 Linting passes: `npm run lint`

#### Manual

- [ ] 1.5 `merchant.ts` makes clear which fields persist and why name and rarity are denormalized
- [ ] 1.6 A sample auto-name reads well in a narrow list and identifies a specific shop

### Phase 2: Happy-path storage contract

#### Automated

- [ ] 2.1 Unit tests pass: `npm test`
- [ ] 2.2 Type checking passes: `npx astro check`
- [ ] 2.3 Production build succeeds (proves no `window` access at import): `npm run build`
- [ ] 2.4 Linting passes: `npm run lint`

#### Manual

- [ ] 2.5 Write, reload, read returns the same merchant in a browser
- [ ] 2.6 Stored JSON legible in devtools with its version field present
- [ ] 2.7 Promote then generate again leaves the saved record untouched in devtools

### Phase 3: Failure modes

#### Automated

- [ ] 3.1 Unit tests pass including all failure paths: `npm test`
- [ ] 3.2 Type checking passes: `npx astro check`
- [ ] 3.3 Production build succeeds: `npm run build`
- [ ] 3.4 Linting passes: `npm run lint`

#### Manual

- [ ] 3.5 Site data blocked: read reports `unavailable` and nothing throws
- [ ] 3.6 Garbage payload: `quarantined`, side key holds original bytes, main key valid
- [ ] 3.7 Higher `schemaVersion`: `future-version`, stored bytes unchanged, writes still non-destructive
- [ ] 3.8 Full store + corrupt document: `unreadable`, main key unchanged
- [ ] 3.9 Read union exhaustive enough for S-03 to `switch` without a fallback case
