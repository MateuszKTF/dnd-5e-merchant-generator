import { beforeEach, describe, expect, it } from "vitest";

import { autoName, newMerchantId, type Merchant, type StoredRow } from "./merchant";
import {
  deleteMerchant,
  listSaved,
  promoteTransient,
  putTransient,
  readDocument,
  renameMerchant,
  resetReadOnlyLatch,
  updateSavedMerchant,
  writeDocument,
  SCHEMA_VERSION,
  STORAGE_KEY,
  type StorageDocument,
} from "./merchant-storage";
import { createStorageFake, type StorageFake } from "./storage-fake.test-helper";

const ROWS: StoredRow[] = [
  { itemId: "longsword", name: "Longsword", rarity: "pospolite", quantity: 3, priceGp: 18 },
  { itemId: "chain-mail", name: "Chain Mail", rarity: "niezwykłe", quantity: 1, priceGp: 87.5 },
];

function makeMerchant(overrides: Partial<Merchant> = {}): Merchant {
  const createdAt = new Date(2026, 8, 11, 14, 32);

  return {
    id: newMerchantId(),
    name: autoName("kowal", createdAt),
    category: "kowal",
    wealth: "typowa",
    createdAt: createdAt.toISOString(),
    savedAt: null,
    rows: structuredClone(ROWS),
    corrections: {},
    ...overrides,
  };
}

/** The raw bytes under the main key — the only honest way to assert "untouched". */
function storedBytes(store: StorageFake): string | null {
  return store.entries.get(STORAGE_KEY) ?? null;
}

const CORRUPT_PREFIX = `${STORAGE_KEY}:corrupt:`;

/** Keys the module parked corrupt payloads under. */
function corruptKeys(fake: StorageFake): string[] {
  return [...fake.entries.keys()].filter((key) => key.startsWith(CORRUPT_PREFIX));
}

let store: StorageFake;

beforeEach(() => {
  store = createStorageFake();
  // Vitest isolates module state per file, not per test, so a test that latches
  // the read-only flag would otherwise refuse every write in every test after
  // it — and the suite would silently become order-dependent.
  resetReadOnlyLatch();
});

describe("readDocument", () => {
  it("reports an empty store as empty rather than as an error", () => {
    expect(readDocument(store)).toEqual({ status: "empty" });
  });

  it("reports an absent ambient store as unavailable", () => {
    // No argument, and this runner has no `localStorage` — the same condition
    // the prerender build hits. It must answer, not throw.
    expect(readDocument()).toEqual({ status: "unavailable" });
  });

  it("reconstructs a document a fresh write put there", () => {
    const doc: StorageDocument = { schemaVersion: SCHEMA_VERSION, transient: makeMerchant(), saved: [makeMerchant()] };

    expect(writeDocument(doc, store)).toEqual({ status: "ok" });
    expect(readDocument(store)).toEqual({ status: "ok", doc });
  });

  it("stores one legible JSON document under one key carrying its version", () => {
    putTransient(makeMerchant(), store);

    expect([...store.entries.keys()]).toEqual([STORAGE_KEY]);
    expect(JSON.parse(storedBytes(store) ?? "")).toMatchObject({ schemaVersion: SCHEMA_VERSION });
  });
});

describe("putTransient", () => {
  it("round-trips the transient merchant", () => {
    const merchant = makeMerchant();

    expect(putTransient(merchant, store)).toEqual({ status: "ok" });

    const read = readDocument(store);
    expect(read.status).toBe("ok");
    expect(read.status === "ok" && read.doc.transient).toEqual(merchant);
  });

  it("replaces the transient slot without touching saved", () => {
    putTransient(makeMerchant({ name: "Pierwszy" }), store);
    promoteTransient(store);
    putTransient(makeMerchant({ name: "Drugi" }), store);

    const read = readDocument(store);
    expect(read.status === "ok" && read.doc.transient?.name).toBe("Drugi");
    expect(read.status === "ok" && read.doc.saved.map((m) => m.name)).toEqual(["Pierwszy"]);
  });

  it("reports an absent ambient store rather than silently dropping the write", () => {
    expect(putTransient(makeMerchant())).toEqual({ status: "unavailable" });
  });
});

describe("promoteTransient", () => {
  it("copies the transient record into saved under a fresh id and a savedAt", () => {
    const merchant = makeMerchant();
    putTransient(merchant, store);

    const promoted = promoteTransient(store);

    expect(promoted.status).toBe("ok");
    if (promoted.status !== "ok") return;
    expect(promoted.merchant.id).not.toBe(merchant.id);
    expect(promoted.merchant.savedAt).not.toBeNull();
    expect(Number.isNaN(Date.parse(promoted.merchant.savedAt ?? ""))).toBe(false);
    expect(promoted.merchant.rows).toEqual(merchant.rows);
  });

  it("leaves the transient slot in place — the GM is still looking at that shop", () => {
    const merchant = makeMerchant();
    putTransient(merchant, store);
    promoteTransient(store);

    const read = readDocument(store);
    expect(read.status === "ok" && read.doc.transient?.id).toBe(merchant.id);
  });

  it("survives a later generate byte-for-byte — the aliasing hazard", () => {
    // The single most important assertion in this slice. If promotion flagged
    // the transient record instead of copying it, the next generate would
    // overwrite a merchant the GM explicitly saved, invisibly.
    const original = makeMerchant({ name: "Zapisany" });
    putTransient(original, store);
    const promoted = promoteTransient(store);
    expect(promoted.status).toBe("ok");
    if (promoted.status !== "ok") return;

    // Separate identity is what makes the saved slot unreachable. Everything
    // here round-trips through JSON, so object-level aliasing cannot survive a
    // write anyway — a shared *id* is the form the hazard would actually take.
    expect(promoted.merchant.id).not.toBe(original.id);

    const savedBefore = JSON.stringify(listSaved(store));
    // Guard against the vacuous pass: an empty saved list is trivially
    // unchanged by anything, so the assertion below would prove nothing.
    expect(savedBefore).toContain("Zapisany");

    for (let i = 0; i < 5; i += 1) {
      putTransient(makeMerchant({ name: `Przegenerowany ${i}` }), store);
    }

    expect(JSON.stringify(listSaved(store))).toBe(savedBefore);
  });

  it("appends rather than replacing, so a second save keeps the first", () => {
    putTransient(makeMerchant({ name: "Kowal A" }), store);
    promoteTransient(store);
    putTransient(makeMerchant({ name: "Kowal B" }), store);
    promoteTransient(store);

    const list = listSaved(store);
    expect(list.status === "ok" && list.merchants.map((m) => m.name)).toEqual(["Kowal A", "Kowal B"]);
  });

  it("reports not-found when there is nothing to save", () => {
    expect(promoteTransient(store)).toEqual({ status: "not-found" });
  });
});

describe("listSaved", () => {
  it("is empty for an untouched store", () => {
    expect(listSaved(store)).toEqual({ status: "ok", merchants: [] });
  });

  it("never contains the transient record", () => {
    const merchant = makeMerchant();
    putTransient(merchant, store);

    const list = listSaved(store);
    expect(list.status === "ok" && list.merchants).toEqual([]);
  });
});

describe("renameMerchant", () => {
  it("changes the name and nothing else", () => {
    putTransient(makeMerchant(), store);
    const promoted = promoteTransient(store);
    if (promoted.status !== "ok") throw new Error("promote failed");

    expect(renameMerchant(promoted.merchant.id, "Kuźnia pod Smokiem", store)).toEqual({ status: "ok" });

    const list = listSaved(store);
    expect(list.status === "ok" && list.merchants[0]).toEqual({ ...promoted.merchant, name: "Kuźnia pod Smokiem" });
  });

  it("reports not-found for an unknown id without appending", () => {
    putTransient(makeMerchant(), store);
    promoteTransient(store);

    expect(renameMerchant("nie-ma-takiego", "Cokolwiek", store)).toEqual({ status: "not-found" });

    const list = listSaved(store);
    expect(list.status === "ok" && list.merchants.length).toBe(1);
  });
});

describe("updateSavedMerchant", () => {
  const NEW_ROWS: StoredRow[] = [{ itemId: "dagger", name: "Dagger", rarity: "pospolite", quantity: 9, priceGp: 2 }];

  it("replaces rows and corrections but keeps the identity fields", () => {
    putTransient(makeMerchant(), store);
    const promoted = promoteTransient(store);
    if (promoted.status !== "ok") throw new Error("promote failed");

    const result = updateSavedMerchant(
      promoted.merchant.id,
      { rows: NEW_ROWS, corrections: { dagger: { quantity: 9 } } },
      store,
    );
    expect(result).toEqual({ status: "ok" });

    const list = listSaved(store);
    if (list.status !== "ok") throw new Error("list failed");
    const updated = list.merchants[0];

    expect(updated.rows).toEqual(NEW_ROWS);
    expect(updated.corrections).toEqual({ dagger: { quantity: 9 } });
    expect(updated.id).toBe(promoted.merchant.id);
    expect(updated.createdAt).toBe(promoted.merchant.createdAt);
    expect(updated.name).toBe(promoted.merchant.name);
  });

  it("touches exactly one record and leaves its neighbours byte-identical", () => {
    putTransient(makeMerchant({ name: "Kowal A" }), store);
    const first = promoteTransient(store);
    putTransient(makeMerchant({ name: "Kowal B" }), store);
    const second = promoteTransient(store);
    if (first.status !== "ok" || second.status !== "ok") throw new Error("promote failed");

    const neighbourBefore = JSON.stringify(second.merchant);
    updateSavedMerchant(first.merchant.id, { rows: NEW_ROWS, corrections: {} }, store);

    const list = listSaved(store);
    if (list.status !== "ok") throw new Error("list failed");
    expect(JSON.stringify(list.merchants[1])).toBe(neighbourBefore);
  });

  it("reports not-found for an unknown id without appending", () => {
    putTransient(makeMerchant(), store);
    promoteTransient(store);
    const before = storedBytes(store);

    expect(updateSavedMerchant("usuniety-dawno-temu", { rows: NEW_ROWS, corrections: {} }, store)).toEqual({
      status: "not-found",
    });
    expect(storedBytes(store)).toBe(before);
  });
});

describe("deleteMerchant", () => {
  it("removes exactly one record and leaves the rest intact", () => {
    putTransient(makeMerchant({ name: "Kowal A" }), store);
    const first = promoteTransient(store);
    putTransient(makeMerchant({ name: "Kowal B" }), store);
    promoteTransient(store);
    putTransient(makeMerchant({ name: "Kowal C" }), store);
    promoteTransient(store);
    if (first.status !== "ok") throw new Error("promote failed");

    expect(deleteMerchant(first.merchant.id, store)).toEqual({ status: "ok" });

    const list = listSaved(store);
    expect(list.status === "ok" && list.merchants.map((m) => m.name)).toEqual(["Kowal B", "Kowal C"]);
  });

  it("leaves the transient record alone", () => {
    const merchant = makeMerchant();
    putTransient(merchant, store);
    const promoted = promoteTransient(store);
    if (promoted.status !== "ok") throw new Error("promote failed");

    deleteMerchant(promoted.merchant.id, store);

    const read = readDocument(store);
    expect(read.status === "ok" && read.doc.transient?.id).toBe(merchant.id);
  });

  it("reports not-found for an unknown id and changes nothing", () => {
    putTransient(makeMerchant(), store);
    promoteTransient(store);
    const before = storedBytes(store);

    expect(deleteMerchant("nie-ma-takiego", store)).toEqual({ status: "not-found" });
    expect(storedBytes(store)).toBe(before);
  });
});

describe("storage unavailable", () => {
  it("reads as unavailable when the store refuses writes — Safari private mode", () => {
    // The store exists and reads fine; only `setItem` throws. Feature detection
    // would call this available and then lose the GM's data, which is why the
    // module probes by actually writing.
    const disabled = createStorageFake({ throwOn: true });

    expect(readDocument(disabled)).toEqual({ status: "unavailable" });
  });

  it("writes as unavailable rather than throwing", () => {
    const disabled = createStorageFake({ throwOn: true });

    expect(putTransient(makeMerchant(), disabled)).toEqual({ status: "unavailable" });
    expect(writeDocument({ schemaVersion: SCHEMA_VERSION, transient: null, saved: [] }, disabled)).toEqual({
      status: "unavailable",
    });
  });

  it("reads as unavailable when even reading is refused — site data blocked", () => {
    const blocked = createStorageFake({ throwOnGet: true });

    expect(readDocument(blocked)).toEqual({ status: "unavailable" });
  });

  it("reports unavailable through every operation, so none of them throw", () => {
    const disabled = createStorageFake({ throwOn: true });

    expect(listSaved(disabled)).toEqual({ status: "unavailable" });
    expect(promoteTransient(disabled)).toEqual({ status: "unavailable" });
    expect(renameMerchant("x", "y", disabled)).toEqual({ status: "unavailable" });
    expect(deleteMerchant("x", disabled)).toEqual({ status: "unavailable" });
    expect(updateSavedMerchant("x", { rows: [], corrections: {} }, disabled)).toEqual({ status: "unavailable" });
  });
});

describe("quota exhausted", () => {
  function fullStoreHolding(doc: StorageDocument): StorageFake {
    return createStorageFake({ seed: { [STORAGE_KEY]: JSON.stringify(doc) }, quotaExceededOn: true });
  }

  it("still reads — a full store is not an unreadable one", () => {
    const doc: StorageDocument = { schemaVersion: SCHEMA_VERSION, transient: makeMerchant(), saved: [] };
    const full = fullStoreHolding(doc);

    expect(readDocument(full)).toEqual({ status: "ok", doc });
  });

  it("reports quota-exceeded on write and leaves the prior document intact", () => {
    const doc: StorageDocument = {
      schemaVersion: SCHEMA_VERSION,
      transient: makeMerchant({ name: "Ocalony" }),
      saved: [],
    };
    const full = fullStoreHolding(doc);
    const before = storedBytes(full);

    expect(putTransient(makeMerchant({ name: "Nowy" }), full)).toEqual({ status: "quota-exceeded" });
    expect(storedBytes(full)).toBe(before);
  });

  it("distinguishes a full store from a disabled one", () => {
    const full = createStorageFake({ quotaExceededOn: true });
    const disabled = createStorageFake({ throwOn: true });

    expect(putTransient(makeMerchant(), full)).toEqual({ status: "quota-exceeded" });
    expect(putTransient(makeMerchant(), disabled)).toEqual({ status: "unavailable" });
  });
});

describe("corrupt payload", () => {
  const GARBAGE = "{{{ to nie jest JSON";

  it("quarantines unparseable bytes verbatim and leaves a valid document behind", () => {
    const corrupt = createStorageFake({ seed: { [STORAGE_KEY]: GARBAGE } });

    expect(readDocument(corrupt)).toEqual({ status: "quarantined" });

    const parked = corruptKeys(corrupt);
    expect(parked).toHaveLength(1);
    expect(corrupt.entries.get(parked[0])).toBe(GARBAGE);

    const recovered = readDocument(corrupt);
    expect(recovered).toEqual({ status: "ok", doc: { schemaVersion: SCHEMA_VERSION, transient: null, saved: [] } });
  });

  it("treats a document that parses but is structurally invalid as corrupt, not empty", () => {
    const payloads = [
      '{"saved":"nie-tablica","transient":null,"schemaVersion":1}',
      '{"transient":null,"saved":[]}',
      '{"schemaVersion":1,"saved":[]}',
      "[]",
      "null",
      "42",
    ];

    for (const payload of payloads) {
      const invalid = createStorageFake({ seed: { [STORAGE_KEY]: payload } });

      expect(readDocument(invalid)).toEqual({ status: "quarantined" });
      expect(corruptKeys(invalid)).toHaveLength(1);
    }
  });

  it("leaves the corrupt bytes strictly alone when they cannot be copied aside", () => {
    // The quarantine copy is a second full copy of the payload, so a store too
    // full to hold it is exactly the case where wiping the original would
    // destroy the only remaining data. Nothing may be touched here.
    const full = createStorageFake({
      seed: { [STORAGE_KEY]: GARBAGE },
      quotaExceededOn: (key) => key.startsWith(CORRUPT_PREFIX),
    });

    expect(readDocument(full)).toEqual({ status: "unreadable" });
    expect(storedBytes(full)).toBe(GARBAGE);
    expect(corruptKeys(full)).toEqual([]);
  });

  it("refuses every subsequent write once a payload was left unreadable", () => {
    const full = createStorageFake({
      seed: { [STORAGE_KEY]: GARBAGE },
      quotaExceededOn: (key) => key.startsWith(CORRUPT_PREFIX),
    });

    expect(readDocument(full)).toEqual({ status: "unreadable" });

    expect(putTransient(makeMerchant(), full)).toEqual({ status: "read-only" });
    expect(promoteTransient(full)).toEqual({ status: "read-only" });
    expect(deleteMerchant("x", full)).toEqual({ status: "read-only" });
    expect(storedBytes(full)).toBe(GARBAGE);
  });

  it("never reclaims a quarantined payload on its own", () => {
    const corrupt = createStorageFake({ seed: { [STORAGE_KEY]: GARBAGE } });
    readDocument(corrupt);

    putTransient(makeMerchant(), corrupt);
    promoteTransient(corrupt);
    readDocument(corrupt);

    expect(corruptKeys(corrupt)).toHaveLength(1);
  });
});

describe("newer schema version", () => {
  function futureStore(): StorageFake {
    const doc = {
      schemaVersion: SCHEMA_VERSION + 1,
      transient: null,
      saved: [makeMerchant()],
      nowaKolumnaZV2: "pole, o którym ta wersja nie wie",
    };

    return createStorageFake({ seed: { [STORAGE_KEY]: JSON.stringify(doc) } });
  }

  it("reports the version it found and leaves the bytes strictly untouched", () => {
    const future = futureStore();
    const before = storedBytes(future);

    expect(readDocument(future)).toEqual({ status: "future-version", found: SCHEMA_VERSION + 1 });
    expect(storedBytes(future)).toBe(before);
    expect(corruptKeys(future)).toEqual([]);
  });

  it("latches read-only for the rest of the page load, still without touching the bytes", () => {
    const future = futureStore();
    const before = storedBytes(future);

    expect(readDocument(future).status).toBe("future-version");

    // `writeDocument` is the one that needs the latch rather than the detection:
    // it does not re-read first, so without a latched flag it would overwrite the
    // newer document on the spot. The rest re-detect through `loadForWrite`.
    expect(writeDocument({ schemaVersion: SCHEMA_VERSION, transient: null, saved: [] }, future)).toEqual({
      status: "read-only",
    });
    expect(putTransient(makeMerchant(), future)).toEqual({ status: "read-only" });
    expect(promoteTransient(future)).toEqual({ status: "read-only" });
    expect(renameMerchant("x", "y", future)).toEqual({ status: "read-only" });
    expect(updateSavedMerchant("x", { rows: [], corrections: {} }, future)).toEqual({ status: "read-only" });
    expect(deleteMerchant("x", future)).toEqual({ status: "read-only" });
    expect(storedBytes(future)).toBe(before);
  });

  it("latches for the page load, not for one store", () => {
    // A GM holding a newer document must not have anything else in that load
    // rewrite it — including a different, perfectly healthy store object.
    expect(readDocument(futureStore()).status).toBe("future-version");

    expect(putTransient(makeMerchant(), store)).toEqual({ status: "read-only" });
  });

  it("accepts the current version without latching", () => {
    const current = createStorageFake({
      seed: { [STORAGE_KEY]: JSON.stringify({ schemaVersion: SCHEMA_VERSION, transient: null, saved: [] }) },
    });

    expect(readDocument(current).status).toBe("ok");
    expect(putTransient(makeMerchant(), current)).toEqual({ status: "ok" });
  });
});
