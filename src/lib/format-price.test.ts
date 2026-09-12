import { describe, expect, it } from "vitest";

import {
  formatPrice,
  isRenderablePrice,
  partsToGp,
  priceParts,
  UNRENDERABLE_PRICE,
  type PriceUnit,
} from "./format-price";

/**
 * The catalog's real span, plus the value that motivated the 1 cp floor:
 * `towary-ogolne` holds items at 0.01 gp, and the `nędzna` multiplier (1.2)
 * leaves them fractional.
 */
const BOUNDARIES = [0.01, 0.01 * 1.2, 0.05, 0.1, 0.5, 0.9, 1, 39, 1500, 21000];

describe("priceParts", () => {
  it("renders below 0.1 gp as whole copper", () => {
    expect(priceParts(0.01)).toEqual({ value: 1, unit: "cp" });
    expect(priceParts(0.05)).toEqual({ value: 5, unit: "cp" });
    expect(priceParts(0.099)).toEqual({ value: 10, unit: "cp" });
  });

  it("renders below 1 gp as silver", () => {
    expect(priceParts(0.1)).toEqual({ value: 1, unit: "sp" });
    expect(priceParts(0.5)).toEqual({ value: 5, unit: "sp" });
    expect(priceParts(0.9)).toEqual({ value: 9, unit: "sp" });
  });

  it("renders 1 gp and above as gold", () => {
    expect(priceParts(1)).toEqual({ value: 1, unit: "gp" });
    expect(priceParts(39)).toEqual({ value: 39, unit: "gp" });
    expect(priceParts(21000)).toEqual({ value: 21000, unit: "gp" });
  });

  it("never yields a zero value, however small the input", () => {
    for (const gp of [0, 0.0001, 0.001, 0.004]) {
      expect(priceParts(gp).value).toBeGreaterThan(0);
    }
  });

  it("clamps non-finite input to the floor rather than producing NaN", () => {
    expect(priceParts(Number.NaN).value).toBeGreaterThan(0);
    expect(priceParts(Number.POSITIVE_INFINITY).value).toBeGreaterThan(0);
  });
});

describe("partsToGp", () => {
  it("round-trips priceParts to within 1 cp across the catalog's range", () => {
    for (const gp of BOUNDARIES) {
      const { value, unit } = priceParts(gp);
      expect(Math.abs(partsToGp(value, unit) - gp)).toBeLessThanOrEqual(0.01);
    }
  });

  it("inverts each unit exactly", () => {
    const cases: [number, PriceUnit, number][] = [
      [5, "cp", 0.05],
      [5, "sp", 0.5],
      [5, "gp", 5],
    ];
    for (const [value, unit, expected] of cases) {
      expect(partsToGp(value, unit)).toBeCloseTo(expected, 10);
    }
  });
});

describe("formatPrice", () => {
  it("never renders a bare zero", () => {
    for (const gp of BOUNDARIES) {
      expect(formatPrice(gp)).not.toMatch(/^0\s/);
    }
  });

  it("agrees with priceParts at every threshold", () => {
    for (const gp of BOUNDARIES) {
      const { unit } = priceParts(gp);
      expect(formatPrice(gp).endsWith(unit)).toBe(true);
    }
  });

  it("carries the unit a table would speak", () => {
    expect(formatPrice(0.01)).toContain("cp");
    expect(formatPrice(0.5)).toContain("sp");
    expect(formatPrice(1500)).toContain("gp");
  });

  it("separates thousands so a 21000 gp item stays legible", () => {
    // pl-PL groups thousands, so the digits must not run together.
    expect(formatPrice(21000)).not.toContain("21000");
  });

  it("refuses to launder a wrong price into a plausible cheap one", () => {
    // Clamping these down to the 1 cp floor would show a definite, believable
    // price where the truth is "wrong" or "unbounded".
    for (const gp of [-5, -0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatPrice(gp)).toBe(UNRENDERABLE_PRICE);
      expect(isRenderablePrice(gp)).toBe(false);
    }
  });

  it("still renders every real catalog price", () => {
    for (const gp of BOUNDARIES) {
      expect(isRenderablePrice(gp)).toBe(true);
      expect(formatPrice(gp)).not.toBe(UNRENDERABLE_PRICE);
    }
  });
});
