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
 */
export type StoredCorrections = Record<string, StoredCorrection>;

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
 * A fresh merchant id.
 *
 * Called lazily, never at module scope: `crypto` exists in the browser, in Node
 * 22 and in workerd, but touching globals at import time is the habit that
 * breaks the prerender build.
 */
export function newMerchantId(): string {
  return crypto.randomUUID();
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
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
  const date = `${pad2(when.getDate())}.${pad2(when.getMonth() + 1)}.${when.getFullYear()}`;
  const time = `${pad2(when.getHours())}:${pad2(when.getMinutes())}`;

  return `${label} — ${date}, ${time}`;
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
