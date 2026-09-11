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
 */

export type PriceUnit = "gp" | "sp" | "cp";

/** 1 gp = 10 sp = 100 cp. */
const SP_PER_GP = 10;
const CP_PER_GP = 100;

/**
 * The floor. Catalog items go as low as 0.01 gp and the `nędzna` multiplier
 * (1.2) leaves them fractional, so without a floor a real item could render
 * as "0" — a price the GM cannot read out.
 */
const MIN_GP = 1 / CP_PER_GP;

/**
 * Split a gold amount into the unit a table would speak it in.
 *
 * Below 0.1 gp → copper, below 1 gp → silver, otherwise gold. The returned
 * `value` is already rounded for display in that unit; `gp` below the 1 cp
 * floor clamps up rather than rounding to zero.
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
 * Thousands are separated with a non-breaking space, the Polish convention,
 * so a 21 000 gp amulet stays legible in a narrow column.
 */
export function formatPrice(gp: number): string {
  const { value, unit } = priceParts(gp);
  return `${formatNumber(value)} ${unit}`;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatNumber(value: number): string {
  // pl-PL groups thousands with a narrow no-break space and uses a comma for
  // the decimal separator, which is what a Polish-language table expects.
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 }).format(value);
}
