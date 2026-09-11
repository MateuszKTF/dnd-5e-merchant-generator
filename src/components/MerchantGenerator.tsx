import { useState } from "react";

import MerchantTable from "@/components/MerchantTable";
import { Button } from "@/components/ui/button";
import { CATEGORIES, WEALTH_LEVELS, type CategoryId, type Wealth } from "@/data/items";
import { AssortmentPoolError, generateAssortment, type AssortmentRow } from "@/lib/assortment";

/**
 * The generator: two choices, one button, one table.
 *
 * Everything here is ephemeral — a refresh clears it. Persistence belongs to
 * S-03 (`last-merchant-persists`), and this component deliberately does not
 * generate on mount so that slice can take over the mount path for restore.
 */
export default function MerchantGenerator() {
  // Seeded from the first entry so the controls are never empty.
  const [category, setCategory] = useState<CategoryId>(CATEGORIES[0].id);
  const [wealth, setWealth] = useState<Wealth>(WEALTH_LEVELS[0].id);

  // `null` means "nothing generated yet" — the empty state. Distinct from an
  // empty array, which would mean a draw returned nothing.
  const [rows, setRows] = useState<AssortmentRow[] | null>(null);

  // The previous draw for this shop, biased against so a second press
  // produces a visibly different list.
  const [recentIds, setRecentIds] = useState<string[]>([]);

  const [error, setError] = useState<string | null>(null);

  function handleGenerate() {
    try {
      const next = generateAssortment(category, wealth, { recentIds });
      setRows(next);
      setRecentIds(next.map((row) => row.itemId));
      setError(null);
    } catch (cause) {
      // Unreachable against the committed catalog — `npm run data:build` can
      // reshape tier depth, and an uncaught throw would blank the only page
      // the product has.
      setRows(null);
      setError(
        cause instanceof AssortmentPoolError
          ? "Nie udało się ułożyć asortymentu z dostępnej puli przedmiotów."
          : "Coś poszło nie tak przy tworzeniu asortymentu.",
      );
    }
  }

  // Recency is per-shop: carrying it to a different category or wealth would
  // bias a draw for no reason.
  function handleCategoryChange(value: string) {
    setCategory(value as CategoryId);
    setRecentIds([]);
  }

  function handleWealthChange(value: string) {
    setWealth(value as Wealth);
    setRecentIds([]);
  }

  return (
    <main>
      <h1>Generator kupca D&amp;D 5e</h1>

      <div>
        <label htmlFor="category">Kategoria</label>
        <select
          id="category"
          value={category}
          onChange={(e) => {
            handleCategoryChange(e.target.value);
          }}
        >
          {CATEGORIES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>

        <label htmlFor="wealth">Zamożność osady</label>
        <select
          id="wealth"
          value={wealth}
          onChange={(e) => {
            handleWealthChange(e.target.value);
          }}
        >
          {WEALTH_LEVELS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>

        <Button onClick={handleGenerate}>Stwórz</Button>
      </div>

      {error !== null && <p role="alert">{error}</p>}

      {error === null && rows === null && <p>Wybierz kategorię i zamożność osady, a potem kliknij „Stwórz”.</p>}

      {error === null && rows !== null && <MerchantTable rows={rows} />}
    </main>
  );
}
