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
    // px-4 keeps a gutter at 360 px; the max-width stops the table stretching
    // into unreadable line lengths on a laptop.
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="text-xl font-semibold">Generator kupca D&amp;D 5e</h1>

      {/* Stacked on a phone, inline once there is room — one markup path,
          the breakpoint does the work. */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="category" className="text-sm text-neutral-600">
            Kategoria
          </label>
          <select
            id="category"
            value={category}
            onChange={(e) => {
              handleCategoryChange(e.target.value);
            }}
            // h-11 keeps the tap target comfortable on a phone.
            className="h-11 rounded-md border border-neutral-300 bg-white px-3"
          >
            {CATEGORIES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="wealth" className="text-sm text-neutral-600">
            Zamożność osady
          </label>
          <select
            id="wealth"
            value={wealth}
            onChange={(e) => {
              handleWealthChange(e.target.value);
            }}
            className="h-11 rounded-md border border-neutral-300 bg-white px-3"
          >
            {WEALTH_LEVELS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <Button onClick={handleGenerate} className="h-11 px-6">
          Stwórz
        </Button>
      </div>

      {error !== null && (
        <p role="alert" className="mt-6 text-sm text-red-700">
          {error}
        </p>
      )}

      {error === null && rows === null && (
        <p className="mt-6 text-neutral-600">Wybierz kategorię i zamożność osady, a potem kliknij „Stwórz”.</p>
      )}

      {error === null && rows !== null && <MerchantTable rows={rows} />}
    </main>
  );
}
