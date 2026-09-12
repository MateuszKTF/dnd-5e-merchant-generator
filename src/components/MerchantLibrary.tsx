import { useState } from "react";

import type { Merchant } from "@/lib/merchant";
import { libraryRow, sortForLibrary } from "@/lib/merchant-library";
import { cn } from "@/lib/utils";

interface Props {
  /** The durable collection, unsorted — ordering is this component's business. */
  readonly saved: readonly Merchant[];
  /** The record currently on screen, if the GM opened one. Marks its row. */
  readonly openedSavedId: string | null;
  readonly onOpen: (merchant: Merchant) => void;
}

/**
 * The library: every merchant the GM explicitly saved, and the way back into
 * one.
 *
 * This is the slice where the product stops being another one-shot generator —
 * so the row's job is **recognition**, not decoration. Duplicate names are
 * allowed by design (two smithies in one town legitimately share one), which
 * makes category, item count and save time the only things that tell two rows
 * apart. All three are on every row for that reason, and each degrades to
 * something readable rather than vanishing when the stored data is odd.
 *
 * **Collapsed by default.** The page already carries the controls and a 25-row
 * table, and the PRD's only NFR is that the assortment stays readable on a
 * 360 px phone. An expanded library on load would push the table below the
 * fold, so the panel costs one bar until the GM asks for it.
 *
 * It owns no data. The saved collection lives in `MerchantGenerator`'s state so
 * a merchant saved a moment ago appears here without a round-trip through
 * storage, and opening one is a state change rather than a navigation that
 * would discard unsaved work.
 */
export default function MerchantLibrary({ saved, openedSavedId, onOpen }: Props) {
  const [expanded, setExpanded] = useState(false);

  const merchants = sortForLibrary(saved);

  return (
    <section aria-label="Zapisani kupcy" className="mt-4">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="merchant-library-panel"
        onClick={() => {
          setExpanded((current) => !current);
        }}
        // h-11 keeps the tap target comfortable on a phone; this bar is the
        // panel's entire footprint while collapsed.
        className="flex h-11 w-full items-center justify-between rounded-md border border-neutral-300 bg-white px-3 text-left"
      >
        <span className="font-medium">Zapisani kupcy</span>
        <span className="text-sm text-neutral-500">
          {saved.length}
          {/* Rotated rather than swapped for a second glyph, so the control
              cannot end up showing a state it is not in. */}
          <span aria-hidden="true" className={cn("ml-2 inline-block transition-transform", expanded && "rotate-180")}>
            ▾
          </span>
        </span>
      </button>

      {/* `hidden` rather than an unmounted branch: `aria-controls` above has to
          point at an element that exists whether or not the panel is open. */}
      <div id="merchant-library-panel" hidden={!expanded}>
        {merchants.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600">
            Nie masz jeszcze zapisanych kupców. Kliknij „Zapisz”, żeby zachować tego z ekranu.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {merchants.map((merchant) => {
              const row = libraryRow(merchant);
              const isOpen = merchant.id === openedSavedId;

              return (
                <li key={row.id}>
                  {/* The whole row is the target: at 360 px a link-sized hit
                      area inside a row is the difference between opening a
                      merchant and opening nothing. */}
                  <button
                    type="button"
                    onClick={() => {
                      onOpen(merchant);
                    }}
                    aria-current={isOpen ? "true" : undefined}
                    className={cn(
                      "flex min-h-11 w-full flex-col justify-center gap-0.5 rounded-md border px-3 py-2 text-left",
                      isOpen ? "border-neutral-800 bg-neutral-100" : "border-neutral-200 bg-white",
                    )}
                  >
                    <span className="flex items-baseline gap-2">
                      {/* min-w-0 is what lets `truncate` actually shrink inside
                          a flex row — without it a long name pushes the badge
                          off the edge instead of ellipsing. */}
                      <span className="min-w-0 truncate font-medium">{row.name}</span>
                      {isOpen && (
                        <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-white">
                          otwarty
                        </span>
                      )}
                    </span>

                    {/* The three disambiguating fields. "poz." is the ordinary
                        Polish abbreviation and sidesteps the three-form plural
                        in a line that has to fit a narrow row. */}
                    <span className="truncate text-xs text-neutral-500">
                      {row.categoryLabel} · {row.itemCount} poz.
                      {row.savedAtLabel !== null && ` · ${row.savedAtLabel}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
