// Generates src/data/items.generated.ts from the D&D 5e SRD 5.1 dataset.
//
// Source: https://github.com/5e-bits/5e-database (src/2014/en/*.json)
// Content licence: SRD 5.1 — see src/data/ATTRIBUTION.md
//
// Run with: npm run data:build
//
// WHY A BUILD SCRIPT AND A COMMITTED ARTIFACT:
// the generated file is committed, so the app has no runtime dependency on any
// external API. Re-run this only when you want to refresh or re-tune the pools.
//
// TWO GAPS IN THE SOURCE DATA, FILLED HERE (both are our own work, not WotC's):
//   1. mundane equipment has `cost` but no rarity  -> rarity derived from price band
//   2. magic items have `rarity` but no cost       -> base price derived from rarity band
// Magic-item prices are deterministic per item id, so a saved merchant always shows
// the same price for the same item (PRD guardrail: nothing changes silently).

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../src/data/items.generated.ts");
const RAW = "https://raw.githubusercontent.com/5e-bits/5e-database/main/src/2014/en";

/** Max pool size per category. PRD asks for 30-40 per category. */
const POOL_SIZE = 40;

/** Coin units -> gold pieces. */
const UNIT_TO_GP = { cp: 0.01, sp: 0.1, ep: 0.5, gp: 1, pp: 10 };

/**
 * Price band per SRD rarity, in gp. These are OUR numbers: the SRD ships no
 * magic-item prices, and the DMG's pricing table is not SRD content. Bands are
 * wide and non-overlapping so that rarity stays legible in the price column.
 */
const MAGIC_PRICE_BAND = {
  Common: [50, 100],
  Uncommon: [101, 500],
  Rare: [501, 5000],
  "Very Rare": [5001, 25000],
};

/**
 * SRD's rarities collapse to the PRD's three tiers. Split by available depth,
 * not by name: the SRD holds only 4 Common magic items, so Common alone could
 * never stock a poor settlement's shelf.
 *   pospolite  <- Common + Uncommon  (98 items)
 *   niezwykle  <- Rare               (119 items)
 *   rzadkie    <- Very Rare          (90 items)
 *
 * Legendary and Artifact are dropped entirely, above in the filter: a legendary
 * item is a plot device, not merchant stock, and pricing one produced six-figure
 * entries that no settlement could plausibly stock.
 */
const MAGIC_RARITY_TIER = {
  Common: "pospolite",
  Uncommon: "pospolite",
  Rare: "niezwykłe",
  "Very Rare": "rzadkie",
};

/**
 * Mundane rarity from price TERCILES WITHIN ITS OWN CATEGORY, not from a fixed
 * gp threshold. Two reasons:
 *   1. "expensive at a blacksmith" is a different number than "expensive at a
 *      general store" - rarity here means dear-for-this-shop.
 *   2. a fixed 100gp cut-off left the smith with 4 rare items and general goods
 *      with 2, because SRD mundane gear tops out cheap. Terciles guarantee each
 *      tier has real depth, whatever the source data does.
 */
function assignTercileRarity(items) {
  const sorted = [...items].sort((a, b) => a.priceGp - b.priceGp);
  const third = Math.ceil(sorted.length / 3);
  sorted.forEach((item, idx) => {
    item.rarity = idx < third ? "pospolite" : idx < third * 2 ? "niezwykłe" : "rzadkie";
  });
  return sorted;
}

/** Stable 32-bit hash, so prices never move between runs. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic price inside a rarity band, rounded to something a shopkeeper would say. */
function priceFromRarity(rarity, id) {
  const band = MAGIC_PRICE_BAND[rarity];
  if (!band) return null;
  const [lo, hi] = band;
  const raw = lo + (hash(id) % (hi - lo + 1));
  const step = raw >= 10000 ? 500 : raw >= 1000 ? 50 : raw >= 100 ? 10 : 5;
  return Math.max(lo, Math.round(raw / step) * step);
}

function costToGp(cost) {
  if (!cost || typeof cost.quantity !== "number") return null;
  const mult = UNIT_TO_GP[cost.unit];
  if (!mult) return null;
  return Math.round(cost.quantity * mult * 100) / 100;
}

/**
 * Mundane items that read as alchemist's stock rather than general goods.
 * Matched on SRD index, so a rename upstream fails loudly (see the assert below)
 * instead of silently emptying the alchemist's shelf.
 */
const ALCHEMICAL = new Set([
  "acid-vial",
  "alchemists-fire-flask",
  "antitoxin-vial",
  "oil-flask",
  "holy-water-flask",
  "poison-basic-vial",
  "healers-kit",
  "herbalism-kit",
  "alchemists-supplies",
  "perfume-vial",
  "soap",
  "ink-1-ounce-bottle",
]);

const SMITH_CATEGORIES = new Set(["weapon", "armor", "shields", "ammunition"]);
const GENERAL_CATEGORIES = new Set([
  "adventuring-gear",
  "tools",
  "artisans-tools",
  "equipment-packs",
  "musical-instruments",
  "gaming-sets",
  "kits",
  "mounts-and-other-animals",
]);

async function fetchJson(name) {
  const res = await fetch(`${RAW}/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

/**
 * Pick up to POOL_SIZE items with a balanced spread across the three tiers, so a
 * "bogata" settlement is not the only one with anything to sell. Deterministic:
 * sorted by id, then round-robin across tiers.
 */
function buildPool(items) {
  const byTier = { pospolite: [], niezwykłe: [], rzadkie: [] };
  for (const it of items) byTier[it.rarity].push(it);
  for (const tier of Object.keys(byTier)) byTier[tier].sort((a, b) => a.id.localeCompare(b.id));

  const out = [];
  const tiers = ["pospolite", "niezwykłe", "rzadkie"];
  let i = 0;
  while (out.length < POOL_SIZE && tiers.some((t) => byTier[t].length > i)) {
    for (const t of tiers) {
      if (out.length >= POOL_SIZE) break;
      if (byTier[t].length > i) out.push(byTier[t][i]);
    }
    i++;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const [equipment, magicItems] = await Promise.all([
  fetchJson("5e-SRD-Equipment.json"),
  fetchJson("5e-SRD-Magic-Items.json"),
]);

console.log(`fetched: ${equipment.length} equipment, ${magicItems.length} magic items`);

// ---- mundane equipment -------------------------------------------------------
const smith = [];
const generalGoods = [];
const alchemicalMundane = [];

for (const e of equipment) {
  const gp = costToGp(e.cost);
  if (gp === null || gp <= 0) continue; // no price -> cannot satisfy FR-005
  const cat = e.equipment_category?.index;
  // rarity is assigned per-category below, once the whole category is known
  const item = { id: e.index, name: e.name, rarity: null, priceGp: gp };

  if (ALCHEMICAL.has(e.index)) alchemicalMundane.push(item);
  else if (SMITH_CATEGORIES.has(cat)) smith.push(item);
  else if (GENERAL_CATEGORIES.has(cat)) generalGoods.push(item);
}

assignTercileRarity(smith);
assignTercileRarity(generalGoods);
assignTercileRarity(alchemicalMundane);

// ---- magic items ------------------------------------------------------------
// Potions and oils are magic items, but they belong on the alchemist's shelf.
// Keeping the categories disjoint matters: FR-004 promises UNIQUE items, and an
// item in two pools could otherwise be drawn twice for one merchant.
const magic = [];
const potions = [];

for (const m of magicItems) {
  const rarity = m.rarity?.name;
  // "Varies" marks parent entries like "Ammunition, +1, +2, or +3" whose concrete
  // variants carry real rarities. "Artifact" and "Legendary" are plot devices, not
  // merchant stock - pricing them produced six-figure shelf entries.
  if (!rarity || rarity === "Varies" || rarity === "Artifact" || rarity === "Legendary") continue;
  const tier = MAGIC_RARITY_TIER[rarity];
  const priceGp = priceFromRarity(rarity, m.index);
  if (!tier || priceGp === null) continue;

  const item = { id: m.index, name: m.name, rarity: tier, priceGp, srdRarity: rarity };
  if (m.equipment_category?.index === "potion") potions.push(item);
  else magic.push(item);
}

const pools = {
  "przedmioty-magiczne": buildPool(magic),
  kowal: buildPool(smith),
  alchemik: buildPool([...potions, ...alchemicalMundane]),
  "towary-ogolne": buildPool(generalGoods),
};

// ---- guards: fail loudly rather than ship a thin shelf ----------------------
const problems = [];
for (const [id, pool] of Object.entries(pools)) {
  if (pool.length < 30) problems.push(`pool "${id}" has ${pool.length} items, PRD wants 30-40`);
  for (const tier of ["pospolite", "niezwykłe", "rzadkie"]) {
    if (!pool.some((i) => i.rarity === tier)) problems.push(`pool "${id}" has no "${tier}" items`);
  }
}
const missingAlchemical = [...ALCHEMICAL].filter((id) => !equipment.some((e) => e.index === id));
if (missingAlchemical.length) problems.push(`unknown SRD indexes in ALCHEMICAL: ${missingAlchemical.join(", ")}`);
if (problems.length) {
  console.error("\nFAILED:\n" + problems.map((p) => "  - " + p).join("\n"));
  process.exit(1);
}

// ---- emit -------------------------------------------------------------------
const body = Object.entries(pools)
  .map(([id, pool]) => {
    const rows = pool
      .map((i) => `    { id: ${JSON.stringify(i.id)}, name: ${JSON.stringify(i.name)}, rarity: "${i.rarity}", priceGp: ${i.priceGp} },`)
      .join("\n");
    return `  ${JSON.stringify(id)}: [\n${rows}\n  ],`;
  })
  .join("\n");

const out = `// GENERATED FILE - do not edit by hand.
// Regenerate with: npm run data:build   (see scripts/build-item-catalog.mjs)
//
// Content derived from the D&D 5e SRD 5.1. Attribution and licence: src/data/ATTRIBUTION.md
// Rarity tiers for mundane goods and prices for magic items are assigned by the
// build script, not taken from the SRD - see the script header for why.

import type { CategoryId, CatalogItem } from "./items";

export const ITEM_POOLS: Record<CategoryId, readonly CatalogItem[]> = {
${body}
};
`;

// Format with the project's own prettier config before writing. Without this the
// generated file fails `npm run lint` (prettier/prettier) on every regeneration,
// which would break CI for anyone who refreshes the data.
const prettierConfig = JSON.parse(readFileSync(resolve(HERE, "../.prettierrc.json"), "utf8"));
const formatted = await prettier.format(out, { ...prettierConfig, parser: "typescript" });

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, formatted, "utf8");

console.log("\nwrote " + OUT);
for (const [id, pool] of Object.entries(pools)) {
  const c = (t) => pool.filter((i) => i.rarity === t).length;
  const prices = pool.map((i) => i.priceGp);
  console.log(
    `  ${id.padEnd(20)} ${String(pool.length).padStart(2)} items ` +
      `(pospolite ${c("pospolite")}, niezwykłe ${c("niezwykłe")}, rzadkie ${c("rzadkie")}) ` +
      `price ${Math.min(...prices)}-${Math.max(...prices)} gp`,
  );
}
