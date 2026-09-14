import { defineConfig, devices } from "@playwright/test";

/**
 * E2E harness for the browser-level slice of `context/foundation/test-plan.md`.
 *
 * Scope is deliberately narrow. Almost everything in this project is proven more
 * cheaply by the Vitest `node` / `dom` projects; the only work that belongs here
 * is what §6.2 of the test plan lists as things "jsdom cannot do honestly" —
 * the `storage` event, real `<dialog>` semantics, `pagehide`/`visibilitychange`,
 * and colour contrast. Do not grow this suite into a per-page sweep.
 */
export default defineConfig({
  testDir: "./tests/e2e",

  // Every spec here must be independently runnable (E2E rule #3), so parallel
  // execution is on by default — it is also what surfaces shared-state bugs.
  fullyParallel: true,

  // A `.only` left in a spec silently shrinks CI's coverage to one test.
  forbidOnly: !!process.env.CI,

  // No retries locally: a flake must be seen, not smoothed over. One retry in CI
  // distinguishes an infrastructure blip from a real regression.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: "http://localhost:4321",
    trace: "on-first-retry",
    // No `storageState`: this product has no auth. Every spec starts from a
    // clean browser context, which is also what makes the persistence specs
    // honest — nothing is carried in from a previous test.
  },

  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /phone-.*\.spec\.ts/,
    },
    {
      // The project's only NFR is phone readability, so the phone viewport is a
      // first-class project rather than a per-test override. 320px is the
      // narrowest viewport still in real use and the one the NFR must hold at.
      name: "phone",
      use: { ...devices["Pixel 5"], viewport: { width: 320, height: 658 } },
      testMatch: /phone-.*\.spec\.ts/,
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:4321",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
