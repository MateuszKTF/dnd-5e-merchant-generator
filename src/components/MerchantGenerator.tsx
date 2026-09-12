import { useCallback, useEffect, useState } from "react";

import ConfirmDialog from "@/components/ConfirmDialog";
import MerchantLibrary from "@/components/MerchantLibrary";
import MerchantTable from "@/components/MerchantTable";
import StorageNotice, { type StorageCondition } from "@/components/StorageNotice";
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
import {
  nextSaveSession,
  restoreFromDocument,
  restoreFromMerchant,
  saveActionFor,
  type RestoredSession,
  type SaveSession,
  type SaveSessionEvent,
} from "@/lib/merchant-session";
import {
  deleteMerchant,
  promoteTransient,
  putTransient,
  readDocument,
  renameMerchant,
  updateSavedMerchant,
  STORAGE_KEY,
  type PromoteResult,
  type ReadResult,
} from "@/lib/merchant-storage";

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
 * An irreversible action the GM has been asked to confirm, held until they
 * answer.
 *
 * Three actions destroy something that cannot be got back: a fresh draw and
 * opening a different merchant both discard hand corrections, and a delete
 * removes a saved merchant from storage outright. They share one gate — and
 * one `<dialog>` — rather than one each, so two modals can never be open at
 * once, and the pending action is carried *as data* (the merchant included) so
 * a confirm cannot lose track of which of the three it was confirming.
 */
type PendingAction =
  | { readonly kind: "generate" }
  | { readonly kind: "open"; readonly merchant: Merchant }
  | { readonly kind: "delete"; readonly merchant: Merchant };

/** The copy for one pending action. Named per action, never generic. */
interface ConfirmCopy {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
}

/**
 * What the dialog says, per action.
 *
 * Each names what is about to be lost and what is about to happen. "Nowy
 * asortyment" over a tapped library row, or "odrzucić korekty" over a delete,
 * would describe the wrong action to someone about to agree to it.
 */
function confirmCopyFor(action: PendingAction): ConfirmCopy {
  switch (action.kind) {
    case "generate":
      return {
        title: "Odrzucić ręczne korekty?",
        body: "Masz ręcznie poprawione ceny lub ilości. Nowy asortyment skasuje te poprawki — nie da się ich odtworzyć.",
        confirmLabel: "Stwórz mimo to",
      };
    case "open":
      return {
        title: "Odrzucić ręczne korekty?",
        body: "Masz ręcznie poprawione ceny lub ilości. Otwarcie innego kupca skasuje te poprawki — nie da się ich odtworzyć.",
        confirmLabel: "Otwórz mimo to",
      };
    case "delete":
      return {
        title: "Usunąć kupca?",
        // The name is the whole point: this is the one dialog where the GM has
        // to know *which* record they are about to lose, and the list may hold
        // two shops sharing a name.
        body: `„${action.merchant.name}” zniknie z listy i z pamięci przeglądarki. Nie da się tego cofnąć.`,
        confirmLabel: "Usuń",
      };
  }
}

/**
 * What the save button says, in the two dimensions it has to be honest about:
 * whether the last press landed, and which record the next one would write.
 *
 * Derived from the same value `handleSave` branches on, so the label and the
 * action cannot disagree.
 */
function saveButtonLabel(session: SaveSession): string {
  const updating = saveActionFor(session) === "update";

  if (session.state === "saved") {
    return updating ? "Zapisano zmiany" : "Zapisano";
  }

  return updating ? "Zapisz zmiany" : "Zapisz";
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

/**
 * Which notice a failed write or a failed save earns, or `null` when the reason
 * is already on screen.
 *
 * Shared by `putTransient` and `promoteTransient` because their failure modes
 * are the same store's, and a GM does not care which call discovered it.
 */
/**
 * Why a write did not land, or `null` when it did.
 *
 * `promoteTransient`, `updateSavedMerchant` and `renameMerchant` all fail in
 * exactly these four ways, so the three save paths share one vocabulary and one
 * notice mapping instead of each inventing their own.
 */
type WriteFailure = Exclude<PromoteResult["status"], "ok">;

function conditionFromFailure(status: WriteFailure): StorageCondition | null {
  switch (status) {
    case "unavailable":
      return "unavailable";
    case "quota-exceeded":
      return "quota-exceeded";
    case "read-only":
      // The latch is already engaged, and whatever engaged it — `future-version`
      // or `unreadable` — recorded its own condition when the read hit it.
      // Reporting "read-only" would replace the reason with its consequence.
      return null;
    case "not-found":
      // There is no transient record to promote, which means the auto-persist
      // never landed — and that failure raised its own notice at the time.
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

  // What the save button may claim AND which record a press would write. One
  // value, one reducer — see `merchant-session.ts` for why the two halves must
  // not move separately, and for the transition table (in particular that a
  // failed promote leaves this `armed` rather than moving it to `saved`).
  // Read through `session` below, never directly: the opened record has to be
  // reconciled against the list before anything acts on it.
  const [storedSession, setSession] = useState<SaveSession>({ state: "unavailable", openedSavedId: null });

  // The durable collection, held here rather than re-read per render so a
  // merchant saved a moment ago shows up in the panel without a round-trip.
  // Refreshed from the SAME read that restores the session — a sibling
  // `listSaved()` would parse the document twice and, worse, produce a second
  // failure surface with no sensible answer to which result wins.
  const [saved, setSaved] = useState<readonly Merchant[]>([]);

  // The storage problem to show, if any. `null` is the ordinary case.
  const [storageStatus, setStorageStatus] = useState<StorageCondition | null>(null);

  /**
   * The save session, with the opened record reconciled against the list.
   *
   * **A record that has left `saved` is no longer open.** S-04 tracks
   * `openedSavedId` so Zapisz can save in place; once that record is deleted the
   * id points at nothing, and `updateSavedMerchant` answers `not-found` without
   * appending — so the button would fail to save with no visible cause.
   *
   * Derived on every render rather than repaired in the delete handler, because
   * a delete is not the only way a record leaves the list: another tab's delete
   * arrives through the `storage` listener below and never passes through any
   * handler here. Deriving makes the rule total — it holds for the local
   * delete, the cross-tab delete, and any future path that removes a record —
   * and it does it without an effect that syncs state to state.
   *
   * The stored id is left alone; nothing reads it directly. Everything below
   * reads this.
   */
  const session: SaveSession = {
    state: storedSession.state,
    openedSavedId:
      storedSession.openedSavedId !== null && saved.some((entry) => entry.id === storedSession.openedSavedId)
        ? storedSession.openedSavedId
        : null,
  };

  // The guardrail. Non-null means an irreversible action is pending the GM's
  // answer; nothing has been replaced or removed yet.
  const [pending, setPending] = useState<PendingAction | null>(null);

  /**
   * Put a stored merchant on screen. The mount read, the cross-tab re-read and
   * S-04's open all land here, so the three can never drift apart in what they
   * set.
   *
   * The caller supplies the event rather than this function assuming
   * `"restored"`: opening a saved merchant has to record *which* record is open
   * in the same commit that puts its rows on screen. React batches every setter
   * below into one commit, so the id can never land a render after the rows —
   * which is precisely the gap in which a Zapisz would append a copy of the
   * merchant the GM just opened.
   *
   * Every setter is stable, so the empty dependency list is honest and this
   * identity never changes — which is what lets the effects below keep their
   * own dependencies minimal.
   */
  const adopt = useCallback((restored: RestoredSession, event: SaveSessionEvent) => {
    const { merchant } = restored;

    setRows(fromStoredRows(merchant.rows));
    setCorrections(merchant.corrections);
    setCategory(restored.category);
    setWealth(restored.wealth);
    setRecentIds(restored.recentIds);
    setHeader({
      id: merchant.id,
      name: merchant.name,
      // The merchant's OWN category and wealth, not the controls above. Those
      // two may have fallen back to a default because the stored value is no
      // longer in the catalog; writing the fallback back would quietly rewrite
      // a value this build merely fails to recognise.
      category: merchant.category,
      wealth: merchant.wealth,
      createdAt: merchant.createdAt,
    });
    setSession((current) => nextSaveSession(current, event));
  }, []);

  /**
   * Route a read that did not come back `ok`, from either read site.
   *
   * `future-version` stands persistence down for the rest of the page load:
   * F-01 has latched read-only, so every subsequent write would be refused, and
   * a button that invites the attempt invites the one write the latch exists to
   * prevent. The other three raise their notice and change nothing else —
   * a disabled or full store is recoverable, and the GM should be able to press
   * Save, read the failure and act on it.
   */
  const handleFailedRead = useCallback((status: Exclude<ReadResult["status"], "ok" | "empty">) => {
    setStorageStatus(status);

    if (status === "future-version") {
      setSession((current) => nextSaveSession(current, { event: "persistence-off" }));
    }
  }, []);

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
   *
   * The rule disabled here asks "do you need an effect?" — and here, yes: the
   * read cannot happen anywhere else, and the document has to reach state
   * somehow. The cascade it guards against does not occur, because this runs
   * once on mount, sets every field in one batch, and nothing re-triggers it.
   */
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot restore on mount; see above */
  useEffect(() => {
    const read = readDocument();

    switch (read.status) {
      case "ok": {
        // The saved collection comes off THIS read, not a sibling `listSaved()`
        // — and it is set whether or not there is a transient record to
        // restore, because a GM can have a library with nothing on screen.
        setSaved(read.doc.saved);

        const restored = restoreFromDocument(read.doc);
        if (restored !== null) {
          adopt(restored, { event: "restored" });
        }
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
        handleFailedRead(read.status);
        return;
    }
  }, [adopt, handleFailedRead]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * Notice when another tab replaces the merchant.
   *
   * One key and two tabs auto-persisting means the later write destroys the
   * earlier tab's merchant. Nothing upstream addresses it, and "corrections
   * silently lost" is inside the PRD guardrail however it happens — so this tab
   * at least stops diverging in silence.
   *
   * The event fires for every key on the origin and never in the tab that
   * wrote, so it needs a key check but no self-filtering.
   */
  useEffect(() => {
    function handleStorageEvent(event: StorageEvent) {
      if (event.key !== STORAGE_KEY) return;

      const read = readDocument();

      if (read.status !== "ok") {
        // A tab that was working fine can re-read into `quarantined`,
        // `future-version` or `unreadable` mid-session — another tab may be
        // running a newer build, or the store may have filled since mount. In
        // none of those is there an incoming record to adopt, so local state is
        // left strictly alone: clearing the table here would destroy the
        // merchant the GM is reading from, on the strength of a failure in a
        // different tab. `empty` is the other tab clearing site data, which is
        // likewise no reason to take this tab's merchant away.
        if (read.status !== "empty") {
          handleFailedRead(read.status);
        }
        return;
      }

      // Only an `ok` re-read may refresh the library — the same rule this
      // handler already applies to adopting the transient record. Every other
      // outcome means there is no trustworthy collection to swap in, and
      // emptying the panel on the strength of another tab's failure would read
      // as the GM's saved merchants having disappeared.
      setSaved(read.doc.saved);

      const incoming = restoreFromDocument(read.doc);
      if (incoming === null) return;

      // Only hand corrections earn the notice. A superseded draw is visible on
      // its own — the table simply changes — but corrections are work the GM
      // did by hand and cannot get back, so their loss must be said out loud.
      if (rows !== null && hasCorrections(rows, corrections)) {
        setStorageStatus("superseded");
      }

      adopt(incoming, { event: "restored" });
    }

    window.addEventListener("storage", handleStorageEvent);
    return () => {
      window.removeEventListener("storage", handleStorageEvent);
    };
  }, [adopt, handleFailedRead, rows, corrections]);

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
    // The stand-down, honoured at both call sites because it lives here. Only
    // `stood-down` refuses the write — F-01 has latched read-only over a
    // document a newer build owns, and writing would strip whatever that build
    // added. A disabled or full store is deliberately NOT a stand-down: those
    // writes should be attempted, so their failure can name a remedy the GM can
    // act on.
    if (session.state === "stood-down") {
      return;
    }

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

    const written = putTransient(merchant);
    if (written.status !== "ok") {
      const condition = conditionFromFailure(written.status);
      if (condition !== null) {
        setStorageStatus(condition);
      }
    }
  }

  /**
   * FR-009's explicit save: mark the merchant on screen as durable.
   *
   * `promoteTransient` copies the transient record into the saved collection
   * under a fresh id, so two presses would produce two entries. The guard is
   * the button's own state: a successful promote moves it to `saved`, and only
   * a later generate or a committed correction re-arms it.
   *
   * **The state moves on the returned status, never on the press.** A promote
   * that came back `quota-exceeded`, `unavailable` or `read-only` wrote
   * nothing, and a button reading "Zapisano" over an unsaved merchant is the
   * PRD's heaviest guardrail violation wearing a checkmark. Now that the list
   * is on screen the lie would also be visible — the merchant simply would not
   * be in it — which makes honesty here cheaper to check, not less important.
   */
  function handleSave() {
    // The branch this whole slice turns on. With a record open the GM is
    // editing THAT merchant, and promoting would leave a second near-identical
    // entry in the list they are looking at — US-02 says a saved assortment
    // stays the one that was saved. With nothing open there is no record to
    // update, so a save adds one.
    const failure = session.openedSavedId === null ? addMerchant() : updateOpenedMerchant(session.openedSavedId);

    if (failure === null) {
      // Both paths report the same event, so S-03's rule — the state moves on
      // the returned status, never on the press — holds for both unchanged.
      // `openedSavedId` survives a promote: the GM is still looking at that
      // merchant, and a further correction re-arms the button for another
      // in-place save.
      setSession((current) => nextSaveSession(current, { event: "promoted" }));
      return;
    }

    setSession((current) => nextSaveSession(current, { event: "promote-failed" }));

    const condition = conditionFromFailure(failure);
    if (condition !== null) {
      setStorageStatus(condition);
    }
  }

  /** Append a new record. Returns the failure, or `null` when it landed. */
  function addMerchant(): WriteFailure | null {
    const result = promoteTransient();
    if (result.status !== "ok") {
      return result.status;
    }

    // From the returned record, not a re-read. `promoteTransient` hands back
    // exactly what it appended, so the panel is correct without parsing the
    // document a second time.
    setSaved((current) => [...current, result.merchant]);
    return null;
  }

  /**
   * Write the merchant on screen back over the record it came from.
   *
   * `updateSavedMerchant` refuses to touch `id`, `createdAt` or `name` — the
   * three fields that make it the same merchant — so an in-place save can
   * change what the shop sells and never which shop it is.
   */
  function updateOpenedMerchant(id: string): WriteFailure | null {
    // Unreachable: `openedSavedId` is only set by an open, which puts rows on
    // screen. Answering rather than asserting keeps a bug from blanking the
    // page, and `not-found` is the honest name for "there is no record here".
    if (rows === null) {
      return "not-found";
    }

    const patch = { rows: toStoredRows(rows), corrections: toStoredCorrections(corrections) };

    const result = updateSavedMerchant(id, patch);
    if (result.status !== "ok") {
      return result.status;
    }

    // The stamp is recomputed rather than read back, so the row's save time and
    // its new position in the list are right without re-parsing the document.
    // It can differ from the stored value by under a millisecond; the row shows
    // minutes.
    const savedAt = new Date().toISOString();
    setSaved((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch, savedAt } : entry)));
    return null;
  }

  /**
   * FR-010's rename, already normalized and known to differ by the row.
   *
   * A failed write leaves the list exactly as it was — the row falls back to
   * the name still held here — and says why.
   */
  function handleRename(id: string, name: string) {
    const result = renameMerchant(id, name);

    if (result.status === "ok") {
      setSaved((current) => current.map((entry) => (entry.id === id ? { ...entry, name } : entry)));
      return;
    }

    const condition = conditionFromFailure(result.status);
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
      setPending({ kind: "generate" });
      return;
    }

    draw();
  }

  /**
   * A tap on a row of the library — the second way to destroy unsaved
   * corrections, and therefore the second caller of the same gate.
   *
   * The check is identical to Generate's, deliberately: "open" is a different
   * button doing the same damage, and the guardrail does not care which control
   * did it. Only the dialog's copy differs, because what is about to replace
   * the work is a different thing.
   */
  function handleOpen(merchant: Merchant) {
    if (rows !== null && hasCorrections(rows, corrections)) {
      setPending({ kind: "open", merchant });
      return;
    }

    openMerchant(merchant);
  }

  /**
   * A tap on a row's delete control. Never deletes on its own — a saved
   * merchant leaving storage is exactly what US-02's guardrail is about, so it
   * always goes through the dialog, which names the record.
   */
  function handleDelete(id: string) {
    const merchant = saved.find((entry) => entry.id === id);
    if (merchant === undefined) return;

    setPending({ kind: "delete", merchant });
  }

  function handleConfirm() {
    // Read before clearing: the merchant is carried by the pending action
    // itself, so confirming cannot lose track of which action it was.
    const confirmed = pending;
    setPending(null);

    if (confirmed === null) return;

    switch (confirmed.kind) {
      case "generate":
        draw();
        return;
      case "open":
        openMerchant(confirmed.merchant);
        return;
      case "delete":
        deleteSavedMerchant(confirmed.merchant.id);
        return;
    }
  }

  /**
   * FR-013's delete, the only way anything leaves storage.
   *
   * **The row goes only once the write says so.** Removing it first would show
   * a merchant as deleted while it is still in the document, and a reload would
   * resurrect it — a lie the GM would have already acted on.
   *
   * `not-found` counts as success. It means another tab deleted the record
   * while this tab's confirmation was open: the GM wanted it gone and it is
   * gone, so dropping the row and staying quiet is the honest answer. Raising a
   * failure notice there would report a problem that does not exist.
   */
  function deleteSavedMerchant(id: string) {
    const result = deleteMerchant(id);

    if (result.status === "ok" || result.status === "not-found") {
      setSaved((current) => current.filter((entry) => entry.id !== id));
      return;
    }

    const condition = conditionFromFailure(result.status);
    if (condition !== null) {
      setStorageStatus(condition);
    }
  }

  // Changes nothing: not the rows, not the overlay, not category or wealth, not
  // `openedSavedId`, not the saved list, and not `recentIds` — the recency bias
  // belongs to a draw that actually happened, so a cancelled action must leave
  // the next one just as biased.
  function handleCancel() {
    setPending(null);
  }

  /**
   * Bring a saved merchant back onto the page.
   *
   * Three things have to land together, and they do because `adopt` batches
   * them into one commit: the rows and controls, the transient write, and
   * `openedSavedId`. If the id arrived a render late, a Zapisz pressed
   * immediately after opening would append a near-identical copy to the list
   * the GM is looking at — the exact duplicate this slice exists to prevent.
   *
   * **The transient slot is written too.** Otherwise a reload would restore the
   * merchant that was on screen *before* the open, which reads as the app
   * forgetting a deliberate action.
   */
  function openMerchant(merchant: Merchant) {
    const restored = restoreFromMerchant(merchant);

    // Only a hand-edited record with no rows gets here. There is nothing to put
    // on screen, and blanking the table over it would be worse than the tap
    // appearing to do nothing — the row already shows "0 poz.".
    if (restored === null) return;

    adopt(restored, { event: "opened", savedId: merchant.id });

    // The merchant's OWN header, not the controls: those may have fallen back
    // to a default because a stored value is no longer in the catalog, and
    // writing the fallback back would rewrite a value this build merely fails
    // to recognise.
    persist(
      {
        id: merchant.id,
        name: merchant.name,
        category: merchant.category,
        wealth: merchant.wealth,
        createdAt: merchant.createdAt,
      },
      fromStoredRows(merchant.rows),
      merchant.corrections,
    );
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
      // Two events, one commit. `generated` alone would clear `openedSavedId`
      // — the reducer makes sure of that, because an id outliving a draw means
      // the next Zapisz overwrites a saved merchant with an unrelated shop.
      // Saying `cleared-open` out loud here keeps the intent at the call site
      // rather than resting on a rule written somewhere else.
      setSession((current) =>
        nextSaveSession(nextSaveSession(current, { event: "cleared-open" }), { event: "generated" }),
      );

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
    setSession((current) => nextSaveSession(current, { event: "corrected" }));

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

  // The closed dialog still needs strings for its required props. Falling back
  // to the regenerate copy is arbitrary and invisible: nothing renders it,
  // because `open` is false in exactly the case this fallback covers.
  const copy = confirmCopyFor(pending ?? { kind: "generate" });

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

        {/* Only once there is a merchant to save. `stood-down` still renders it,
            disabled: the GM should be able to see that saving exists and read
            the notice explaining why it is off, rather than find the control
            missing with no explanation.

            The label names the action, because the GM can see the list and a
            button that silently adds when they expected an update — or the
            reverse — is contradicted by what is on screen a moment later. */}
        {rows !== null && (
          <Button onClick={handleSave} disabled={session.state !== "armed"} variant="secondary" className="h-11 px-6">
            {saveButtonLabel(session)}
          </Button>
        )}
      </div>

      <StorageNotice condition={storageStatus} />

      {/* Above the table, because a GM returning for the next session comes
          here first — and collapsed, so it costs one bar rather than the
          assortment's place above the fold. */}
      <MerchantLibrary
        saved={saved}
        openedSavedId={session.openedSavedId}
        onOpen={handleOpen}
        onRename={handleRename}
        onDelete={handleDelete}
      />

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

      {/* One dialog, three callers — regenerate, open, delete. The copy is
          chosen per action so the sentence the GM agrees to describes the thing
          that is about to happen, and `destructive` keeps a stray Enter off the
          confirming button in all three. */}
      <ConfirmDialog
        open={pending !== null}
        title={copy.title}
        body={copy.body}
        confirmLabel={copy.confirmLabel}
        cancelLabel="Anuluj"
        destructive
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </main>
  );
}
