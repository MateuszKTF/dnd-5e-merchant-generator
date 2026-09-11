# Kontrakt encji kupca i trwałości w przeglądarce — Plan Brief

> Full plan: `context/changes/merchant-storage-contract/plan.md`

## What & Why

Roadmap foundation **F-01**: the merchant entity shape plus a versioned browser-storage
read/write contract, with explicit behaviour when storage is unavailable, full, or holds data a
rolled-back build cannot read. Nothing GM-visible.

It exists ahead of S-03 because `AGENTS.md` makes this format **forward-only**: a Worker
rollback reverts the script but *not* a GM's `localStorage`, so any device that loaded a newer
format keeps it and the reverted code must still cope. S-03, S-04 and S-05 all read the same
record, so a wrong shape is paid for three times — and it carries the PRD's heaviest named
guardrail, *"zapisany kupiec nigdy nie znika po cichu"*.

## Starting Point

Browser persistence is entirely absent — zero references to `localStorage`, `sessionStorage` or
`indexedDB` in `src/`, and no merchant type anywhere. The only trace is a comment at
`src/env.d.ts:2-3`. The only existing types this slice needs are `CategoryId` and `Wealth` from
`src/data/items.ts:6-13`, so F-01 has **no code dependency on S-01 or S-02** — only on Vitest,
which arrives with whichever of the two parallel tracks starts first.

## Desired End State

One module owns the persisted format. It reads a versioned document from one `localStorage` key
and returns a typed result naming exactly what happened: data, empty, storage unavailable, a
document from a newer build, or a corrupt payload moved aside. The transient last-merchant slot
is physically separate from the durable collection, so a reroll can never touch a saved shop.
Every saved row is a self-contained snapshot that renders identically years later. Nothing is
deleted without an explicit GM action.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Save semantics | Promote a **copy** into the saved set | Flagging the transient record durable means the next Generate overwrites a saved merchant — the exact guardrail violation this slice exists to prevent. |
| Row storage | Self-contained snapshot (name + rarity denormalized) | `npm run data:build` can drop items, and a saved row referencing a dropped id is a row silently vanishing. |
| Corrections | Generated rows **plus** overlay | Reload can still mark corrected cells; flattening is irreversible. |
| Backend | `localStorage` | ~3.5 KB per merchant against a ~5 MB quota, and a sync API keeps three downstream slices free of async plumbing. |
| Key layout | One key, one document | Every write is atomic — one `setItem` lands whole or not at all, so a half-written orphan is impossible. |
| Newer schema on read | Refuse, warn, never write | The only option that cannot destroy data; the newer document survives untouched until the code catches up. |
| Corrupt payload | Quarantine to a side key, **only then** overwrite | Nothing is deleted — and if the quarantine copy itself cannot be written, the corrupt bytes are left untouched rather than replaced. |
| Storage full / disabled | Persistent banner, keep working | The guardrail forbids silent loss, not degraded operation; the GM is told plainly rather than discovering it next session. |
| Eviction | Never, no cap | Any automatic eviction contradicts the guardrail in writing; quota is over a thousand merchants away. |
| Auto-name | Category + date **+ time** | Three smiths in one session is normal, and FR-011/FR-012 both depend on the name being recognizable. |
| Testability | Injectable `StorageLike` parameter | Quota, corruption and version skew become ordinary unit tests — and those three paths are the justification for the slice. |
| Migrations | Version field + documented seam, no runner | Satisfies the rule when it actually bites, without designing a framework against zero migrations. |

## Scope

**In scope:** `src/lib/merchant.ts` (storage-owned types, id, auto-name, row mappers);
`src/lib/merchant-storage.ts` (versioned document, transient/durable split, promote, rename,
delete, list, and all failure statuses); `src/lib/storage-fake.test-helper.ts` for tests; unit tests for
every read and write outcome.

**Out of scope:** any UI — the banner is *reported* here and *rendered* by S-03; auto-persistence
policy (when to write is S-03's call); saved-list, rename, search and delete UI (S-04, S-05);
a migration runner; export/import (PRD Open Question #3, v2); server storage or Supabase;
eviction, caps, or quarantine cleanup; changes to any S-01/S-02 file; jsdom.

## Architecture / Approach

```
one stable, version-free localStorage key
        │
        ▼
StorageDocument { schemaVersion, transient: Merchant|null, saved: Merchant[] }
        │                                    ▲
readDocument(storage?) ──► discriminated union:
   ok / empty / unavailable / future-version / quarantined / unreadable
        │                        │
        │                        └─► latches read-only for the page load
        ▼
putTransient ─ every generate        promoteTransient ─ explicit save
  (touches transient only)             (fresh id + deep copy into saved)
```

Storage types are declared and owned **here**, deliberately not re-exported from
`AssortmentRow` — S-01 and S-02 must stay free to evolve their UI types without moving the
persisted format. A small mapper is the only place the two vocabularies meet. Every operation
returns a typed union rather than throwing, which is how F-01 defines "explicit behaviour when
storage fails" while shipping no UI.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Entity and naming | `merchant.ts` — types, id, auto-name, row mappers; pure and tested | The shape is forward-only; a wrong field now is permanent on every device that loads it |
| 2. Happy-path contract | `merchant-storage.ts` — document, transient/durable split, promote/rename/delete | The aliasing hazard: a shallow copy on promote silently reintroduces the save-then-reroll data loss |
| 3. Failure modes | `unavailable`, `quota-exceeded`, `quarantined`, `future-version` + read-only latch | Without the latch, the write after a skew detection overwrites exactly the data it protected |

**Prerequisites:** Vitest, which S-01 Phase 1 introduces. The roadmap runs F-01 and S-01 in
parallel with no code dependency — true here, since F-01 imports only `CategoryId`/`Wealth` —
but the runner is shared, so whichever starts first owns its setup.

**Estimated effort:** ~1–2 sessions across 3 phases. Phase 3 is the smallest in volume and the
largest in value.

## Open Risks & Assumptions

- **This format is permanent the moment one merchant exists on one device.** That is the whole
  premise; it is why the questioning was heavy for a slice with no UI.
- **The aliasing hazard is guarded structurally, not by discipline** — promote copies with a
  fresh id. A shallow copy reintroduces the bug, so Phase 2's most important test is
  promote-then-re-put and assert the saved record is unchanged.
- **Nothing may touch `window` at module scope.** Every page is prerendered, so this module is
  imported during a build running in Node/workerd. This breaks `npm run build`, not runtime.
- **Availability must be probed by writing.** Safari private mode exposes `localStorage` and
  throws only on `setItem`, so feature detection reports it available and then loses data.
- **Quarantined payloads accumulate and are never auto-reclaimed** — the consistent consequence
  of never evicting, and an accepted cost.
- **The single-key layout trades write cost for atomicity.** Every save rewrites the whole
  document; immaterial at v1 scale, but collection size is the real ceiling on this design.
- **The `future-version` path is untestable in production until a real schema change ships.**
  It is covered by fakes, and its live case cannot occur in v1 since no device holds data yet.

## Success Criteria (Summary)

- A saved merchant returns after closing the tab, identical to how the GM left it — corrections
  included.
- No merchant is ever removed except by an explicit GM delete; corrupt data is preserved and a
  newer-format document is left untouched.
- When storage cannot be written, the GM is told and the app keeps working.
