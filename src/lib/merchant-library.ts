/**
 * The saved-merchants list: what a name may be, what order the rows come in,
 * and what each row shows.
 *
 * Pure, and `.ts` rather than `.tsx`, for the same reason as F-01, S-02 and
 * S-03: the harness globs `src/**\/*.test.ts` and runs without jsdom, so every
 * decision that can be *wrong as a rule* lives here where a test can reach it,
 * and only the rendering stays in `MerchantLibrary.tsx`.
 *
 * Nothing here reads or writes storage. `renameMerchant` and
 * `updateSavedMerchant` (F-01) own the writes; this module decides what is
 * worth writing and how the result is displayed.
 */

import { CATEGORIES } from "@/data/items";

import type { Merchant } from "./merchant";

/**
 * The longest name the list will keep.
 *
 * Sized from the row, not from the store: "Kuźnia u Borysa przy Bramie
 * Wschodniej" is the kind of name a GM actually types and it fits well inside
 * this, while a name long enough to wrap a row at 360 px would break the one
 * NFR the PRD has. Storage has no opinion — a few hundred KB of quota against
 * dozens of merchants makes the cap purely a layout decision.
 */
export const MAX_NAME_LENGTH = 60;

/**
 * Built once, on first use — never at module scope.
 *
 * Every page is prerendered, so this module is imported during a build running
 * in Node/workerd. `Intl` exists in both, but the house rule from F-01 and S-03
 * stands: nothing touches an ambient global at import time, because the day one
 * of them is missing the failure is a broken build rather than a broken call.
 */
let segmenter: Intl.Segmenter | null = null;

/**
 * The string as a person would count it: one entry per visible character,
 * combining marks and astral pairs kept whole.
 */
function toGraphemes(value: string): string[] {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });

  return [...segmenter.segment(value)].map((entry) => entry.segment);
}

/**
 * The name the GM typed, as it will be stored — or `null` when they typed
 * nothing usable and the caller should put the previous name back.
 *
 * `null` rather than a thrown error or a silent fallback to the auto-name: a
 * blanked field is much more likely to be a slip than a request, and the
 * previous name is the only value that is certainly not a surprise. Minting a
 * fresh auto-name there would replace a name the GM chose with one they did
 * not, which is the same class of loss the rest of this slice exists to avoid.
 *
 * **Duplicates are deliberately permitted.** Two smithies in one town
 * legitimately share a name, and the row carries category, item count and save
 * time to tell them apart. The consequence lands on FR-012 (S-05): search has
 * to present every match rather than assume there is one.
 *
 * Truncation counts **graphemes** — what a person means by "a character" —
 * rather than UTF-16 units. Cutting by units can split a surrogate pair and
 * store a lone surrogate, a corruption that survives every reload afterwards;
 * cutting by code points can still sever a combining mark from the letter it
 * belongs to, which is reachable here because a name pasted out of session
 * notes may arrive decomposed.
 */
export function normalizeName(raw: string): string | null {
  const collapsed = raw.replace(/\s+/gu, " ").trim();
  if (collapsed === "") {
    return null;
  }

  const characters = toGraphemes(collapsed);
  if (characters.length <= MAX_NAME_LENGTH) {
    return collapsed;
  }

  // The slice can land on the space between two words; trimming again keeps
  // the stored name from ending in whitespace the GM cannot see.
  const truncated = characters.slice(0, MAX_NAME_LENGTH).join("").trimEnd();

  // Only reachable if the cap lands inside a run of spaces, which `collapsed`
  // has already reduced to single characters — so at most one character goes.
  return truncated === "" ? null : truncated;
}

/**
 * Newest save first, with a stable tiebreak on `id`.
 *
 * The tiebreak is not decoration: two merchants saved inside the same
 * millisecond would otherwise be ordered by whatever `sort` happened to do,
 * and a list that reshuffles between renders reads as a glitch. `id` is unique
 * and never changes, so the order is fixed for good.
 *
 * ISO strings are compared as strings. `toISOString()` always emits the same
 * fixed-width UTC form, so lexicographic order *is* chronological order — and
 * skipping the `Date` round-trip means a hand-edited timestamp cannot turn into
 * `NaN` and quietly send a merchant to one end of the list.
 *
 * A `null` `savedAt` sorts last. It should not occur — every member of the
 * durable collection is stamped by `promoteTransient` — but a hand-edited
 * document can produce one, and burying it is better than crashing on it.
 *
 * **An in-place save moves its row to the top, and that is intended.**
 * `updateSavedMerchant` refreshes `savedAt`, so saving an open merchant
 * re-sorts the list under the GM. The alternative — freezing `savedAt` at first
 * save — would make the column mean "first saved" rather than "last written"
 * and leave a just-edited merchant buried. Recency is the point of the sort;
 * the movement is its cost, and the opened-row marking is what keeps the
 * merchant findable after it moves.
 *
 * Returns a new array. The input is island state and must not be sorted in
 * place.
 */
export function sortForLibrary(merchants: readonly Merchant[]): Merchant[] {
  return [...merchants].sort((a, b) => {
    if (a.savedAt !== b.savedAt) {
      if (a.savedAt === null) return 1;
      if (b.savedAt === null) return -1;

      return a.savedAt < b.savedAt ? 1 : -1;
    }

    return a.id < b.id ? -1 : 1;
  });
}

/** One row of the list, ready to render — no catalog lookups left to do. */
export interface LibraryRow {
  id: string;
  /** The GM's name, or the auto-name it started as. Truncation is the row's job, not this one's. */
  name: string;
  /** The Polish category label, or the raw id when this build no longer knows the category. */
  categoryLabel: string;
  /** How many positions the merchant holds. */
  itemCount: number;
  /** `DD.MM.YYYY, HH:MM` in the GM's own wall clock, or `null` when there is no usable timestamp. */
  savedAtLabel: string | null;
}

/**
 * The display projection for one saved merchant.
 *
 * The three secondary fields are not ornament: duplicate names are allowed, so
 * category, item count and save time are the *only* things that tell two rows
 * apart — which is why each of them degrades to something readable rather than
 * disappearing when the data is odd.
 *
 * An unknown category falls back to the stored id, exactly as `autoName` does.
 * A category renamed under a saved merchant must not blank the one field that
 * says what kind of shop it is.
 */
export function libraryRow(merchant: Merchant): LibraryRow {
  const label = CATEGORIES.find((entry) => entry.id === merchant.category)?.label ?? merchant.category;

  return {
    id: merchant.id,
    name: merchant.name,
    categoryLabel: label,
    // `rows` is denormalized and self-contained (F-01), so the count needs no
    // catalog. The guard is for a hand-edited record, where `.length` on an
    // absent array would throw inside a render.
    itemCount: Array.isArray(merchant.rows) ? merchant.rows.length : 0,
    savedAtLabel: formatSavedAt(merchant.savedAt),
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * `2026-09-11T18:15:00.000Z` → `11.09.2026, 20:15`, in local time.
 *
 * The same shape `autoName` builds, so a renamed merchant and an untouched one
 * present their time identically. Built from local date parts rather than
 * `Intl` for the same reason: the string is the GM's wall clock and is
 * byte-stable across runtimes.
 */
function formatSavedAt(iso: string | null): string | null {
  if (iso === null) {
    return null;
  }

  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) {
    return null;
  }

  const date = `${pad2(when.getDate())}.${pad2(when.getMonth() + 1)}.${when.getFullYear()}`;
  const time = `${pad2(when.getHours())}:${pad2(when.getMinutes())}`;

  return `${date}, ${time}`;
}
