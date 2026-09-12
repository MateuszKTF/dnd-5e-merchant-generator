import { describe, expect, it } from "vitest";

import { CATEGORIES, type CategoryId } from "@/data/items";

import {
  filterMerchants,
  libraryRow,
  matchesQuery,
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

describe("matchesQuery", () => {
  const kowal = merchant({ name: "Kuźnia u Borysa", category: "kowal" });

  it("matches on the name", () => {
    expect(matchesQuery(kowal, "borysa", "Kowal")).toBe(true);
  });

  it("matches on the category label", () => {
    // The renamed-merchant case: "Kuźnia u Borysa" contains no "kowal", so
    // without the category arm FR-010 would blind FR-012.
    expect(matchesQuery(kowal, "kowal", "Kowal")).toBe(true);
  });

  it("rejects a query matching neither", () => {
    expect(matchesQuery(kowal, "alchemik", "Kowal")).toBe(false);
  });

  it("treats an empty query as no filter at all", () => {
    expect(matchesQuery(kowal, "", "Kowal")).toBe(true);
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

  it("finds a diacritic-free name from a diacritic-bearing query", () => {
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
