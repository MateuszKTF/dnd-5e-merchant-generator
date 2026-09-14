import { expect, test } from "@playwright/test";

import {
  generateAssortment,
  gotoHydrated,
  itemIdFor,
  priceField,
  reloadHydrated,
  storedCorrection,
} from "./helpers/app";

/**
 * Phase 2's browser-level slice — the part of Risks #2 and #3 that jsdom cannot
 * exercise honestly (test plan §6.2). The persist function, the correction
 * merge and the guard's condition are all proven far more cheaply in Vitest;
 * what is left here is the two lifecycle mechanisms jsdom does not implement.
 *
 * Seeded from `seed.spec.ts`.
 */

test.describe("Risk #2 — work survives the tab going away", () => {
  /**
   * The loss window the test plan names as the *real* one: "a cell draft that
   * was typed but never committed, on a phone whose OS kills the tab."
   *
   * `PriceQuantityCell` commits on blur, and a reload from inside the field
   * fires no blur — so `MerchantGenerator` blurs the active element from a
   * lifecycle effect, running the existing commit path rather than a second
   * one. jsdom fires neither `pagehide` nor `visibilitychange`, so that effect
   * is unreachable from the `dom` project and this test is the only thing
   * standing between it and silent deletion.
   *
   * **Scope, established by deliberate break, not by reading the source:** this
   * covers the commit *path*, not one listener. Removing only the `pagehide`
   * listener leaves the test green, because Chromium also fires
   * `visibilitychange` → hidden on navigation and the effect's other half
   * catches it. Removing the whole effect turns it red. Do not rewrite this as
   * "the pagehide test" — it does not distinguish the two, and pretending
   * otherwise is the L-04 shape.
   *
   * The premise guard below is what keeps the assertion honest. Without it,
   * this would also pass if the edit had already been committed earlier —
   * proving nothing about the lifecycle path at all.
   */
  test("a price typed but never blurred is still there after a reload", async ({ page }) => {
    await gotoHydrated(page);
    const item = await generateAssortment(page);

    const itemId = await itemIdFor(page, item);
    const price = priceField(page, item);
    const original = await price.inputValue();
    const corrected = String(Number(original) + 111);

    await price.fill(corrected);

    // Premise: the edit is genuinely uncommitted. The field still holds focus,
    // so no blur has fired, and the corrections overlay — where a committed
    // edit lands — is still empty for this item. Checking `rows` instead would
    // be decorative: corrections never mutate `rows`, so that assertion reads
    // "uncommitted" whether or not the commit happened (lessons L-03).
    await expect(price).toBeFocused();
    expect(await storedCorrection(page, itemId)).toBeUndefined();

    // Navigating away fires `pagehide`, which is the GM's tab being closed or
    // killed. `localStorage` writes synchronously, so the commit lands first.
    await reloadHydrated(page);

    await expect(priceField(page, item)).toHaveValue(corrected);
  });
});

test.describe("Risk #3 — corrections are not discarded without an answer", () => {
  /**
   * The guard's *condition* is unit-testable and belongs in Vitest. What cannot
   * go there is the dialog itself: `ConfirmDialog` is built on the native
   * `<dialog>` element and relies on `showModal()`, Escape firing a `cancel`
   * event, and focus landing inside the panel. jsdom does not implement
   * `HTMLDialogElement` — the setup file stubs `open` and nothing else — so
   * every one of those behaviours is invisible to the `dom` project.
   *
   * Escape specifically is the path most likely to rot: it fires `cancel` on
   * the element, entirely separately from the Cancel button's click handler.
   * Wiring only the button would leave the dialog closed while React still
   * believed it was open, which reads to the GM as "Stwórz stopped working".
   */
  test("regenerating over corrections asks first, and cancelling keeps them", async ({ page }) => {
    await gotoHydrated(page);
    const item = await generateAssortment(page);

    const itemId = await itemIdFor(page, item);
    const price = priceField(page, item);
    const corrected = String(Number(await price.inputValue()) + 111);
    await price.fill(corrected);
    await price.blur();

    // Premise: a correction really exists and is committed, so the guard has
    // something to guard. Without this the dialog assertion below could pass
    // against a build where corrections are never recorded at all.
    await expect.poll(async () => (await storedCorrection(page, itemId))?.priceGp).toBe(Number(corrected));

    await page.getByRole("button", { name: "Stwórz" }).click();

    // The requirement is that the GM is asked before losing the correction —
    // not that any particular sentence appears. Assert the dialog is really
    // modal, and that it offers a way out, without pinning the copy.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Anuluj" })).toBeFocused();

    // Escape, not the Cancel button: the separate code path.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // Cancelling means the assortment and the correction both survive.
    await expect(priceField(page, item)).toHaveValue(corrected);

    // And the guard is still armed — a dialog that only works once is the
    // "permanently un-openable gate" `ConfirmDialog`'s own comments warn about.
    await page.getByRole("button", { name: "Stwórz" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});
