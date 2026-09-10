---
project: dnd-5e-merchant-generator
researched_at: 2026-09-10
recommended_platform: Cloudflare Workers
runner_up: Netlify
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6.3.1 + React 19 islands
  runtime: Cloudflare Workers (workerd)
---

> **Deployed 2026-09-10.** Live at `https://dnd-5e-merchant-generator.mateusz-kotowicz.workers.dev`.
> The recommendation held; five prescriptions below did not survive execution. See
> **Post-Deploy Corrections** at the end of this file and `context/deployment/deploy-plan.md`
> for the audit trail. Where the two disagree, `deploy-plan.md` is the measured record.

## Recommendation

**Deploy on Cloudflare Workers.**

The stack already pins `@astrojs/cloudflare@^13.5.0` and `wrangler@^4.90.0`, whose peer range
(`astro ^6.3.0`, `wrangler ^4.83.0`) the project satisfies exactly — every other shortlisted platform
requires swapping the adapter days before a hard deadline. Cloudflare was the only platform to score
Pass on all five agent-friendly criteria, its free tier (100k requests/day) is the most generous of the
six against a cost-minimizing constraint, and the developer already has hands-on Cloudflare experience.
Single-region reach and external-services-are-fine answers made the edge and co-location axes neutral,
so the decision came down to zero migration cost, zero hosting cost, and full CLI operability.

**One correction this research forces**: `tech-stack.md` records `deployment_target: cloudflare-pages`.
That is no longer reachable with the pinned adapter — `@astrojs/cloudflare` v13 dropped Cloudflare Pages
support in favour of Workers. The platform choice is unchanged; the *product within* Cloudflare changes
from Pages to Workers, and the deploy command changes with it.

## Platform Comparison

Scored against the five criteria in `references/agent-friendly-criteria.md`. Hard filters applied first:
no persistent connections are required (so nothing was dropped on that axis), and all six platforms can
run Astro 6 SSR — but only Cloudflare runs it with the adapter already in `package.json`.

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Total |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass | **5 / 5** |
| Netlify | Partial | Pass | Pass | Pass | Pass | 4½ |
| Vercel | Pass | Pass | Pass | Partial | Pass | 4½ |
| Fly.io | Pass | Partial | Pass | Pass | Pass | 4½ |
| Render | Partial | Pass | Pass | Pass | Pass | 4½ |
| Railway | Partial | Pass | Pass | Pass | Pass | 4½ |

**Cloudflare Workers** — `wrangler deploy` / `wrangler rollback [VERSION_ID]` / `wrangler tail` /
`wrangler deployments list` cover the full operational loop with no dashboard step (Pass). Fully managed
serverless with no OS or container surface (Pass). `developers.cloudflare.com/llms.txt` indexes per-product
llms.txt across the Developer Platform (Pass). Deploy is one deterministic command returning a URL (Pass).
A managed remote MCP catalog runs at `mcp.cloudflare.com/mcp` supporting MCP spec 2026-07-28 — status not
explicitly labelled GA/beta on the fetched pages, so treat as *unlabelled* (Pass, soft).

**Netlify** — CLI covers deploy (`netlify deploy`, draft by default; `--prod` required, a safe default) and
`netlify logs --follow`, but there is **no dedicated rollback subcommand**; rollback means re-publishing a
prior atomic deploy (Partial). `docs.netlify.com/llms.txt` is official and maintained (Pass). Official MCP
server, ~9 tools, presented as production (Pass). Netlify's own changelog states "Astro 6 just works"
(2026-03-10) and `@astrojs/netlify` v7 targets `astro ^6.0.0`. The catch is cost shape, not capability:
the free plan is a **hard** 300-credit cap with no overage purchase — the site simply stops until the next
cycle — and production deploys cost **15 credits each**, i.e. roughly 20 deploys/month before exhaustion.
For an agent-driven iterative workflow that is a real ceiling.

**Vercel** — the most complete rollback story of the six (`vercel rollback`, `vercel promote`,
`vercel logs --follow`), `llms.txt` plus `llms-full.txt`, and an official MCP server (public beta).
Deploy API is marked Partial for one stack-specific reason: an **open, unresolved issue** (withastro/astro
GH #16258) reports esbuild parse errors on generated component script chunks for Astro 6 + Vercel SSR
builds. Hobby tier is free and this project is non-commercial, so the commercial-use restriction does not
bite — but an unresolved build-breaking bug on the exact framework major is disqualifying for a *fallback*,
which must work if the leader fails.

**Fly.io** — `flyctl` is excellent and ships a built-in MCP server (`fly mcp server`). Managed scores
Partial: you own a Dockerfile, machine sizing, and HA machine count. Rollback has no dedicated command —
you locate a prior image hash via `fly releases --image` and redeploy it, and config/secrets do **not** roll
back with it. Dropped on cost: no free tier for new signups, a credit card is mandatory, and even a
scale-to-zero shared-cpu-1x machine runs ~$0–5/mo with a ~5s cold start.

**Render** — GA CLI (v2.27.0) with `deploys create/list/cancel` and `logs`, but **no CLI rollback**
(dashboard or REST API only) (Partial). Official Astro SSR guide and template, `llms.txt` + `llms-full.txt`,
hosted MCP at `mcp.render.com/mcp`. Dropped on a PRD collision rather than on criteria: free web services
**spin down after 15 minutes idle with a ~60s cold start**. This app is opened cold at a gaming table,
perhaps weekly — so nearly every real session would pay that cold start, directly against the Primary
success criterion of "under 5 seconds". Avoiding it costs $7/mo on Starter.

**Railway** — Railpack auto-detects Node, MCP server available, `llms.txt` + `llms-full.txt`. No CLI
rollback (dashboard-only, plan-gated retention) (Partial), and Astro SSR is explicitly **not** zero-config
(requires `@astrojs/node` standalone, `server.host = '0.0.0.0'` or you get 502s). Dropped on cost: it is the
most expensive of the six — Hobby is a **$5/mo floor** (not offsettable), and a small always-on service
estimates ~$15–20/mo. Sleep-to-zero exists but background egress silently defeats it.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Won on three independent axes at once. **Migration cost is zero** — the adapter and CLI are already
installed and version-compatible, which matters disproportionately against a 2026-09-13 deadline.
**Hosting cost is zero** — 100k requests/day free, with static assets served free and unmetered, and this
is a single-user hobby app. **Operability is complete** — it is the only platform of the six with a
first-class rollback command in the CLI *and* full log tailing *and* deterministic one-command deploy,
which is what lets an agent run the loop unattended. Existing developer familiarity broke any remaining tie.

#### 2. Netlify

The strongest fallback because its Astro 6 support is *vendor-attested* rather than inferred, and its
adapter is maintained by the Astro core team. If Cloudflare's Workers-only migration turns out to be more
friction than expected, `@astrojs/netlify` v7 is a drop-in adapter swap plus a `NODE_VERSION=22.12.0` pin.
The gap versus the recommendation is the free-tier credit cap (hard stop, 15 credits per production deploy)
and the missing rollback subcommand — both are workflow constraints rather than capability gaps.

#### 3. Vercel

Third on the strength of its operational tooling, which is arguably the best of the six: real `rollback` and
`promote` commands, `llms-full.txt`, and an OAuth-backed MCP server. It sits below Netlify solely because of
the open Astro 6 SSR build bug (GH #16258). Should that issue close, Vercel and Netlify are near-interchangeable
as fallbacks for this stack.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **`tech-stack.md` is already wrong, and the deploy step will inherit the error.** It records
   `deployment_target: cloudflare-pages`. `@astrojs/cloudflare` v13.5 **dropped Pages support entirely** and
   targets Workers only. An agent trusting that contract as ground truth reaches for `wrangler pages deploy`,
   which is the wrong command for a v13 build. The `ci_default_flow: auto-deploy-on-merge` GitHub Action was
   almost certainly templated against `cloudflare/pages-action` — also wrong, and it will fail or publish a
   broken static-only artifact.

2. **10ms CPU per invocation on the free tier, against a generator.** Free Workers allow 100k requests/day
   but cap CPU at 10ms *per invocation*. The core domain rule — weighted rarity sampling across 30–40 item
   pools per category, 10–25 unique picks, plus wealth price modifiers — is CPU work. Implemented in an Astro
   server endpoint it aims a latency cliff squarely at the "under 5 seconds" primary success criterion, while
   sitting nowhere near the request quota. The request budget is generous; the CPU budget is not.

3. **`output: "server"` buys the entire Workers failure surface for nothing.** The PRD specifies no accounts,
   no server-side data, and no API; every functional requirement is satisfied by a static build plus browser
   storage. SSR means a Worker executes on every page view, consuming CPU quota and introducing a class of
   workerd-versus-Node divergence errors that a static deploy cannot produce.

4. **The v13 secrets breaking change poisons the training-data well.** v13 **removed**
   `Astro.locals.runtime.env`, `Astro.locals.runtime.cf`, `.caches`, and the runtime ExecutionContext object,
   replacing them with `import { env } from 'cloudflare:workers'`, `Astro.request.cf`, global `caches`, and
   `Astro.locals.cfContext`. Essentially every Astro-on-Cloudflare tutorial written before 2026 uses the old
   pattern, so an agent will reach for the idiom that dominates its training data and get `undefined` at
   runtime. The unwired Supabase code is precisely the path that would touch this.

5. **The advertised "ready-made v2 path" is unverified.** `tech-stack.md` frames the bundled-but-unwired
   Supabase layer as the ready-made route to v2 cloud sync. Research could not confirm that `@supabase/ssr`
   works on workerd at these pinned versions — no version-specific source exists either way. The path may not
   be as ready as the contract claims.

### Pre-Mortem — How This Could Fail

The v1 shipped on time and the deploy was genuinely easy — `wrangler deploy`, done. The rot started with a
copied `wrangler.jsonc`. Someone pulled a config from a 2025 blog post carrying an older `compatibility_date`,
so `nodejs_compat` silently stopped auto-enabling. Nothing broke immediately, because v1 touched no Node APIs.
Then v2 wired up Supabase for cloud sync, and `@supabase/ssr` failed on workerd in a way that produced no
useful error — just 1101s. Debugging burned a weekend, because every search result described
`Astro.locals.runtime.env`, which v13 had removed, sending the agent down a path that could not work.
Meanwhile the generator had been implemented server-side, and as item pools grew past the SRD into homebrew,
invocations began tripping the 10ms free-tier CPU ceiling. Game Masters got 1015 errors mid-session — the exact
moment the product exists to serve. The fix was a $5/mo plan plus a rewrite of generation into the client,
which is where it should have lived from the first commit. The platform never failed. The architecture chose
SSR it never needed, and paid for it twice.

### Unknown Unknowns

- **`astro dev` no longer runs on Node.** Adapter v13 moved the dev server into **workerd** via the Cloudflare
  Vite plugin, and `astro preview` now supports real bindings. Local fidelity is now excellent — but it means
  `wrangler pages dev ./dist`, which nearly every tutorial prescribes as the "real" test, is redundant legacy
  for this stack. It also means code that previously worked locally under Node and failed only in production
  now fails in both places.
- **The bundle-size limit changed six days before this research.** On **2026-09-04** Cloudflare raised it to
  **64 MiB uncompressed on all plans**, from the long-cited 3 MB free / 10 MB paid compressed figures. Every
  "watch your Worker bundle size" warning written before that date is obsolete — this is a constraint you can
  stop designing around, and stale advice will push you to optimise something that no longer matters.
- **`nodejs_compat` auto-enables only for `compatibility_date` ≥ 2026-08-04.** Below that date the flag must be
  listed explicitly in `compatibility_flags`. A config copied from an older source loses Node compatibility
  silently, and the failure surfaces far from its cause.
- **Sharp cannot run in workerd.** v13 splits the image service into build-time (`compile`) and runtime
  (`passthrough`) by default. Runtime image optimisation silently passes images through unoptimised rather than
  erroring — a quiet quality regression, not a loud failure.
- **A global wrangler install shadows the pinned one.** `wrangler` is a devDependency at `^4.90.0` and the
  adapter peer-requires `^4.83.0`. The universal tutorial instruction `npm i -g wrangler` installs a global
  binary that takes precedence and can drift outside the peer range. Use `npx wrangler` throughout.

## Operational Story

- **Preview deploys**: `npx wrangler versions upload` uploads a non-live version and returns a preview URL
  without touching production traffic; `npx wrangler versions deploy` promotes it. This replaces the Pages
  per-branch preview model, which is not available on a Workers deployment. *Confirm the preview-URL setting is
  enabled for the Worker at first deploy — not verified in this research pass.* Preview URLs are public by
  default; gate with Cloudflare Access if the item pools carry any licensing sensitivity (see Open Question #2
  in the PRD).
- **Secrets**: v1 has **no required secrets** — `SUPABASE_URL` and `SUPABASE_KEY` are declared `optional: true`
  in `astro.config.mjs` and the Supabase layer is unwired. When secrets are needed, they go in via
  `npx wrangler secret put NAME` (stored as Workers Secrets, write-only — not readable back through the CLI)
  and are read in code through `astro:env` or `import { env } from 'cloudflare:workers'` — **never**
  `Astro.locals.runtime.env`, which v13 removed. CI needs a `CLOUDFLARE_API_TOKEN` in GitHub Secrets, scoped to
  Workers Scripts:Edit for this project only — no DNS, no billing, no access to unrelated projects.
- **Rollback**: `npx wrangler deployments list` to find the target, then `npx wrangler rollback [VERSION_ID]`.
  Time-to-revert is seconds. There is **no database**, so no migration can fail to roll back — but note the
  app-specific caveat: a Worker rollback does **not** roll back a browser-storage schema change. Any GM whose
  browser already loaded a new saved-merchant format keeps that data on their device, and the reverted code must
  still read it. This is the guardrail "a saved merchant never silently disappears" — treat storage schema
  changes as forward-only and write a migration path before shipping one.
- **Approval**: Human-only — creating the Cloudflare account, minting and rotating the API token, the *first*
  production `wrangler deploy`, attaching a custom domain, and deleting the Worker. Agent may run unattended —
  `astro build`, `wrangler versions upload` (non-live), `wrangler deployments list`, `wrangler tail`, and
  `wrangler rollback` (a recovery action that restores a known-good state, not a destructive one).
- **Logs**: `npx wrangler tail --format json` for live runtime logs; `npx wrangler deployments list` for
  deployment history. CI/build logs via `gh run view --log`. All read-only, all terminal-resident.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| `tech-stack.md` says `cloudflare-pages`; adapter v13 is Workers-only. Deploy step uses `wrangler pages deploy` and fails or ships a broken artifact | Devil's advocate | H | H | Correct `deployment_target` to `cloudflare-workers` in `tech-stack.md` before the deploy step. Confirm the deploy command is `wrangler deploy` in `deploy-plan.md` |
| GitHub Action templated for `cloudflare/pages-action` breaks the auto-deploy-on-merge flow | Devil's advocate | M | M | Inspect `.github/workflows/` before first merge to main; replace with `wrangler-action` or a plain `npx wrangler deploy` step using a scoped `CLOUDFLARE_API_TOKEN` |
| Server-side generation trips the 10ms free-tier CPU limit, producing 1015 errors and breaking the "under 5s" criterion | Devil's advocate / Pre-mortem | M | H | Implement the rarity-distribution generator in the React island (client-side). Data is browser-local anyway — server-side generation buys nothing |
| `output: "server"` carries a workerd runtime failure surface the PRD never asked for | Devil's advocate | M | M | Evaluate `output: "static"` before implementation. Every FR is satisfied by static + browser storage; revisit only if v2 cloud sync lands |
| Agent writes `Astro.locals.runtime.env` (removed in v13) from training-data habit; silent `undefined` at runtime | Devil's advocate / Unknown unknowns | H | M | Record the v13 access pattern in `AGENTS.md`/`CLAUDE.md`: use `astro:env` or `import { env } from 'cloudflare:workers'`. Consider a `/10x-lesson` entry — this is a class of failure, not a one-off |
| `@supabase/ssr` on workerd is unverified at these pinned versions; the "ready-made v2 path" may not be ready | Devil's advocate / Research finding | M | M | Do not treat Supabase-on-Workers as proven. Spike it before committing v2 cloud sync to a roadmap; PRD Open Question #4 stays open |
| Copied `wrangler.jsonc` with `compatibility_date` < 2026-08-04 silently disables `nodejs_compat` | Unknown unknowns / Pre-mortem | M | M | Write `wrangler.jsonc` explicitly with `compatibility_date` ≥ 2026-08-04, or list `nodejs_compat` in `compatibility_flags` regardless. Never copy a config wholesale from a blog post |
| Global `npm i -g wrangler` shadows the pinned `^4.90.0` and drifts outside the adapter peer range `^4.83.0` | Unknown unknowns | M | L | Use `npx wrangler` in every command, script, and CI step. Never install wrangler globally |
| Time budget: 13 must-have FRs against a 2026-09-13 hard deadline; deploy friction eats implementation time | Research finding | M | H | Cloudflare was chosen partly because migration cost is zero. Deploy early on a stub to de-risk the pipeline before features land — not on deadline day |
| Cloudflare MCP catalog status is unlabelled (neither GA nor beta confirmed) | Research finding | L | L | Start with CLI only; it covers the full loop. Add MCP later if a recurring pattern of `--help` traversal appears |
| Runtime image optimisation silently passes through unoptimised (Sharp cannot run in workerd) | Unknown unknowns | L | L | Accept for v1 — the app renders a table, not media. If images arrive, use the `cloudflare-binding` image service |
| Preview URLs are public by default; item pools may carry SRD licensing sensitivity | Research finding | L | M | Resolve PRD Open Question #2 (data source and licence) first. Gate previews with Cloudflare Access if non-SRD data ever lands in the repo |

## Getting Started

Commands validated against the **exact pinned versions** (`astro@^6.3.1`, `@astrojs/cloudflare@^13.5.0`,
`wrangler@^4.90.0`), not against general Cloudflare documentation. Several widely-published Cloudflare + Astro
instructions are wrong for this combination and are called out inline.

1. **Fix the stale contract first.** In `context/foundation/tech-stack.md`, change
   `deployment_target: cloudflare-pages` to `cloudflare-workers`. Everything downstream reads that field as
   ground truth, and Pages is unreachable with adapter v13.

2. **Write `wrangler.jsonc` explicitly.** v13 auto-generates a default if the file is absent, but relying on
   that hides the compatibility settings that matter:
   ```jsonc
   {
     "name": "dnd-5e-merchant-generator",
     "main": "@astrojs/cloudflare/entrypoints/server",
     "compatibility_date": "2026-08-04",
     "compatibility_flags": ["nodejs_compat"]
   }
   ```
   The `main` entrypoint is the v13 path — **not** the legacy `dist/_worker.js/index.js`. Build output lands
   in `./dist`.

3. **Develop with `npm run dev` — and nothing else.** In Astro 6 with adapter v13, `astro dev` already runs your
   site in the **real Workers runtime (workerd)** through the Cloudflare Vite plugin. `wrangler pages dev ./dist`
   is **legacy and redundant** here despite appearing in most tutorials; `astro preview` also runs on workerd
   with real bindings.

4. **Authenticate and deploy with the local wrangler.**
   ```bash
   npx wrangler login          # human step — interactive browser auth
   npm run build
   npx wrangler deploy         # NOT `wrangler pages deploy` — v13 dropped Pages
   ```
   Use `npx` throughout; a global wrangler install shadows the pinned version.

5. **Verify the operational loop before writing features.** Run `npx wrangler deployments list`,
   `npx wrangler tail`, and one `npx wrangler rollback [VERSION_ID]` against the stub deploy. Confirming
   rollback works while nothing is at stake is worth more than confirming it during an incident — and with a
   2026-09-13 deadline, the pipeline should be proven before the code that needs it exists.

6. **Wire CI last.** Check `.github/workflows/` for a `cloudflare/pages-action` step and replace it with
   `npx wrangler deploy`, authenticated by a `CLOUDFLARE_API_TOKEN` GitHub Secret scoped to Workers Scripts:Edit
   for this project only — no DNS, no billing, no unrelated projects.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (the CI note above flags a known breakage; it does not design the pipeline)
- Production-scale architecture (multi-region, HA, DR)

---

## Post-Deploy Corrections (2026-09-10)

Five prescriptions above were falsified by actually running the deploy. This section is the
correction; `context/deployment/deploy-plan.md` carries the full measured record.

1. **`compatibility_date: "2026-08-04"` is unreachable with the pinned toolchain.** The workerd
   bundled with `wrangler ^4.90.0` supports at most **2026-05-14**; asking for 2026-08-04 makes
   miniflare refuse to start (`This Worker requires compatibility date "2026-08-04", but the
   newest date supported by this server binary is "2026-05-14"`), breaking all local dev and
   `wrangler dev`. Shipped value is **`2026-05-14`**. There is **no runtime difference**:
   `nodejs_compat_v2` is auto-enabled alongside `nodejs_compat` for dates 2024-09-23 through
   2026-08-03, and `nodejs_compat` is listed explicitly. So the unknown-unknown above is real but
   its mitigation was over-specified — the flag, not the date, is what matters. Raise both
   together when wrangler is next bumped.

2. **"Build output lands in `./dist`" is wrong, and the `wrangler.jsonc` in Getting Started is
   incomplete.** Adapter v13 emits **`dist/client` + `dist/server`** and no `_worker.js`. It
   generates its own config at `dist/server/wrangler.json`, and `wrangler dev`/`deploy`
   **redirect to it** via `.wrangler/deploy/config.json` (the log says `Using redirected Wrangler
   configuration`). That generated config hardcodes `main: "entry.mjs"` and
   `assets.directory: "../client"`, **ignoring the root value entirely** — verified by setting
   `./dist` and `./dist/client` and observing both upload `dist/client`. The root `assets` block
   is documentation, not configuration. An `assets` block is still required by Astro's own docs.

3. **v1 has no required *secrets*, but the first deploy still creates a second resource.** Adapter
   v13.5 auto-injects two bindings declared nowhere: a `SESSION` **KV namespace** (Astro sessions)
   and an `IMAGES` binding. The KV binding carries no id, so wrangler **auto-provisioned it on
   first deploy** (`dnd-5e-merchant-generator-session`, `e4ad93c97c1347caa83f0a60b6b98919`).
   Any abort must delete the namespace as well as the Worker. v1 reads no sessions, so this
   resource exists for nothing.

4. **The `cloudflare/pages-action` risk did not materialize, and step 6 is superseded.**
   `.github/workflows/ci.yml` had no deploy step at all — lint+build only, triggering on `master`
   while the branch is `main`, so it was inert. Trigger corrected to `main`; no deploy job added.
   Auto-deploy on `main` is owned by **Cloudflare Workers Builds** (the platform's own Git
   integration), which means **no `CLOUDFLARE_API_TOKEN` is minted or stored anywhere** — not in
   GitHub Secrets, not locally. The token-minting human gate is off the critical path entirely.
   Do not also add a GitHub Actions deploy job: the two would race for the Active Deployment.

5. **The unverified operational notes now have measured answers.**
   - *Preview URLs*: enabled by default. `wrangler versions upload` returned
     `https://<version-prefix>-dnd-5e-merchant-generator.<subdomain>.workers.dev` with no setting
     to change, and **did not** promote — production stayed on the prior version while the preview
     served the new one.
   - *Rollback scope*: **full, not partial.** `wrangler rollback` reverted the Worker script **and**
     the static assets (measured with paired SSR + static markers). Caveat: the reverted asset was
     briefly served from edge cache (`cf-cache-status: HIT`), so a rollback is not instantly
     visible to every client — verify with a cache-buster, not a plain refresh.
   - *Approval gates*: extended. The list above gates "the *first* production `wrangler deploy`"
     but is silent on `wrangler versions deploy`, which promotes to production just as completely.
     **Any** promotion is human-gated; `versions upload`, `deployments list`, `tail` and `rollback`
     remain the agent's unattended set. Guards are in `.claude/settings.json`.

**Risk register outcomes.** `Astro.locals.runtime.env` (row 5): did not fire — the starter already
uses the v13-correct `astro:env/server`; the rule is now recorded in `AGENTS.md`. Global-wrangler
shadowing (row 7): no global wrangler on PATH; `npx` used throughout. 10 ms CPU ceiling (row 3):
not yet exercised — the stub measured **0–2 ms cpuTime** per request, but it renders a static hero,
not a generator, so the risk stands unchanged for implementation. `output: "static"` (row 4)
remains open and is tracked in `deploy-plan.md` Phase 9.
