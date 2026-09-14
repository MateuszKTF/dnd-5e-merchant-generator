import { useCallback, useEffect, useRef, useState } from "react";

import ConfirmDialog from "@/components/ConfirmDialog";
import MerchantLibrary, { LIBRARY_TOGGLE_ID } from "@/components/MerchantLibrary";
import MerchantTable from "@/components/MerchantTable";
import StorageNotice, { isStandingCondition, type StorageCondition } from "@/components/StorageNotice";
import { Button } from "@/components/ui/button";
import { CATEGORIES, WEALTH_LEVELS, type CategoryId, type Wealth } from "@/data/items";
import { AssortmentPoolError, generateAssortment, type AssortmentRow } from "@/lib/assortment";
import { hasCorrections, type Correction, type CorrectionMap } from "@/lib/corrections";
import {
  autoName,
  fromStoredCorrections,
  fromStoredRows,
  newMerchantId,
  toStoredCorrections,
  toStoredRows,
  type Merchant,
} from "@/lib/merchant";
import {
  nextSaveSession,
  nextSaveState,
  openedSavedIdFor,
  wouldLoseCorrections,
  restoreFromDocument,
  restoreFromMerchant,
  type RestoredSession,
  type SaveSession,
  type SaveSessionEvent,
  type SaveState,
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
  type StorageDocument,
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
 *
 * `currentName` rather than the snapshotted `action.merchant.name`: the pending
 * action is captured when the dialog opens, but a rename in another tab arrives
 * while it is still open — and a rename leaves the transient slot untouched, so
 * the `storage` handler returns early and `pending` survives. The delete itself
 * is id-based and stays correct; only the sentence would go stale, naming a
 * record by a name it no longer has while the announcement afterwards uses the
 * new one.
 */
function confirmCopyFor(action: PendingAction, currentName: string): ConfirmCopy {
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
        body: `„${currentName}” zniknie z listy i z pamięci przeglądarki. Nie da się tego cofnąć.`,
        confirmLabel: "Usuń",
      };
  }
}

/**
 * Would replacing what is on screen destroy something unrecoverable?
 *
 * Module scope and fully explicit about its inputs so that **every site asking
 * this question gets the same answer**. It used to be asked two ways — the
 * gate called `wouldLoseCorrections` while the cross-tab handler called bare
 * `hasCorrections` — and the second one warned about losses that had not
 * happened, which is the cry-wolf failure the guard exists to avoid.
 *
 * Taking its arguments rather than closing over state is what lets the
 * `storage` effect call it without a stale closure: the effect lists these
 * values in its dependencies, and a plain method on the component would hide
 * that requirement.
 */
function wouldLoseWork(
  rows: readonly AssortmentRow[] | null,
  corrections: CorrectionMap,
  openedSavedId: string | null,
  autosaveFailed: boolean,
): boolean {
  // An open record only counts as somewhere the work lives if its last write
  // actually landed. A failed autosave makes this screen the only copy again.
  const holdingTheWork = openedSavedId !== null && !autosaveFailed;

  return wouldLoseCorrections(
    rows !== null && hasCorrections(rows, corrections),
    holdingTheWork ? openedSavedId : null,
  );
}

/**
 * What the save button says. Only one dimension is left to be honest about —
 * whether the last press landed — because the button is not rendered at all
 * once a record is open.
 */
function saveButtonLabel(state: SaveState): string {
  return state === "saved" ? "Zapisano" : "Zapisz";
}

/**
 * Which event an adopted document deserves: an ordinary restore, or a reopen of
 * the saved record it came from.
 *
 * Both read sites use it, so a merchant opened in one tab is still recognised as
 * open in the other — the two paths cannot drift on the one rule that decides
 * whether corrections auto-save.
 */
function reopenEvent(doc: StorageDocument): SaveSessionEvent {
  const openedId = openedSavedIdFor(doc);
  return openedId === null ? { event: "restored" } : { event: "opened", savedId: openedId };
}

/**
 * Which read outcomes stand persistence down for the rest of the page load.
 *
 * The rule that separates these three from the rest is recoverability *from
 * inside this build*: a document a newer build owns, one older than any
 * migration this build carries, and one whose quarantine could not be written
 * are all dead ends here. A disabled store, a full one, and a store that
 * refuses writes are not — the first two are fixed by the GM, and the third is
 * fixed by leaving private mode, so each keeps a pressable button whose failure
 * can name its remedy.
 *
 * **One predicate, both discovery paths.** The same three statuses used to be
 * spelled out twice — once here over `StorageCondition` and once inline in
 * `handleFailedRead` — with nothing linking the copies, so a fourth latching
 * status would have had to be remembered in two places and would have compiled
 * either way. Taking `ReadResult["status"]` is what lets the write path use it
 * too: `loadForWrite` collapses four causes into one `read-only`, so the only
 * way a write can know which happened is to re-read and ask this.
 */
function standsPersistenceDown(
  status: ReadResult["status"],
): status is "future-version" | "needs-migration" | "unreadable" {
  return status === "future-version" || status === "needs-migration" || status === "unreadable";
}

/** The delete announcement's region, written to imperatively — see the effect. */
const DELETE_NOTICE_ID = "merchant-delete-notice";

/**
 * Why a write did not land.
 *
 * `putTransient`, `promoteTransient`, `updateSavedMerchant`, `renameMerchant`
 * and `deleteMerchant` all fail in exactly these four ways, so every write path
 * shares one vocabulary and one notice mapping instead of each inventing its own.
 */
type WriteFailure = Exclude<PromoteResult["status"], "ok">;

/**
 * Which notice a failed write earns, or `null` when the reason is already on
 * screen.
 *
 * The failure modes are the same store's whichever call discovered them, and a
 * GM does not care which one did.
 */
function conditionFromFailure(status: WriteFailure): StorageCondition | null {
  switch (status) {
    case "unavailable":
      return "unavailable";
    case "quota-exceeded":
      return "quota-exceeded";
    case "read-only":
      // Decided by `raiseWriteFailure`, the only caller that can see whether a
      // standing condition actually recorded the reason. A flat `null` here was
      // wrong: it assumed a *read* engaged the latch, and a write can engage it
      // too.
      return null;
    case "not-found":
      // There is no transient record to promote, which means the auto-persist
      // never landed. The old reasoning here was that the failure "raised its
      // own notice at the time" — true whenever the persist *reported* failing,
      // and false in the case that matters: a store that accepts a write and
      // silently drops it, or another tab clearing site data between the
      // re-persist and the promote. Then nothing was raised, nothing rendered,
      // and the assistive announcement told the GM to read a message that was
      // never shown.
      //
      // `unavailable` rather than a new condition because its copy is already
      // exactly true here — the generator works, and merchants will not survive
      // the tab closing. That is the GM's situation and their recovery is the
      // same. This is not the `read-only`-reported-as-`unavailable` conflation
      // that F2 was: there, the two had different fixes, so flattening them cost
      // the GM the one they needed.
      return "unavailable";
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

  // Did the last autosave into the open record fail?
  //
  // The FR-006 guard stands down while a saved record is open, on the grounds
  // that every correction is written to it the moment it is committed. That is
  // only true while the writes land. `autosaveOpened` is best-effort — a full
  // store, a disabled one, or a record another tab deleted all leave the
  // correction in React state and nowhere else — so without this the guard
  // would wave through a Generate that destroys work the GM was never asked
  // about. `openedSavedId` alone cannot answer the question: it means "was
  // opened", not "is holding the work".
  const [autosaveFailed, setAutosaveFailed] = useState(false);

  // What the last delete did, for the live region below. A delete that
  // succeeds raises no `StorageNotice` — correctly, nothing went wrong — so
  // without this the only feedback is a row vanishing, which a screen-reader
  // user does not get at all.
  //
  // **Written to the DOM, not rendered.** React would apply a state change made
  // in the confirm handler during its *mutation* phase, which runs before
  // `ConfirmDialog`'s layout effect closes the dialog — so the region would
  // change while it is still outside an open modal, i.e. inert and hidden from
  // assistive technology. A live-region mutation nothing is observing is not an
  // announcement. The passive effect below writes the text once the dialog has
  // actually closed; React never owns this node's text, so it renders empty and
  // is left alone afterwards.
  const announcement = useRef<{ text: string; moveFocus: boolean } | null>(null);

  // Bumped per announcement so the effect re-runs even when the sentence repeats
  // — duplicate names are permitted by design, so two deletes of "Kowal" produce
  // identical text, and a value compared by `Object.is` would announce nothing
  // the second time.
  const [announcementTick, setAnnouncementTick] = useState(0);

  /**
   * The transient slot as this tab last saw it, serialized.
   *
   * A ref, not state: nothing renders from it, and it must be readable inside
   * the `storage` listener without being a dependency that re-subscribes. It
   * exists so the listener can tell "another tab replaced the merchant" from
   * "another tab renamed something else" — the `storage` event fires for the
   * whole document, because the whole document lives under one key.
   */
  const lastTransient = useRef<string | undefined>(undefined);

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

  /**
   * The storage problems to show. Empty is the ordinary case.
   *
   * A set rather than one slot, because the two facts that arrive together are
   * both worth saying: `readDocument` carries `dropped` on its `read-only`
   * branch on purpose, and a single slot was letting the second `setState` of
   * the same commit throw the first away — so a GM whose records vanished was
   * told that and not that the store will refuse the re-save that might have
   * recovered them.
   *
   * Raised by {@link raise}, thinned by {@link clearEpisodic}. Nothing assigns
   * this directly.
   */
  const [conditions, setConditions] = useState<readonly StorageCondition[]>([]);

  /** Say something once. Raising the same condition twice is not two problems. */
  const raise = useCallback((condition: StorageCondition) => {
    setConditions((current) => (current.includes(condition) ? current : [...current, condition]));
  }, []);

  /**
   * Raise the notice a failed write earns, if it earns one.
   *
   * `read-only` is the case that needs the current conditions, which is why this
   * exists rather than a bare `conditionFromFailure` at five call sites. The
   * latch is not always engaged by a read: `loadForWrite` runs `probeWritable`
   * through its own `readDocument`, so a store that stops accepting writes
   * mid-session — site data blocked, or any non-quota `setItem` throw, which
   * `isQuotaError` deliberately routes to "unavailable" — latches *inside a
   * write*, with no read ever reporting it. Staying silent there is the
   * guardrail failing in the manner it forbids: delete, save, rename and
   * autosave all stop landing, and nothing on screen says so.
   *
   * **It names the real cause, not a guess at it.** `loadForWrite` collapses
   * `future-version`, `needs-migration`, `unreadable` and a write-refusing
   * store into one `read-only` status, so this used to raise `unavailable` for
   * all four — telling a GM whose document belongs to a newer build that their
   * site data is off, and leaving the save button armed over the one status
   * that must disarm it. The cause is recoverable by looking: `readDocument`
   * judges `isFutureVersion` on the parsed payload rather than on the latch, so
   * it still reports the truth after the latch is engaged. The extra read costs
   * a `getItem` on a path where a write has already failed.
   *
   * `raise` de-duplicates, so a cause already on screen is not said twice.
   */
  const raiseWriteFailure = useCallback(
    (status: WriteFailure) => {
      if (status === "read-only") {
        const cause = readDocument();

        if (standsPersistenceDown(cause.status)) {
          raise(cause.status);
          setSession((current) => nextSaveSession(current, { event: "persistence-off" }));
          return;
        }

        // Everything else that reaches here is a store that will not take a
        // write and is not a dead end this build can detect any further:
        // Safari's private mode is the live case. It keeps the button armed on
        // purpose — see `standsPersistenceDown`.
        raise("write-refused");
        return;
      }

      const condition = conditionFromFailure(status);
      if (condition !== null) {
        raise(condition);
      }
    },
    [raise],
  );

  /**
   * A write landed, so everything that described a failed attempt is over.
   *
   * This is the half that was missing entirely: eleven sites raised a condition
   * and none ever cleared one, so the banner telling the GM to delete merchants
   * stayed up after they did and the next save succeeded — contradicting a
   * success they could see, on the one screen whose credibility the guardrail
   * depends on. The standing conditions survive; see `isStandingCondition`.
   */
  const clearEpisodic = useCallback(() => {
    setConditions((current) => {
      const next = current.filter(isStandingCondition);
      return next.length === current.length ? current : next;
    });
  }, []);

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
   * **Both halves move, from one question.** Deriving only the id left `state`
   * on `saved`, so the button kept reading "Zapisano" — disabled — over a
   * merchant no library record holds. The local delete papered over that with
   * its own explicit `cleared-open`, which is why the rule looked total while
   * two paths went around it: another tab's delete arrives through the
   * `storage` listener and returns before `adopt` (`deleteMerchant` leaves the
   * transient untouched, so the bytes compare equal), and rename's `not-found`
   * drops the row here in the component. Neither dispatches anything.
   *
   * Answering with `nextSaveState` rather than a literal keeps the transition
   * table the single authority: `cleared-open` is the identity from every state
   * except `saved`, which re-arms, and this code does not restate that.
   *
   * The stored id is left alone; nothing reads it directly. Everything below
   * reads this.
   */
  const openRecordGone =
    storedSession.openedSavedId !== null && !saved.some((entry) => entry.id === storedSession.openedSavedId);

  const session: SaveSession = {
    state: openRecordGone ? nextSaveState(storedSession.state, "cleared-open") : storedSession.state,
    openedSavedId: openRecordGone ? null : storedSession.openedSavedId,
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
    setCorrections(fromStoredCorrections(merchant.corrections));
    setCategory(restored.category);
    setWealth(restored.wealth);
    setRecentIds(restored.recentIds);
    // Whatever is arriving came out of storage, so it is by definition already
    // stored. A failure recorded against the record being replaced must not
    // outlive it, or the guard would fire over work that is not at risk.
    setAutosaveFailed(false);
    // The slot claim is deliberately NOT made here. `lastTransient.current`
    // means "this is what the slot holds", and `adopt` does not write, so it
    // cannot know. Claiming it here was wrong for `openMerchant`, which adopts
    // a SAVED record and then persists a different object (`savedAt: null`):
    // when that write failed the ref matched neither the slot nor anything
    // else, and the next `storage` event took the replacement path and adopted
    // the stale previous transient over the merchant just opened. Each caller
    // now says it for itself — the mount read from the slot it just read, the
    // `storage` handler before it gets here, and `openMerchant` not at all,
    // because `persist` records it only once the write lands.
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
   * **`future-version`, `needs-migration` and `unreadable` stand persistence
   * down** for the rest of the page load. F-01 latches read-only on all three,
   * so every subsequent write would be refused, and a button that invites the
   * attempt invites the one write the latch exists to prevent.
   *
   * The rule that separates them from the rest is recoverability *from inside
   * this build*: a document a newer build owns, one older than any migration
   * this build carries, and one whose quarantine could not be written are all
   * dead ends here — the latch is absorbing for the page load, so no amount of
   * GM action changes them without a reload. A disabled or full store is the
   * opposite: recoverable by re-enabling site data or freeing space, which is
   * why those raise their notice and leave the button pressable so the failure
   * can name its remedy. `quarantined` belongs with them and not here — the
   * copy aside succeeded, which means the store took a write.
   *
   * Membership is not a judgement call. Every `unreadable` return in
   * `quarantine` either sets the latch or is guarded by it, so the status and
   * the latch are the same fact stated twice; `StorageNotice`'s own docblock
   * has said so since S-03.
   *
   * Getting this boundary wrong in either direction has a cost. Standing down
   * too eagerly hides a remedy behind a dead control; not standing down leaves
   * a live button whose press can only fail silently.
   */
  const handleFailedRead = useCallback(
    (status: Exclude<ReadResult["status"], "ok" | "empty" | "read-only">) => {
      raise(status);

      if (standsPersistenceDown(status)) {
        setSession((current) => nextSaveSession(current, { event: "persistence-off" }));
      }
    },
    [raise],
  );

  // Passive on purpose — see `announceDelete`. A layout effect here would run
  // *before* `ConfirmDialog`'s (children commit first), so it would focus the
  // toggle and then watch `dialog.close()` take focus away again, and it would
  // set the notice while the region is still inert.
  //
  // Focus first, text second, and deliberately not in one step: NVDA and JAWS
  // cancel pending speech on a focus change, so a notice set alongside the move
  // would be preempted by the toggle announcing itself. Moving focus here and
  // letting the text land in the *following* commit keeps both.
  useEffect(() => {
    const queued = announcement.current;
    if (queued === null) {
      return;
    }

    announcement.current = null;

    if (queued.moveFocus) {
      document.getElementById(LIBRARY_TOGGLE_ID)?.focus();
    }

    const region = document.getElementById(DELETE_NOTICE_ID);
    if (region !== null) {
      region.textContent = queued.text;
    }
  }, [announcementTick]);

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
      case "read-only":
      // A store that reads but refuses writes — Safari's private mode. The
      // merchants are right there, so show them; the banner below says they
      // cannot be added to. Falls through deliberately: restoring is identical,
      // only the notice differs.
      // eslint-disable-next-line no-fallthrough
      case "ok": {
        if (read.status === "read-only") {
          // The notice, but deliberately **not** `persistence-off`. A store that
          // merely refuses writes — Safari's private mode — is recoverable by
          // leaving private mode, and `stood-down` is absorbing, so disarming
          // here would kill the button for the rest of the page load and hide
          // the remedy along with it. See `standsPersistenceDown`.
          //
          // Its own condition, not `unavailable`. That one is about this
          // device's settings and tells the GM to re-enable site data, which is
          // not the problem and not the fix; it also says nothing about the
          // reload the latch makes necessary. The press still fails — that is
          // the point of leaving the button armed — but now the failure names
          // something true.
          raise("write-refused");
        }

        // Records F-01 could not read are gone from `saved`, and the next write
        // persists the list without them — so this is the only moment the loss
        // can be named. Without it the guardrail fails exactly as it forbids:
        // the GM's merchants disappear, quietly, on their next Generate.
        if (read.dropped !== undefined) {
          raise("records-dropped");
        }

        // The saved collection comes off THIS read, not a sibling `listSaved()`
        // — and it is set whether or not there is a transient record to
        // restore, because a GM can have a library with nothing on screen.
        setSaved(read.doc.saved);

        const restored = restoreFromDocument(read.doc);
        if (restored !== null) {
          // Safe here and *only* here: the record came straight out of the
          // slot, so "this is what the slot holds" is true without a write
          // having to make it true. The `storage` handler says it for itself
          // before adopting; `openMerchant` must not, because it puts a
          // different record in the slot and `persist` owns that claim.
          lastTransient.current = JSON.stringify(read.doc.transient);
          adopt(restored, reopenEvent(read.doc));
        }
        return;
      }

      case "empty":
        // A first-ever visit, or one after the GM cleared site data. Neither is
        // an error, and the ordinary empty state is the honest answer to both.
        return;

      case "unavailable":
      case "future-version":
      case "needs-migration":
      case "quarantined":
      case "unreadable":
        handleFailedRead(read.status);
        return;

      default: {
        // Exhaustiveness, enforced rather than assumed. This callback returns
        // `void`, so a missing case is not a type error on its own — which is
        // how `needs-migration` was added to `ReadResult` and silently ignored
        // here, leaving a GM with an older document staring at an empty
        // generator and no banner. The assignment below fails to compile the
        // moment a member is added without a case for it.
        const unhandled: never = read;
        return unhandled;
      }
    }
  }, [adopt, handleFailedRead, raise]);
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

      // `read-only` carries a real document, so it joins `ok` on the adopt
      // path rather than the failure path: the other tab's write landed before
      // this store stopped accepting them, and refusing to show it would hide
      // a merchant that exists.
      if (read.status !== "ok" && read.status !== "read-only") {
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

      if (read.status === "read-only") {
        // The same notice the mount read raises for the same status, and for
        // the same reason — this is the site where the latch can engage for the
        // FIRST time mid-session: the store filled or was disabled after mount,
        // `probeWritable` fails on this re-read, and F-01 latches. Without this
        // the tab adopts the incoming merchant and every write from then on
        // comes back `read-only` — persistence stopped, and before this
        // condition existed the only thing on screen said site data was off.
        raise("write-refused");
      }

      // Only an `ok` re-read may refresh the library — the same rule this
      // handler already applies to adopting the transient record. Every other
      // outcome means there is no trustworthy collection to swap in, and
      // emptying the panel on the strength of another tab's failure would read
      // as the GM's saved merchants having disappeared.
      // As on mount: a salvaging read drops records, and the next write makes
      // that permanent. Cross-tab is if anything the likelier route here — the
      // other tab may be a build that wrote a shape this one cannot read.
      if (read.dropped !== undefined) {
        raise("records-dropped");
      }

      // Another tab deleted the record this one has open. The derived session
      // already re-arms the button off `saved`, so nothing breaks — but both
      // sibling discoveries of this same fact say it out loud (`handleRename`'s
      // `not-found` and `autosaveOpened`'s), and staying quiet here would let
      // the merchant stop being the open record with no explanation for why the
      // next Zapisz appends a copy instead of updating it.
      if (session.openedSavedId !== null && !read.doc.saved.some((entry) => entry.id === session.openedSavedId)) {
        raise("record-gone");
      }

      setSaved(read.doc.saved);

      const incoming = restoreFromDocument(read.doc);
      if (incoming === null) return;

      // **Did the write touch the transient slot at all?**
      //
      // The event fires for the whole document, because the whole document
      // lives under one key — so a rename or a delete of a merchant the GM is
      // not looking at arrives here identically to a fresh draw in another tab.
      // Everything below replaces or interrupts what is on screen, and none of
      // it is warranted when the slot did not move: a rename in tab B was
      // closing tab A's open confirmation under the GM's thumb.
      //
      // Compared by value, not by id. Same-id-different-corrections is a real
      // update — the other tab corrected the record both tabs have open — and
      // an id check would drop it silently, trading this bug for a worse one.
      const incomingBytes = JSON.stringify(read.doc.transient);
      if (incomingBytes === lastTransient.current) {
        return;
      }
      lastTransient.current = incomingBytes;

      // Only hand corrections earn the notice. A superseded draw is visible on
      // its own — the table simply changes — but corrections are work the GM
      // did by hand and cannot get back, so their loss must be said out loud.
      //
      // The same question the gate asks, so the two cannot disagree: with a
      // record open and its writes landing, the incoming corrections ARE the
      // saved ones and nothing was lost — announcing a loss there would train
      // the GM to ignore the notice that matters.
      // **Two tabs on the SAME open record — the case the gate cannot see.**
      //
      // `wouldLoseWork` stands down whenever a record is open, on the grounds
      // that the incoming corrections ARE the ones this tab saved. That is true
      // only while the incoming write derives from this tab's.
      // `updateSavedMerchant` replaces `rows` and `corrections` wholesale from
      // the writing tab's overlay — it does not merge — so tab B correcting a
      // quantity erases tab A's price correction from the record *and* from A's
      // screen, which is the guardrail's own wording.
      //
      // No comparison of the two overlays is needed. The equality guard above
      // has already established that these bytes differ from the last ones this
      // tab successfully wrote, and a tab that holds hand corrections is by
      // definition having them replaced.
      const openRecordReplaced =
        session.openedSavedId !== null &&
        incoming.merchant.id === session.openedSavedId &&
        rows !== null &&
        hasCorrections(rows, corrections);

      if (openRecordReplaced || wouldLoseWork(rows, corrections, session.openedSavedId, autosaveFailed)) {
        raise("superseded");
      }

      // The incoming merchant really is a different one, so an open dialog is
      // asking about state that has moved underneath it: its pending action
      // carries a snapshot from before this write. Confirming it could act on a
      // record that is no longer there. Closing the question is right — the GM
      // can re-ask it against what is actually on screen now.
      setPending(null);

      adopt(incoming, reopenEvent(read.doc));
    }

    window.addEventListener("storage", handleStorageEvent);
    return () => {
      window.removeEventListener("storage", handleStorageEvent);
    };
    // `session.openedSavedId` and `autosaveFailed` are listed because
    // `wouldLoseWork` reads them: without them the listener would answer with
    // whichever values were current when it was last attached.
  }, [adopt, handleFailedRead, raise, rows, corrections, session.openedSavedId, autosaveFailed]);

  /**
   * Commit a half-typed edit before the page goes away.
   *
   * `PriceQuantityCell` commits on blur, and neither a reload from inside the
   * field nor a mobile OS suspending a backgrounded tab fires one — so the edit
   * the GM can plainly see would simply not exist on the way back. Blurring the
   * active element runs the **existing** commit path rather than adding a second
   * one, so the two can never drift; `localStorage` writes synchronously, so the
   * save lands before the page is gone.
   *
   * `visibilitychange` also fires on an ordinary tab switch, which means an edit
   * commits sooner than the GM might expect. With corrections saving themselves
   * that is the direction of travel anyway.
   */
  useEffect(() => {
    function commitActiveEdit() {
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        active.blur();
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        commitActiveEdit();
      }
    }

    window.addEventListener("pagehide", commitActiveEdit);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", commitActiveEdit);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
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
   *
   * **It returns whether the slot now holds what is on screen**, because one
   * caller has to know. `promoteTransient` takes no argument — it promotes
   * whatever is in the slot — so a `handleSave` that assumed a successful
   * persist would promote the *previous* merchant after a failed one. That is
   * reachable along the path the product's own copy recommends: the store fills,
   * the notice says to delete some merchants, the GM does, and now there is room
   * for a promote of the wrong record.
   */
  function persist(
    merchantHeader: MerchantHeader,
    nextRows: readonly AssortmentRow[],
    nextCorrections: CorrectionMap,
  ): WriteFailure | "ok" {
    // The stand-down, honoured at both call sites because it lives here. Only
    // `stood-down` refuses the write — F-01 has latched read-only over a
    // document a newer build owns, and writing would strip whatever that build
    // added. A disabled or full store is deliberately NOT a stand-down: those
    // writes should be attempted, so their failure can name a remedy the GM can
    // act on.
    if (session.state === "stood-down") {
      return "read-only";
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

    const bytes = JSON.stringify(merchant);

    const written = putTransient(merchant);

    // Recorded only once the write has landed, because the ref's whole claim is
    // "this is what the slot holds". Setting it first made that claim false
    // after every failed write — the slot still held the PREVIOUS record — and
    // the next `storage` event from an unrelated write in another tab then
    // compared unequal, took the replacement path, and adopted the older stored
    // merchant over the corrections that had just failed to persist. That is
    // the loss this ref was added to prevent, committed by the ref itself.
    //
    // Nothing is given up by waiting: the event never fires in the tab that
    // wrote, so there was never a race for the assignment to win.
    if (written.status === "ok") {
      lastTransient.current = bytes;
      // Proof that the episodic conditions are over: the store just took a
      // write. This is the choke point for the four `persist` callers; the
      // other three mutations clear at their own success branch.
      clearEpisodic();
    } else {
      raiseWriteFailure(written.status);
    }

    return written.status;
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
    // With a record open, the button exists only as the retry for a failed
    // autosave — and it must NOT promote. Appending a near-identical copy to
    // the list the GM is looking at is precisely what opening-then-saving
    // exists to avoid, and the record is already in the library; what failed
    // was the write into it.
    if (session.openedSavedId !== null) {
      if (rows !== null && !autosaveOpened(rows, corrections)) {
        // Said as well as raised, for the reason the delete path records: `raise`
        // de-duplicates, so pressing a retry against a condition that is already
        // standing would otherwise change nothing anywhere. A control whose whole
        // job is "try again" has to answer when the answer is no.
        announceDelete("Nie udało się zapisać zmian — zobacz komunikat o pamięci.");
        return;
      }

      if (rows !== null) {
        // The same event a landed promote reports, so the button confirms this
        // save the way it confirms every other one.
        setSession((current) => nextSaveSession(current, { event: "promoted" }));
      }
      return;
    }

    // Otherwise: nothing open, so this is an ordinary first save.
    const failure = addMerchant();

    if (failure === null) {
      // S-03's rule — the state moves on the returned status, never on the
      // press — holds unchanged. `openedSavedId` survives a promote, because
      // the GM is still looking at that merchant; a further correction then
      // re-arms and routes to `autosaveOpened`, **not** back to this button.
      // The button's own in-place branch above exists only as the retry for a
      // failed autosave.
      setSession((current) => nextSaveSession(current, { event: "promoted" }));
      return;
    }

    setSession((current) => nextSaveSession(current, { event: "promote-failed" }));

    raiseWriteFailure(failure);

    // Said as well as raised, for the reason the retry path above records and
    // the delete path records again: `raise` de-duplicates, so pressing Save
    // against a condition that is already standing changed **nothing in the
    // DOM** — the button went armed → armed, the banner was already up, and the
    // `role="status"` region below only speaks on `saved`. A store latched
    // read-only puts the GM in exactly that state on every press. A press with
    // no perceivable outcome reads as a broken control, and a screen-reader
    // user got silence.
    announceDelete("Nie udało się zapisać kupca — zobacz komunikat o pamięci.");
  }

  /**
   * Append a new record — and adopt it, so the GM keeps editing the merchant
   * they just saved rather than a detached copy of it.
   *
   * **The adoption is not a nicety; without it the complaint comes back one
   * step later.** `promoteTransient` mints a fresh id for the copy and leaves
   * the transient on the old one, so a correction made after saving would land
   * only in the transient — exactly the behaviour this change removes, just
   * after "Zapisz" instead of after opening from the list.
   *
   * Three things therefore move together: the transient is rewritten under the
   * promoted id, `header` is moved onto it (otherwise the *next* correction
   * rewrites the transient back to the old id and breaks the link again), and
   * the session records the record as open.
   */
  function addMerchant(): WriteFailure | null {
    // Re-persist first, and abort if it fails. `promoteTransient` takes no
    // argument — it copies whatever is in the transient slot — so promoting
    // without this can append a merchant the GM is not looking at: an earlier
    // `persist` that failed on a full store leaves the *previous* draw in the
    // slot, and by the time the GM has freed space and pressed Zapisz there is
    // room to promote exactly the wrong record, reported as success.
    //
    // On the happy path this is a redundant write of bytes already there, which
    // is the cheap half of a trade against appending the wrong merchant.
    if (rows !== null && header !== null) {
      const refreshed = persist(header, rows, corrections);
      if (refreshed !== "ok") {
        return refreshed;
      }
    }

    const result = promoteTransient();
    if (result.status !== "ok") {
      return result.status;
    }

    // From the returned record, not a re-read. `promoteTransient` hands back
    // exactly what it appended, so the panel is correct without parsing the
    // document a second time.
    const promoted = result.merchant;
    setSaved((current) => [...current, promoted]);

    const linked: MerchantHeader = {
      id: promoted.id,
      name: promoted.name,
      category: promoted.category,
      wealth: promoted.wealth,
      createdAt: promoted.createdAt,
    };

    setHeader(linked);

    // Checked, like the first `persist` in this function — the asymmetry was
    // accidental. The promote itself has landed, so this is NOT a failed save
    // and must not be reported as one: the merchant really is in the library
    // and `handleSave` will say so.
    const relinked = rows === null ? "ok" : persist(linked, rows, corrections);

    // **The dispatch is unconditional, on purpose.** Skipping it when the
    // relink failed looked safer — `openedSavedId` would then name a record the
    // transient slot does not hold — but it is much worse: `promoted` leaves
    // `openedSavedId` alone, so it would stay `null`, the next correction would
    // arm the button instead of auto-saving, and pressing it would call
    // `addMerchant` a second time and append a near-identical copy. That is the
    // duplicate this whole slice exists to prevent, traded for a mismatch that
    // only shows after a reload and that `openedSavedIdFor`'s content check
    // already catches.
    setSession((current) => nextSaveSession(current, { event: "opened", savedId: promoted.id }));

    // The honest record of what failed, and it lands where there is now somewhere
    // to act on it: `autosaveFailed` re-arms the FR-006 discard guard and renders
    // the retry control.
    if (relinked !== "ok") {
      setAutosaveFailed(true);
    }

    return null;
  }

  /**
   * A correction to an OPEN record lands in that record, with no press.
   *
   * This is the whole point of the change. The product used to auto-save the
   * throwaway merchant and demand a click for the one the GM deliberately kept
   * — the inversion of what anyone expects, and the reason a saved shop could
   * end up duplicated instead of updated.
   *
   * `updateSavedMerchant` refuses to touch `id`, `createdAt` or `name` — the
   * three fields that make it the same merchant — so an auto-save can change
   * what the shop sells and never which shop it is.
   *
   * **A failed write now has a retry control** (revised 2026-09-13). The
   * earlier decision was that the persistent `StorageNotice` carried the whole
   * signal and the next committed correction would retry on its own — but a GM
   * who stops correcting while storage refuses writes was left with a banner
   * telling them to free space and nothing to press afterwards. The save button
   * is therefore rendered while `autosaveFailed` is true, and routes back here
   * rather than promoting: appending a near-identical copy to the list the GM is
   * looking at is the exact failure this slice exists to prevent.
   */
  function autosaveOpened(nextRows: readonly AssortmentRow[], nextCorrections: CorrectionMap): boolean {
    const openedId = session.openedSavedId;
    if (openedId === null) {
      return false;
    }

    const patch = { rows: toStoredRows(nextRows), corrections: toStoredCorrections(nextCorrections) };

    const result = updateSavedMerchant(openedId, patch);
    if (result.status !== "ok") {
      if (result.status === "not-found") {
        // The same discovery `handleRename` makes, by the same call, and it
        // deserves the same sentence: another tab deleted this record while it
        // was open here. `conditionFromFailure` maps `not-found` to nothing,
        // which is right for a promote and wrong here — the correction would
        // stay on screen, never reach the library, and the row it belonged to
        // would simply be gone, with no text anywhere saying why.
        //
        // Dropping it from the list also re-arms the save button through the
        // derived session above, so the correction the GM just made can be kept
        // as a new record instead of being stranded.
        setSaved((current) => current.filter((entry) => entry.id !== openedId));
        raise("record-gone");
      } else {
        raiseWriteFailure(result.status);
      }

      // The correction is now in React state and nowhere else, so the FR-006
      // guard must stop standing down. `read-only` still maps to no notice of
      // its own — the read that latched raised one — so for that status this
      // remains the only thing standing between the GM and a silent loss.
      setAutosaveFailed(true);
      return false;
    }

    setAutosaveFailed(false);
    clearEpisodic();

    // The stamp is recomputed rather than read back, so the row's save time and
    // its new position in the list are right without re-parsing the document.
    // It can differ from the stored value by under a millisecond; the row shows
    // minutes.
    const savedAt = new Date().toISOString();
    setSaved((current) => current.map((entry) => (entry.id === openedId ? { ...entry, ...patch, savedAt } : entry)));

    return true;
  }

  /**
   * FR-010's rename, already normalized and known to differ by the row.
   *
   * A failed write leaves the list exactly as it was — the row falls back to
   * the name still held here — and says why.
   */
  // Returns whether the rename landed, because the row announces the outcome and
  // must not announce a success that did not happen. A failed write leaves the
  // old name on screen, and when the condition is already standing `raise`
  // de-duplicates — so without this the only thing a screen-reader user gets
  // from a failed rename is "Nowa nazwa: X".
  function handleRename(id: string, name: string): boolean {
    const result = renameMerchant(id, name);

    if (result.status === "ok") {
      setSaved((current) => current.map((entry) => (entry.id === id ? { ...entry, name } : entry)));
      clearEpisodic();
      return true;
    }

    // `not-found` here does not mean "nothing to do" — it means another tab
    // deleted this record while the row was on screen. `conditionFromFailure`
    // maps it to no notice, which is right for a promote (the write that never
    // landed raised its own) and wrong for a rename: the row would just snap
    // back to its old name, reading as a rename that failed for no reason
    // rather than as a merchant that is gone. Drop it from the list and say so.
    if (result.status === "not-found") {
      setSaved((current) => current.filter((entry) => entry.id !== id));
      raise("record-gone");
      return false;
    }

    raiseWriteFailure(result.status);
    return false;
  }

  /**
   * Would replacing what is on screen destroy something unrecoverable?
   *
   * Asked by both replacement paths, so they cannot disagree. An open record
   * saves every correction the moment it is committed, so replacing it costs
   * nothing — the dialog stays out of the way and keeps its credibility for the
   * case where work really does vanish.
   */
  function losesWork(): boolean {
    return wouldLoseWork(rows, corrections, session.openedSavedId, autosaveFailed);
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
    if (losesWork()) {
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
    if (losesWork()) {
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
      default: {
        // The same guard the mount read carries, for the same reason: this
        // returns `void`, so a fourth `PendingAction` kind would be a missing
        // case the compiler says nothing about — and the symptom would be the
        // guardrail dialog closing on "yes" with the action never taken.
        const unhandled: never = confirmed;
        return unhandled;
      }
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
  /**
   * Say the delete happened, and ask for focus to be moved somewhere that
   * still exists.
   *
   * `<dialog>` restores focus to whatever invoked it — here the row's own
   * delete button, which this very commit unmounts — so without moving it
   * deliberately a keyboard user lands on `<body>` and restarts at the top of
   * the document. The panel toggle is the obvious anchor: always mounted, and
   * where the deleted row was. Nothing else announces the removal either;
   * `StorageNotice` stays silent because the write succeeded.
   *
   * **Requested, not performed.** Focusing from here does nothing: this runs
   * inside the click handler, while the `<dialog>` is still open and modal —
   * which makes everything outside it inert, and an inert element cannot take
   * focus. The browser then closes the dialog and runs its own focusing steps,
   * which aim at the detached delete button and land on `<body>`. The effect
   * below is passive, so it runs *after* every layout effect in the commit,
   * `ConfirmDialog`'s `dialog.close()` included — which is the first moment
   * the toggle is focusable and the last word on where focus ends up.
   */
  /**
   * Queue what to say, and — for a delete that landed — that focus must move.
   *
   * **Queued, not said.** Setting the text here would apply it in React's
   * *mutation* phase, which runs before `ConfirmDialog`'s layout effect closes
   * the dialog — so the `role="status"` region would change while it is still
   * outside an open modal, i.e. inert and hidden from assistive technology. A
   * live-region mutation nothing is observing is not an announcement, and being
   * re-exposed when the dialog closes is not itself a content change. That is
   * the same trap the focus call fell into, one commit phase earlier.
   */
  function announceDelete(text: string, moveFocus = false) {
    announcement.current = { text, moveFocus };
    setAnnouncementTick((current) => current + 1);
  }

  function announceDeleted(name: string | null) {
    announceDelete(name === null ? "Usunięto kupca." : `Usunięto kupca: ${name}.`, true);
  }

  function deleteSavedMerchant(id: string) {
    // Read before the write, because after it the row is gone from `saved` and
    // the announcement below would have nothing to name. Duplicate names are
    // permitted, so this is the GM's own word for the record, not an id.
    const name = saved.find((entry) => entry.id === id)?.name ?? null;

    const result = deleteMerchant(id);

    if (result.status === "not-found") {
      // `not-found` does **not** only mean "another tab deleted it while this
      // tab's dialog was open" — the one case the plan authorises it for.
      // `loadForWrite` substitutes an empty document for both `empty` and
      // `quarantined`, so `deleteMerchant` answers `not-found` just as readily
      // when the store was cleared in another tab, or when an unparseable
      // payload was quarantined — which **overwrites the main key**, taking the
      // whole library with it. Nothing was written in either case.
      //
      // Filtering one row here would drop it and announce a success while the
      // other N−1 merchants no longer exist anywhere — the guardrail failing in
      // exactly the manner it forbids. `MutationResult` cannot tell the two
      // apart, so the only way to know is to look.
      const read = readDocument();

      if (read.status === "ok" || read.status === "read-only") {
        // The same two notices the mount read and the `storage` handler raise off
        // this shape, because it is the same shape. Without them a salvaging
        // re-read drops records here in silence and the next write makes the loss
        // permanent — inside the branch whose whole purpose is telling the truth
        // about what is left.
        if (read.dropped !== undefined) {
          raise("records-dropped");
        }
        if (read.status === "read-only") {
          raise("write-refused");
        }

        setSaved(read.doc.saved);
      } else if (read.status === "empty") {
        setSaved([]);
      } else {
        handleFailedRead(read.status);
        return;
      }

      // Announced either way: the record the GM asked to be gone is gone. What
      // changed is that the panel now tells the truth about everything else.
      announceDeleted(name);
      return;
    }

    if (result.status === "ok") {
      // No `cleared-open` dispatch here. Dropping the row is enough: the
      // derived session above answers both halves from "is the open record
      // still in `saved`", so this path, another tab's delete and rename's
      // `not-found` all re-arm the button by the same rule instead of by three
      // handlers remembering to.
      setSaved((current) => current.filter((entry) => entry.id !== id));
      clearEpisodic();
      announceDeleted(name);

      return;
    }

    // Said as well as raised. `raise` de-duplicates, so when the condition is
    // already standing — the ordinary case once a store has refused one write —
    // confirming a delete would otherwise close the dialog, leave the row, and
    // change nothing whatsoever in the DOM. The success path announces itself;
    // the failure path has to as well, or the GM's confirm has no outcome they
    // can perceive. Focus stays put: the row is still there.
    raiseWriteFailure(result.status);
    announceDelete("Nie udało się usunąć kupca — zobacz komunikat o pamięci.");
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
      // Through the same converter `adopt` uses two lines up, not the raw
      // stored map. `persist` runs it back through `toStoredCorrections`, so
      // the result is identical today — but this was the one call site that
      // skipped the defensive copy, and "identical today" is not the reason the
      // converter exists.
      fromStoredCorrections(merchant.corrections),
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
      // A fresh draw has no corrections and no open record, so any failure
      // recorded against the previous one is spent.
      setAutosaveFailed(false);
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
      //
      // `rows`, `header` and `corrections` are deliberately left alone. The
      // failure concerns the draw that did not happen, not the shop the GM is
      // reading aloud right now — wiping it would destroy a list they cannot
      // get back, since the re-roll is what just failed.
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
      // Transient first, deliberately: if the second write fails, the screen
      // still survives a reload with the correction on it.
      persist(header, rows, next);
      autosaveOpened(rows, next);
    }
  }

  // Changing category or wealth does not touch the overlay, because it does not
  // replace rows either. Only a draw does — which is also why neither of these
  // persists: nothing about the stored merchant has changed.
  //
  // Recency is per-shop: carrying it to a different category or wealth would
  // bias a draw for no reason.
  // Both clear `error` as well as `recentIds`: the message describes a draw
  // that failed for the shop the GM has just navigated away from, so leaving it
  // up would attach a stale failure to a selection it never concerned.
  function handleCategoryChange(value: string) {
    setCategory(value as CategoryId);
    setRecentIds([]);
    setError(null);
  }

  function handleWealthChange(value: string) {
    setWealth(value as Wealth);
    setRecentIds([]);
    setError(null);
  }

  // The closed dialog still needs strings for its required props. Falling back
  // to the regenerate copy is arbitrary and invisible: nothing renders it,
  // because `open` is false in exactly the case this fallback covers.
  //
  // The name is resolved from `saved` at render time, falling back to the one
  // captured when the dialog opened — so a rename arriving from another tab
  // while the question is on screen updates the sentence instead of leaving it
  // naming a record by a name it no longer has.
  const pendingName =
    pending !== null && pending.kind === "delete"
      ? (saved.find((entry) => entry.id === pending.merchant.id)?.name ?? pending.merchant.name)
      : "";

  const copy = confirmCopyFor(pending ?? { kind: "generate" }, pendingName);

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
            className="h-11 rounded-md border border-neutral-500 bg-white px-3"
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
            className="h-11 rounded-md border border-neutral-500 bg-white px-3"
          >
            {WEALTH_LEVELS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* The focus ring is stated here because the shared `Button` does not
            paint one. Its base sets `outline-none` and substitutes
            `focus-visible:ring-ring/50 focus-visible:ring-[3px]`, and that ring
            resolves to a transparent shadow with no spread — so a GM tabbing to
            the primary action of the whole product got a 1.2:1 change against
            the 3:1 floor AGENTS.md sets, which is to say none they could see.
            `outline-solid` is the part that matters: `outline-2` alone only
            sets a width, and a width on `outline-style: none` paints nothing —
            which is why a computed style reports a ring for a button that has
            none, and why this is asserted from painted pixels in
            `tests/e2e/critical-screen-focus.spec.ts` rather than from CSS.
            Colour and geometry match `#merchant-library-toggle`, so the two
            focus rings read as one system. */}
        <Button
          onClick={handleGenerate}
          className="h-11 px-6 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-800 focus-visible:outline-solid"
        >
          Stwórz
        </Button>

        {/* Only once there is a merchant to save. `stood-down` still renders it,
            disabled: the GM should be able to see that saving exists and read
            the notice explaining why it is off, rather than find the control
            missing with no explanation.

            Gone entirely once a record is open: that merchant saves itself on
            every correction, so a button here would have nothing to do — and
            the press that used to append a near-identical copy is no longer
            reachable at all.

            **The `state === "saved"` arm is what makes a successful save
            visible.** A promote sets `openedSavedId` in the same commit as
            `promoted`, so on the first condition alone the button unmounted on
            the exact commit that would have shown "Zapisano" — the label was
            unreachable, and the only feedback for the one action the GM takes
            deliberately to protect their work was a new row in a panel that
            defaults to collapsed. Keeping it while it reads "Zapisano" shows
            the confirmation; the next correction re-arms the state, this
            condition goes false, and it disappears again. It can never be
            *pressed* with a record open, because `saved` is not `armed`. */}
        {rows !== null && (session.openedSavedId === null || session.state === "saved" || autosaveFailed) && (
          <Button
            onClick={handleSave}
            disabled={session.state !== "armed"}
            variant="secondary"
            // The colours are stated here rather than left to `secondary`,
            // which falls through to `bg-secondary` — oklch(0.97 0 0), about
            // 1.05:1 on this page — with no border, so the control had no
            // visible boundary at all. `neutral-500` is the 3:1 floor AGENTS.md
            // sets and what the selects and the dialog's Anuluj already use.
            // It matters most here: this button spends its whole visible life
            // in the `saved` state, which is never `armed`, so the one thing a
            // GM does deliberately to protect their work is confirmed by a
            // control rendered at `disabled:opacity-50`.
            className="h-11 border border-neutral-500 bg-white px-6 text-neutral-900"
          >
            {saveButtonLabel(session.state)}
          </Button>
        )}
      </div>

      {/* Said out loud, because the visible confirmation is a *disabled* button
          changing its label — which announces nothing, and cannot be focused to
          read. Mounted always and empty when there is nothing to say, for the
          same reason `StorageNotice` is. */}
      <p role="status" className="sr-only">
        {session.state === "saved" ? "Kupiec zapisany w bibliotece." : ""}
      </p>

      {/* Its own region rather than a second message in the one above:
          multiplexing them meant a delete masked every later save announcement,
          because `deletedNotice` has no moment at which it becomes false. Two
          regions, one fact each, both always mounted. */}
      {/* Deliberately childless: its text is written by the effect above, once
          the dialog has closed and the region is no longer inert. Giving React
          a child here would put the announcement back in the mutation phase,
          which is the bug this shape exists to avoid. */}
      <p id={DELETE_NOTICE_ID} role="status" className="sr-only" />

      <StorageNotice conditions={conditions} />

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
          {rows !== null && " Poniżej poprzedni asortyment — nie został zmieniony."}
        </p>
      )}

      {/* Both of these are independent of `error`: a failed re-roll must not
          hide the assortment the GM is reading, nor swallow the instruction
          that tells them how to recover. */}
      {rows === null && (
        <p className="mt-6 text-neutral-600">Wybierz kategorię i zamożność osady, a potem kliknij „Stwórz”.</p>
      )}

      {rows !== null && <MerchantTable rows={rows} corrections={corrections} onCorrect={handleCorrect} />}

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
