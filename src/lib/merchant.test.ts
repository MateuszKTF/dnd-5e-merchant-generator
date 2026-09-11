import { describe, expect, it } from "vitest";

import { CATEGORIES, type CategoryId } from "@/data/items";

import type { AssortmentRow } from "./assortment";
import { autoName, fromStoredRows, newMerchantId, toStoredRows, type StoredRow, type UiRow } from "./merchant";

/**
 * `true` only when `A` and `B` accept each other's values. Wrapped in tuples so
 * a union on either side is compared as a whole instead of distributing.
 */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/**
 * The split between the stored format and the UI's row type is enforced here,
 * not asserted in prose.
 *
 * `merchant.ts` maps field by field and never imports `AssortmentRow`, which is
 * what keeps the persisted format still when S-01 moves. The cost of that
 * decoupling is that the mappers are identity functions today, so a round-trip
 * test proves nothing about the correspondence: add a field to `AssortmentRow`
 * and the mapper would drop it on save with every test still green — silent data
 * loss dressed as decoupling.
 *
 * These two lines are the guard. They fail to compile the moment either type
 * gains or loses a field, so whoever introduces the divergence has to decide
 * consciously whether the new field belongs in storage.
 */
const storedMatchesAssortment: MutuallyAssignable<StoredRow, AssortmentRow> = true;
const uiRowMatchesAssortment: MutuallyAssignable<UiRow, AssortmentRow> = true;

const ROWS: StoredRow[] = [
  { itemId: "longsword", name: "Longsword", rarity: "pospolite", quantity: 3, priceGp: 18 },
  { itemId: "potion-of-healing", name: "Potion of Healing", rarity: "niezwykłe", quantity: 1, priceGp: 0.06 },
];

describe("type contract", () => {
  it("keeps StoredRow, UiRow and AssortmentRow mutually assignable", () => {
    // The assertion is the `const` declarations above — this only keeps them
    // referenced so lint does not strip what type-checking depends on.
    expect(storedMatchesAssortment).toBe(true);
    expect(uiRowMatchesAssortment).toBe(true);
  });
});

describe("autoName", () => {
  const when = new Date(2026, 8, 11, 14, 32);

  it("names every category with its Polish label", () => {
    for (const { id, label } of CATEGORIES) {
      expect(autoName(id, when)).toContain(label);
    }
  });

  it("reads as a label followed by a day and a wall-clock time", () => {
    expect(autoName("kowal", when)).toBe("Kowal — 11.09.2026, 14:32");
  });

  it("zero-pads so names sort and scan in a narrow list", () => {
    expect(autoName("alchemik", new Date(2026, 0, 5, 9, 7))).toBe("Alchemik — 05.01.2026, 09:07");
  });

  it("distinguishes two merchants of the same category minutes apart", () => {
    const first = autoName("kowal", new Date(2026, 8, 11, 14, 32));
    const second = autoName("kowal", new Date(2026, 8, 11, 14, 35));

    expect(first).not.toBe(second);
  });

  it("distinguishes two categories saved at the same moment", () => {
    expect(autoName("kowal", when)).not.toBe(autoName("alchemik", when));
  });

  it("collides for two saves of one category inside the same minute", () => {
    // Documenting the known limit rather than pretending it does not exist:
    // minute precision is what a GM can read, and FR-010 lets them rename.
    const first = autoName("kowal", new Date(2026, 8, 11, 14, 32, 5));
    const second = autoName("kowal", new Date(2026, 8, 11, 14, 32, 55));

    expect(first).toBe(second);
  });

  it("falls back to the raw id if a category ever loses its label", () => {
    const unknown = "nieznana-kategoria" as CategoryId;

    expect(autoName(unknown, when)).toContain(unknown);
  });
});

describe("toStoredRows / fromStoredRows", () => {
  it("round-trips without loss", () => {
    expect(toStoredRows(fromStoredRows(ROWS))).toEqual(ROWS);
  });

  it("copies rather than aliasing, so a later edit cannot reach the source", () => {
    const stored = toStoredRows(ROWS);
    stored[0].quantity = 99;

    expect(ROWS[0].quantity).toBe(3);
  });

  it("preserves fractional prices exactly", () => {
    // 0.06 gp is a real catalog value once the nędzna multiplier lands on it;
    // any rounding in the mapper would show up as a price drifting per save.
    expect(fromStoredRows(ROWS)[1].priceGp).toBe(0.06);
  });
});

describe("newMerchantId", () => {
  it("returns a distinct id on every call", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newMerchantId()));

    expect(ids.size).toBe(100);
  });
});
