import { beforeEach, describe, expect, it } from "vitest";

import { autoName, newMerchantId, type Merchant, type StoredRow } from "./merchant";
import {
  deleteMerchant,
  listSaved,
  promoteTransient,
  putTransient,
  readDocument,
  renameMerchant,
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

let store: StorageFake;

beforeEach(() => {
  store = createStorageFake();
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
