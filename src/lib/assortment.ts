/**
 * The assortment rule: how a category and a settlement's wealth become a
 * shop's stock.
 *
 * Pure — no React, no Astro, no storage. It runs in the browser (AGENTS.md:
 * the Workers free tier caps CPU at 10 ms, and server-side sampling would aim
 * that ceiling at the PRD's "under 5 seconds" criterion).
 */

import { ITEM_POOLS, RARITY_TIERS, type CatalogItem, type CategoryId, type Rarity, type Wealth } from "@/data/items";

/**
 * One row of a generated shop.
 *
 * `priceGp` is the wealth-modified price, unrounded — formatting belongs to
 * the caller (see `format-price.ts`). This shape is a contract surface:
 * `MerchantTable` renders it, S-02 makes `quantity` and `priceGp` editable,
 * and F-01 mirrors it in storage. Renaming a field here is expensive.
 */
export interface AssortmentRow {
  readonly itemId: string;
  readonly name: string;
  readonly rarity: Rarity;
  readonly quantity: number;
  readonly priceGp: number;
}

/** Thrown when no eligible tier can supply the rows a draw still needs. */
export class AssortmentPoolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssortmentPoolError";
  }
}

/**
 * Everything wealth controls, in one table.
 *
 * Wealth drives three outputs and they are tuned together:
 *   - `size`     how many rows (a poor village runs a smaller shop)
 *   - `mix`      the rarity proportions
 *   - `priceMultiplier`  scarcity markup — a backwater charges more, a rich
 *                port less, which is the standard frontier-post trope
 *
 * A `0` share is not "rarely" — it is *never*. `nędzna` cannot surface a rare
 * item at all, which is the decision that closes PRD Open Question #3 (a rare
 * item priced beyond an entire destitute village). See `eligibleTiers`.
 *
 * These numbers are feasible against real pool depth at the top of every size
 * band; the spill rule below is a safety net for a future `npm run data:build`
 * that reshuffles tier depth, not a hot path.
 */
export const WEALTH_CONFIG: Record<
  Wealth,
  {
    readonly size: readonly [number, number];
    readonly mix: Record<Rarity, number>;
    readonly priceMultiplier: number;
  }
> = {
  nędzna: {
    size: [10, 15],
    mix: { pospolite: 0.7, niezwykłe: 0.3, rzadkie: 0 },
    priceMultiplier: 1.2,
  },
  typowa: {
    size: [14, 20],
    mix: { pospolite: 0.45, niezwykłe: 0.35, rzadkie: 0.2 },
    priceMultiplier: 1.0,
  },
  bogata: {
    size: [18, 25],
    mix: { pospolite: 0.25, niezwykłe: 0.35, rzadkie: 0.4 },
    priceMultiplier: 0.9,
  },
};

/**
 * How deep the stock runs, by tier.
 *
 * A smith holds a dozen nails and one masterwork blade. Banding by rarity
 * keeps the table honest without a separate input — and guarantees no
 * "7× Amulet of the Planes".
 */
export const QUANTITY_BANDS: Record<Rarity, readonly [number, number]> = {
  pospolite: [2, 12],
  niezwykłe: [1, 4],
  rzadkie: [1, 1],
};

/**
 * Where a tier's shortfall goes when its pool runs dry.
 *
 * `niezwykłe` prefers `pospolite` over `rzadkie`: overshooting downward reads
 * as a poorer shop, a milder lie than a backwater stocking rare goods.
 * Ineligible (zero-share) tiers are skipped in every row.
 */
const SPILL_ORDER: Record<Rarity, readonly Rarity[]> = {
  pospolite: ["niezwykłe", "rzadkie"],
  niezwykłe: ["pospolite", "rzadkie"],
  rzadkie: ["niezwykłe", "pospolite"],
};

/** How much less likely a recently-drawn item is to reappear. */
const RECENT_WEIGHT = 0.15;

export interface GenerateOptions {
  /** Item ids from the previous draw for this shop; biased against, never excluded. */
  readonly recentIds?: readonly string[];
  /** Injectable for deterministic tests. Defaults to `Math.random`. */
  readonly rng?: () => number;
  /** Injectable pools, for exercising the spill path against shallow tiers. */
  readonly pools?: Record<CategoryId, readonly CatalogItem[]>;
}

/**
 * Draw a shop's stock for a category at a wealth level.
 *
 * Every row is a distinct item (FR-004); depth lives in the quantity column.
 */
export function generateAssortment(category: CategoryId, wealth: Wealth, opts: GenerateOptions = {}): AssortmentRow[] {
  const { recentIds = [], rng = Math.random, pools = ITEM_POOLS } = opts;
  const config = WEALTH_CONFIG[wealth];
  const pool = pools[category];

  const size = randomInt(config.size[0], config.size[1], rng);
  if (pool.length < size) {
    throw new AssortmentPoolError(
      `Pool "${category}" holds ${pool.length} items but ${size} unique rows were requested.`,
    );
  }

  const recent = new Set(recentIds);
  const byTier = groupByTier(pool);
  const quotas = allocateQuotas(size, config.mix);

  const picked: CatalogItem[] = [];
  for (const tier of RARITY_TIERS) {
    drawFromTier(tier, quotas[tier], byTier, picked, recent, config.mix, rng);
  }

  return picked.map((item) => ({
    itemId: item.id,
    name: item.name,
    rarity: item.rarity,
    quantity: randomInt(QUANTITY_BANDS[item.rarity][0], QUANTITY_BANDS[item.rarity][1], rng),
    priceGp: item.priceGp * config.priceMultiplier,
  }));
}

/**
 * Split `size` across the tiers so the parts sum to exactly `size`.
 *
 * Rounding each share independently can land one over or under; the residual
 * is corrected on the largest *eligible* share so the drift lands where it is
 * least visible. A zero-share tier is skipped entirely rather than allocated a
 * rounded zero, which is what keeps it out of the draw.
 */
function allocateQuotas(size: number, mix: Record<Rarity, number>): Record<Rarity, number> {
  const eligible = eligibleTiers(mix);
  const quotas = { pospolite: 0, niezwykłe: 0, rzadkie: 0 } as Record<Rarity, number>;

  for (const tier of eligible) {
    quotas[tier] = Math.round(mix[tier] * size);
  }

  const residual = size - eligible.reduce((sum, tier) => sum + quotas[tier], 0);
  if (residual !== 0) {
    const largest = eligible.reduce((a, b) => (mix[a] >= mix[b] ? a : b));
    quotas[largest] += residual;
    // A negative residual on a small quota could go below zero; clamp and
    // push the difference back onto the largest share.
    if (quotas[largest] < 0) quotas[largest] = 0;
  }

  return quotas;
}

/** Tiers that take part in the draw at all. A `0` share means never, not rarely. */
function eligibleTiers(mix: Record<Rarity, number>): Rarity[] {
  return RARITY_TIERS.filter((tier) => mix[tier] > 0);
}

function groupByTier(pool: readonly CatalogItem[]): Record<Rarity, CatalogItem[]> {
  const byTier = { pospolite: [], niezwykłe: [], rzadkie: [] } as Record<Rarity, CatalogItem[]>;
  for (const item of pool) byTier[item.rarity].push(item);
  return byTier;
}

/**
 * Fill one tier's quota, spilling any shortfall outward.
 *
 * The spill only ever reaches *eligible* tiers, which is what makes the
 * `nędzna` zero-rare guarantee hold even when the common and uncommon pools
 * both run dry — the one case where the spill rule and that invariant could
 * otherwise contradict each other.
 */
function drawFromTier(
  tier: Rarity,
  quota: number,
  byTier: Record<Rarity, CatalogItem[]>,
  picked: CatalogItem[],
  recent: ReadonlySet<string>,
  mix: Record<Rarity, number>,
  rng: () => number,
): void {
  if (quota <= 0) return;

  const taken = takeWeighted(byTier[tier], quota, picked, recent, rng);
  const shortfall = quota - taken;
  if (shortfall === 0) return;

  const eligible = new Set(eligibleTiers(mix));
  let remaining = shortfall;

  for (const fallback of SPILL_ORDER[tier]) {
    if (!eligible.has(fallback)) continue;
    remaining -= takeWeighted(byTier[fallback], remaining, picked, recent, rng);
    if (remaining === 0) return;
  }

  throw new AssortmentPoolError(
    `Tier "${tier}" was short ${shortfall} row(s) and no eligible tier could supply ${remaining} of them.`,
  );
}

/**
 * Take up to `count` unpicked items, biased against recently-drawn ones.
 *
 * The bias is a weight reduction, never a filter. Excluding recent items would
 * make a full-tier draw impossible — `bogata` + `alchemik` at 25 rows needs all
 * ten of that tier's rare items — so recency must never remove a candidate.
 *
 * Returns how many were actually taken, which may be fewer than `count`.
 */
function takeWeighted(
  candidates: readonly CatalogItem[],
  count: number,
  picked: CatalogItem[],
  recent: ReadonlySet<string>,
  rng: () => number,
): number {
  const available = candidates.filter((item) => !picked.includes(item));
  let taken = 0;

  while (taken < count && available.length > 0) {
    const weights = available.map((item) => (recent.has(item.id) ? RECENT_WEIGHT : 1));
    const total = weights.reduce((a, b) => a + b, 0);

    let threshold = rng() * total;
    let index = 0;
    while (index < weights.length - 1) {
      threshold -= weights[index];
      if (threshold <= 0) break;
      index += 1;
    }

    picked.push(available[index]);
    available.splice(index, 1);
    taken += 1;
  }

  return taken;
}

/** Inclusive on both ends. */
function randomInt(min: number, max: number, rng: () => number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
