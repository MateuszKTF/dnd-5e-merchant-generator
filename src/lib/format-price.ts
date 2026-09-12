/**
 * Coin-aware price rendering for the assortment table.
 *
 * A GM reads this column aloud at the table, so a price has to arrive in the
 * unit they would actually say: "2 cp", "5 sp", "1 500 gp" — never "0.02 gp".
 *
 * The thresholds live in exactly one place (`priceParts`). `formatPrice` is a
 * thin wrapper over it so the rendered string and the parts can never disagree
 * about a boundary, and `partsToGp` is its inverse so S-02 can let the GM edit
 * a price in the unit they are looking at.
 *
 * **`priceParts` is the production entry point.** S-02 made the price column
 * editable, so `MerchantTable` renders `PriceQuantityCell` from the parts and
 * writes back through `partsToGp`; nothing in `src/components/` calls
 * `formatPrice` today. It is kept, tested and correct for read-only surfaces
 * that do not exist yet — a print view, a share view, a saved-merchant preview.
 * If you add one, use it rather than re-deriving a unit, and if it is still
 * unused when v1 ships, delete it with its tests instead of letting it rot.
 */

export type PriceUnit = "gp" | "sp" | "cp";

/** 1 gp = 10 sp = 100 cp. */
const SP_PER_GP = 10;

/**
 * The copper grid, exported because `corrections.ts` compares prices on it.
 *
 * This module owns the coin scale — it is where a price becomes a unit and a
 * number, and back. Dirty detection rounds to whole copper so a price retyped
 * into the field it is displayed in compares equal to the one it came from,
 * which only holds while both modules mean the same thing by "copper". A second
 * private copy of this constant would let the two drift with no compile error
 * and no failing type check; the symptom would be a confirmation dialog firing
 * over a shop the GM never corrected.
 */
export const CP_PER_GP = 100;

/**
 * The floor. Catalog items go as low as 0.01 gp and the `nędzna` multiplier
 * (1.2) leaves them fractional, so without a floor a real item could render
 * as "0" — a price the GM cannot read out.
 */
const MIN_GP = 1 / CP_PER_GP;

/** What {@link formatPrice} renders when the input is not a price at all. */
export const UNRENDERABLE_PRICE = "—";

/**
 * The one place that decides whether a number is a price.
 *
 * The 1 cp floor is for values that are genuinely cheap. A negative, NaN or
 * infinite amount is not cheap — it is wrong — and clamping it *down* to the
 * floor would show the GM a definite, plausible, tiny price instead.
 */
export function isRenderablePrice(gp: number): boolean {
  return Number.isFinite(gp) && gp >= 0;
}

/**
 * Split a gold amount into the unit a table would speak it in.
 *
 * Below 0.1 gp → copper, below 1 gp → silver, otherwise gold. The returned
 * `value` is already rounded for display in that unit; `gp` below the 1 cp
 * floor clamps up rather than rounding to zero.
 *
 * Stays total for any input so callers always get a unit, but input that fails
 * {@link isRenderablePrice} clamps to the floor and is therefore meaningless —
 * check first when the value is going in front of the GM.
 */
export function priceParts(gp: number): { value: number; unit: PriceUnit } {
  const safe = Number.isFinite(gp) ? Math.max(gp, MIN_GP) : MIN_GP;

  if (safe < 0.1) {
    // Whole copper — the smallest coin, so no fractions below this.
    return { value: Math.max(1, Math.round(safe * CP_PER_GP)), unit: "cp" };
  }

  if (safe < 1) {
    // Silver, one decimal at most.
    return { value: round(safe * SP_PER_GP, 1), unit: "sp" };
  }

  // Gold, at most two decimals.
  return { value: round(safe, 2), unit: "gp" };
}

/** Inverse of {@link priceParts}. Round-trips to within 1 cp. */
export function partsToGp(value: number, unit: PriceUnit): number {
  switch (unit) {
    case "cp":
      return value / CP_PER_GP;
    case "sp":
      return value / SP_PER_GP;
    case "gp":
      return value;
  }
}

/**
 * Render a price the way it is read aloud: "2 cp", "5 sp", "1 500 gp".
 *
 * Thousands are separated, the Polish convention, so a 21 000 gp amulet stays
 * legible in a narrow column.
 */
export function formatPrice(gp: number): string {
  if (!isRenderablePrice(gp)) return UNRENDERABLE_PRICE;

  const { value, unit } = priceParts(gp);
  return `${formatNumber(value)} ${unit}`;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatNumber(value: number): string {
  // pl-PL groups thousands with a no-break space (U+00A0 on Node 22 ICU) and
  // uses a comma for the decimal separator, which is what a Polish-language
  // table expects. The exact grouping character has changed between CLDR
  // releases and can differ across Node / workerd / browser, so assert that
  // the digits are separated — never on a specific codepoint — and never parse
  // this string back: `parseFloat("9,5")` reads 9.
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 }).format(value);
}
