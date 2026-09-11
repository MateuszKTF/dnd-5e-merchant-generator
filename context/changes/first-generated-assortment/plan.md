# Pierwszy wygenerowany asortyment — Implementation Plan

## Overview

Deliver roadmap slice **S-01** (north star): the GM picks an assortment category and a
settlement wealth level, clicks "Stwórz", and sees a readable table of 10–25 unique items
with name, quantity and price. The draw runs in the browser, the result is ephemeral, and
the page replaces the starter placeholder with the first real product UI.

The whole primary success criterion of the PRD hangs on this slice ("8 of 10 GMs consider
the assortment ready to use without manual edits", visible in under 5 seconds). The item
catalog already exists, so the only unproven part of the product is the domain rule itself —
which is why it is built as a pure, unit-tested module before any UI exists.

## Current State Analysis

**Present and usable:**

- **Item catalog, complete.** `src/data/items.ts:6-40` is the hand-written contract
  (`CategoryId`, `Rarity`, `Wealth`, `CatalogItem`, `CATEGORIES`, `WEALTH_LEVELS`,
  `RARITY_TIERS`) and re-exports `ITEM_POOLS` from the generated
  `src/data/items.generated.ts`. Four categories × 40 items, every row carries `rarity` and
  `priceGp`. Item ids are SRD indices, documented as stable across regenerations
  (`src/data/items.ts:17`).
- **Stack wired.** Astro 6 SSR + React 19 islands + Tailwind 4 (`astro.config.mjs:9-18`).
  `src/components/ui/button.tsx` is an unused shadcn primitive ready for the Generate button.
  `src/lib/utils.ts:4` provides `cn`.
- **Deploy proven.** Production live since 2026-09-10; `build → deploy → tail → rollback`
  documented in `context/deployment/deploy-plan.md`.

**Missing:**

- **Zero product UI.** The single route `src/pages/index.astro:1-8` renders
  `src/components/Welcome.astro`, the starter hero, whose CTAs point at the deleted
  `/auth/signin` and `/auth/signup` (`src/components/Welcome.astro:36,42`).
- **No domain logic at all.** Nothing reads `ITEM_POOLS`; there is no merchant type, no
  draw, no price formatting.
- **No test tooling.** Zero test files, no runner, no `npm test`. CI
  (`.github/workflows/ci.yml:18-24`) runs `lint` + `build` only.

**Constraints discovered:**

- **Tier depth is thin and uneven.** Measured from `src/data/items.generated.ts`:

  | Category | pospolite | niezwykłe | rzadkie | price span |
  | --- | --- | --- | --- | --- |
  | `przedmioty-magiczne` | 14 (110–470) | 13 (520–4800) | 13 (5400–21000) | — |
  | `kowal` | 14 (0.05–5) | 13 (5–25) | 13 (25–1500) | 6 items < 1 gp |
  | `alchemik` | 16 (0.1–470) | 14 (5–4400) | **10** (50–14000) | tiers overlap on price |
  | `towary-ogolne` | 14 (0.01–1) | 13 (1–8) | 13 (10–39) | 6 items < 1 gp |

  A 25-row list needs 25 *unique* items. Any rarity quota above pool depth is arithmetically
  unsatisfiable — a naive "70 % common at 25 rows" needs 18 items from a tier holding 14.
  This is not anticipated anywhere upstream.

- **`alchemik` tiers overlap on price** (pospolite reaches 470 gp while niezwykłe starts at
  5 gp) because that pool mixes SRD-rarity magic items with tercile-rated mundane gear. Any
  price-derived rule would behave oddly there; rarity-derived rules do not.

- **Rarity means different things per category.** For mundane pools it is a price tercile
  *within the category* — "dear for this kind of shop" — not real scarcity
  (`scripts/build-item-catalog.mjs:65-73`, `src/data/ATTRIBUTION.md`).

- **Architecture is settled, not open.** `AGENTS.md` hard rules, dated 2026-09-11 and marked
  "settled, not open": generate client-side in the React island (Workers free tier caps CPU
  at 10 ms/invocation), keep `output: "server"` but give every page
  `export const prerender = true`. Roadmap Open Question #4 is therefore stale.

- **Browser-storage schema changes are forward-only** (`AGENTS.md`). A Worker rollback does
  not revert a GM's `localStorage`. This is the reason this slice persists nothing.

- **`npm run lint` is unusable as a gate on this Windows checkout** — ~1000 `Delete ␍`
  errors from CRLF checkout, zero real errors (`AGENTS.md`). Git stores LF, `core.autocrlf=true`
  checks out CRLF, and there is no `.gitattributes`; CI on ubuntu checks out LF and passes.
  **This plan fixes it** (Phase 1, change 5) rather than working around it, because otherwise
  every phase in every slice carries an automated gate that cannot mechanically pass.

### Key Discoveries:

- The chosen wealth configuration is **feasible in every category at the top of every size
  band** — verified against measured tier depth. The spill fallback is therefore a safety
  net for a future `npm run data:build` that reshuffles tier depth, not a hot path.
- **One exact boundary:** `bogata` + `alchemik` at 25 rows requires 10 rare items and that
  tier holds exactly 10, so that combination always draws the identical rare subset.
  Accepted — the PRD caps pools at 30–40 items (`## Non-Goals`).
- **The recency penalty must be a soft bias, never an exclusion.** Excluding the previous
  draw's items would make the boundary case above unsatisfiable. The two features interact.
- `vitest@^5` declares peer `vite ^6.4.0 || ^7.0.0 || ^8.0.0`; this repo resolves Vite
  **7.3.3** and pins Node 22.14.0 (`.nvmrc`). Compatible. No `jsdom` needed — the rule under
  test is a pure function.
- `Banner.astro` and `ui/LibBadge.astro` have **zero references**; `Welcome.astro` is
  referenced only by `index.astro`. All three are safe to delete in this slice.
- Magic-item prices are deterministic per item id by design
  (`scripts/build-item-catalog.mjs:14-17`), so a given item always shows the same base price.

## Desired End State

A GM opens the app on a phone, picks one of four categories and one of three
wealth levels, taps "Stwórz", and immediately sees a table of 10–25 unique items — name,
quantity, price in gp/sp/cp — that reads aloud without editing. Pressing "Stwórz" again for
the same shop produces a visibly different list. A poor hamlet shows a short list of common
goods at a premium; a rich port shows a long list with a real share of rare stock at fair
prices. The page carries the SRD attribution the licence requires. Nothing is persisted:
a refresh clears the list (persistence is S-03's job).

**Verification:** `npm test` proves the rule's invariants; `npx astro check` and
`npm run build` pass; the built route appears as HTML under `dist/client/`; manual testing at
360 px width shows no horizontal scroll.

## What We're NOT Doing

- **No persistence of any kind.** No `localStorage`, no merchant entity type, no save
  action. F-01 (`merchant-storage-contract`) owns the stored shape and S-03 owns persistence;
  both run on a separate track.
- **No manual editing of price or quantity.** That is S-02 (`manual-item-corrections`,
  FR-006/FR-008), including the confirm-before-reroll dialog. This slice's "Stwórz" therefore
  regenerates freely with no confirmation, because there are no corrections to protect yet.
- **No saved-merchant list, naming, search or delete** — S-04, S-05.
- **No shop-budget rule.** PRD Open Question #3 records rarity distribution as the chosen
  rule and shop budget as the rejected alternative. Not revisited here.
- **No catalog changes.** `src/data/items.generated.ts` and
  `scripts/build-item-catalog.mjs` are untouched. No non-SRD content, ever.
- **No move to `output: "static"`** — deferred past the deadline (deploy-plan Phase 9).
- **No item-name translation.** SRD names stay English (`src/data/ATTRIBUTION.md`).
- **No React island tests.** Vitest covers the pure rule only.
- **No fix for stale roadmap Open Questions #4/#5.** #4 is settled in `AGENTS.md`; #5 is
  already corrected in `AGENTS.md` but still listed in the roadmap. Roadmap hygiene is not
  this slice's job.
- **No deployment.** Promotion to production is human-only (`AGENTS.md`), so no phase deploys.
  The end state is reached locally and verified against the workerd runtime with
  `npx wrangler dev`; releasing it is a separate, human-gated act.

## Implementation Approach

Three phases, each ending in something independently verifiable.

The domain rule is built first, as a **pure function with no React and no Astro imports**, so
the riskiest code in the product is covered by fast unit tests before any UI exists. Wealth
is the single input that drives three outputs — list size band, rarity mix, price
multiplier — and the rule is expressed as one declarative configuration table so those three
levers are read and tuned in one place.

The UI is then a thin island over that function: two native `<select>` elements (the OS
picker is the best mobile control and adds no dependency), the existing shadcn `Button`, and
a semantic `<table>`. Recency memory lives in React state only, never in storage.

The rule is deliberately **total**: for any (category, wealth) pair it returns exactly N
unique rows or throws a typed error that cannot occur with the committed catalog. The spill
fallback exists so that a future catalog regeneration degrades the mix instead of crashing
the one screen the product has.

## Critical Implementation Details

**State sequencing — recency penalty vs. tier exhaustion.** The recency bias must be applied
as a *weight reduction* inside each tier's candidate pool, never as a filter that removes
items. `bogata` + `alchemik` at 25 rows needs all 10 items of a 10-item tier, so any
exclusion makes the draw unsatisfiable. Reduce weight, then draw; if a tier's demand equals
its depth, every item in it is taken regardless of recency.

**Timing & lifecycle — first paint must not generate.** The route is prerendered, so the
island hydrates after HTML delivery. Do not auto-generate on mount: the GM chooses inputs
first, and an auto-draw would make the empty state unreachable and pre-empt S-03's
"restore the last merchant" behaviour on the same mount path.

**Performance constraint — the 5-second criterion is not at risk, and must not be put at
risk.** The draw is at most 25 selections from a 40-item array: microseconds. The criterion
only fails if generation is moved server-side into the 10 ms Workers CPU budget, which
`AGENTS.md` forbids. No memoization, no workers, no async.

## Phase 1: Domain rule and test harness

### Overview

Build the assortment rule and the price formatter as pure modules, and stand up Vitest so
their invariants are enforced from the first commit. No UI in this phase.

### Changes Required:

#### 1. Wealth configuration and the draw

**File**: `src/lib/assortment.ts` (new)

**Intent**: The single source of truth for how wealth shapes an assortment, plus the draw
that turns (category, wealth) into rows. Pure — no React, no Astro, no storage. Reads
`ITEM_POOLS` and the types from `src/data/items.ts`.

**Contract**:

- `AssortmentRow` — `{ itemId: string; name: string; rarity: Rarity; quantity: number; priceGp: number }`.
  `priceGp` is the wealth-modified price, unrounded; formatting is the caller's job. This is
  the shape `MerchantTable` consumes and the shape S-02 will later make editable — treat it
  as a contract surface.
- `WEALTH_CONFIG: Record<Wealth, { size: [min, max]; mix: Record<Rarity, number>; priceMultiplier: number }>`
  with the agreed values:

  | Wealth | size | pospolite | niezwykłe | rzadkie | price × |
  | --- | --- | --- | --- | --- | --- |
  | `nędzna` | 10–15 | 0.70 | 0.30 | 0.00 | 1.2 |
  | `typowa` | 14–20 | 0.45 | 0.35 | 0.20 | 1.0 |
  | `bogata` | 18–25 | 0.25 | 0.35 | 0.40 | 0.9 |

- `QUANTITY_BANDS: Record<Rarity, [min, max]>` — `pospolite` `[2, 12]`, `niezwykłe` `[1, 4]`,
  `rzadkie` `[1, 1]`.
- `generateAssortment(category: CategoryId, wealth: Wealth, opts?: { recentIds?: readonly string[]; rng?: () => number }): AssortmentRow[]`
  — the only export the UI calls. `rng` defaults to `Math.random` and exists so tests are
  deterministic; `recentIds` carries the previous draw for the same shop.

  Ordering inside the function: pick size from the band → convert the mix into integer
  per-tier quotas summing exactly to size → per tier, weight candidates down (not out) for
  membership in `recentIds` and draw without replacement → apply the spill rule below to any
  shortfall → assign a quantity per row from its tier's band → multiply each base price by
  `priceMultiplier`.

  **Quota rounding** must sum to exactly `size`: round each share, then correct the residual on
  the largest-share tier.

  **Eligible tiers.** A tier whose configured share is `0` is not part of the draw *at all* —
  it receives no quota and is never a spill destination. This is the rule that guarantees
  `nędzna` can never surface a rare item, which is the decision taken to close PRD Open
  Question #3 and which the Phase 1 tests assert as "ever". It is a property of the tier, not
  of rounding.

  **Spill rule.** When a tier cannot fill its quota, the shortfall moves to the nearest
  *eligible* tier by rarity distance, and keeps moving outward if that one is also exhausted:

  | Short tier | Tries, in order |
  | --- | --- |
  | `pospolite` | `niezwykłe`, then `rzadkie` |
  | `niezwykłe` | `pospolite`, then `rzadkie` |
  | `rzadkie` | `niezwykłe`, then `pospolite` |

  `niezwykłe` prefers `pospolite` over `rzadkie` because overshooting downward reads as a
  poorer shop, which is a milder lie than a backwater stocking rare goods. Ineligible
  (zero-share) tiers are skipped in every row of this table.

  Throws a typed error only when no eligible tier can supply the remaining rows — unreachable
  with the committed 40-item pools, present so a future regeneration fails loudly instead of
  returning a short table.

#### 2. Coin-aware price formatting

**File**: `src/lib/format-price.ts` (new)

**Intent**: Render a gp number the way a 5e table speaks it, so the GM reads the price column
aloud without converting. Kept separate from the rule because S-02 will need to parse this
format back when editing lands.

**Contract**: three exports, with the threshold logic living in exactly one of them.

- `priceParts(gp: number): { value: number; unit: PriceUnit }` where `PriceUnit` is
  `"gp" | "sp" | "cp"` — the single place the thresholds are decided.
- `partsToGp(value: number, unit: PriceUnit): number` — its inverse. Round-trip invariant:
  `partsToGp(...priceParts(gp))` equals `gp` to within 1 cp across the catalog's range.
- `formatPrice(gp: number): string` — a thin wrapper over `priceParts`, so the rendered string
  and the parts can never disagree about a boundary.

The split exists now rather than later because S-02 (`manual-item-corrections`) already
specifies editing a price in the unit the GM is reading, which needs the parts rather than the
joined string. Shipping only `formatPrice` would force an immediate refactor one slice later.

Thresholds: below 0.1 gp render whole copper
(`1 gp = 100 cp`); below 1 gp render silver (`1 gp = 10 sp`), one decimal at most; from 1 gp
up render gold with a thousands separator and no decimals beyond two. Never render `0` — the
floor is `1 cp`, which matters because `towary-ogolne` holds items at 0.01 gp that the 1.2
`nędzna` multiplier leaves fractional. Polish unit labels (`gp` / `sp` / `cp` are the
conventional short forms at Polish tables; keep them).

#### 3. Test runner

**File**: `vitest.config.ts` (new), `package.json` (modify)

**Intent**: Make the domain rule's invariants enforceable. Node environment only — no
`jsdom`, nothing React.

**Contract**: `vitest@^5` as a devDependency (its peer range `vite ^6.4 || ^7 || ^8` accepts
the resolved Vite 7.3.3). Add `"test": "vitest run"` and `"test:watch": "vitest"` to
`scripts`. Config restricts `include` to `src/**/*.test.ts` so no Astro or `.tsx` file is
ever collected.

#### 4. Rule tests

**File**: `src/lib/assortment.test.ts` (new), `src/lib/format-price.test.ts` (new)

**Intent**: Cover the invariants that fail silently — the ones that produce a
plausible-looking but wrong table.

**Contract**: With a seeded `rng`, over all 4 categories × 3 wealth levels:

- row count always inside the wealth's band, and always within the PRD's 10–25 envelope;
- `itemId` values unique within a list (FR-004);
- every row's item actually belongs to the requested category's pool;
- realised rarity counts match the configured mix after integer rounding, and quotas sum to
  the row count exactly;
- `nędzna` yields zero `rzadkie` rows, ever;
- quantity inside its tier's band; every `rzadkie` row has quantity exactly 1;
- price equals base × the wealth multiplier;
- passing the previous draw as `recentIds` shifts the result — assert overlap drops, not that
  it reaches zero, since the bias is soft;
- a synthetic pool with a deliberately shallow tier exercises the spill path and still
  returns the full row count, following the preference order in the spill table;
- a synthetic pool shallow enough to force spilling **under `nędzna`** still yields zero
  `rzadkie` rows — the zero-share tier stays ineligible even when the eligible ones run dry,
  which is the one case where the spill rule and the `nędzna` invariant could contradict;
- `formatPrice` boundaries: 0.01 gp, 0.05 gp, 0.1 gp, 0.9 gp, 1 gp, 1500 gp, 21000 gp, and
  0.01 × 1.2 — none may render as `0`;
- `priceParts` / `partsToGp` round-trip to within 1 cp across those same boundaries, and
  `formatPrice` agrees with `priceParts` at every threshold.

#### 5. Line-ending normalization

**File**: `.gitattributes` (new)

**Intent**: Make `npm run lint` a gate that can actually be run rather than one a human has to
interpret. Without this, every phase of every slice carries an automated criterion that always
exits non-zero — `AGENTS.md` records the cause and proposes exactly this fix.

**Contract**: `* text=auto eol=lf`, then a one-time `git add --renormalize .` to bring the
working tree in line. Expect a large, mechanical diff touching every tracked text file; it must
land as its own commit, separate from the domain rule, so the rule's diff stays reviewable.

Land this **first in the phase** — before the rule, the formatter and the tests — so those files
are written under the normalized settings rather than needing a second renormalization pass.

After it lands, `npm run lint` is expected to pass cleanly on Windows and on CI, and the
`AGENTS.md` note about judging by non-CRLF errors becomes obsolete. Updating that note is not
this slice's job, but it is worth flagging to whoever next edits `AGENTS.md`.

#### 6. CI gate

**File**: `.github/workflows/ci.yml` (modify)

**Intent**: Run the new tests on every push and PR so a broken rule cannot reach main.

**Contract**: Insert `- run: npm test` after the existing `npx astro sync` step and before
`npm run build`. Leave the `lint` step and the Supabase env block as they are.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Reading `WEALTH_CONFIG` alone makes the three wealth levels' behaviour obvious without
  reading the draw code
- A quick scratch run for each of the 12 (category, wealth) pairs produces lists a GM would
  plausibly accept — spot-check that `nędzna kowal` reads as a village smithy and
  `bogata przedmioty-magiczne` as a high-end arcane shop

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 2: Visible generator

### Overview

Put the rule on screen: the island with its two selects and Generate button, the table, the
route wiring, and removal of the starter placeholder. Ends with the north-star flow —
click to table — working end to end.

### Changes Required:

#### 1. Generator island

**File**: `src/components/MerchantGenerator.tsx` (new)

**Intent**: Own the interaction and the ephemeral state: the two selections, the current
assortment, and the previous draw's ids for the recency bias. Calls `generateAssortment` and
renders `MerchantTable`.

**Contract**: Default-exported React component, no props. State: `category` and `wealth`
(seeded from the first entry of `CATEGORIES` / `WEALTH_LEVELS` so the control is never
empty), `rows: AssortmentRow[] | null`, `recentIds: string[]`, and `error: string | null`.
`null` rows means "nothing generated yet" and renders the empty state, which is distinct from
an empty array.

The Generate handler wraps the rule call in `try`/`catch`. Phase 1 gives
`generateAssortment` a typed throw for the case where no eligible tier can supply the
remaining rows; catching it sets `error` and renders a short message in place of the table,
leaving the controls and the button fully usable. A successful draw clears `error`.

This path is unreachable against the committed catalog — it exists because `npm run data:build`
can reshape tier depth, and an uncaught throw here would blank the only page the product has.

Controls are native `<select>` elements populated from `CATEGORIES` and `WEALTH_LEVELS` — the
OS picker is the best mobile control and adds no dependency. The action uses the existing
`Button` from `@/components/ui/button`.

On Generate: call the rule with the current `recentIds`, set `rows`, then replace `recentIds`
with the new draw's ids. Changing category or wealth clears `recentIds` — recency is
per-shop, and carrying it across a different shop would bias a draw for no reason. No
persistence, no effects on mount, no auto-generate.

#### 2. Assortment table

**File**: `src/components/MerchantTable.tsx` (new)

**Intent**: Render rows as a semantic table the GM can read aloud. Presentation only —
no state, no generation.

**Contract**: `{ rows: readonly AssortmentRow[] }`. A real `<table>` with `<thead>` and
column headers Nazwa / Ilość / Cena (FR-007). Price cells go through `formatPrice`. Numeric
columns right-aligned and sized to content; the name column absorbs remaining width. Include
the row count near the table so the 10–25 guarantee is visible. Rarity is available on the
row but is **not** a column — the PRD specifies exactly three.

#### 3. Route wiring

**File**: `src/pages/index.astro` (modify)

**Intent**: Mount the island on the single product route and comply with the prerender rule.

**Contract**: Add `export const prerender = true` to the frontmatter — required of every page
by `AGENTS.md`, and currently absent. Drop the `Welcome` import and render
`<MerchantGenerator client:load />` inside `Layout`. `client:load` rather than `client:visible`
because the generator is the entire page and the first interaction must not wait on an
intersection observer.

#### 4. Starter cleanup

**File**: delete `src/components/Welcome.astro`, `src/components/Banner.astro`,
`src/components/ui/LibBadge.astro`

**Intent**: Remove the starter placeholder and its orphans. `Welcome.astro` advertises
Supabase auth and links to the deleted `/auth/signin` and `/auth/signup`
(`src/components/Welcome.astro:36,42`) — it is publicly visible on the production URL today.

**Contract**: Verified zero remaining references: `Banner` and `LibBadge` have none at all,
`Welcome` only the `index.astro` import removed above. Nothing else imports them.

### Success Criteria:

#### Automated Verification:

- Unit tests still pass: `npm test`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- The route is prerendered: `index.html` exists under `dist/client/`
- No dangling references to the deleted components:
  `grep -r "Welcome\|Banner\|LibBadge" src` returns nothing
- Linting passes: `npm run lint`

#### Manual Verification:

- Selecting a category and wealth, then clicking "Stwórz", shows a table of 10–25 rows with
  name, quantity and price; result appears effectively instantly, far inside the PRD's 5 s
- Pressing "Stwórz" again for the same shop produces a visibly different list
- Switching wealth changes the character of the list: `nędzna` is shorter with no rare items
  and dearer prices, `bogata` is longer with a real rare share and cheaper prices
- No row repeats an item name within one list
- Before the first click the page shows a sensible empty state, not an empty table
- `/auth/signin` and the Supabase starter hero are gone from the page

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 3: Phone readability and attribution

### Overview

Close the PRD's only NFR (readable on a narrow phone, no horizontal scroll, no zooming) and
the CC-BY-4.0 attribution condition the item catalog depends on.

### Changes Required:

#### 1. Narrow-screen table treatment

**File**: `src/components/MerchantTable.tsx` (modify),
`src/components/MerchantGenerator.tsx` (modify)

**Intent**: Make a 25-row, three-column table comfortable to read at ~360 px without
horizontal scrolling or pinch-zoom, which is the single NFR in the PRD.

**Contract**: One markup path at all widths — no separate mobile layout. Tailwind utilities
only. Quantity and price columns get content-width and right alignment; the name column wraps
rather than overflowing, so long SRD names like "Amulet of Proof against Detection and
Location" produce taller rows instead of a scrollbar. Controls stack vertically on narrow
screens and sit inline when there is room. Row separation must stay legible when row heights
are uneven from wrapping. Tap targets on the selects and button must remain comfortable.

#### 2. SRD attribution

**File**: `src/layouts/Layout.astro` (modify)

**Intent**: Satisfy CC-BY-4.0, which the item catalog relies on
(`src/data/ATTRIBUTION.md`). The production URL is public and displays SRD-derived content,
so the notice belongs on the page, not only in the repo.

**Contract**: A persistent footer below the `<slot />` carrying the attribution text required
by `src/data/ATTRIBUTION.md` — credit to the SRD 5.1 by Wizards of the Coast, a link to
`https://dnd.wizards.com/resources/systems-reference-document`, and a link to the CC-BY-4.0
licence. Small type, low contrast against the table, and it must not push the first rows
below the fold on a phone. Put it in the layout rather than the island so it survives any
future route.

### Success Criteria:

#### Automated Verification:

- Unit tests still pass: `npm test`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- At 360 px viewport width, a 25-row `bogata` list shows no horizontal scrollbar and needs no
  zooming to read
- The longest item names in the catalog wrap cleanly instead of overflowing
- The price column is readable at a glance, with sub-gold prices shown as sp/cp and none
  rendering as `0`
- Controls and the Generate button are comfortably tappable on a phone
- The SRD attribution and licence links are visible and correct, and do not crowd the table
- Verified on a real phone-sized viewport, not only a desktop emulation

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- `generateAssortment` invariants across all 12 (category, wealth) pairs with a seeded rng:
  row count in band and inside 10–25, item uniqueness, category membership, realised rarity
  mix vs. configured mix, quotas summing exactly to row count, zero rare rows for `nędzna`,
  quantity within tier band, rare quantity exactly 1, price equal to base × multiplier
- Spill path via a synthetic pool with a deliberately shallow tier — must still return the
  full row count
- Recency bias reduces overlap between consecutive draws without eliminating it
- `formatPrice` at every coin boundary, including 0.01 gp × 1.2, with a hard assertion that
  nothing renders as `0`

### Integration Tests:

None. No framework for island or browser testing is configured, and adding one is explicitly
out of scope. The island is thin enough that the manual steps below cover it.

### Manual Testing Steps:

1. `npm run dev`, open the app, confirm the empty state before any click
2. Pick `kowal` + `nędzna`, click "Stwórz": expect a short list (10–15), no rare items,
   prices visibly above base
3. Click "Stwórz" again: expect a visibly different list
4. Switch to `bogata`, click "Stwórz": expect a longer list (18–25) with a real rare share
   and cheaper prices
5. Run every category at `bogata` and confirm no repeated item names in any single list
6. Narrow the viewport to 360 px on a 25-row list: confirm no horizontal scroll, no zoom
   needed, long names wrapping cleanly
7. Confirm sub-gold prices read as sp/cp and none show `0`
8. Confirm the SRD attribution and licence links are present and correct
9. `npm run build` then `npx wrangler dev`: confirm the same behaviour on the workerd runtime
   that production uses

## Performance Considerations

The draw is at most 25 selections from a 40-item array — microseconds, nowhere near the PRD's
5-second criterion. The criterion is only threatened if generation moves server-side into the
Workers free-tier 10 ms CPU budget, which `AGENTS.md` forbids and this plan does not do. No
memoization, async work or web workers are warranted; adding them would be complexity without
a measurable gain.

The prerendered route means the HTML ships as a static asset and only the island's JS
hydrates, keeping time-to-first-paint independent of the generator entirely.

## Migration Notes

Nothing to migrate. This slice writes no persistent data — no `localStorage`, no schema — so
the forward-only browser-storage rule in `AGENTS.md` does not engage. Rollback is a plain
Worker rollback (`context/deployment/deploy-plan.md`) with no data consequences.

`AssortmentRow` is the contract surface that F-01 and S-02 will build on: F-01 will wrap it
in a persisted merchant entity, S-02 will make `quantity` and `priceGp` editable. Renaming or
reshaping those fields later is the expensive change, so the field names are chosen to survive
both.

## References

- Roadmap item: `context/foundation/roadmap.md:152-175` (S-01), backlog row at line 259
- Change identity: `context/changes/first-generated-assortment/change.md`
- PRD: `context/foundation/prd.md` — US-01, FR-001 – FR-005, FR-007, `## Business Logic`,
  the single NFR, and Open Question #3 (rarity distribution as the chosen rule)
- Item catalog contract: `src/data/items.ts:6-40`
- Rarity/price derivation rationale: `scripts/build-item-catalog.mjs:28-73`,
  `src/data/ATTRIBUTION.md`
- Client-side generation and prerender rules: `AGENTS.md` § Hard rules
- Deploy and rollback runbook: `context/deployment/deploy-plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Domain rule and test harness

#### Automated

- [x] 1.1 Unit tests pass: `npm test`
- [x] 1.2 Type checking passes: `npx astro check`
- [x] 1.3 Production build succeeds: `npm run build`
- [x] 1.4 Linting passes: `npm run lint`

#### Manual

- [x] 1.5 `WEALTH_CONFIG` makes the three wealth levels' behaviour obvious on its own
- [x] 1.6 Scratch run of all 12 (category, wealth) pairs produces plausible assortments

### Phase 2: Visible generator

#### Automated

- [ ] 2.1 Unit tests still pass: `npm test`
- [ ] 2.2 Type checking passes: `npx astro check`
- [ ] 2.3 Production build succeeds: `npm run build`
- [ ] 2.4 Route is prerendered: `index.html` exists under `dist/client/`
- [ ] 2.5 No dangling references to deleted components in `src`
- [ ] 2.6 Linting passes: `npm run lint`

#### Manual

- [ ] 2.7 Category + wealth + "Stwórz" shows a 10–25 row table well inside 5 s
- [ ] 2.8 Pressing "Stwórz" again produces a visibly different list
- [ ] 2.9 Wealth visibly changes list length, rare share and price level
- [ ] 2.10 No repeated item name within a single list
- [ ] 2.11 Sensible empty state before the first click
- [ ] 2.12 Starter hero and `/auth/signin` links gone from the page

### Phase 3: Phone readability and attribution

#### Automated

- [ ] 3.1 Unit tests still pass: `npm test`
- [ ] 3.2 Type checking passes: `npx astro check`
- [ ] 3.3 Production build succeeds: `npm run build`
- [ ] 3.4 Linting passes: `npm run lint`

#### Manual

- [ ] 3.5 25-row list at 360 px has no horizontal scroll and needs no zooming
- [ ] 3.6 Longest catalog item names wrap cleanly
- [ ] 3.7 Sub-gold prices read as sp/cp and none render as `0`
- [ ] 3.8 Controls and button comfortably tappable on a phone
- [ ] 3.9 SRD attribution and licence links visible, correct, and not crowding the table
- [ ] 3.10 Verified on a real phone-sized viewport, not desktop emulation
