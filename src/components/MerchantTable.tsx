import type { AssortmentRow } from "@/lib/assortment";
import { formatPrice } from "@/lib/format-price";

interface Props {
  readonly rows: readonly AssortmentRow[];
}

/**
 * The assortment, as a table the GM reads aloud at the table.
 *
 * Presentation only — no state, no generation. Three columns exactly, per
 * FR-007: rarity is available on every row but is deliberately not shown,
 * because the GM narrates names, counts and prices, not game-mechanical tiers.
 *
 * One markup path at every width. The only NFR in the PRD is that this stays
 * readable on a narrow phone with no horizontal scroll and no zooming, so the
 * numeric columns take content width and the name column absorbs the rest —
 * long SRD names wrap into taller rows instead of pushing out a scrollbar.
 */
export default function MerchantTable({ rows }: Props) {
  return (
    <section aria-label="Asortyment kupca" className="mt-6">
      <p className="mb-2 text-sm text-neutral-500">
        {rows.length} {rowNoun(rows.length)}
      </p>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b-2 border-neutral-300 text-sm text-neutral-600">
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
          {rows.map((row) => (
            // Row separators do the work here: wrapped names make row heights
            // uneven, and without a rule between them the eye loses the line.
            <tr key={row.itemId} className="border-b border-neutral-200 align-top">
              <td className="py-2 pr-3 break-words hyphens-auto">{row.name}</td>
              <td className="w-px py-2 pr-3 text-right whitespace-nowrap tabular-nums">{row.quantity}</td>
              <td className="w-px py-2 text-right whitespace-nowrap tabular-nums">{formatPrice(row.priceGp)}</td>
            </tr>
          ))}
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
