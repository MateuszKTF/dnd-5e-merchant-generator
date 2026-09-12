/**
 * The merchant entity, as it is written to browser storage.
 *
 * This module owns the *persisted* shape. It deliberately does not import
 * `AssortmentRow` from S-01 or `CorrectionMap` from S-02: the UI is free to
 * evolve its own vocabulary, while the stored format is forward-only
 * (AGENTS.md — a Worker rollback reverts the script but not a GM's
 * `localStorage`, so a device that ever loaded a newer format keeps it and the
 * reverted code must still read it). `toStoredRows` / `fromStoredRows` below
 * are the single place the two vocabularies meet.
 *
 * Pure — no storage access, no `window`, nothing at module scope. Every page is
 * prerendered, so this file is imported during a build running in Node/workerd
 * (see `merchant-storage.ts`, which owns the actual reads and writes).
 */

import { CATEGORIES, type CategoryId, type Rarity, type Wealth } from "@/data/items";

/**
 * One row of a persisted merchant — a self-contained snapshot.
 *
 * `name` and `rarity` are denormalized on purpose. `src/data/items.ts` promises
 * ids are stable, but it does not promise an item survives: `npm run data:build`
 * drops Legendary and Artifact tiers, `Varies` parents and unpriced entries
 * (`scripts/build-item-catalog.mjs`). A row holding only `itemId` would fail to
 * render after such a regeneration — which is a row silently vanishing from a
 * saved merchant, exactly what the PRD guardrail forbids. Carrying the label and
 * the tier costs ~3.5 KB per merchant against a ~5 MB origin quota, so the safe
 * choice is also the free one.
 *
 * `priceGp` is the wealth-modified price as generated (or as corrected by the
 * GM), unrounded — formatting stays with `format-price.ts`.
 */
export interface StoredRow {
  itemId: string;
  name: string;
  rarity: Rarity;
  quantity: number;
  priceGp: number;
}

/**
 * One row's hand-made overrides. An absent field means that cell was never
 * touched, which is not the same as a field whose value happens to match the
 * generated one — S-02's dirty detection depends on the difference.
 */
export interface StoredCorrection {
  quantity?: number;
  priceGp?: number;
}

/**
 * The correction overlay, keyed by {@link StoredRow.itemId}.
 *
 * Corrections are persisted *beside* the generated values rather than flattened
 * into them, so a reload can still show the GM which cells they changed (US-02
 * asserts corrections survive a save).
 *
 * The value is `| undefined` for the same reason S-02's `CorrectionMap` is:
 * most rows have no entry and `noUncheckedIndexedAccess` is off, so without it
 * TypeScript types every lookup as a present `StoredCorrection` and the first
 * `corrections[itemId].priceGp` compiles and throws. It also makes the absence
 * guard in {@link fromStoredCorrections} honest rather than dead code — these
 * documents come out of `JSON.parse`, where any key can hold anything.
 */
export type StoredCorrections = Record<string, StoredCorrection | undefined>;

/**
 * A merchant as one storage document holds it.
 *
 * Timestamps are ISO 8601 strings, not `Date`, because the whole record
 * round-trips through `JSON.stringify` / `JSON.parse` and a `Date` would come
 * back as a string anyway — typing it honestly avoids a revive step.
 *
 * `savedAt` is the durable marker: `null` for the transient last-generated
 * merchant, set when the GM explicitly saves (FR-009). No separate boolean
 * exists, so the two cannot disagree.
 */
export interface Merchant {
  id: string;
  name: string;
  category: CategoryId;
  wealth: Wealth;
  createdAt: string;
  savedAt: string | null;
  rows: StoredRow[];
  corrections: StoredCorrections;
}

/**
 * Is this parsed value really a {@link StoredRow}?
 *
 * The `Merchant` types below describe what this build *writes*. What it
 * **reads** is whatever `JSON.parse` returned — an older build's document, a
 * newer one's under the forward-only rule in `AGENTS.md`, or something a
 * curious GM edited by hand in devtools. Declaring the fields required does not
 * make them present.
 */
export function isStoredRow(value: unknown): value is StoredRow {
  if (typeof value !== "object" || value === null) return false;

  const row = value as Record<string, unknown>;

  return (
    typeof row.itemId === "string" &&
    typeof row.name === "string" &&
    typeof row.rarity === "string" &&
    typeof row.quantity === "number" &&
    typeof row.priceGp === "number"
  );
}

/**
 * Is this parsed value really a {@link Merchant}?
 *
 * Owned here because this module owns the shape. Two downstream modules had
 * each re-derived a partial version of this check — `restoreFromMerchant` and
 * the library's row summary both guard `Array.isArray(merchant.rows)` — which
 * is the usual sign that the guard belongs with the type rather than with its
 * consumers.
 *
 * Deliberately shallow on `rarity`, `category` and `wealth`: they are validated
 * as strings, not against the catalog's current membership. A tier or category
 * this build does not recognise is exactly what the forward-only rule says to
 * expect and to keep, so rejecting the whole merchant over one would discard a
 * GM's saved work to enforce a vocabulary that is allowed to change.
 */
export function isMerchant(value: unknown): value is Merchant {
  if (typeof value !== "object" || value === null) return false;

  const merchant = value as Record<string, unknown>;

  return (
    typeof merchant.id === "string" &&
    typeof merchant.name === "string" &&
    typeof merchant.category === "string" &&
    typeof merchant.wealth === "string" &&
    typeof merchant.createdAt === "string" &&
    (merchant.savedAt === null || typeof merchant.savedAt === "string") &&
    Array.isArray(merchant.rows) &&
    merchant.rows.every(isStoredRow) &&
    typeof merchant.corrections === "object" &&
    merchant.corrections !== null
  );
}

/**
 * A fresh merchant id.
 *
 * Called lazily, never at module scope: `crypto` exists in the browser, in Node
 * 22 and in workerd, but touching globals at import time is the habit that
 * breaks the prerender build.
 *
 * **`randomUUID` is `[SecureContext]`, which is why the fallbacks exist.** On
 * `http://192.168.x.x` — what `astro dev --host` serves to a phone — `crypto`
 * is present but `randomUUID` is `undefined`, and calling it throws. This runs
 * inside the generate handler's `try`, so a bare call would turn *every*
 * Generate into "coś poszło nie tak przy tworzeniu asortymentu": the product
 * looks wholly broken, and the message blames the item pool. Production is
 * HTTPS on Workers, so this is about the device-testing path the phone NFR
 * requires, not about shipping.
 *
 * These ids are local document keys — they name a row in this browser's
 * storage. They are not secrets, not guessable-by-an-attacker material, and
 * nothing authorises off them, so degrading to `Math.random` is a real option
 * rather than a security compromise. Uniqueness within one device is the whole
 * requirement.
 */
export function newMerchantId(): string {
  const api: Partial<Crypto> | undefined = typeof crypto === "undefined" ? undefined : crypto;

  if (typeof api?.randomUUID === "function") {
    return api.randomUUID();
  }

  // `getRandomValues` is not secure-context gated, so it survives plain http.
  // Hand-built v4: set the version nibble and the variant bits, then hex it.
  if (typeof api?.getRandomValues === "function") {
    const bytes = api.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Last resort: not a UUID and not trying to look like one, so nothing reads
  // it as a guarantee it cannot make. Still unique enough for one device.
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * A moment as the GM reads it: `11.09.2026, 20:15`, local time.
 *
 * Exported because two surfaces must agree on it — {@link autoName} builds a
 * merchant's name from it, and the library renders a saved-at label beside that
 * name in the same list. Two private copies of the format would let a
 * divergence show up directly under the GM's eyes.
 *
 * Built from local date parts rather than `Intl`: the string is the GM's own
 * wall clock and is byte-stable across Node, workerd and the browser, which
 * `format-price.ts` documents as a real hazard for `Intl` output.
 *
 * Returns `null` for an unusable date rather than `"NaN.NaN.NaN, NaN:NaN"`,
 * so a caller has to decide what to show instead of persisting nonsense.
 */
export function formatWallClock(when: Date): string | null {
  if (Number.isNaN(when.getTime())) {
    return null;
  }

  const date = `${pad2(when.getDate())}.${pad2(when.getMonth() + 1)}.${when.getFullYear()}`;
  const time = `${pad2(when.getHours())}:${pad2(when.getMinutes())}`;

  return `${date}, ${time}`;
}

/**
 * FR-010's automatic name: the category's Polish label plus the moment of
 * creation, e.g. `Kowal — 11.09.2026, 14:32`.
 *
 * The time is part of it, not decoration. FR-011 requires the GM to recognise a
 * merchant in a list and FR-012 searches by name; three smiths prepared in one
 * session is the normal case at a table, and a date-only name would make all
 * three identical. Minute precision still collides for two saves in the same
 * minute — a documented limit (see the tests), not an oversight: seconds would
 * buy nothing a GM can read and would clutter a narrow list.
 *
 * Built from local date parts rather than `Intl`, so the string is the GM's own
 * wall clock and is byte-stable across runtimes.
 */
export function autoName(category: CategoryId, when: Date): string {
  const label = CATEGORIES.find((entry) => entry.id === category)?.label ?? category;
  const stamp = formatWallClock(when);

  // An unusable date degrades to the bare label rather than naming the merchant
  // "Kowal — NaN.NaN.NaN, NaN:NaN". Unreachable from today's callers, which all
  // pass `new Date()`, but the name is persisted and a GM cannot fix what they
  // cannot read.
  return stamp === null ? label : `${label} — ${stamp}`;
}

/**
 * The UI's row vocabulary, restated structurally.
 *
 * This is `AssortmentRow` (S-01) by shape and not by import — the import is what
 * would let a change to the UI type silently redefine the persisted format. The
 * correspondence is not left to a comment: `merchant.test.ts` carries a
 * compile-time assertion that the two stay mutually assignable, so the day
 * S-01 adds a field, this file fails to type-check and someone has to decide
 * consciously whether that field belongs in storage.
 */
export interface UiRow {
  readonly itemId: string;
  readonly name: string;
  readonly rarity: Rarity;
  readonly quantity: number;
  readonly priceGp: number;
}

/** Generated rows → the persisted snapshot. Field-by-field, never a spread. */
export function toStoredRows(rows: readonly UiRow[]): StoredRow[] {
  return rows.map((row) => ({
    itemId: row.itemId,
    name: row.name,
    rarity: row.rarity,
    quantity: row.quantity,
    priceGp: row.priceGp,
  }));
}

/**
 * The UI's correction overlay, restated structurally.
 *
 * Same reasoning as {@link UiRow}: this is S-02's `CorrectionMap` by shape and
 * not by import. The `| undefined` on the value is the difference that matters —
 * most rows have no entry and `noUncheckedIndexedAccess` is off, so the UI type
 * carries the hole and the stored format does not.
 */
export interface UiCorrection {
  readonly quantity?: number;
  readonly priceGp?: number;
}

export type UiCorrections = Readonly<Record<string, UiCorrection | undefined>>;

/**
 * The overlay → the persisted snapshot.
 *
 * Field by field rather than a spread, matching {@link toStoredRows}: an absent
 * key must stay absent, because S-02's dirty detection reads "never touched"
 * from the absence itself. An entry that is present but empty is dropped for
 * the same reason.
 */
export function toStoredCorrections(corrections: UiCorrections): StoredCorrections {
  const stored: StoredCorrections = {};

  for (const [itemId, correction] of Object.entries(corrections)) {
    if (!correction) continue;

    const entry: StoredCorrection = {};
    if (correction.quantity !== undefined) entry.quantity = correction.quantity;
    if (correction.priceGp !== undefined) entry.priceGp = correction.priceGp;

    stored[itemId] = entry;
  }

  return stored;
}

/**
 * The persisted snapshot → the overlay the table can render.
 *
 * The mirror of {@link toStoredCorrections}, and the reason this direction
 * exists at all: without it the caller assigns a parsed storage object straight
 * into UI state, which is safe only for as long as that object happens to be a
 * fresh `JSON.parse` product. Copying field by field makes it safe by
 * construction and drops anything a newer build wrote that this one does not
 * understand — the forward-only rule cuts both ways.
 */
export function fromStoredCorrections(stored: StoredCorrections): UiCorrections {
  const corrections: Record<string, UiCorrection> = {};

  for (const [itemId, entry] of Object.entries(stored)) {
    if (!entry) continue;

    const correction: { quantity?: number; priceGp?: number } = {};
    if (entry.quantity !== undefined) correction.quantity = entry.quantity;
    if (entry.priceGp !== undefined) correction.priceGp = entry.priceGp;

    corrections[itemId] = correction;
  }

  return corrections;
}

/** The persisted snapshot → rows the table can render. */
export function fromStoredRows(rows: readonly StoredRow[]): UiRow[] {
  return rows.map((row) => ({
    itemId: row.itemId,
    name: row.name,
    rarity: row.rarity,
    quantity: row.quantity,
    priceGp: row.priceGp,
  }));
}
