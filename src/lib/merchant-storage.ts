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
 * What a read found.
 *
 * Phase 3 of this slice adds `"future-version"`, `"quarantined"` and
 * `"unreadable"`; the union is meant to grow, and S-03 is meant to `switch` on
 * it without a fallback case.
 */
export type ReadResult = { status: "ok"; doc: StorageDocument } | { status: "empty" } | { status: "unavailable" };

/** What a write did. Phase 3 adds `"quota-exceeded"` and `"read-only"`. */
export type WriteResult = { status: "ok" } | { status: "unavailable" };

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

/**
 * The ambient store, resolved per call.
 *
 * The cast is the honest type: the DOM lib declares `localStorage` as always
 * present, which is false in workerd and in Node, and `strictTypeChecked` would
 * otherwise call the absence check dead code.
 */
function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) {
    return storage;
  }

  return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
}

function emptyDocument(): StorageDocument {
  return { schemaVersion: SCHEMA_VERSION, transient: null, saved: [] };
}

export function readDocument(storage?: StorageLike): ReadResult {
  const store = resolveStorage(storage);
  if (!store) {
    return { status: "unavailable" };
  }

  const raw = store.getItem(STORAGE_KEY);
  if (raw === null) {
    return { status: "empty" };
  }

  // Phase 3 replaces this with structural validation plus quarantine. Until
  // then a corrupt payload throws rather than being quietly discarded, which is
  // the safer of the two wrong behaviours.
  const doc = JSON.parse(raw) as StorageDocument;

  return { status: "ok", doc };
}

export function writeDocument(doc: StorageDocument, storage?: StorageLike): WriteResult {
  const store = resolveStorage(storage);
  if (!store) {
    return { status: "unavailable" };
  }

  store.setItem(STORAGE_KEY, JSON.stringify(doc));

  return { status: "ok" };
}

/**
 * The document to mutate: whatever is stored, or a fresh one if nothing is.
 *
 * An absent document is not an error for a write — the first save has to start
 * somewhere. Read failures pass straight through, so no caller can mistake
 * "storage is unavailable" for "you have no merchants yet" and overwrite on top
 * of it.
 */
function loadForWrite(
  storage?: StorageLike,
): { status: "ok"; doc: StorageDocument } | Exclude<ReadResult, { status: "ok" } | { status: "empty" }> {
  const read = readDocument(storage);
  if (read.status === "empty") {
    return { status: "ok", doc: emptyDocument() };
  }

  return read;
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
