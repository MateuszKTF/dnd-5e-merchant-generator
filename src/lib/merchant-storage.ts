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
import { newMerchantId } from "./merchant";

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
 * - `ok` — a valid document this build understands.
 * - `empty` — nothing stored yet. Not an error; the first visit looks like this.
 * - `unavailable` — no store, or one that refuses reads or writes. The GM keeps
 *   working in memory behind a persistent banner; nothing here blocks generation.
 * - `future-version` — a document written by a newer build. Left strictly
 *   untouched, and writes are refused for the rest of the page load.
 * - `quarantined` — the payload was unreadable and has been copied aside; the
 *   main key now holds a fresh document. The GM's old data still exists.
 * - `unreadable` — the payload was unreadable and could *not* be copied aside,
 *   so nothing was touched. The corrupt bytes are still there, recoverable by
 *   hand.
 */
export type ReadResult =
  | { status: "ok"; doc: StorageDocument }
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

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && QUOTA_ERROR_NAMES.has(error.name);
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
function isStorageDocument(value: unknown): value is StorageDocument {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.schemaVersion === "number" &&
    Array.isArray(candidate.saved) &&
    // An absent `transient` fails both arms: `typeof undefined` is not "object".
    (candidate.transient === null || typeof candidate.transient === "object")
  );
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
  try {
    store.setItem(`${CORRUPT_KEY_PREFIX}${new Date().toISOString()}`, raw);
  } catch {
    readOnly = true;
    return { status: "unreadable" };
  }

  if (writeDocument(emptyDocument(), store).status !== "ok") {
    // The copy landed, so nothing is lost, but the corrupt bytes are still
    // under the main key and the next read will quarantine them again.
    return { status: "unreadable" };
  }

  return { status: "quarantined" };
}

export function readDocument(storage?: StorageLike): ReadResult {
  const store = resolveStorage(storage);
  if (!store) {
    return { status: "unavailable" };
  }
  if (probeWritable(store) === "unavailable") {
    return { status: "unavailable" };
  }

  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return { status: "unavailable" };
  }

  if (raw === null) {
    return { status: "empty" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return quarantine(store, raw);
  }

  if (!isStorageDocument(parsed)) {
    return quarantine(store, raw);
  }

  if (parsed.schemaVersion > SCHEMA_VERSION) {
    // The AGENTS.md scenario: a Worker rollback reverted the script but not this
    // device's storage. Leave the document strictly untouched — no rewrite, no
    // field-stripping, no quarantine — and refuse writes from here on, because
    // the very next one would strip whatever the newer build added.
    readOnly = true;
    return { status: "future-version", found: parsed.schemaVersion };
  }

  if (parsed.schemaVersion < SCHEMA_VERSION) {
    // MIGRATION SEAM — the first v1→v2 step goes here, and per AGENTS.md it must
    // be written *before* the schema change that needs it. v1 is the first
    // format, so there is nothing below it to migrate from and this branch has
    // no live case yet. No runner, no registry: building a framework around zero
    // migrations means guessing at the shape it has to support.
  }

  return { status: "ok", doc: parsed };
}

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
    case "unreadable":
      // Both engaged the latch. Writing now would overwrite the data the
      // detection exists to protect.
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
  if (read.status !== "ok") {
    return read;
  }

  return { status: "ok", merchants: read.doc.saved };
}
