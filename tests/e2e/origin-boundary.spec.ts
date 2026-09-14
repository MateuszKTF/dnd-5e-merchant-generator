import { expect, test } from "@playwright/test";

import { generateAssortment, gotoHydrated } from "./helpers/app";

/**
 * Phase 4's browser-observable residue.
 *
 * Read the scope note first, because this test is easy to over-credit. Phase 4
 * is quality-gates wiring — coverage thresholds, a lint warning budget,
 * `scripts/**` lint coverage, the a11y scope correction. None of that is
 * browser-level, and none of it is tested here; it belongs to
 * `/10x-implement`.
 *
 * The one Phase 4 item with an observable runtime consequence is the
 * client-bundle dependency assertion. **The static post-build check remains the
 * primary gate** — grepping `dist/client/` is cheaper, runs without a browser,
 * and is what §5 specifies. This asserts the same boundary from the other side,
 * against the app as actually served and executed, which catches the two things
 * a static grep cannot see: a dependency pulled in at runtime, and any call to
 * an origin the built output never mentions.
 *
 * It also pins a real product property in its own right. v1 is a single
 * prerendered view with browser-local state, and AGENTS.md forbids wiring
 * Supabase; "this page talks to nobody" is that promise, stated as a test.
 */
test("the running app talks to no origin but its own", async ({ page }) => {
  const foreign: string[] = [];

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.protocol.startsWith("http")) return;
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return;
    foreign.push(request.url());
  });

  await gotoHydrated(page);

  // Premise (lessons L-03): the listener is really attached to a page that did
  // real work. A request log that is empty because nothing was exercised proves
  // nothing — so drive the one flow the product has, end to end.
  await generateAssortment(page);
  await expect(page.getByRole("region", { name: "Asortyment kupca" })).toBeVisible();

  expect(foreign, "the client reached a third-party origin").toEqual([]);
});

/**
 * The credential exposure §5 actually cares about. `SUPABASE_URL` and
 * `SUPABASE_KEY` are declared `context: "server"` + `access: "secret"`, which
 * Astro refuses to inline into client output — this asserts that classification
 * is *preserved*, which §5 names as the gate's real job, rather than hunting a
 * leak that does not currently exist.
 */
test("no Supabase client or credential reaches the browser", async ({ page }) => {
  await gotoHydrated(page);

  const exposure = await page.evaluate(() => {
    const globals = Object.keys(globalThis).filter((key) => /supabase/i.test(key));
    const inlineScripts = [...document.querySelectorAll("script:not([src])")]
      .map((script) => script.textContent)
      .filter((source) => /supabase|SUPABASE_KEY|SUPABASE_URL/i.test(source));
    return { globals, inlineScriptHits: inlineScripts.length };
  });

  expect(exposure.globals, "a Supabase client was exposed on the page").toEqual([]);
  expect(exposure.inlineScriptHits, "a Supabase reference was inlined into the served HTML").toBe(0);
});
