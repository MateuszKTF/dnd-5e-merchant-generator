import { expect, test } from "@playwright/test";

import { exhaustLocalStorage, generateAssortment, gotoHydrated, noticeTexts, storedTransient } from "./helpers/app";

/**
 * Phase 1's browser-level residue — Risk #1, "a merchant write fails and the
 * interface reports success anyway".
 *
 * Phase 1 closed this at the component layer, and that is the right place for
 * the mapping: it is a pure function of props, so integration buys nothing.
 * What the `dom` project cannot buy is the *premise*. It models a full store by
 * making `Storage.prototype.setItem` throw a synthetic `QuotaExceededError`,
 * which proves the handler maps that error correctly while taking on trust that
 * a real browser out of space throws that error, at that call, in that shape.
 *
 * That assumption is the one thing only a real browser can settle, and it is
 * the assumption lessons L-05 warns about — "the storage module is tested,
 * therefore the reporting is". This exhausts the actual quota instead.
 */
test.describe("Risk #1 — a failed write is never reported as a success", () => {
  test("a merchant that could not be stored says so, and is not silently kept", async ({ page }) => {
    await gotoHydrated(page);

    // Premise 1: nothing is wrong yet, so the notice below cannot be something
    // this page always shows. Without this the test would pass against a build
    // that displays the storage warning unconditionally.
    expect(await noticeTexts(page)).toEqual([]);

    const { isFull } = await exhaustLocalStorage(page);

    // Premise 2: the store really is full. If a gap were left, the write under
    // test would succeed and the assertions below would prove nothing.
    expect(isFull, "localStorage was not actually exhausted").toBe(true);

    await generateAssortment(page);

    // The requirement, from the PRD guardrail rather than from the component:
    // the GM is told. Not *which* words — any wording, including wording that
    // says the opposite, would satisfy a string comparison lifted from the
    // component under test.
    const notices = await noticeTexts(page);
    expect(notices.length, "a failed write produced no visible notice").toBeGreaterThan(0);

    // And the other half of "never reported as a success": nothing was kept.
    // A notice plus a phantom saved merchant would still lose the GM's work.
    expect(await storedTransient(page)).toBeNull();
  });

  /**
   * The remedy the notice itself recommends has to be reachable. Phase 1 found
   * this exact class of defect at the component layer — a message telling the
   * GM to do something that could not then be done — so the instruction is
   * re-checked here against a real store rather than a stubbed one.
   */
  test("freeing space makes saving work again", async ({ page }) => {
    await gotoHydrated(page);
    const { isFull } = await exhaustLocalStorage(page);
    expect(isFull).toBe(true);

    await generateAssortment(page);
    expect(await noticeTexts(page)).not.toEqual([]);
    expect(await storedTransient(page)).toBeNull();

    // The GM follows the advice and frees space.
    await page.evaluate(() => {
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("e2e-filler-")) window.localStorage.removeItem(key);
      }
    });

    await page.getByRole("button", { name: "Stwórz" }).click();

    // The write now lands, and the stale failure notice does not outlive it.
    await expect.poll(async () => (await storedTransient(page))?.rows.length ?? 0).toBeGreaterThan(0);
    await expect.poll(async () => noticeTexts(page)).toEqual([]);
  });
});
