<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Pierwszy wygenerowany asortyment — Phase 3

- **Plan**: `context/changes/first-generated-assortment/plan.md`
- **Scope**: Phase 3 of 3 — "Phone readability and attribution" (commit `7839d6e`)
- **Date**: 2026-09-12
- **Verdict**: REJECTED — one licence-compliance defect, fixable in one sentence
- **Findings**: 1 critical · 3 warnings · 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

**Read the verdict correctly.** The rubric puts any critical Safety & Quality finding at REJECTED, and F1 is a licence defect on a public, deployed product — so the label is right. But this is not sloppy work: Phase 3 is the most faithful of the three phases, and F1 is one missing sentence in a footer that is otherwise verbatim-correct.

**Automated verification (re-run this session, after the phase-1/2 triage fixes):** `npm test` 314 passed · `npx astro check` 0 errors · `npm run lint` exit 0 · `npm run build` complete. All four Phase-3 automated criteria hold.

**The NFR was verified by computation, not just by eye.** At 360px: `main` is `mx-auto w-full max-w-3xl px-4 py-6`, so the content box is 328px and `max-w-3xl` never engages. Ilość collapses to ~41px and Cena to ~80px (widest price `21 000 gp`, tabular-nums), leaving ~207px for Nazwa against a min-content floor of ~117px (`Cartographer's`, the longest unbreakable token in the whole catalog at 14 chars). ~90px of slack. The longest name, `Amulet of Proof against Detection and Location`, wraps to three lines rather than overflowing. Nothing in the diff carries a `min-w`, a `table-fixed`, or a fixed pixel width. Re-checked at the working tree, where S-02's edit inputs widen the numeric columns to `w-12`/`w-20`: Nazwa drops to ~164px, still clear of the floor.

**The viewport meta change is an EXTRA, and it is correct.** The plan did not mention it; the commit added `initial-scale=1`. Verified in the built HTML: `content="width=device-width, initial-scale=1"` — no `maximum-scale`, no `user-scalable=no`, so pinch-zoom is unrestricted and there is no WCAG 1.4.4 regression. Without it some mobile browsers apply their own initial zoom and the "no zooming needed" criterion could fail regardless of the Tailwind work. Documented inline and in the commit body. Accepted.

**Other benign extras, all inside the phase's stated intent:** `tabular-nums` on both numeric columns (makes a 25-row price column scan as a column), `align-top` on rows (keeps quantity and price on a wrapped name's first line), the `max-w-3xl` desktop line-length cap, and unremarked typography polish on the `h1`, row count, error and empty state. No new state, no new props, no new helpers, no copy changes.

**Manual criteria.** 3.5–3.9 are all corroborated by the computation above, the class strings, and the built HTML. 3.10 ("Verified on a real phone-sized viewport, not desktop emulation") is unverifiable from the repo by construction — it is a claim about how the human tested, and nothing in a diff can confirm or refute it. Recorded, not disputed.

**No upstream breakage.** Phase 3 is a pure presentation diff: `MerchantGenerator`'s state block is byte-identical to `7839d6e^`, and `formatPrice`, the three columns with no rarity, `MerchantTable`'s presentation-only prop surface, the null-vs-empty empty state, `role="alert"` and both `<label htmlFor>` pairs all survive. `Layout.astro` is byte-identical at `7839d6e`, HEAD and the working tree, so every footer finding below applies to all three.

## Findings

### F1 — The footer omits the "indicate modifications" element CC BY 4.0 requires

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/layouts/Layout.astro:34-51`
- **Detail**: The footer reproduces the required attribution notice and both URLs correctly. What it does not carry is the fourth element of CC BY 4.0 §3(a)(1)(B): an indication that the material was modified. `src/data/ATTRIBUTION.md:33` states the obligation in the project's own words — "CC-BY-4.0 requires that modifications be indicated" — and then lists six substantive modifications. Two of them are exactly what the page displays: **magic-item prices are invented by this project** ("The SRD assigns no price to magic items") and **mundane rarity tiers are computed from price terciles within a category**, not taken from the SRD. So a GM reading "21 000 gp" for an amulet is reading this project's number, under a notice that presents the material as SRD-derived and unqualified. Two of the three visible columns are partly or wholly this project's editorial work. This is not a formality: §6(a) terminates the licence automatically on non-compliance, the repo is public, and the deployed Worker serves the derived catalog. The plan's contract enumerated only credit plus two links, so this is the plan under-specifying rather than the implementer drifting.
- **Fix A ⭐ Recommended**: Append one sentence to the existing footer paragraph — "Materiał został zmodyfikowany: ceny, poziomy rzadkości i podział na kategorie pochodzą od tego projektu" — linking to the repo's `ATTRIBUTION.md` for the full list.
  - Strength: Closes the licence gap in one line, keeps the footer short enough not to crowd the table (which the plan explicitly required), and puts the full six-item list where it already lives rather than duplicating it on the page.
  - Tradeoff: The detail sits off-page behind a link, so a reader who does not follow it learns only that changes exist, not which.
  - Confidence: HIGH — §3(a)(2) permits satisfying attribution elements by URI, and the six modifications are already written up.
  - Blind spot: Not a lawyer's review; if the deadline has legal sign-off attached, this wording should go through it.
- **Fix B**: Reproduce the `ATTRIBUTION.md` notice block verbatim, hyperlinking the two URLs in place, and add the modification clause to it.
  - Strength: The notice WotC publishes is a fixed string; reproducing it exactly removes any argument about paraphrase. Also fixes the two wording deviations noted below in one pass.
  - Tradeoff: A longer footer on a page whose single NFR is phone readability — the plan warned it "must not push the first rows below the fold".
  - Confidence: MEDIUM — safest legally, but it trades against the phase's own layout constraint.
  - Blind spot: Not measured how much taller the footer gets at 360px.
- **Wording deviations to fix alongside, either way**: the required text ends "…International License, **available at https://creativecommons.org/licenses/by/4.0/legalcode**" and the page carries that URL only as an `href`; and `„SRD 5.1”` uses Polish quotation marks inside an English legal notice the canonical version writes with straight quotes.
- **Decision**: FIXED via Fix A — the footer now carries a modification clause ("The material has been modified: item prices, rarity tiers and merchant categories are this project's own editorial work, not the SRD's") linking to ATTRIBUTION.md on GitHub. Written in English, not the Polish draft in Fix A, so the footer stays monolingual for the F2 lang attribute. Both wording deviations fixed alongside: straight quotes around "SRD 5.1", and the verbatim "available at https://creativecommons.org/licenses/by/4.0/legalcode" clause restored. Verified in the built HTML.

### F2 — The English footer sits inside `lang="pl"` with no language of its own

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/layouts/Layout.astro:12`, `:34`
- **Detail**: The footer is entirely English inside `<html lang="pl">` and carries no `lang` attribute — confirmed in the built HTML, which emits `<footer class="…">` with no `lang`. A Polish screen-reader voice will pronounce "System Reference Document" and "Creative Commons Attribution 4.0 International License" with Polish phonetics, which for a legal notice is exactly the text that most needs to be intelligible. WCAG 3.1.2 *Language of Parts* is level AA, so this is a genuine AA failure. The English item names in the table have the same issue, but `ATTRIBUTION.md` documents keeping SRD names untranslated as a deliberate, accepted tradeoff — leave those.
- **Fix**: `<footer lang="en" class="…">`.
- **Decision**: FIXED — lang="en" on the footer element, with the WCAG 3.1.2 reason inline. Verified in the built HTML.

### F3 — The select borders fail WCAG non-text contrast

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantGenerator.tsx` — both `<select>` elements (`border-neutral-300`)
- **Detail**: Tailwind v4 `neutral-300` is `oklch(0.870 0 0)`; achromatic, so Y = L³ = 0.6585 and contrast against the `bg-white` body is **1.48:1**. WCAG 1.4.11 *Non-text Contrast* (AA) requires 3:1 for the visual boundary that identifies a control. Partly mitigated because these are native `<select>` elements and keep the UA dropdown arrow, but the border is the only thing marking the field's extent. This matters more here than it would elsewhere: the two selects are the entire input surface of the product.
- **Fix**: `border-neutral-500` (`oklch(0.556)` → 4.73:1). `neutral-400` only reaches 2.6:1, still short. `neutral-500` at rest also keeps the existing `focus:border-neutral-400` used in `PriceQuantityCell` / `MerchantLibrary` distinguishable.
- **Decision**: FIXED — both select borders raised to border-neutral-500 (4.73:1, clears the 3:1 requirement).

### F4 — The row rules are too faint to do the job the contract assigns them

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/components/MerchantTable.tsx` — `border-b border-neutral-200` on `<tr>`
- **Detail**: The Phase-3 contract says "Row separation must stay legible when row heights are uneven from wrapping", and the commit message names the mechanism: "Row rules carry the eye when wrapping makes heights uneven." `neutral-200` is `oklch(0.922)`, Y = 0.7838, **1.26:1** against white. On a phone in a lit room that is effectively invisible, so the rules exist in the markup but not in practice — the stated mechanism for tracking a three-line wrapped row does not actually function. This is the one place where Phase 3's implementation does not deliver what its own contract promised. The header rule (`border-b-2 border-neutral-300`, 1.48:1) partly compensates through weight, but only for the header.
- **Fix**: `border-neutral-300` for the row rules (1.48:1), and bump the 2px header rule to `neutral-400` so it stays distinct as a header.
- **Decision**: FIXED — row rules to border-neutral-300 (1.48:1) and the header rule to border-b-2 border-neutral-400, keeping the header distinct.

### F5 — The wrap guard would not actually guard, and hyphenates English with Polish rules

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/MerchantTable.tsx` — name cell, `break-words hyphens-auto`
- **Detail**: Two notes on the wrap guard, neither of which bites today. (a) `break-words` compiles to `overflow-wrap: break-word`, which by spec **does not reduce a box's min-content contribution**. Under `table-layout: auto` the column's minimum is still the longest unbreakable word, so if a name longer than the column's share ever entered the catalog, this class would not prevent the overflow it was added to prevent — `wrap-anywhere` (`overflow-wrap: anywhere`) or `break-all` do shrink min-content. Inert now: the longest token in the catalog is 14 chars against ~90px of slack. (b) `hyphens-auto` inherits `lang="pl"` from `<html>`, but every item name is English by design, so any browser that does hyphenate applies Polish break patterns to English words. Also inert — no name is long enough to need hyphenation — but the hint is wrong either way.
- **Fix**: Swap `break-words` → `wrap-anywhere` and drop `hyphens-auto` (or keep it behind a `lang="en"` on the cell if hyphenation is genuinely wanted).
- **Decision**: FIXED — break-words replaced with wrap-anywhere (verified: Tailwind 4.2 emits overflow-wrap:anywhere) and hyphens-auto dropped, with the reasoning inline.

### F6 — `body` hardcodes the light palette over the design-token layer

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/layouts/Layout.astro:22`
- **Detail**: `<body class="min-h-full bg-white text-neutral-900">` is an EXTRA the plan did not describe, and it overrides `@layer base { body { @apply bg-background text-foreground } }` in `src/styles/global.css` — a utility-layer class beats a base-layer rule. That neutralises the complete `.dark` token block the starter shipped. Nothing breaks, because v1 has no dark toggle. Recording it because it is not a Phase-3 slip so much as the point where a repo-wide divergence became load-bearing: every component uses literal `neutral-*` rather than `bg-background` / `text-muted-foreground` / `border-border`, so the shadcn token system is present but unused. That is a fine decision — it is just nowhere written down, and the next person to add a component has no way to know which convention wins.
- **Fix**: Record the choice (literal `neutral-*`, tokens unused in v1) in `AGENTS.md` under Style & naming, or adopt the tokens. Either beats leaving two systems in the tree with no rule.
- **Decision**: FIXED via AGENTS.md — a new Style & naming rule records that literal neutral-* wins and the shadcn tokens are unused in v1, plus the two contrast floors this review established (3:1 control borders, visible row rules) and the 44px tap-target convention.

### F7 — At HEAD, S-02's edit inputs are ~24px tap targets on the screen this phase made phone-ready

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/PriceQuantityCell.tsx` — `py-0.5` on the edit inputs
- **Detail**: Phase 3 established a 44px tap-target convention and applied it to all three controls (`h-11` on both selects and the Generate button, verified: `cn()`/tailwind-merge makes the incoming `h-11` beat `buttonVariants`' default `h-9`). The convention propagated well — S-03's Save button and the new error-boundary fallback button both adopted `h-11`. But S-02's editable price and quantity cells use `py-0.5`, roughly 24px tall, and they sit inside the very table whose phone readability is the PRD's single NFR. Strictly this is S-02's scope, not Phase 3's — the Phase-3 contract scoped tap targets to "the selects and button" — so it is recorded here rather than charged to this phase.
- **Fix**: Raise the edit inputs to `min-h-11` when S-02 is next touched, or record the exception deliberately.
- **Decision**: FIXED, with a correction to the finding — min-h-11 on the edit inputs and the wrapper switched to items-center so the unit label stays beside the number. NOTE: the report framed 44px as the bar, but that is WCAG 2.5.5 (AAA); the AA requirement is 2.5.8 Target Size (Minimum) at 24x24, which py-0.5 plus the ~24px line box already met. This is an enhancement, not an AA fix, and it makes each row ~12px taller (a 25-row list grows roughly 1000px to 1300px). Reverting is one class if that trade is not wanted.

## Post-triage state (2026-09-12)

All 7 findings fixed. Gates re-run: `npm test` 314 passed · `npx astro check` 0 errors · `npm run lint` exit 0 · `npm run build` complete. Verified in the shipped `dist/client/index.html`: the modification clause, `lang="en"` on the footer, and the unchanged `width=device-width, initial-scale=1` viewport meta.

**The critical finding is closed** — the footer now satisfies all four CC BY 4.0 attribution elements, so the REJECTED verdict above no longer reflects the working tree. On a re-run this phase would read APPROVED.

One correction to F7 as written: it framed 44px as the accessibility bar. That is WCAG 2.5.5 Target Size (Enhanced), level AAA. The AA requirement is 2.5.8 Target Size (Minimum) at 24x24 CSS px, which the original `py-0.5` inputs already met. The fix was applied anyway as an enhancement, at a cost of roughly 12px per row.

Changes are in the working tree, uncommitted.
