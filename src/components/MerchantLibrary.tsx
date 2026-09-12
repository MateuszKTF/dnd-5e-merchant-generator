import { Trash2 } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

import type { Merchant } from "@/lib/merchant";
import { filterMerchants, libraryRow, normalizeName } from "@/lib/merchant-library";
import { cn } from "@/lib/utils";

interface Props {
  /** The durable collection, unsorted — ordering is this component's business. */
  readonly saved: readonly Merchant[];
  /** The record currently on screen, if the GM opened one. Marks its row. */
  readonly openedSavedId: string | null;
  readonly onOpen: (merchant: Merchant) => void;
  /** Called with an already-normalized name, and only when it actually differs. */
  readonly onRename: (id: string, name: string) => void;
  /** Asks to delete. The caller confirms first — this never deletes on its own. */
  readonly onDelete: (id: string) => void;
}

/**
 * The library: every merchant the GM explicitly saved, the way back into one,
 * and the way to give it a name they will recognise next session.
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
export default function MerchantLibrary({ saved, openedSavedId, onOpen, onRename, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false);

  // View state, and deliberately nothing more: the query is not merchant data,
  // so it is not persisted and never reaches F-01's document. A reload opens a
  // fresh, unfiltered panel, which is the right default for a GM coming back.
  const [query, setQuery] = useState("");

  const merchants = filterMerchants(saved, query);
  const filtering = query.trim() !== "";

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
        className="flex h-11 w-full items-center justify-between rounded-md border border-neutral-500 bg-white px-3 text-left"
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
        {/* Only once there is something to search through. A filter over an
            empty library is a control that can do nothing. */}
        {saved.length > 0 && (
          <div className="mt-2">
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              aria-label="Szukaj kupca"
              placeholder="Szukaj po nazwie lub rodzaju"
              // `type="search"` brings the browser's own clear affordance, and
              // h-11 keeps the field a comfortable tap target at 360 px.
              className="h-11 w-full rounded-md border border-neutral-500 bg-white px-3"
            />

            {/* Said out loud while filtering, because the panel is showing a
                subset and the header's total would otherwise contradict it. */}
            {filtering && (
              <p className="mt-1 text-xs text-neutral-500" role="status">
                {merchants.length} z {saved.length}
              </p>
            )}
          </div>
        )}

        {saved.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600">
            Nie masz jeszcze zapisanych kupców. Kliknij „Zapisz”, żeby zachować tego z ekranu.
          </p>
        ) : merchants.length === 0 ? (
          // A filtered-to-nothing panel is not the same as an empty library,
          // and must not look like one — the GM's merchants are still there.
          <p className="mt-2 text-sm text-neutral-600">Żaden kupiec nie pasuje do „{query.trim()}”.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {merchants.map((merchant) => (
              <MerchantRow
                key={merchant.id}
                merchant={merchant}
                isOpen={merchant.id === openedSavedId}
                onOpen={onOpen}
                onRename={onRename}
                onDelete={onDelete}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

interface RowProps {
  readonly merchant: Merchant;
  readonly isOpen: boolean;
  readonly onOpen: (merchant: Merchant) => void;
  readonly onRename: (id: string, name: string) => void;
  readonly onDelete: (id: string) => void;
}

/**
 * One saved merchant: a name to edit, and a line to open it by.
 *
 * **Three tap zones, deliberately laid out.** S-04 made the whole row a single
 * button; the rename field cannot live inside it, because HTML forbids an
 * `<input>` inside a `<button>` and focus behaves inconsistently where browsers
 * tolerate it. So the name gets its own line, and the detail line below carries
 * the open target and the delete control.
 *
 * The split is not only structural. Delete is the one irreversible action here,
 * and it sits on the *other line* from the name field — so a thumb sliding off
 * the name while renaming lands on nothing, never on the control that removes
 * the merchant. The open button carries the merchant's name in its accessible
 * name, and so does delete: an icon alone does not say what it deletes.
 *
 * Its own component because of the draft: a hook cannot live inside the parent's
 * `map`, and each row needs its own in-progress text.
 */
function MerchantRow({ merchant, isOpen, onOpen, onRename, onDelete }: RowProps) {
  const row = libraryRow(merchant);

  // `null` means "not being edited" — the field shows the stored name. A string
  // is an edit in progress, including the empty string when the GM clears it.
  const [draft, setDraft] = useState<string | null>(null);

  // Escape and blur both end an edit, but only one of them commits. A native
  // blur fires after the Escape handler runs, so without this flag abandoning
  // an edit would still write the draft through.
  const abandoned = useRef(false);

  /**
   * Commit on blur and Enter — never per keystroke.
   *
   * A rename is one storage write, not one per character: `renameMerchant`
   * rewrites the whole document, so a per-keystroke commit would rewrite it
   * once for every letter of "Kuźnia u Borysa".
   *
   * `normalizeName` returning `null` means the GM left nothing usable, which is
   * far likelier to be a slip than a request. Dropping the draft restores the
   * previous name, which is the only value that is certainly not a surprise —
   * and the same fall-through handles a failed write, because the field falls
   * back to whatever the parent still holds.
   */
  function commit(raw: string) {
    const next = normalizeName(raw);

    // An unchanged name is not a rename. Without this, every blur — including
    // one where the GM only tapped the field — would rewrite the document.
    if (next !== null && next !== merchant.name) {
      onRename(merchant.id, next);
    }

    setDraft(null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      // Blur does the committing, so both paths run identical code.
      event.currentTarget.blur();
      return;
    }

    if (event.key === "Escape") {
      abandoned.current = true;
      setDraft(null);
      event.currentTarget.blur();
    }
  }

  return (
    <li
      className={cn("rounded-md border", isOpen ? "border-neutral-800 bg-neutral-100" : "border-neutral-200 bg-white")}
    >
      <div className="flex items-center gap-2 px-2 pt-1">
        {/* Reads as the row's title until focused, then becomes visibly a field
            — the same idiom as the assortment's editable cells, so a GM who
            learns that Escape abandons an edit in one place is right about the
            other. No `maxLength`: `normalizeName` is the single authority on
            the cap, and an attribute counting UTF-16 units would disagree with
            it on an accented or astral name. */}
        <input
          type="text"
          aria-label="Nazwa kupca"
          value={draft ?? merchant.name}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onFocus={(event) => {
            // Renaming means replacing the auto-name, not appending to it.
            event.currentTarget.select();
          }}
          onBlur={(event) => {
            if (abandoned.current) {
              abandoned.current = false;
              return;
            }
            commit(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          // `min-h-11` and a real focus indicator, matching the edit cells in
          // the table. This is the one text field a thumb must hit, its focus
          // selects the whole name, and blur commits the rename irreversibly —
          // so a 28px target with a ~2.6:1 hairline for focus was the worst
          // combination in the app on the control that forgives least.
          className="min-h-11 min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-2 font-medium focus:border-neutral-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-800"
        />

        {isOpen && <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-white">otwarty</span>}
      </div>

      <div className="flex items-stretch gap-2">
        {/* The three disambiguating fields, doubling as the open target. "poz."
            is the ordinary Polish abbreviation and sidesteps the three-form
            plural in a line that has to fit a narrow row. */}
        <button
          type="button"
          onClick={() => {
            onOpen(merchant);
          }}
          aria-current={isOpen ? "true" : undefined}
          aria-label={`Otwórz: ${merchant.name}`}
          className="flex min-h-11 min-w-0 flex-1 items-center px-3 pb-1 text-left text-xs text-neutral-500"
        >
          <span className="truncate">
            {row.categoryLabel} · {row.itemCount} poz.
            {row.savedAtLabel !== null && ` · ${row.savedAtLabel}`}
          </span>
        </button>

        {/* Trailing edge, full tap-target height, and the only red thing in the
            panel — the one control here that cannot be undone. It asks; the
            caller confirms. */}
        <button
          type="button"
          onClick={() => {
            onDelete(merchant.id);
          }}
          aria-label={`Usuń: ${merchant.name}`}
          className="flex size-11 shrink-0 items-center justify-center rounded-md text-red-700 hover:bg-red-50"
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </button>
      </div>
    </li>
  );
}
