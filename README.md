# Generator kupca D&D 5e

A merchant and shop generator for Dungeons & Dragons 5e Game Masters. Pick a shop
category and a settlement's wealth, press one button, and get a priced, balanced stock
list you can read to your players straight from the screen.

**Live:** https://dnd-5e-merchant-generator.mateusz-kotowicz.workers.dev

> The interface is in Polish, because it is written for Polish-speaking GMs. The code,
> comments and technical documentation are in English.

## The problem

Players announce a visit to the blacksmith you did not prepare. You now have to invent a
plausible inventory, with prices and quantities, while five people wait. Doing it from
memory or by leafing through books is slow, and the pricing comes out inconsistent.
There is a quieter cost too: lists generated for an earlier session get lost, so the same
work is done again.

This tool does that in about two seconds, and keeps what it made.

## What it does

- **Generate** a stock list from a category (magic items, blacksmith, alchemist, general
  goods) and a settlement wealth (poor, typical, rich).
- **10–25 unique items**, each with a price and an available quantity, laid out as a table.
- **Correct any price or quantity by hand** — the generator proposes, you decide. Edits
  are kept as an overlay on top of the generated list, so a correction is always
  distinguishable from a roll.
- **Regenerate** the same shop. If you have unsaved corrections, it asks before discarding
  them.
- **Autosave.** The last generated merchant is restored when you come back, with no
  explicit action. An explicit **Save** promotes it to your permanent library.
- **A library** of saved merchants: rename, search by name, reopen, and delete.

Requirements are specified as FR-001…FR-013 in
[`context/foundation/prd.md`](context/foundation/prd.md).

## How it works

One prerendered page, one React island, and the browser's own storage. There is no
backend, no database and no API.

```
src/pages/index.astro        the only route; prerendered
  └── GeneratorIsland.tsx    client:load, wrapped in an error boundary
        └── MerchantGenerator.tsx   state, persistence and every write path
              ├── MerchantTable.tsx / PriceQuantityCell.tsx   the editable table
              ├── MerchantLibrary.tsx   saved merchants: search, rename, delete
              ├── ConfirmDialog.tsx     native <dialog>, guards destructive actions
              └── StorageNotice.tsx     tells you when a write or read failed
```

Everything persists under a single `localStorage` key, `dnd-merchant-generator`, holding a
versioned document with a `transient` slot (the merchant currently on screen) and a
`saved` collection (the library). `src/lib/merchant-storage.ts` owns every read and write;
expected failures come back as a discriminated union rather than throwing, so a full or
blocked store is reported to you instead of losing work silently.

The domain logic lives in `src/lib/assortment.ts`. Wealth selects a rarity mix and a price
multiplier — a poor settlement pays _more_ per item, not less — and quantity is banded by
rarity, so commons run 2–12 deep while a rare item is always a single copy.

## Scope, deliberately

**Single user, no accounts, no login.** Data lives on your device and never leaves it.
Open the page and use it. The known cost is accepted and documented: a saved merchant is
tied to one browser on one device, and clearing site data deletes your library. See
§Access Control in [`prd.md`](context/foundation/prd.md) for the full reasoning, including
why accounts were adopted mid-planning and then deferred to v2.

Also out of scope for v1: merchant personality and backstory, dynamic economy, haggling,
homebrew items, and cloud sync.

## Getting started

Requires Node.js **22.22.2** (see `.nvmrc`; `package.json` floors at `>=22.22.2` because
jsdom 30 requires it).

```bash
npm install
npm run dev          # http://localhost:4321
```

That is the whole setup. There are no environment variables to configure, no Docker, and
no external services to provision for local development.

## Scripts

| Script                      | What it does                                             |
| --------------------------- | -------------------------------------------------------- |
| `npm run dev`               | Dev server on port 4321                                  |
| `npm run build`             | Production build                                         |
| `npm run preview`           | Preview the production build                             |
| `npm run typecheck`         | `astro check` — type-checks every file, including `.tsx` |
| `npm test`                  | Vitest: unit + component suites                          |
| `npm run test:watch`        | Vitest in watch mode                                     |
| `npm run test:e2e`          | Playwright browser tests (starts the dev server itself)  |
| `npm run test:e2e:ui`       | Playwright in UI mode                                    |
| `npm run lint` / `lint:fix` | ESLint, type-aware                                       |
| `npm run format`            | Prettier                                                 |
| `npm run data:build`        | Regenerate the item catalog from its source              |

## Tests

Testing is risk-driven: [`context/foundation/test-plan.md`](context/foundation/test-plan.md)
carries a numbered risk map, and every test traces back to a risk on it.

- **Unit and component** — Vitest, two projects over disjoint globs. `src/**/*.test.ts`
  runs in `node`; `src/**/*.test.tsx` runs in `jsdom` with Testing Library. The extension
  alone picks the environment.
- **Browser (E2E)** — Playwright, in `tests/e2e/`. Deliberately small: it carries only
  what jsdom cannot exercise honestly — real storage quota exhaustion, `<dialog>`
  semantics, `pagehide`/`visibilitychange`, colour contrast, and real layout at a 320px
  phone viewport. Read [`tests/e2e/E2E_RULES.md`](tests/e2e/E2E_RULES.md) before adding one.
- **Quarantine ledger** — `src/quarantine.test.ts` counts every parked defect and fails if
  the number disagrees with the list written there, so a known bug cannot be parked
  without being recorded.

```bash
npm test                                  # unit + component
npm run test:e2e                          # browser
npm run test:e2e -- --project phone       # the 320px viewport project only
```

CI (`.github/workflows/ci.yml`) runs typecheck, unit with coverage, lint, build and E2E on
every push and pull request to `main`, and can be started by hand from the Actions tab.

## Deployment

Deploys to Cloudflare Workers via Wrangler.

```bash
npm run cf:upload    # astro build && wrangler versions upload — uploads, promotes nothing
npx wrangler deploy  # promotes to production; human-run, never automated
```

Promotion to production is deliberately human-gated (`AGENTS.md`): `wrangler deploy` and
`wrangler versions deploy` are never run unattended. Deployment notes and the rollback
plan are in [`context/deployment/deploy-plan.md`](context/deployment/deploy-plan.md).

No secrets are required. `SUPABASE_URL` and `SUPABASE_KEY` are declared in
`astro.config.mjs` as optional, server-only secrets and are currently **unused** — the
packages are installed but nothing imports them, and v1 wires no backend.

## Documentation

The written foundation this project was built from lives in `context/`:

| File                                                                   | What it holds                                                                                            |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`foundation/prd.md`](context/foundation/prd.md)                       | Product requirements: vision, FR-001…FR-013, success criteria, access control, non-goals, open questions |
| [`foundation/shape-notes.md`](context/foundation/shape-notes.md)       | The discovery conversation the PRD was written from                                                      |
| [`foundation/roadmap.md`](context/foundation/roadmap.md)               | Vertical slices and milestones                                                                           |
| [`foundation/test-plan.md`](context/foundation/test-plan.md)           | Risk map, phased test rollout, quality gates, cookbook                                                   |
| [`foundation/tech-stack.md`](context/foundation/tech-stack.md)         | Stack choice and rationale                                                                               |
| [`foundation/infrastructure.md`](context/foundation/infrastructure.md) | Hosting evaluation                                                                                       |
| [`foundation/lessons.md`](context/foundation/lessons.md)               | Recurring pitfalls found while building, with the rule to apply next time                                |
| [`deployment/deploy-plan.md`](context/deployment/deploy-plan.md)       | Deploy and rollback procedure                                                                            |

`AGENTS.md` and `CLAUDE.md` carry the working rules for AI agents in this repository.

## Licence

This project's own source code is licensed under the **MIT License** — see
[`LICENSE`](LICENSE).

The game data it builds on is not, and cannot be, covered by that. The item catalog in
`src/data/items.generated.ts` is derived from the **System Reference Document 5.1** by
Wizards of the Coast LLC, used under the
[Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/legalcode).
That material stays under CC-BY-4.0, and its attribution requirement travels with any copy
or derivative of this repository — the notice is reproduced in `LICENSE`, and in the page
footer where the catalog is actually shown.

Prices, rarity tiers and merchant categories are this project's own editorial work rather
than the SRD's. The full list of modifications is in
[`src/data/ATTRIBUTION.md`](src/data/ATTRIBUTION.md), which also records what is
deliberately **not** used: nothing from the published rulebooks outside the SRD, since this
repository is public and that material is not freely licensed.

`src/data/items.generated.ts` is produced by `scripts/build-item-catalog.mjs` — regenerate
it with `npm run data:build` rather than editing it by hand.
