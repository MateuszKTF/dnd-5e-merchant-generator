---
date: 2026-09-14T00:45:12+02:00
researcher: Mateusz Kotowicz
git_commit: c7ab09ab71e54f7918c1e9e521257f50c952264e
branch: review/impl-review-triage
repository: dnd-5e-merchant-generator
permalink_base: https://github.com/MateuszKTF/dnd-5e-merchant-generator/blob/c7ab09ab71e54f7918c1e9e521257f50c952264e
topic: "Odpowiedzialności MerchantGenerator.tsx i które z nich są czystą logiką domenową"
tags: [research, codebase, merchant-generator, testability, src-lib, L-03, L-04]
status: complete
last_updated: 2026-09-14
last_updated_by: Mateusz Kotowicz
---

# Research: Czyste reguły uwięzione w `MerchantGenerator.tsx`

**Date**: 2026-09-14T00:45:12+02:00
**Researcher**: Mateusz Kotowicz
**Git Commit**: `c7ab09a`
**Branch**: `review/impl-review-triage`
**Repository**: dnd-5e-merchant-generator

## Research Question

> `MerchantGenerator.tsx` ma 1694 linie — wypisz jego odpowiedzialności i wskaż, które są czystą
> logiką domenową i powinny mieszkać w `src/lib`.

## Summary

**Przesłanka pytania była błędna i trzeba ją sprostować.** `wc -l` to zła miara tego pliku:

```
linie razem:    1694
komentarz:       850   (50%)
puste:           150
faktyczny kod:   694
```

694 linie kodu na komponent, który orkiestruje dwa selecty, przycisk, tabelę, panel biblioteki,
dialog potwierdzenia, banner pamięci, dwa live-regiony, nasłuch `storage` między kartami,
przywracanie na mount, commit edycji przy `pagehide` i **pięć** ścieżek zapisu — to nie jest
rozdęcie. Etykieta „god-component", którą sam wcześniej nadałem na podstawie `wc -l`, była myląca.

**Prawdziwe znalezisko jest węższe i poważniejsze.** Moduły `src/lib` powtarzają w docblockach
jedną regułę architektoniczną: *„every decision that can be **wrong as a rule** lives here where
a test can reach it"* (`merchant-session.ts:7-11`, `merchant-library.ts:5-8`, `corrections.ts:11-13`).
Tymczasem w komponencie siedzi **dziewięć funkcji napisanych jako czyste, na poziomie modułu,
z jawnymi argumentami** — czyli przygotowanych do przeniesienia, a jednak nieprzeniesionych.

Żadna z nich nie ma testu i **mieć nie może**: `vitest.config.ts:23` globuje `include:
["src/**/*.test.ts"]`, a `environment: "node"` bez jsdom. Ani jeden plik `.tsx` nie jest
ładowany przez runner.

**To nie jest odkrycie — plan S-03 już to zapisał i wycenił**, a potem odłożył.

## Detailed Findings

### Dziewięć czystych reguł w `.tsx`

| Funkcja | Linie | Czym jest | Dokąd należy |
| --- | --- | --- | --- |
| `wouldLoseWork` | 129-151 | „czy praca przepadnie" — nadbudowa nad `wouldLoseCorrections` o wymiar `autosaveFailed` | `merchant-session.ts` |
| `engagesReadOnlyLatch` | 190-192 | które `StorageCondition` odpowiadają zatrzaskowi F-01 | `merchant-storage.ts` |
| `conditionFromFailure` | 213-230 | mapowanie `WriteFailure` → `StorageCondition \| null` | `merchant-storage.ts` |
| `reopenEvent` | 161-166 | czy dokument to „restored" czy „opened" | `merchant-session.ts` |
| `confirmCopyFor` | 96-124 | copy dialogu, totalne po `PendingAction` | `src/lib` (nowy moduł copy) |
| `saveButtonLabel` | 155-157 | etykieta z `SaveState` | `merchant-session.ts` |
| derywacja `session` | 396-404, 423-429 | „rekord, który wypadł z `saved`, nie jest już otwarty" | `merchant-session.ts` |
| konstrukcja `Merchant` w `persist` | 861-872 | projekcja `MerchantHeader` + rows + corrections → `Merchant` | `merchant.ts` |
| decyzja adopcji w handlerze `storage` | 600-660 | czy przyjąć przychodzący dokument | `merchant-session.ts` |

Dwie z nich kodują **niezmienniki międzymodułowe**, i to jest najostrzejszy przypadek:

`engagesReadOnlyLatch` twierdzi wprost, że *„the status and the latch are the same fact stated
twice"* — o zatrzasku, który jest **prywatną zmienną modułową** w `merchant-storage.ts:157`.
Ta sama trójka statusów jest wypisana ręcznie **drugi raz** w tym samym pliku, na `:518`.
`merchant-storage.ts` ustawia `readOnly` w siedmiu miejscach i nie eksportuje żadnego predykatu.
Czwarty status zatrzaskujący wymagałby edycji w czterech miejscach — i **nic by się nie wysypało
przy kompilacji**.

Derywacja `session` (`:423-429`) jest jedynym miejscem, gdzie niezmiennik „obie połowy ruszają się
razem" (`merchant-session.ts:320`) jest wykonywany **poza** reduktorem biblioteki: komponent woła
`nextSaveState` bezpośrednio i ustawia `openedSavedId: null` ręcznie.

### To zostało już rozpoznane i wycenione — w planie S-03

`last-merchant-persists/plan.md:346-350`:

> *„`persist`, `handleSave`, `addMerchant`, `autosaveOpened`, `handleRename`, `deleteSavedMerchant`,
> `conditionFromFailure` and the `storedSession`/`saved`/`storageStatus`/`autosaveFailed` quartet
> are ~300 lines with no JSX, and **five of this review's ten findings lived in them**. …
> **Recorded as follow-up work, not done here.**"*

Proponowana nazwa docelowa — `src/lib/merchant-writes.ts` — nigdy nie powstała. Decyzja o odłożeniu
zapadła w `last-merchant-persists/reviews/impl-review-phase-2.md:243`.

Liczba „pięć z dziesięciu ustaleń review mieszkało w tych ~300 liniach" jest najmocniejszym
argumentem w tym dokumencie i nie jest moja — jest z review sprzed dwóch dni.

### Czego przenosić NIE należy

Reszta pliku to orkiestracja i sekwencjonowanie DOM, które musi zostać:

- **Efekty i ich fazy.** Kolejka ogłoszeń przez `useRef` + `announcementTick` (`:271-291`, `:525-545`)
  istnieje, bo React zastosowałby zmianę stanu w fazie *mutacji*, przed layout-efektem
  `ConfirmDialog`, czyli gdy live-region jest jeszcze inertny wewnątrz otwartego modala.
  To wiedza o cyklu commitów Reacta, nie reguła domenowa.
- **Kolejność focus → tekst** (`:531-541`) — NVDA i JAWS kasują mowę przy zmianie focusa.
- **Nasłuch `storage`**, `pagehide`/`visibilitychange`, subskrypcje okna.
- **Cały JSX** i podpięcie zdarzeń.

### Granica z `GeneratorIsland.tsx`

`GeneratorIsland.tsx` (75 linii) to **wyłącznie error boundary** — nie dotyka API magazynu ani sesji.
Podział wyspa/React jest więc czysty i nie wymaga rewizji. `MerchantGenerator.tsx` jest jedynym
konsumentem `merchant-storage` i `merchant-session` w całym drzewie.

### Skala luki testowej

| Plik | Linie | Pokrycie |
| --- | --- | --- |
| `MerchantGenerator.tsx` | 1694 | zero |
| `MerchantLibrary.tsx` | 462 | zero |
| `StorageNotice.tsx` | 185 | zero |
| `ConfirmDialog.tsx` | 156 | zero |
| `MerchantTable.tsx` | 148 | zero |
| `PriceQuantityCell.tsx` | 146 | zero |
| `GeneratorIsland.tsx` | 75 | zero |
| `ui/button.tsx` | 50 | zero |
| `Layout.astro`, `index.astro` | 91 | zero |
| `src/lib/utils.ts` | 6 | zero (brak `utils.test.ts`) |

Każdy inny moduł `src/lib` ma parę `.test.ts`. `package.json` nie ma jsdom, happy-dom ani
`@testing-library`; **nie ma też klucza `coverage`** nigdzie — więc nie istnieje raport, który
by tę lukę uwidocznił.

To jest **L-04 w drugim przebraniu**: tam bramka a11y wyglądała na włączoną i obejmowała tylko
`.astro`; tutaj bramka testowa wygląda na zieloną i nie obejmuje `.tsx` wcale. Dwa komentarze
w kodzie mówią to na głos — `MerchantLibrary.tsx:160-168` (*„nothing in CI can catch this (L-04)"*)
i `StorageNotice.tsx:166-167`.

### Reguły, które istnieją WYŁĄCZNIE w nietestowanym pliku

Nie są duplikatami — nie mają odpowiednika w `src/lib`:

- **Strażnik no-op przy zmianie nazwy** — `MerchantLibrary.tsx:272`. `renameMerchant`
  (`merchant-storage.ts:655-668`) takiego nie ma.
- **Wymiar `autosaveFailed`** w `wouldLoseWork` (`:141-155`, zwł. `:149`) — zawęża przetestowany
  kontrakt `wouldLoseCorrections` o wymiar, którego w bibliotece nie ma.
- **Polityka standing-vs-episodic** — `StorageNotice.tsx:101-132`, prawdziwa logika decyzyjna w `.tsx`.
- **Trzecia kopia routingu wyniku odczytu** — `MerchantGenerator.tsx:1293-1332`, obok `:583-645` i `:670-718`.
- **Powtórzony dirty-check korekty** — `MerchantTable.tsx:101`, `:127`, bez importu `isCorrected`
  (`corrections.ts:111-123`).
- **Polska odmiana liczebnika** — `MerchantTable.tsx:142-148`, bez właściciela w bibliotece.

### Duplikaty i luki znalezione przy okazji

- **`MerchantHeader` budowany dwa razy** — `adopt` (`:477-483`) i `openMerchant` (`:1395-1401`),
  identyczny literał pięciu pól. Uzasadnione w komentarzu (wartość settera nie jest czytelna
  w tym samym renderze), ale to kopia, która może się rozjechać.
- **`isKnownCategory` / `isKnownWealth` nie są używane przez komponent** — `merchant-session.ts:27-34`
  eksportuje predykaty narzędziowe dokładnie do tego, a `handleCategoryChange` / `handleWealthChange`
  (`:1509-1517`) rzutują przez `as`. Bezpieczne dziś, bo oba `<select>` są zasilane z `CATEGORIES`
  i `WEALTH_LEVELS`, ale to odwrotność problemu: strażnik biblioteki, z którego komponent nie korzysta.
- **Relink po promote jest best-effort i nieobserwowalny.** `addMerchant` (`:975-1038`): jeśli
  ponowny `persist` na `:1017` zawiedzie, `:1028` i tak bezwarunkowo wysyła
  `{ event: "opened", savedId: promoted.id }`. Rozjazd ujawnia się dopiero po przeładowaniu i nie
  widzi go nic. Komentarz `:1019-1027` mówi o tym wprost i uzasadnia wybór — gorszą alternatywą
  byłby duplikat w bibliotece.

## Code References

Baza: `https://github.com/MateuszKTF/dnd-5e-merchant-generator/blob/c7ab09ab71e54f7918c1e9e521257f50c952264e`

- `src/components/MerchantGenerator.tsx:129-151` — `wouldLoseWork`, czysta, nietestowalna
- `src/components/MerchantGenerator.tsx:190-192` + `:518` — trójka zatrzasku, wypisana dwa razy
- `src/components/MerchantGenerator.tsx:213-230` — `conditionFromFailure`
- `src/components/MerchantGenerator.tsx:423-429` — niezmiennik „obie połowy" wykonany poza reduktorem
- `src/components/MerchantGenerator.tsx:975-1038` — `addMerchant`, relink best-effort
- `src/components/MerchantGenerator.tsx:525-545` — kolejka ogłoszeń, wiedza o fazach commitu (zostaje)
- `src/lib/merchant-session.ts:7-11` — reguła „reguły mieszkają tam, gdzie sięga test"
- `vitest.config.ts:23` — `include: ["src/**/*.test.ts"]`
- `context/changes/last-merchant-persists/plan.md:346-350` — ekstrakcja zapisana i odłożona

## Architecture Insights

**Reguła jest dobra, egzekwowanie jest ręczne.** Wypchnięcie czystych reguł do `src/lib` udało się
dla czterech modułów i zawiodło dla dziewięciu funkcji — nie dlatego, że ktoś o niej zapomniał,
tylko dlatego, że **nic jej nie sprawdza**. Reguła żyje w docblockach, a nie w bramce.

**Dryf jest kumulatywny i niewidoczny dla review per-zmianę.** Żaden pojedynczy slice nie dołożył
do tego pliku dużo. `/10x-impl-review` patrzy na jedną zmianę i widzi kilkadziesiąt rozsądnych
linii. Suma pięciu takich rozsądnych przyrostów to dziewięć nietestowalnych reguł.

**Komentarze są tu aktywem, nie balastem.** 850 linii dokumentacji, często dłuższej od opisywanej
funkcji, wielokrotnie zapisuje *dlaczego pierwsza wersja była zła* — kolejność faz commitu,
`lastTransient` ustawiany przed zapisem, `openedSavedId` przychodzący render za późno. Ekstrakcja
musi te uzasadnienia **zabrać ze sobą**, a nie zostawić przy JSX.

## Historical Context (from prior changes)

- `last-merchant-persists/plan.md:346-350` — ekstrakcja ~300 linii do `src/lib/merchant-writes.ts`
  zapisana jako follow-up, **nie wykonana**; z adnotacją, że *„five of this review's ten findings
  lived in them"*
- `last-merchant-persists/reviews/impl-review-phase-2.md:243` — decyzja o odłożeniu
- `last-merchant-persists/reviews/impl-review-phase-2.md:68` — *„the island is covered by exactly
  zero automated tests and always will be under this config"*
- `last-merchant-persists/plan.md:332-336` — `putTransient` ma cztery miejsca wywołania zamiast
  planowanych dwóch; niezmiennik („zapisy są imperatywne, nigdy w efekcie obserwującym stan")
  uznany za nienaruszony
- `merchant-storage-contract/plan.md:107-109` — F-01 celowo nie dostarcza żadnego komponentu;
  to jest powód, dla którego całe mapowanie statusów wylądowało w `.tsx`

## Related Research

- `context/changes/storage-layer-consistency-audit/research.md` — F11 opisuje tę samą lukę testową
  od strony warstwy zapisu; F2 i F3 to konkretne defekty, które w niej mieszkają
- `context/changes/cloud-sync-readiness/research.md` — synchroniczność, na której opiera się
  sekwencjonowanie efektów w tym pliku

## Open Questions

1. **Czy ekstrakcja ma sens bez bramki testowej?** Przeniesienie dziewięciu funkcji do `src/lib`
   czyni je testowalnymi, ale nikt nie napisze testów automatycznie. Wartość realizuje się dopiero
   przy napisanych testach — plan powinien liczyć jedno i drugie razem.
2. **Czy warto zamiast tego dołożyć jsdom i testować `.tsx`?** To inna odpowiedź na ten sam problem
   i być może tańsza — zamyka też F11 z audytu warstwy zapisu i lukę a11y z L-04 jednym ruchem.
   Nie oceniano kosztu.
3. **Gdzie ma mieszkać `confirmCopyFor`?** To copy interfejsu, nie reguła domenowa. Projekt nie ma
   dziś modułu na teksty; utworzenie go dla jednej funkcji może być gorsze niż zostawienie jej.
4. **Czy `engagesReadOnlyLatch` powinien być eksportem `merchant-storage.ts`?** To najczystszy
   kandydat — moduł, który ustawia zatrzask, powinien też odpowiadać, co go ustawia. Wymaga
   rozstrzygnięcia, czy `StorageCondition` (typ z `.tsx`) może wejść do `src/lib`, czy raczej
   predykat powinien operować na `ReadResult["status"]`.
