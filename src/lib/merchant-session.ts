/**
 * The session rules: what a reload restores, and what the save button is
 * allowed to say.
 *
 * Pure — no React, no storage access, nothing touching a global at module
 * scope. The island that consumes these rules (`MerchantGenerator.tsx`) is
 * unreachable by the test harness, which globs `.ts` only and runs without
 * jsdom, so every decision that can be *wrong as a rule* lives here where a
 * test can reach it. Only the effects and the `storage` listener stay in the
 * component, covered by manual steps. F-01 (`merchant-storage.ts`) and S-02
 * (`corrections.ts`) are split the same way for the same reason.
 */

import { CATEGORIES, WEALTH_LEVELS, type CategoryId, type Wealth } from "@/data/items";

import type { Merchant } from "./merchant";
import type { StorageDocument } from "./merchant-storage";

/**
 * Is this string a category this build knows?
 *
 * A predicate rather than a comparison because the value arrives from
 * `JSON.parse`: the type says `CategoryId`, the bytes on disk say whatever a
 * newer build — or a hand edit — put there. Narrowing is what lets the caller
 * hand the result straight to a `CategoryId` slot without an assertion.
 */
export function isKnownCategory(value: string): value is CategoryId {
  return CATEGORIES.some((entry) => entry.id === value);
}

/** As {@link isKnownCategory}, for the settlement wealth control. */
export function isKnownWealth(value: string): value is Wealth {
  return WEALTH_LEVELS.some((entry) => entry.id === value);
}

/** What a reload found, already translated into island state. */
export interface RestoredSession {
  /**
   * The stored merchant, whole and unmodified — rows and corrections included,
   * and **returned even when a control had to be reset** (see below).
   */
  merchant: Merchant;
  /** The category control's value: the merchant's own, or the default. */
  category: CategoryId;
  /** The wealth control's value: the merchant's own, or the default. */
  wealth: Wealth;
  /** Seeded from the restored rows, so the first Generate draws something else. */
  recentIds: string[];
  /** True when {@link category} is the default because the stored one is unknown. */
  categoryWasReset: boolean;
  /** True when {@link wealth} is the default because the stored one is unknown. */
  wealthWasReset: boolean;
}

/**
 * A stored merchant, ready to become island state — or `null` when there is
 * nothing to bring back.
 *
 * **Two callers, one rule.** A reload restores the transient record
 * ({@link restoreFromDocument}); S-04 opens a *saved* one. Both arrive from
 * `JSON.parse`, so both can carry a category this build no longer knows and
 * both need `recentIds` reseeded — the normalisation is factored here rather
 * than duplicated at the second call site, where a divergence would show up as
 * an opened merchant behaving subtly differently from a restored one.
 *
 * **A stale enum degrades the controls, never the rows.** If a stored
 * `category` or `wealth` is no longer a member of `src/data/items.ts`, only the
 * matching `select` falls back to the first entry; `merchant` comes back
 * complete either way. That is affordable precisely because F-01 denormalizes
 * `name` and `rarity` into every row, so the table renders without consulting
 * the catalog at all — a merchant the GM is mid-session with must not vanish
 * because a category was renamed under it.
 *
 * **Read-only and idempotent.** It writes nothing and depends on nothing but
 * its argument, so the mount effect can run it twice under dev StrictMode
 * without a guarding ref.
 *
 * The `rows` check is not redundant with F-01's validation: `readDocument`
 * validates the *document* (`schemaVersion`, `saved`, the presence of a
 * `transient` object) and deliberately does not walk into the merchant. A
 * hand-edited `"transient": {}` therefore reads back as `ok`, and mapping over
 * an absent `rows` would throw inside a mount effect — blanking the only page
 * the product has. Treating it as nothing to restore shows the ordinary empty
 * state instead.
 */
export function restoreFromMerchant(merchant: Merchant | null): RestoredSession | null {
  if (merchant === null || !Array.isArray(merchant.rows)) {
    return null;
  }

  const categoryWasReset = !isKnownCategory(merchant.category);
  const wealthWasReset = !isKnownWealth(merchant.wealth);

  return {
    merchant,
    category: categoryWasReset ? CATEGORIES[0].id : merchant.category,
    wealth: wealthWasReset ? WEALTH_LEVELS[0].id : merchant.wealth,
    // The recency bias is S-01 state and is not persisted (the format is
    // forward-only, and a UI nicety does not earn a stored field). Reseeding it
    // from the rows the GM is looking at costs nothing and closes the case the
    // bias exists for: the first Generate after reopening is the one most
    // likely to hand back the list already on screen.
    recentIds: merchant.rows.map((row) => row.itemId),
    categoryWasReset,
    wealthWasReset,
  };
}

/**
 * The reload path: pull the transient slot out of the document and normalise
 * it. A thin wrapper on purpose — the rules live in
 * {@link restoreFromMerchant}, and an absent transient record is just the
 * `null` argument that function already answers for.
 */
export function restoreFromDocument(doc: StorageDocument): RestoredSession | null {
  return restoreFromMerchant(doc.transient);
}

/**
 * What the save button may claim.
 *
 * - `unavailable` — nothing has been generated yet; there is no merchant to save.
 * - `stood-down` — persistence is refusing writes for the rest of this page
 *   load. Renders like `unavailable`, but is a **different state because it is
 *   absorbing**: a later Generate must not re-arm a button whose press cannot
 *   succeed. F-01 latches read-only on `future-version` — a document a newer
 *   build owns — and inviting a save there invites the one write that would
 *   destroy the data the latch exists to protect.
 * - `armed` — a merchant exists and has not been saved.
 * - `saved` — the last press promoted successfully, and nothing has changed since.
 *
 * The asymmetry is deliberate: a **disabled or full** store does not stand
 * persistence down. Those mean *the write will fail*, which is worth letting
 * the GM discover by pressing Save and reading the notice — the condition is
 * recoverable (re-enable site data, free some space) and hiding it behind a
 * dead control hides the remedy with it. `future-version` means *do not write
 * at all*, which is not recoverable from inside this build.
 */
export const SAVE_STATES = ["unavailable", "stood-down", "armed", "saved"] as const;
export type SaveState = (typeof SAVE_STATES)[number];

/**
 * Everything that can move the save button.
 *
 * `promoted` and `promote-failed` are separate because `promoteTransient`
 * answers with a status instead of throwing, and collapsing the two is the one
 * mistake this module exists to make impossible: a green "Zapisano" over a
 * merchant that was never written is the PRD's heaviest guardrail violation
 * wearing a checkmark.
 *
 * `opened` and `cleared-open` are S-04's: the GM can now bring a *saved*
 * merchant back onto the page, and while one is open the save button writes to
 * that record instead of appending a copy. Which record — if any — is open is
 * not part of {@link SaveState}; it rides alongside it in {@link SaveSession},
 * because the button's availability and the record it would write are two
 * different questions with two different answers.
 */
export const SAVE_EVENTS = [
  "generated",
  "corrected",
  "restored",
  "opened",
  "promoted",
  "promote-failed",
  "cleared-open",
  "persistence-off",
] as const;
export type SaveEvent = (typeof SAVE_EVENTS)[number];

// Cell aliases, so each row of the table below fits on one line: `A` armed,
// `S` saved, `U` unavailable, `D` stood-down.
const A = "armed";
const S = "saved";
const U = "unavailable";
const D = "stood-down";

/**
 * The transition table. Rows are the current state, columns the event.
 *
 * Two cells carry the weight and are meant to be checkable by eye:
 *
 * - `armed` x `promote-failed` is **`A`, never `S`** — a promote that failed
 *   leaves the button armed so the GM can try again. No cell in the
 *   `promote-failed` column reaches `S` from a state that was not already
 *   `saved`, so a failed save can never present as a save that happened.
 * - the `stood-down` row is `D` throughout — nothing leaves it, which is the
 *   absorbing property the `future-version` latch depends on.
 * - the `cleared-open` column is the **identity**: every row answers with
 *   itself. Losing the opened record does not change what the button may
 *   claim — a merchant the GM drew before opening is still on screen and still
 *   unsaved. The event exists to move {@link SaveSession.openedSavedId}, and
 *   keeping it inert here is what stops the two concerns entangling.
 * - `opened` arms exactly like `restored`: a merchant is on screen and the
 *   button has something to write. It does **not** land on `saved` — no press
 *   has happened, and `saved` is this module's word for "the last press
 *   succeeded", not for "what is on screen matches the store".
 *
 * Unreachable cells are filled conservatively rather than left to a fallback:
 * `promoted` from `unavailable` stays `U`, because a promote with nothing
 * generated is a bug, not a save. Keeping the table total is what lets
 * {@link nextSaveState} be a lookup with no default branch to get wrong.
 */
// prettier-ignore
const SAVE_TRANSITIONS: Record<SaveState, Record<SaveEvent, SaveState>> = {
  unavailable:  { generated: A, corrected: A, restored: A, opened: A, promoted: U, "promote-failed": U, "cleared-open": U, "persistence-off": D },
  "stood-down": { generated: D, corrected: D, restored: D, opened: D, promoted: D, "promote-failed": D, "cleared-open": D, "persistence-off": D },
  armed:        { generated: A, corrected: A, restored: A, opened: A, promoted: S, "promote-failed": A, "cleared-open": A, "persistence-off": D },
  saved:        { generated: A, corrected: A, restored: A, opened: A, promoted: S, "promote-failed": S, "cleared-open": S, "persistence-off": D },
};

/** Apply one event to the save button's state. Total — every cell is filled. */
export function nextSaveState(current: SaveState, event: SaveEvent): SaveState {
  return SAVE_TRANSITIONS[current][event];
}

/**
 * The save button's whole truth: what it may claim, and which record a press
 * would write.
 *
 * `openedSavedId` is `null` unless the GM opened a saved merchant, in which
 * case a press calls `updateSavedMerchant` on that id instead of
 * `promoteTransient`. The two live in **one** value, and move through **one**
 * reducer, because every bug this pair can have is a bug about them
 * disagreeing:
 *
 * - an id that arrives a render late means the first press after opening
 *   appends a near-identical copy to the list the GM is looking at — the
 *   duplicate S-04 exists to prevent;
 * - an id that outlives a fresh draw means the next press overwrites a saved
 *   merchant with a completely different shop, which is not a duplicate but a
 *   silent destruction of saved data.
 *
 * It is deliberately **not persisted**. The storage format is forward-only
 * (AGENTS.md), and a UI concern does not earn a field in it — the same trade
 * F-01 made for the promoted flag. The consequence is that a reload turns an
 * opened merchant into an ordinary transient one and the next press appends a
 * copy; that is an accepted, documented limit, not an oversight.
 */
export interface SaveSession {
  readonly state: SaveState;
  readonly openedSavedId: string | null;
}

/**
 * One event, plus the id the `opened` event alone carries.
 *
 * A discriminated union rather than an optional second argument: there is no
 * such thing as opening without a record, and no other event has a record to
 * name. The compiler refusing `{ event: "opened" }` is the point.
 */
export type SaveSessionEvent =
  | { readonly event: "opened"; readonly savedId: string }
  | { readonly event: Exclude<SaveEvent, "opened"> };

/**
 * Which record the next press would write, after this event.
 *
 * Only `opened` can produce an id. `generated` clears it **on top of** the
 * explicit `cleared-open` the draw also fires: a fresh draw is by definition no
 * longer the opened record, and making that true in the reducer means a call
 * site that forgets to say so cannot reach the overwrite-a-saved-merchant bug.
 * Everything else — a correction, a promote, a failed promote, a stand-down —
 * leaves it alone, because the GM is still looking at the same merchant.
 */
function nextOpenedSavedId(current: string | null, next: SaveSessionEvent): string | null {
  switch (next.event) {
    case "opened":
      return next.savedId;
    case "cleared-open":
    case "generated":
      return null;
    default:
      return current;
  }
}

/** Apply one event to the pair. Both halves move together, or neither does. */
export function nextSaveSession(current: SaveSession, next: SaveSessionEvent): SaveSession {
  return {
    state: nextSaveState(current.state, next.event),
    openedSavedId: nextOpenedSavedId(current.openedSavedId, next),
  };
}

/**
 * Which saved record — if any — this document's transient slot came from.
 *
 * `openedSavedId` cannot be persisted: the storage format is forward-only
 * (AGENTS.md) and a UI concern does not earn a field in it. But the link does
 * not need a field, because it is already implied by data that **is** stored.
 *
 * Opening a saved merchant writes it to the transient slot under **its own
 * id**, while `promoteTransient` always mints a **fresh** id for the copy it
 * appends. A transient whose id also appears in `saved` can therefore only mean
 * one thing: that transient came from that saved record. The inference is not a
 * heuristic — it is sound for exactly as long as promote keeps minting, which
 * is why this comment names that dependency out loud.
 *
 * Returning `null` is the ordinary case: a freshly drawn merchant has an id
 * nothing else shares.
 */
/**
 * Is the GM about to lose work that nothing can give back?
 *
 * The guard used to ask `hasCorrections` alone — "does this merchant carry hand
 * edits" — and fired over a record whose edits were already safely in the
 * library. An ostrzeżenie that cries wolf trains the GM to dismiss it, and then
 * it fails on the one occasion that mattered.
 *
 * The real question has two halves: there are corrections, **and** they live
 * nowhere but this screen. An open record auto-saves every correction, so
 * replacing what is on screen costs nothing.
 */
export function wouldLoseCorrections(hasCorrections: boolean, openedSavedId: string | null): boolean {
  return hasCorrections && openedSavedId === null;
}

export function openedSavedIdFor(doc: StorageDocument): string | null {
  const transient = doc.transient;
  if (transient === null) {
    return null;
  }

  return doc.saved.some((merchant) => merchant.id === transient.id) ? transient.id : null;
}
