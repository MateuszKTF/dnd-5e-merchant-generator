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
| 5 | An untrusted stored document — malformed, truncated, hand-edited, or written by another application on the same origin — is read and either throws uncaught (blank application) or is discarded silently | High | Medium | abuse lens (untrusted input); AGENTS.md hard rule (expected failure returns a discriminated union, never throws); PRD §Success Criteria Guardrails; interview Q1 |
| 6 | A storage schema change ships and a device holding the other format loses its merchants; a Worker rollback reverts code and assets but not the GM's browser storage | High | Medium | AGENTS.md hard rule (browser-storage schema changes are forward-only; rollback asymmetry); PRD §Success Criteria Guardrails; roadmap F-01 |
| 7 | The assortment table is unusable on a phone at the table — tap targets under 44px, horizontal scrolling, or a control that fails the contrast floor | Medium | Medium | PRD §Non-Functional Requirements (the only NFR); AGENTS.md §Style (44px targets, WCAG AA floors); lessons L-04 (the a11y gate has zero file scope over React islands) |

High-impact × Low-likelihood scenarios were deliberately not padded into
this map. One was identified — a Supabase credential reaching the public
client bundle — and it is handled as a build-time gate in §5 rather than as
a test, which is both the cheaper and the more reliable response.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|---|---|---|---|---|---|
| #1 | A failed write never renders as a success, and the GM sees an explicit notice that distinguishes one failure kind from another | "The write returned, therefore it saved" — and "the storage module is tested, therefore the reporting is" (lessons L-05) | How storage outcomes are modelled, which outcomes exist, where the outcome is translated into user-facing text, and whether that translation is reachable by the runner at all | Integration across the storage module and the island, once `.tsx` is reachable by the runner | Asserting the message string copied out of the component under test — the oracle must come from the PRD guardrail, not from the code |
| #2 | Closing and reopening restores the last merchant including edits made seconds earlier, with no explicit user action | "Autosave is wired, therefore it fires" — which trigger actually commits, and whether an edit counts as one | The persist trigger and its lifecycle, any debounce or coalescing, and what a mount-time restore actually reads | Integration round-trip: write, then re-read as a fresh mount | Exercising the persist function directly while never exercising the trigger — lessons L-03 is exactly this failure |
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
| 1 | Island test reachability and save-failure reporting | Prove a failed write can never render as success — which first requires `.tsx` to be inside the runner at all | #1 | runner/environment bootstrap, component, integration | planned | `context/changes/testing-island-reachability/` |
| 2 | Persistence round-trip and lifecycle | Prove work survives a tab close, edits survive a round-trip, and promotion mints exactly one entry | #2, #3, #4 | integration round-trip, unit, mechanical invariant assertions | not started | — |
| 3 | Hostile input and schema-version resilience | Prove garbage and older documents degrade explicitly rather than silently | #5, #6 | unit with hostile and frozen per-version fixtures | not started | — |
| 4 | Quality-gates wiring | Make the floor mechanical, so scope is visible rather than assumed | cross-cutting (locks #1–#6) | coverage reporting, runner-scope gate, bundle assertion | not started | — |
| 5 | Critical-screen phone verification | Prove the project's only NFR holds on the screen a GM actually uses at the table | #7 | deterministic viewport check, selective multimodal review | not started | — |

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
| unit + integration (modules) | Vitest | ^5.0.0 | Configured and in real use: 7 test files, 366 tests, all under `src/lib/`. A mutation audit killed 21 of 23 planted mutants, so depth here is genuine |
| component / island rendering | none yet — see §3 Phase 1 | — | The runner is pinned to `environment: "node"` and a `.test.ts` glob, so `.tsx` is excluded by configuration rather than by omission. Phase 1 decides between a jsdom harness and Vitest Browser Mode |
| e2e | none yet — see §3 Phase 5, if justified | — | Not assumed. The product is one prerendered view with browser-local state; whether e2e earns its cost is a Phase 5 decision, not a foregone conclusion |
| accessibility | ESLint astro jsx-a11y | via eslint-plugin-astro ^1.7.0 | Present but scoped to `.astro` only, so it covers none of the React interface (lessons L-04). Scope correction belongs to §3 Phase 4 |
| coverage reporting | none yet — see §3 Phase 4 | — | No `coverage` key exists in the runner config or the manifest, which is precisely why the `.tsx` gap went unnoticed (lessons L-05) |
| (optional) AI-native | multimodal review of critical screens via the session browser tool — checked: 2026-09-14 | n/a | When NOT to use: any regression a deterministic viewport or contrast assertion already catches, and any screen that is not one of the one or two a GM uses at the table |

**Stack grounding tools (current session):**
- Docs: none — Context7 is not available in current session; stack facts were taken from the local manifest, runner config, CI workflow, and AGENTS.md; checked: 2026-09-14
- Search: built-in web search — confirmed Vitest Browser Mode is stable from v4 onward and that an Astro island hydration helper for it exists, so Phase 1 has a current option beyond jsdom; checked: 2026-09-14
- Runtime/browser: session Chrome automation tool — available, and already proven in this repo for manual verification of the previous change; candidate for §3 Phase 5, not used before then; checked: 2026-09-14
- Provider/platform: none — the configured Linear server failed to connect this session; no GitHub, Cloudflare, or Supabase tooling was exposed; checked: 2026-09-14

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is planned.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint | local (pre-commit) + CI | required | style and rule drift; a non-zero exit is a real failure |
| typecheck | CI | required | type drift the runner cannot see, since Vitest transpiles without type-checking |
| unit + integration (modules) | local + CI | required | logic regressions in `src/lib/` |
| component / island tests | local + CI | required after §3 Phase 1 | save-failure reporting and mount-time restore regressions |
| coverage reporting | CI | required after §3 Phase 4 | the lessons L-04 and L-05 class of failure: a gate whose file scope silently covers nothing |
| runner-scope assertion | CI | required after §3 Phase 4 | a future config change that quietly drops a file type from the runner again |
| client-bundle dependency assertion | CI (post-build) | required after §3 Phase 4 | a `@supabase/*` import reaching the public client bundle, which would publish a credential from a public repo and a public Worker |
| accessibility scope correction | local + CI | required after §3 Phase 4 | interface-level a11y violations that the `.astro`-scoped rule set can never see |
| deterministic viewport check | CI on PR | optional, after §3 Phase 5 | phone-readability regressions against the project's only NFR |
| multimodal visual review | on demand | optional, after §3 Phase 5 | visual issues on one or two critical screens that a deterministic check misses |
| build | CI | required | build-time breakage before promotion |

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

- TBD — see §3 Phase 1. This phase decides the harness (jsdom versus
  Browser Mode), the file glob, and the naming convention, and must record
  all three here. Pattern to name once shipped: proving a failed write never
  renders as a success (Risk #1).

### 6.3 Adding a persistence round-trip test

- TBD — see §3 Phase 2. Pattern to name once shipped: writing through the
  real trigger, then re-reading as a fresh mount, so the test cannot pass
  by calling the persist function the application never calls (Risk #2, #3).

### 6.4 Adding a hostile-input or schema-version test

- TBD — see §3 Phase 3. Pattern to name once shipped: fixtures authored by
  hand rather than by the serializer under test, and frozen per-version
  documents that are never regenerated (Risk #5, #6).

### 6.5 Adding a phone-readability check for a new screen

- TBD — see §3 Phase 5. Pattern to name once shipped: deterministic
  viewport and target-size assertions first, multimodal review only for what
  those cannot express (Risk #7).

### 6.6 Per-rollout-phase notes

(Empty. After each phase lands, `/10x-implement` appends a short note here
capturing anything surprising the rollout phase taught.)

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

- Strategy (§1–§5) last reviewed: 2026-09-14
- Stack versions last verified: 2026-09-14
- AI-native tool references last verified: 2026-09-14

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
