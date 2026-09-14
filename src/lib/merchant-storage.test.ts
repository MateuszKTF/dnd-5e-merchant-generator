import { beforeEach, describe, expect, it, vi } from "vitest";

import { autoName, newMerchantId, type Merchant, type StoredRow } from "./merchant";
import { openedSavedIdFor } from "./merchant-session";
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
  type StorageLike,
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

describe("promoteTransient ↔ openedSavedIdFor", () => {
  // The one invariant in this layer that spans two modules and was held by a
  // comment. `merchant-session.ts` infers which saved record the transient slot
  // came from purely from the ids not matching, and says so out loud: the
  // inference "is sound for exactly as long as promote keeps minting".
  //
  // `merchant-session.test.ts` claimed to guard that and could not — it built
  // both merchants from literals it chose itself, so it never executed a line
  // of `promoteTransient` and stayed green when promote stopped minting. This
  // is the test that fails: it drives the inference from the real output.
  //
  // It lives here rather than beside `openedSavedIdFor` because this file
  // already owns the storage fake and the `resetReadOnlyLatch` in `beforeEach`.
  // Importing a latching function into `merchant-session.test.ts` would make
  // that suite order-dependent for the first time — the exact hazard
  // `resetReadOnlyLatch`'s own docblock exists to warn about.
  it("leaves the promoted copy unlinked from the slot it was copied from", () => {
    const merchant = makeMerchant();
    putTransient(merchant, store);

    expect(promoteTransient(store).status).toBe("ok");

    const read = readDocument(store);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;

    // Guard against the vacuous pass, the way the aliasing test above does: if
    // the record never reached `saved`, or the slot was emptied, the assertion
    // below would hold for a reason that has nothing to do with minting.
    expect(read.doc.saved).toHaveLength(1);
    expect(read.doc.transient?.id).toBe(merchant.id);

    expect(openedSavedIdFor(read.doc)).toBeNull();
  });
});

describe("listSaved", () => {
  it("is empty for an untouched store", () => {
    expect(listSaved(store)).toEqual({ status: "ok", merchants: [] });
  });

  it("still lists the merchants when the store refuses writes", () => {
    // The other half of the `read-only` fix. `listSaved` used to pass the
    // read result straight through, so the merchants arrived in a field called
    // `doc` and any caller reading `.merchants` saw an empty library — on a
    // store whose bytes were perfectly readable.
    putTransient(makeMerchant({ name: "Zapisany" }), store);
    promoteTransient(store);
    const bytes = storedBytes(store) ?? "";

    resetReadOnlyLatch();
    const refusing = createStorageFake({ seed: { [STORAGE_KEY]: bytes }, throwOn: true });

    const list = listSaved(refusing);
    expect(list.status).toBe("ok");
    expect(list.status === "ok" && list.merchants.map((m) => m.name)).toEqual(["Zapisany"]);
  });

  it("never contains the transient record", () => {
    // Against a NON-empty saved list, so the assertion cannot pass by way of a
    // `listSaved` that simply always returns nothing.
    putTransient(makeMerchant({ name: "Zapisany" }), store);
    promoteTransient(store);
    putTransient(makeMerchant({ name: "Tylko na ekranie" }), store);

    const list = listSaved(store);
    expect(list.status === "ok" && list.merchants.map((m) => m.name)).toEqual(["Zapisany"]);
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

    // Raw bytes, matching the `updateSavedMerchant` and `deleteMerchant`
    // counterparts: a length check would miss a rename that hit the wrong
    // record, which is the failure actually worth guarding against.
    const before = storedBytes(store);

    expect(renameMerchant("nie-ma-takiego", "Cokolwiek", store)).toEqual({ status: "not-found" });
    expect(storedBytes(store)).toBe(before);
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
    expect(updateSavedMerchant(first.merchant.id, { rows: NEW_ROWS, corrections: {} }, store)).toEqual({
      status: "ok",
    });

    const list = listSaved(store);
    if (list.status !== "ok") throw new Error("list failed");
    expect(JSON.stringify(list.merchants[1])).toBe(neighbourBefore);
    // The positive half, so an `updateSavedMerchant` that did nothing at all
    // cannot pass this test on the neighbour assertion alone.
    expect(list.merchants[0].rows).toEqual(NEW_ROWS);
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
  it("reads an EMPTY write-refusing store as unavailable — nothing to show either way", () => {
    // The seeding is the whole distinction, and the title now says so: with a
    // document present this same store reads `read-only` and hands the
    // merchants over (see the next test). Empty, there is nothing to show, so
    // the write refusal is the only news worth reporting.
    //
    // The store exists and reads fine; only `setItem` throws. Feature detection
    // would call this available and then lose the GM's data, which is why the
    // module probes by actually writing.
    const disabled = createStorageFake({ throwOn: true });

    expect(readDocument(disabled)).toEqual({ status: "unavailable" });
  });

  it("still hands over the merchants when only writes are refused", () => {
    // Safari's private mode: `localStorage` reads fine and `setItem` throws.
    // The GM's library is right there, so hiding it behind a "storage is off"
    // banner would lose merchants for no reason. The document comes back; the
    // status says writes are refused.
    const seeded = createStorageFake();
    putTransient(makeMerchant({ name: "Zapisany wcześniej" }), seeded);
    promoteTransient(seeded);
    const bytes = storedBytes(seeded) ?? "";

    resetReadOnlyLatch();
    const refusing = createStorageFake({ seed: { [STORAGE_KEY]: bytes }, throwOn: true });

    const read = readDocument(refusing);
    expect(read.status).toBe("read-only");
    expect(read.status === "read-only" && read.doc.saved.map((m) => m.name)).toEqual(["Zapisany wcześniej"]);

    // And the latch is engaged, so a later write says so instead of appearing
    // to succeed. The second store is what proves it: on `refusing` the answer
    // could come from the read mapping alone, while a clean store has nothing
    // to map and can only be refused by the latch.
    expect(putTransient(makeMerchant(), refusing)).toEqual({ status: "read-only" });
    expect(putTransient(makeMerchant(), createStorageFake())).toEqual({ status: "read-only" });
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

  it("recognises a full store however the engine spells the failure", () => {
    // The plan called for WebKit's and Firefox's legacy names, and nothing
    // exercised them: while the check was gated on `instanceof DOMException`,
    // reducing the set to the modern name alone changed no test.
    //
    // Getting this wrong is not a wrong message, it is a dead end: an
    // unrecognised quota failure is classified `unavailable`, which LATCHES,
    // and `deleteMerchant` — the only remedy for a full store — is then
    // refused. `"full"` deliberately does not latch.
    function storeThrowing(error: unknown): StorageLike {
      return {
        getItem: () => null,
        setItem: () => {
          throw error;
        },
        removeItem: () => undefined,
      };
    }

    const legacyWebKit = new DOMException("full", "QUOTA_EXCEEDED_ERR");
    const legacyFirefox = new DOMException("full", "NS_ERROR_DOM_QUOTA_REACHED");
    // Not a DOMException at all — the shape `instanceof` used to miss.
    const plain = Object.assign(new Error("full"), { name: "QuotaExceededError" });
    // Only a numeric code, which is all some older engines give.
    const codeOnly = Object.assign(new Error("full"), { name: "Weird", code: 22 });

    for (const error of [legacyWebKit, legacyFirefox, plain, codeOnly]) {
      resetReadOnlyLatch();
      expect(
        writeDocument({ schemaVersion: SCHEMA_VERSION, transient: null, saved: [] }, storeThrowing(error)),
      ).toEqual({ status: "quota-exceeded" });
    }
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

    // Against a SECOND, healthy store — the only assertion that distinguishes
    // the latch from the read-status mapping. On `full`, `read-only` is what
    // the unreadable read maps to whether or not the latch was ever set; a
    // clean store has nothing to map, so only the latch can refuse it.
    expect(putTransient(makeMerchant(), createStorageFake())).toEqual({ status: "read-only" });
  });

  it("never reclaims a quarantined payload on its own", () => {
    const corrupt = createStorageFake({ seed: { [STORAGE_KEY]: GARBAGE } });
    readDocument(corrupt);

    putTransient(makeMerchant(), corrupt);
    promoteTransient(corrupt);
    readDocument(corrupt);

    expect(corruptKeys(corrupt)).toHaveLength(1);
  });

  it("gives each quarantined payload its own key, even within one millisecond", () => {
    // `toISOString()` is millisecond-resolution and the clock is not monotonic,
    // so the timestamp alone let a second quarantine overwrite the first. That
    // first copy can be the only surviving copy of the GM's library.
    //
    // **The clock is frozen deliberately.** Left to run, two reads usually land
    // in different milliseconds and the test passes whether or not the key is
    // unique — a guard that only fires when the machine happens to be slow is
    // not a guard. Freezing forces the collision this exists to rule out.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T10:00:00.000Z"));

    try {
      const corrupt = createStorageFake();

      corrupt.entries.set(STORAGE_KEY, "{{{pierwszy");
      expect(readDocument(corrupt).status).toBe("quarantined");

      corrupt.entries.set(STORAGE_KEY, "{{{drugi");
      expect(readDocument(corrupt).status).toBe("quarantined");

      const keys = corruptKeys(corrupt);
      expect(keys).toHaveLength(2);

      // Both payloads survive, not just the later one.
      const parked = keys.map((key) => corrupt.entries.get(key)).sort();
      expect(parked).toEqual(["{{{drugi", "{{{pierwszy"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports the latch to readers, not just to writers", () => {
    // The latch outlives the store that set it. A page latched by a
    // `future-version` read used to keep answering `ok` on a healthy store
    // while every write was refused with a status that raises no notice — a
    // correction disappearing in silence, which is the guardrail verbatim.
    // Seeded BEFORE the latch engages — afterwards every write is refused, so a
    // store filled later would be empty and the read would answer `unavailable`
    // (nothing to show) rather than `read-only` (here it is, but frozen).
    const healthy = createStorageFake();
    putTransient(makeMerchant({ name: "Zapisany" }), healthy);

    const future = createStorageFake({
      seed: {
        [STORAGE_KEY]: JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, transient: null, saved: [] }),
      },
    });
    expect(readDocument(future).status).toBe("future-version");

    const read = readDocument(healthy);
    expect(read.status).toBe("read-only");
    // And the merchants still come back — a latched page shows what it has.
    expect(read.status === "read-only" && read.doc.transient?.name).toBe("Zapisany");
  });

  it("names the latch as the reason a mutation failed, not `not-found`", () => {
    // `loadForWrite` only translated the read status, so a latched page whose
    // read came back `empty` fell through to the id check and answered
    // `not-found` — which also maps to no notice. The GM was told nothing twice.
    const future = createStorageFake({
      seed: {
        [STORAGE_KEY]: JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, transient: null, saved: [] }),
      },
    });
    expect(readDocument(future).status).toBe("future-version");

    const healthy = createStorageFake();

    expect(promoteTransient(healthy)).toEqual({ status: "read-only" });
    expect(deleteMerchant("cokolwiek", healthy)).toEqual({ status: "read-only" });
    expect(renameMerchant("cokolwiek", "Nowa", healthy)).toEqual({ status: "read-only" });
  });

  it("does not re-copy the payload when the reset write failed", () => {
    // The nastiest combination: bytes that cannot be parsed, in a store too
    // full to overwrite them. The copy aside succeeds, the reset does not, so
    // the corrupt bytes stay under the main key and every later read re-enters
    // quarantine. Without the latch check that is one more full copy per read,
    // growing a store that already reported quota-exceeded — in a module that
    // never reclaims anything.
    const corrupt = createStorageFake({ quotaExceededOn: [STORAGE_KEY] });
    corrupt.entries.set(STORAGE_KEY, GARBAGE);

    for (let i = 0; i < 5; i += 1) {
      expect(readDocument(corrupt).status).toBe("unreadable");
    }

    expect(corruptKeys(corrupt)).toHaveLength(1);
    // And the original bytes are still recoverable by hand, which is the whole
    // point of refusing to touch them.
    expect(corrupt.entries.get(STORAGE_KEY)).toBe(GARBAGE);
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

  it("drops junk inside `saved` without handing it out typed", () => {
    // Reachable by a hand edit, a newer build, or a truncated document. Without
    // the element filter, `listSaved` returned [null, 42] typed as Merchant[]
    // and the next rename threw a TypeError reading `.id` off null — out of a
    // module that promises it never throws.
    const store = createStorageFake({
      seed: { [STORAGE_KEY]: JSON.stringify({ schemaVersion: SCHEMA_VERSION, transient: null, saved: [null, 42] }) },
    });

    const read = readDocument(store);
    expect(read.status).toBe("ok");
    expect(read.status === "ok" && read.dropped).toBe(2);
    expect(() => renameMerchant("whatever", "Nowa nazwa", store)).not.toThrow();
    expect(listSaved(store)).toEqual({ status: "ok", merchants: [] });
  });

  it("keeps the readable merchants when only one record is damaged", () => {
    // The regression this split exists to prevent: element-level damage must
    // not trigger the document-level response. A GM with one truncated record
    // still has the rest, and quarantining would have emptied the main key.
    const good = makeMerchant({ name: "Dobry kowal" });
    const damaged = { ...makeMerchant(), rows: [{ itemId: "x", name: "X", rarity: "pospolite", quantity: 1 }] };
    const store = createStorageFake({
      seed: {
        [STORAGE_KEY]: JSON.stringify({ schemaVersion: SCHEMA_VERSION, transient: null, saved: [good, damaged] }),
      },
    });

    const read = readDocument(store);
    expect(read.status).toBe("ok");
    expect(read.status === "ok" && read.dropped).toBe(1);

    const list = listSaved(store);
    expect(list.status === "ok" && list.merchants.map((m) => m.name)).toEqual(["Dobry kowal"]);
    // Nothing was quarantined and the main key was not emptied.
    expect(corruptKeys(store)).toHaveLength(0);
  });

  it("reports the drop on a write-refusing store too, not just a writable one", () => {
    // The branch the type checker caught: `read-only` carries a document and
    // salvages exactly like `ok`, so dropping the count here would make the
    // loss silent for precisely the GM who cannot re-save to recover from it.
    const good = makeMerchant({ name: "Dobry kowal" });
    const damaged = { ...makeMerchant(), rows: [{ itemId: "x", name: "X", rarity: "pospolite", quantity: 1 }] };
    const bytes = JSON.stringify({ schemaVersion: SCHEMA_VERSION, transient: null, saved: [good, damaged] });

    resetReadOnlyLatch();
    const refusing = createStorageFake({ seed: { [STORAGE_KEY]: bytes }, throwOn: true });

    const read = readDocument(refusing);
    expect(read.status).toBe("read-only");
    expect(read.status === "read-only" && read.dropped).toBe(1);
    expect(read.status === "read-only" && read.doc.saved.map((m) => m.name)).toEqual(["Dobry kowal"]);
  });

  it("keeps the saved library when only the transient slot is damaged", () => {
    // The throwaway record must never cost the durable ones.
    const good = makeMerchant({ name: "Zapisany" });
    const store = createStorageFake({
      seed: {
        [STORAGE_KEY]: JSON.stringify({
          schemaVersion: SCHEMA_VERSION,
          transient: { id: "bez-reszty" },
          saved: [good],
        }),
      },
    });

    const read = readDocument(store);
    expect(read.status === "ok" && read.doc.transient).toBeNull();
    expect(read.status === "ok" && read.doc.saved.map((m) => m.name)).toEqual(["Zapisany"]);
    expect(corruptKeys(store)).toHaveLength(0);
  });

  it("refuses to write an older document rather than relabelling it", () => {
    // No live case at v1 — nothing exists below it. The test is here because
    // `save` stamps SCHEMA_VERSION onto whatever it writes, so the day v2 ships
    // a fall-through would mark a v1 document as v2 without migrating it,
    // silently and permanently. Failing closed is the only behaviour that
    // cannot corrupt by omission.
    const older = JSON.stringify({ schemaVersion: SCHEMA_VERSION - 1, transient: null, saved: [] });
    const store = createStorageFake({ seed: { [STORAGE_KEY]: older } });

    expect(readDocument(store)).toEqual({ status: "needs-migration", found: SCHEMA_VERSION - 1 });
    expect(store.getItem(STORAGE_KEY)).toBe(older);

    // And the latch holds, so nothing downstream can write over it either.
    expect(putTransient(makeMerchant(), store)).toEqual({ status: "read-only" });
    expect(store.getItem(STORAGE_KEY)).toBe(older);

    // Second store, as above: on `store` the answer could come from the read
    // mapping alone. A clean store has nothing to map, so this is the latch.
    expect(putTransient(makeMerchant(), createStorageFake())).toEqual({ status: "read-only" });
  });

  it("protects a v2 document that RESTRUCTURED the fields, not just added one", () => {
    // The fixture above keeps v1's layout, so it passes a shape check by
    // accident. Restructuring is the usual reason to bump a version at all,
    // and this is the case that must not be mistaken for corruption: read the
    // version before the shape, or a rollback quarantines the newer document
    // and overwrites the main key with an empty one.
    const reshaped = JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, merchants: [{ id: "a" }] });
    const store = createStorageFake({ seed: { [STORAGE_KEY]: reshaped } });

    expect(readDocument(store)).toEqual({ status: "future-version", found: SCHEMA_VERSION + 1 });
    expect(store.getItem(STORAGE_KEY)).toBe(reshaped);
    expect([...store.entries.keys()]).toEqual([STORAGE_KEY]);
  });

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

describe("the read-only latch holds across repeated writeDocument calls", () => {
  beforeEach(() => {
    resetReadOnlyLatch();
  });

  /**
   * Oracle: the `writeDocument` docblock — "It still honours the read-only
   * latch." A promise pinned for the first call only is not pinned.
   *
   * Regression this catches: the prior audit planted a mutant that made the
   * latch check self-clearing (refuse once, then forget) and the whole suite
   * stayed green. The one existing test that reaches this check calls
   * `writeDocument` a single time, so refusing-then-forgetting is
   * indistinguishable from refusing-always.
   *
   * The second call deliberately has **no intervening `readDocument`**. A read
   * in between would re-derive the refusal from `loadForWrite`'s own status
   * mapping, which proves that path works and says nothing about the latch.
   */
  function latchViaFutureVersion(): StorageFake {
    const store = createStorageFake({
      seed: { [STORAGE_KEY]: JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, transient: null, saved: [] }) },
    });
    const read = readDocument(store);
    expect(read.status).toBe("future-version");

    return store;
  }

  const document = (): StorageDocument => ({ schemaVersion: SCHEMA_VERSION, transient: null, saved: [] });

  it("refuses the second write as well as the first", () => {
    latchViaFutureVersion();
    const clean = createStorageFake();

    expect(writeDocument(document(), clean).status).toBe("read-only");
    // No read in between: this is the assertion the single-call test cannot make.
    expect(writeDocument(document(), clean).status).toBe("read-only");
  });

  it("refuses a third write, and leaves the store untouched throughout", () => {
    latchViaFutureVersion();
    const clean = createStorageFake();

    writeDocument(document(), clean);
    writeDocument(document(), clean);

    expect(writeDocument(document(), clean).status).toBe("read-only");
    // The latch is worthless if it reports refusal and writes anyway.
    expect(clean.entries.size).toBe(0);
  });

  it("carries across store objects, because the latch is module state", () => {
    latchViaFutureVersion();

    expect(writeDocument(document(), createStorageFake()).status).toBe("read-only");
    expect(writeDocument(document(), createStorageFake()).status).toBe("read-only");
  });
});

describe("probeWritable on a store that refuses removal", () => {
  beforeEach(() => {
    resetReadOnlyLatch();
  });

  /**
   * Oracle: the `probeWritable` docblock — writability is "answered by actually
   * writing", and `"full"` is separate from `"unavailable"` because a full store
   * is still readable. A store that accepts the probe write and then refuses to
   * take it back is not writable in any useful sense, and the error is not a
   * quota error, so it must land on `unavailable`.
   *
   * This branch existed and was unreachable from any test until
   * `throwOnRemove` was added to the fake: the probe's `removeItem` sits inside
   * the same `try` as its `setItem`, and nothing could make it throw.
   */
  it("treats a store whose removeItem throws as unavailable, not writable", () => {
    const store = createStorageFake({ throwOnRemove: true });

    // An empty store: the read has to fall through to the writability probe to
    // decide between `empty` and `unavailable`.
    expect(readDocument(store).status).toBe("unavailable");
  });

  it("does not misreport it as a full store", () => {
    // `full` would be wrong twice over: the write succeeded, and the failure was
    // a SecurityError rather than a quota error. A `full` answer would send the
    // GM to free space that is not the problem.
    const store = createStorageFake({ throwOnRemove: true });

    expect(putTransient(makeMerchant(), store).status).not.toBe("quota-exceeded");
  });

  it("still reads a document that is sitting right there", () => {
    // The reason `full` and `unavailable` are separate at all: a store we cannot
    // write to may still hold merchants, and refusing to read would lose them.
    const seeded = createStorageFake({
      throwOnRemove: true,
      seed: {
        [STORAGE_KEY]: JSON.stringify({ schemaVersion: SCHEMA_VERSION, transient: null, saved: [makeMerchant()] }),
      },
    });

    const read = readDocument(seeded);

    expect(read.status).toBe("read-only");
    if (read.status !== "read-only") return;
    expect(read.doc.saved).toHaveLength(1);
  });
});
