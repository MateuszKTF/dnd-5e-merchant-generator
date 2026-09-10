# Repository Guidelines

A D&D 5e merchant generator for tabletop game masters: Astro 6 in SSR mode (`output: "server"`) with React 19 islands, strict TypeScript, Tailwind 4, deployed to Cloudflare Workers. Product scope lives in @context/foundation/prd.md, the stack rationale in @context/foundation/tech-stack.md.

## Hard rules

- **Supabase auth is deliberately unwired.** The PRD rules out accounts and server-side data — saved merchants persist in browser storage on a single device. Do not build features on `src/lib/supabase.ts`, the `/auth/*` routes, or `PROTECTED_ROUTES`; that layer is the deferred v2 cloud-sync path, not v1 surface.
- **Never `wrangler pages deploy`.** `@astrojs/cloudflare` v13 dropped Cloudflare Pages support; this project deploys to Cloudflare **Workers** with `npx wrangler deploy`. Deploy details and the operational runbook live in @context/deployment/deploy-plan.md.
- **Always `npx wrangler`, never `npm i -g wrangler`.** A global binary shadows the pinned `^4.90.0` and can drift outside the adapter's `^4.83.0` peer range.
- **Promotion to production is human-only** — `wrangler deploy` and `wrangler versions deploy`. Agents may run `astro build`, `wrangler versions upload`, `deployments list`, `tail`, and `rollback` unattended. Guards are in @.claude/settings.json.
- **`npm run lint` fails on this Windows checkout with ~1000 `Delete ␍` errors and zero real errors.** Git stores LF, `core.autocrlf=true` checks out CRLF, and there is no `.gitattributes`. CI on ubuntu checks out LF and passes. Judge lint by non-CRLF errors only, or add `.gitattributes` with `* text=auto eol=lf`.
- **`context/` is the source of truth** for the PRD, stack hand-off, and plans — never overwrite it, and never write to `context/archive/` (see @CLAUDE.md).
- `createClient()` returns `null` when the Supabase env vars are absent. Every caller must null-check before use.
- **Browser-storage schema changes are forward-only.** A Worker rollback reverts the script and static assets, but not a GM's `localStorage`. Any device that already loaded a new saved-merchant format keeps it, and the reverted code must still read it. The PRD guardrail is "zapisany kupiec nigdy nie znika po cichu" — write a migration path before shipping a schema change.
- **Generate assortments client-side, in the React island.** The free Workers tier caps CPU at **10 ms per invocation**; server-side rarity sampling over 30–40-item pools aims that ceiling straight at the PRD's "under 5 seconds" criterion. The data is browser-local anyway, so the server buys nothing.

## Project structure

`src/pages/` holds Astro routes and `src/pages/api/` the endpoints; `src/components/` splits into `.astro` chrome, `.tsx` React islands, and shadcn primitives under `ui/`; shared logic sits in `src/lib/`. `src/middleware.ts` populates `context.locals.user`, typed in `src/env.d.ts`. Layout details and Supabase setup: @README.md.

API routes export named HTTP verbs (`export const POST: APIRoute`), read `FormData`, and report failures by redirecting with an `?error=` query param rather than returning JSON — reference shape in @src/pages/api/auth/signin.ts.

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

Import through the `@/*` alias instead of deep relative paths. Components are PascalCase (`SignInForm.tsx`), `src/lib/` files kebab-case (`config-status.ts`), shadcn primitives lowercase inside `ui/`. Prefix intentionally unused bindings with `_`. `no-console` warns and `astro/no-set-html-directive` errors — see @eslint.config.js and @.prettierrc.json.

## Security & configuration

Read secrets from `astro:env/server`, never `import.meta.env` or `process.env`, and declare new ones in the `env.schema` block of @astro.config.mjs. Keep values in `.env` and `.dev.vars`, both gitignored; @.env.example lists the keys.

For Cloudflare bindings use `import { env } from "cloudflare:workers"`. **Never `Astro.locals.runtime.env`, `.cf`, or `.caches`** — adapter v13 removed all three (use `Astro.request.cf`, global `caches`, `Astro.locals.cfContext`). Practically every Astro-on-Cloudflare tutorial written before 2026 uses the removed idiom and will silently yield `undefined` at runtime, so distrust recall here and check @context/deployment/deploy-plan.md.

Production secrets go in via `npx wrangler secret put NAME` (write-only, not readable back). v1 requires none. There is **no `CLOUDFLARE_API_TOKEN`** anywhere — deploys authenticate via `wrangler login` OAuth locally and via Cloudflare's own Git integration in CI.

## Commits & pull requests

Conventional Commits prefixes (`chore:`, `feat:`, `docs:`), the convention set by the initial commit. `npx lint-staged` runs on pre-commit via husky, so formatting lands before review.
