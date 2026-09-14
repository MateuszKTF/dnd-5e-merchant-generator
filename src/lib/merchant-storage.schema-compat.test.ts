import { beforeEach, describe, expect, it } from "vitest";

import { readDocument, resetReadOnlyLatch, SCHEMA_VERSION, STORAGE_KEY } from "./merchant-storage";
import { createStorageFake } from "./storage-fake.test-helper";

/**
 * Forward compatibility, pinned to bytes that cannot move.
 *
 * Oracle: AGENTS.md — "Browser-storage schema changes are forward-only. A Worker
 * rollback reverts the script and static assets, but not a GM's `localStorage`
 * … the reverted code must still read it." Plus the PRD guardrail: a saved
 * merchant never disappears silently.
 *
 * **Why this file exists separately.** Every version fixture in
 * `merchant-storage.test.ts` is computed as `SCHEMA_VERSION + 1` or
 * `SCHEMA_VERSION - 1`. That is correct for testing the *branches* — future
 * versus past — but it means the fixtures move the day the constant does. Bump
 * `SCHEMA_VERSION` to 2 and the "older document" test silently stops describing
 * v1 and starts describing v2-minus-one, leaving no pinned v1 document anywhere
 * in the repo to prove a v2 build can still read one. That is the exact
 * anti-pattern the test plan names for this risk: regenerating the fixture
 * erases the regression it exists to catch.
 *
 * So the document below is **raw bytes, written by hand**, not produced by the
 * serializer under test and not derived from any constant.
 */

/**
 * DO NOT REGENERATE. DO NOT DERIVE FROM `SCHEMA_VERSION`.
 *
 * A verbatim v1 document as a real device holds it today. If a future schema
 * makes this unreadable, that is the migration seam telling you it is needed —
 * not a fixture that needs updating. Add the next version as a sibling constant;
 * never edit this one.
 */
const FROZEN_V1_DOCUMENT = `{
  "schemaVersion": 1,
  "transient": {
    "id": "m-frozen-transient",
    "name": "Kowal — 11.09.2026, 20:15",
    "category": "kowal",
    "wealth": "typowa",
    "createdAt": "2026-09-11T18:15:00.000Z",
    "savedAt": null,
    "rows": [
      { "itemId": "longsword", "name": "Longsword", "rarity": "pospolite", "quantity": 3, "priceGp": 18 },
      { "itemId": "chain-mail", "name": "Chain Mail", "rarity": "niezwykłe", "quantity": 1, "priceGp": 87.5 }
    ],
    "corrections": { "longsword": { "priceGp": 21.5 } }
  },
  "saved": [
    {
      "id": "m-frozen-saved",
      "name": "Kuźnia u Borysa",
      "category": "kowal",
      "wealth": "bogata",
      "createdAt": "2026-09-10T09:00:00.000Z",
      "savedAt": "2026-09-10T09:30:00.000Z",
      "rows": [
        { "itemId": "longsword", "name": "Longsword", "rarity": "pospolite", "quantity": 1, "priceGp": 15 }
      ],
      "corrections": {}
    }
  ]
}`;

describe("a v1 document written by an earlier build", () => {
  beforeEach(() => {
    resetReadOnlyLatch();
  });

  it("is still readable by the current build", () => {
    const store = createStorageFake({ seed: { [STORAGE_KEY]: FROZEN_V1_DOCUMENT } });

    const read = readDocument(store);

    expect(read.status).toBe("ok");
  });

  it("preserves the transient merchant's work, including its corrections", () => {
    // US-02: "Ręczne korekty ceny i ilości przetrwały zapis." A rollback is a
    // harsher case than a save, and the promise is the same.
    const store = createStorageFake({ seed: { [STORAGE_KEY]: FROZEN_V1_DOCUMENT } });

    const read = readDocument(store);
    if (read.status !== "ok") throw new Error(`expected ok, got ${read.status}`);

    expect(read.doc.transient?.id).toBe("m-frozen-transient");
    expect(read.doc.transient?.rows).toHaveLength(2);
    expect(read.doc.transient?.corrections.longsword).toStrictEqual({ priceGp: 21.5 });
  });

  it("preserves the saved library, so a rollback does not cost the GM their campaign", () => {
    const store = createStorageFake({ seed: { [STORAGE_KEY]: FROZEN_V1_DOCUMENT } });

    const read = readDocument(store);
    if (read.status !== "ok") throw new Error(`expected ok, got ${read.status}`);

    expect(read.doc.saved).toHaveLength(1);
    expect(read.doc.saved[0].name).toBe("Kuźnia u Borysa");
    expect(read.doc.saved[0].savedAt).toBe("2026-09-10T09:30:00.000Z");
  });

  it("drops nothing while reading it", () => {
    // A salvage that silently discarded a record would still report `ok`.
    const store = createStorageFake({ seed: { [STORAGE_KEY]: FROZEN_V1_DOCUMENT } });

    const read = readDocument(store);
    if (read.status !== "ok") throw new Error(`expected ok, got ${read.status}`);

    expect(read.dropped).toBeUndefined();
  });

  it("guards its own premise: the fixture is pinned to 1, not to the current constant", () => {
    // The assertion that makes this file worth having. When SCHEMA_VERSION
    // becomes 2, this stays 1 and the tests above become a real forward-compat
    // check instead of a tautology. If this ever fails, someone regenerated the
    // fixture — which is the failure this file exists to prevent.
    expect(FROZEN_V1_DOCUMENT).toContain('"schemaVersion": 1');

    // And it must always describe a past-or-present document, never a future
    // one. Today this reads 1 <= 1; after a bump it reads 1 <= 2 and the tests
    // above turn into a real forward-compatibility check. If it ever inverts,
    // the fixture was regenerated — the failure this file exists to prevent.
    const frozenVersion = (JSON.parse(FROZEN_V1_DOCUMENT) as { schemaVersion: number }).schemaVersion;
    expect(frozenVersion).toBe(1);
    expect(frozenVersion).toBeLessThanOrEqual(SCHEMA_VERSION);
  });
});
