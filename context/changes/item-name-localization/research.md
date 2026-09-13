---
date: 2026-09-14T00:45:12+02:00
researcher: Mateusz Kotowicz
git_commit: c7ab09ab71e54f7918c1e9e521257f50c952264e
branch: review/impl-review-triage
repository: dnd-5e-merchant-generator
permalink_base: https://github.com/MateuszKTF/dnd-5e-merchant-generator/blob/c7ab09ab71e54f7918c1e9e521257f50c952264e
topic: "Gdzie nazwy przedmiotów trafiają do UI, czy są persystowane i czy służą za klucz sortowania lub wyszukiwania"
tags: [research, codebase, i18n, item-catalog, merchant-table, search]
status: complete
last_updated: 2026-09-14
last_updated_by: Mateusz Kotowicz
---

# Research: Polskie nazwy przedmiotów — zasięg zmiany

**Date**: 2026-09-14T00:45:12+02:00
**Researcher**: Mateusz Kotowicz
**Git Commit**: `c7ab09a`
**Branch**: `review/impl-review-triage`
**Repository**: dnd-5e-merchant-generator

## Research Question

> Nazwy przedmiotów są po angielsku — sprawdź, gdzie trafiają do UI, czy są persystowane
> i czy służą za klucz sortowania lub wyszukiwania.

## Summary

Trzy odpowiedzi, wszystkie jednoznaczne:

- **Do UI trafiają w dokładnie trzech miejscach, wszystkie w jednym pliku.** Dwa z nich to `aria-label`.
- **Są persystowane** — `StoredRow.name`, w każdym zapisanym kupcu, celowo zdenormalizowane.
- **Nie są kluczem sortowania ani wyszukiwania.** Ani razu, nigdzie.

Warstwa lookup zalecana przez `ATTRIBUTION.md` jest właściwym wyborem — i research podaje powód,
którego `ATTRIBUTION.md` nie zna: **skoro nazwy są zapisane w każdym kupcu, tłumaczenie przy zapisie
zostawiłoby wszystkich istniejących kupców po angielsku na zawsze.**

Zakres zmiany: **trzy linie w jednym pliku**, zero zmian w magazynie, zero migracji, zero wpływu
na wyszukiwanie i sortowanie.

## Detailed Findings

### Gdzie nazwa pozycji trafia do UI

| Miejsce | Rola |
| --- | --- |
| `MerchantTable.tsx:84` | `{generated.name}` — widoczna komórka tabeli |
| `MerchantTable.tsx:91` | `label={\`Ilość — ${generated.name}\`}` — nazwa dostępna pola edycji ilości |
| `MerchantTable.tsx:115` | `label={\`Cena (${unit}) — ${generated.name}\`}` — nazwa dostępna pola edycji ceny |

Poza `MerchantTable.tsx` nazwa pozycji nie pojawia się nigdzie. `PriceQuantityCell.tsx` przyjmuje
gotowy `label` jako props i sam nazwy nie dotyka.

**Dwie z trzech to nazwy dostępne.** Przetłumaczenie samej komórki dałoby użytkownikowi czytnika
ekranu angielski tam, gdzie oko widzi polski — rozjazd niewidoczny dla osoby, która go wprowadza.

### Uwaga terminologiczna: dwa różne „name"

Łatwo je pomylić i to ma znaczenie dla zakresu:

- **`Merchant.name`** — nazwa *sklepu*. Polska. Generowana przez `autoName` (`merchant.ts:236-245`)
  z etykiety kategorii i daty (`"Kowal — 11.09.2026, 14:32"`), edytowalna przez MG.
- **`StoredRow.name` / `CatalogItem.name`** — nazwa *przedmiotu*. Angielska, z SRD.

Wszystko, co dotyczy wyszukiwania, sortowania i normalizacji w `merchant-library.ts`, dotyczy
**wyłącznie tej pierwszej**.

### Persystencja: tak, celowo, w każdym kupcu

`StoredRow` (`merchant.ts:34-39`) niesie `name` obok `itemId`, `rarity`, `quantity` i `priceGp`.
Docblock (`:20-32`) uzasadnia to wprost: wiersz trzymający sam `itemId` przestałby się renderować
po regeneracji katalogu, co byłoby *„a row silently vanishing from a saved merchant, exactly what
the PRD guardrail forbids"*. Koszt: ~3,5 KB na kupca przy ~5 MB quoty.

`merchant-library.ts:253-255` potwierdza z drugiej strony: *„`rows` is denormalized and
self-contained (F-01), so the count needs no catalog."*

### Klucz sortowania: nie

W całym `src/lib` i `src/components` są **dwa** wywołania `.sort()`:

- `sortForLibrary` (`merchant-library.ts:195`) — po `savedAt`, tiebreak po `id`
- `holdOrder` (`merchant-library.ts:400`) — po zamrożonej kolejności `id`

Żadne nie dotyka nazw pozycji. Wierszy asortymentu nie sortuje nic — `MerchantTable` renderuje je
w kolejności losowania (`rows.map((generated, index) => …)`).

**Zero `localeCompare`, zero `Intl.Collator`** w całym drzewie źródeł.

### Klucz wyszukiwania: nie

`matchesQuery` (`merchant-library.ts:319-328`):

```ts
return (
  normalizeForSearch(merchant.name).includes(normalizedQuery) ||
  normalizeForSearch(categoryLabel).includes(normalizedQuery)
);
```

Przeszukiwane są **nazwa sklepu** i **etykieta kategorii**. Nazwy pozycji nie biorą udziału.
`autoName` również buduje nazwę z etykiety kategorii i daty, nie z zawartości asortymentu.

### Co z tego wynika dla projektu zmiany

`ATTRIBUTION.md` radzi: *„translate in a lookup layer rather than by editing the generated file,
so regeneration stays safe."* Rada jest słuszna, ale jej uzasadnienie w `ATTRIBUTION.md` dotyczy
tylko bezpieczeństwa regeneracji. Research dokłada mocniejszy powód:

**Tłumaczenie przy zapisie (polskie `name` w `StoredRow`) rozbiłoby bibliotekę na dwa języki.**
Istniejący kupcy mają w `localStorage` angielskie nazwy i nic ich nie przepisze — a przepisywanie
zapisanych rekordów przy odczycie jest dokładnie tym, czego zakazuje reguła forward-only
(`AGENTS.md:16`). Nowi kupcy byliby polscy, starzy angielscy, na zawsze.

**Lookup po `itemId` przy renderowaniu** daje polski również w starych kupcach, bo nie patrzy na
zapisane `name` wcale. Degradacja jest łagodna: gdy `itemId` zostanie wycofany z katalogu, lookup
chybia i wiersz spada na zapisaną nazwę angielską — nigdy na pusty wiersz. To ten sam wzorzec,
który `merchant-library.ts:268-270` stosuje dla etykiet kategorii.

Tryb mieszany (część wierszy po polsku, część po angielsku) jest więc możliwy i jest **właściwym**
zachowaniem, a nie usterką. Warto go nazwać w planie.

### Ryzyko do sprawdzenia: długość

Jedyny NFR w PRD to czytelność na wąskim ekranie telefonu bez poziomego scrolla.
`MerchantTable.tsx:52-63` rozwiązuje to przez `w-px` + `whitespace-nowrap` na kolumnach liczbowych
i `wrap-anywhere` na nazwie — komentarz (`:81-84`) tłumaczy, że tylko `overflow-wrap: anywhere`
zmniejsza wkład komórki do min-content.

Polskie nazwy bywają dłuższe od angielskich („Potion of Healing" → „Mikstura leczenia",
„Adamantine Armor" → „Zbroja adamantytowa"). Mechanizm jest odporny z założenia, ale **nie był
mierzony na dłuższych ciągach** — to jedyna rzecz w tej zmianie warta ręcznej weryfikacji na 360 px.

### Uwaga: nie mylić z defektem normalizacji nazw

Audyt warstwy zapisu znalazł realny defekt w `normalizeName` — nazwa **sklepu** złożona z miękkich
dywizów renderuje się jako pusty, nieodnajdywalny wiersz. To **inny** problem, w innej ścieżce,
i nie ma związku z tą zmianą. Zob. `storage-layer-consistency-audit/research.md`, F1.

## Code References

Baza: `https://github.com/MateuszKTF/dnd-5e-merchant-generator/blob/c7ab09ab71e54f7918c1e9e521257f50c952264e`

- `src/components/MerchantTable.tsx:84` — widoczna komórka z nazwą pozycji
- `src/components/MerchantTable.tsx:91`, `:115` — nazwy dostępne pól edycji
- `src/components/MerchantTable.tsx:81-84` — uzasadnienie `wrap-anywhere` (kandydat do weryfikacji)
- `src/lib/merchant.ts:34-39` — `StoredRow.name`, persystowane
- `src/lib/merchant.ts:20-32` — dlaczego zdenormalizowane
- `src/lib/merchant-library.ts:319-328` — `matchesQuery`, przeszukuje nazwę sklepu i kategorię
- `src/lib/merchant-library.ts:195`, `:400` — jedyne dwa `.sort()`, żaden po nazwie pozycji
- `src/lib/merchant-library.ts:268-270` — wzorzec degradacji etykiety, do naśladowania w lookupie
- `src/data/ATTRIBUTION.md` — instrukcja „translate in a lookup layer"
- `scripts/build-item-catalog.mjs` — generator, którego lookup nie może dotykać

## Architecture Insights

**Denormalizacja `StoredRow.name` jest jednocześnie ochroną i ograniczeniem.** Chroni zapisanego
kupca przed zniknięciem pozycji, a przy okazji uniemożliwia tłumaczenie przy zapisie — co akurat
wypycha projekt we właściwą stronę.

**Nazwy pozycji nie są w żadnej ścieżce decyzyjnej.** Nie są kluczem, nie są porównywane, nie
uczestniczą w sortowaniu. To czyni je jednym z najtańszych możliwych punktów tłumaczenia w całym
produkcie — koszt jest praktycznie wyłącznie redakcyjny (~160 nazw), nie inżynierski.

**Istniejąca obsługa polskich znaków jest gotowa, gdyby zakres się kiedyś rozszerzył.**
`normalizeForSearch` (`merchant-library.ts:292-306`) już radzi sobie z NFD, znakami łączącymi
i osobno z `ł` (U+0142 nie ma dekompozycji kanonicznej) — więc gdyby nazwy pozycji kiedyś stały się
przeszukiwalne, maszyneria istnieje.

## Historical Context (from prior changes)

- `src/data/ATTRIBUTION.md` — decyzja o nietłumaczeniu w v1: *„translating ~160 item names by hand
  is error-prone work that the deadline does not allow, and Polish 5e tables commonly use the English
  item names anyway"*. To jedyne miejsce, gdzie ta zmiana jest z góry zapowiedziana wraz z metodą.
- `manual-item-corrections/plan.md` — `MerchantTable` jako prezentacja plus zdarzenia, bez własnego
  stanu korekt; lookup musi się wpiąć po stronie prezentacji, żeby tego nie naruszyć
- `merchant-storage-contract/plan.md:134-137` — słownik magazynu jest oddzielony od słownika UI,
  a mapper (`toStoredRows` / `fromStoredRows`) to jedyne miejsce spotkania. Lookup **nie** powinien
  wchodzić do mappera — tam zacząłby zapisywać tłumaczenia.

## Related Research

- `context/changes/srd-52-catalog-migration/research.md` — ta sama denormalizacja od strony `itemId`;
  jeśli obie zmiany mają iść, migracja katalogu powinna być pierwsza, bo zmienia zbiór nazw do przetłumaczenia
- `context/changes/storage-layer-consistency-audit/research.md` — F1 dotyczy nazw **sklepów**, nie pozycji

## Open Questions

1. **Skąd wziąć tłumaczenia?** ~160 nazw. Ręcznie, ze wsparciem modelu, czy z istniejącego
   community glossary? To decyzja redakcyjna i jest jedynym realnym kosztem tej zmiany.
2. **Czy tłumaczyć przed migracją na SRD 5.2, czy po?** Po — 5.2 zmienia zbiór pozycji, więc
   tłumaczenie wcześniej oznacza pracę do wyrzucenia.
3. **Czy lookup ma pokrywać tylko przedmioty, czy też tiery rzadkości?** `Rarity` jest już polska
   (`"pospolite"`, `"niezwykłe"`, `"rzadkie"`) i nie jest renderowana w tabeli (FR-007 — trzy kolumny),
   więc prawdopodobnie nie. Warto potwierdzić.
4. **Gdzie fizycznie ma mieszkać mapa tłumaczeń?** Osobny plik obok `items.generated.ts`, ale
   **nie generowany** — żeby `npm run data:build` go nie nadpisywał. Nazewnictwo i ścieżka do ustalenia
   w planie.
