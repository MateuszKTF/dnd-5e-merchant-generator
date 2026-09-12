# Korekty zapisują się same — Implementation Plan

## Overview

Korekta ceny lub ilości u kupca otwartego z biblioteki ma trafiać do tego rekordu natychmiast —
bez klikania „Zapisz" i bez tworzenia duplikatu. Przy okazji znika wszystko, co w interfejsie
mówiło o zapisie, którego po tej zmianie już nie ma: przycisk przy otwartym rekordzie,
bursztynowy marker i ostrzeżenie o stracie, która nie nastąpi.

Zmiana wyszła z weryfikacji ręcznej S-04 i S-05 (2026-09-12), nie z roadmapy. Nie jest kawałkiem
produktu — jest korektą modelu, który okazał się odwrotny do intuicji.

## Current State Analysis

Wszystko z S-01 – S-05 jest dowiezione i na `origin/main`. Model zapisu wygląda dziś tak:

| Sytuacja | Zachowanie | Gdzie |
| --- | --- | --- |
| Korekta u świeżo wygenerowanego kupca | auto-zapis do slotu `transient` | `handleCorrect` → `persist` |
| Korekta u kupca otwartego z biblioteki | **tylko `transient`**; rekord w bibliotece nietknięty | tamże |
| Zapis rekordu z biblioteki | dopiero na kliknięcie „Zapisz zmiany" | `updateOpenedMerchant` |
| Po przeładowaniu | `openedSavedId` przepada → Zapisz **dodaje nowy wpis** | S-04 Migration Notes |

**To jest inwersja.** Produkt zapisuje sam kupca jednorazowego, a od tego świadomie zapisanego
w bibliotece wymaga kliknięcia — odwrotnie, niż podpowiada intuicja, i to jest właściwe
uzasadnienie tej zmiany, mocniejsze niż sama wygoda.

**Ograniczenia zastane:**

- **Forward-only storage** (`AGENTS.md:15`) — nic tu nie zmienia schematu. Odtworzenie „otwartego"
  stoi na danych, które już są zapisane.
- **Vitest globuje tylko `.ts`, bez jsdom** — reguły idą do modułów `.ts`, `.tsx` pokrywa
  weryfikacja ręczna. Ta sama granica, którą narysowały wszystkie wcześniejsze kawałki.
- **Termin 2026-09-13** (`prd.md` `hard_deadline`), czyli jutro. Stąd podział na fazę, która
  rozwiązuje zgłoszony problem, i fazę w całości wycinalną.

### Key Discoveries:

- **Wspólne `id` jest już zapisane i wystarcza do odtworzenia „otwartego".** `openMerchant`
  (`MerchantGenerator.tsx`) zapisuje `transient` z **`id` otwartego rekordu**, a `promoteTransient`
  (`merchant-storage.ts`) **zawsze bije nowe `id`** dla kopii. Wspólne `id` między `transient`
  a którymś z `saved` może więc znaczyć tylko jedno: ten transient pochodzi z tego zapisanego
  rekordu. Dziś to przypadek uboczny — ta zmiana czyni z niego sygnał nośny.
- **Promote zrywa link, który zaraz będzie potrzebny.** Po „Zapisz" nowy rekord ma świeże `id`,
  a `transient` zostaje ze starym — więc kolejna korekta **nie** trafiłaby do dopiero co
  zapisanego kupca. To ta sama skarga, tylko o jeden krok później. Promote musi ustanowić link.
- **`hasCorrections` odpowiada na złe pytanie.** Pyta „czy ten kupiec ma ręczne poprawki", a guard
  potrzebuje „czy zaraz zniknie praca, której nie da się odzyskać". Dla rekordu z biblioteki
  poprawna odpowiedź to „nie" — dialog i tak straszy.
- **`isCorrected` ma dwóch konsumentów.** Marker w `PriceQuantityCell` (do usunięcia) i
  `hasCorrections` (zostaje — guard nadal go potrzebuje dla kupca spoza biblioteki).
- **`StorageNotice` jest trwały, nie toast.** To on niesie ciężar ścieżki awaryjnej po decyzji,
  żeby nie dodawać akcji „Ponów".

## Desired End State

MG otwiera kupca z biblioteki, poprawia cenę miksturki i odkłada telefon. Nic nie klika. Wraca
za tydzień, otwiera tego samego kupca — cena jest poprawiona. Na ekranie nie ma przycisku
zapisu, bo nie ma czego zapisywać; nie ma podkreśleń, bo nie ma stanu „niezapisane"; a dialog
o odrzuceniu korekt pojawia się wyłącznie wtedy, gdy MG faktycznie zaraz coś straci.

Duplikat przestaje być osiągalny: przy otwartym rekordzie nie ma czego kliknąć, a po
przeładowaniu aplikacja sama rozpoznaje, że patrzy na zapisanego kupca.

**Weryfikacja:** `npm test` pokrywa regułę odtworzenia linku i nowy predykat guardu;
`npx astro check`, `npm run build` i `npm run lint` przechodzą; testy ręczne pokrywają
auto-zapis, przeładowanie, zablokowaną pamięć i 360 px.

## What We're NOT Doing

- **Żadnej zmiany schematu i żadnej nowej operacji magazynu.** `updateSavedMerchant` i
  `deleteMerchant` już są; odtworzenie linku stoi na zapisanych danych.
- **Żadnego cofania, kosza ani wersjonowania.** Świadomie przyjęty koszt auto-zapisu.
- **Żadnej akcji „Ponów zapis".** Decyzja usera: nieudany zapis niesie trwały baner, a ponowienie
  dzieje się przy następnej korekcie.
- **Żadnego dławienia zapisu w czasie.** Commit jest na `blur`, nie na klawisz — nie ma czego dławić.
- **Nie ruszamy generatora, `assortment.ts`, reguł w `corrections.ts`, wyszukiwania ani usuwania.**
- **Nie ruszamy `merchant-storage.ts`.** F-01 zostaje nietknięte.
- **Bez jsdom i bez poszerzania globa Vitest.**

## Implementation Approach

Dwie fazy, podzielone po tym, co przeżywa cięcie terminu — nie po plikach.

**Faza 1 rozwiązuje zgłoszony problem i jest samodzielnie wdrażalna.** Auto-zapis, odtworzenie
linku i znikający przycisk. Po niej duplikat jest nieosiągalny, a korekty trzymają się kupca.

**Faza 2 to porządki w interfejsie** — marker, guard, domknięcie edycji przy opuszczaniu strony.
W całości wycinalna: nic w niej nie jest potrzebne, żeby faza 1 działała poprawnie.

**Reguły idą do `merchant-session.ts`**, obok maszyny stanu zapisu, bo to ten sam problem: co
znaczy „otwarty rekord" i kiedy praca jest zagrożona. Renderowanie i efekty zostają w `.tsx`
i pokrywa je weryfikacja ręczna.

## Critical Implementation Details

**State sequencing — promote musi ustanowić link, inaczej skarga wraca po jednym kroku.** Po
udanym `promoteTransient` rekord w bibliotece ma nowe `id`, a `transient` stare. Bez ustawienia
`openedSavedId` na `id` kopii **i** przepisania transientu tym samym `id`, kolejna korekta
trafi znowu tylko do transientu — czyli dokładnie to, co ta zmiana usuwa, tylko po „Zapisz"
zamiast po otwarciu z listy.

**State sequencing — zapis transientu zostaje, mimo że auto-zapis go dubluje.** Transient jest
tym, co przywraca ekran po przeładowaniu, i tym, co niesie `id` do odtworzenia linku. Zastąpienie
go samym zapisem do biblioteki zepsułoby oba.

**Ryzyko przyjęte świadomie: nieudany auto-zapis nie ma przycisku ponowienia.** Decyzja usera
z 2026-09-12. Przy zablokowanej lub pełnej pamięci korekta zostaje w stanie komponentu i w
transiencie (o ile ten się zapisał), a rekord w bibliotece jej nie dostaje. Jedynym sygnałem jest
trwały baner `StorageNotice`, a ponowienie następuje przy kolejnej korekcie. Jeśli MG skończy
poprawiać, praca zostaje niezapisana w bibliotece — baner stoi, ale nic go nie wymusza.

## Phase 1: Auto-zapis w miejscu

### Overview

Korekta u otwartego rekordu trafia do niego natychmiast, link „otwartego" przeżywa przeładowanie
i powstaje przy zapisie, a przycisk znika, kiedy nie ma czego zapisywać. Po tej fazie zgłoszony
problem jest rozwiązany.

### Changes Required:

#### 1. Reguła odtworzenia linku

**File**: `src/lib/merchant-session.ts` (modify)

**Intent**: Rozpoznać, że wczytany transient pochodzi z konkretnego rekordu w bibliotece — bez
pola w schemacie, na danych, które już są zapisane.

**Contract**: `openedSavedIdFor(doc: StorageDocument): string | null` — zwraca `doc.transient.id`,
jeśli to `id` występuje wśród `doc.saved`; w przeciwnym razie `null`. Czysta, bez dostępu do
magazynu. Wnioskowanie jest poprawne dlatego, że `promoteTransient` zawsze bije nowe `id`, więc
kolizja `id` między slotami nie może powstać przypadkiem.

#### 2. Auto-zapis przy korekcie

**File**: `src/components/MerchantGenerator.tsx` (modify)

**Intent**: Korekta u otwartego rekordu ma lądować w bibliotece bez udziału MG.

**Contract**: `handleCorrect` po zapisie transientu, gdy `session.openedSavedId !== null`, wywołuje
`updateSavedMerchant(openedSavedId, { rows, corrections })` z tymi samymi wartościami, które
właśnie poszły do transientu, i odświeża `saved` w pamięci. Niepowodzenie idzie przez istniejące
`conditionFromFailure` → `StorageNotice`; **żadnej akcji ponowienia** (decyzja usera). Kolejność
zapisów — najpierw transient — jest nośna: jeśli drugi zapis padnie, ekran przeżyje przeładowanie.

#### 3. Link po zapisie nowego kupca

**File**: `src/components/MerchantGenerator.tsx` (modify)

**Intent**: Dopiero co zapisany kupiec ma zachowywać się jak otwarty, inaczej ta sama skarga wraca
o jeden krok później.

**Contract**: `addMerchant` po udanym `promoteTransient` ustawia `openedSavedId` na `id` kopii
(zdarzenie `"opened"`) **i** przepisuje transient tak, by niósł to samo `id` — bez tego reguła
z punktu 1 nie odtworzy linku po przeładowaniu.

#### 4. Przycisk znika przy otwartym rekordzie

**File**: `src/components/MerchantGenerator.tsx` (modify)

**Intent**: Nie pokazywać kontrolki, która nie ma czego zrobić — i odciąć drogę do duplikatu.

**Contract**: Przycisk renderuje się tylko gdy `rows !== null` **i** `session.openedSavedId === null`.
`saveButtonLabel` traci warianty dla zapisu w miejscu; zostaje „Zapisz" / „Zapisano" dla kupca
spoza biblioteki. `updateOpenedMerchant` przestaje mieć wywołanie z przycisku — jego logika
przenosi się do `handleCorrect`.

#### 5. Testy reguły

**File**: `src/lib/merchant-session.test.ts` (modify)

**Contract**: `openedSavedIdFor` zwraca `null` dla pustego transientu, `null` gdy `id` transientu
nie występuje w `saved`, i to `id` gdy występuje. Osobny przypadek: dokument po `promoteTransient`
(transient ze starym `id`, kopia z nowym) daje `null` — to jest dokładnie stan, który punkt 3
naprawia, więc test musi go widzieć jako niepowiązany.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Route still prerendered: `index.html` under `dist/client/`
- Linting passes: `npm run lint`

#### Manual Verification:

- Otwarcie kupca z biblioteki, poprawienie ceny, ponowne otwarcie — korekta jest, bez klikania
- Przy otwartym kupcu nie ma przycisku zapisu
- Przeładowanie przy otwartym kupcu: dalej ten sam kupiec i dalej brak przycisku
- Nowy kupiec: Stwórz → Zapisz → kolejna korekta trafia do tego samego wpisu, lista ma jedną pozycję
- Stwórz po otwarciu: przycisk wraca, Zapisz dodaje nowego kupca, poprzedni nietknięty
- Zablokowana pamięć: korekta u otwartego kupca pokazuje baner i nie gubi wartości z ekranu
- Duplikatu nie da się zrobić żadną ścieżką

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 2: Porządki w interfejsie

### Overview

Usunięcie tego, co mówiło o stanie „niezapisane", którego już nie ma, plus domknięcie edycji
niezatwierdzonej przed opuszczeniem strony. W całości wycinalna bez szkody dla fazy 1.

### Changes Required:

#### 1. Marker znika

**File**: `src/components/PriceQuantityCell.tsx` (modify), `src/components/MerchantTable.tsx` (modify)

**Intent**: Bursztyn w tym interfejsie jest kolorem `StorageNotice`, więc marker czytał się jako
„coś jest nie tak"; po auto-zapisie lektura „niezapisane" jest wprost fałszywa.

**Contract**: `PriceQuantityCell` traci prop `corrected` wraz ze stylowaniem markera i z dopiskiem
„(skorygowano)" w nazwie dostępnej; `MerchantTable` przestaje liczyć `isCorrected` na potrzeby
renderowania. `isCorrected` **zostaje w `corrections.ts`** — nadal stoi pod `hasCorrections`.

#### 2. Guard pyta o utratę pracy, nie o obecność korekt

**File**: `src/lib/merchant-session.ts` (modify), `src/components/MerchantGenerator.tsx` (modify)

**Intent**: Ostrzeżenie, które kłamie, przestaje działać jako ostrzeżenie — MG nauczy się je
odklikiwać i przegapi ten raz, kiedy naprawdę coś traci.

**Contract**: `wouldLoseCorrections(hasCorrections: boolean, openedSavedId: string | null): boolean`
— prawda tylko gdy są korekty **i** nic nie jest otwarte, bo wtedy praca nie jest nigdzie
utrwalona. `handleGenerate` i `handleOpen` pytają o to zamiast o samo `hasCorrections`. Dialog
usuwania działa bez zmian — usunięcie zawsze jest nieodwracalne.

#### 3. Domknięcie edycji przy opuszczaniu strony

**File**: `src/components/MerchantGenerator.tsx` (modify)

**Intent**: Edycja zatwierdza się tylko na `blur`/Enter, więc F5 z kursorem w polu ją gubi — a
komentarz w `persist` fałszywie deklaruje, że przypadek „telefon w tle" jest obsłużony.

**Contract**: Efekt nasłuchujący `pagehide` oraz `visibilitychange` przechodzącego w `hidden`,
który wywołuje `blur()` na aktywnym elemencie. Wpina się w **istniejącą** ścieżkę commitu
(`blur` → `commit` → `onCommit` → `handleCorrect`), więc nie powstaje druga ścieżka zatwierdzania,
która mogłaby rozjechać się z pierwszą. `localStorage.setItem` jest synchroniczny, więc zdąży.

#### 4. Testy predykatu

**File**: `src/lib/merchant-session.test.ts` (modify)

**Contract**: `wouldLoseCorrections` — prawda dla korekt bez otwartego rekordu; fałsz dla korekt
przy otwartym rekordzie; fałsz bez korekt w obu wariantach.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Poprawiona komórka wygląda jak każda inna — żadnego podkreślenia
- Otwarcie innego kupca przy otwartym rekordzie: bez dialogu, bo nic nie ginie
- Stwórz nad poprawionym kupcem spoza biblioteki: dialog jest, bo praca naprawdę zginie
- Usunięcie dalej zawsze pyta
- Edycja ceny i od razu F5, bez klikania poza pole: wartość przeżywa
- Edycja ceny, przełączenie karty i powrót: wartość przeżywa
- Wszystko powyżej wygodne na 360 px

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- `openedSavedIdFor`: pusty transient → `null`; `id` nieobecne w `saved` → `null`; obecne → to `id`;
  dokument tuż po `promoteTransient` → `null`
- `wouldLoseCorrections`: prawda tylko dla „są korekty i nic nie otwarte"; pozostałe trzy
  kombinacje fałsz

### Integration Tests:

Brak. Panel, dialog i efekty to `.tsx`, a harness nie ma jsdom — ta sama granica, którą narysowały
wszystkie wcześniejsze kawałki. Pokrywają je kroki ręczne poniżej.

### Manual Testing Steps:

1. Otwórz kupca z biblioteki, popraw cenę, otwórz innego, wróć do pierwszego — korekta jest
2. Popraw ilość, przeładuj — korekta jest, przycisku zapisu nadal nie ma
3. Stwórz nowego, popraw, Zapisz, popraw ponownie — lista ma jeden wpis, obie korekty w nim
4. Stwórz po otwarciu kupca — przycisk wraca; Zapisz dodaje nowego, poprzedni nietknięty
5. Zablokuj dane witryny, popraw cenę u otwartego kupca — baner jest, wartość z ekranu zostaje
6. Odblokuj, popraw ponownie — zapis dochodzi (ponowienie przy kolejnej korekcie)
7. Popraw cenę i od razu F5, bez klikania poza pole — wartość przeżywa
8. Popraw cenę, przełącz kartę, wróć — wartość przeżywa
9. Sprawdź, że poprawione komórki niczym się nie wyróżniają
10. Otwórz innego kupca przy otwartym rekordzie — brak dialogu
11. Stwórz nad poprawionym kupcem spoza biblioteki — dialog jest
12. Powtórz 1–11 na 360 px
13. `npm run build` i `npx wrangler dev` — to samo na workerd

## Performance Considerations

Korekta u otwartego rekordu to **dwa** przepisania dokumentu zamiast jednego: `putTransient`
i `updateSavedMerchant` czytają i zapisują ten sam klucz po kolei. Przy skali v1 (kilkadziesiąt
kupców, kilkaset KB) to nieistotne, a commit jest na `blur`, nie na klawisz — więc zapisów jest
tyle, ile zatwierdzonych edycji. Połączenie obu w jedną operację wymagałoby nowej operacji w F-01,
czego ta zmiana świadomie nie robi.

Nic tu nie dotyka kryterium „poniżej 5 s", które dotyczy generowania.

## Migration Notes

**Żadnej zmiany schematu.** Odtworzenie „otwartego" stoi na wspólnym `id` między transientem
a `saved` — dane, które już są w dokumencie. Reguła forward-only (`AGENTS.md:15`) zostaje
nietknięta, `SCHEMA_VERSION` bez zmian, migracja niepotrzebna.

**Dokumenty zapisane przed tą zmianą wczytują się bez niespodzianek.** Transient zapisany przez
starą wersję albo niesie `id` któregoś z `saved` (bo powstał przez otwarcie kupca) i wtedy link
odtworzy się sam, albo nie niesie i wtedy zachowanie jest takie jak dotąd.

**Ta zmiana wycofuje dwie świadome decyzje wcześniejszych kawałków** — marker z S-02 i model
jawnego zapisu z S-04. Oba są opisane w `change.md` z uzasadnieniem, żeby nie wróciły jako
„zgubiona funkcja".

## References

- Tożsamość zmiany i pełny zapis decyzji: `context/changes/corrections-autosave/change.md`
- Model, który ta zmiana koryguje: `context/changes/saved-merchants-library/plan.md`
  (`openedSavedId`, zapis w miejscu, Migration Notes z zaakceptowanym ograniczeniem)
- Marker i idiom edycji w miejscu: `context/changes/manual-item-corrections/plan.md`
- Maszyna stanu zapisu i `StorageNotice`: `context/changes/last-merchant-persists/plan.md`
- Kontrakt magazynu (`updateSavedMerchant`, `promoteTransient` bije nowe `id`):
  `context/changes/merchant-storage-contract/plan.md`
- Reguła forward-only: `AGENTS.md:15`; termin: `context/foundation/prd.md` `hard_deadline`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Auto-zapis w miejscu

#### Automated

- [x] 1.1 Unit tests pass: `npm test`
- [x] 1.2 Type checking passes: `npx astro check`
- [x] 1.3 Production build succeeds: `npm run build`
- [x] 1.4 Route still prerendered: `index.html` under `dist/client/`
- [x] 1.5 Linting passes: `npm run lint`

#### Manual

- [ ] 1.6 Korekta u otwartego kupca trzyma się go bez klikania
- [ ] 1.7 Przy otwartym kupcu nie ma przycisku zapisu
- [ ] 1.8 Przeładowanie przy otwartym kupcu zachowuje kupca i brak przycisku
- [ ] 1.9 Stwórz, Zapisz, kolejna korekta trafia do tego samego wpisu
- [ ] 1.10 Stwórz po otwarciu: przycisk wraca, Zapisz dodaje nowego, poprzedni nietknięty
- [ ] 1.11 Zablokowana pamięć: baner jest, wartość z ekranu zostaje
- [ ] 1.12 Duplikatu nie da się zrobić żadną ścieżką

### Phase 2: Porządki w interfejsie

#### Automated

- [ ] 2.1 Unit tests pass: `npm test`
- [ ] 2.2 Type checking passes: `npx astro check`
- [ ] 2.3 Production build succeeds: `npm run build`
- [ ] 2.4 Linting passes: `npm run lint`

#### Manual

- [ ] 2.5 Poprawiona komórka niczym się nie wyróżnia
- [ ] 2.6 Otwarcie innego kupca przy otwartym rekordzie: bez dialogu
- [ ] 2.7 Stwórz nad poprawionym kupcem spoza biblioteki: dialog jest
- [ ] 2.8 Usunięcie dalej zawsze pyta
- [ ] 2.9 Edycja i F5 bez klikania poza pole: wartość przeżywa
- [ ] 2.10 Edycja i przełączenie karty: wartość przeżywa
- [ ] 2.11 Wszystko wygodne na 360 px
