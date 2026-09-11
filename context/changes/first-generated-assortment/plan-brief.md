# Pierwszy wygenerowany asortyment — Plan Brief

> Full plan: `context/changes/first-generated-assortment/plan.md`

## What & Why

Roadmap slice **S-01**, the north star: the GM picks an assortment category and a settlement
wealth level, clicks "Stwórz", and gets a readable table of 10–25 unique items with name,
quantity and price. This is the step the PRD itself marks as "← wartość widoczna", and the
whole primary success criterion hangs on it — *8 of 10 GMs accept the assortment without
manual edits, visible in under 5 seconds*. The catalog already exists, so the domain rule is
the only unproven part of the product.

## Starting Point

The stack is wired (Astro 6 + React 19 + Tailwind 4, deployed to Workers since 2026-09-10)
and the item catalog is complete — 4 categories × 40 SRD items with rarity and price, behind
the typed contract in `src/data/items.ts:6-40`. But there is **zero product UI**: the single
route renders the starter hero, whose CTAs still point at the deleted `/auth/signin`. Nothing
in `src/` reads `ITEM_POOLS`. There is no test runner and no `npm test`.

## Desired End State

A GM opens the URL on a phone, picks a category and a wealth level, taps "Stwórz", and reads
a table aloud without editing it. A poor hamlet gives a short list of common goods at a
premium; a rich port gives a long list with a real share of rare stock at fair prices.
Pressing "Stwórz" again produces a visibly different shop. The page carries the SRD
attribution the licence requires. Nothing persists — a refresh clears the list, because
persistence belongs to S-03.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Tier exhaustion | Spill unmet demand to the nearest tier | Always returns exactly N unique rows and survives a future catalog regeneration that shifts tier depth. |
| List size | Derived from wealth (10–15 / 14–20 / 18–25) | A poor village plausibly has a smaller shop, and small lists make a heavy common skew arithmetically feasible. |
| Rarity mix | 70/30/**0**, 45/35/20, 25/35/40 | Zero rare in a squalid village directly closes the gap the PRD names as the likely decider of the 8/10 criterion. |
| Quantity rule | Banded by rarity tier (2–12 / 1–4 / 1) | Reuses the tier the rule already computes and guarantees no "7× Amulet of the Planes". |
| Price modifier | Scarcity markup — poor ×1.2, typical ×1.0, rich ×0.9 | Matches the frontier-post trope and pairs coherently with the rarity skew instead of compounding it. |
| Price format | Coin-aware gp / sp / cp | This is how a 5e table actually speaks, so the price column reads aloud without conversion. |
| Repeat draws | Soft recency penalty, in React state only | A second press must visibly differ on the slice the product is judged on; no storage, so S-03's boundary stays clean. |
| Mobile layout | One semantic table at every width | Three short columns fit ~360 px, and the PRD already settled on a table after rejecting the objection. |
| Tests | Vitest, domain rule only | The spill and quota logic fails *silently*; these assertions are the only thing that can catch it. |
| Persistence | None in this slice | F-01 owns the stored shape and S-03 owns persistence; guessing a format here is forward-only and costly to undo. |
| Attribution | Footer notice on the page | CC-BY-4.0 asks for attribution reasonable to the medium, and the public URL displays SRD-derived content. |

## Scope

**In scope:** the assortment rule (`src/lib/assortment.ts`), coin formatting
(`src/lib/format-price.ts`), Vitest + CI test step, the React island and table, route wiring
with `prerender = true`, deletion of three dead starter components, phone-width tuning, SRD
footer attribution.

**Out of scope:** any persistence (F-01, S-03); manual price/quantity editing and the
confirm-before-reroll dialog (S-02, FR-006/FR-008); saved-merchant list, naming, search,
delete (S-04, S-05); the shop-budget rule (PRD Open Question #3, rejected); catalog changes;
item-name translation; `output: "static"` (deploy-plan Phase 9); island or browser tests.

## Architecture / Approach

```
CATEGORIES / WEALTH_LEVELS ─┐
                            ├─► MerchantGenerator.tsx (island, client:load)
ITEM_POOLS (40/category) ───┘         │  state: category, wealth, rows, recentIds
                                      ▼
                    generateAssortment()  ← pure, no React/Astro, unit-tested
                    size band → tier quotas → weighted draw w/o replacement
                    → spill on exhaustion → quantity bands → price ×
                                      ▼
                              MerchantTable.tsx ──► formatPrice()
```

Wealth is one input driving three outputs — size band, rarity mix, price multiplier — held in
a single declarative `WEALTH_CONFIG` table so all three levers are tuned in one place.
Generation runs client-side (`AGENTS.md` hard rule: the Workers free tier caps CPU at 10 ms,
and server-side sampling would aim that ceiling at the 5-second criterion).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Domain rule + tests | `assortment.ts`, `format-price.ts`, Vitest, CI gate — no UI | Quota rounding and the spill path fail silently; mitigated by seeded-rng invariant tests |
| 2. Visible generator | Island + table + route wiring, starter placeholder deleted | First real UI; `prerender = true` must land or the route renders per-request |
| 3. Phone + attribution | 360 px readability, SRD footer notice | The only NFR and the CC-BY condition both close here — long SRD names wrapping is the layout pressure |

**Prerequisites:** none. S-01 has no roadmap dependencies and runs parallel to F-01
(`merchant-storage-contract`). The catalog and deploy pipeline are already in place.

**Estimated effort:** ~1–2 sessions across 3 phases. Phase 1 is the bulk of the thinking,
phases 2–3 are mostly layout.

## Open Risks & Assumptions

- **Verified feasible, so the spill path is defensive.** The chosen mixes fit measured tier
  depth at the top of every size band, meaning the fallback only ever triggers after a
  catalog regeneration. It is therefore covered by a synthetic-pool test, not by real data.
- **One accepted boundary:** `bogata` + `alchemik` at 25 rows needs 10 rare items from a tier
  holding exactly 10, so that combination always draws the identical rare subset. Not fixable
  without larger pools, which the PRD excludes.
- **The recency penalty must bias, never exclude** — excluding prior items would make the
  boundary case above unsatisfiable. The two features interact and the ordering matters.
- **The 8/10 criterion stays unproven until real GMs look at output.** PRD Open Question #3
  (rarity distribution vs. shop budget) is the named gap, and this plan implements the chosen
  rule without closing the question.
- **`npm run lint` cannot serve as a clean gate** on this Windows checkout (~1000 CRLF
  errors, zero real ones — `AGENTS.md`); judge by non-CRLF errors only.
- **Rarity means different things per category** — a price tercile for mundane pools, SRD
  rarity for magic. The rule treats them uniformly, which is deliberate but is why
  `alchemik`'s tiers overlap on price.

## Success Criteria (Summary)

- A GM picks category + wealth, clicks once, and reads a 10–25 row table aloud without
  editing it — well inside 5 seconds.
- The wealth choice visibly changes the shop: length, rare share, and price level all move.
- The table is comfortable on a 360 px phone with no horizontal scrolling and no zooming.
