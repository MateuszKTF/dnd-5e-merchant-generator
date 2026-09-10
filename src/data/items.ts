/**
 * Item catalog contract. The data itself is generated — see `items.generated.ts`
 * and `scripts/build-item-catalog.mjs`.
 */

/** The four assortment categories a GM can pick from (PRD FR-001). */
export type CategoryId = "przedmioty-magiczne" | "kowal" | "alchemik" | "towary-ogolne";

/** Rarity tiers the domain rule balances (PRD Open Question #3). */
export type Rarity = "pospolite" | "niezwykłe" | "rzadkie";

/** Settlement wealth level (PRD FR-002). */
export type Wealth = "nędzna" | "typowa" | "bogata";

export interface CatalogItem {
  /** SRD index, stable across regenerations — safe to persist in browser storage. */
  readonly id: string;
  /** SRD name, in English. See ATTRIBUTION.md for why these are not translated. */
  readonly name: string;
  readonly rarity: Rarity;
  /** Base price in gold pieces, before the wealth modifier. */
  readonly priceGp: number;
}

export const CATEGORIES: readonly { id: CategoryId; label: string }[] = [
  { id: "przedmioty-magiczne", label: "Przedmioty magiczne" },
  { id: "kowal", label: "Kowal" },
  { id: "alchemik", label: "Alchemik" },
  { id: "towary-ogolne", label: "Towary ogólne" },
];

export const WEALTH_LEVELS: readonly { id: Wealth; label: string }[] = [
  { id: "nędzna", label: "Nędzna" },
  { id: "typowa", label: "Typowa" },
  { id: "bogata", label: "Bogata" },
];

export const RARITY_TIERS: readonly Rarity[] = ["pospolite", "niezwykłe", "rzadkie"];

export { ITEM_POOLS } from "./items.generated";
