import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors the `@/*` path in tsconfig.json. Vitest does not read
      // tsconfig paths, so the alias has to be restated here or every
      // `@/data/items` import fails to resolve at test time.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Node environment only: everything under test here is a pure function.
    // No jsdom, no Testing Library — the React islands are covered by the
    // manual verification steps in the plan, not by this runner.
    environment: "node",

    // Collect ONLY hand-written .ts tests under src/. This deliberately
    // excludes .tsx so an Astro or React file is never pulled into the
    // runner, which is what keeps the harness free of jsdom.
    include: ["src/**/*.test.ts"],
  },
});
