import { expect, test } from "@playwright/test";

import { gotoHydrated } from "./helpers/app";
import { focusIndicatorContrast } from "./helpers/focus-contrast";

/**
 * Phase 5 — the other half of Risk #7: "a GM cannot see which control they are
 * on."
 *
 * AGENTS.md §Style sets a 3:1 contrast floor, which is also WCAG 2.4.11's
 * threshold for a focus indicator. Nothing enforces it today: the
 * `astro/jsx-a11y/*` rules are configured for `.tsx` at error severity and
 * every one of them returns an empty visitor on a non-Astro file, so the gate
 * is inert rather than narrow (lessons L-04). A compiler cannot see a contrast
 * ratio and jsdom has no paint engine, so this assertion has nowhere else to
 * live.
 */

/** AGENTS.md §Style, and WCAG 2.4.11 for non-text contrast. */
const CONTRAST_FLOOR = 3;

test.describe("Risk #7 — keyboard focus is visible", () => {
  /**
   * PARKED — see the ledger in `src/quarantine.test.ts`.
   *
   * Defect: the primary action "Stwórz" paints no usable focus indicator. The
   * shadcn button base sets `outline-none` and replaces the UA ring with
   * `focus-visible:ring-ring/50 focus-visible:ring-[3px]`; the ring resolves to
   * a transparent shadow with no spread, so keyboard focus changes almost
   * nothing on screen. Measured at **1.06:1** against a 3:1 floor — the GM
   * tabbing to the generate button cannot tell they are on it.
   *
   * This is the same finding Phase 1 research recorded as "roughly 1.3:1",
   * confirmed here by measurement rather than by reading the stylesheet.
   *
   * The assertion below is written for the requirement and then parked, never
   * weakened to pass: `test.fail()` runs it and keeps the suite green while the
   * defect stands, and turns red the moment someone fixes it — at which point
   * this entry is retired and the ledger count goes back down.
   *
   * Fix belongs with the accessibility-scope correction in test plan §3 Phase 4,
   * which is where the inert a11y gate is repaired.
   */
  test.fail("the primary action shows a focus indicator meeting the 3:1 floor", async ({ page }) => {
    await gotoHydrated(page);

    const contrast = await focusIndicatorContrast(page, page.getByRole("button", { name: "Stwórz" }));

    expect(contrast).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
  });

  /**
   * The controls that do pass, pinned so a refactor onto the shared button
   * variant cannot quietly drag them down to the same 1.06:1. Without this the
   * suite would record only the broken control, and fixing it would leave
   * nothing asserting the floor at all.
   *
   * The library toggle declares its own `focus-visible:outline-neutral-800`;
   * the selects keep the UA's `outline-style: auto`, which Chromium paints as
   * its own high-contrast ring.
   */
  for (const control of [
    { name: "the saved-merchants toggle", role: "button" as const, accessibleName: /Zapisani kupcy/ },
    { name: "the category select", role: "combobox" as const, accessibleName: "Kategoria" },
    { name: "the wealth select", role: "combobox" as const, accessibleName: "Zamożność osady" },
  ]) {
    test(`${control.name} shows a focus indicator meeting the 3:1 floor`, async ({ page }) => {
      await gotoHydrated(page);

      const contrast = await focusIndicatorContrast(
        page,
        page.getByRole(control.role, { name: control.accessibleName }),
      );

      expect(contrast).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
    });
  }
});
