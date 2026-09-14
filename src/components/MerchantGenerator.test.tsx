import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MerchantGenerator from "@/components/MerchantGenerator";
import { resetReadOnlyLatch, SCHEMA_VERSION, STORAGE_KEY } from "@/lib/merchant-storage";

/**
 * Risk #1: a failed write reported as success.
 *
 * Oracle throughout is the PRD guardrail — *"zapisany kupiec nigdy nie znika po
 * cichu"* — read at the layer where it can actually be broken. The storage
 * module's half is already covered by 400-odd node tests; what was never
 * reachable is whether any of that survives the trip to the screen.
 *
 * **No assertion here compares against a message string from `StorageNotice`.**
 * Copying the Polish copy out of the component and asserting it back would be an
 * implementation mirror: green for any wording, including wording that says the
 * opposite. What the GM actually needs is weaker and more durable — *something*
 * is said, and different failures do not say the same thing. That is what is
 * asserted.
 *
 * Storage is driven through `Storage.prototype`, not through a fake, because the
 * component calls `readDocument()` / `putTransient()` with no argument and has
 * no injection seam. That is a fact about the component, not a shortcut.
 */

const QUOTA = () => new DOMException("quota", "QuotaExceededError");
const REFUSED = () => new DOMException("refused", "SecurityError");

function emptyDocument(): string {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, transient: null, saved: [] });
}

describe("Risk #1 — a write that did not land must not look like one that did", () => {
  /** Make every `setItem` throw — a full store, or one that refuses writes. */
  function setItemThrows(error: () => DOMException): void {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw error();
    });
  }

  /** Make `setItem` succeed and store nothing: a store that accepts a write and drops it. */
  function setItemSwallows(): void {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => undefined);
  }

  /** Serve fixed bytes under the main key, as if another tab had written them. */
  function getItemServes(bytes: string): void {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((key: string) => (key === STORAGE_KEY ? bytes : null));
  }

  beforeEach(() => {
    // The latch is module state and Vitest isolates per file, not per test — so
    // a test that latches would otherwise refuse every write in every test after
    // it in this file.
    resetReadOnlyLatch();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Mount, generate an assortment while storage still works, and hand back the user-event driver. */
  async function generated() {
    const user = userEvent.setup();
    render(<MerchantGenerator />);
    await user.click(screen.getByRole("button", { name: "Stwórz" }));

    return user;
  }

  /** Every message currently on screen, as text — never compared to component copy. */
  function noticeText(): string {
    return screen
      .getAllByRole("status")
      .map((region) => region.textContent)
      .join(" ")
      .trim();
  }

  /**
   * Just the storage notice, separated from the two `sr-only` announcement
   * regions. `StorageNotice` renders a `<div role="status">`; the announcements
   * are `<p role="status">`. The distinction matters because one of them tells
   * the GM to go and read the other.
   */
  function storageNoticeText(): string {
    return screen
      .getAllByRole("status")
      .filter((region) => region.tagName === "DIV")
      .map((region) => region.textContent)
      .join(" ")
      .trim();
  }

  it("says something when the save is refused for want of space", async () => {
    const user = await generated();

    setItemThrows(QUOTA);
    await user.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(noticeText().length).toBeGreaterThan(0);
  });

  it("says something different when the store refuses writes outright", async () => {
    // Distinguishability is the requirement: the two failures need different
    // recovery actions from the GM, so telling them apart has to be possible.
    async function messageAfterFailedSave(fail: () => DOMException): Promise<string> {
      resetReadOnlyLatch();
      window.localStorage.clear();
      const user = await generated();

      setItemThrows(fail);
      await user.click(screen.getByRole("button", { name: "Zapisz" }));
      const message = noticeText();

      // Each run needs its own clean DOM: cleanup is registered afterEach, and
      // this test renders twice.
      cleanup();
      vi.restoreAllMocks();

      return message;
    }

    const quotaMessage = await messageAfterFailedSave(QUOTA);
    const refusedMessage = await messageAfterFailedSave(REFUSED);

    expect(quotaMessage.length).toBeGreaterThan(0);
    expect(refusedMessage.length).toBeGreaterThan(0);
    expect(refusedMessage).not.toBe(quotaMessage);
  });

  it("never reads Zapisano after a save that did not land", async () => {
    // The guardrail at its sharpest. `nextSaveState` already guarantees this as
    // a table in the node suite; nothing guaranteed the component renders it.
    const user = await generated();

    setItemThrows(QUOTA);
    await user.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(screen.queryByRole("button", { name: "Zapisano" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeInTheDocument();
  });

  it("keeps the spoken confirmation silent when the save did not land", async () => {
    // The sr-only region is the only confirmation a screen-reader user gets, and
    // it is gated on the same state as the button. Both or neither.
    const user = await generated();

    setItemThrows(REFUSED);
    await user.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(noticeText()).not.toContain("Kupiec zapisany");
  });

  it("says something when a write is refused because the latch engaged", async () => {
    // A newer build's document appears under the key between generating and
    // saving. `loadForWrite` reads it, latches, and answers `read-only` — a
    // write failure whose cause is a *read*, which is the case a flat mapping
    // to `null` used to swallow.
    const user = await generated();

    const future = JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, transient: null, saved: [] });
    getItemServes(future);

    await user.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(noticeText().length).toBeGreaterThan(0);
  });

  /**
   * The last Risk #1 defect, and the one that closed it.
   *
   * A store that accepts a write and drops it leaves the transient slot empty,
   * so the promote answers `not-found`. That used to map to no condition at all:
   * nothing rendered, while the assistive announcement told the GM to read a
   * storage message that was never shown. Net visible change for a sighted GM
   * was zero — the guardrail failing at the reporting layer rather than the
   * storage layer.
   *
   * Was parked here with `it.fails` and graduated the moment it was fixed, which
   * is what that mechanism is for: a skipped test never executes and rots
   * silently (lessons L-03), while a failing-on-purpose one turns red when the
   * defect goes and forces its own retirement.
   *
   * NOTE: an earlier draft asserted only that the notice *text changed*, and
   * passed while the defect stood. It measured a proxy. The requirement is that
   * an instruction the product gives the GM can actually be followed — which is
   * what the two assertions below say, in that order.
   */
  it("points the GM at a storage message that exists", async () => {
    const user = await generated();

    setItemSwallows();
    getItemServes(emptyDocument());

    await user.click(screen.getByRole("button", { name: "Zapisz" }));

    // The spoken announcement sends the GM to the storage notice…
    expect(noticeText()).toContain("komunikat o pamięci");
    // …so the storage notice has to be saying something.
    expect(storageNoticeText().length).toBeGreaterThan(0);
  });

  it("says something when the promote finds no transient to promote", async () => {
    // The mute path. `setItem` succeeds and stores nothing — a store that
    // accepts a write and drops it, which no fake in the node suite can model.
    // The auto-persist therefore raises no notice (it "succeeded"), and the
    // promote that follows finds an empty slot and answers `not-found`, which
    // maps to no condition at all. Net DOM change: nothing.
    //
    // The component's own comment argues `not-found` needs no notice because
    // "that failure raised its own notice at the time". This is the case where
    // it did not.
    const user = await generated();

    setItemSwallows();
    getItemServes(emptyDocument());

    const before = noticeText();
    await user.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(noticeText()).not.toBe(before);
  });
});
