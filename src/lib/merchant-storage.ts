/**
 * The browser-storage contract: one versioned document, one key, every
 * operation returning a typed outcome.
 *
 * Nothing here throws. Every read and every write answers with a discriminated
 * union naming exactly what happened, because the alternative pushes
 * `try`/`catch` into S-03, S-04 and S-05 and makes the failure modes easy to
 * ignore — and "zapisany kupiec nigdy nie znika po cichu" is the PRD's heaviest
 * guardrail.
 *
 * The storage object is a parameter, not a global. That is what turns quota
 * exhaustion, corruption and version skew into ordinary unit tests instead of
 * manual browser theatre. It is also why the default must be resolved *inside*
 * each function: every page is prerendered, so this module is imported during a
 * build running in Node/workerd where `localStorage` does not exist. A
 * module-level constant — or a default parameter value, which is evaluated at
 * call time but reads at module scope if written as `= localStorage` — would
 * break `npm run build`, not runtime.
 */

import type { Merchant, StoredCorrections, StoredRow } from "./merchant";
import { isMerchant, newMerchantId } from "./merchant";

/**
 * The single key the whole document lives under.
 *
 * It deliberately carries no schema version: a versioned key would orphan the
 * previous document on every bump instead of upgrading it, leaving the reader
 * unable to find the data it is supposed to migrate.
 */
export const STORAGE_KEY = "dnd-merchant-generator";

/** Bumping this requires a migration first — the format is forward-only (AGENTS.md). */
export const SCHEMA_VERSION = 1;

/**
 * Everything, under one key.
 *
 * One key means every write is a single `setItem` that either lands whole or
 * not at all, so a half-written merchant or an orphaned saved record is not a
 * state this format can reach. The cost is that each save rewrites the whole
 * document; at v1 scale (dozens of merchants, a few hundred KB) that is
 * immaterial, and collection size — not record size — is what would eventually
 * force a different layout.
 *
 * `transient` and `saved` are separate on purpose. The last generated merchant
 * persists automatically (FR-009), but FR-009's rationale is explicit that this
 * must happen *"bez zaśmiecania listy jednorazówkami"* — so the auto-persisted
 * record must not appear in the saved list, and a reroll must not be able to
 * touch a merchant the GM explicitly saved.
 */
export interface StorageDocument {
  schemaVersion: number;
  transient: Merchant | null;
  saved: Merchant[];
}

/** The minimal slice of `Storage` this module uses, so tests can supply their own. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * What a read found. Exhaustive: S-03 can `switch` on it without a fallback.
 *
 * - `ok` — a valid document this build understands. `dropped` is present and
 *   non-zero when individual merchants inside it could not be read and were
 *   left out: the document is fine, some records in it were not. Element damage
 *   never costs the whole library — see `salvage`.
 * - `empty` — nothing stored yet. Not an error; the first visit looks like this.
 * - `unavailable` — no store, or one that refuses reads or writes. The GM keeps
 *   working in memory behind a persistent banner; nothing here blocks generation.
 * - `future-version` — a document written by a newer build. Left strictly
 *   untouched, and writes are refused for the rest of the page load.
 * - `quarantined` — the payload was unreadable and has been copied aside; the
 *   main key now holds a fresh document. The GM's old data still exists.
 * - `unreadable` — the payload could not be read and the main key could not be
 *   replaced with a fresh document, so **the corrupt bytes are still under the
 *   main key**, recoverable by hand. Says nothing about whether the side copy
 *   landed: it is reached both when the copy failed (nothing was written at
 *   all) and when the copy succeeded but the reset write did not (the bytes now
 *   exist in two places). What the status promises is the part that matters —
 *   the original was not destroyed. Writes are refused for the rest of the page
 *   load either way.
 * - `needs-migration` — the document is older than this build and no migration
 *   has been written for it. Left untouched and writes refused, because `save`
 *   stamps the current version onto whatever it writes: falling through would
 *   relabel an un-migrated document as current. No live case at v1.
 * - `read-only` — the document was read fine, but the store refuses writes
 *   (Safari's private mode). **Carries the document**, because the GM's saved
 *   merchants are right there and hiding them behind a banner would lose them
 *   for no reason. Writes are refused for the rest of the page load.
 */
export type ReadResult =
  | { status: "ok"; doc: StorageDocument; dropped?: number }
  | { status: "read-only"; doc: StorageDocument; dropped?: number }
  | { status: "needs-migration"; found: number }
  | { status: "empty" }
  | { status: "unavailable" }
  | { status: "future-version"; found: number }
  | { status: "quarantined" }
  | { status: "unreadable" };

/**
 * What a write did.
 *
 * `unavailable` and `quota-exceeded` are separate because they produce
 * different GM-facing messages in S-03: one is "turn site data back on", the
 * other is "your browser storage is full". A failed write is always reported,
 * never thrown, and never blocks generation.
 */
export type WriteResult =
  | { status: "ok" }
  | { status: "unavailable" }
  | { status: "quota-exceeded" }
  | { status: "read-only" };

/** A write aimed at one saved record, which may not exist. */
export type MutationResult = WriteResult | { status: "not-found" };

/** An explicit save (FR-009), carrying the record it created. */
export type PromoteResult =
  | { status: "ok"; merchant: Merchant }
  | { status: "not-found" }
  | Exclude<WriteResult, { status: "ok" }>;

/** The durable collection. An empty store is `ok` with no merchants, not a failure. */
export type ListResult =
  | { status: "ok"; merchants: Merchant[] }
  | Exclude<ReadResult, { status: "ok" } | { status: "empty" }>;

/** The fields `updateSavedMerchant` replaces. Identity fields are deliberately absent. */
export interface SavedMerchantPatch {
  rows: StoredRow[];
  corrections: StoredCorrections;
}

/** Written and removed immediately, only to find out whether writing works at all. */
const PROBE_KEY = `${STORAGE_KEY}:probe`;

/** Where an unreadable payload is copied before anything else happens to it. */
const CORRUPT_KEY_PREFIX = `${STORAGE_KEY}:corrupt:`;

/**
 * Refuse every write for the rest of this page load.
 *
 * Set when a read finds a document from a newer build, and when a corrupt
 * payload could not be copied aside. In both cases the next write would destroy
 * exactly the data the detection exists to protect, so the latch has to outlive
 * the call that set it.
 *
 * Module scope is the right scope: one page load, gone on reload, deliberately
 * not persisted. A GM who reloads after rolling forward again gets a clean slate.
 */
let readOnly = false;

/**
 * Clear the read-only latch. **For tests only — nothing in the app calls this.**
 *
 * Vitest isolates module state per file, not per test, and the failure-path
 * tests share a file with the happy-path ones. Without a `beforeEach` reset the
 * first test that latches would refuse every write in every test after it, and
 * the suite would quietly become order-dependent.
 */
export function resetReadOnlyLatch(): void {
  readOnly = false;
}

/**
 * The ambient store, resolved per call.
 *
 * The cast is the honest type: the DOM lib declares `localStorage` as always
 * present, which is false in workerd and in Node, and `strictTypeChecked` would
 * otherwise call the absence check dead code. The `try` is for the browser that
 * throws on the property access itself when site data is blocked.
 */
function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) {
    return storage;
  }

  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The names browsers use for "the store is full".
 *
 * Distinguishing full from disabled matters because S-03 shows different
 * messages, and the exception's `name` is the only signal either one gives —
 * both arrive as a `DOMException` from the same `setItem` call. `code` would say
 * the same thing but is deprecated, so the legacy WebKit and Firefox spellings
 * are listed by name instead.
 */
const QUOTA_ERROR_NAMES = new Set(["QuotaExceededError", "QUOTA_EXCEEDED_ERR", "NS_ERROR_DOM_QUOTA_REACHED"]);

/**
 * Structurally, never by constructor.
 *
 * `error instanceof DOMException` looks stricter and is strictly worse here.
 * It fails for a quota error that arrives as a plain `Error` (some engines and
 * polyfills) and for a `DOMException` from another realm, where `instanceof`
 * never matches. Both then fall through to `unavailable`, **which latches** —
 * so a full store is reported as "site data is off" and `deleteMerchant`, the
 * one remedy the product offers for a full store, is refused. Misclassifying
 * full as disabled does not just pick the wrong message; it removes the way
 * out. The correctly-classified path avoids this precisely because `"full"`
 * does not latch.
 *
 * It also made the two legacy names below unreachable — reducing the set to
 * `QuotaExceededError` alone changed no test — and `instanceof` on an absent
 * global throws `ReferenceError`, out of a module whose first line promises it
 * never throws. Reading `name` and `code` off an unknown value does none of
 * that. `code` is deprecated but is the only signal some older engines give.
 */
function isQuotaError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const { name, code } = error as { name?: unknown; code?: unknown };

  return (typeof name === "string" && QUOTA_ERROR_NAMES.has(name)) || code === 22 || code === 1014;
}

/**
 * Can this store be written to?
 *
 * Answered by actually writing. Safari's private mode exposes `localStorage`
 * and throws only on `setItem`, so `typeof localStorage !== "undefined"` — or
 * any other feature detection — reports the store as available and then loses
 * the GM's data.
 *
 * A full store fails this probe too, which is why `"full"` is separate from
 * `"unavailable"`: a store with no room left is still perfectly readable, and
 * refusing to read it would lose merchants that are sitting right there.
 */
function probeWritable(store: StorageLike): "writable" | "full" | "unavailable" {
  try {
    store.setItem(PROBE_KEY, "1");
    store.removeItem(PROBE_KEY);
    return "writable";
  } catch (error) {
    return isQuotaError(error) ? "full" : "unavailable";
  }
}

function emptyDocument(): StorageDocument {
  return { schemaVersion: SCHEMA_VERSION, transient: null, saved: [] };
}

/**
 * Structural validation, not just "JSON.parse did not throw".
 *
 * A payload missing `schemaVersion`, or carrying a non-array `saved`, parses
 * perfectly and is still corrupt. Treating it as a valid document would mean
 * reading `undefined` merchants and writing the result back over the GM's data.
 */
/**
 * Does this parsed payload announce a schema newer than the one this build
 * owns?
 *
 * Deliberately the *only* thing it looks at. Nothing else about the document
 * can be trusted to match this build's expectations — that is what a higher
 * version means — so anything beyond reading the number would be this build
 * judging a format it does not know.
 */
function isFutureVersion(value: unknown): value is { schemaVersion: number } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const version = (value as Record<string, unknown>).schemaVersion;

  return typeof version === "number" && version > SCHEMA_VERSION;
}

/**
 * Is the *document* the right shape?
 *
 * Deliberately says nothing about the merchants inside it. The two questions
 * have different answers and, more importantly, different consequences: a
 * document with no `saved` array is unusable and gets quarantined, while a
 * document holding nineteen good merchants and one damaged one is mostly fine
 * and must stay that way. Validating elements here would wire the second case
 * to the first case's response and destroy the nineteen — which is exactly what
 * it did until this was split (see {@link salvage}).
 */
function isStorageDocument(value: unknown): value is StorageDocument {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.schemaVersion === "number" &&
    Array.isArray(candidate.saved) &&
    // Present, and an object or null — `typeof undefined` is not "object", so
    // an absent `transient` key still fails. What is *in* it is `salvage`'s
    // problem, not this one.
    (candidate.transient === null || typeof candidate.transient === "object")
  );
}

/**
 * Keep every merchant this build can read, drop the ones it cannot.
 *
 * The counterpart to {@link isStorageDocument}: that one decides whether the
 * document is usable at all, this one decides what inside it is usable. The
 * split is the whole point. Element-level damage must not cost document-level
 * destruction — a GM with one truncated record still has the rest, and
 * `isMerchant`'s own rationale says so: rejecting a whole merchant over one bad
 * field would discard saved work to enforce a vocabulary that is allowed to
 * change. The same argument applies one level up.
 *
 * Dropping is not silent: the count comes back so the read can say how many
 * records this build could not read. Without the drop, `listSaved` hands junk
 * out typed as `Merchant[]` and the next `renameMerchant` throws a `TypeError`
 * out of a module whose first line promises it never throws.
 */
function salvage(doc: StorageDocument): { doc: StorageDocument; dropped: number } {
  const saved = doc.saved.filter(isMerchant);
  const transient = doc.transient !== null && isMerchant(doc.transient) ? doc.transient : null;

  const dropped = doc.saved.length - saved.length + (doc.transient !== null && transient === null ? 1 : 0);

  return dropped === 0 ? { doc, dropped: 0 } : { doc: { ...doc, saved, transient }, dropped };
}

/**
 * Copy an unreadable payload aside, then — and only then — start fresh.
 *
 * The destructive step is conditional on the preserving one. A failed copy is
 * likelier than an ordinary failed write, because it is a second full copy of
 * the payload and a full store is exactly the condition that produces it. If it
 * throws, nothing is overwritten: the corrupt bytes stay where they are, the
 * read-only latch engages, and the GM can still recover them by hand. Wiping
 * after a failed copy would destroy recoverable data in the one scenario this
 * whole module exists to survive.
 *
 * Quarantined payloads are never reclaimed automatically — consistent with
 * never evicting anything. They accumulate, and that is an accepted cost.
 */
function quarantine(store: StorageLike, raw: string): ReadResult {
  // Already latched means an earlier quarantine of these same bytes failed
  // partway. Copying them aside *again* is what turns a corrupt document on a
  // near-full store into unbounded growth, and the copy below writes through
  // `store.setItem` directly rather than `writeDocument`, so the latch does not
  // stop it on its own — this check is what makes the latch mean what it says.
  //
  // Not retrying costs nothing: the previous attempt failed because the store
  // was full, the bytes are still under the main key, and they stay
  // recoverable by hand either way.
  if (readOnly) {
    return { status: "unreadable" };
  }

  // The timestamp is for the human reading devtools; the id is what makes the
  // key unique. `toISOString()` is millisecond-resolution and `Date.now()` is
  // not monotonic — an NTP step or a clock change can repeat one — so on its
  // own it let a second quarantine inside the same millisecond overwrite the
  // first. That first copy can be the only surviving copy of the GM's library,
  // destroyed by the routine whose whole purpose is to preserve it.
  const corruptKey = `${CORRUPT_KEY_PREFIX}${new Date().toISOString()}-${newMerchantId()}`;

  try {
    // Belt and braces: never write over a side key that already exists, however
    // the name was arrived at. Preserving beats tidiness here.
    if (store.getItem(corruptKey) !== null) {
      readOnly = true;
      return { status: "unreadable" };
    }

    store.setItem(corruptKey, raw);
  } catch {
    readOnly = true;
    return { status: "unreadable" };
  }

  if (writeDocument(emptyDocument(), store).status !== "ok") {
    // The copy landed, so nothing is lost, but the corrupt bytes are still
    // under the main key — and the next read would quarantine them again,
    // writing *another* full copy under a new timestamped key. `readDocument`
    // runs on mount, on every cross-tab `storage` event and inside every
    // mutation, so without the latch a corrupt document on a near-full store
    // grows the store on its own, in a module that never reclaims anything.
    //
    // The latch is the same one the failed-copy path above sets, for the same
    // reason: stop writing until someone intervenes. It also makes the
    // `unreadable` contract true — the caller is told nothing was touched, so
    // nothing more may be.
    readOnly = true;
    return { status: "unreadable" };
  }

  return { status: "quarantined" };
}

export function readDocument(storage?: StorageLike): ReadResult {
  const store = resolveStorage(storage);
  if (!store) {
    return { status: "unavailable" };
  }
  // Probe, but do not give up on the read. A store can refuse writes and still
  // hand back everything it holds — Safari's private mode is exactly that
  // shape. `probeWritable`'s own reasoning says a *full* store must stay
  // readable because "refusing to read it would lose merchants that are sitting
  // right there"; the same is true of a write-refusing one, and returning early
  // here hid a GM's whole library behind a "storage is off" banner while the
  // bytes sat intact one `getItem` away.
  //
  // The latch counts as unwritable even on a store that would accept the write.
  // It is module-level and survives the store it was set on, so a page latched
  // by a `future-version` read in one tab must not tell the next reader the
  // coast is clear — reads stayed `ok` while every write was refused with a
  // status that raises no notice, which is a correction disappearing in
  // silence. Skipping the probe when latched is also why the probe is no longer
  // the one write that outlives "refuse every write for this page load".
  const writable = readOnly ? "unavailable" : probeWritable(store);

  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return { status: "unavailable" };
  }

  if (raw === null) {
    // Nothing to show either way, so the write refusal is the only news.
    return writable === "unavailable" ? { status: "unavailable" } : { status: "empty" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return quarantine(store, raw);
  }

  // The version is read BEFORE the shape, and the order is the whole point.
  //
  // `isStorageDocument` describes *v1's* layout. A newer build is free to move
  // those fields around — restructuring is the usual reason to bump a version
  // at all — so validating shape first would classify every reshaped v2
  // document as corrupt, quarantine it, and overwrite the main key with an
  // empty v1 document. That is the precise data loss AGENTS.md's forward-only
  // rule exists to prevent, committed by the code meant to honour it.
  //
  // A document this build does not own is not this build's to validate.
  //
  // The AGENTS.md scenario: a Worker rollback reverted the script but not this
  // device's storage. Leave the document strictly untouched — no rewrite, no
  // field-stripping, no quarantine — and refuse writes from here on, because
  // the very next one would strip whatever the newer build added.
  if (isFutureVersion(parsed)) {
    readOnly = true;
    return { status: "future-version", found: parsed.schemaVersion };
  }

  if (!isStorageDocument(parsed)) {
    return quarantine(store, raw);
  }

  if (parsed.schemaVersion < SCHEMA_VERSION) {
    // MIGRATION SEAM — the first v1→v2 step goes here, and per AGENTS.md it must
    // be written *before* the schema change that needs it. v1 is the first
    // format, so there is nothing below it to migrate from and this branch has
    // no live case yet. No runner, no registry: building a framework around zero
    // migrations means guessing at the shape it has to support.
    //
    // **It fails closed, and that is the point.** Falling through would hand the
    // caller an un-migrated document still carrying its old version, and `save`
    // stamps `SCHEMA_VERSION` onto whatever it writes — so the first write after
    // v2 ships would relabel a v1 document as v2 without migrating it, silently
    // and permanently. Refusing to write until a migration exists is the only
    // behaviour that cannot corrupt data by omission. Whoever adds a migration
    // deletes this return along with writing it.
    readOnly = true;
    return { status: "needs-migration", found: parsed.schemaVersion };
  }

  // Unreadable merchants are dropped, the rest are kept. Never quarantine over
  // this: the document is fine, some records in it are not.
  const { doc, dropped } = salvage(parsed);

  if (writable === "unavailable") {
    // The document is real and the GM should see it; the store just will not
    // accept changes. Latch so every later write says so rather than appearing
    // to succeed, and hand the document over anyway.
    readOnly = true;
    // `dropped` rides along here too. A write-refusing store salvages exactly
    // like a writable one, and dropping the count on this branch would make the
    // loss silent for precisely the GM who cannot re-save to recover from it.
    return dropped === 0 ? { status: "read-only", doc } : { status: "read-only", doc, dropped };
  }

  return dropped === 0 ? { status: "ok", doc } : { status: "ok", doc, dropped };
}

/**
 * Replace the whole document. **Not for callers outside this module.**
 *
 * Exported for tests, which need to seed a document directly. Application code
 * must use the named operations instead — they all go `loadForWrite` → `save`,
 * re-reading immediately before they write so a change from another tab is
 * never overwritten blind.
 *
 * This is the one function in the public surface that can shrink `saved`
 * without reading it first, which makes it the only wholesale-clobber
 * affordance in an API whose entire guarantee is that a saved merchant does not
 * vanish. It still honours the read-only latch and still reports quota failures
 * — the hazard is the caller, not the write.
 */
export function writeDocument(doc: StorageDocument, storage?: StorageLike): WriteResult {
  if (readOnly) {
    return { status: "read-only" };
  }

  const store = resolveStorage(storage);
  if (!store) {
    return { status: "unavailable" };
  }

  try {
    store.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch (error) {
    return isQuotaError(error) ? { status: "quota-exceeded" } : { status: "unavailable" };
  }

  return { status: "ok" };
}

/**
 * The document to mutate, or the reason there isn't one.
 *
 * An absent document is not an error for a write — the first save has to start
 * somewhere. Every other read outcome becomes a write outcome here rather than
 * leaking through, so no caller can mistake "storage is unavailable" for "you
 * have no merchants yet" and overwrite on top of it.
 */
function loadForWrite(
  storage?: StorageLike,
): { status: "ok"; doc: StorageDocument } | Exclude<WriteResult, { status: "ok" }> {
  // The latch first, before anything is read. Without this a latched page whose
  // read happens to come back `ok` or `empty` falls through to the id checks
  // and reports `not-found` — which maps to no notice — so the GM is told
  // nothing about a write that was never going to land.
  if (readOnly) {
    return { status: "read-only" };
  }

  const read = readDocument(storage);

  switch (read.status) {
    case "ok":
      return read;
    case "empty":
    case "quarantined":
      // Quarantine has already moved the corrupt payload aside and left a fresh
      // document under the main key, so there is something valid to build on.
      return { status: "ok", doc: emptyDocument() };
    case "future-version":
    case "needs-migration":
    case "unreadable":
    case "read-only":
      // All three engaged the latch. For the first two, writing now would
      // overwrite the data the detection exists to protect; for the third the
      // store would refuse the write anyway. The document `read-only` carries
      // is for display, not for building a write on.
      return { status: "read-only" };
    case "unavailable":
      return { status: "unavailable" };
  }
}

/** Persist `doc`, stamping the running build's schema version onto it. */
function save(doc: StorageDocument, storage?: StorageLike): WriteResult {
  return writeDocument({ ...doc, schemaVersion: SCHEMA_VERSION }, storage);
}

/**
 * Replace the transient slot, leaving `saved` untouched. Called on every
 * generate.
 *
 * *When* to call it — on generate, on correction, debounced — is S-03's
 * decision. This module provides the write, not the policy.
 */
export function putTransient(merchant: Merchant, storage?: StorageLike): WriteResult {
  const loaded = loadForWrite(storage);
  if (loaded.status !== "ok") {
    return loaded;
  }

  return save({ ...loaded.doc, transient: merchant }, storage);
}

/**
 * FR-009's explicit save: copy the transient record into the durable
 * collection.
 *
 * The copy is the whole point. Flagging the transient record as durable in
 * place would leave one slot that the next Generate overwrites — destroying a
 * merchant the GM explicitly saved, invisibly, and only for GMs who save and
 * then reroll. Promoting a deep-independent copy under a fresh id makes that
 * unreachable by construction rather than by discipline, so a subsequent
 * {@link putTransient} physically cannot reach the saved record.
 *
 * The transient slot is left in place: the GM is still looking at that shop.
 */
export function promoteTransient(storage?: StorageLike): PromoteResult {
  const loaded = loadForWrite(storage);
  if (loaded.status !== "ok") {
    return loaded;
  }

  const { transient } = loaded.doc;
  if (transient === null) {
    return { status: "not-found" };
  }

  // `structuredClone` is deliberate but **unobservable**, and that is recorded
  // here so nobody mistakes it for the thing doing the work.
  //
  // What actually makes a saved record unreachable from a later generate is the
  // fresh `id` below plus the JSON boundary: `save` serializes the whole
  // document before any caller can touch this object, and `transient` is itself
  // a fresh `JSON.parse` product, so no array here is shared with anything that
  // outlives the call. Verified by mutation — removing the clone changes no
  // test and no behaviour, because there is no observable difference to change.
  //
  // It stays as cheap insurance for the day a caller keeps the returned record
  // and this function stops re-reading first. Do not add a test for it: a test
  // that passes with and without the line it names is worse than no test.
  const promoted: Merchant = {
    ...structuredClone(transient),
    id: newMerchantId(),
    savedAt: new Date().toISOString(),
  };

  const written = save({ ...loaded.doc, saved: [...loaded.doc.saved, promoted] }, storage);
  if (written.status !== "ok") {
    return written;
  }

  return { status: "ok", merchant: promoted };
}

/** FR-010's rename. The only operation that changes a saved merchant's name. */
export function renameMerchant(id: string, name: string, storage?: StorageLike): MutationResult {
  const loaded = loadForWrite(storage);
  if (loaded.status !== "ok") {
    return loaded;
  }

  if (!loaded.doc.saved.some((merchant) => merchant.id === id)) {
    return { status: "not-found" };
  }

  const saved = loaded.doc.saved.map((merchant) => (merchant.id === id ? { ...merchant, name } : merchant));

  return save({ ...loaded.doc, saved }, storage);
}

/**
 * S-04's save-in-place: new rows and corrections for an existing record.
 *
 * `id`, `createdAt` and `name` are untouched — they are what make it the same
 * merchant, and {@link renameMerchant} owns the name. An unknown id is a
 * not-found no-op rather than an append, so a stale id from a record the GM
 * deleted cannot resurrect it.
 */
export function updateSavedMerchant(id: string, patch: SavedMerchantPatch, storage?: StorageLike): MutationResult {
  const loaded = loadForWrite(storage);
  if (loaded.status !== "ok") {
    return loaded;
  }

  if (!loaded.doc.saved.some((merchant) => merchant.id === id)) {
    return { status: "not-found" };
  }

  const savedAt = new Date().toISOString();
  const saved = loaded.doc.saved.map((merchant) =>
    merchant.id === id ? { ...merchant, rows: patch.rows, corrections: patch.corrections, savedAt } : merchant,
  );

  return save({ ...loaded.doc, saved }, storage);
}

/**
 * FR-013's delete — the *only* operation that removes a saved merchant.
 *
 * There is no cap, no eviction and no cleanup anywhere else in this module,
 * which is what makes "a saved merchant never disappears without an explicit
 * action" true by construction instead of by review.
 */
export function deleteMerchant(id: string, storage?: StorageLike): MutationResult {
  const loaded = loadForWrite(storage);
  if (loaded.status !== "ok") {
    return loaded;
  }

  const saved = loaded.doc.saved.filter((merchant) => merchant.id !== id);
  if (saved.length === loaded.doc.saved.length) {
    return { status: "not-found" };
  }

  return save({ ...loaded.doc, saved }, storage);
}

/**
 * The durable collection only.
 *
 * The transient record is never included: FR-009's rationale requires the saved
 * list not to fill up with one-offs.
 */
export function listSaved(storage?: StorageLike): ListResult {
  const read = readDocument(storage);
  if (read.status === "empty") {
    return { status: "ok", merchants: [] };
  }

  // `read-only` carries a document, so it belongs with `ok` here. Returning it
  // unchanged handed the caller a *failure* member whose merchants sat in a
  // field called `doc` — so anything reading `.merchants` saw nothing and a
  // Safari-private-mode GM's whole library disappeared. That is the loss
  // `read-only` was introduced to prevent, and it was fixed on one of the two
  // read surfaces. Whether writes are refused is the writer's problem; this
  // function answers "what is saved", and the answer is the same either way.
  if (read.status === "ok" || read.status === "read-only") {
    return { status: "ok", merchants: read.doc.saved };
  }

  return read;
}
