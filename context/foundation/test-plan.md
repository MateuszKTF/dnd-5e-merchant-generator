# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-14

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in `<area>`"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `scripts/` — excluding
`node_modules/`, `dist/`, `context/`, and the one-off starter-auth deletion
commit, whose file counts are churn from a removal rather than live
authoring.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | A merchant write fails (quota exhausted, storage blocked, document unreadable) and the interface reports success anyway; the GM discovers the loss on the next session | High | High | interview Q1; PRD §Success Criteria Guardrails; PRD FR-009; lessons L-05 (storage status→message mapping is outside the runner's scope); hot-spot dir `src/components/` — 42 touches/30d |
| 2 | The last generated merchant is not auto-persisted on the path that matters; the GM closes the tab mid-session and reopens to stale or empty state | High | High | interview Q2 (already burned here); PRD US-03, FR-009; roadmap S-03; hot-spot dirs `src/lib/` — 54 touches/30d, `src/components/` — 42 touches/30d |
| 3 | Manual price/quantity corrections are lost or corrupted — across a save/reload round-trip, or discarded by a regenerate whose confirmation guard misses a case | High | High | interview Q2 (already burned here); PRD FR-006, FR-008, US-02 acceptance criteria; roadmap S-02 (names FR-008 the most expensive element of v1) |
| 4 | The transient↔standing lifecycle goes wrong: promotion duplicates a library entry, a standing merchant silently reverts to episodic, or the library link is lost after promotion | High | High | interview Q3; roadmap S-03 Unknown (explicitly warns the S-04 list may receive duplicates); lessons L-05; hot-spot dir `src/lib/` — 54 touches/30d |
| 5 | An untrusted stored document — malformed, truncated, hand-edited, or written by another application on the same origin — is read and silently discarded, so the GM's merchants vanish with nothing said | High | Low | abuse lens (untrusted input); AGENTS.md hard rule (expected failure returns a discriminated union, never throws); PRD §Success Criteria Guardrails; interview Q1 |
| 6 | A storage schema change ships and a device holding the other format loses its merchants; a Worker rollback reverts code and assets but not the GM's browser storage | High | Medium | AGENTS.md hard rule (browser-storage schema changes are forward-only; rollback asymmetry); PRD §Success Criteria Guardrails; roadmap F-01 |
| 7 | A GM cannot see which control they are on, or the page scrolls sideways on a phone at the table | Medium | Medium | PRD §Non-Functional Requirements (the only NFR); AGENTS.md §Style (WCAG AA contrast floors); lessons L-04 (the a11y rules are configured for React files and return an empty visitor on them, so nothing is enforced) |
| 8 | Two tabs on one device: the second replaces the first's merchant and its entire correction overlay with no confirmation, and cancels a confirmation the GM is mid-answer on | High | Medium | rollout Phase 1 research; `manual-item-corrections` plan (the cross-tab path is a recorded carve-out from "every path is guarded"); PRD FR-006 |
| 9 | The documented compensating control for untested islands — manual verification steps in each plan — is credited but not performed, so a layer believed to be checked is checked by nothing | High | High | rollout Phase 1 research; unticked manual criteria across three archived change folders; lessons L-04, L-05 |
| 10 | A notice reporting an irreversible loss is classified as episodic and erased by the GM's own next successful write, turning a reported loss into a silent one | High | Medium | rollout Phase 1 research; PRD §Success Criteria Guardrails |

High-impact × Low-likelihood scenarios were deliberately not padded into
this map. One was identified — a Supabase credential reaching the public
client bundle — and it is handled as a build-time gate in §5 rather than as
a test, which is both the cheaper and the more reliable response.

**Corrections backported from rollout Phase 1 research (2026-09-14).** Risks
#1–#7 were written before any of this code had been read. Three rows were
wrong and are corrected above; the evidence is in
`context/changes/testing-island-reachability/research.md`.

- **Risk #5 was over-stated.** There is no uncaught-throw path at the read or
  parse boundary — every hazard is guarded and the storage modules contain no
  `throw` at all. Only the silent-discard half survives, and it is the
  best-covered risk on this map. Likelihood lowered High → Low.
- **Risk #7's premise was wrong.** Tap targets are enforced on every
  interactive control. The real defect is that the primary buttons remove the
  browser's focus ring and replace it with one at roughly 1.3:1, well under the
  3:1 floor. The horizontal-scroll risk is the footer, not the table. And the
  a11y gate is not narrowly scoped, it is **inert**: the rules are configured
  for React files and return an empty visitor on them.
- **Risk #6 stands, and its anti-pattern was already present.** Every version
  fixture was computed from the schema constant, so all of them would have
  moved the day it did. A frozen fixture now exists; the migration seam is
  still a comment with no runner behind it.
- **Risks #8–#10 are new**, appended rather than renumbered.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|---|---|---|---|---|---|
| #1 | A failed write never renders as a success, and the GM sees an explicit notice that distinguishes one failure kind from another | "The write returned, therefore it saved" — and "the storage module is tested, therefore the reporting is" (lessons L-05) | How storage outcomes are modelled, which outcomes exist, where the outcome is translated into user-facing text, and whether that translation is reachable by the runner at all | Component test in the `dom` project — the mapping is a pure function of props, so integration buys nothing extra | Asserting the message string copied out of the component under test — the oracle must come from the PRD guardrail, not from the code. Assert instead that *something* is said and that different failures say different things |
| #2 | Closing and reopening restores the last merchant including edits made seconds earlier, with no explicit user action | "Autosave is wired, therefore it fires" — which trigger actually commits, and whether an edit counts as one | The persist trigger and its lifecycle, and what a mount-time restore actually reads. (There is no debounce — persistence is imperative from event handlers only. The real loss window is a cell draft that was typed but never committed, on a phone whose OS kills the tab.) | Integration round-trip: write, then re-read as a fresh mount | Exercising the persist function directly while never exercising the trigger — lessons L-03 is exactly this failure |
| #3 | An edited price or quantity survives a round-trip unchanged, and a regenerate with corrections present cannot proceed unconfirmed | "Editing the cell updated the model" and "a confirmation exists, therefore it covers every path" | Where an edit is committed versus held in transient state, and how the confirmation guard decides that corrections exist | Unit for the correction merge, integration for the guard path | Over-mocking the dialog so the guard's actual condition is never evaluated |
| #4 | Promotion produces exactly one library entry, identity stays stable across it, and a standing merchant never silently becomes episodic | "Promotion was called, therefore it minted" — the storage audit already found an assertion that never invoked the function it claimed to guard | The identity and relink rule, the standing-versus-episodic policy, and any ordering guarantee between session state and library state | Unit on the lifecycle rule, plus a mechanically enforced cross-module invariant assertion | Constructing both sides of the comparison from literals so the function under test never runs (lessons L-05, verbatim precedent) |
| #5 | A garbage, truncated, or foreign document yields a clean explicit outcome — never an uncaught throw, never a silent empty state | "Only our code ever writes this key" | The read and parse boundary, and which failures are expected outcomes versus broken invariants under the AGENTS.md union-versus-throw rule | Unit with hostile fixtures | Generating fixtures with the same serializer that is under test — they can only prove self-consistency |
| #6 | Code at version N still reads a document written at version N−1, and the newer format is not destroyed by older code | "The schema is stable" and "a rollback undoes the change" | Where the version marker lives, what migration path exists, and the read behaviour on an unknown version | Unit with pinned, frozen per-version fixtures | Regenerating the fixtures whenever the schema changes — that erases the regression the fixtures exist to catch |
| #7 | At a narrow phone viewport the table is readable without horizontal scrolling, and every interactive control meets the 44px target and the contrast floor | "ESLint jsx-a11y is enabled, therefore accessibility is gated" — it applies only to `.astro` files (lessons L-04) | Which screens are critical, and which controls carry the 44px and contrast rules | A deterministic viewport check on one or two screens, with selective multimodal review layered on top | Pixel snapshots of a Tailwind-styled table — constant breakage, no signal |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Island test reachability and save-failure reporting | Prove a failed write can never render as success — which first requires `.tsx` to be inside the runner at all | #1 (partial), #10 | runner/environment bootstrap, component, unit | complete (+ real-quota e2e) | `context/changes/testing-island-reachability/` |
| 2 | Persistence round-trip and lifecycle | Prove work survives a tab close, edits survive a round-trip, and promotion mints exactly one entry | #2, #3, #4 | integration round-trip, unit, mechanical invariant assertions | browser slice done; core not started | — |
| 3 | Hostile input and schema-version resilience | Prove garbage and older documents degrade explicitly rather than silently | #5, #6 | unit with hostile and frozen per-version fixtures | browser slice done; unit core not started | — |
| 4 | Quality-gates wiring | Make the floor mechanical, so scope is visible rather than assumed | cross-cutting (locks #1–#6) | coverage reporting, runner-scope gate, bundle assertion | bundle boundary asserted; gates not wired | — |
| 5 | Critical-screen phone verification | Prove the project's only NFR holds on the screen a GM actually uses at the table | #7 | deterministic viewport check, selective multimodal review | automated checks done; both defects fixed | — |

**Phase 1 is `complete`, and Risk #1 is closed.** The phase shipped what it
promised — the runner reaches `.tsx`, six Risk #1 behaviours are asserted, and
four unrelated live defects were fixed along the way.

The last Risk #1 defect was initially parked rather than fixed, on the grounds
that it sat in a 1 735-line untested component and this was an infrastructure
phase. It was then closed test-first in the same session: the parked
`it.fails` entry was already a genuine RED, so GREEN was a one-branch change in
`conditionFromFailure` and REFACTOR retired the entry. The quarantine ledger is
now empty, which is its desired state. Scope note: this reversed the plan's
"What We're NOT Doing" line on island-layer defects, deliberately and with the
owner's agreement.

**Browser-level slice landed 2026-09-14 (`/10x-e2e`).** Playwright now exists
and carries 20 tests. Every rollout phase was put through the E2E eligibility
gate, and each turned out to have some residue that only a real browser can
reach — but in every case that residue is a *slice*, never the phase:

- **Phase 1** — closed at the component layer, but the `dom` project models a
  full store by making `setItem` throw a synthetic `QuotaExceededError`. That
  takes the browser's own quota accounting on trust, which is the L-05 shape.
  E2E now exhausts real quota and asserts a failed write is never reported as a
  success, and that freeing space makes saving work again.
- **Phase 3** — the parse boundary is unit work and stays there. What a unit
  test cannot answer is what the GM sees when the document is already broken at
  page load: five hand-authored hostile documents now drive the whole mount
  path, plus the rollback-asymmetry case (a newer document must survive older
  code byte for byte).
- **Phase 4** — almost entirely non-browser and still owned by
  `/10x-implement`. The one item with a runtime consequence is the
  client-bundle assertion; the static `dist/client/` grep remains the primary
  gate, and E2E asserts the same boundary from the served side (no third-party
  origin, no Supabase global or inlined credential).

- **Phase 2** — its browser half is done: a cell draft typed but never blurred
  survives a reload (the lifecycle commit path), and regenerating over
  corrections is gated by a real `<dialog>` that Escape closes without
  disarming the guard. Its *core* — the persist trigger, the correction merge,
  promotion minting exactly one entry (Risk #4 is untouched) — is still Vitest
  work and still not started.
- **Phase 5** — the deterministic half is done: no horizontal scroll at 320px,
  and the 44px tap floor, both regression-guarded. The multimodal review is not
  done. **Both defects it found are now fixed**: the footer horizontal scroll
  (see below), and the primary "Stwórz" button, which painted no keyboard focus
  indicator a GM could see — 1.2:1 against the 3:1 floor. The button's outline
  is now stated at the call site and the quarantine ledger is empty again.
  **Three sibling controls remain below the floor** — `Zapisz` (1.34:1) and the
  dialog's `Anuluj` (1.12:1) and `Stwórz mimo to` (1.18:1). They share the same
  cause, a shadcn `Button` base that sets `outline-none` and substitutes a ring
  resolving to a transparent shadow, so one line in `src/components/ui/button.tsx`
  would fix all three — but that file is upstream code §7 excludes, and forking
  it is a decision for Phase 4's a11y correction rather than a side effect here.

Two findings worth carrying (both in §6.6):

- The horizontal-scroll risk **does** reproduce, and Phase 1 research was right
  that it is the footer. An earlier line here said it did not; that was a
  Windows-only measurement. CI’s first run found the document at 349px inside a
  320px viewport on Linux, where wider fonts push the bare CC-BY URL — a single
  unbreakable token — past the 288px footer content box. Fixed with
  `break-words`. Two lessons: a viewport assertion is only as good as the font
  stack it runs on, so this NFR is a CI gate rather than a local one; and the
  test’s own diagnostic reported no offending element, because overflowing
  inline text does not grow its parent’s border box — a bounding-rect sweep
  cannot see it, and it now compares scrollWidth to clientWidth too.
- Phase 1 research read the focus ring off the stylesheet as "roughly 1.3:1".
  Measured from painted pixels it is 1.2:1, and the cause is not a low-contrast
  ring but a ring that does not paint at all — `outline-none` plus a ring that
  resolves to a transparent shadow. Fixed on the primary button; three siblings
  sharing the shadcn base still carry it.

Ordering rationale: Phase 1 is a structural blocker, not a preference —
lessons L-05 establishes that the runner currently cannot load `.tsx` at
all, so no UI-facing risk can be attacked before the harness exists. Phase 3
is pure module-level work with no harness dependency and may run in parallel
with Phase 2 if convenient. Phase 4 comes after there is something to gate.
Phase 5 is last because it buys the most expensive signal per unit of risk.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit (modules) | Vitest `node` project | ^5.0.0 | The original suite, unchanged by the split: `src/**/*.test.ts`, `environment: "node"`. A mutation audit killed 21 of 23 planted mutants, so depth here is genuine |
| component / island rendering | Vitest `dom` project + jsdom + Testing Library | jsdom ^30, @testing-library/react ^16.3 | Landed in §3 Phase 1. `src/**/*.test.tsx`, `environment: "jsdom"`, setup in `vitest.setup.dom.ts`. The two globs are disjoint, so the split needed no edit to any existing test. **jsdom cannot honestly exercise**: the `storage` event, `<dialog>` modal semantics, `pagehide`/`visibilitychange`, or colour contrast |
| e2e | Playwright | @playwright/test ^1.63, Chromium only | Landed 2026-09-14 for the browser-level slice only. `tests/e2e/*.spec.ts`, two projects: `desktop-chromium` and `phone` (320px, matching `phone-*.spec.ts`). Config starts `npm run dev` itself. **Deliberately tiny** — it carries only what §6.2 lists as things jsdom cannot do honestly. Levers: `tests/e2e/seed.spec.ts` + `tests/e2e/E2E_RULES.md` |
| type checking | `astro check` | via @astrojs/check ^0.9 | Covers **all** 36 project files including every `.tsx`. The one gate with full file coverage, and the only thing that sees the compile-time type assertions |
| linting | ESLint, type-aware | ^9.29 | Covers `.tsx` too — 212 active rules with `projectService` on. `scripts/**` is hard-ignored |
| accessibility | ESLint astro jsx-a11y | via eslint-plugin-astro ^1.7.0 | **Inert over React, not merely narrow.** The 31 `astro/jsx-a11y/*` rules *are* configured for `.tsx` at error severity, and every one returns an empty visitor on a non-Astro file. `eslint-plugin-jsx-a11y` is installed but never registered for React. Correction belongs to §3 Phase 4 |
| coverage reporting | @vitest/coverage-v8 | 5.0.0 | Landed in §3 Phase 1, root-level (Vitest rejects `coverage` inside a project) with `include` so untested files report 0% instead of vanishing. Report-only — no threshold until §3 Phase 4 |
| (optional) AI-native | multimodal review of critical screens via the session browser tool — checked: 2026-09-14 | n/a | When NOT to use: any regression a deterministic viewport or contrast assertion already catches, and any screen that is not one of the one or two a GM uses at the table |

**Stack grounding tools (current session):**
- Docs: none — Context7 is not available in current session; stack facts were taken from the local manifest, runner config, CI workflow, and AGENTS.md; checked: 2026-09-14
- Search: built-in web search — confirmed Vitest Browser Mode is stable from v4 onward and that an Astro island hydration helper for it exists, so Phase 1 has a current option beyond jsdom; checked: 2026-09-14
- Runtime/browser: session Chrome automation tool — available, and already proven in this repo for manual verification of the previous change; candidate for §3 Phase 5, not used before then; checked: 2026-09-14
- Provider/platform: none — the configured Linear server failed to connect this session; no GitHub, Cloudflare, or Supabase tooling was exposed; checked: 2026-09-14

**Corrected 2026-09-14 (rollout Phase 1 research).** An earlier draft of this
section implied the islands were ungated. They were never ungated — they were
**untested**. Linting covers `.tsx` with type-aware rules, and `astro check`
type-checks every one of them. What was missing was tests and any a11y rule
with real effect. The distinction matters: it is why the first island bug this
rollout found was a *behavioural* one that no linter or compiler could ever
have seen. Counts in the earlier draft were also stale (366 tests, 2 979 dark
lines); at the start of this phase they were 368 and 3 068.

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is planned.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint | local (pre-commit) + CI | required | style and rule drift; a non-zero exit is a real failure |
| typecheck | CI | required | type drift the runner cannot see, since Vitest transpiles without type-checking. Must stay **ahead of** the test step: the compile-time type assertions are invisible to Vitest |
| unit (modules) | local + CI | required | logic regressions in `src/lib/` |
| component / island tests | local + CI | required, since §3 Phase 1 | save-failure reporting regressions — the layer that had no automated check of any kind before |
| coverage reporting | CI | report-only since §3 Phase 1; threshold after §3 Phase 4 | the lessons L-04 and L-05 class of failure: a green counter answering a different question than the one being asked |
| quarantine ledger | local + CI | required, since §3 Phase 1 | a known defect being parked without being written down, or staying parked after it is fixed. **Extended 2026-09-14** to scan `tests/e2e/**` for `test.fail(` as well as `src/**` for `it.fails(` — otherwise an E2E park would go unrecorded while the count still looked truthful. Both counts are line-anchored, so a spec documenting its own convention in prose is not counted as a defect |
| e2e (browser-level) | local + CI | required, since 2026-09-14 | the behaviours jsdom cannot exercise honestly (§6.2), plus the premises the other layers take on trust: real quota exhaustion and a hostile document at real page load. Wired into `ci.yml` as the last step, after every cheaper gate; caches the Chromium download, runs single-worker with one retry, and uploads the HTML report (with the retry trace) on failure. **Runs against `npm run dev`, not the built output** — see the caveat below |
| lint warning budget | CI | required after §3 Phase 4 | `eslint .` carries no `--max-warnings`, so every warn-level rule — `no-console` among them — passes CI silently today |
| `scripts/**` lint coverage | CI | required after §3 Phase 4 | `scripts/**` is hard-ignored by ESLint while still being type-checked, so the catalog build script is linted by nothing |
| client-bundle dependency assertion | CI (post-build) | optional, after §3 Phase 4 | a `@supabase/*` import reaching the public client bundle. **Verified inert 2026-09-14**: nothing imports the packages, the env fields are `context: "server"` + `access: "secret"` (which Astro refuses to inline into client output), and the built `dist/client/` contains no match. The gate's real job is to assert that classification is *preserved*, not to catch a leak that exists |
| accessibility scope correction | local + CI | required after §3 Phase 4 | interface-level a11y violations. The existing rules are configured for React files and return an empty visitor on them, so the gate is inert rather than narrow — a stronger reason to fix it than the earlier draft implied |
| deterministic viewport check | CI on PR | optional, after §3 Phase 5 | phone-readability regressions against the project's only NFR |
| multimodal visual review | on demand | optional, after §3 Phase 5 | visual issues on one or two critical screens that a deterministic check misses |
| build | CI | required | build-time breakage before promotion |

**Caveat on the e2e gate: it exercises the dev server, not the artifact.**
Playwright starts `npm run dev`, so what CI drives is Vite's unbundled module
graph, not `dist/client/`. For persistence, the dialog, hostile documents,
viewport and contrast this makes no difference — same React, same DOM, same
browser. It matters for exactly one spec: `origin-boundary.spec.ts` asserts no
third-party origin and no inlined credential, and asserting that about dev
output is weaker than asserting it about what ships. **The static
`dist/client/` check therefore remains the primary bundle gate**, unchanged;
the spec is a second, served-side oracle, not a replacement.

Closing the gap means serving the build in CI, and the adapter makes that
non-trivial: `output: "server"` with `@astrojs/cloudflare` routes
`astro preview` through wrangler. Since `index.astro` is prerendered, the
cheaper route is a static server over `dist/client/` with the base URL pointed
at it. Deferred rather than forgotten — it belongs with §3 Phase 4's bundle
assertion, where the primary gate lives.

Promotion to production remains human-only per AGENTS.md; these gates guard
the merge, not the deploy.

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a unit test for a module rule

- **Location**: `src/lib/`, alongside the module under test.
- **Naming**: `<module>.test.ts`, matching the runner's current glob.
- **Reference test**: `src/lib/assortment.test.ts` — the deepest existing
  example, and the one the mutation audit exercised hardest.
- **Run locally**: `npm test`.
- **Mandatory check before claiming coverage**: mutate the condition the
  test claims to guard and confirm the suite fails on that test
  (lessons L-03, L-05).

### 6.2 Adding a component / island test

- **Location**: beside the component, `src/components/<Component>.test.tsx`.
- **Naming**: `.test.tsx` is the whole mechanism. The runner has two projects
  over disjoint globs — `node` collects `src/**/*.test.ts`, `dom` collects
  `src/**/*.test.tsx` — so the extension alone decides the environment. Nothing
  else needs configuring.
- **Run locally**: `npm test -- --project dom` (or `npm test` for both).
- **Harness**: jsdom with Testing Library. Setup lives in `vitest.setup.dom.ts`
  and applies to the `dom` project only.
- **Reference tests**: `src/components/MerchantGenerator.test.tsx` for behaviour
  against a failing store; `src/components/StorageNotice.test.tsx` for a plain
  render.
- **Driving storage**: the components call `readDocument()` / `putTransient()`
  with no argument, so there is no injection seam. Spy on `Storage.prototype`
  — `setItem` throwing a `QuotaExceededError` or `SecurityError` `DOMException`,
  or succeeding and storing nothing to model a store that drops writes. Call
  `resetReadOnlyLatch()` in `beforeEach`: the latch is module state and Vitest
  isolates per file, not per test.
- **Assert the requirement, not the copy.** Do not compare against message
  strings from `StorageNotice` — that is green for any wording, including
  wording that says the opposite. Assert that *something* is said, and that
  different failures say *different* things.
- **What jsdom cannot do honestly**, and must not be claimed: the `storage`
  event never fires (it only reaches other windows, and there is one);
  `HTMLDialogElement` is unimplemented, so the setup file's stub gives you
  `open` and nothing else — no focus trap, no Escape, no backdrop;
  `pagehide`/`visibilitychange` never fire on their own; and colour contrast
  needs a paint engine. All four are §3 Phase 5 work, in a real browser.

### 6.3 Parking a known defect

- **Mechanism**: `it.fails()`, never `it.skip()`. A skipped test does not
  execute and rots silently — the failure mode in `[[L-03]]` and `[[L-05]]`.
  `it.fails()` runs its assertion, keeps the suite green while the defect
  stands, and turns red the moment the defect is fixed, so the entry has to be
  retired rather than forgotten.
- **Ledger**: every entry is listed in `src/quarantine.test.ts` with its defect
  and its owning change, and the count is pinned there. Adding one means
  editing that number deliberately. The ledger is currently **empty** — the one
  entry it has ever held was parked and graduated the same day, which is the
  lifecycle it is built for.
- **The ledger's own premise-guard must not depend on an entry existing.** Zero
  found is otherwise indistinguishable from a scanner that finds nothing ever —
  the L-04 shape. It checks the scan reaches files of both extensions, and
  exercises the counting logic against a synthetic string.
- **Write the assertion for the requirement, then park it.** Never weaken an
  assertion so it passes against the defect.

### 6.4 Adding a persistence round-trip test

- TBD — see §3 Phase 2. Pattern to name once shipped: writing through the
  real trigger, then re-reading as a fresh mount, so the test cannot pass
  by calling the persist function the application never calls (Risk #2, #3).

### 6.5 Adding a hostile-input or schema-version test

- TBD — see §3 Phase 3. Pattern to name once shipped: fixtures authored by
  hand rather than by the serializer under test, and frozen per-version
  documents that are never regenerated (Risk #5, #6).

### 6.6 Adding a browser-level (E2E) test

- **Read `tests/e2e/E2E_RULES.md` first.** It and `tests/e2e/seed.spec.ts` are
  the two levers; the rules file carries the admission test for this layer.
- **Location / naming**: `tests/e2e/<feature>.spec.ts`. A `phone-` prefix routes
  the file to the 320px `phone` project; everything else runs desktop.
- **Run locally**: `npm run test:e2e`, or `npm run test:e2e -- <path>` for one
  spec. The config starts the dev server itself.
- **Admission test — most tests do not belong here.** A test earns a place only
  if it needs something jsdom cannot do honestly (§6.2): the `storage` event,
  real `<dialog>` semantics, `pagehide`/`visibilitychange`, colour contrast, or
  real layout geometry. Everything else is cheaper and steadier in Vitest.
- **Always enter through `gotoHydrated()`.** The island is `client:load` and
  Astro server-renders its markup, so every control is present and clickable
  *before* React attaches handlers. A click in that window is swallowed in
  silence. Waiting on `astro-island:not([ssr])` is a real state, not a timeout —
  this was the single biggest flake source found while building the suite.
- **Mandatory before claiming coverage: break the thing on purpose.** Invert the
  production behaviour the risk names, confirm the test goes red, revert. Every
  test in this suite has been through it, and two were rewritten because of it:
  - a premise guard read the corrected price from `rows`, but corrections are an
    *overlay* (`transient.corrections[itemId]`) and never touch `rows` — so the
    guard reported "uncommitted" either way. Decorative, and green (`[[L-03]]`).
  - the `pagehide` test survives removing the `pagehide` listener, because
    Chromium also fires `visibilitychange` on navigation. It covers the commit
    *path*, not one listener, and now says so rather than overclaiming.
- **Prefer painted pixels to computed styles for anything visual.** A computed
  style reports `outline-width: 2px` for a control painting nothing, because
  `outline-style: none` still carries a width — a style-based assertion accepts
  a fix that fixes nothing. `tests/e2e/helpers/focus-contrast.ts` compares the
  focused and unfocused states pixel-for-pixel, which is WCAG 2.4.11's own
  definition and has no stored baseline to churn. That is the line between this
  and the pixel-snapshot anti-pattern: state-versus-state, never a golden image.
- **Parking**: `test.fail()`, never `test.skip()` — the Playwright spelling of
  §6.3. `src/quarantine.test.ts` scans this directory too, so a parked E2E
  defect must be added to the ledger and the count bumped.

### 6.7 Per-rollout-phase notes

**Phase 1 (`testing-island-reachability`), 2026-09-14.** Three things worth
carrying forward:

1. **Two of the three predicted defects were already fixed.** The research doc
   carried a stale claim forward from an older audit. Writing the assertions as
   ordinary tests first, and converting only what actually failed, is what
   caught it — parking them as `it.fails()` up front would have produced two
   entries that fail because they *pass*.
2. **A test can pass for the wrong reason and look thorough doing it.** The
   first version of the `not-found` test asserted that the notice text
   *changed*, and went green over a live defect. The requirement is not that
   something changed; it is that an instruction the product gives the GM can be
   followed. Assert the requirement, never a proxy for it.
3. **Check a fixture's premise.** A fallback-category test used a category that
   turned out to be a real one, so it never entered the branch it named — the
   `[[L-03]]` shape again. Both that test and the frozen-fixture test now carry
   an explicit premise-guard assertion, which is cheap and catches the whole
   class.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout. Future contributors should respect
these unless the underlying assumption changes.

- **Anything Supabase** — the packages are installed but nothing imports
  them, and AGENTS.md forbids wiring them in v1. Spending test budget on an
  unwired dependency buys nothing. The one real exposure is a credential
  reaching the client bundle, and that is answered by a build-time assertion
  in §5, not by tests. Re-evaluate when v2 cloud sync begins.
  (Source: Phase 2 interview Q5.)
- **The generated item catalog** — it is produced by a build script from an
  SRD source, so the generator is the test. Re-evaluate if the catalog
  starts being hand-edited, which AGENTS.md currently forbids.
- **shadcn primitives under `src/components/ui/`** — upstream code, adopted
  rather than authored. Re-evaluate if one is forked and modified.
- **The economic plausibility of a generated assortment** — a poor
  settlement offering tens of thousands of gold is a measured and
  consciously accepted v1 behaviour, not a defect (lessons L-01, PRD Open
  Question #3). A test here would assert the known gap and pin it in place.
  Re-evaluate when one of the L-01 closure candidates is actually
  implemented, at which point the rarity-proportion invariant needs
  regression protection.
- **The assortment contract itself** (the 10–25 range, uniqueness,
  category and wealth fit) — already the most deeply covered area in the
  repository and mutation-audited. It stays out of the rollout as
  regression-only maintenance, not because it is unimportant.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-09-14 (corrected against rollout Phase 1 research, then against the `/10x-e2e` browser slice, the same day)
- Stack versions last verified: 2026-09-14 (jsdom 30, @testing-library/react 16.3, @vitest/coverage-v8 5.0.0, @playwright/test 1.63 + Chromium installed and running)
- AI-native tool references last verified: 2026-09-14

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
