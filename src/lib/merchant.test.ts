import { afterEach, describe, expect, it } from "vitest";

import { CATEGORIES, type CategoryId } from "@/data/items";

import type { AssortmentRow } from "./assortment";
import {
  autoName,
  formatWallClock,
  fromStoredCorrections,
  fromStoredRows,
  isMerchant,
  isStoredRow,
  newMerchantId,
  toStoredCorrections,
  toStoredRows,
  type StoredRow,
  type UiRow,
} from "./merchant";

/**
 * `true` only when `A` and `B` accept each other's values. Wrapped in tuples so
 * a union on either side is compared as a whole instead of distributing.
 */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/**
 * `true` only when `A` and `B` have exactly the same keys.
 *
 * Assignability alone is not enough, and the gap is the likely one: add an
 * **optional** field to `AssortmentRow` and both directions still hold — a
 * missing optional property is assignable, and an extra one is assignable
 * outside object-literal freshness — while `toStoredRows` maps field by field
 * and drops it on every save. Optional is how a UI type normally grows, so
 * without this the guard would miss the exact divergence it exists to catch.
 *
 * The two checks are complementary, not alternatives: this one catches a
 * added or removed key, {@link MutuallyAssignable} catches a changed type on a
 * key that stays.
 */
type SameKeys<A, B> = [Exclude<keyof A, keyof B>] extends [never]
  ? [Exclude<keyof B, keyof A>] extends [never]
    ? true
    : never
  : never;

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
 * These four lines are the guard, and they need both halves: assignability
 * alone lets an *optional* new field through (verified — it produces zero type
 * errors while the mapper drops it on every save), and key-exactness alone
 * would miss a changed type on a key that stays. Together they fail to compile
 * the moment either type gains, loses or retypes a field, so whoever introduces
 * the divergence has to decide consciously whether it belongs in storage.
 *
 * They are only worth anything because CI now runs `npm run typecheck` — Vitest
 * transpiles without type-checking, so `npm test` cannot see any of this.
 */
const storedMatchesAssortment: MutuallyAssignable<StoredRow, AssortmentRow> = true;
const uiRowMatchesAssortment: MutuallyAssignable<UiRow, AssortmentRow> = true;
const storedKeysMatchAssortment: SameKeys<StoredRow, AssortmentRow> = true;
const uiRowKeysMatchAssortment: SameKeys<UiRow, AssortmentRow> = true;

const ROWS: StoredRow[] = [
  { itemId: "longsword", name: "Longsword", rarity: "pospolite", quantity: 3, priceGp: 18 },
  { itemId: "potion-of-healing", name: "Potion of Healing", rarity: "niezwykłe", quantity: 1, priceGp: 0.06 },
];

describe("type contract", () => {
  // Named for what it does, not for what the file guarantees. The guarantee is
  // the four `const` declarations above, and only `npm run typecheck` can see
  // it fail — this case cannot, because each const is literally `= true`. A
  // green line here must not be read as the contract holding.
  it("keeps the type-contract assertions referenced (the real check is `npm run typecheck`)", () => {
    expect(storedMatchesAssortment).toBe(true);
    expect(uiRowMatchesAssortment).toBe(true);
    expect(storedKeysMatchAssortment).toBe(true);
    expect(uiRowKeysMatchAssortment).toBe(true);
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

  it("degrades to the bare label rather than naming a merchant NaN", () => {
    // The name is persisted, and a GM cannot fix what they cannot read.
    expect(autoName("kowal", new Date("not a date"))).toBe("Kowal");
  });
});

describe("formatWallClock", () => {
  it("is the exact shape autoName bakes into a name", () => {
    // The library renders this beside a name built from the same helper, so the
    // two must agree character for character.
    const when = new Date(2026, 8, 11, 20, 15);

    expect(formatWallClock(when)).toBe("11.09.2026, 20:15");
    expect(autoName("kowal", when)).toBe(`Kowal — ${formatWallClock(when)}`);
  });

  it("returns null for an unusable date instead of a string of NaNs", () => {
    expect(formatWallClock(new Date("not a date"))).toBeNull();
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

describe("toStoredCorrections / fromStoredCorrections", () => {
  it("round-trips a mixed overlay without loss", () => {
    const overlay = { longsword: { quantity: 7 }, rope: { priceGp: 0.5 }, both: { quantity: 1, priceGp: 2 } };

    expect(fromStoredCorrections(toStoredCorrections(overlay))).toEqual(overlay);
  });

  it("drops an entry that is present but undefined", () => {
    // Both maps type their values `| undefined` because most rows have no
    // entry, but an explicit `undefined` must not be *written* — a key present
    // with no correction is not the same statement as a key that is absent.
    const overlay = { longsword: undefined, rope: { quantity: 2 } };

    expect(toStoredCorrections(overlay)).toEqual({ rope: { quantity: 2 } });
  });

  it("keeps an absent field absent rather than writing undefined", () => {
    // Dirty detection reads "never touched" from the absence itself, so an
    // explicit `priceGp: undefined` would be a different statement.
    // `toStrictEqual`, not `toEqual`: only the strict form distinguishes an
    // absent key from one present and undefined, which is the whole assertion.
    expect(toStoredCorrections({ rope: { quantity: 2 } })).toStrictEqual({ rope: { quantity: 2 } });
  });

  it("keeps a corrected value of 0, which is legal and means the shelf cleared", () => {
    expect(toStoredCorrections({ rope: { quantity: 0 } })).toEqual({ rope: { quantity: 0 } });
  });

  it("copies rather than aliasing, in both directions", () => {
    const overlay = { rope: { quantity: 2 } };
    const stored = toStoredCorrections(overlay);

    const entry = stored.rope;
    if (!entry) throw new Error("expected the entry to survive the mapping");

    entry.quantity = 99;
    expect(overlay.rope.quantity).toBe(2);

    const back = fromStoredCorrections(stored);
    entry.quantity = 7;

    expect(back.rope?.quantity).toBe(99);
  });
});

describe("isMerchant / isStoredRow", () => {
  const merchant = {
    id: "m-1",
    name: "Kowal",
    category: "kowal",
    wealth: "przecietna",
    createdAt: "2026-09-11T18:15:00.000Z",
    savedAt: null,
    rows: ROWS,
    corrections: {},
  };

  it("accepts a well-formed merchant, saved or transient", () => {
    expect(isMerchant(merchant)).toBe(true);
    expect(isMerchant({ ...merchant, savedAt: "2026-09-11T18:20:00.000Z" })).toBe(true);
  });

  it("rejects the shapes a hand-edited or older document actually produces", () => {
    // `rows: undefined` is the one both downstream modules had each guarded
    // against on their own — `.map`/`.length` on it throws inside a render.
    expect(isMerchant({ ...merchant, rows: undefined })).toBe(false);
    expect(isMerchant({ ...merchant, rows: [{ itemId: "x" }] })).toBe(false);
    expect(isMerchant({ ...merchant, savedAt: 0 })).toBe(false);
    expect(isMerchant({ ...merchant, corrections: null })).toBe(false);
    expect(isMerchant(null)).toBe(false);
    expect(isMerchant("a merchant, honestly")).toBe(false);
  });

  it("keeps a merchant whose category or rarity this build does not know", () => {
    // The forward-only rule: a newer build's vocabulary must not cost the GM
    // their saved work, so these are checked as strings, not for membership.
    expect(isMerchant({ ...merchant, category: "zielarz" })).toBe(true);
    expect(isMerchant({ ...merchant, rows: [{ ...ROWS[0], rarity: "legendarne" }] })).toBe(true);
  });

  it("rejects a row missing a numeric price, which would render as blank", () => {
    expect(isStoredRow({ ...ROWS[0], priceGp: "18" })).toBe(false);
    expect(isStoredRow({ ...ROWS[0] })).toBe(true);
  });
});

describe("newMerchantId", () => {
  it("returns a distinct id on every call", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newMerchantId()));

    expect(ids.size).toBe(100);
  });

  // `randomUUID` is [SecureContext]: over plain http — `astro dev --host` to a
  // phone — it is simply absent. A bare call would throw inside the generate
  // handler's try and make every Generate look like a pool failure, so both
  // degraded paths have to actually produce ids.
  describe("without crypto.randomUUID", () => {
    const real = globalThis.crypto;

    afterEach(() => {
      Object.defineProperty(globalThis, "crypto", { value: real, configurable: true });
    });

    function stubCrypto(value: unknown) {
      Object.defineProperty(globalThis, "crypto", { value, configurable: true });
    }

    it("falls back to a v4 built from getRandomValues", () => {
      stubCrypto({ getRandomValues: real.getRandomValues.bind(real) });

      const ids = new Set(Array.from({ length: 100 }, () => newMerchantId()));

      expect(ids.size).toBe(100);
      for (const id of ids) {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      }
    });

    it("still returns something unique when crypto is missing entirely", () => {
      stubCrypto(undefined);

      const ids = new Set(Array.from({ length: 100 }, () => newMerchantId()));

      expect(ids.size).toBe(100);
      // Deliberately not UUID-shaped — it cannot make that promise.
      expect([...ids][0]).toMatch(/^m-[0-9a-z]+-[0-9a-z]+$/);
    });
  });
});
