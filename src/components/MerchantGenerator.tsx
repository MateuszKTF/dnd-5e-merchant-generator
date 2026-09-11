import { useEffect, useState } from "react";

import ConfirmDialog from "@/components/ConfirmDialog";
import MerchantTable from "@/components/MerchantTable";
import { Button } from "@/components/ui/button";
import { CATEGORIES, WEALTH_LEVELS, type CategoryId, type Wealth } from "@/data/items";
import { AssortmentPoolError, generateAssortment, type AssortmentRow } from "@/lib/assortment";
import { hasCorrections, type Correction, type CorrectionMap } from "@/lib/corrections";
import {
  autoName,
  fromStoredRows,
  newMerchantId,
  toStoredRows,
  type Merchant,
  type StoredCorrection,
  type StoredCorrections,
} from "@/lib/merchant";
import { nextSaveState, restoreFromDocument, type SaveState } from "@/lib/merchant-session";
import { putTransient, readDocument, type WriteResult } from "@/lib/merchant-storage";

/**
 * The storage problems a GM has to be told about.
 *
 * Phase 3 renders these through `StorageNotice`. They are captured from the
 * moment they happen because the alternative is finding out at render time that
 * the reason is gone — and "you had data and are not seeing it" is exactly the
 * case the PRD guardrail is about.
 */
type StorageCondition = "unavailable" | "quota-exceeded" | "future-version" | "quarantined" | "unreadable";

/**
 * The merchant's header — everything persisted about it except the rows.
 *
 * It is held apart from `category` / `wealth` state on purpose: those two are
 * the *controls*, and the GM can move them without generating anything. A
 * correction committed after such a move must write the merchant that is
 * actually on screen, not the shop the controls are currently describing.
 * Carrying the header also preserves `id` and `createdAt` across corrections,
 * so correcting a restored merchant updates it instead of minting a new one.
 */
interface MerchantHeader {
  id: string;
  name: string;
  category: CategoryId;
  wealth: Wealth;
  createdAt: string;
}

/**
 * The overlay as storage holds it.
 *
 * S-02's map types its values `Correction | undefined` — most rows have no
 * entry and `noUncheckedIndexedAccess` is off — while the stored format has no
 * such hole. Built field by field rather than spread, matching `toStoredRows`:
 * an absent key must stay absent, because `isCorrected` reads "never touched"
 * from the absence itself.
 */
function toStoredCorrections(corrections: CorrectionMap): StoredCorrections {
  const stored: StoredCorrections = {};

  for (const [itemId, correction] of Object.entries(corrections)) {
    if (!correction) continue;

    const entry: StoredCorrection = {};
    if (correction.quantity !== undefined) entry.quantity = correction.quantity;
    if (correction.priceGp !== undefined) entry.priceGp = correction.priceGp;

    stored[itemId] = entry;
  }

  return stored;
}

/** Which notice a failed write earns, or `null` when there is nothing to say. */
function conditionFromWrite(status: WriteResult["status"]): StorageCondition | null {
  switch (status) {
    case "ok":
      return null;
    case "unavailable":
      return "unavailable";
    case "quota-exceeded":
      return "quota-exceeded";
    case "read-only":
      // The latch is already engaged, and whatever engaged it — `future-version`
      // or `unreadable` — recorded its own condition on the mount read.
      // Reporting "read-only" here would replace the reason with its consequence.
      return null;
  }
}

/**
 * The generator: two choices, one button, one table — and now a memory.
 *
 * The last generated merchant is restored on mount and rewritten on every draw
 * and every committed correction, so closing the tab mid-session costs nothing
 * (US-03, FR-009).
 */
export default function MerchantGenerator() {
  // Seeded from the first entry so the controls are never empty.
  const [category, setCategory] = useState<CategoryId>(CATEGORIES[0].id);
  const [wealth, setWealth] = useState<Wealth>(WEALTH_LEVELS[0].id);

  // `null` means "nothing generated yet" — the empty state. Distinct from an
  // empty array, which would mean a draw returned nothing.
  const [rows, setRows] = useState<AssortmentRow[] | null>(null);

  // The GM's hand corrections, keyed by itemId and kept SEPARATE from `rows`
  // so the generated values survive every edit. That separation is what lets
  // an edit-and-revert compare equal to the original — see `corrections.ts`.
  const [corrections, setCorrections] = useState<CorrectionMap>({});

  // The previous draw for this shop, biased against so a second press
  // produces a visibly different list.
  const [recentIds, setRecentIds] = useState<string[]>([]);

  const [error, setError] = useState<string | null>(null);

  // What is being persisted, minus the rows. `null` alongside `rows === null`.
  const [header, setHeader] = useState<MerchantHeader | null>(null);

  // Both values are deliberately unbound: Phase 3 is what renders the save
  // button and the storage notice. The state exists now so the statuses and
  // transitions are captured at the moment they happen rather than
  // reconstructed later — a condition that is discarded cannot be shown.
  const [, setSaveState] = useState<SaveState>("unavailable");
  const [, setStorageStatus] = useState<StorageCondition | null>(null);

  // The guardrail. Open means a draw is pending the GM's answer; nothing has
  // been replaced yet.
  const [confirmOpen, setConfirmOpen] = useState(false);

  /**
   * Bring back the last merchant, with no GM action.
   *
   * An effect and not a lazy `useState` initializer: the island is
   * server-rendered during prerender, so reading `localStorage` in the first
   * render is a hydration mismatch. The cost is one empty frame before the
   * swap, which lands in the same frame as hydration because the read is
   * synchronous.
   *
   * **Read-only, and safe to run twice.** It never calls `putTransient`, so
   * React 19's dev StrictMode double-invoke needs no guarding ref. That is also
   * why nothing below persists in response to state: an effect watching `rows`
   * would fire on this restore and turn every page load into a write, which in
   * a two-tab session puts older data over newer.
   */
  useEffect(() => {
    const read = readDocument();

    switch (read.status) {
      case "ok": {
        const restored = restoreFromDocument(read.doc);
        if (restored === null) return;

        const { merchant } = restored;

        // `set-state-in-effect` asks "do you need an effect?" — here, yes. The
        // island is server-rendered on a prerendered route, so reading
        // `localStorage` from a lazy `useState` initializer would give the
        // server an empty state and the client a populated one: a hydration
        // mismatch. The effect is the only place the read can happen, and the
        // document has to reach state somehow.
        //
        // The cascade the rule guards against does not occur. This runs once on
        // mount, sets every field in one batch, and nothing re-triggers it;
        // restoring is read-only, so StrictMode's double-invoke is a second
        // identical batch rather than a loop.
        /* eslint-disable react-hooks/set-state-in-effect -- one-shot restore on mount; see above */
        setRows(fromStoredRows(merchant.rows));
        setCorrections(merchant.corrections);
        setCategory(restored.category);
        setWealth(restored.wealth);
        setRecentIds(restored.recentIds);
        setHeader({
          id: merchant.id,
          name: merchant.name,
          // The merchant's OWN category and wealth, not the controls above.
          // Those two may have fallen back to a default because the stored
          // value is no longer in the catalog; writing the fallback back would
          // quietly rewrite a value this build merely fails to recognise.
          category: merchant.category,
          wealth: merchant.wealth,
          createdAt: merchant.createdAt,
        });
        setSaveState((current) => nextSaveState(current, "restored"));
        /* eslint-enable react-hooks/set-state-in-effect */
        return;
      }

      case "empty":
        // A first-ever visit, or one after the GM cleared site data. Neither is
        // an error, and the ordinary empty state is the honest answer to both.
        return;

      case "unavailable":
      case "future-version":
      case "quarantined":
      case "unreadable":
        setStorageStatus(read.status);
        return;
    }
  }, []);

  /**
   * Write the merchant now on screen into the transient slot.
   *
   * Called imperatively from the two action sites and from nowhere else. The
   * realistic loss this defends against is a mobile OS killing a backgrounded
   * tab, which fires no lifecycle hook — so waiting for one would not help.
   *
   * A failed write never throws and never blocks generating or editing; it is
   * recorded and, from Phase 3, shown.
   */
  function persist(merchantHeader: MerchantHeader, nextRows: readonly AssortmentRow[], nextCorrections: CorrectionMap) {
    const merchant: Merchant = {
      id: merchantHeader.id,
      name: merchantHeader.name,
      category: merchantHeader.category,
      wealth: merchantHeader.wealth,
      createdAt: merchantHeader.createdAt,
      // The transient slot is unsaved by definition. `promoteTransient` stamps
      // `savedAt` on the copy it appends to the durable collection, never here.
      savedAt: null,
      rows: toStoredRows(nextRows),
      corrections: toStoredCorrections(nextCorrections),
    };

    const condition = conditionFromWrite(putTransient(merchant).status);
    if (condition !== null) {
      setStorageStatus(condition);
    }
  }

  /**
   * Every path into a row replacement goes through here.
   *
   * The guard is on the Generate *action*, not on whether category or wealth
   * changed. That is knowingly broader than FR-006's literal "dla tej samej
   * kategorii": changing category and then generating destroys corrections just
   * as thoroughly, and the guardrail does not distinguish.
   */
  function handleGenerate() {
    if (rows !== null && hasCorrections(rows, corrections)) {
      setConfirmOpen(true);
      return;
    }

    draw();
  }

  function handleConfirmRegenerate() {
    setConfirmOpen(false);
    draw();
  }

  // Changes nothing: not the rows, not the overlay, not category or wealth, and
  // not `recentIds` — the recency bias belongs to a draw that actually happened,
  // so a cancelled Generate must leave the next one just as biased.
  function handleCancelRegenerate() {
    setConfirmOpen(false);
  }

  /**
   * The draw itself, and the only place a merchant is minted.
   *
   * Both routes into a replacement — the ungated press and the dialog's confirm
   * — land here, which is why the write belongs here and not on the Generate
   * button: a gated press draws nothing, and wiring the write to the button
   * would persist stale rows then and skip the write on the confirmed draw.
   */
  function draw() {
    try {
      const next = generateAssortment(category, wealth, { recentIds });
      const now = new Date();
      const drawn: MerchantHeader = {
        id: newMerchantId(),
        name: autoName(category, now),
        category,
        wealth,
        createdAt: now.toISOString(),
      };

      // A new draw is a new shop: the overlay clears wholesale, because there
      // is no coherent reading where a correction re-attaches to a re-rolled
      // item. React batches these into ONE commit, so no render ever pairs a
      // stale overlay with fresh rows — which would briefly show corrections on
      // items the GM never touched.
      setRows(next);
      setCorrections({});
      setRecentIds(next.map((row) => row.itemId));
      setError(null);
      setHeader(drawn);
      setSaveState((current) => nextSaveState(current, "generated"));

      // The values, not the state they were just handed to: a setter's effect
      // is not visible until the next render, and this write must carry the
      // shop the GM is about to see.
      persist(drawn, next, {});
    } catch (cause) {
      // Unreachable against the committed catalog — `npm run data:build` can
      // reshape tier depth, and an uncaught throw would blank the only page
      // the product has. Nothing is persisted: the last good merchant stays in
      // storage rather than being replaced by a failure.
      setRows(null);
      setCorrections({});
      setHeader(null);
      setError(
        cause instanceof AssortmentPoolError
          ? "Nie udało się ułożyć asortymentu z dostępnej puli przedmiotów."
          : "Coś poszło nie tak przy tworzeniu asortymentu.",
      );
    }
  }

  // One committed edit, merged into the overlay. A patch carries only the
  // field that changed, so correcting a price never clears a corrected quantity.
  //
  // An edit that restores the generated value leaves its key in place with an
  // equal value. That is fine and deliberate: `isCorrected` decides by
  // comparison, so pruning keys here would be work that buys nothing.
  //
  // The merge is computed rather than expressed as a `setCorrections` updater
  // because the write below needs the merged map, and a setter does not hand it
  // back. Reading `corrections` from this render is correct: S-02 commits one
  // cell per blur, so two corrections cannot land inside one render.
  function handleCorrect(itemId: string, patch: Correction) {
    const next: CorrectionMap = { ...corrections, [itemId]: { ...corrections[itemId], ...patch } };

    setCorrections(next);
    setSaveState((current) => nextSaveState(current, "corrected"));

    if (rows !== null && header !== null) {
      persist(header, rows, next);
    }
  }

  // Changing category or wealth does not touch the overlay, because it does not
  // replace rows either. Only a draw does — which is also why neither of these
  // persists: nothing about the stored merchant has changed.
  //
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

      {error === null && rows !== null && (
        <MerchantTable rows={rows} corrections={corrections} onCorrect={handleCorrect} />
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Odrzucić ręczne korekty?"
        body="Masz ręcznie poprawione ceny lub ilości. Nowy asortyment skasuje te poprawki — nie da się ich odtworzyć."
        confirmLabel="Stwórz mimo to"
        cancelLabel="Anuluj"
        destructive
        onConfirm={handleConfirmRegenerate}
        onCancel={handleCancelRegenerate}
      />
    </main>
  );
}
