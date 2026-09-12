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
  type Wealth,
} from "@/data/items";

const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
const WEALTH_IDS = WEALTH_LEVELS.map((w) => w.id);

/** Deterministic, well-spread pseudo-random so a failure is reproducible. */
function seeded(seed: number): () => number {
  // Hash the seed before use. Without this the LCG's increment dominates for
  // small seeds, so consecutive seeds all start within ~0.02 of each other and
  // a "50 seeds" sweep explores exactly one drawn size.
  let state = Math.imul(seed, 2654435761) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** An rng whose first value is pinned, so a test can choose the drawn size. */
function rngWithFirst(first: number, seed = 1): () => number {
  const rest = seeded(seed);
  let spent = false;
  return () => {
    if (spent) return rest();
    spent = true;
    return first;
  };
}

/** The size the draw will pick for this wealth given the first rng value. */
function sizeFor(wealth: Wealth, first: number): number {
  const [min, max] = WEALTH_CONFIG[wealth].size;
  return min + Math.floor(first * (max - min + 1));
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
            if (config.mix[tier] === 0) {
              // A zero share is "never", not "rarely" — no ±1 slack here, or
              // this assertion would happily accept one rare item in a hamlet.
              expect(counts[tier]).toBe(0);
              continue;
            }
            const expected = Math.round(config.mix[tier] * rows.length);
            // Rounding residual is corrected on one tier, so allow ±1.
            expect(Math.abs(counts[tier] - expected)).toBeLessThanOrEqual(1);
          }
          // Not `counts` summed against itself — that holds by construction.
          // The real invariant is that the draw filled the size it picked.
          expect(rows.length).toBe(sizeFor(wealth, seeded(12345)()));
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

/**
 * The sweeps above draw whatever size their seed happens to pick. These pin the
 * size deliberately: the sizes where `allocateQuotas` has a rounding residual to
 * correct (15, 19, 21, 22) and the top of every band, which the module claims is
 * feasible against real pool depth but which no seeded sweep actually reaches.
 */
describe("quota allocation at pinned sizes", () => {
  const CASES = [
    { wealth: "nędzna", first: 0.9, expected: 15, note: "residual + band top" },
    { wealth: "typowa", first: 0.75, expected: 19, note: "residual" },
    { wealth: "typowa", first: 0.9, expected: 20, note: "band top" },
    { wealth: "bogata", first: 0.2, expected: 19, note: "residual" },
    { wealth: "bogata", first: 0.45, expected: 21, note: "residual" },
    { wealth: "bogata", first: 0.55, expected: 22, note: "residual" },
    { wealth: "bogata", first: 0.95, expected: 25, note: "band top" },
  ] as const;

  for (const { wealth, first, expected, note } of CASES) {
    for (const category of CATEGORY_IDS) {
      it(`${category} / ${wealth} fills exactly ${expected} unique rows (${note})`, () => {
        expect(sizeFor(wealth, first)).toBe(expected);

        const rows = generateAssortment(category, wealth, { rng: rngWithFirst(first) });

        expect(rows.length).toBe(expected);
        expect(new Set(rows.map((row) => row.itemId)).size).toBe(expected);

        const counts = countByTier(rows);
        for (const tier of RARITY_TIERS) {
          if (WEALTH_CONFIG[wealth].mix[tier] === 0) expect(counts[tier]).toBe(0);
        }
      });
    }
  }
});

describe("WEALTH_CONFIG itself", () => {
  it("gives every wealth level eligible shares that sum to 1", () => {
    // allocateQuotas rounds each share against `size` and corrects the residual
    // on one tier. If a row summed to 0.9, the whole shortfall would silently
    // land on that tier instead of being spread.
    for (const wealth of WEALTH_IDS) {
      const mix = WEALTH_CONFIG[wealth].mix;
      const sum = RARITY_TIERS.filter((tier) => mix[tier] > 0).reduce((total, tier) => total + mix[tier], 0);
      expect(sum).toBeCloseTo(1, 10);
    }
  });
});

describe("a degenerate rng", () => {
  it("stays inside every band even when the rng returns exactly 1", () => {
    const rows = generateAssortment("kowal", "bogata", { rng: () => 1 });

    expect(rows.length).toBeLessThanOrEqual(WEALTH_CONFIG.bogata.size[1]);
    for (const row of rows) {
      expect(row.quantity).toBeLessThanOrEqual(QUANTITY_BANDS[row.rarity][1]);
    }
    for (const row of rows.filter((r) => r.rarity === "rzadkie")) {
      expect(row.quantity).toBe(1);
    }
  });
});

describe("unknown inputs", () => {
  it("throws branded, not a raw TypeError, for a retired category id", () => {
    expect(() => generateAssortment("zielarz" as CategoryId, "typowa")).toThrow(AssortmentPoolError);
  });

  it("throws branded, not a raw TypeError, for a retired wealth id", () => {
    expect(() => generateAssortment("kowal", "książęca" as Wealth)).toThrow(AssortmentPoolError);
  });
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

  it("refuses a pool too small to fill the drawn size at all", () => {
    // This trips the pre-flight check, not the spill-exhaustion throw. Assert
    // the message so the two cannot be confused — they are different bugs.
    const pools = shallowPool({ pospolite: 3, niezwykłe: 2, rzadkie: 1 });
    expect(() => generateAssortment("kowal", "bogata", { rng: seeded(9), pools })).toThrow(
      /holds 6 items but \d+ unique rows were requested/,
    );
  });

  it("throws from the spill rule when the eligible tiers cannot supply the rows", () => {
    // Total depth clears the pre-flight check (47 items), but rare is
    // ineligible under nędzna, so the 7 eligible items cannot reach 10 rows.
    const pools = shallowPool({ pospolite: 3, niezwykłe: 4, rzadkie: 40 });
    expect(() => generateAssortment("kowal", "nędzna", { rng: rngWithFirst(0), pools })).toThrow(
      /no eligible tier could supply/,
    );
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
    // The bias must be a weight, not a filter: bogata at 25 rows needs a rare
    // quota of 10 against a 10-deep rare tier, so every rare item has to be
    // drawn even though all ten were just drawn. Pin the size — a row-count
    // assertion alone passes even if rare is excluded, because spill would
    // quietly refill from the 40-deep tiers.
    const pools = shallowPool({ pospolite: 40, niezwykłe: 40, rzadkie: 10 });
    const recentIds = Array.from({ length: 10 }, (_, i) => `rzadkie-${i}`);

    const rows = generateAssortment("kowal", "bogata", {
      rng: rngWithFirst(0.95),
      pools,
      recentIds,
    });

    expect(rows.length).toBe(25);
    expect(countByTier(rows).rzadkie).toBe(10);
  });
});
