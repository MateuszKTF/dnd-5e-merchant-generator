import { expect, type Locator, type Page } from "@playwright/test";

/** The single browser-storage key this product owns. */
export const STORAGE_KEY = "dnd-merchant-generator";

/**
 * Wait until the generator island is interactive.
 *
 * This is the one wait every spec here needs, and leaving it out is the single
 * biggest flake source in this app. `index.astro` renders `<GeneratorIsland
 * client:load />`, and Astro server-renders the island's markup — so every
 * control ("Stwórz", both selects) is present, visible and clickable in the
 * HTML *before* React has attached a single handler. A click that lands in that
 * window is swallowed silently: the button is really there, the click really
 * happens, and nothing occurs.
 *
 * Astro strips the `ssr` attribute from `<astro-island>` at the moment
 * hydration completes, so `:not([ssr])` is a real application state to wait for
 * rather than a duration to guess at (E2E rule: wait for state, never time).
 */
export async function gotoHydrated(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator("astro-island:not([ssr])").waitFor();
}

/** Reload and wait for the island to become interactive again. */
export async function reloadHydrated(page: Page): Promise<void> {
  await page.reload();
  await page.locator("astro-island:not([ssr])").waitFor();
}

/**
 * Generate an assortment and wait for the table to exist.
 *
 * Returns the first row's item name, which every correction test needs: the
 * price and quantity fields are labelled `Cena (gp) — <item>` / `Ilość —
 * <item>`, so the item name is what makes a role-based locator addressable
 * without reaching for a CSS selector or a row index.
 */
export async function generateAssortment(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Stwórz" }).click();
  await expect(page.getByRole("region", { name: "Asortyment kupca" })).toBeVisible();

  const firstItem = await page.getByRole("row").nth(1).getByRole("cell").first().textContent();

  // Premise guard (lessons L-03): every correction assertion below is addressed
  // by this name. An empty or whitespace name would make those locators match
  // nothing, and a test that never reaches its subject passes.
  expect(firstItem?.trim()).toBeTruthy();

  return (firstItem ?? "").trim();
}

export function priceField(page: Page, item: string): Locator {
  return page.getByRole("spinbutton", { name: `Cena (gp) — ${item}` });
}

export function quantityField(page: Page, item: string): Locator {
  return page.getByRole("spinbutton", { name: `Ilość — ${item}` });
}

interface StoredTransient {
  readonly rows: readonly {
    readonly itemId: string;
    readonly name: string;
    readonly priceGp: number;
    readonly quantity: number;
  }[];
  /**
   * Hand corrections are an *overlay* keyed by item id, not a mutation of
   * `rows` — the generated assortment stays intact underneath so a correction
   * can be told apart from a roll. A premise guard that looks for a corrected
   * price in `rows` therefore never finds one and is decorative: it reports
   * "uncommitted" whether or not the edit was committed.
   */
  readonly corrections: Readonly<Record<string, { readonly priceGp?: number; readonly quantity?: number }>>;
}

/** What is actually on disk in the transient slot, for premise guards. */
export async function storedTransient(page: Page): Promise<StoredTransient | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    return (JSON.parse(raw) as { transient: StoredTransient | null }).transient;
  }, STORAGE_KEY);
}

/** The committed hand correction for one item, or `undefined` if there is none. */
export async function storedCorrection(
  page: Page,
  itemId: string,
): Promise<{ priceGp?: number; quantity?: number } | undefined> {
  return (await storedTransient(page))?.corrections[itemId];
}

/** The stable id the corrections overlay is keyed by, for a given item name. */
export async function itemIdFor(page: Page, itemName: string): Promise<string> {
  const transient = await storedTransient(page);
  const row = transient?.rows.find((candidate) => candidate.name === itemName);
  if (row === undefined) throw new Error(`no stored row named ${itemName}`);
  return row.itemId;
}
