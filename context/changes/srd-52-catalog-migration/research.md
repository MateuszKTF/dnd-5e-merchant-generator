---
date: 2026-09-14T00:45:12+02:00
researcher: Mateusz Kotowicz
git_commit: c7ab09ab71e54f7918c1e9e521257f50c952264e
branch: review/impl-review-triage
repository: dnd-5e-merchant-generator
permalink_base: https://github.com/MateuszKTF/dnd-5e-merchant-generator/blob/c7ab09ab71e54f7918c1e9e521257f50c952264e
topic: "Gdzie itemId jest persystowany i co się dzieje z zapisanym kupcem przy nieznanym id"
tags: [research, codebase, srd, item-catalog, persistence, migration, licensing]
status: complete
last_updated: 2026-09-14
last_updated_by: Mateusz Kotowicz
---

# Research: Migracja katalogu SRD 5.1 → 5.2 a trwałość `itemId`

**Date**: 2026-09-14T00:45:12+02:00
**Researcher**: Mateusz Kotowicz
**Git Commit**: `c7ab09a`
**Branch**: `review/impl-review-triage`
**Repository**: dnd-5e-merchant-generator

## Research Question

> Przechodzę z SRD 5.1 na 5.2, co zmieni każdy `itemId` — prześledź, gdzie `itemId` jest
> persystowany i co się dziś dzieje z zapisanym kupcem, gdy trafi na nieznane id.

## Summary

**Nic się nie dzieje. Warstwa trwałości została zaprojektowana dokładnie pod ten przypadek
i mówi to wprost w trzech miejscach.**

To jest sprostowanie wcześniejszej diagnozy. Twierdzenie, że migracja „unieważni `itemId`
w każdym zapisanym kupcu" i że będzie to „zmiana danych z migracją storage", jest **fałszywe
w części o konsekwencji**. Identyfikatory faktycznie się zdezaktualizują — ale **nic ich nie
dereferencjuje**, więc `SCHEMA_VERSION` zostaje na `1` i żadna migracja dokumentu nie jest potrzebna.

Błąd wziął się z oparcia na komentarzu w `src/data/items.ts` (*„SRD index, stable across
regenerations — safe to persist in browser storage"*) bez sprawdzenia, czy ktokolwiek na tej
obietnicy polega. Nie polega — a `merchant.ts:22-24` mówi wprost, że obietnica jest słabsza,
niż brzmi: *„`src/data/items.ts` promises ids are stable, but **it does not promise an item survives**."*

**Prawdziwy koszt migracji leży w skrypcie budującym**, nie w magazynie.

## Detailed Findings

### Gdzie `itemId` jest persystowany — dwa miejsca, oba w jednym dokumencie

- `StoredRow.itemId` — `merchant.ts:34-39`
- klucze mapy korekt — `StoredCorrections = Record<string, StoredCorrection | undefined>`,
  `merchant.ts:53`, `:66`

Pochodne, **nietrwałe**:

- `recentIds` — `merchant-session.ts:109`, zasiewane z wierszy przy odtworzeniu; docblock
  (`:104-108`) mówi wprost, że to stan S-01 i *„is not persisted"*
- porównanie w `sameStoredWork` — `merchant-session.ts:374`

### `StoredRow` to samowystarczalny snapshot, nie referencja

```ts
export interface StoredRow {
  itemId: string;
  name: string;      // zdenormalizowane
  rarity: Rarity;    // zdenormalizowane
  quantity: number;
  priceGp: number;   // cena juz po modyfikatorze zamoznosci
}
```

`merchant.ts:20-32` uzasadnia denormalizację **dokładnie tym scenariuszem**:

> *„`src/data/items.ts` promises ids are stable, but it does not promise an item survives:
> `npm run data:build` drops Legendary and Artifact tiers, `Varies` parents and unpriced entries.
> A row holding only `itemId` would fail to render after such a regeneration — which is a row
> silently vanishing from a saved merchant, exactly what the PRD guardrail forbids. Carrying the
> label and the tier costs ~3.5 KB per merchant against a ~5 MB origin quota, so the safe choice
> is also the free one."*

Koszt został policzony i przyjęty **zanim** pojawiła się potrzeba migracji.

### Walidacja nie konsultuje katalogu

`isStoredRow` (`merchant.ts:99-110`) sprawdza `typeof row.itemId === "string"` — typ, nie
przynależność. `isMerchant` (`merchant.ts:118-124`) mówi to wprost:

> *„Deliberately shallow on `rarity`, `category` and `wealth`: they are validated as strings,
> **not against the catalog's current membership**. A tier or category this build does not recognise
> is exactly what the forward-only rule says to expect and to keep, so rejecting the whole merchant
> over one would discard a GM's saved work to enforce a vocabulary that is allowed to change."*

Wniosek: `salvage()` (`merchant-storage.ts:327-334`) **nie odrzuci ani jednego kupca** z powodu
nieznanych `itemId`. Obawa o masowe wypadnięcie rekordów jest bezpodstawna.

### `ITEM_POOLS` ma dokładnie jednego konsumenta

```
src/lib/assortment.ts:10   import { ITEM_POOLS, ... } from "@/data/items";
src/lib/assortment.ts:132  const { recentIds = [], rng = Math.random, pools = ITEM_POOLS } = opts;
```

Poza tym tylko `assortment.test.ts`. **Cała warstwa trwałości** — `merchant.ts`,
`merchant-storage.ts`, `merchant-session.ts`, `merchant-library.ts`, `MerchantGenerator.tsx` —
nie dotyka puli ani razu. Katalog jest konsultowany wyłącznie przy **nowym losowaniu**.

### Jedyny obserwowalny skutek: bias recency staje się no-opem

`recentIds` są opisane jako *„biased against, never excluded"* (`assortment.ts:108`), a implementacja
to miękka waga `RECENT_WEIGHT = 0.15` przez `const recent = new Set(recentIds)` (`:153`). Stare id
po prostu nie trafią w nową pulę.

`assortment.ts:133-135` przewiduje i to:

> *„The ids arrive typed, but they also round-trip through `JSON.parse` of `localStorage`,
> so **a stale document can carry a retired one and the lookup misses**."*

Skutek: pierwsze losowanie po migracji jest nieobciążone. Samo się naprawia przy następnym.

### Korekty pozostają spójne

Korekty są kluczowane po `itemId`, a wiersz **też** niesie `itemId` — oba zapisane w tym samym
dokumencie, oba stare. Pozostają więc wzajemnie spójne. To samo dotyczy `sameStoredWork`, które
porównuje transient z kopią zapisaną — obie z tego samego dokumentu.

### Prawdziwy koszt migracji: skrypt budujący

- `scripts/build-item-catalog.mjs:111` — dopasowanie po indeksie SRD, *„so a rename upstream fails loudly"*
- `scripts/build-item-catalog.mjs:235-236` — twardy assert na wpisanej z ręki liście indeksów
  `ALCHEMICAL`: `unknown SRD indexes in ALCHEMICAL: …`

Jeśli SRD 5.2 zmieni albo usunie któryś z tych indeksów, `npm run data:build` **padnie głośno,
na budowaniu** — czyli w najlepszym możliwym miejscu.

Kategorie i tiery rzadkości to wymysł projektu, nie SRD (`ATTRIBUTION.md`, punkty 1–3 i 5),
więc 5.2 ich nie dotyka. `CategoryId` to cztery polskie slugi, nie identyfikatory SRD.

### Korzyść licencyjna

SRD 5.2 został wydany przez WotC wprost pod **CC-BY-4.0**. Dziś `ATTRIBUTION.md` opisuje trasę
przez CC-BY mimo że `5e-bits/5e-database` rozprowadza materiał pod OGL 1.0a — po migracji to
rozróżnienie znika, bo źródło samo jest CC-BY.

Repozytorium źródłowe jest żywe: ostatni commit **2026-09-13**, release **v5.11.1**
(2026-09-12), automatyzacja release-please + dependabot. `src/2024/en/` zawiera komplet, w tym
`5e-SRD-Equipment.json` i `5e-SRD-Magic-Items.json`.

### Luka w testach

Nie ma testu na „zapisany kupiec z wycofanym `itemId`". Istnieją testy na:

- wycofaną kategorię i zamożność — `assortment.test.ts:205`, `:209`
- nieznaną kategorię — `merchant.test.ts:128`
- nietrafiające klucze overlay — `corrections.test.ts:50` (*„ignores overlay keys matching no row,
  so a stale overlay injects nothing"*)
- `recentIds` niepasujące do puli — `assortment.test.ts:304`

Sama gwarancja „wiersz z nieznanym id renderuje się normalnie" nie jest nigdzie przypięta —
bo nic jej nie dereferencjuje, więc nie ma czego testować na poziomie `src/lib`. Przy tej migracji
warto ją mimo to przypiąć jednym tanim testem regresyjnym, żeby denormalizacja nie została kiedyś
„zoptymalizowana".

## Code References

Baza: `https://github.com/MateuszKTF/dnd-5e-merchant-generator/blob/c7ab09ab71e54f7918c1e9e521257f50c952264e`

- `src/lib/merchant.ts:20-32` — uzasadnienie denormalizacji, wprost o regeneracji katalogu
- `src/lib/merchant.ts:34-39` — `StoredRow`, samowystarczalny snapshot
- `src/lib/merchant.ts:99-110` — `isStoredRow`, walidacja typu a nie przynależności
- `src/lib/merchant.ts:118-124` — `isMerchant`, *„not against the catalog's current membership"*
- `src/lib/assortment.ts:10`, `:132` — jedyny konsument `ITEM_POOLS`
- `src/lib/assortment.ts:133-135` — przewidziane wycofane id w `recentIds`
- `src/lib/merchant-session.ts:104-109` — `recentIds` nietrwałe, zasiewane z wierszy
- `scripts/build-item-catalog.mjs:111`, `:235-236` — dopasowanie po indeksie i twardy assert
- `src/data/ATTRIBUTION.md` — licencja, sześć punktów modyfikacji materiału

## Architecture Insights

**Denormalizacja `StoredRow` jest najlepiej opłaconą decyzją w tym projekcie.** Kosztowała
~3,5 KB na kupca i zamienia migrację katalogu z operacji na danych użytkownika w podmianę pliku
generowanego. Uzasadnienie było zapisane w kodzie **zanim** przypadek stał się realny.

**Forward-only zadziałało w obie strony.** Reguła z `AGENTS.md:16` istnieje po to, żeby rollback
Workera nie zniszczył `localStorage`. Efektem ubocznym jest płytka walidacja słownictwa — i to
właśnie ona sprawia, że migracja katalogu jest darmowa.

**Bramka jest we właściwym miejscu.** Skrypt budujący pada głośno przy zmianie indeksu, a aplikacja
degraduje się cicho i poprawnie przy nieznanym id. Twarda tam, gdzie jest programista; miękka tam,
gdzie jest MG przy stole.

## Historical Context (from prior changes)

- `merchant-storage-contract/plan.md:134-137` — typy magazynu są deklarowane i posiadane w F-01,
  celowo **nie** jako re-eksport `AssortmentRow`; mapper to jedyne miejsce spotkania słowników
- `merchant-storage-contract/reviews/plan-review.md:99-114` F4 — podział `StoredRow`/`AssortmentRow`
  był „asserted but not enforced"; **naprawione** asercją `MutuallyAssignable` w `merchant.test.ts:24`,
  `:67-68`. To jedyny niezmiennik międzymodułowy w projekcie egzekwowany mechanicznie
- `last-merchant-persists/plan.md:68-70` — *„Self-contained rows make a stale enum survivable"*
- PRD Open Question #2 — źródło danych i licencja, rozstrzygnięte w `ATTRIBUTION.md`

## Related Research

- `context/changes/item-name-localization/research.md` — ta sama denormalizacja widziana od strony
  nazw; obie zmiany dotykają `StoredRow.name` i powinny być planowane razem albo świadomie rozdzielone
- `context/changes/storage-layer-consistency-audit/research.md` — stan warstwy, która tę migrację przyjmie

## Open Questions

1. **Czy dwa słowniki w jednej bibliotece są akceptowalne?** Zapisani kupcy zachowają nazwy i ceny
   z 5.1 na zawsze, nowe losowania dadzą 5.2. To **nie** jest utrata danych i prawdopodobnie jest
   pożądane — zapisany sklep nie powinien zmieniać się MG pod ręką — ale trzeba to rozstrzygnąć
   w planie, nie odkryć po wdrożeniu.
2. **Czy `ALCHEMICAL` przetrwa 5.2?** Nie sprawdzono zawartości listy względem `src/2024/en`.
   To pierwsza rzecz do zweryfikowania — decyduje o rozmiarze zmiany w skrypcie.
3. **Czy kategorie mają być przemapowane?** `5e-SRD-Equipment-Categories.json` z 2024 może mieć inną
   strukturę niż z 2014, a przypisanie kategorii to własna praca projektu (`ATTRIBUTION.md` pkt 5).
4. **Czy przy okazji zaktualizować `ATTRIBUTION.md` na trasę czysto CC-BY?** Tak, ale to zmiana
   dokumentu, nie kodu — warto ją zaplanować razem, żeby licencja nie została z tyłu.
