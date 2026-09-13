import { describe, expect, it } from "vitest";

import { CATEGORIES, WEALTH_LEVELS, type CategoryId, type Wealth } from "@/data/items";

import type { Merchant, StoredRow } from "./merchant";
import {
  isKnownCategory,
  isKnownWealth,
  nextSaveSession,
  nextSaveState,
  openedSavedIdFor,
  wouldLoseCorrections,
  restoreFromDocument,
  restoreFromMerchant,
  SAVE_EVENTS,
  SAVE_STATES,
  type SaveSession,
  type SaveSessionEvent,
  type SaveEvent,
  type SaveState,
} from "./merchant-session";
import { SCHEMA_VERSION, type StorageDocument } from "./merchant-storage";

const ROWS: StoredRow[] = [
  { itemId: "longsword", name: "Longsword", rarity: "pospolite", quantity: 3, priceGp: 18 },
  { itemId: "potion-of-healing", name: "Potion of Healing", rarity: "niezwykłe", quantity: 1, priceGp: 50 },
];

function merchant(overrides: Partial<Merchant> = {}): Merchant {
  return {
    id: "m-1",
    name: "Kowal — 11.09.2026, 14:32",
    category: "kowal",
    wealth: "bogata",
    createdAt: "2026-09-11T12:32:00.000Z",
    savedAt: null,
    rows: ROWS,
    corrections: { longsword: { priceGp: 20 } },
    ...overrides,
  };
}

function documentWith(transient: Merchant | null): StorageDocument {
  return { schemaVersion: SCHEMA_VERSION, transient, saved: [] };
}

/**
 * A category this build has never heard of.
 *
 * The assertion goes through a `string`-typed parameter because that is the
 * honest provenance: the value comes back from `JSON.parse`, where a renamed
 * or removed category is an ordinary possibility the type system cannot see.
 */
function asCategory(value: string): CategoryId {
  return value as CategoryId;
}

function asWealth(value: string): Wealth {
  return value as Wealth;
}

describe("restoreFromDocument", () => {
  it("returns null when the document holds no transient merchant", () => {
    expect(restoreFromDocument(documentWith(null))).toBeNull();
  });

  it("returns null when the transient record has no rows to render", () => {
    // The hand-edited `"transient": {}` case. F-01 validates the document, not
    // the merchant inside it, so this really does read back as `ok` — and a
    // `.map` over an absent `rows` inside a mount effect would blank the page.
    const malformed = { ...merchant(), rows: undefined as unknown as StoredRow[] };

    expect(restoreFromDocument(documentWith(malformed))).toBeNull();
  });

  it("returns null when the rows are an array of junk, not just absent", () => {
    // The case the old `Array.isArray` guard let through: it passed, and the
    // very next line mapped `row.itemId` over `null` and threw — out of a pure
    // module, inside a mount effect, blanking the only page the product has.
    const junk = { ...merchant(), rows: [null, 3] as unknown as StoredRow[] };

    expect(restoreFromDocument(documentWith(junk))).toBeNull();
    expect(() => restoreFromDocument(documentWith(junk))).not.toThrow();
  });

  it("derives both controls from the restored merchant", () => {
    const restored = restoreFromDocument(documentWith(merchant()));

    expect(restored).not.toBeNull();
    expect(restored?.category).toBe("kowal");
    expect(restored?.wealth).toBe("bogata");
    expect(restored?.categoryWasReset).toBe(false);
    expect(restored?.wealthWasReset).toBe(false);
  });

  it("hands back the merchant untouched, corrections included", () => {
    const stored = merchant();
    const restored = restoreFromDocument(documentWith(stored));

    expect(restored?.merchant).toBe(stored);
    expect(restored?.merchant.corrections).toEqual({ longsword: { priceGp: 20 } });
  });

  it("seeds recentIds with exactly the restored row ids, in order", () => {
    const restored = restoreFromDocument(documentWith(merchant()));

    expect(restored?.recentIds).toEqual(["longsword", "potion-of-healing"]);
  });

  it("resets an unknown category to the default and says so", () => {
    const restored = restoreFromDocument(documentWith(merchant({ category: asCategory("kowalstwo-krasnoludzkie") })));

    expect(restored?.category).toBe(CATEGORIES[0].id);
    expect(restored?.categoryWasReset).toBe(true);
  });

  it("keeps the rows and the other control when the category is unknown", () => {
    // The point of the reset: a renamed category degrades one `select`, not the
    // merchant. Rows are self-contained, so the table still renders.
    const restored = restoreFromDocument(documentWith(merchant({ category: asCategory("kowalstwo-krasnoludzkie") })));

    expect(restored?.merchant.rows).toEqual(ROWS);
    expect(restored?.wealth).toBe("bogata");
    expect(restored?.wealthWasReset).toBe(false);
  });

  it("resets an unknown wealth to the default and says so", () => {
    const restored = restoreFromDocument(documentWith(merchant({ wealth: asWealth("książęca") })));

    expect(restored?.wealth).toBe(WEALTH_LEVELS[0].id);
    expect(restored?.wealthWasReset).toBe(true);
  });

  it("keeps the rows and the other control when the wealth is unknown", () => {
    const restored = restoreFromDocument(documentWith(merchant({ wealth: asWealth("książęca") })));

    expect(restored?.merchant.rows).toEqual(ROWS);
    expect(restored?.category).toBe("kowal");
    expect(restored?.categoryWasReset).toBe(false);
  });

  it("survives both enums going stale at once", () => {
    const stale = merchant({ category: asCategory("nieznana"), wealth: asWealth("nieznana") });
    const restored = restoreFromDocument(documentWith(stale));

    expect(restored?.category).toBe(CATEGORIES[0].id);
    expect(restored?.wealth).toBe(WEALTH_LEVELS[0].id);
    expect(restored?.merchant.rows).toEqual(ROWS);
  });
});

describe("restoreFromMerchant", () => {
  // S-04's second caller: a merchant out of the *saved* collection, not the
  // transient slot. Same bytes, same provenance (`JSON.parse`), so the same
  // normalisation — factored here rather than duplicated at the open call site,
  // where a divergence would show up as an opened merchant behaving subtly
  // differently from a restored one.
  const saved = merchant({ id: "m-saved", savedAt: "2026-09-11T18:15:00.000Z" });

  it("returns null when there is no merchant to open", () => {
    expect(restoreFromMerchant(null)).toBeNull();
  });

  it("returns null when the record has no rows to render", () => {
    const malformed = { ...saved, rows: undefined as unknown as StoredRow[] };

    expect(restoreFromMerchant(malformed)).toBeNull();
  });

  it("hands back the saved record untouched, corrections included", () => {
    // US-02's own criterion: an opened merchant is identical to what was saved.
    const restored = restoreFromMerchant(saved);

    expect(restored?.merchant).toBe(saved);
    expect(restored?.merchant.corrections).toEqual({ longsword: { priceGp: 20 } });
  });

  it("derives both controls from the opened record", () => {
    const restored = restoreFromMerchant(saved);

    expect(restored?.category).toBe("kowal");
    expect(restored?.wealth).toBe("bogata");
  });

  it("normalises an unknown category while keeping the rows intact", () => {
    const stale = merchant({ category: asCategory("kowalstwo-krasnoludzkie") });
    const restored = restoreFromMerchant(stale);

    expect(restored?.category).toBe(CATEGORIES[0].id);
    expect(restored?.categoryWasReset).toBe(true);
    expect(restored?.merchant.rows).toEqual(ROWS);
  });

  it("normalises an unknown wealth while keeping the rows intact", () => {
    const restored = restoreFromMerchant(merchant({ wealth: asWealth("książęca") }));

    expect(restored?.wealth).toBe(WEALTH_LEVELS[0].id);
    expect(restored?.wealthWasReset).toBe(true);
    expect(restored?.merchant.rows).toEqual(ROWS);
  });

  it("seeds recentIds from the opened record's rows", () => {
    expect(restoreFromMerchant(saved)?.recentIds).toEqual(["longsword", "potion-of-healing"]);
  });

  it("is what restoreFromDocument does to the transient slot", () => {
    // The wrapper adds nothing but the field access. Asserting it keeps the two
    // paths from drifting the day someone adds a rule to one of them.
    const transient = merchant();

    expect(restoreFromDocument(documentWith(transient))).toEqual(restoreFromMerchant(transient));
  });
});

describe("isKnownCategory / isKnownWealth", () => {
  it("accepts every member of the catalog", () => {
    for (const { id } of CATEGORIES) {
      expect(isKnownCategory(id)).toBe(true);
    }
    for (const { id } of WEALTH_LEVELS) {
      expect(isKnownWealth(id)).toBe(true);
    }
  });

  it("rejects strings that are not members", () => {
    // `""` and a near-miss casing matter: both are shapes a hand-edited
    // document plausibly holds, and `some` must not be fooled by either.
    const strangers = ["", "Kowal", "kowale", "bogata ", "przedmioty_magiczne"];

    for (const value of strangers) {
      expect(isKnownCategory(value)).toBe(false);
      expect(isKnownWealth(value)).toBe(false);
    }
  });

  it("does not confuse the two enums", () => {
    expect(isKnownCategory("bogata")).toBe(false);
    expect(isKnownWealth("kowal")).toBe(false);
  });

  it("narrows to the union, not to string", () => {
    // The assertion is the assignment: it only compiles if the predicate
    // narrowed `string` down to `CategoryId` / `Wealth`.
    const candidates = ["kowal", "bogata"];

    for (const value of candidates) {
      if (isKnownCategory(value)) {
        const narrowed: CategoryId = value;
        expect(narrowed).toBe("kowal");
      }
      if (isKnownWealth(value)) {
        const narrowed: Wealth = value;
        expect(narrowed).toBe("bogata");
      }
    }
  });
});

describe("nextSaveState", () => {
  /**
   * The whole table, cell by cell.
   *
   * Written out rather than sampled, because every sampled version of this grew
   * a blind spot: the previous suite asserted an exact value for 23 of the 32
   * cells, and the nine it missed included `saved` x `restored` — a reload
   * presenting "Zapisano" over a merchant that was never promoted, which is the
   * module's own named failure mode. Flipping that cell used to leave the suite
   * green.
   *
   * The `Record<SaveState, Record<SaveEvent, SaveState>>` type is what keeps it
   * honest: adding a state or an event makes this literal a compile error until
   * someone decides what the new cells answer, which is exactly the decision
   * that should not be made by omission.
   */
  const EXPECTED: Record<SaveState, Record<SaveEvent, SaveState>> = {
    unavailable: {
      generated: "armed",
      corrected: "armed",
      restored: "armed",
      opened: "armed",
      promoted: "unavailable",
      "promote-failed": "unavailable",
      "cleared-open": "unavailable",
      "persistence-off": "stood-down",
    },
    "stood-down": {
      generated: "stood-down",
      corrected: "stood-down",
      restored: "stood-down",
      opened: "stood-down",
      promoted: "stood-down",
      "promote-failed": "stood-down",
      "cleared-open": "stood-down",
      "persistence-off": "stood-down",
    },
    armed: {
      generated: "armed",
      corrected: "armed",
      restored: "armed",
      opened: "armed",
      promoted: "saved",
      "promote-failed": "armed",
      "cleared-open": "armed",
      "persistence-off": "stood-down",
    },
    saved: {
      generated: "armed",
      corrected: "armed",
      restored: "armed",
      opened: "armed",
      promoted: "saved",
      "promote-failed": "armed",
      "cleared-open": "armed",
      "persistence-off": "stood-down",
    },
  };

  it("answers exactly the documented cell for every event from every state", () => {
    for (const state of SAVE_STATES) {
      for (const event of SAVE_EVENTS) {
        expect(`${state} x ${event} -> ${nextSaveState(state, event)}`).toBe(
          `${state} x ${event} -> ${EXPECTED[state][event]}`,
        );
      }
    }
  });

  it("leaves a failed promote armed", () => {
    // The rule the whole module exists for: nothing was written, so the button
    // must still invite the retry rather than claim the save happened.
    expect(nextSaveState("armed", "promote-failed")).toBe("armed");
  });

  it("reaches saved only by an actual promote — from every state, with no exceptions", () => {
    // The `saved` row is no longer skipped, and it no longer needs to be: the
    // one cell that used to be an exception (`saved` x `promote-failed`) now
    // re-arms, so the rule holds across the whole table. The previous version
    // of this test skipped the row that contained its own counterexample.
    for (const state of SAVE_STATES) {
      for (const event of SAVE_EVENTS) {
        if (event === "promoted") continue;

        expect(nextSaveState(state, event)).not.toBe("saved");
      }
    }
  });

  it("re-arms a failed promote even from saved", () => {
    // The button does not say "saved once", it says "saved". A write that just
    // failed makes that false, however many succeeded before it.
    expect(nextSaveState("saved", "promote-failed")).toBe("armed");
  });

  it("moves armed to saved on a successful promote", () => {
    expect(nextSaveState("armed", "promoted")).toBe("saved");
  });

  it("re-arms from saved when the merchant changes", () => {
    // A corrected price makes the saved copy stale, so the GM must be able to
    // save again — FR-009's durability marker tracks the merchant, not the click.
    expect(nextSaveState("saved", "corrected")).toBe("armed");
    expect(nextSaveState("saved", "generated")).toBe("armed");
  });

  it("arms from the empty state on a generate or a restore", () => {
    expect(nextSaveState("unavailable", "generated")).toBe("armed");
    expect(nextSaveState("unavailable", "restored")).toBe("armed");
  });

  it("arms on an open, from every state that can be armed", () => {
    // Opening puts a merchant on screen, so the button has something to write —
    // exactly like a restore. It does NOT land on `saved`: no press has
    // happened, and `saved` is this module's word for "the last press
    // succeeded".
    expect(nextSaveState("unavailable", "opened")).toBe("armed");
    expect(nextSaveState("armed", "opened")).toBe("armed");
    expect(nextSaveState("saved", "opened")).toBe("armed");
  });

  it("leaves the button alone when the opened record is dropped — unless it was saved", () => {
    // `cleared-open` moves the id, not the state, for every state but one. The
    // merchant on screen is still there and still unsaved, so the button keeps
    // claiming what it claimed a moment ago.
    for (const state of SAVE_STATES) {
      if (state === "saved") continue;
      expect(nextSaveState(state, "cleared-open")).toBe(state);
    }

    // `saved` is the exception, and it is the whole point of the event. It
    // means "the record I wrote to is in the library"; once that record is
    // gone the claim is false. Staying `saved` left the button reading
    // "Zapisano" — and disabled — over a merchant nothing holds, with no way
    // back short of a reload.
    expect(nextSaveState("saved", "cleared-open")).toBe("armed");
  });

  it("answers unavailable for a value that is not in the contract at all", () => {
    // The casts are the point: this is the shape a caller who broke the
    // contract produces — a typo, or a value that reached here from JSON. The
    // old lookup returned `undefined` typed as `SaveState`, and the *next*
    // call indexed into it and threw inside a `setSession` updater, blanking
    // the page. It must answer, and it must answer with the state that offers
    // no press.
    expect(nextSaveState("armed", "promotd" as SaveEvent)).toBe("unavailable");
    expect(nextSaveState("nonsense" as SaveState, "generated")).toBe("unavailable");

    // And the answer is itself a valid state, so a second call cannot throw.
    const once = nextSaveState("armed", "promotd" as SaveEvent);
    expect(() => nextSaveState(once, "generated")).not.toThrow();
  });

  it("stands persistence down from any state", () => {
    for (const state of SAVE_STATES) {
      expect(nextSaveState(state, "persistence-off")).toBe("stood-down");
    }
  });

  it("never leaves stood-down", () => {
    // Absorbing on purpose: F-01 latches read-only for the rest of the page
    // load on `future-version`, so a later Generate must not re-arm a button
    // whose press cannot succeed.
    for (const event of SAVE_EVENTS) {
      expect(nextSaveState("stood-down", event)).toBe("stood-down");
    }
  });
});

describe("nextSaveSession", () => {
  const fresh: SaveSession = { state: "unavailable", openedSavedId: null };
  const open: SaveSession = { state: "armed", openedSavedId: "m-saved" };

  /** Every event, in the shape the reducer takes. */
  const everyEvent: SaveSessionEvent[] = SAVE_EVENTS.map((event) =>
    event === "opened" ? { event, savedId: "m-opened" } : { event },
  );

  it("records which saved merchant was opened", () => {
    const next = nextSaveSession(fresh, { event: "opened", savedId: "m-saved" });

    expect(next.openedSavedId).toBe("m-saved");
    expect(next.state).toBe("armed");
  });

  it("keeps the opened record through a correction and a save", () => {
    // The GM is still looking at that merchant, so a corrected price and the
    // in-place save that follows both write to the same record. Dropping the id
    // here would silently turn the next press back into an append.
    const corrected = nextSaveSession(open, { event: "corrected" });
    expect(corrected.openedSavedId).toBe("m-saved");

    const promoted = nextSaveSession(corrected, { event: "promoted" });
    expect(promoted.openedSavedId).toBe("m-saved");
    expect(promoted.state).toBe("saved");
  });

  it("leaves a failed in-place write armed, on the same record", () => {
    // S-03's rule, inherited unchanged: nothing was written, so the button must
    // still invite the retry — and the retry has to aim at the record the GM
    // has open, not append a copy of it.
    const failed = nextSaveSession(open, { event: "promote-failed" });

    expect(failed.state).toBe("armed");
    expect(failed.openedSavedId).toBe("m-saved");
  });

  it("clears the opened record on a fresh draw", () => {
    // The one that destroys data if it is wrong: a draw is no longer the opened
    // merchant, and an id that outlives it means the next press overwrites a
    // saved shop with a completely different one.
    const drawn = nextSaveSession(open, { event: "generated" });

    expect(drawn.openedSavedId).toBeNull();
    expect(drawn.state).toBe("armed");
  });

  it("clears the opened record on an explicit cleared-open", () => {
    expect(nextSaveSession(open, { event: "cleared-open" }).openedSavedId).toBeNull();
  });

  it("never invents an opened record", () => {
    // Only `opened` carries an id, so no other event can reach the in-place
    // branch from a session that has nothing open.
    for (const event of everyEvent) {
      if (event.event === "opened") continue;

      expect(nextSaveSession(fresh, event).openedSavedId).toBeNull();
    }
  });

  /**
   * The whole column, written out — not sampled.
   *
   * Every other test of the id here starts from `fresh`, whose id is already
   * `null`, so it cannot fail for a reducer that returns `current` *or* `null`.
   * What that hid was `restored`: it replaces the merchant on screen, so
   * keeping the id points the next autosave at a record the GM is no longer
   * looking at — and the suite was green with the bug both present and fixed.
   *
   * A `Record<SaveEvent, …>` literal rather than a loop with a `continue`: a
   * new event becomes a compile error here, and the skipped row is where the
   * bug lives (L-03 — the same shape the `saved` row of `nextSaveState` hid in).
   *
   * Looped over every state as well, because the id must not acquire an opinion
   * about the button: `nextOpenedSavedId` reads only the event.
   */
  it("answers for the opened record on every event, from every state", () => {
    const expected: Record<SaveEvent, string | null> = {
      generated: null,
      restored: null,
      "cleared-open": null,
      opened: "m-opened",
      corrected: "m-saved",
      promoted: "m-saved",
      "promote-failed": "m-saved",
      "persistence-off": "m-saved",
    };

    for (const state of SAVE_STATES) {
      for (const event of everyEvent) {
        expect(nextSaveSession({ state, openedSavedId: "m-saved" }, event).openedSavedId).toBe(expected[event.event]);
      }
    }
  });

  it("moves the state exactly as nextSaveState does", () => {
    // The pair reducer adds the id; it must not quietly acquire a second
    // opinion about the button.
    for (const state of SAVE_STATES) {
      for (const event of everyEvent) {
        expect(nextSaveSession({ state, openedSavedId: "m-saved" }, event).state).toBe(
          nextSaveState(state, event.event),
        );
      }
    }
  });

  it("answers for every event from every state", () => {
    const results = SAVE_STATES.flatMap((state) =>
      everyEvent.map((event) => nextSaveSession({ state, openedSavedId: null }, event)),
    );

    // The membership check is what does the work: a reducer with a hole yields
    // `undefined`, which is not in `SAVE_STATES`. The length is *not* an
    // independent guard — `flatMap` over the same two arrays makes it true by
    // construction, so it cannot fail under any mutation. It stays only to
    // catch a future refactor that stops iterating both lists.
    expect(results).toHaveLength(SAVE_STATES.length * SAVE_EVENTS.length);
    for (const result of results) {
      expect(SAVE_STATES).toContain(result.state);
    }
  });
});

describe("openedSavedIdFor", () => {
  const opened = merchant({ id: "m-kowal", savedAt: "2026-09-12T10:00:00.000Z" });

  function documentOf(transient: Merchant | null, saved: Merchant[]): StorageDocument {
    return { schemaVersion: SCHEMA_VERSION, transient, saved };
  }

  it("answers null when there is no transient record", () => {
    expect(openedSavedIdFor(documentOf(null, [opened]))).toBeNull();
  });

  it("answers null for a freshly drawn merchant", () => {
    // The ordinary case: a draw mints an id nothing else shares, so nothing is
    // open and corrections have no library record to flow into.
    expect(openedSavedIdFor(documentOf(merchant({ id: "m-fresh" }), [opened]))).toBeNull();
  });

  it("answers null when the library is empty", () => {
    expect(openedSavedIdFor(documentOf(merchant({ id: "m-fresh" }), []))).toBeNull();
  });

  it("recognises a transient that came from a saved record", () => {
    // What `openMerchant` leaves behind: the transient carries the saved
    // record's own id. That shared id is the entire link — no stored field.
    const transient = merchant({ id: "m-kowal", savedAt: null });

    expect(openedSavedIdFor(documentOf(transient, [opened]))).toBe("m-kowal");
  });

  it("declines a record whose stored corrections have fallen behind the slot", () => {
    // A correction writes the transient slot first and the library record
    // second. When the second write fails, the slot carries work the record
    // does not. In-session `autosaveFailed` tracks that; nothing persists it,
    // so after a reload this divergence is the only evidence left. Reporting
    // the record as open here would stand the discard guard down over the only
    // copy of that work which exists.
    const transient = merchant({
      id: "m-kowal",
      savedAt: null,
      corrections: { longsword: { priceGp: 25 } },
    });
    const stale = merchant({ id: "m-kowal", savedAt: "2026-09-12T10:00:00.000Z", corrections: {} });

    expect(openedSavedIdFor(documentOf(transient, [stale]))).toBeNull();
  });

  it("recognises a record holding exactly the same work", () => {
    // The landed-write case, which must NOT read as divergence: an identical
    // overlay on both sides. A false negative here fires the discard dialog
    // over work that is perfectly safe — the cry-wolf failure the guard exists
    // to avoid.
    const corrections = { longsword: { priceGp: 25, quantity: 2 } };
    const transient = merchant({ id: "m-kowal", savedAt: null, corrections });
    const record = merchant({ id: "m-kowal", savedAt: "2026-09-12T10:00:00.000Z", corrections });

    expect(openedSavedIdFor(documentOf(transient, [record]))).toBe("m-kowal");
  });

  it("declines a record whose rows no longer match the slot", () => {
    const transient = merchant({ id: "m-kowal", savedAt: null, rows: [] });

    expect(openedSavedIdFor(documentOf(transient, [opened]))).toBeNull();
  });

  it("finds the record among several", () => {
    const others = [merchant({ id: "m-a" }), opened, merchant({ id: "m-b" })];

    expect(openedSavedIdFor(documentOf(merchant({ id: "m-kowal" }), others))).toBe("m-kowal");
  });

  it("treats a document straight out of promoteTransient as unlinked", () => {
    // The state the promote path has to repair. `promoteTransient` appends the
    // copy under a FRESH id and leaves the transient on the old one, so nothing
    // links them — which is why `addMerchant` rewrites the transient afterwards.
    //
    // **This test cannot see whether promote still mints**, and used to claim it
    // could. Both merchants below are literals chosen here, so it never executes
    // a line of `merchant-storage.ts`: it would have stayed green on a promote
    // that reused the transient's id, while `openedSavedIdFor` silently became
    // unsound. What it does pin is this function's own rule — two different ids
    // do not link — which is worth a test on its own.
    //
    // The cross-module invariant is pinned where the storage fake and the
    // read-only latch reset already live: see "promoteTransient ↔
    // openedSavedIdFor" in `merchant-storage.test.ts`.
    const transient = merchant({ id: "m-old" });
    const promotedCopy = merchant({ id: "m-new", savedAt: "2026-09-12T10:00:00.000Z" });

    expect(openedSavedIdFor(documentOf(transient, [promotedCopy]))).toBeNull();
  });
});

describe("wouldLoseCorrections", () => {
  it("is true only when corrections live nowhere but the screen", () => {
    // The one case the dialog exists for: hand edits on a merchant that is not
    // in the library, so a draw or an open really does destroy them.
    expect(wouldLoseCorrections(true, null)).toBe(true);
  });

  it("is false while a saved record is open", () => {
    // The lie this replaces. An open record auto-saves every correction, so
    // nothing is lost by replacing what is on screen — and a warning that cries
    // wolf trains the GM to dismiss the one that matters.
    expect(wouldLoseCorrections(true, "m-saved")).toBe(false);
  });

  it("is false when there are no corrections at all", () => {
    expect(wouldLoseCorrections(false, null)).toBe(false);
    expect(wouldLoseCorrections(false, "m-saved")).toBe(false);
  });
});
