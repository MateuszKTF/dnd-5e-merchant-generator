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
 */
export default function MerchantTable({ rows }: Props) {
  return (
    <section aria-label="Asortyment kupca">
      <p>
        {rows.length} {rowNoun(rows.length)}
      </p>

      <table>
        <thead>
          <tr>
            <th scope="col">Nazwa</th>
            <th scope="col">Ilość</th>
            <th scope="col">Cena</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.itemId}>
              <td>{row.name}</td>
              <td>{row.quantity}</td>
              <td>{formatPrice(row.priceGp)}</td>
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
