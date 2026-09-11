/**
 * The correction overlay: what the GM changed by hand, kept apart from what
 * the generator drew.
 *
 * Generated rows are immutable. A correction is an override stored beside
 * them, keyed by `itemId`, and merged at render time. Keeping the two apart is
 * what makes dirty detection honest — a price edited to a new value and back
 * again compares equal to the generated one, so the confirmation dialog
 * (FR-006) does not fire over a list with no real corrections.
 *
 * Pure — no React, no DOM. The cases that decide whether that dialog fires are
 * exactly the ones that fail silently in a plausible-looking table, so they
 * live here where the Vitest glob (`.ts` only) can reach them.
 */

import type { AssortmentRow } from "./assortment";
import type { PriceUnit } from "./format-price";

/**
 * One row's overrides. An absent field means that cell was never corrected —
 * which is different from a field whose value happens to equal the generated
 * one (see {@link isCorrected}).
 */
export interface Correction {
  readonly quantity?: number;
  readonly priceGp?: number;
}

/**
 * The overlay, keyed by `AssortmentRow.itemId`.
 *
 * Safe as a key because S-01 guarantees `itemId` is unique within a list
 * (FR-004). If that guarantee ever weakens, corrections start leaking between
 * rows with no visible symptom.
 *
 * The value is `| undefined` on purpose. Most rows have no entry, and
 * `noUncheckedIndexedAccess` is off in this project — without it TypeScript
 * would type every lookup as a present `Correction` and flag the runtime
 * absence guards below as dead code.
 */
export type CorrectionMap = Readonly<Record<string, Correction | undefined>>;

/** 1 gp = 100 cp — the grid prices are compared on. */
const CP_PER_GP = 100;

/**
 * The legal span for a corrected price.
 *
 * The floor is 1 cp, matching `format-price.ts`'s own floor, so no legal price
 * can render as `0`. The ceiling sits far above the catalog's real maximum —
 * 21 000 gp, or 25 200 gp once the `nędzna` multiplier (1.2) is applied — while
 * still fitting the price column without wrapping.
 */
const MIN_PRICE_GP = 0.01;
const MAX_PRICE_GP = 999_999;

/** A shop stocks at most 25 rows; 99 of one item is already absurd. */
const MAX_QUANTITY = 99;

/**
 * Prices as whole copper.
 *
 * Base prices go as low as 0.01 gp and are multiplied by a wealth modifier
 * (1.2 / 1.0 / 0.9), so `priceGp` is routinely fractional. Comparing raw
 * floats would leave a reverted edit dirty forever — 0.5 gp typed back as
 * `5 sp` is not bit-identical to the value it came from — and the dialog would
 * then fire on a list the GM never corrected.
 */
function toCopper(gp: number): number {
  return Math.round(gp * CP_PER_GP);
}

/**
 * Apply the overlay to the generated rows, preserving order.
 *
 * Overlay keys matching no row are ignored, so a stale overlay can never
 * inject a phantom item into a freshly drawn shop.
 */
export function mergeCorrections(rows: readonly AssortmentRow[], corrections: CorrectionMap): AssortmentRow[] {
  return rows.map((row) => {
    const correction = corrections[row.itemId];
    if (!correction) return row;

    return {
      ...row,
      // `??` and not `||`: a corrected quantity of 0 is legal and means the
      // players cleared the shelf.
      quantity: correction.quantity ?? row.quantity,
      priceGp: correction.priceGp ?? row.priceGp,
    };
  });
}

/**
 * Per-cell: is this value actually different from what the generator drew?
 *
 * True only when an override exists **and** differs. That second half is the
 * whole rule: committing an edit that restores the generated value leaves the
 * overlay key in place, and this comparison is what makes the cell clean
 * again. Callers therefore never need to prune keys.
 */
export function isCorrected(
  row: AssortmentRow,
  correction: Correction | undefined,
): { quantity: boolean; price: boolean } {
  if (!correction) return { quantity: false, price: false };

  return {
    quantity: correction.quantity !== undefined && correction.quantity !== row.quantity,
    price: correction.priceGp !== undefined && toCopper(correction.priceGp) !== toCopper(row.priceGp),
  };
}

/**
 * Does this list carry any real correction?
 *
 * The confirmation dialog's only trigger. Because it defers to
 * {@link isCorrected}, an edit-and-revert produces no warning — which is the
 * behaviour that keeps the guardrail from crying wolf.
 */
export function hasCorrections(rows: readonly AssortmentRow[], corrections: CorrectionMap): boolean {
  return rows.some((row) => {
    const { quantity, price } = isCorrected(row, corrections[row.itemId]);
    return quantity || price;
  });
}

/**
 * A price expressed in a unit chosen earlier, for display in an edit field.
 *
 * `priceParts` picks whichever unit fits the amount. This one is *told* the
 * unit, because the field's unit is pinned to the row's generated price for the
 * row's lifetime — recomputing it from the corrected value would flip the unit
 * while the GM is typing in it. The cost is that a 1 cp candle corrected to
 * 5 gp reads as "500 cp", which is the accepted trade.
 *
 * Conversion goes through whole copper, the same grid {@link isCorrected} uses,
 * so the number shown in the field and the number the dirty check compares can
 * never disagree about a rounding boundary.
 */
export function priceInUnit(gp: number, unit: PriceUnit): number {
  const cp = Math.round(gp * CP_PER_GP);

  switch (unit) {
    case "cp":
      return cp;
    case "sp":
      return Math.round(cp) / 10;
    case "gp":
      return Math.round(cp) / 100;
  }
}

/**
 * Read a GM's in-progress text as a number, with a blank field reading as
 * unusable rather than as zero.
 *
 * `Number("")` is `0`, which would silently turn a cleared quantity field into
 * a legal "shelf cleared" edit. Routing every draft through here keeps the
 * clamps below honest about the empty case.
 */
export function parseDraft(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

/**
 * A quantity the table can show, or `null`.
 *
 * `0` is legal and deliberate — it records a shelf the players cleared out.
 * Everything unusable (blank, non-numeric, negative, fractional, over 99)
 * returns `null` so the caller restores the previous value instead of
 * inventing a number the GM never typed.
 */
export function clampQuantity(n: number): number | null {
  // Rejects NaN and Infinity as well as fractions.
  if (!Number.isInteger(n)) return null;
  if (n < 0 || n > MAX_QUANTITY) return null;
  return n;
}

/**
 * A price the table can show, or `null`.
 *
 * Same snap-back contract as {@link clampQuantity}: out of range or
 * unparseable returns `null` rather than a coerced value.
 */
export function clampPriceGp(gp: number): number | null {
  if (!Number.isFinite(gp)) return null;
  if (gp < MIN_PRICE_GP || gp > MAX_PRICE_GP) return null;
  return gp;
}
