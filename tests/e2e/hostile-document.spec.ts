import { expect, test, type Page } from "@playwright/test";

import { STORAGE_KEY, noticeTexts } from "./helpers/app";

/**
 * Phase 3's browser-level residue — Risks #5 and #6.
 *
 * The parse boundary itself is unit work and belongs in Vitest with hostile
 * fixtures; that is cheaper and can cover far more shapes than this ever
 * should. What a unit test cannot answer is what the *GM* experiences when the
 * document is already broken at page load: a parser returning a clean
 * discriminated union is worth nothing if the app then mounts to a blank screen
 * or throws past the error boundary on the way to rendering the notice.
 *
 * So these drive the whole mount path — real storage, real hydration, real
 * island — and assert the user-visible outcome. Risk #5's wording is exactly
 * this: "read and silently discarded, so the GM's merchants vanish with nothing
 * said."
 *
 * Every fixture is hand-authored. Generating them with the serializer under
 * test is the anti-pattern the test plan names for this risk — such fixtures
 * can only ever prove self-consistency, never that foreign bytes are survived.
 */

/** Seed a document *before* the app's first read, the way a GM would find it. */
async function loadWithStoredDocument(page: Page, document: string): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [STORAGE_KEY, document] as const,
  );
  await page.goto("/");
  await page.locator("astro-island:not([ssr])").waitFor();
}

const UNREADABLE = [
  { label: "malformed JSON", document: "{{{not json" },
  { label: "truncated mid-array", document: '{"schemaVersion":1,"transient":{"id":"x","rows":[' },
  { label: "another application's document", document: '{"someOtherApp":true,"data":[1,2,3]}' },
  { label: "hand-edited to the wrong shape", document: '{"schemaVersion":1,"transient":{"rows":"not-an-array"}}' },
  { label: "empty string", document: "" },
] as const;

test.describe("Risk #5 — an unreadable document is never discarded in silence", () => {
  for (const { label, document } of UNREADABLE) {
    test(`${label}: the app still works and says something happened`, async ({ page }) => {
      const crashes: string[] = [];
      page.on("pageerror", (error) => crashes.push(error.message));

      await loadWithStoredDocument(page, document);

      // 1. Nothing escaped as an uncaught throw. AGENTS.md's hard rule is that
      //    an expected failure returns a discriminated union; a page error here
      //    means something threw on the read path instead.
      expect(crashes, "uncaught error while reading a hostile document").toEqual([]);

      // 2. The GM is told. This is the half of Risk #5 that survived Phase 1
      //    research — the silent discard, not the throw. Polled rather than
      //    sampled once: the notice is React state set during mount, so a
      //    single read right after hydration races the render that shows it.
      await expect
        .poll(async () => noticeTexts(page), { message: "a hostile document was read with nothing said" })
        .not.toEqual([]);

      // 3. And the product is still usable — degrading explicitly means the GM
      //    can carry on, not that they get a notice on a dead page.
      await expect(page.getByRole("button", { name: "Stwórz" })).toBeEnabled();
    });
  }

  /**
   * The requirement is not merely that *a* notice appears — it is that the GM
   * can tell one failure from another and act on it. Asserting that here rather
   * than in a per-fixture test is deliberate: the two failures have to be
   * compared, and neither string may be pinned (assert the requirement, not the
   * copy).
   */
  test("an unreadable document and a too-new document say different things", async ({ browser }) => {
    // Waits for the notice rather than sampling once — it is React state set
    // during mount, and the version latch in particular lands a tick after
    // hydration. The wait doubles as the premise guard: if either failure
    // produced no notice at all, "they differ" would be comparing two empties.
    const read = async (document: string): Promise<string[]> => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await loadWithStoredDocument(page, document);
      await expect
        .poll(async () => noticeTexts(page), { message: `no notice for document: ${document.slice(0, 40)}` })
        .not.toEqual([]);
      const notices = await noticeTexts(page);
      await context.close();
      return notices;
    };

    const unreadable = await read("{{{not json");
    const tooNew = await read('{"schemaVersion":999,"transient":null,"saved":[]}');

    expect(tooNew, "two different failures gave the GM the same message").not.toEqual(unreadable);
  });
});

test.describe("Risk #6 — a document from another schema version is not destroyed", () => {
  /**
   * The rollback asymmetry AGENTS.md names: a Worker rollback reverts code and
   * assets, but the GM's browser storage stays on the newer format. Older code
   * must then refuse to write rather than overwrite what it cannot represent.
   */
  test("a newer document is left intact rather than overwritten", async ({ page }) => {
    const fromTheFuture = JSON.stringify({
      schemaVersion: 999,
      transient: null,
      saved: [],
      // A field this build knows nothing about. If it survives, the document was
      // genuinely left alone; if it vanishes, this build rewrote the file.
      unknownFutureField: "must-survive",
    });

    await loadWithStoredDocument(page, fromTheFuture);

    // The GM is told why nothing will be saved.
    await expect.poll(async () => noticeTexts(page)).not.toEqual([]);

    // Generating is still allowed — the product does not lock up ...
    await page.getByRole("button", { name: "Stwórz" }).click();
    await expect(page.getByRole("region", { name: "Asortyment kupca" })).toBeVisible();

    // ... but the newer document on disk is untouched, byte for byte.
    const onDisk = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
    expect(onDisk, "older code overwrote a document written by a newer build").toBe(fromTheFuture);
  });
});
