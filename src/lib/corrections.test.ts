import { describe, expect, it } from "vitest";

import type { AssortmentRow } from "./assortment";
import {
  clampPriceGp,
  clampQuantity,
  hasCorrections,
  isCorrected,
  mergeCorrections,
  parseDraft,
  priceInUnit,
  type CorrectionMap,
} from "./corrections";
import { partsToGp, priceParts } from "./format-price";

function row(itemId: string, quantity: number, priceGp: number): AssortmentRow {
  return { itemId, name: itemId, rarity: "pospolite", quantity, priceGp };
}

/** A three-row shop spanning the catalog's units: copper, silver, gold. */
const ROWS: readonly AssortmentRow[] = [row("candle", 4, 0.01), row("rope", 2, 0.5), row("sword", 1, 15)];

describe("mergeCorrections", () => {
  it("applies a quantity-only override", () => {
    const merged = mergeCorrections(ROWS, { rope: { quantity: 7 } });
    expect(merged[1]).toEqual({ ...ROWS[1], quantity: 7 });
  });

  it("applies a price-only override", () => {
    const merged = mergeCorrections(ROWS, { sword: { priceGp: 20 } });
    expect(merged[2]).toEqual({ ...ROWS[2], priceGp: 20 });
  });

  it("applies both fields at once", () => {
    const merged = mergeCorrections(ROWS, { candle: { quantity: 0, priceGp: 0.02 } });
    expect(merged[0]).toEqual({ ...ROWS[0], quantity: 0, priceGp: 0.02 });
  });

  it("keeps a corrected quantity of 0 rather than falling back to the generated value", () => {
    // `??` and not `||`: 0 means the players cleared the shelf.
    const merged = mergeCorrections(ROWS, { rope: { quantity: 0 } });
    expect(merged[1].quantity).toBe(0);
  });

  it("preserves row order", () => {
    const merged = mergeCorrections(ROWS, { sword: { quantity: 9 }, candle: { quantity: 9 } });
    expect(merged.map((r) => r.itemId)).toEqual(["candle", "rope", "sword"]);
  });

  it("ignores overlay keys matching no row, so a stale overlay injects nothing", () => {
    const merged = mergeCorrections(ROWS, { "potion-of-healing": { quantity: 3, priceGp: 50 } });
    expect(merged).toHaveLength(ROWS.length);
    expect(merged).toEqual(ROWS);
  });

  it("leaves the generated rows untouched", () => {
    mergeCorrections(ROWS, { sword: { quantity: 99, priceGp: 1 } });
    expect(ROWS[2]).toEqual(row("sword", 1, 15));
  });
});

describe("isCorrected", () => {
  it("reports nothing corrected when there is no overlay entry", () => {
    expect(isCorrected(ROWS[0], undefined)).toEqual({ quantity: false, price: false });
  });

  it("marks only the field that actually differs", () => {
    expect(isCorrected(ROWS[2], { priceGp: 20 })).toEqual({ quantity: false, price: true });
    expect(isCorrected(ROWS[2], { quantity: 3 })).toEqual({ quantity: true, price: false });
  });

  it("treats an override equal to the generated value as clean", () => {
    expect(isCorrected(ROWS[2], { quantity: 1, priceGp: 15 })).toEqual({ quantity: false, price: false });
  });
});

describe("hasCorrections — the confirmation dialog's trigger", () => {
  it("is false for an empty overlay", () => {
    expect(hasCorrections(ROWS, {})).toBe(false);
  });

  it("is true once any cell differs", () => {
    expect(hasCorrections(ROWS, { candle: { quantity: 0 } })).toBe(true);
    expect(hasCorrections(ROWS, { sword: { priceGp: 20 } })).toBe(true);
  });

  it("is false after a price is edited and typed back to the original", () => {
    const edited: CorrectionMap = { sword: { priceGp: 20 } };
    expect(hasCorrections(ROWS, edited)).toBe(true);

    const reverted: CorrectionMap = { sword: { priceGp: 15 } };
    expect(hasCorrections(ROWS, reverted)).toBe(false);
  });

  it("is false after a quantity is edited and typed back to the original", () => {
    expect(hasCorrections(ROWS, { candle: { quantity: 9 } })).toBe(true);
    expect(hasCorrections(ROWS, { candle: { quantity: 4 } })).toBe(false);
  });

  it("is false when a 0.5 gp price round-trips through the sp field it is displayed in", () => {
    // What the GM actually does: the cell shows "5 sp", they retype 5, and the
    // island converts back with partsToGp. Float equality would call this dirty.
    const { value, unit } = priceParts(ROWS[1].priceGp);
    expect(unit).toBe("sp");
    expect(hasCorrections(ROWS, { rope: { priceGp: partsToGp(value, unit) } })).toBe(false);
  });

  it("is false when a wealth-modified price round-trips through the field it is displayed in", () => {
    // The case raw float equality gets wrong. A 3 gp item in a `nędzna`
    // settlement is stored as 3 * 1.2 === 3.5999999999999996, renders as
    // "3,6 gp", and comes back from the field as exactly 3.6. Those two are
    // not the same double, so a float comparison would leave the row dirty
    // forever and fire the dialog over a shop the GM never corrected.
    const generated = 3 * 1.2;
    const modified = [row("lantern", 1, generated)];
    const { value, unit } = priceParts(generated);
    const retyped = partsToGp(value, unit);

    expect(retyped).not.toBe(generated);
    expect(hasCorrections(modified, { lantern: { priceGp: retyped } })).toBe(false);
  });

  it("is false when a 1 cp item marked up by wealth is retyped as the 1 cp it shows", () => {
    // The same trap at the catalog's floor: 0.01 * 1.2 === 0.012 renders as "1 cp".
    const modified = [row("candle", 4, 0.01 * 1.2)];
    expect(hasCorrections(modified, { candle: { priceGp: partsToGp(1, "cp") } })).toBe(false);
  });

  it("ignores a difference below 1 cp but not a difference of 1 cp", () => {
    expect(hasCorrections(ROWS, { rope: { priceGp: 0.502 } })).toBe(false);
    expect(hasCorrections(ROWS, { rope: { priceGp: 0.51 } })).toBe(true);
  });
});

describe("priceInUnit", () => {
  it("expresses a price in the unit it is told, not the one priceParts would pick", () => {
    // The pinned-unit case the plan accepts: a 1 cp candle corrected to 5 gp
    // stays in the cp field it started in and reads as 500.
    expect(priceInUnit(5, "cp")).toBe(500);
    expect(priceInUnit(0.01, "cp")).toBe(1);
    expect(priceInUnit(0.5, "sp")).toBe(5);
    expect(priceInUnit(15, "gp")).toBe(15);
  });

  it("shows a clean number for a wealth-modified price rather than float noise", () => {
    // 3 * 1.2 === 3.5999999999999996. A field showing that is unusable.
    expect(priceInUnit(3 * 1.2, "gp")).toBe(3.6);
    expect(priceInUnit(0.01 * 1.2, "cp")).toBe(1);
  });

  it("round-trips through partsToGp within the comparison grid", () => {
    // What the field actually does: display, GM retypes the same number, convert
    // back. The result must land on the same copper the dirty check compares on.
    for (const gp of [0.01, 0.01 * 1.2, 0.5, 3 * 1.2, 15, 21000]) {
      const { unit } = priceParts(gp);
      const back = partsToGp(priceInUnit(gp, unit), unit);
      expect(Math.round(back * 100)).toBe(Math.round(gp * 100));
    }
  });

  it("agrees with priceParts whenever the pinned unit is the one priceParts chose", () => {
    for (const gp of [0.01, 0.05, 0.5, 0.9, 1, 39, 1500, 21000]) {
      const { value, unit } = priceParts(gp);
      expect(priceInUnit(gp, unit)).toBe(value);
    }
  });
});

describe("parseDraft", () => {
  it("reads a blank or whitespace-only field as unusable, not as zero", () => {
    // Number("") is 0, which would silently commit a cleared field as "shelf cleared".
    expect(Number.isNaN(parseDraft(""))).toBe(true);
    expect(Number.isNaN(parseDraft("   "))).toBe(true);
  });

  it("reads a typed number", () => {
    expect(parseDraft(" 12 ")).toBe(12);
    expect(parseDraft("0")).toBe(0);
  });

  it("reads nonsense as unusable", () => {
    expect(Number.isNaN(parseDraft("abc"))).toBe(true);
  });
});

describe("clampQuantity", () => {
  it("accepts 0 — a shelf the players cleared out", () => {
    expect(clampQuantity(0)).toBe(0);
  });

  it("accepts the ceiling", () => {
    expect(clampQuantity(99)).toBe(99);
  });

  it("rejects everything unusable so the caller can snap back", () => {
    expect(clampQuantity(-1)).toBeNull();
    expect(clampQuantity(1.5)).toBeNull();
    expect(clampQuantity(100)).toBeNull();
    expect(clampQuantity(Number.NaN)).toBeNull();
    expect(clampQuantity(Number.POSITIVE_INFINITY)).toBeNull();
    expect(clampQuantity(parseDraft(""))).toBeNull();
  });
});

describe("clampPriceGp", () => {
  it("accepts the 1 cp floor, which matches formatPrice's own floor", () => {
    expect(clampPriceGp(0.01)).toBe(0.01);
  });

  it("accepts the ceiling, far above the catalog's 21 000 gp maximum", () => {
    expect(clampPriceGp(999999)).toBe(999999);
  });

  it("rejects everything outside the range so the caller can snap back", () => {
    expect(clampPriceGp(0)).toBeNull();
    expect(clampPriceGp(-1)).toBeNull();
    expect(clampPriceGp(1000000)).toBeNull();
    expect(clampPriceGp(Number.NaN)).toBeNull();
    expect(clampPriceGp(parseDraft(""))).toBeNull();
  });

  it("accepts the smallest price the cp field can produce", () => {
    expect(clampPriceGp(partsToGp(1, "cp"))).toBe(0.01);
  });
});
