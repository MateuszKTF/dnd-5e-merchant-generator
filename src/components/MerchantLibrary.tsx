import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { Merchant } from "@/lib/merchant";
import { filterMerchants, holdOrder, libraryRow, normalizeName } from "@/lib/merchant-library";
import { cn } from "@/lib/utils";

interface Props {
  /** The durable collection, unsorted — ordering is this component's business. */
  readonly saved: readonly Merchant[];
  /** The record currently on screen, if the GM opened one. Marks its row. */
  readonly openedSavedId: string | null;
  readonly onOpen: (merchant: Merchant) => void;
  /**
   * Called with an already-normalized name, and only when it actually differs.
   * Returns whether the write landed, so the row can announce what really
   * happened rather than assuming success.
   */
  readonly onRename: (id: string, name: string) => boolean;
  /** Asks to delete. The caller confirms first — this never deletes on its own. */
  readonly onDelete: (id: string) => void;
}

/**
 * The panel's toggle, which is always mounted whether or not the panel is open.
 *
 * Exported because deleting a merchant unmounts the very button that invoked
 * the confirmation, so `<dialog>`'s focus restore has nowhere to put focus and
 * drops it on `<body>`. The generator moves focus here instead. A shared id
 * rather than a ref prop, matching the `aria-controls="merchant-library-panel"`
 * already in this file.
 */
export const LIBRARY_TOGGLE_ID = "merchant-library-toggle";

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

  // The row order as it stood when a rename began, or `null` when nothing is
  // being edited.
  //
  // Another tab's autosave refreshes `savedAt`, which re-sorts the library —
  // and React reconciles by key, so it *moves* the focused `<li>`. Moving a
  // focused element blurs it, and a blur commits, so an unrelated write in
  // another tab could store a half-typed name. A blur guard cannot catch that:
  // the draft is non-null, so it looks exactly like a real edit being ended.
  // Holding the order still removes the move, and so removes the blur.
  const [frozenOrder, setFrozenOrder] = useState<readonly string[] | null>(null);

  // A merchant just renamed out of its own search results. Renaming a row while
  // a query is active can stop it matching, and the row would then vanish
  // mid-edit — taking its live region with it before the announcement it was
  // about to make had rendered, and leaving a sighted GM with a row that
  // silently disappeared. Held until the query next changes, which is the point
  // at which the GM is steering the view again.
  const [keepVisibleId, setKeepVisibleId] = useState<string | null>(null);

  const filtered = filterMerchants(saved, query, keepVisibleId);
  const merchants = frozenOrder === null ? filtered : holdOrder(filtered, frozenOrder);
  const filtering = query.trim() !== "";

  // Counted without `keepVisibleId`, because a row held over from a rename is
  // not a match — announcing it as one would report one more result than the
  // query actually has.
  const matchCount = keepVisibleId === null ? merchants.length : filterMerchants(saved, query).length;

  // Snapshotted from the order on screen at that moment, not recomputed, so the
  // rows stay exactly where the GM is looking at them.
  function handleEditingChange(editing: boolean) {
    setFrozenOrder(editing ? merchants.map((entry) => entry.id) : null);
  }

  // Forwards the outcome as well as the call: the row announces what happened,
  // and a wrapper that swallowed the result would leave it announcing success
  // for a write that failed.
  function handleRename(id: string, name: string): boolean {
    setKeepVisibleId(id);

    return onRename(id, name);
  }

  return (
    <section aria-label="Zapisani kupcy" className="mt-4">
      <button
        type="button"
        id={LIBRARY_TOGGLE_ID}
        aria-expanded={expanded}
        aria-controls="merchant-library-panel"
        onClick={() => {
          setExpanded((current) => !current);
          // The panel is `hidden`, not unmounted, so its state survives a
          // collapse. Without this a row held over from a rename is still
          // sitting in a filtered list when the GM comes back, matching nothing
          // and explaining nothing.
          setKeepVisibleId(null);
        }}
        // h-11 keeps the tap target comfortable on a phone; this bar is the
        // panel's entire footprint while collapsed.
        className="flex h-11 w-full items-center justify-between rounded-md border border-neutral-500 bg-white px-3 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-800"
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
                // The GM is steering the view again, so a row held over from a
                // rename stops being held.
                setKeepVisibleId(null);
              }}
              aria-label="Szukaj kupca"
              placeholder="Szukaj po nazwie lub rodzaju"
              // `type="search"` brings the browser's own clear affordance, and
              // h-11 keeps the field a comfortable tap target at 360 px.
              className="h-11 w-full rounded-md border border-neutral-500 bg-white px-3"
            />

            {/* Said out loud while filtering, because the panel is showing a
                subset and the header's total would otherwise contradict it.

                Mounted unconditionally and filled later, never inserted with
                its first message: a polite live region has to be in the
                accessibility tree *before* its content changes, or the first
                announcement is the one screen readers skip. `StorageNotice`
                and `MerchantTable` both mount theirs the same way, and for the
                same reason — nothing in CI can catch this (L-04). */}
            <p className="mt-1 text-xs text-neutral-500" role="status">
              {filtering ? `${matchCount} z ${saved.length}` : ""}
            </p>
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
                onRename={handleRename}
                onDelete={onDelete}
                onEditingChange={handleEditingChange}
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
  readonly onRename: (id: string, name: string) => boolean;
  readonly onDelete: (id: string) => void;
  /**
   * Raised while this row holds an in-progress name, so the panel can hold the
   * row order still. The draft itself stays here; only the fact of it leaves.
   */
  readonly onEditingChange: (editing: boolean) => void;
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
function MerchantRow({ merchant, isOpen, onOpen, onRename, onDelete, onEditingChange }: RowProps) {
  const row = libraryRow(merchant);

  // `null` means "not being edited" — the field shows the stored name. A string
  // is an edit in progress, including the empty string when the GM clears it.
  const [draft, setDraft] = useState<string | null>(null);

  // No `abandoned` flag: ending an edit always means `draft = null`, which is
  // itself what tells the blur handler there is nothing left to commit. The
  // flag only existed to suppress a blur that neither key performs any more.

  // What `normalizeName` did to the typed name, when it did something. Empty
  // the rest of the time, and the region below stays mounted either way.
  const [notice, setNotice] = useState("");

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
    if (next === null) {
      // Nothing usable was typed, so the previous name comes back. A sighted GM
      // sees the snap-back; without this nobody else does — the field stops
      // matching what they typed, unannounced.
      setNotice("Nazwa pusta — przywrócono poprzednią.");
    } else if (next !== merchant.name) {
      // **After the write, and from its result.** Announcing before it would
      // claim a success that may not happen: a failed write leaves the old name
      // on screen, and when the storage condition is already standing the
      // notice beside it does not change either — so a premature "Nowa nazwa"
      // would be the only thing a screen-reader user hears about a rename that
      // did not land.
      //
      // The stored name, not the typed one: `normalizeName` may have collapsed
      // whitespace or cut at the 60-grapheme cap, and announcing what actually
      // landed is both simpler and more useful than a flag saying it was
      // shortened. It also avoids a second owner for the normalization rule.
      setNotice(
        onRename(merchant.id, next)
          ? `Nowa nazwa: ${next}`
          : "Nie udało się zmienić nazwy — zobacz komunikat o pamięci.",
      );
    } else {
      setNotice("");
    }

    endEdit();
  }

  // One place where an edit ends, so the parent's frozen order is released on
  // every path — commit, Escape, or a blur that had something to commit. A path
  // that forgot would leave the library ordered by a snapshot nobody is editing.
  function endEdit() {
    setDraft(null);
    onEditingChange(false);
  }

  // The one end-of-edit that `endEdit` cannot reach: this row unmounting while
  // it is still being edited — another tab deleting or renaming exactly this
  // merchant. Chrome fires no `focusout` for a focused element that is removed,
  // so nothing else would release the parent's frozen order, and the library
  // would stay sorted by a snapshot nobody is editing for the rest of the page
  // load. A ref, not `draft`, so the cleanup does not re-run on every keystroke.
  // Tracked in an effect rather than assigned during render: a ref written
  // while rendering is impure, and under StrictMode's double render it would be
  // written twice for one commit.
  const editing = useRef(false);

  useEffect(() => {
    editing.current = draft !== null;
  }, [draft]);

  useEffect(() => {
    return () => {
      if (editing.current) {
        onEditingChange(false);
      }
    };
  }, [onEditingChange]);

  // Neither key blurs, for the reason `PriceQuantityCell` records: blurring
  // drops focus to `<body>`, so the next Tab restarts at the top of the
  // document — here that throws the GM back past both selects, Stwórz, Zapisz
  // and the panel bar, from a field in the middle of a list. Both keys end the
  // edit and leave the caret where it is.
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      commit(event.currentTarget.value);
      return;
    }

    if (event.key === "Escape") {
      endEdit();
    }
  }

  return (
    <li
      // `neutral-300` is the floor AGENTS.md sets for a rule that carries
      // meaning, and this one does: in a `gap-1` stack it is the only thing
      // separating one interactive row from the next. `neutral-200` measured
      // about 1.2:1 on white — effectively invisible.
      className={cn("rounded-md border", isOpen ? "border-neutral-800 bg-neutral-100" : "border-neutral-300 bg-white")}
    >
      {/* `pr-13` reserves the delete column's width (44px + the row below's
          gap-2) on this row too, so the name field's right edge stops above the
          *open* target rather than above delete. Without it the two controls
          share a vertical line with no gap between them, and a thumb sliding
          downward off the right-hand end of the name lands on the one action
          here that cannot be undone. Sideways was always safe; downward was
          not. */}
      <div className="flex items-center gap-2 px-2 pt-1 pr-13">
        {/* Reads as the row's title until focused, then becomes visibly a field
            — the same idiom as the assortment's editable cells, down to the
            key handling: Enter commits in place, Escape abandons, neither
            blurs, and `draft === null` is what says the edit is over. A GM who
            learns the rule in one place is right about the other, and that is
            only true while both files actually agree.
            No `maxLength`: `normalizeName` is the single authority on
            the cap, and an attribute counting UTF-16 units would disagree with
            it on an accented or astral name. */}
        <input
          type="text"
          // Named by the row's disambiguators, not by the value: the value is
          // what the GM is typing, and duplicate names are permitted by design,
          // so "Nazwa kupca" alone is identical on every row. Both sibling
          // controls in this row already carry the merchant.
          aria-label={`Nazwa kupca — ${row.categoryLabel}, ${row.savedAtLabel ?? "brak daty"}`}
          value={draft ?? merchant.name}
          onChange={(event) => {
            // The freeze starts at the first keystroke, not at focus: merely
            // tabbing through a row is not an edit, and holding the order for
            // it would leave the list stale for a GM who never types.
            if (draft === null) {
              onEditingChange(true);
            }
            setDraft(event.target.value);
          }}
          onFocus={(event) => {
            // Renaming means replacing the auto-name, not appending to it.
            event.currentTarget.select();
          }}
          onBlur={(event) => {
            // No draft means nothing was typed since the last commit — either
            // the GM only tabbed through, or Enter/Escape already ended the
            // edit. Committing anyway would rewrite the storage document over
            // nothing, and for a name that is not already normalization-stable
            // it would rename the merchant with no GM action at all.
            if (draft === null) return;
            commit(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          // `min-h-11` and a real focus indicator, matching the edit cells in
          // the table. This is the one text field a thumb must hit, its focus
          // selects the whole name, and blur commits the rename irreversibly —
          // so a 28px target with a ~2.6:1 hairline for focus was the worst
          // combination in the app on the control that forgives least.
          // `hover:border-neutral-500` is the affordance: read-as-text hides
          // that the name is editable at all, and in a list row the name reads
          // as a title rather than as a cell in an editable column. The same
          // 3:1 token the focus border uses, so it costs no new colour.
          className="min-h-11 min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-2 font-medium hover:border-neutral-500 focus:border-neutral-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-800"
        />

        {isOpen && <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-white">otwarty</span>}
      </div>

      {/* Always mounted, filled later — the same rule the panel's count region
          follows, and for the same reason: a region inserted together with its
          first message is the one screen readers skip. Per row rather than one
          for the panel, so the announcement cannot outlive the row it describes
          or be overwritten by a rename two rows down. */}
      <p role="status" className="sr-only">
        {notice}
      </p>

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
          // `neutral-600`, not `neutral-500`: at 12px the 4.5:1 floor applies,
          // and `neutral-500` measures 4.74:1 on white but only 4.35:1 on the
          // opened row's `bg-neutral-100` — failing on exactly the row the GM
          // is working in.
          className="flex min-h-11 min-w-0 flex-1 items-center px-3 pb-1 text-left text-xs text-neutral-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-800"
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
          className="flex size-11 shrink-0 items-center justify-center rounded-md text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-800"
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </button>
      </div>
    </li>
  );
}
