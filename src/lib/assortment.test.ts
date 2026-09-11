import { describe, expect, it } from "vitest";

import {
  AssortmentPoolError,
  generateAssortment,
  QUANTITY_BANDS,
  WEALTH_CONFIG,
  type AssortmentRow,
} from "./assortment";
import {
  CATEGORIES,
  ITEM_POOLS,
  RARITY_TIERS,
  WEALTH_LEVELS,
  type CatalogItem,
  type CategoryId,
  type Rarity,
} from "@/data/items";

const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
const WEALTH_IDS = WEALTH_LEVELS.map((w) => w.id);

/** Deterministic, well-spread pseudo-random so a failure is reproducible. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function countByTier(rows: readonly AssortmentRow[]): Record<Rarity, number> {
  const counts = { pospolite: 0, niezwykłe: 0, rzadkie: 0 } as Record<Rarity, number>;
  for (const row of rows) counts[row.rarity] += 1;
  return counts;
}

/** A pool with a deliberately shallow tier, to force the spill path. */
function shallowPool(depth: Record<Rarity, number>): Record<CategoryId, readonly CatalogItem[]> {
  const items: CatalogItem[] = [];
  for (const tier of RARITY_TIERS) {
    for (let i = 0; i < depth[tier]; i += 1) {
      items.push({ id: `${tier}-${i}`, name: `${tier} ${i}`, rarity: tier, priceGp: 10 });
    }
  }
  const pools = {} as Record<CategoryId, readonly CatalogItem[]>;
  for (const id of CATEGORY_IDS) pools[id] = items;
  return pools;
}

describe("generateAssortment — invariants across every category and wealth", () => {
  for (const category of CATEGORY_IDS) {
    for (const wealth of WEALTH_IDS) {
      describe(`${category} / ${wealth}`, () => {
        const config = WEALTH_CONFIG[wealth];
        const rows = generateAssortment(category, wealth, { rng: seeded(12345) });

        it("returns a row count inside the wealth band and the PRD's 10-25 envelope", () => {
          expect(rows.length).toBeGreaterThanOrEqual(config.size[0]);
          expect(rows.length).toBeLessThanOrEqual(config.size[1]);
          expect(rows.length).toBeGreaterThanOrEqual(10);
          expect(rows.length).toBeLessThanOrEqual(25);
        });

        it("never repeats an item (FR-004)", () => {
          const ids = rows.map((r) => r.itemId);
          expect(new Set(ids).size).toBe(ids.length);
        });

        it("draws only from the requested category's pool", () => {
          const poolIds = new Set(ITEM_POOLS[category].map((i) => i.id));
          for (const row of rows) expect(poolIds.has(row.itemId)).toBe(true);
        });

        it("matches the configured rarity mix after integer rounding", () => {
          const counts = countByTier(rows);
          for (const tier of RARITY_TIERS) {
            const expected = Math.round(config.mix[tier] * rows.length);
            // Rounding residual is corrected on one tier, so allow ±1.
            expect(Math.abs(counts[tier] - expected)).toBeLessThanOrEqual(1);
          }
          expect(counts.pospolite + counts.niezwykłe + counts.rzadkie).toBe(rows.length);
        });

        it("keeps every quantity inside its tier's band", () => {
          for (const row of rows) {
            const [min, max] = QUANTITY_BANDS[row.rarity];
            expect(row.quantity).toBeGreaterThanOrEqual(min);
            expect(row.quantity).toBeLessThanOrEqual(max);
          }
        });

        it("stocks exactly one of any rare item", () => {
          for (const row of rows.filter((r) => r.rarity === "rzadkie")) {
            expect(row.quantity).toBe(1);
          }
        });

        it("applies the wealth price multiplier to the catalog's base price", () => {
          const base = new Map(ITEM_POOLS[category].map((i) => [i.id, i.priceGp]));
          for (const row of rows) {
            const basePrice = base.get(row.itemId);
            expect(basePrice).toBeDefined();
            expect(row.priceGp).toBeCloseTo((basePrice ?? 0) * config.priceMultiplier, 10);
          }
        });
      });
    }
  }
});

describe("the nędzna zero-rare guarantee", () => {
  it("never surfaces a rare item, in any category, under any seed", () => {
    for (const category of CATEGORY_IDS) {
      for (let seed = 1; seed <= 50; seed += 1) {
        const rows = generateAssortment(category, "nędzna", { rng: seeded(seed) });
        expect(rows.filter((r) => r.rarity === "rzadkie")).toHaveLength(0);
      }
    }
  });

  it("holds when the common tier is short and the draw actually spills", () => {
    // Common cannot cover its ~70% quota, so the draw must spill — but common
    // and uncommon together can still fill the row count. A spill rule that
    // ignored eligibility would have rare (40 deep) available to reach for.
    const pools = shallowPool({ pospolite: 6, niezwykłe: 20, rzadkie: 40 });
    for (let seed = 1; seed <= 20; seed += 1) {
      const rows = generateAssortment("kowal", "nędzna", { rng: seeded(seed), pools });
      // Assert the spill genuinely happened: common ran out at 6.
      expect(rows.filter((r) => r.rarity === "pospolite").length).toBeLessThanOrEqual(6);
      expect(rows.length).toBeGreaterThanOrEqual(WEALTH_CONFIG.nędzna.size[0]);
      expect(rows.filter((r) => r.rarity === "rzadkie")).toHaveLength(0);
    }
  });

  it("refuses loudly rather than dipping into rare when the eligible tiers cannot cover it", () => {
    // Common + uncommon hold 7 items against a 10-15 row draw. Rare is deep,
    // so the only way to return a full table would be to violate the
    // guarantee. Throwing is the correct outcome.
    const pools = shallowPool({ pospolite: 4, niezwykłe: 3, rzadkie: 40 });
    expect(() => generateAssortment("kowal", "nędzna", { rng: seeded(1), pools })).toThrow(AssortmentPoolError);
  });
});

describe("the spill rule", () => {
  it("still returns a full row count when one tier is shallow", () => {
    const pools = shallowPool({ pospolite: 2, niezwykłe: 40, rzadkie: 40 });
    const rows = generateAssortment("kowal", "bogata", { rng: seeded(7), pools });
    expect(rows.length).toBeGreaterThanOrEqual(WEALTH_CONFIG.bogata.size[0]);
    expect(new Set(rows.map((r) => r.itemId)).size).toBe(rows.length);
  });

  it("prefers spilling downward from niezwykłe, per the preference table", () => {
    // Uncommon is starved; common is deep and rare is scarce. Overshooting
    // downward reads as a poorer shop — the milder lie.
    const pools = shallowPool({ pospolite: 40, niezwykłe: 1, rzadkie: 10 });
    const rows = generateAssortment("kowal", "typowa", { rng: seeded(3), pools });
    const counts = countByTier(rows);
    expect(counts.pospolite).toBeGreaterThan(Math.round(WEALTH_CONFIG.typowa.mix.pospolite * rows.length));
  });

  it("throws rather than returning a short table when nothing can supply the rows", () => {
    const pools = shallowPool({ pospolite: 3, niezwykłe: 2, rzadkie: 1 });
    expect(() => generateAssortment("kowal", "bogata", { rng: seeded(9), pools })).toThrow(AssortmentPoolError);
  });
});

describe("the recency bias", () => {
  it("shifts the draw without excluding anything", () => {
    const first = generateAssortment("kowal", "bogata", { rng: seeded(21) });
    const recentIds = first.map((r) => r.itemId);

    // Same seed, so any difference comes from the bias rather than the rng.
    const biased = generateAssortment("kowal", "bogata", { rng: seeded(21), recentIds });
    const unbiased = generateAssortment("kowal", "bogata", { rng: seeded(21) });

    const overlapOf = (rows: AssortmentRow[]) => rows.filter((r) => recentIds.includes(r.itemId)).length;

    expect(overlapOf(biased)).toBeLessThan(overlapOf(unbiased));
  });

  it("can still fill a tier the recent list covers entirely", () => {
    // The bias must be a weight, not a filter: bogata + a 10-deep rare tier
    // needs every rare item even when all ten were just drawn.
    const pools = shallowPool({ pospolite: 40, niezwykłe: 40, rzadkie: 10 });
    const recentIds = Array.from({ length: 10 }, (_, i) => `rzadkie-${i}`);
    const rows = generateAssortment("kowal", "bogata", { rng: seeded(5), pools, recentIds });
    expect(rows.length).toBeGreaterThanOrEqual(WEALTH_CONFIG.bogata.size[0]);
  });
});
