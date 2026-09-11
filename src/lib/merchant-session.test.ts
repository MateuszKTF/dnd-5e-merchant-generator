import { describe, expect, it } from "vitest";

import { CATEGORIES, WEALTH_LEVELS, type CategoryId, type Wealth } from "@/data/items";

import type { Merchant, StoredRow } from "./merchant";
import {
  isKnownCategory,
  isKnownWealth,
  nextSaveState,
  restoreFromDocument,
  SAVE_EVENTS,
  SAVE_STATES,
  type SaveState,
} from "./merchant-session";
import { SCHEMA_VERSION, type StorageDocument } from "./merchant-storage";

const ROWS: StoredRow[] = [
  { itemId: "longsword", name: "Longsword", rarity: "pospolite", quantity: 3, priceGp: 18 },
  { itemId: "potion-of-healing", name: "Potion of Healing", rarity: "niezwykłe", quantity: 1, priceGp: 50 },
];

function merchant(overrides: Partial<Merchant> = {}): Merchant {
  return {
    id: "m-1",
    name: "Kowal — 11.09.2026, 14:32",
    category: "kowal",
    wealth: "bogata",
    createdAt: "2026-09-11T12:32:00.000Z",
    savedAt: null,
    rows: ROWS,
    corrections: { longsword: { priceGp: 20 } },
    ...overrides,
  };
}

function documentWith(transient: Merchant | null): StorageDocument {
  return { schemaVersion: SCHEMA_VERSION, transient, saved: [] };
}

/**
 * A category this build has never heard of.
 *
 * The assertion goes through a `string`-typed parameter because that is the
 * honest provenance: the value comes back from `JSON.parse`, where a renamed
 * or removed category is an ordinary possibility the type system cannot see.
 */
function asCategory(value: string): CategoryId {
  return value as CategoryId;
}

function asWealth(value: string): Wealth {
  return value as Wealth;
}

describe("restoreFromDocument", () => {
  it("returns null when the document holds no transient merchant", () => {
    expect(restoreFromDocument(documentWith(null))).toBeNull();
  });

  it("returns null when the transient record has no rows to render", () => {
    // The hand-edited `"transient": {}` case. F-01 validates the document, not
    // the merchant inside it, so this really does read back as `ok` — and a
    // `.map` over an absent `rows` inside a mount effect would blank the page.
    const malformed = { ...merchant(), rows: undefined as unknown as StoredRow[] };

    expect(restoreFromDocument(documentWith(malformed))).toBeNull();
  });

  it("derives both controls from the restored merchant", () => {
    const restored = restoreFromDocument(documentWith(merchant()));

    expect(restored).not.toBeNull();
    expect(restored?.category).toBe("kowal");
    expect(restored?.wealth).toBe("bogata");
    expect(restored?.categoryWasReset).toBe(false);
    expect(restored?.wealthWasReset).toBe(false);
  });

  it("hands back the merchant untouched, corrections included", () => {
    const stored = merchant();
    const restored = restoreFromDocument(documentWith(stored));

    expect(restored?.merchant).toBe(stored);
    expect(restored?.merchant.corrections).toEqual({ longsword: { priceGp: 20 } });
  });

  it("seeds recentIds with exactly the restored row ids, in order", () => {
    const restored = restoreFromDocument(documentWith(merchant()));

    expect(restored?.recentIds).toEqual(["longsword", "potion-of-healing"]);
  });

  it("resets an unknown category to the default and says so", () => {
    const restored = restoreFromDocument(documentWith(merchant({ category: asCategory("kowalstwo-krasnoludzkie") })));

    expect(restored?.category).toBe(CATEGORIES[0].id);
    expect(restored?.categoryWasReset).toBe(true);
  });

  it("keeps the rows and the other control when the category is unknown", () => {
    // The point of the reset: a renamed category degrades one `select`, not the
    // merchant. Rows are self-contained, so the table still renders.
    const restored = restoreFromDocument(documentWith(merchant({ category: asCategory("kowalstwo-krasnoludzkie") })));

    expect(restored?.merchant.rows).toEqual(ROWS);
    expect(restored?.wealth).toBe("bogata");
    expect(restored?.wealthWasReset).toBe(false);
  });

  it("resets an unknown wealth to the default and says so", () => {
    const restored = restoreFromDocument(documentWith(merchant({ wealth: asWealth("książęca") })));

    expect(restored?.wealth).toBe(WEALTH_LEVELS[0].id);
    expect(restored?.wealthWasReset).toBe(true);
  });

  it("keeps the rows and the other control when the wealth is unknown", () => {
    const restored = restoreFromDocument(documentWith(merchant({ wealth: asWealth("książęca") })));

    expect(restored?.merchant.rows).toEqual(ROWS);
    expect(restored?.category).toBe("kowal");
    expect(restored?.categoryWasReset).toBe(false);
  });

  it("survives both enums going stale at once", () => {
    const stale = merchant({ category: asCategory("nieznana"), wealth: asWealth("nieznana") });
    const restored = restoreFromDocument(documentWith(stale));

    expect(restored?.category).toBe(CATEGORIES[0].id);
    expect(restored?.wealth).toBe(WEALTH_LEVELS[0].id);
    expect(restored?.merchant.rows).toEqual(ROWS);
  });
});

describe("isKnownCategory / isKnownWealth", () => {
  it("accepts every member of the catalog", () => {
    for (const { id } of CATEGORIES) {
      expect(isKnownCategory(id)).toBe(true);
    }
    for (const { id } of WEALTH_LEVELS) {
      expect(isKnownWealth(id)).toBe(true);
    }
  });

  it("rejects strings that are not members", () => {
    // `""` and a near-miss casing matter: both are shapes a hand-edited
    // document plausibly holds, and `some` must not be fooled by either.
    const strangers = ["", "Kowal", "kowale", "bogata ", "przedmioty_magiczne"];

    for (const value of strangers) {
      expect(isKnownCategory(value)).toBe(false);
      expect(isKnownWealth(value)).toBe(false);
    }
  });

  it("does not confuse the two enums", () => {
    expect(isKnownCategory("bogata")).toBe(false);
    expect(isKnownWealth("kowal")).toBe(false);
  });

  it("narrows to the union, not to string", () => {
    // The assertion is the assignment: it only compiles if the predicate
    // narrowed `string` down to `CategoryId` / `Wealth`.
    const candidates = ["kowal", "bogata"];

    for (const value of candidates) {
      if (isKnownCategory(value)) {
        const narrowed: CategoryId = value;
        expect(narrowed).toBe("kowal");
      }
      if (isKnownWealth(value)) {
        const narrowed: Wealth = value;
        expect(narrowed).toBe("bogata");
      }
    }
  });
});

describe("nextSaveState", () => {
  it("answers for every event from every state", () => {
    const visited: SaveState[] = [];

    for (const state of SAVE_STATES) {
      for (const event of SAVE_EVENTS) {
        visited.push(nextSaveState(state, event));
      }
    }

    // The count is asserted, not just the membership: a table with a hole would
    // push `undefined` and still satisfy a loop that never checks it ran.
    expect(visited).toHaveLength(SAVE_STATES.length * SAVE_EVENTS.length);
    for (const result of visited) {
      expect(SAVE_STATES).toContain(result);
    }
  });

  it("leaves a failed promote armed", () => {
    // The rule the whole module exists for: nothing was written, so the button
    // must still invite the retry rather than claim the save happened.
    expect(nextSaveState("armed", "promote-failed")).toBe("armed");
  });

  it("reaches saved only by an actual promote", () => {
    for (const state of SAVE_STATES) {
      if (state === "saved") continue;

      for (const event of SAVE_EVENTS) {
        if (event === "promoted") continue;

        expect(nextSaveState(state, event)).not.toBe("saved");
      }
    }
  });

  it("moves armed to saved on a successful promote", () => {
    expect(nextSaveState("armed", "promoted")).toBe("saved");
  });

  it("re-arms from saved when the merchant changes", () => {
    // A corrected price makes the saved copy stale, so the GM must be able to
    // save again — FR-009's durability marker tracks the merchant, not the click.
    expect(nextSaveState("saved", "corrected")).toBe("armed");
    expect(nextSaveState("saved", "generated")).toBe("armed");
  });

  it("arms from the empty state on a generate or a restore", () => {
    expect(nextSaveState("unavailable", "generated")).toBe("armed");
    expect(nextSaveState("unavailable", "restored")).toBe("armed");
  });

  it("stands persistence down from any state", () => {
    for (const state of SAVE_STATES) {
      expect(nextSaveState(state, "persistence-off")).toBe("stood-down");
    }
  });

  it("never leaves stood-down", () => {
    // Absorbing on purpose: F-01 latches read-only for the rest of the page
    // load on `future-version`, so a later Generate must not re-arm a button
    // whose press cannot succeed.
    for (const event of SAVE_EVENTS) {
      expect(nextSaveState("stood-down", event)).toBe("stood-down");
    }
  });
});
