---
project: dnd-5e-merchant-generator
planned_at: 2026-09-10
platform: Cloudflare Workers
worker_name: dnd-5e-merchant-generator
account_id_source: env/oauth (not committed)
auto_deploy_owner: cloudflare-workers-builds
context_type: deployment
status: deployed-pending-auto-deploy
deployed_at: 2026-09-10
production_url: https://dnd-5e-merchant-generator.mateusz-kotowicz.workers.dev
active_version: c33fb0eb-510c-47d5-b9b5-85e6774b0fe6
provisioned_resources:
  - kv_namespace: dnd-5e-merchant-generator-session (e4ad93c97c1347caa83f0a60b6b98919)
secrets_wired: none
phases_complete: [0, 1, 2, 3, 4, 5, 6]
phases_remaining: [7, 8]
---

# First production deployment — Cloudflare Workers

Audit trail for the Plan-Mode deploy of the **starter stub**, run against
`context/foundation/infrastructure.md` (researched 2026-09-10) and
`context/foundation/tech-stack.md`. Deploying a stub rather than the finished product is
deliberate — `infrastructure.md` "Getting Started" step 5: prove
`build → deploy → tail → rollback` while nothing is at stake, ahead of the **2026-09-13**
hard deadline.

Downstream milestone planning should read this file as ground truth for "what is already
deployed and which secrets are already wired".

## Decisions taken before execution

1. **Auto-deploy on `main` is owned by Cloudflare Workers Builds**, not GitHub Actions. This
   supersedes `infrastructure.md` step 6 and means **no `CLOUDFLARE_API_TOKEN` is minted or
   stored anywhere** — not in GitHub Secrets, not locally.
2. This file lives at `context/deployment/deploy-plan.md` (the CLAUDE.md contract path), not
   the `context/changes/deployment/deployment-plan.md` path named in
   `.claude/prompts/m1l5-4-store-plan.md`.
3. `output: "server"` is retained. Static-vs-server is a pre-implementation decision, tracked
   unchecked in Phase 9 rather than mixed into a first deploy.
4. The public stub renders the starter hero and the Polish banner "Supabase nie jest
   skonfigurowany — funkcje uwierzytelniania są wyłączone." **Accepted.** The repo is public,
   so this is visible to anyone who finds the URL.
5. **Any** promotion to production is human-gated — `wrangler deploy` *and*
   `wrangler versions deploy`. The agent's unattended set is `astro build`,
   `wrangler versions upload`, `deployments list`, `tail`, `rollback`.

## Four corrections the execution forced on `infrastructure.md`

These were discovered by running the plan, not by reading docs. All four contradict a
prescription in `infrastructure.md` and should be treated as the corrected record.

| # | `infrastructure.md` prescribed | Reality | Consequence |
| --- | --- | --- | --- |
| 1 | `compatibility_date: "2026-08-04"` | The workerd bundled with the pinned `wrangler ^4.90.0` supports **at most 2026-05-14**. Setting 2026-08-04 makes miniflare refuse to start: *"This Worker requires compatibility date 2026-08-04, but the newest date supported by this server binary is 2026-05-14."* | Capped at `2026-05-14`. **No runtime difference**: `nodejs_compat_v2` is auto-enabled alongside `nodejs_compat` for dates 2024-09-23 → 2026-08-03, and `nodejs_compat` is listed explicitly. Raise the date and drop the flag together when wrangler is next bumped. |
| 2 | Write `wrangler.jsonc` with `main` + `compatibility_*` only; build output "lands in `./dist`" | Adapter v13 emits **`dist/client` + `dist/server`**, no `_worker.js`. It generates its own config at `dist/server/wrangler.json` and `wrangler dev`/`deploy` **redirect to it** (`.wrangler/deploy/config.json`). That generated config hardcodes `main: "entry.mjs"` and `assets.directory: "../client"`, **ignoring the root value entirely** (verified: setting `./dist` and `./dist/client` both upload `dist/client`). | Root `assets.directory` is documentation, not configuration. Never point it at `./dist` and assume that is what ships. |
| 3 | Risk register: "GitHub Action templated for `cloudflare/pages-action` breaks auto-deploy" | **Did not materialize.** `ci.yml` has no deploy step at all — it is lint+build only, and it triggered on `master` while the branch is `main`, so it was inert. | Nothing to replace. Trigger corrected to `main`; no deploy job added (the platform owns deploys). |
| 4 | v1 has "no required secrets"; image service defaults to passthrough | Adapter v13.5 **auto-injects two bindings** not declared anywhere: a `SESSION` **KV namespace** (Astro sessions) and an `IMAGES` binding (Cloudflare Images). The KV binding carries no namespace id, so wrangler **auto-provisions it on first deploy** (needs ≥4.45.0; pinned 4.90.0 qualifies). | Still no *secrets*, but the first deploy **creates a KV namespace** as a side effect. The abort path must delete it too. v1 uses no server sessions, so this resource is created for nothing. |

## Prerequisites — CLI configuration · **VERIFIED 2026-09-10**

Everything runs through `npx`. Never `npm i -g wrangler`: a global binary shadows the pinned
`^4.90.0` and can drift outside the adapter's `^4.83.0` peer range.

- [x] `node -v` → `v24.16.0` (≥ Astro 6's 22.12.0 floor; `.nvmrc` pins `22.14.0`)
- [x] `npx wrangler --version` → `4.90.0`, no global wrangler on PATH
- [x] No stale credential env vars — `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
      `CF_API_TOKEN`, `CLOUDFLARE_EMAIL`, `CLOUDFLARE_API_KEY` all empty. This matters: a set
      `CLOUDFLARE_API_TOKEN` **silently overrides** the OAuth session.
- [x] No Cloudflare MCP server. `infrastructure.md` records the catalog status as *unlabelled*;
      the CLI covers the whole loop. Revisit only if a recurring `--help` traversal pattern appears.

## Phase 0 — Contract + identity hygiene · **AGENT** · ✅ COMPLETE

The Worker `name` is its identity, its public hostname, **and** the key Workers Builds matches
on. Deploying once as `10x-astro-starter` would have permanently created the wrong Worker;
renaming afterwards creates a *second* one and orphans the first, removable only by
`wrangler delete` (human gate).

- [x] `context/foundation/tech-stack.md`: `deployment_target: cloudflare-pages` →
      `cloudflare-workers`, plus the "Why this stack" prose that still named Pages and GitHub
      Actions
- [x] `wrangler.jsonc`: `name` → `dnd-5e-merchant-generator`; `compatibility_date` →
      `2026-05-14` (see correction #1); `compatibility_flags` →
      `["nodejs_compat", "global_fetch_strictly_public"]`; **dropped
      `assets.not_found_handling: "404-page"`** — there is no `src/pages/404.astro` and
      `output: "server"` emits no static `dist/404.html`, so it pointed at a file that would
      never exist. The default falls unmatched asset requests through to the Worker.
- [x] `package.json`: `name` → `dnd-5e-merchant-generator`, added
      `"engines": { "node": ">=22.12.0" }`, added `"cf:upload": "astro build && wrangler versions upload"`
- [x] `package-lock.json` **re-synced** (`npm install --package-lock-only`). It still carried
      `name: 10x-astro-starter`, which would have broken `npm ci` in Workers Builds. Diff is
      metadata plus optional bundled-wasm normalization — **zero** resolved-URL or dependency
      version changes.
- [x] Deliberately did **not** add an `npm run deploy` script: `Bash(npm *)` is allowlisted
      unprompted, so it would route the human-gated action around its own gate.
- [x] `.github/workflows/ci.yml`: `branches: [master]` → `[main]` in both triggers. No deploy job.
- [x] `.claude/settings.json`: added to `permissions.ask` — `Bash(npx wrangler deploy*)`,
      `versions deploy*`, `delete*`, `secret*`, `login*`, `logout*`. Defence-in-depth, not
      enforcement (prefix matching may not catch every invocation shape).

**Verified:** `npx astro sync` ✅ · `npx astro build` ✅ · `npx wrangler deploy --dry-run` ✅
(1910.32 KiB / gzip 390.57 KiB, 21 modules, 10 asset files from `dist\client`, bindings
`SESSION` / `IMAGES` / `ASSETS` all resolved).

**Known non-blocker:** `npm run lint` reports 1022 errors locally, **all** of them
`Delete ␍` — zero real lint errors. Cause: git stores LF, `core.autocrlf=true` checks out
CRLF, and there is no `.gitattributes`. Prettier's `endOfLine` is unset (default `lf`). On
`ubuntu-latest` the checkout is LF, so **CI passes** and pointing CI at `main` is safe. The
papercut is that `AGENTS.md`'s documented "run `npm run lint` before pushing" is impossible on
this Windows checkout until a `.gitattributes` with `* text=auto eol=lf` is added.

## Phase 1 — Local production-fidelity preview · **AGENT** · ✅ COMPLETE

`npx astro build && npx wrangler dev` (port 8787). Confirmed in the log:
`Using redirected Wrangler configuration → dist\server\wrangler.json`.

Do **not** use `npx wrangler pages dev ./dist` — legacy for v13, and there is no `_worker.js`.
Do **not** substitute `astro dev`: it runs on workerd but not against `wrangler.jsonc`.

| Path | Result | Proves |
| --- | --- | --- |
| `/` | 200 `text/html`, 5141 B, `marker-A` present | SSR renders; **no `[object Object]`** |
| `/does-not-exist` | 404 `text/html` | dropping `not_found_handling` behaves |
| `/favicon.png` | 200 `image/png` | `assets.directory` → `dist/client` wiring |
| `/build-marker.txt` | 200 `text/plain` | static marker for the rollback drill |
| `/dashboard` | 302 → `/auth/signin` | middleware executes |

- [x] Zero `1101` / uncaught-exception / error entries in the runtime log
- [x] Build markers in place: `<meta name="build-marker" content="marker-A">` (SSR, in
      `src/layouts/Layout.astro`) **and** `public/build-marker.txt` (static). Both are needed
      to answer whether rollback reverts assets as well as the script.
- [x] **astro#15434 cleared.** The `[object Object]` failure shape (Astro 6 + adapter v13 +
      middleware + `nodejs_compat`) does **not** reproduce at 6.3.1 / 13.5.0 with
      `src/middleware.ts` present. The original report said dev was unaffected, so this was
      tested against `wrangler dev` on the built output — the only honest test.

## Phase 2 — Account, subdomain, auth · **HUMAN** · ✅ COMPLETE

- [x] Cloudflare account exists
- [x] `wrangler login` — already authenticated. `npx wrangler whoami`: **OAuth token**
      (not an API token), **exactly one** account, scopes include `workers (write)`,
      `workers_scripts (write)`, `workers_kv (write)` (needed for the KV auto-provision) and
      `workers_tail (read)`.
- [x] **workers.dev subdomain claimed** — was already claimed as `mateusz-kotowicz`, proven by
      the first deploy returning a hostname with no registration prompt. Account-global,
      one-time, permanent.

## Phase 3 — Name-collision pre-flight · **AGENT** · ✅ COMPLETE

- [x] `npx wrangler deployments list` → `This Worker does not exist on your account.
      [code: 10007]` — the expected good result. The name is **free** on this account.

Worker names are unique per account, not globally; the hostname is
`<worker-name>.<subdomain>.workers.dev`.

## Phase 4 — First production deploy · **HUMAN** · ✅ COMPLETE

`npx astro build && npx wrangler deploy`. First attempt failed with
`EPERM, Permission denied: dist\client` — see the orphaned-workerd edge case below.

**Live:** `https://dnd-5e-merchant-generator.mateusz-kotowicz.workers.dev`
**First version:** `87dd3b89-e2e2-4a37-96a2-155ddb80fe4e` · Worker startup **25 ms** ·
1910.38 KiB / gzip 390.61 KiB · 9 assets

**Side effect, as predicted:** wrangler auto-provisioned the KV namespace
`dnd-5e-merchant-generator-session` (`e4ad93c97c1347caa83f0a60b6b98919`). Two resources exist,
not one. Any abort must delete both.

- [x] `/` → 200, `marker-A`, `cf-ray` present, **no `[object Object]`**
- [x] `/build-marker.txt` → 200 `text/plain`; `/favicon.png` → 200 `image/png`
- [x] `/does-not-exist` → 404; `/dashboard` → 302 → `/auth/signin`; `/auth/signin` → 200
- [x] `npx wrangler deployments list` → exactly one deployment
- [x] `npx wrangler tail --format json` → `outcome: "ok"`, `exceptions: []`,
      **cpuTime 0–2 ms** (ceiling is 10 ms), wallTime 3–4 ms, colo `WAW`

**⚠️ Propagation delay is real.** For roughly the first 30–60 s after the very first deploy,
**every path returned 404** — Cloudflare's, not the Worker's. It resolved with no intervention.
Do not diagnose a fresh first deploy on the first request; wait a minute and retry before
touching anything.

**Abort had no rollback target** (no prior version). The only undo would have been
`npx wrangler delete --name dnd-5e-merchant-generator` plus deleting the KV namespace — both
human gates. That asymmetry is why Phases 0–3 were all made green first.

## Phase 5 — Prove the operational loop · **AGENT**, one human promotion · ✅ COMPLETE

The full loop was exercised end to end on the stub, exactly as `infrastructure.md` step 5 asks.

- [x] Markers flipped to `marker-B` → `npm run cf:upload` → version
      `e3e56fc5-602f-4338-8f56-bcc30afe1c7f`, preview URL
      `https://e3e56fc5-dnd-5e-merchant-generator.mateusz-kotowicz.workers.dev`
- [x] **`versions upload` does not promote** — measured: production served `marker-A` (SSR *and*
      static) while the preview served `marker-B`. Non-live upload is genuinely agent-safe.
- [x] **Preview URLs are on by default.** No setting had to be enabled; this resolves the
      "not verified in this research pass" note in `infrastructure.md`.
- [x] Promoted with `npx wrangler versions deploy <id>@100 --yes --message "…"` (**HUMAN**) →
      production advanced to `marker-B`
- [x] Rolled back with `npx wrangler rollback 87dd3b89-… --message "…"` → production returned to
      `marker-A`. Note `--message` does *not* skip the confirm prompt as documented; wrangler
      instead printed `Using fallback value in non-interactive context: yes` and proceeded.
- [x] **Measured answer: rollback is a FULL revert, not partial.** Both the SSR meta tag and the
      static `build-marker.txt` reverted together, so static assets *are* versioned with the
      Worker script.
- [x] **But rollback is not instantly visible.** Immediately after a successful rollback,
      production still served `marker-B` from edge cache (`cf-cache-status: HIT`) even with
      `cache: "no-store"`. A cache-busting query string showed `marker-A` at once. Verify a
      rollback with a cache-buster, never a plain refresh — otherwise you will conclude the
      rollback failed when it did not.
- [x] Markers removed afterwards; `src/layouts/Layout.astro` is byte-identical to `HEAD`.

## Phase 6 — Resolve `site` + sitemap · **AGENT** · ✅ COMPLETE

Every build warned `[@astrojs/sitemap] The Sitemap integration requires the `site` astro.config
option. Skipping.` Non-fatal, but it never produced a sitemap.

- [x] `sitemap()` **removed** from `integrations` in `astro.config.mjs` (import dropped too),
      rather than pinning `site`. A single-view generator with browser-local state has no
      sitemap to publish, and pinning `site` to a workers.dev host would need re-pinning if a
      custom domain lands. `@astrojs/sitemap` stays in `package.json` — re-add the integration
      together with `site` if that changes.
- [x] Build is now warning-free
- [x] Final clean deploy: version `c33fb0eb-510c-47d5-b9b5-85e6774b0fe6`, startup **31 ms**.
      Production now matches the repo exactly — **7/7** verification checks pass:
      `/` 200 · `/favicon.png` 200 · `/auth/signin` 200 · `/does-not-exist` 404 ·
      `/dashboard` 302 · `/build-marker.txt` 404 (removed) · `/sitemap-index.xml` 404 (removed)

## Phase 7 — Connect Workers Builds · **HUMAN** · ⬜ PENDING

Workers Builds builds the **committed** repo. `AGENTS.md`,
`context/foundation/infrastructure.md`, this file, and four `.claude/skills/*` dirs are
untracked or modified — commit and push first, or the platform builds a tree that does not
match the machine.

- [ ] Commit Phases 0–6 plus the untracked additions; `git push`
- [ ] Dashboard → the **existing** Worker → Settings → Builds → Connect repository → install
      the Cloudflare GitHub App on `MateuszKTF/dnd-5e-merchant-generator`
- [ ] If offered "Create → Import a repository" instead, **decline** — that path hands the
      first production deploy to the platform, breaking the Phase 4 human gate
- [ ] Dashboard Worker name must equal `dnd-5e-merchant-generator` exactly, or the build fails
- [ ] Install `npm ci` (lockfile is committed **and now name-synced**), build `npx astro build`
- [ ] **First automated build's deploy command: `npx wrangler versions upload`** (non-promoting)
- [ ] Settings → Build → Branch control: production branch `main` (GitHub's default is already
      `main`; confirm anyway)
- [ ] Non-production branch builds **OFF** — preview URLs are public, the repo is public, and
      there is no branch-pattern filtering (production-only or all branches)
- [ ] Compare the Active Deployment id immediately before and after connecting. Connecting is
      expected to be inert until the next push; if it moved, stop and reassess.
- [ ] No-op commit → build green → `deployments list` shows a **new version, same Active
      Deployment**. Then flip the deploy command to `npx wrangler deploy` and push again →
      Active Deployment advances.
- [ ] Read the first build log's Node version. If not 22.x, set a `NODE_VERSION` build variable
      to `22.14.0` (whether Workers Builds honours `.nvmrc` is unconfirmed).
- [ ] **Never both CI paths.** A GitHub Actions deploy job *and* Workers Builds would
      double-deploy and race for the Active Deployment.

## Phase 8 — Runbook, guardrails, contract sync · **AGENT** · ⚠️ MOSTLY COMPLETE

- [x] `infrastructure.md` amended with a **Post-Deploy Corrections** section carrying all five
      falsified prescriptions, the measured preview-URL and rollback-scope answers, the
      extended approval gate, and per-row risk-register outcomes
- [x] `AGENTS.md` extended: never `wrangler pages deploy`; always `npx wrangler`; promotion is
      human-only; the v13 env-access rule (`astro:env/server` / `cloudflare:workers`, **never**
      `Astro.locals.runtime.env` / `.cf` / `.caches`); `wrangler dev` vs `astro dev`;
      `cf:upload` and `tail`; browser storage is forward-only; generate client-side because of
      the 10 ms CPU ceiling; the CRLF lint caveat replacing the stale "CI is inert" note
- [x] Monitoring documented: `npx wrangler tail`; alert on `outcome: "exceededCpu"`, `1101`,
      `1015`. Note `--format json` emits ~130 lines per request — drop it for human reading.
- [x] Build markers removed; `src/` byte-identical to `HEAD`
- [ ] `/10x-lesson` entry for the `Astro.locals.runtime.env` failure class
      (`context/foundation/lessons.md` still does not exist; the skill self-bootstraps it).
      Deferred — the rule is already recorded in `AGENTS.md`.
- [ ] Decide on `.gitattributes` (`* text=auto eol=lf`). It would make `AGENTS.md`'s documented
      pre-push `npm run lint` actually runnable on Windows, but normalizes line endings across
      every file in one commit. Left to the owner because of the churn, not because it is wrong.

## Phase 9 — Deliberately deferred · out of scope for this deploy

- [ ] **Evaluate `output: "static"`.** Every PRD functional requirement is satisfied by a static
      build plus browser storage; SSR buys the workerd failure surface and the 10 ms CPU ceiling
      for nothing. Blocked on removing `src/middleware.ts`, `src/pages/api/auth/*`,
      `src/pages/auth/*`, `src/pages/dashboard.astro`.
- [ ] **Strip the starter auth surface.** Removes the public red Supabase banner, three
      `/api/auth/*` routes that will 500 against unconfigured Supabase, the `Astro.locals.user`
      coupling, and the astro#15434 shape. Also drops **~707 KiB** of Supabase from a 1910 KiB
      bundle — 37% of the Worker is an auth library the PRD says v1 never uses.
      `AGENTS.md` already forbids building on that layer.
- [ ] **Generate rarity-weighted assortments client-side, in the React island.** Server-side
      generation aims the 10 ms CPU cliff at the PRD's "under 5 seconds" primary success
      criterion, and the data is browser-local anyway.
- [ ] Disable Astro sessions if possible, to stop provisioning a `SESSION` KV namespace v1 never reads.
- [ ] Custom domain (human gate); Cloudflare Access on preview URLs only if non-SRD data lands
      (PRD Open Question #2); Supabase-on-workerd spike before committing v2 cloud sync
      (PRD Open Question #4).

## Edge cases and support steps

**`wrangler login` on Windows/PowerShell.** Starts a local callback listener (~`localhost:8976`)
and opens the default browser. Windows Defender Firewall may prompt for Node — allow on the
private profile. If the browser does not open or the callback is blocked:
`npx wrangler login --browser=false` and paste the URL manually. Never hand-edit the stored
token; reset with `npx wrangler logout` then `login`.

**`CLOUDFLARE_API_TOKEN` shadowing OAuth.** If set, it takes precedence over the login session
and you may deploy as an unintended identity. Verified empty; re-read the auth-method line from
`npx wrangler whoami` if anything looks wrong.

**Multiple Cloudflare accounts.** With more than one, wrangler prompts interactively and
**fails** in a non-TTY shell. This account has exactly one. If that changes, capture the id from
`whoami` and set `CLOUDFLARE_ACCOUNT_ID` in the shell profile or an untracked local env file.
Do **not** commit `account_id` into `wrangler.jsonc` — the repo is public.

**workers.dev subdomain not claimed.** Symptom: the deploy asks to register a subdomain, or
succeeds but prints no URL. Fix in the dashboard before Phase 4. Account-global and one-time.

**Worker name collision.** Detect with `npx wrangler deployments list`: `code: 10007` means
free, a listing means occupied. Never resolve a collision by deploying over an existing Worker.

**Orphaned `workerd.exe` locks `dist/client` on Windows.** Killing `wrangler dev` leaves its
`workerd.exe` child alive — still LISTENING on 8787 and holding `dist/client`, so the next
`astro build` dies with `EPERM, Permission denied: \\?\C:\...\dist\client` during `emptyDir`.
The tell is `Default inspector port 9229 not available, using 9230 instead`. Fix:
`netstat -ano | grep ":8787"` to find the pid, then `taskkill //PID <pid> //F` for every
`workerd.exe` (`tasklist //FI "IMAGENAME eq workerd.exe"`). Always confirm port 8787 is free
after stopping a dev server.

**First-deploy propagation delay.** For ~30–60 s after the very first deploy of a new Worker,
every path returns **404** from Cloudflare's edge, not from the Worker. It clears by itself.
Wait and retry before debugging.

**Edge cache hides a successful rollback.** See Phase 5 — verify with a cache-busting query
string, not a refresh.

**Docs conflict — ignore Cloudflare's own Astro guide for `main`.** Cloudflare's Workers
framework guide still prescribes `main: "./dist/_worker.js/index.js"` plus
`assets.directory: "./dist"`. That is the pre-v13 layout; v13 produces no `_worker.js` at all.
The adapter's own docs and the installed package's `exports` both confirm
`@astrojs/cloudflare/entrypoints/server`. Do not "fix" the config toward the Cloudflare page.

**Node version drift.** Local `v24.16.0`, `.nvmrc` `22.14.0`, CI `22`, Workers Builds unknown.
All clear Astro 6's 22.12.0 floor. Hedged by `engines.node` and the Phase 7 build-log check.

## Operational runbook

```bash
# offline config + build integrity
npx astro sync && npx astro build && npx wrangler deploy --dry-run

# production-fidelity local run (against wrangler.jsonc, via the generated redirect)
npx astro build && npx wrangler dev

# live state (read-only, agent-safe)
npx wrangler whoami
npx wrangler deployments list
npx wrangler versions list

# non-live preview (agent-safe)
npm run cf:upload

# live logs
npx wrangler tail --format json

# rollback (recovery, agent-safe)
npx wrangler rollback <VERSION_ID> --message "reason"

# promotion (HUMAN ONLY)
npx wrangler deploy
npx wrangler versions deploy
```

## Out of scope

Docker images, GitHub Actions deploy pipelines (deliberately replaced by Workers Builds),
multi-region / HA / DR, and any feature implementation. This plan deploys a stub.
