import { expect, test } from "@playwright/test";

import { generateAssortment, gotoHydrated, priceField, reloadHydrated, storedTransient } from "./helpers/app";

/**
 * SEED TEST — the exemplar every other spec in this directory is modelled on.
 *
 * Protects: test-plan.md Risk #2 (the last generated merchant is not
 * auto-persisted, and the GM reopens to stale or empty state).
 *
 * What you show is what you get, so this file deliberately demonstrates the
 * five patterns the rest of the suite must inherit — see `E2E_RULES.md`:
 *
 *   1. Role-based locators only. `getByRole("button", { name: "Stwórz" })`,
 *      never a CSS class. The accessible names are Polish because the interface
 *      is; that is what a GM and a screen reader both see.
 *   2. Wait for state, never for time. `gotoHydrated` waits for the island to
 *      hydrate; assertions use web-first `expect(...)`. There is no
 *      `waitForTimeout` anywhere in this directory.
 *   3. Independently runnable. Playwright gives every test a fresh browser
 *      context, so `localStorage` starts empty and nothing carries over. The
 *      test asserts that premise instead of assuming it.
 *   4. Premise guards (lessons L-03 / L-04). Before asserting that a value
 *      survived, prove it was there to survive — a round-trip test that never
 *      wrote anything passes for the wrong reason.
 *   5. Named for the risk, not numbered.
 *
 * Cleanup: none needed. State lives only in this context's `localStorage`, and
 * the context is discarded at the end of the test. Anything that reached a
 * shared store would have to be torn down in `afterEach`.
 */
test("a generated merchant is still there after the GM reopens the tab", async ({ page }) => {
  await gotoHydrated(page);

  // Premise: this context really is starting from nothing, so a merchant found
  // after the reload can only have come from this test's own write.
  expect(await storedTransient(page)).toBeNull();

  const item = await generateAssortment(page);
  const priceBeforeReload = await priceField(page, item).inputValue();

  // Premise: the merchant reached storage before we test that it comes back.
  await expect.poll(async () => (await storedTransient(page))?.rows.length ?? 0).toBeGreaterThan(0);

  // Closing and reopening the tab, with no explicit "save" in between — the
  // exact sequence Risk #2 describes.
  await reloadHydrated(page);

  await expect(page.getByRole("region", { name: "Asortyment kupca" })).toBeVisible();
  await expect(priceField(page, item)).toHaveValue(priceBeforeReload);
});
