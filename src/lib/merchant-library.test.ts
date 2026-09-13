import { describe, expect, it } from "vitest";

import { CATEGORIES, type CategoryId } from "@/data/items";

import {
  filterMerchants,
  holdOrder,
  libraryRow,
  MAX_NAME_LENGTH,
  normalizeForSearch,
  normalizeName,
  sortForLibrary,
} from "./merchant-library";
import type { Merchant, StoredRow } from "./merchant";

const ROWS: StoredRow[] = [
  { itemId: "longsword", name: "Longsword", rarity: "pospolite", quantity: 3, priceGp: 18 },
  { itemId: "chain-mail", name: "Chain Mail", rarity: "niezwykłe", quantity: 1, priceGp: 87.5 },
];

function merchant(overrides: Partial<Merchant> = {}): Merchant {
  return {
    id: "m-1",
    name: "Kowal — 11.09.2026, 20:15",
    category: "kowal",
    wealth: "typowa",
    createdAt: "2026-09-11T12:00:00.000Z",
    savedAt: "2026-09-11T18:15:00.000Z",
    rows: ROWS,
    corrections: {},
    ...overrides,
  };
}

/**
 * A category this build has never heard of.
 *
 * Through a `string`-typed parameter because that is the honest provenance:
 * the value comes back from `JSON.parse`, where a renamed or removed category
 * is an ordinary possibility the type system cannot see.
 */
function asCategory(value: string): CategoryId {
  return value as CategoryId;
}

describe("normalizeName", () => {
  it("keeps an ordinary name as typed", () => {
    expect(normalizeName("Kuźnia u Borysa")).toBe("Kuźnia u Borysa");
  });

  it("trims the ends", () => {
    expect(normalizeName("   Kuźnia u Borysa  ")).toBe("Kuźnia u Borysa");
  });

  it("collapses internal whitespace, tabs and newlines included", () => {
    // A paste out of session notes is the realistic source of all three.
    expect(normalizeName("Kuźnia    u\tBorysa\nprzy Bramie")).toBe("Kuźnia u Borysa przy Bramie");
  });

  it("returns null for an empty name", () => {
    expect(normalizeName("")).toBeNull();
  });

  it("returns null for a whitespace-only name", () => {
    // The slip this exists for: the GM selects the name, hits space, blurs.
    // `null` tells the caller to put the previous name back.
    for (const blank of [" ", "   ", "\t", "\n", " \t\n "]) {
      expect(normalizeName(blank)).toBeNull();
    }
  });

  it("returns null for a name made only of zero-width characters", () => {
    // `\s` matches neither U+200B nor U+200D, so these walk straight past
    // `trim()`. Without the strip they reach `renameMerchant` and leave a row
    // that renders with no name at all, across every reload.
    for (const invisible of ["\u200B", "\u200B\u200B\u200B", "\u200C", "\u200D\u200D", "\uFEFF", " \u200B \u200D "]) {
      expect(normalizeName(invisible)).toBeNull();
    }
  });

  it("keeps a zero-width joiner that is holding an emoji together", () => {
    // The joiner is load-bearing inside a sequence: stripping it unconditionally
    // would turn one family into separate people inside a name the GM chose.
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    const named = `Kuznia ${family}`;

    expect(normalizeName(named)).toBe(named);
  });

  it("accepts a name another merchant already has", () => {
    // Two smithies in one town legitimately share a name. Nothing is suffixed,
    // nothing is refused — the row's other fields do the disambiguating, and
    // S-05's search inherits the consequence.
    const taken = ["Kuźnia u Borysa", "Alchemik z Rynku"];
    const normalized = normalizeName("Kuźnia u Borysa");

    expect(normalized).toBe("Kuźnia u Borysa");
    expect(taken).toContain(normalized);
  });

  it("caps an over-long name at the limit", () => {
    const long = "K".repeat(MAX_NAME_LENGTH + 15);
    const result = normalizeName(long);

    expect(result).toHaveLength(MAX_NAME_LENGTH);
    expect(result).toBe("K".repeat(MAX_NAME_LENGTH));
  });

  it("leaves a name exactly at the limit alone", () => {
    // The boundary, asserted from both sides: an off-by-one here silently
    // shortens a name the GM is allowed to have.
    const exact = "K".repeat(MAX_NAME_LENGTH);

    expect(normalizeName(exact)).toBe(exact);
  });

  it("counts the cap after collapsing, not before", () => {
    // 40 characters of text padded out to 80 with runs of spaces. Capping the
    // raw string would cut a name that comfortably fits once collapsed.
    const padded = "Kuźnia".padEnd(20, " ") + "u".padEnd(20, " ") + "Borysa".padEnd(40, " ");
    const result = normalizeName(padded);

    expect(result).toBe("Kuźnia u Borysa");
  });

  it("never leaves a trailing space when the cap lands on one", () => {
    const result = normalizeName(`${"K".repeat(MAX_NAME_LENGTH - 1)} Borys`);

    expect(result).toBe("K".repeat(MAX_NAME_LENGTH - 1));
    expect(result?.endsWith(" ")).toBe(false);
  });

  it("cuts on whole characters, never through a surrogate pair", () => {
    // The leading "K" makes the 60th character land mid-pair for a naive UTF-16
    // slice, which would store a lone surrogate — a corruption that survives
    // every reload afterwards. The exact-equality assertion pins both the
    // content and the count.
    expect(normalizeName("K" + "🗡".repeat(70))).toBe("K" + "🗡".repeat(MAX_NAME_LENGTH - 1));
  });

  it("cuts on whole characters, never between a letter and its accent", () => {
    // A name pasted out of session notes can arrive decomposed: an accented
    // letter as its base plus a combining mark. Counting code points instead of
    // graphemes would both cut the name short and risk leaving a bare accent at
    // the end of the stored name.
    const source = "Kuźnia ".repeat(12);
    const result = normalizeName(source.normalize("NFD"));

    expect(result?.normalize("NFC")).toBe(source.trimEnd().slice(0, MAX_NAME_LENGTH));
    expect(result?.endsWith("́")).toBe(false);
  });
});

describe("sortForLibrary", () => {
  const older = merchant({ id: "m-older", savedAt: "2026-09-10T10:00:00.000Z" });
  const newer = merchant({ id: "m-newer", savedAt: "2026-09-12T10:00:00.000Z" });
  const newest = merchant({ id: "m-newest", savedAt: "2026-09-12T10:00:00.001Z" });

  it("puts the newest save first", () => {
    const sorted = sortForLibrary([older, newest, newer]);

    expect(sorted.map((entry) => entry.id)).toEqual(["m-newest", "m-newer", "m-older"]);
  });

  it("breaks a timestamp tie on id, the same way every time", () => {
    // Two saves inside one millisecond. Without the tiebreak the order is
    // whatever `sort` happens to do, and a list that reshuffles between
    // renders reads as a glitch.
    const a = merchant({ id: "aaa", savedAt: "2026-09-12T10:00:00.000Z" });
    const b = merchant({ id: "bbb", savedAt: "2026-09-12T10:00:00.000Z" });
    const c = merchant({ id: "ccc", savedAt: "2026-09-12T10:00:00.000Z" });

    expect(sortForLibrary([c, a, b]).map((entry) => entry.id)).toEqual(["aaa", "bbb", "ccc"]);
    expect(sortForLibrary([b, c, a]).map((entry) => entry.id)).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("moves a re-saved merchant to the top", () => {
    // What an in-place save does: `updateSavedMerchant` refreshes `savedAt`,
    // so the record the GM just wrote leads the list. Intended, and the reason
    // the opened row is marked.
    const resaved = { ...older, savedAt: "2026-09-13T09:00:00.000Z" };

    expect(sortForLibrary([newest, newer, resaved])[0].id).toBe("m-older");
  });

  it("buries a merchant with no save timestamp instead of crashing on it", () => {
    // Not reachable through `promoteTransient`, which always stamps — but a
    // hand-edited document can produce one, and it must not take the list down.
    const undated = merchant({ id: "m-undated", savedAt: null });

    expect(sortForLibrary([undated, older, newer]).map((entry) => entry.id)).toEqual([
      "m-newer",
      "m-older",
      "m-undated",
    ]);
  });

  it("buries a merchant whose savedAt key is absent, whatever order it arrives in", () => {
    // The other half of the same hazard: `null` is the explicit shape, but a
    // hand-edited or older document simply omits the key. Asserted from two
    // input orders because the bug this replaces was an *inconsistent*
    // comparator — it answered -1 both ways, so the result moved with the input.
    const absent = { ...merchant({ id: "m-absent" }) };
    delete (absent as { savedAt?: string | null }).savedAt;

    expect(sortForLibrary([absent, older, newer]).map((entry) => entry.id)).toEqual(["m-newer", "m-older", "m-absent"]);
    expect(sortForLibrary([newer, absent, older]).map((entry) => entry.id)).toEqual(["m-newer", "m-older", "m-absent"]);
  });

  it("leaves the input array untouched", () => {
    // The argument is island state; sorting it in place would mutate React's
    // own value behind its back.
    const input = [older, newest, newer];
    const before = input.map((entry) => entry.id);

    sortForLibrary(input);

    expect(input.map((entry) => entry.id)).toEqual(before);
  });

  it("answers for an empty collection", () => {
    expect(sortForLibrary([])).toEqual([]);
  });
});

describe("libraryRow", () => {
  it("resolves the category label from the catalog", () => {
    const kowal = CATEGORIES.find((entry) => entry.id === "kowal");

    expect(libraryRow(merchant()).categoryLabel).toBe(kowal?.label);
  });

  it("counts the merchant's rows", () => {
    expect(libraryRow(merchant()).itemCount).toBe(ROWS.length);
  });

  it("carries the name through unchanged", () => {
    expect(libraryRow(merchant({ name: "Kuźnia u Borysa" })).name).toBe("Kuźnia u Borysa");
  });

  it("formats the save time in the GM's own wall clock", () => {
    // Built from local parts on both sides, so the assertion holds in any
    // timezone the suite runs in.
    const savedAt = new Date(2026, 8, 11, 20, 15).toISOString();

    expect(libraryRow(merchant({ savedAt })).savedAtLabel).toBe("11.09.2026, 20:15");
  });

  it("falls back to the stored id when the category is unknown", () => {
    // A category renamed under a saved merchant must not blank the one field
    // that says what kind of shop it is — duplicate names are allowed, so this
    // is load-bearing for telling two rows apart.
    const row = libraryRow(merchant({ category: asCategory("kowalstwo-krasnoludzkie") }));

    expect(row.categoryLabel).toBe("kowalstwo-krasnoludzkie");
  });

  it("reports no save time rather than an invalid one", () => {
    expect(libraryRow(merchant({ savedAt: null })).savedAtLabel).toBeNull();
    expect(libraryRow(merchant({ savedAt: "kiedyś w zeszłym tygodniu" })).savedAtLabel).toBeNull();
  });

  it("survives a record whose rows were hand-edited away", () => {
    const malformed = { ...merchant(), rows: undefined as unknown as StoredRow[] };

    expect(libraryRow(malformed).itemCount).toBe(0);
  });
});

describe("normalizeForSearch", () => {
  it("folds case", () => {
    expect(normalizeForSearch("KUŹNIA u Borysa")).toBe(normalizeForSearch("kuźnia U BORYSA"));
  });

  it("strips every Polish diacritic that decomposes", () => {
    // ą ć ę ń ó ś ź ż are all a base letter plus a combining mark, so NFD plus
    // mark-stripping reduces each to the bare letter.
    expect(normalizeForSearch("ąćęńóśźż")).toBe("acenoszz");
  });

  it("strips ł and Ł, which do NOT decompose under NFD", () => {
    // The case the whole function exists for. U+0142 and U+0141 are distinct
    // letters with no canonical decomposition, so an NFD-and-marks
    // implementation leaves them intact and every ł-named merchant becomes
    // unfindable — while passing every other test in this block.
    expect(normalizeForSearch("Łuk")).toBe("luk");
    expect(normalizeForSearch("kowal Wściekły")).toBe("kowal wsciekly");
  });

  it("proves NFD alone would not have stripped it", () => {
    // The guard on the guard: if this ever comes back false, `ł` decomposes
    // after all and the explicit mapping above is dead code rather than the
    // load-bearing line it is documented as.
    expect("Ł".normalize("NFD").replace(/\p{M}/gu, "")).toBe("Ł");
  });

  it("collapses whitespace and trims", () => {
    expect(normalizeForSearch("  kuźnia   u\tBorysa \n")).toBe("kuznia u borysa");
  });

  it("answers for an empty string", () => {
    expect(normalizeForSearch("")).toBe("");
    expect(normalizeForSearch("   ")).toBe("");
  });
});

describe("normalizeForSearch — zero-width", () => {
  // \s matches neither U+200B nor U+200C. It does match U+FEFF and NBSP, which
  // is exactly why this gap looked closed: the obvious probes pass.
  it("strips zero-width characters that \\s does not match", () => {
    expect(/\s/u.test("\u200B")).toBe(false);
    expect(normalizeForSearch("Ku\u200Bznia")).toBe("kuznia");
    expect(normalizeForSearch("Ku\u200Cznia")).toBe("kuznia");
    // U+00AD is the realistic one for this product: Word, PDFs and hyphenating
    // browsers all emit it on copy, which is the paste-from-notes route the
    // rule exists for. \s does not match it either.
    expect(/\s/u.test("\u00AD")).toBe(false);
    expect(normalizeForSearch("Ku\u00ADznia")).toBe("kuznia");
  });

  it("strips the joiner too, unlike the storage rule", () => {
    // `normalizeName` keeps U+200D so an emoji sequence survives in a name the
    // GM chose. Here the result is thrown away after the comparison, so keeping
    // it would only make that name unfindable by its plain letters.
    expect(normalizeForSearch("Kuznia \u{1F468}\u200D\u{1F469}")).toBe("kuznia 👨👩");
  });
});

describe("filterMerchants — zero-width, both sides", () => {
  it("finds a stored name carrying a zero-width space", () => {
    // The name was saved before the rename path started stripping invisibles,
    // or arrived by some other route. It must not be permanently unfindable.
    const hidden = merchant({ id: "m-zwsp", name: "Ku\u200Bźnia u Borysa" });

    expect(filterMerchants([hidden], "kuznia").map((entry) => entry.id)).toEqual(["m-zwsp"]);
  });

  it("finds a clean name from a query carrying a zero-width space", () => {
    // The half nothing else covers: `normalizeName` is never applied to the
    // query. Google Docs, Notion and Discord all emit U+200B on copy.
    const clean = merchant({ id: "m-clean", name: "Kuźnia u Borysa" });

    expect(filterMerchants([clean], "kuz\u200Bnia").map((entry) => entry.id)).toEqual(["m-clean"]);
  });

  it("treats a query of nothing but zero-width as no filter at all", () => {
    // Otherwise the panel says it has no match for a query that looks empty,
    // over a fully populated library.
    const all = [merchant({ id: "m-a" }), merchant({ id: "m-b" })];

    expect(filterMerchants(all, "\u200B\u200C").map((entry) => entry.id)).toEqual(["m-a", "m-b"]);
  });
});

describe("filterMerchants", () => {
  const kuznia = merchant({
    id: "m-kuznia",
    name: "Kuźnia u Borysa",
    category: "kowal",
    savedAt: "2026-09-12T10:00:00.000Z",
  });
  const luk = merchant({
    id: "m-luk",
    name: "Łuk i Cięciwa",
    category: "towary-ogolne",
    savedAt: "2026-09-11T10:00:00.000Z",
  });
  const mikstury = merchant({
    id: "m-mikstury",
    name: "Mikstury Weroniki",
    category: "alchemik",
    savedAt: "2026-09-10T10:00:00.000Z",
  });
  const all = [mikstury, kuznia, luk];

  it("returns everything for an empty query", () => {
    expect(filterMerchants(all, "")).toHaveLength(all.length);
  });

  it("returns everything for a whitespace-only query", () => {
    // Not "a filter that matches nothing" — the absence of a filter.
    expect(filterMerchants(all, "   ")).toHaveLength(all.length);
  });

  it("finds a diacritic-bearing name from a diacritic-free query", () => {
    // The one-handed-at-the-table case: nobody reaches for the ź key.
    expect(filterMerchants(all, "kuznia").map((entry) => entry.id)).toEqual(["m-kuznia"]);
  });

  it("finds an ł-bearing name by typing l", () => {
    expect(filterMerchants(all, "luk").map((entry) => entry.id)).toEqual(["m-luk"]);
  });

  it("normalizes the query, not just the stored name", () => {
    // The reverse also has to hold: both sides go through one normalizer.
    expect(filterMerchants(all, "Łuk").map((entry) => entry.id)).toEqual(["m-luk"]);
  });

  it("finds a merchant renamed away from its category, by its category", () => {
    // "Kuźnia u Borysa" carries no "kowal" — FR-010 renamed it away. The
    // category arm is what keeps FR-012 working after a rename.
    expect(filterMerchants(all, "kowal").map((entry) => entry.id)).toEqual(["m-kuznia"]);
  });

  it("returns both merchants when two share a name", () => {
    // S-04 permits duplicates, so search must present every match rather than
    // assume there is one to find.
    const twin = merchant({ id: "m-twin", name: "Kuźnia u Borysa", savedAt: "2026-09-09T10:00:00.000Z" });

    expect(filterMerchants([...all, twin], "kuznia").map((entry) => entry.id)).toEqual(["m-kuznia", "m-twin"]);
  });

  it("keeps sortForLibrary's order on the filtered path too", () => {
    // The existing order test uses an EMPTY query, which returns before the
    // filter ever runs — so an implementation that sorted only the unfiltered
    // branch would ship a panel that reorders to oldest-first the moment the GM
    // types, with a fully green suite. `saved` reaches the panel in insertion
    // order, so the unsorted order really is different.
    const older = merchant({ id: "m-older", name: "Kuźnia stara", savedAt: "2026-09-10T10:00:00.000Z" });
    const newer = merchant({ id: "m-newer", name: "Kuźnia nowa", savedAt: "2026-09-12T10:00:00.000Z" });

    expect(filterMerchants([older, newer], "kuznia").map((entry) => entry.id)).toEqual(["m-newer", "m-older"]);
  });

  it("finds a genuinely diacritic-free name from a diacritic-bearing query", () => {
    // The direction the test above was named for but never covered: both its
    // sides carried an `ł`, so dropping the ł→l mapping left it green. Here the
    // stored name has no diacritic at all, so only normalizing the QUERY can
    // make this match.
    const plain = merchant({ id: "m-plain", name: "Luk i Cieciwa" });

    expect(filterMerchants([plain], "Łuk").map((entry) => entry.id)).toEqual(["m-plain"]);
  });

  it("keeps a merchant the caller asks to hold, even when it stops matching", () => {
    // A GM renaming a row while a query is active can rename it out of its own
    // results. The row must not vanish mid-edit.
    const renamed = merchant({ id: "m-kept", name: "Zupelnie inna nazwa" });
    const matching = merchant({ id: "m-match", name: "Kuźnia" });

    expect(
      filterMerchants([renamed, matching], "kuznia", "m-kept")
        .map((entry) => entry.id)
        .sort(),
    ).toEqual(["m-kept", "m-match"]);
    // …and only when asked: without the id it is filtered out as usual.
    expect(filterMerchants([renamed, matching], "kuznia").map((entry) => entry.id)).toEqual(["m-match"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterMerchants(all, "nekromanta")).toEqual([]);
  });

  it("keeps sortForLibrary's order", () => {
    // Filtering narrows the list; it must not reorder what survives, or a
    // narrowed panel would read differently from the full one.
    expect(filterMerchants(all, "").map((entry) => entry.id)).toEqual(sortForLibrary(all).map((entry) => entry.id));
  });

  it("leaves the input array untouched", () => {
    const input = [...all];
    const before = input.map((entry) => entry.id);

    filterMerchants(input, "kuznia");

    expect(input.map((entry) => entry.id)).toEqual(before);
  });
});

describe("holdOrder", () => {
  const a = merchant({ id: "m-a", savedAt: "2026-09-10T10:00:00.000Z" });
  const b = merchant({ id: "m-b", savedAt: "2026-09-11T10:00:00.000Z" });
  const c = merchant({ id: "m-c", savedAt: "2026-09-12T10:00:00.000Z" });

  it("holds the snapshot order even after the list would re-sort", () => {
    // The whole point: another tab's autosave refreshes `savedAt`, so
    // `sortForLibrary` would move that row to the top. React moves the focused
    // <li>, the browser blurs it, and the blur commits a half-typed name.
    const frozen = ["m-a", "m-b", "m-c"];
    const resorted = sortForLibrary([a, b, { ...c, savedAt: "2026-09-13T10:00:00.000Z" }]);

    expect(holdOrder(resorted, frozen).map((entry) => entry.id)).toEqual(frozen);
  });

  it("keeps a merchant that arrived after the freeze, at the end", () => {
    // Dropping it would hide a merchant purely because the GM is renaming a
    // different one.
    const fresh = merchant({ id: "m-new", savedAt: "2026-09-14T10:00:00.000Z" });

    expect(holdOrder([fresh, c, a], ["m-a", "m-c"]).map((entry) => entry.id)).toEqual(["m-a", "m-c", "m-new"]);
  });

  it("keeps newcomers in their incoming order", () => {
    // `sort` is stable, so equal ranks do not reshuffle between renders — the
    // same property `sortForLibrary`'s id tiebreak exists to guarantee.
    const one = merchant({ id: "m-1" });
    const two = merchant({ id: "m-2" });

    expect(holdOrder([two, one], []).map((entry) => entry.id)).toEqual(["m-2", "m-1"]);
  });

  it("drops a merchant that has left the list", () => {
    expect(holdOrder([a, c], ["m-a", "m-b", "m-c"]).map((entry) => entry.id)).toEqual(["m-a", "m-c"]);
  });

  it("leaves the input array untouched", () => {
    const input = [c, a, b];
    const before = input.map((entry) => entry.id);

    holdOrder(input, ["m-a", "m-b", "m-c"]);

    expect(input.map((entry) => entry.id)).toEqual(before);
  });
});
