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

    // Collect ONLY hand-written .ts tests under src/.
    //
    // What this excludes is *rendering*, not importing. A .ts test may import a
    // pure export from a .tsx module — `isStandingCondition` is the first to do
    // so — because the compiled JSX runtime reaches `react` and never
    // `react-dom`, so nothing touches the DOM. What it may not do is render:
    // there is no DOM in this environment, and a test that needs one belongs in
    // a .test.tsx file under the jsdom project.
    include: ["src/**/*.test.ts"],
  },
});
