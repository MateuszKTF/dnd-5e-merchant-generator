import { expect, test } from "@playwright/test";

import { generateAssortment, gotoHydrated } from "./helpers/app";

/**
 * Phase 5 — the project's only NFR, on the one screen a GM actually uses at the
 * table. Runs in the `phone` project at 320px, the narrowest viewport still in
 * real use.
 *
 * Protects: test-plan.md Risk #7 ("the page scrolls sideways on a phone at the
 * table"). Phase 1 research narrowed this to the footer rather than the table —
 * the licence paragraph carries a bare 50-character URL that cannot be broken
 * at a space — so the assertion covers the whole document rather than one
 * component, and reports which element overflowed when it fails.
 *
 * This is deliberately *not* a pixel snapshot. The test plan names
 * "pixel snapshots of a Tailwind-styled table" as the anti-pattern to avoid for
 * this risk — constant breakage, no signal. A geometry assertion has no
 * baseline to churn: it stays green through any restyle that keeps the page
 * readable, and only goes red when it genuinely scrolls sideways.
 */
test("the merchant screen does not scroll sideways on a 320px phone", async ({ page }) => {
  await gotoHydrated(page);
  await generateAssortment(page);

  // Premise (lessons L-03): a full assortment is on screen. "No overflow" is
  // trivially true of an empty page, so without this the test would stay green
  // if generation broke entirely — the L-04 shape, a gate covering nothing.
  const rowCount = await page.getByRole("row").count();
  expect(rowCount).toBeGreaterThan(5);

  const overflow = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const offenders: { tag: string; reason: string; text: string; by: number }[] = [];

    for (const element of document.querySelectorAll("body *")) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const describe = (): string => element.textContent.trim().slice(0, 60);

      // (a) The box itself sticks out. Half a pixel of slack, because sub-pixel
      //     layout rounding is not sideways scroll.
      if (rect.right > limit + 0.5 || rect.left < -0.5) {
        offenders.push({
          tag: element.tagName.toLowerCase(),
          reason: "box extends past the viewport",
          text: describe(),
          by: Math.round(rect.right - limit),
        });
        continue;
      }

      // (b) The box fits but its *content* does not. This is the case that
      //     actually bites here and the one a bounding-rect check cannot see:
      //     overflowing inline text does not grow its parent's border box, so
      //     an unbreakable 292px URL inside a 288px paragraph leaves every
      //     rect looking correct while the document scrolls sideways. Skipping
      //     deliberately scrollable boxes keeps a table with its own
      //     `overflow-x: auto` from being reported as a page-level defect.
      const style = window.getComputedStyle(element);
      if (style.overflowX !== "visible") continue;
      if (element.scrollWidth > element.clientWidth + 1) {
        offenders.push({
          tag: element.tagName.toLowerCase(),
          reason: "content is wider than the element",
          text: describe(),
          by: element.scrollWidth - element.clientWidth,
        });
      }
    }

    return {
      viewportWidth: limit,
      documentWidth: document.documentElement.scrollWidth,
      // Only the outermost offender of each subtree is worth reporting.
      offenders: offenders.slice(0, 5),
    };
  });

  // Diagnostic first, on purpose. Both assertions describe the same defect, but
  // this one names the element and the aggregate below only says "too wide" —
  // and whichever fails first is all CI prints. Asserting the width first is
  // exactly how the real footer regression reached this suite as an
  // unactionable "Expected <= 320, Received 349".
  expect(overflow.offenders, "elements whose content escapes the viewport").toEqual([]);

  // The user-visible outcome: no horizontal scrollbar. Kept as a backstop for
  // any overflow the per-element sweep above fails to attribute.
  expect(overflow.documentWidth, "document is wider than the 320px viewport").toBeLessThanOrEqual(
    overflow.viewportWidth,
  );
});

/**
 * The 44px target floor from AGENTS.md, on the controls a GM taps at the table.
 * Phase 1 research found this already enforced everywhere, so this is a
 * regression guard rather than a hunt — cheap, and it pins a property that a
 * single `size="sm"` would silently undo.
 */
test("every control on the merchant screen meets the 44px tap target", async ({ page }) => {
  await gotoHydrated(page);
  await generateAssortment(page);

  const undersized = await page.evaluate(() => {
    const FLOOR = 44;
    const results: { label: string; height: number }[] = [];

    for (const element of document.querySelectorAll("button, select, input, a[href]")) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      // Inline links inside a paragraph of prose are exempt: WCAG's target-size
      // rule excludes targets in a sentence, and the footer licence text is one.
      if (element.tagName === "A" && element.closest("footer") !== null) continue;
      if (rect.height + 0.5 < FLOOR) {
        // Named the way the failure message should read: the accessible name if
        // there is one, else the visible text, else at least the tag.
        const ariaLabel = element.getAttribute("aria-label");
        const text = element.textContent.trim();
        results.push({
          label: (ariaLabel ?? (text.length > 0 ? text : element.tagName)).slice(0, 40),
          height: Math.round(rect.height),
        });
      }
    }
    return results;
  });

  expect(undersized, "controls below the 44px tap-target floor").toEqual([]);
});
