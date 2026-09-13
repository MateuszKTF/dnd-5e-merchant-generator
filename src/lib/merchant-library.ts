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

import { formatWallClock, type Merchant } from "./merchant";

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
 * Zero-width characters that carry no meaning of their own.
 *
 * They survive `\s` — which matches neither U+200B nor U+200D — so without this
 * a name pasted as nothing but invisibles passes the blank guard, reaches
 * `renameMerchant`, and leaves a row that renders with no name at all across
 * every reload. That is the loss the blank guard exists to prevent, arriving by
 * a route `trim()` cannot see.
 *
 * U+200D is deliberately **not** in this set: it joins, so it is load-bearing
 * inside an emoji sequence and has to survive inside a real name. A string of
 * nothing but joiners is still blank, which is what `BLANK_NAME` answers.
 */
const INVISIBLE_NAME_CHARS = /[\u200B\u200C\uFEFF]/gu;

/**
 * Everything Unicode classifies as a format character, removed before a search
 * comparison.
 *
 * `\s` catches almost none of these — not U+200B, not U+200C, not U+00AD — which
 * is exactly why the gap looked closed: the obvious probes (NBSP, U+FEFF) pass.
 * A stored name or a typed query carrying one is otherwise unfindable by any
 * query spanning it, and a name pasted out of session notes is the realistic
 * source: Google Docs, Notion and Discord emit U+200B, while Word, PDFs and
 * hyphenating browsers emit U+00AD. Both sides, or neither — that symmetry is
 * what this whole function exists to hold.
 *
 * `\p{Cf}` rather than a list, because a list is a guess about which invisibles
 * a GM will paste and this is the actual category: it covers U+00AD, U+200B-
 * U+200F, U+2060, U+2066-U+2069 and U+FEFF in one concept.
 *
 * **Deliberately wider than {@link INVISIBLE_NAME_CHARS}**, which keeps U+200D
 * because there it is load-bearing — it holds an emoji sequence together in a
 * name the GM chose. Here the result is discarded after the comparison, so
 * keeping it would only make a name with a family emoji unfindable by its plain
 * letters.
 */
const FORMAT_CHARS = /\p{Cf}/gu;
const BLANK_NAME = /^[\s\u200D]*$/u;

/**
 * Built once, on first use — never at module scope.
 *
 * Every page is prerendered, so this module is imported during a build running
 * in Node/workerd. `Intl` exists in both, but the house rule from F-01 and S-03
 * stands: nothing touches an ambient global at import time, because the day one
 * of them is missing the failure is a broken build rather than a broken call.
 *
 * Resolved once and cached even when it is missing, so the `typeof` probe does
 * not re-run on every commit. `Segmenter` is the youngest API this product
 * leans on — Firefox shipped it only in 125 (April 2024) — so a Firefox ESR or
 * an older Android WebView reaches the `null` branch, and an unguarded `new`
 * there would throw inside a React event handler and kill the rename with
 * nothing said. Same reasoning and same shape as `newMerchantId`.
 */
let segmenter: Intl.Segmenter | null = null;
let segmenterResolved = false;

function graphemeSegmenter(): Intl.Segmenter | null {
  if (!segmenterResolved) {
    segmenterResolved = true;

    const api: Partial<typeof Intl> | undefined = typeof Intl === "undefined" ? undefined : Intl;
    segmenter = typeof api?.Segmenter === "function" ? new api.Segmenter(undefined, { granularity: "grapheme" }) : null;
  }

  return segmenter;
}

/**
 * The string as a person would count it: one entry per visible character,
 * combining marks and astral pairs kept whole.
 *
 * Without `Segmenter`, code points — the pre-`Segmenter` behaviour. That can
 * sever a combining mark from its letter, which graphemes never do, but it
 * never produces a lone surrogate, and both beat a rename that does nothing.
 */
function toGraphemes(value: string): string[] {
  const active = graphemeSegmenter();
  if (active !== null) {
    return [...active.segment(value)].map((entry) => entry.segment);
  }

  // `no-misused-spread` is right about what this does — code points, so a ZWJ
  // emoji decomposes and a combining mark can be cut from its letter. That is
  // the whole bargain of this branch, taken knowingly: the alternative on a
  // browser without `Segmenter` is a rename that throws and says nothing.
  // eslint-disable-next-line @typescript-eslint/no-misused-spread
  return [...value];
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
  const collapsed = raw.replace(INVISIBLE_NAME_CHARS, "").replace(/\s+/gu, " ").trim();
  if (BLANK_NAME.test(collapsed)) {
    return null;
  }

  const characters = toGraphemes(collapsed);
  if (characters.length <= MAX_NAME_LENGTH) {
    return collapsed;
  }

  // The slice can land on the space between two words; trimming again keeps
  // the stored name from ending in whitespace the GM cannot see.
  const truncated = characters.slice(0, MAX_NAME_LENGTH).join("").trimEnd();

  // Unreachable, and deliberately kept: `collapsed` is already trimmed, so the
  // first grapheme is never whitespace and a 60-grapheme slice can never trim
  // away to nothing. The guard stays so the function is total over its return
  // type rather than relying on that argument holding after a future edit — but
  // it is not a live branch, and nothing should be written as though it were.
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
    // `?? null` because an *absent* `savedAt` is as ordinary as an explicit
    // `null` in hand-edited or forward-only data, and every comparison against
    // `undefined` is false — so the branch below answered `-1` in both
    // directions. That is not a valid comparator: it sorted the record to the
    // front rather than the back, and left the result depending on the input
    // order, which is the very reshuffle the `id` tiebreak exists to stop.
    const aAt = a.savedAt ?? null;
    const bAt = b.savedAt ?? null;

    if (aAt !== bAt) {
      if (aAt === null) return 1;
      if (bAt === null) return -1;

      return aAt < bAt ? 1 : -1;
    }

    // `0` for equal ids rather than falling through to `1`. Ids are unique, so
    // this is not reachable through the library — but a comparator that
    // disagrees with itself is exactly what the `savedAt` branch above did, and
    // writing the total form costs nothing.
    if (a.id === b.id) return 0;

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
  return {
    id: merchant.id,
    name: merchant.name,
    categoryLabel: categoryLabelFor(merchant),
    // `rows` is denormalized and self-contained (F-01), so the count needs no
    // catalog. The guard is for a hand-edited record, where `.length` on an
    // absent array would throw inside a render.
    itemCount: Array.isArray(merchant.rows) ? merchant.rows.length : 0,
    savedAtLabel: formatSavedAt(merchant.savedAt),
  };
}

/**
 * The merchant's kind, in the GM's language.
 *
 * Falls back to the stored id when this build no longer knows the category,
 * exactly as `autoName` does — and shared by the row projection and the search
 * matcher so a merchant is never displayed under one label and searched under
 * another.
 */
function categoryLabelFor(merchant: Merchant): string {
  return CATEGORIES.find((entry) => entry.id === merchant.category)?.label ?? merchant.category;
}

/** Combining marks — what `NFD` splits an accented letter into. */
const COMBINING_MARKS = /\p{M}/gu;

/**
 * Both sides of a search comparison, reduced to the same shape.
 *
 * A GM searching at the table types one-handed on a phone and will not reach
 * for the diacritic keys. "kuznia" has to find "Kuźnia", so the query and the
 * stored name are both routed through **this one function** — normalizing one
 * side and not the other silently under-matches, and the bug presents as
 * "search is flaky" rather than as a rule that is wrong.
 *
 * **`ł` needs its own line, and that is the whole trick here.** Every other
 * Polish diacritic — ą ć ę ń ó ś ź ż — is a base letter plus a combining mark,
 * so `NFD` splits it and stripping marks leaves the bare letter. `ł` (U+0142)
 * is a *distinct letter* with no canonical decomposition: `NFD` leaves it
 * untouched, and an implementation that stops at marks would make every
 * `ł`-named merchant permanently unfindable while appearing to work on every
 * other test. See `merchant-library.test.ts`, where it is asserted on its own.
 */
export function normalizeForSearch(value: string): string {
  return (
    value
      // Format characters first — see `FORMAT_CHARS`.
      .replace(FORMAT_CHARS, "")
      .toLowerCase()
      .normalize("NFD")
      .replace(COMBINING_MARKS, "")
      .replace(/[łŁ]/gu, "l")
      // After `toLowerCase` only the lowercase form survives, but both are listed:
      // this line is the rule, and it should read as the rule even out of order.
      .replace(/\s+/gu, " ")
      .trim()
  );
}

/**
 * Does this merchant answer the query?
 *
 * Matches the name **and the category label**, because FR-010 otherwise blinds
 * category-shaped searching: an auto-name carries "Kowal", and the moment the
 * GM renames that shop to "Kuźnia u Borysa" a name-only search stops finding it
 * by kind. The two requirements would quietly undercut each other.
 *
 * The query arrives already normalized — once per keystroke at the caller,
 * rather than once per row here.
 */
function matchesQuery(merchant: Merchant, normalizedQuery: string, categoryLabel: string): boolean {
  if (normalizedQuery === "") {
    return true;
  }

  return (
    normalizeForSearch(merchant.name).includes(normalizedQuery) ||
    normalizeForSearch(categoryLabel).includes(normalizedQuery)
  );
}

/**
 * The list the panel shows: every match, newest first.
 *
 * Ordering is {@link sortForLibrary}'s, applied before filtering so a narrowed
 * list reads the same way as the full one. **Every** match is returned —
 * duplicate names are permitted by design, so presenting one and hiding the
 * other would hide exactly the record the GM was looking for.
 *
 * An empty or whitespace-only query is not a filter that matches nothing; it is
 * the absence of a filter, and returns the whole list.
 *
 * `keepId` survives the filter whatever it matches. It exists for one case: a
 * GM renaming a row while a query is active can rename it *out of its own
 * search results*, and the row would then vanish mid-edit — taking its live
 * region with it before the announcement it was about to make had rendered.
 * The filter is a view the GM is steering, not a rule that should react
 * underneath them, which is the same reasoning that leaves the query in place
 * after a delete. The caller drops the id the moment the query next changes.
 */
export function filterMerchants(
  merchants: readonly Merchant[],
  query: string,
  keepId: string | null = null,
): Merchant[] {
  const sorted = sortForLibrary(merchants);
  const normalized = normalizeForSearch(query);

  if (normalized === "") {
    return sorted;
  }

  return sorted.filter(
    (merchant) => merchant.id === keepId || matchesQuery(merchant, normalized, categoryLabelFor(merchant)),
  );
}

/**
 * `2026-09-11T18:15:00.000Z` → `11.09.2026, 20:15`, in local time.
 *
 * Delegates to `formatWallClock` in `merchant.ts` rather than rebuilding the
 * format, because a renamed merchant and an untouched one sit in the same list:
 * `autoName` bakes this shape into the name itself, and this label renders
 * beside it. One owner, so the two cannot drift under the GM's eyes.
 */
function formatSavedAt(iso: string | null): string | null {
  if (iso === null) {
    return null;
  }

  return formatWallClock(new Date(iso));
}

/**
 * Re-order `merchants` to match `ids`, keeping anything unlisted at the end.
 *
 * Holds the list still while a row is being renamed. Another tab's autosave
 * refreshes `savedAt`, which re-sorts the library; React then reconciles by key
 * and **moves** the `<li>`, and moving a focused element blurs it — committing
 * a half-typed name to storage. Freezing the order removes the move, which
 * removes the blur. A blur guard cannot cover this: the draft is non-null, so
 * it looks exactly like a real edit being ended.
 *
 * Merchants absent from `ids` arrived after the freeze. They go to the end in
 * their incoming order rather than being dropped, because the panel must not
 * hide a merchant just because the GM is renaming a different one. `sort` is
 * stable, so equal ranks keep that order.
 */
export function holdOrder(merchants: readonly Merchant[], ids: readonly string[]): Merchant[] {
  const rank = new Map(ids.map((id, index) => [id, index]));

  return [...merchants].sort(
    (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}
