# Repository Guidelines

A D&D 5e merchant generator for tabletop game masters: Astro 6 in SSR mode (`output: "server"`) with React 19 islands, strict TypeScript, Tailwind 4, deployed to Cloudflare Workers. Product scope lives in @context/foundation/prd.md, the stack rationale in @context/foundation/tech-stack.md, and the build order in @context/foundation/roadmap.md.

**There is no auth, no server session, and no API route in v1.** The starter's entire auth surface was deleted on 2026-09-10 (commit `3c21436`). If a doc, a tutorial, or your own recall mentions `src/middleware.ts`, `src/lib/supabase.ts`, `/auth/*`, `/api/auth/*`, `PROTECTED_ROUTES`, or `context.locals.user` in this repo — it is describing code that no longer exists.

## Hard rules

- **Accounts and server-side data are out of scope.** The PRD rules them out — saved merchants persist in browser storage on a single device (PRD Access Control). The `@supabase/*` packages are still in `package.json` as the v2 cloud-sync hook, but **nothing imports them and nothing should**. Do not reintroduce an auth layer, middleware, or a server session to solve a v1 problem.
- **Never `wrangler pages deploy`.** `@astrojs/cloudflare` v13 dropped Cloudflare Pages support; this project deploys to Cloudflare **Workers** with `npx wrangler deploy`. Deploy details and the operational runbook live in @context/deployment/deploy-plan.md.
- **Always `npx wrangler`, never `npm i -g wrangler`.** A global binary shadows the pinned `^4.90.0` and can drift outside the adapter's `^4.83.0` peer range.
- **Promotion to production is human-only** — `wrangler deploy` and `wrangler versions deploy`. Agents may run `astro build`, `wrangler versions upload`, `deployments list`, `tail`, and `rollback` unattended. Guards are in @.claude/settings.json.
- **`npm run lint` fails on this Windows checkout with ~1000 `Delete ␍` errors and zero real errors.** Git stores LF, `core.autocrlf=true` checks out CRLF, and there is no `.gitattributes`. CI on ubuntu checks out LF and passes. Judge lint by non-CRLF errors only, or add `.gitattributes` with `* text=auto eol=lf`.
- **`context/` is the source of truth** for the PRD, stack hand-off, and plans — never overwrite it, and never write to `context/archive/` (see @CLAUDE.md).
- **Browser-storage schema changes are forward-only.** A Worker rollback reverts the script and static assets, but not a GM's `localStorage`. Any device that already loaded a new saved-merchant format keeps it, and the reverted code must still read it. The PRD guardrail is "zapisany kupiec nigdy nie znika po cichu" — write a migration path before shipping a schema change.
- **Generate assortments client-side, in the React island.** The free Workers tier caps CPU at **10 ms per invocation**; server-side rarity sampling over 30–40-item pools aims that ceiling straight at the PRD's "under 5 seconds" criterion. The data is browser-local anyway, so the server buys nothing. Decided 2026-09-11 — this is settled, not open.
- **Product routes are prerendered.** `output: "server"` stays (the deploy pipeline in @context/deployment/deploy-plan.md is proven against it), but every page carries `export const prerender = true` so nothing user-facing renders per-request. Verify after a build: the route must appear as HTML under `dist/client/`. A full move to `output: "static"` is deferred past the v1 deadline — see deploy-plan Phase 9.
- **The item catalog is generated, not hand-edited.** `src/data/items.generated.ts` is produced by `npm run data:build` from `scripts/build-item-catalog.mjs`; the hand-written contract is `src/data/items.ts` (`CategoryId`, `Rarity`, `Wealth`, `CatalogItem`, `CATEGORIES`, `WEALTH_LEVELS`, `RARITY_TIERS`, `ITEM_POOLS`). Source is SRD 5.1 under CC-BY-4.0 — **non-SRD content must never enter this public repo** (see @src/data/ATTRIBUTION.md).

## Project structure

`src/pages/` holds Astro routes — currently just `index.astro`, the single view. `src/components/` splits into `.astro` chrome, `.tsx` React islands, and shadcn primitives under `ui/`; `src/layouts/Layout.astro` is the shell; shared logic sits in `src/lib/`; the item catalog and its types in `src/data/`. `src/env.d.ts` deliberately carries **no** `App.Locals` augmentation — v1 has no middleware and no server session.

There is no `src/pages/api/`. v1 needs no endpoint: generation runs in the browser and merchants persist in browser storage. If you think you need an API route, re-read the PRD Access Control section first.

`README.md` is still the upstream **starter template's** readme (10x Astro Starter, Supabase setup, template screenshot). It does **not** describe this product — do not treat it as a source of truth, and do not follow its Supabase instructions.

## Commands

- `npm run dev` — dev server on the Cloudflare workerd runtime
- `npm run build` — production build; run `npx astro sync` first on a clean checkout
- `npx wrangler dev` — production-fidelity local run **against `wrangler.jsonc`** (build first). This, not `astro dev`, is what tests the config you deploy with. `wrangler pages dev ./dist` is legacy and wrong here — v13 emits `dist/client` + `dist/server`, no `_worker.js`.
- `npm run cf:upload` — build and upload a **non-live** version, returns a preview URL
- `npx wrangler tail --format json` — live logs (very verbose; drop `--format json` for humans)
- `npm run lint` / `npm run lint:fix` — ESLint with type-checked rules
- `npm run format` — Prettier

No test framework is configured, so there is no `npm test`. Node version is pinned in @.nvmrc.

## Style & naming

Import through the `@/*` alias instead of deep relative paths. Components are PascalCase (`MerchantTable.tsx`), `src/lib/` files kebab-case (`merchant-storage.ts`), shadcn primitives lowercase inside `ui/` (`button.tsx`). Prefix intentionally unused bindings with `_`. `no-console` warns and `astro/no-set-html-directive` errors — see @eslint.config.js and @.prettierrc.json.

## Security & configuration

Read secrets from `astro:env/server`, never `import.meta.env` or `process.env`, and declare new ones in the `env.schema` block of @astro.config.mjs. Keep values in `.env` and `.dev.vars`, both gitignored; @.env.example lists the keys.

For Cloudflare bindings use `import { env } from "cloudflare:workers"`. **Never `Astro.locals.runtime.env`, `.cf`, or `.caches`** — adapter v13 removed all three (use `Astro.request.cf`, global `caches`, `Astro.locals.cfContext`). Practically every Astro-on-Cloudflare tutorial written before 2026 uses the removed idiom and will silently yield `undefined` at runtime, so distrust recall here and check @context/deployment/deploy-plan.md.

Production secrets go in via `npx wrangler secret put NAME` (write-only, not readable back). v1 requires none. There is **no `CLOUDFLARE_API_TOKEN`** anywhere — deploys authenticate via `wrangler login` OAuth locally and via Cloudflare's own Git integration in CI.

## Commits & pull requests

Conventional Commits prefixes (`chore:`, `feat:`, `docs:`), the convention set by the initial commit. `npx lint-staged` runs on pre-commit via husky, so formatting lands before review.
