<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Pierwszy wygenerowany asortyment (S-01)

- **Plan**: `context/changes/first-generated-assortment/plan.md`
- **Mode**: Deep
- **Date**: 2026-09-11
- **Verdict**: REVISE → **SOUND** after fixes
- **Findings**: 1 critical, 2 warnings, 2 observations — all 5 fixed

## Verdicts

| Dimension | Before | After fixes |
|-----------|--------|-------------|
| End-State Alignment | WARNING | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | WARNING | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | FAIL | PASS |

## Grounding

10/10 paths ✓, 7/7 symbols ✓, brief↔plan ✓.
Progress contract ✓ (1 heading, 3/3 phases matched by name, 28 criteria = 28 items, no
checkbox leaks) — re-verified after all edits.
`dist/client/index.html` absent at review time ✓, confirming the Phase 2 prerender gate is a
real check rather than one that passes trivially.

Codebase verification was done directly rather than via sub-agent: the entire source tree is
989 lines and already in context, so a delegated sweep would have added latency without new
information.

## Findings

### F1 — Lint criterion cannot be verified automatically

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: All three phases, "Automated Verification"
- **Detail**: Every phase listed "Lint shows no non-CRLF errors: `npm run lint`" under
  *Automated* Verification. On this Windows checkout that command exits non-zero with ~1000
  `Delete ␍` errors (AGENTS.md), and "judge by non-CRLF errors only" is a human act — so the
  plan carried an automated gate that could never mechanically pass, three times over.
  `/10x-implement` would stall at every phase.
- **Fix A ⭐ Recommended**: Add `.gitattributes` and make lint a real gate
  - Strength: AGENTS.md proposes exactly this (`* text=auto eol=lf`); turns three dead gates
    into three live ones and fixes it for every later slice.
  - Tradeoff: `git add --renormalize .` touches every tracked text file — a large, noisy diff
    two days from the deadline.
  - Confidence: HIGH — CI on ubuntu already passes, so LF is provably correct.
  - Blind spot: Interaction with the husky lint-staged hook during renormalization untested.
- **Fix B**: Move the lint check to Manual Verification in all three phases
  - Strength: One-line edit per phase, zero repo churn.
  - Tradeoff: Lint stops gating anything.
  - Confidence: HIGH — purely a document change.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — added Phase 1 change 5 (`.gitattributes`, to land first in
  the phase as its own commit); reworded all three criteria and their Progress items to
  "Linting passes: `npm run lint`"; rewrote the Current State constraint to say this plan
  fixes the cause rather than works around it. No new criterion was added — the reworded lint
  gate *is* the proof normalization worked, so numbering was untouched.

### F2 — Spill chain undefined when the middle tier runs dry

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1, change 1 — `generateAssortment` contract
- **Detail**: The spill rule covered `rzadkie→niezwykłe→pospolite` and `pospolite→niezwykłe`
  but not `niezwykłe` running dry — the implementer had to guess. Separately, the rule
  excluding a 0%-share tier from being a spill target sat inside the *quota-rounding*
  paragraph, where it read as a rounding note. That constraint is what stops `nędzna` ever
  showing a rare item — the decision taken to close PRD Open Question #3 — and the Phase 1
  test asserts it as "ever".
- **Fix**: State the spill rule as its own contract section — nearest eligible tier by rarity
  distance, skipping any zero-share tier, typed error when none remain.
  - Strength: Removes the guess and puts the `nędzna` invariant where the spill logic is read.
  - Tradeoff: Three extra paragraphs for a branch unreachable against the committed catalog.
  - Confidence: HIGH — all 12 (category, wealth) pairs verified against current tier depth.
  - Blind spot: None significant.
- **Decision**: FIXED — added **Eligible tiers** and **Spill rule** as named subsections with
  an explicit preference table (`niezwykłe` prefers `pospolite` over `rzadkie`, since
  overshooting downward reads as a poorer shop — a milder lie than a backwater stocking rare
  goods). Added a test for the one case where the spill rule and the `nędzna` invariant could
  contradict: a synthetic pool shallow enough to force spilling under `nędzna` must still
  yield zero rare rows.

### F3 — The typed throw has no handler in the island

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 (contract) vs Phase 2 (`MerchantGenerator`)
- **Detail**: Phase 1 specified a typed throw so a future regeneration "fails loudly", but
  Phase 2's island contract described no catch and no error state — only `rows === null` vs an
  array. If the throw fired, the one product page would white-screen on click. The plan built
  a loud failure and gave it nowhere to land.
- **Fix**: Add an error state to the island contract — catch in the Generate handler, render a
  short message instead of the table, leave the controls usable.
- **Decision**: FIXED — added `error: string | null` to island state, a `try`/`catch` around
  the rule call, and the note that a successful draw clears it.

### F4 — formatPrice contract does not anticipate its known consumer

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1, change 2 — `src/lib/format-price.ts`
- **Detail**: The contract defined only `formatPrice(gp): string`. The already-written S-02
  plan requires `priceParts` / `partsToGp` to let the GM edit a price in the unit shown, and
  names that as "a small amendment to an S-01 module not yet written". Shipping S-01 as
  specified guaranteed an immediate refactor one slice later.
- **Fix**: Add `priceParts(gp) → { value, unit }` and its inverse now, with `formatPrice` as a
  thin wrapper.
- **Decision**: FIXED — contract now names three exports with thresholds living in exactly one
  of them, plus a round-trip invariant and matching tests. **This removes the cross-slice
  amendment the S-02 plan was carrying.**

### F5 — Desired End State describes the production URL; no phase deploys

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Desired End State vs "What We're NOT Doing"
- **Detail**: "A GM opens the production URL on a phone…" — but promotion to production is
  human-only (AGENTS.md), no phase performs it, and deployment was not listed as out of scope.
  Manual verification correctly used `npx wrangler dev`.
- **Fix**: Reword the End State to describe the running app; add deployment to "What We're NOT
  Doing".
- **Decision**: FIXED — both edits applied.

## Note on the original verdict

Two dimensions carried a CRITICAL or FAIL, which the rubric would push toward RETHINK. The
review called **REVISE** deliberately: every finding was a local edit to a structure that
verified sound — all paths and symbols exist, the Progress contract was exact, the feasibility
math holds across all 12 (category, wealth) pairs, and the Phase 2 prerender gate is a genuine
check. Nothing indicated the approach was wrong.

One self-correction during the review: the spill rule was initially flagged as *contradicting*
the `nędzna` zero-rare invariant. Re-reading the plan showed it did address the case
("the rare tier must be skipped entirely rather than … spilled into"), so the finding was
downgraded from CRITICAL to WARNING and rewritten around the real residual issues — the
undefined middle-tier branch and the constraint being buried in a rounding paragraph.
