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
   * Graduated from the quarantine ledger on 2026-09-14, the same day it was
   * parked — the lifecycle §6.3 is built for.
   *
   * The defect: "Stwórz" painted no focus indicator a GM could see. The shadcn
   * button base sets `outline-none` and substitutes
   * `focus-visible:ring-ring/50 focus-visible:ring-[3px]`, which resolves to a
   * transparent shadow with no spread — 1.2:1 against a 3:1 floor. The fix
   * states the outline at the call site; see the comment there for why
   * `outline-solid` is the part that matters.
   *
   * Kept as an ordinary test rather than deleted: it is now the regression
   * guard for a control whose focus ring comes from a component the project
   * treats as upstream, so a future `Button` change can silently take it away
   * again.
   */
  test("the primary action shows a focus indicator meeting the 3:1 floor", async ({ page }) => {
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
