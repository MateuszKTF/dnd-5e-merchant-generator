---
bootstrapped_at: 2026-09-10T11:25:29Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: dnd-5e-merchant-generator
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

Source: `context/foundation/tech-stack.md` (read in full at run start).

Frontmatter, verbatim:

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: dnd-5e-merchant-generator
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: false
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
```

### Why this stack

The PRD describes a single-user web app with no accounts, no server-side data and a
one-week budget against a hard deadline, so the pick was optimised for time-to-first-screen
rather than platform reach. The 10x Astro Starter was taken as the recommended default for
web-app + TypeScript: it clears all four agent-friendly gates (explicit types, strong layout
and routing conventions, heavily represented in training data, current version-pinned docs),
which matters more than raw feature count when most of the code will be agent-written under
deadline. Astro plus React islands suits a page that is mostly static chrome around one
interactive table, and Tailwind covers the phone-readability requirement without a custom
responsive layer. Cloudflare Pages is the starter's own adapter target, so deployment is the
cheapest step in the chain; GitHub Actions auto-deploys on merge to main. The one mismatch is
deliberate and known: the starter bundles Supabase auth and Postgres, which Access Control
rules out. Merchants persist in browser storage instead; the Supabase layer stays unwired in
v1 and becomes the ready-made path to the deferred cloud-sync feature in v2.

## Pre-scaffold verification

| Signal      | Value                                                       | Severity | Notes                                                                                    |
| ----------- | ----------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| npm package | not run                                                     | n/a      | `cmd_template` starts with `git clone`; no `create-*` CLI from which to resolve a package |
| GitHub repo | `przeprogramowani/10x-astro-starter` last pushed 2026-08-22 | fresh    | from `card.docs_url`; 19 days before this run, well inside the 3-month fresh threshold     |

No stale signal. Proceeded without a heads-up.

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 19 top-level entries (51 project files excluding `node_modules`; 772 packages installed into `node_modules`)
**Conflicts (.scaffold siblings)**: `CLAUDE.md` sidelined as `CLAUDE.md.scaffold`
**.gitignore handling**: moved silently (absent in cwd, so no append-merge was needed)
**.bootstrap-scaffold cleanup**: deleted
**Upstream git history**: `.bootstrap-scaffold/.git/` deleted before move-up; the starter's history did not enter this repo

### Move detail

| Entry               | Resolution                                        |
| ------------------- | ------------------------------------------------- |
| `.env.example`      | moved                                             |
| `.github/`          | moved                                             |
| `.gitignore`        | moved                                             |
| `.husky/`           | moved                                             |
| `.nvmrc`            | moved                                             |
| `.prettierrc.json`  | moved                                             |
| `.vscode/`          | moved                                             |
| `astro.config.mjs`  | moved                                             |
| `CLAUDE.md`         | sidelined as `CLAUDE.md.scaffold` (existing wins) |
| `components.json`   | moved                                             |
| `eslint.config.js`  | moved                                             |
| `node_modules/`     | moved                                             |
| `package.json`      | moved                                             |
| `package-lock.json` | moved                                             |
| `public/`           | moved                                             |
| `README.md`         | moved                                             |
| `src/`              | moved                                             |
| `supabase/`         | moved                                             |
| `tsconfig.json`     | moved                                             |
| `wrangler.jsonc`    | moved                                             |

The scaffold carried no `context/**` paths, so the drop rule did not fire. Pre-existing `context/`, `.claude/`, and `idea-notes.md` were untouched.

## Post-scaffold audit

**Tool**: `npm audit --json` (exit code 1 — informational only; findings present is not a halt condition)
**Summary**: 2 CRITICAL, 14 HIGH, 8 MODERATE, 3 LOW (27 total across 895 dependencies: 449 prod, 316 dev, 131 optional)
**Direct vs transitive**: 1/0/2/0 direct of total 2/14/8/3. The remaining 24 findings are transitive — advisory until upstream ships fixes.

#### CRITICAL findings

- **`astro`** — installed range `<=7.2.7`, **DIRECT dependency**. Fix available. Aggregates: XSS via unescaped attribute names in spread props; XSS via unescaped spread attribute names in `renderHTMLElement` (incomplete fix for CVE-2026-54298); XSS via unescaped `transition:*` directive values on hydrated islands; reflected XSS via unescaped View Transition animation properties; host-header SSRF in prerendered error-page fetch; reflected XSS via unescaped slot name; **remote code execution through AVIF image optimization**; authorization bypass from a missing path-segment boundary check when stripping the configured base. Also inherits the `esbuild` and `sharp` advisories.
- **`tar`** — installed range `<=7.5.20`, transitive (via `supabase`). Fix available. PAX size-override parser interpretation differential (file smuggling); process crash via PAX numeric path type confusion; decompression/parse DoS via unlimited input; infinite loop on negative tar entry size; uncaught-exception DoS via NUL byte in PAX path/linkpath records; uncontrolled recursion in `mapHas`/`filesFilter` allowing uncatchable stack-overflow DoS.

#### HIGH findings

All 14 are transitive. A fix is available for every entry.

- **`brace-expansion`** (`<=1.1.17 || 3.0.0 - 5.0.8`) — DoS via exponential-time expansion of consecutive non-expanding `{}` groups; unbounded expansion length causing OOM; unbounded intermediate arrays bypassing the CVE-2026-14257 mitigation.
- **`browserslist`** (`<=4.28.6`) — unbounded memory growth (no cache eviction) leading to OOM; uncaught crash / prototype write via untrusted `browserslist-stats.json`.
- **`devalue`** (`5.6.3 - 5.8.0`) — DoS via sparse-array deserialization.
- **`fast-uri`** (`3.0.0 - 3.1.5`) — host confusion via literal backslash authority delimiter, backslash authority introducer, percent-encoded scheme normalization, and failed IDN canonicalization; SSRF via malformed IPv6 normalization and repeated hostname percent-decoding.
- **`js-yaml`** (`4.0.0 - 4.3.1`) — quadratic-complexity DoS in merge-key handling via repeated aliases; quadratic CPU consumption in `!!omap` resolution (CVE-2026-59870 fix not backported); `maxTotalMergeKeys` does not limit CPU for empty merge sources.
- **`miniflare`** (`<=0.0.0-fff677e35 || 3.20250204.0 - 5.20260801.0-alpha`) — inherits `sharp`, `undici`, `ws`.
- **`nanoid`** (`<=3.3.17`) — non-secure generators loop indefinitely on negative size; custom generators loop indefinitely when size is zero.
- **`postcss`** (`<=8.5.22`) — path traversal in previous-source-map auto-loading (`sourceMappingURL`) leading to arbitrary `.map` file disclosure, plus the incomplete fix of GHSA-6g55-p6wh-862q.
- **`sharp`** (`<=0.35.4-rc.0`) — inherited libvips vulnerabilities (CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591) and libheif (GHSA-g89c-p67h-r497, GHSA-2jg2-4ch7-h545).
- **`smol-toml`** (`<=1.7.0`) — DoS via malformed TOML documents.
- **`svgo`** (`4.0.0 - 4.0.2`) — `removeScripts` leaves some executable scripts intact; namespace and control-character bypasses; incomplete sanitization of executable HTML in SVG `foreignObject` elements.
- **`undici`** (`7.0.0 - 7.28.0`) — TLS certificate-validation bypass via dropped `requestTls` in SOCKS5 ProxyAgent; HTTP header injection via `Set-Cookie` percent-decoding; WebSocket DoS via fragment-count bypass; cross-origin request routing via SOCKS5 proxy pool reuse; `SameSite` attribute downgrade; cross-user information disclosure via shared-cache whitespace bypass; downstream response desynchronization via retry interceptor; CRLF injection via blob-like body `type`; cookie attribute injection; HTTP response queue poisoning via keep-alive socket reuse.
- **`vite`** (`7.0.0 - 7.3.3`) — `server.fs.deny` bypass on Windows alternate paths; `launch-editor` NTLMv2 hash disclosure via UNC path handling on Windows.
- **`ws`** (`8.0.0 - 8.20.1`) — uninitialized memory disclosure; memory-exhaustion DoS from tiny fragments and data chunks.

#### MODERATE findings

- **`supabase`** (`1.1.6 - 2.98.2`) — **DIRECT dependency**; inherits `tar`.
- **`wrangler`** (`<=0.0.0-kickoff-demo || 3.108.0 - 4.101.0`) — **DIRECT dependency**; inherits `esbuild` and `miniflare`.
- **`@astrojs/language-server`** (`2.14.0 - 2.16.10`) — transitive; inherits `volar-service-yaml`.
- **`@cloudflare/vite-plugin`** (`<=0.0.0-fff677e35 || 0.0.7 - 1.41.0`) — transitive; inherits `miniflare`, `wrangler`, `ws`.
- **`baseline-browser-mapping`** (`>=2.0.0 <2.11.0`) — transitive; process termination on invalid input causes DoS.
- **`volar-service-yaml`** (`<=0.0.70`) — transitive; inherits `yaml-language-server`.
- **`yaml`** (`2.0.0 - 2.8.2`) — transitive; stack overflow via deeply nested YAML collections.
- **`yaml-language-server`** (`1.11.1-08d5f7b.0 - 1.21.1-f1f5a94.0 || 1.22.1-0ae5603.0 - 1.22.1-fc5f874.0`) — transitive; inherits `yaml`.

#### LOW / INFO findings

- **`@babel/core`** (`<=7.29.0`) — transitive; arbitrary file read via `sourceMappingURL` comment.
- **`esbuild`** (`0.27.3 - 0.28.0`) — transitive; arbitrary file read when running the development server on Windows.
- **`postcss-selector-parser`** (`7.1.0 - 7.1.2`) — transitive; DoS through uncontrolled AST recursion.

No auto-fix was run. `npm audit fix` reports a fix path for every finding above; applying it is the user's call.

## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | github-actions       |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | false                |
| has_payments            | false                |
| has_realtime            | false                |
| has_ai                  | false                |
| has_background_jobs     | false                |

None of these changed the scaffold in v1. Two are worth flagging for whoever picks up next: `deployment_target: cloudflare-pages` matches the starter's own adapter (this run generated no CI/CD files beyond whatever the starter itself ships under `.github/`), and the hand-off records `has_auth: false` against a starter that bundles Supabase auth — the deliberate mismatch described in the hand-off body.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history — this run deliberately deleted the starter's upstream `.git/`.
- Review `CLAUDE.md.scaffold` against your existing `CLAUDE.md` (`diff CLAUDE.md CLAUDE.md.scaffold`) and decide which content to keep. Your current `CLAUDE.md` documents the bootstrap-chain lesson; the starter's version documents the Astro codebase.
- Address audit findings per your project's risk tolerance. The single direct CRITICAL (`astro`) is the highest-leverage upgrade — the full breakdown is above.
