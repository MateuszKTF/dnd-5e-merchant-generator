import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const srcAlias = {
  // Mirrors the `@/*` path in tsconfig.json. Vitest does not read
  // tsconfig paths, so the alias has to be restated here or every
  // `@/data/items` import fails to resolve at test time.
  "@": fileURLToPath(new URL("./src", import.meta.url)),
};

export default defineConfig({
  resolve: { alias: srcAlias },
  test: {
    // Coverage is root-level on purpose, and must stay there: Vitest rejects a
    // `coverage` key inside a project config. It therefore spans both projects.
    coverage: {
      provider: "v8",

      // `include` is what makes an untested file report 0% instead of vanishing
      // from the report entirely. Without it, coverage only ever describes files
      // some test happened to import — which is how 3 068 lines of .tsx stayed
      // invisible for the whole project (lessons L-05). There is no `all` option
      // in Vitest 5; this is the mechanism.
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.test-helper.ts", "src/**/*.d.ts"],
      reporter: ["text", "html"],

      // Deliberately no thresholds. This reports; it does not gate. The gate is
      // §3 Phase 4 of context/foundation/test-plan.md.
    },

    projects: [
      {
        resolve: { alias: srcAlias },
        test: {
          name: "node",

          // Both of these MUST be restated here. `extends` defaults to `true` in
          // Vitest 5 (the opposite of v4), so a project inherits every root-level
          // option — but there are no root-level `environment`/`include` keys any
          // more, and re-adding them would silently apply to the dom project too.
          // Stating them per project is what keeps the two suites disjoint.
          environment: "node",

          // Collect ONLY hand-written .ts tests under src/.
          //
          // What this excludes is *rendering*, not importing. A .ts test may
          // import a pure export from a .tsx module — `isStandingCondition` is
          // the first to do so — because the compiled JSX runtime reaches
          // `react` and never `react-dom`, so nothing touches the DOM. What it
          // may not do is render: there is no DOM here, and a test that needs
          // one belongs in a .test.tsx file under the dom project below.
          include: ["src/**/*.test.ts"],
        },
      },
      {
        resolve: { alias: srcAlias },
        test: {
          name: "dom",
          environment: "jsdom",

          // `.test.tsx` only. The two globs are naturally disjoint, which is why
          // splitting by project needed no edit to any existing test file.
          include: ["src/**/*.test.tsx"],

          // Scoped to this project. Testing Library registers its automatic
          // cleanup only if a global `afterEach` exists when it is imported, and
          // Vitest's `globals` defaults to false — so without this the setup
          // file has to wire cleanup by hand. It does both, belt and braces.
          globals: true,
          setupFiles: ["./vitest.setup.dom.ts"],
        },
      },
    ],
  },
});
