import PriceQuantityCell from "@/components/PriceQuantityCell";
import type { AssortmentRow } from "@/lib/assortment";
import {
  clampPriceGp,
  clampQuantity,
  mergeCorrections,
  parseDraft,
  priceInUnit,
  type Correction,
  type CorrectionMap,
} from "@/lib/corrections";
import { CP_PER_GP, partsToGp, priceParts } from "@/lib/format-price";

interface Props {
  /** The generated rows, never mutated — corrections live alongside them. */
  readonly rows: readonly AssortmentRow[];
  readonly corrections: CorrectionMap;
  readonly onCorrect: (itemId: string, patch: Correction) => void;
}

/**
 * The assortment, as a table the GM reads aloud at the table — and now corrects
 * in place.
 *
 * Presentation plus events: it merges the overlay for display and reports
 * committed edits upward, but owns no correction state of its own. Three
 * columns exactly, per FR-007: rarity is available on every row but is
 * deliberately not shown, because the GM narrates names, counts and prices, not
 * game-mechanical tiers.
 *
 * One markup path at every width. The only NFR in the PRD is that this stays
 * readable on a narrow phone with no horizontal scroll and no zooming, so the
 * numeric columns take content width and the name column absorbs the rest —
 * long SRD names wrap into taller rows instead of pushing out a scrollbar.
 */
export default function MerchantTable({ rows, corrections, onCorrect }: Props) {
  const merged = mergeCorrections(rows, corrections);

  return (
    <section aria-label="Asortyment kupca" className="mt-6">
      {/* Live, because a new draw replaces the table silently otherwise: a
          screen-reader user presses Stwórz and hears nothing while 18 rows
          appear below the fold. "18 pozycji" is exactly the right
          announcement, and polite steals no focus from the controls. */}
      <p aria-live="polite" className="mb-2 text-sm text-neutral-500">
        {rows.length} {rowNoun(rows.length)}
      </p>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b-2 border-neutral-400 text-sm text-neutral-600">
            <th scope="col" className="py-2 pr-3 font-medium">
              Nazwa
            </th>
            {/* w-px + whitespace-nowrap collapses these to content width, so the
                name column keeps everything left over. */}
            <th scope="col" className="w-px py-2 pr-3 text-right font-medium whitespace-nowrap">
              Ilość
            </th>
            <th scope="col" className="w-px py-2 text-right font-medium whitespace-nowrap">
              Cena
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((generated, index) => {
            const row = merged[index];

            // Pinned to the GENERATED price and held for the row's lifetime.
            // Deriving it from the corrected value would flip the unit under
            // the GM mid-edit. See `priceInUnit`.
            const { unit } = priceParts(generated.priceGp);

            return (
              // Row separators do the work here: wrapped names make row heights
              // uneven, and without a rule between them the eye loses the line.
              <tr key={generated.itemId} className="border-b border-neutral-300 align-top">
                {/* wrap-anywhere, not break-words: only `overflow-wrap: anywhere`
                    reduces the cell's min-content contribution, which is what
                    actually stops a long name widening the column past the
                    viewport under `table-layout: auto`. No hyphens — the names
                    are English inside a `lang="pl"` document, so a browser would
                    hyphenate them with Polish break patterns. */}
                <td className="py-2 pr-3 wrap-anywhere">{generated.name}</td>
                <td className="w-px py-2 pr-3 text-right whitespace-nowrap">
                  <PriceQuantityCell
                    value={row.quantity}
                    // The table is the only component that knows the item name,
                    // so it supplies the name that tells 50 otherwise identical
                    // spin buttons apart.
                    label={`Ilość — ${generated.name}`}
                    inputMode="numeric"
                    step="1"
                    className="w-12"
                    validate={(draft) => clampQuantity(parseDraft(draft))}
                    // A blur commits whatever the field holds, including when
                    // the GM only tabbed through and never typed. Reporting
                    // that as an edit rewrites the whole storage document and
                    // arms the save notice over nothing, so compare first.
                    onCommit={(quantity) => {
                      if (quantity === row.quantity) return;
                      onCorrect(generated.itemId, { quantity });
                    }}
                  />
                </td>
                <td className="w-px py-2 text-right whitespace-nowrap">
                  <PriceQuantityCell
                    value={priceInUnit(row.priceGp, unit)}
                    unit={unit}
                    // The unit belongs in the name, not just in the span beside
                    // the field: it is pinned to the generated price, so it
                    // cannot be inferred from the number either. Without it a
                    // screen-reader user hears "4,2" and cannot tell whether
                    // typing 5 means 5 gp or 0,05 gp.
                    label={`Cena (${unit}) — ${generated.name}`}
                    inputMode="decimal"
                    step="any"
                    className="w-20"
                    // The GM types in the unit they are reading, so the draft is
                    // converted back to gp before it is range-checked.
                    validate={(draft) => clampPriceGp(partsToGp(parseDraft(draft), unit))}
                    // Same no-op guard as the quantity cell, but on the copper
                    // grid — the one `isCorrected` compares on. A price that
                    // survives the display-and-retype round trip is not an
                    // edit, and comparing raw floats would call it one.
                    onCommit={(priceGp) => {
                      if (Math.round(priceGp * CP_PER_GP) === Math.round(row.priceGp * CP_PER_GP)) return;
                      onCorrect(generated.itemId, { priceGp });
                    }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** Polish counts take three forms; getting this wrong reads as broken. */
function rowNoun(count: number): string {
  if (count === 1) return "pozycja";
  const lastTwo = count % 100;
  const last = count % 10;
  const isFew = last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14);
  return isFew ? "pozycje" : "pozycji";
}
