# E2E Testing Rules

Read this before adding or regenerating anything under `tests/e2e/`. Together
with `seed.spec.ts` these are the two levers that keep generated browser tests
stable — the seed shows the shape, this file states the constraints.

## The rules

- Use `getByRole`, `getByLabel`, `getByText` as primary locators. Fall back to
  `getByTestId` only when accessibility attributes are ambiguous.
- Never use CSS selectors, XPath, or DOM structure to locate elements. The one
  standing exception is `astro-island:not([ssr])`, which is a hydration
  lifecycle signal rather than an element the user interacts with.
- Each test must be independently runnable — no shared state between tests, and
  no ordering assumptions. `fullyParallel` is on.
- Never use `page.waitForTimeout()`. Wait for conditions: `toBeVisible()`,
  `toHaveValue()`, `expect.poll()`, `waitForURL()`, `waitForResponse()`.
- Assert the business outcome, not implementation details.
- Use unique identifiers (timestamp suffix) for any data that could outlive the
  test, and clean up in `afterEach`. Nothing in this product does yet — state is
  browser-local and dies with the context — so no spec here needs teardown.
- `storageState` is not used: this product has no authentication.

## Project-specific rules

- **Always enter through `gotoHydrated()`.** `index.astro` renders the island
  with `client:load` and Astro server-renders its markup, so every control is
  present and clickable *before* React attaches handlers. A click in that window
  is swallowed silently — the button is there, the click happens, nothing occurs.
  This is the single biggest flake source in this app and the reason a bare
  `page.goto("/")` is a bug, not a shortcut.
- **Accessible names are Polish.** `Stwórz`, `Zapisz`, `Anuluj`,
  `Zamożność osady`, `Asortyment kupca`, `Zapisani kupcy`. Cell fields are
  labelled `Cena (gp) — <item>` and `Ilość — <item>`, so address them by item
  name rather than by row index.
- **Guard the premise before asserting the outcome** (lessons L-03, L-04).
  A round-trip test that never wrote anything passes for the wrong reason, and
  a "no overflow" test on an empty page is green because there is nothing to
  overflow. Assert that the test reached the state it is named after.
- **Assert the requirement, not the copy.** Never compare against message
  strings lifted from the component under test — that is green for any wording,
  including wording that says the opposite.

## What belongs here, and what does not

This suite is deliberately tiny. Almost every risk in
`context/foundation/test-plan.md` is proven more cheaply by the Vitest `node`
or `dom` projects, and promoting one to E2E because it "feels safer" makes the
suite slower and flakier for no extra signal.

A test earns a place here only if it needs something jsdom cannot do honestly
(test plan §6.2):

| Belongs in E2E | Prove it in Vitest instead |
|---|---|
| The `storage` event (only reaches *other* windows) | Any single-window state change |
| Real `<dialog>` semantics — focus trap, Escape, backdrop | Whether a dialog was asked to open |
| `pagehide` / `visibilitychange` commit paths | The persist function itself |
| Colour contrast and focus indicators — needs a paint engine | Class names on an element |
| Layout and overflow at a real viewport | Anything with no geometry |

Everything else — parsing, merge rules, storage outcomes, schema versions,
message mapping — belongs in `src/**/*.test.ts` or `src/**/*.test.tsx`.

## Parking a known defect

Same lifecycle as `src/quarantine.test.ts` (test plan §6.3), with Playwright's
spelling: `test.fail()`, never `test.skip()` or `test.fixme()`. A skipped test
does not execute and rots silently; `test.fail()` runs its assertion, keeps the
suite green while the defect stands, and turns red the moment the defect is
fixed, so the entry has to be retired rather than forgotten.

Every parked entry must also be counted in `src/quarantine.test.ts`, which scans
this directory as well as `src/`. Write the assertion for the requirement first,
then park it — never weaken an assertion so it passes against the defect.

## Running

```
npm run test:e2e                          # both projects
npm run test:e2e -- tests/e2e/seed.spec.ts   # a single spec
npm run test:e2e -- --project phone       # the 320px NFR project only
```

The Playwright config starts `npm run dev` itself and reuses an already-running
dev server locally.
