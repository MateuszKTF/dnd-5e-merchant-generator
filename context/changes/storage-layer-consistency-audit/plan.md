# Triage audytu warstwy zapisu (F1–F4) — Implementation Plan

## Overview

Cztery ustalenia z `research.md` domykane przed zamknięciem M-1: jeden realny defekt normalizacji
nazw w zasięgu guardraila PRD, dwie pozostałości w mapowaniu statusów magazynu na to, co widzi MG,
i jeden test, który deklaruje w komentarzu więcej, niż strukturalnie może sprawdzić.

Wspólny mianownik całej czwórki: **mechanizm, który miał egzekwować przyjętą regułę, w konkretnej
ścieżce nie odpala** — i nic tego nie łapie, bo ścieżka leży poza zasięgiem bramek.

## Current State Analysis

**F1 — trzy klasy znaków w jednym pliku, które się nie pokrywają.** `merchant-library.ts` trzyma
`INVISIBLE_NAME_CHARS` (`:43`, trzy znaki) dla ścieżki zapisu, `BLANK_NAME` (`:68`) jako strażnika
pustki i `FORMAT_CHARS` (`:67`, cała kategoria `\p{Cf}`) dla wyszukiwania. `normalizeName`
(`:143-164`) usuwa trzy znaki; `U+00AD`, `U+2060`, `U+200E`, `U+200F`, `U+2066`–`U+2069` przechodzą.
Taka nazwa jest zapisywana, renderuje się jako **pusty wiersz** (`MerchantLibrary.tsx:374`, `:442`)
i jest nieodnajdywalna, bo `normalizeForSearch` redukuje ją do `""`.

Asymetria jest udokumentowana po jednej stronie i nieznana po drugiej: `merchant-library.test.ts:317`
asertuje `normalizeForSearch("Ku­znia") === "kuznia"` z komentarzem *„browsers all emit it on
copy, which is the paste-from-notes route the rule exists for"*. Ten sam plik testowy nie ma
odpowiednika po stronie `normalizeName`.

**F2 — `loadForWrite` gubi przyczynę.** `merchant-storage.ts:568-576` zwija `future-version`,
`needs-migration`, `unreadable` i `read-only` w jeden status zapisu `read-only`. Dokument z nowszej
wersji odkryty **wewnątrz** `putTransient` trafia więc do `raiseWriteFailure("read-only")` i podnosi
`"unavailable"` (`MerchantGenerator.tsx:361-364`) — czyli jedyny status, o którym
`merchant-session.ts:131-134` mówi, że **musi** wyłączyć trwałość, zostawia przycisk `armed`,
a MG czyta o wyłączonych danych witryny. `handleFailedRead` (`:514-522`) jest jedynym nadawcą
`persistence-off` i siedzi wyłącznie na ścieżce odczytu.

**F3 — naciśnięcie bez skutku.** Po odczycie `read-only` komponent świadomie zostawia przycisk
uzbrojony (`MerchantGenerator.tsx:584-593`), obiecując: *„the failure names something they can act on"*.
Prześledzone: `raiseWriteFailure` (`:363`) znajduje `"unavailable"` podniesione wcześniej na `:593`,
zwraca `current` bez zmian, `handleSave` wraca do `armed`. **Netto zero zmian w DOM.** Region
`sr-only` (`:1631-1633`) odzywa się tylko przy `state === "saved"`.

**F4 — test, który nie dotyka badanego kodu.** `merchant-session.test.ts:624-634` twierdzi:
*„If this ever starts returning the id, promote stopped minting and the whole inference underneath
this function is unsound."* Test buduje ręcznie `merchant({ id: "m-old" })` i `merchant({ id: "m-new" })`.
Mutacja `merchant-storage.ts:642` `newMerchantId()` → `transient.id` zabiła dwa testy, oba
w `merchant-storage.test.ts`; plik sesji został w całości zielony.

## Desired End State

- Nazwa złożona wyłącznie ze znaków formatujących nie może zostać zapisana — `normalizeName` zwraca
  `null`, a wywołujący przywraca poprzednią nazwę. Nazwa z niewidzialnym znakiem w środku zostaje
  zapisana bez niego. Sekwencja emoji spięta `U+200D` przeżywa bez zmian.
- Zapis odrzucony dlatego, że dokument należy do nowszej wersji, **wyłącza trwałość** i mówi o tym
  właściwym komunikatem — niezależnie od tego, czy odkrył to odczyt, czy zapis.
- Naciśnięcie Zapisz na magazynie odmawiającym zapisu daje MG **postrzegalny wynik**: komunikat,
  który wspomina o przeładowaniu, i wypowiedzenie w regionie `sr-only`.
- Niezmiennik „promote bije świeże `id`" jest przypięty testem, który **wywołuje `promoteTransient`**
  i karmi jego wynik do `openedSavedIdFor`.

Weryfikacja: `npm test`, `npm run typecheck`, `npm run lint` oraz ręczne kroki Fazy 2.

### Key Discoveries:

- `merchant-library.test.ts:81-88` — istniejący test „keeps a zero-width joiner that is holding an
  emoji together". Każda zmiana `normalizeName` musi go zostawić zielonym; to jest twardy powód,
  dla którego `U+200D` nie może wejść do klasy strippowanej.
- `merchant-library.test.ts:72-79` — pętla po `["​", "​​​", "‌",
  "‍‍", "﻿", " ​ ‍ "]`. Wszystkie nadal muszą zwracać `null`.
- `merchant-session.test.ts` nie importuje dziś żadnej funkcji zatrzaskującej, więc jego modułowy
  `readOnly` nigdy się nie ustawia — agent testowy potwierdził, że suite nie jest zależny od kolejności.
- `merchant-storage.ts:461-463` — `isFutureVersion` bada **sparsowany ładunek**, nie zatrzask.
- `MerchantGenerator.tsx:1306` — `deleteSavedMerchant` już doczytuje dokument, żeby rozróżnić dwa
  znaczenia `not-found`. Precedens dla podejścia z Fazy 2.
- `StorageNotice.tsx:101-107` (`STANDING`) i `:119-131` (`ORDER`) — dwie listy, które muszą objąć
  każdy nowy warunek.
- `merchant-search-and-delete/reviews/impl-review-phase-1.md:88` — Fix B odrzucony, bo *„Amends F-01's
  storage module, which every slice so far has deliberately consumed without amending."*

## What We're NOT Doing

- **F5–F11 z audytu.** Docblock `toStoredCorrections`, `savedAt` jako dwa typy, trzy polityki
  porównania, awaryjna etykieta kategorii psująca wyszukiwanie, nieaktualny komentarz o konsolidacji,
  nieprzypięta obietnica `writeDocument`, luka testowa `.tsx`. Zostają udokumentowane w `research.md`;
  Faza 3 zapisuje regułę, która je wszystkie łączy.
- **Nie amendujemy `merchant-storage.ts`.** Konwencja czterech slice'ów zostaje nietknięta.
  Przyczyna odzyskiwana jest ponownym odczytem po stronie konsumenta.
- **Nie dodajemy `jsdom` ani `@testing-library`.** F2 i F3 idą pod kryteria weryfikacji ręcznej,
  zgodnie z konwencją, którą projekt wybrał i udokumentował.
- **Nie ruszamy `autoName`.** Auto-nazwy omijają `normalizeName` w całości, więc są nieprzycinane
  i niestrippowane — dziś nieszkodliwe, bo etykiety `CATEGORIES` są czyste i krótkie. Asymetria
  jest realna, ale to inne ustalenie i inny zakres.
- **Nie wyłączamy trwałości przy zwykłym `read-only`.** Decyzja zapadła w
  `saved-merchants-library/reviews/impl-review-phase-2.md:60-110` — `stood-down` jest absorbujący
  i zabiłby przycisk na całe ładowanie strony, ukrywając lekarstwo razem z kontrolką.

## Implementation Approach

Faza 1 jest w całości w `src/lib` i weryfikowalna automatycznie, więc idzie bez pauzy. Faza 2 dotyka
wyłącznie `.tsx`, którego runner nie widzi — dlatego jej kryteria są w większości ręczne, a plan
wymienia konkretne kroki do przeklikania. Faza 3 to dokument.

Kolejność nie jest dowolna: Faza 1 zostawia zestaw testów zielony i rozszerzony, więc każda regresja
wprowadzona w Fazie 2 ma się o co oprzeć.

## Critical Implementation Details

**Klasa znaków dla `normalizeName` musi wykluczyć `U+200D`, i to jest jedyny sposób.** `FORMAT_CHARS`
(`\p{Cf}`) obejmuje joiner, a `merchant-library.ts:41-42` tłumaczy, dlaczego on musi przeżyć w nazwie:
*„it joins, so it is load-bearing inside an emoji sequence"*. Użycie `FORMAT_CHARS` wprost w ścieżce
zapisu rozbiłoby rodzinę emoji na osobne osoby w nazwie, którą MG wybrał — i wywaliłoby istniejący
test `:81-88`. Potrzebna jest trzecia stała, nie ponowne użycie którejś z dwóch istniejących.

**Ponowny odczyt w ścieżce zapisu naprawdę odzyskuje przyczynę.** Nie jest to oczywiste, bo zatrzask
już jest ustawiony — ale `readDocument` sprawdza `isFutureVersion(parsed)` na sparsowanym ładunku
(`merchant-storage.ts:461-463`), zanim cokolwiek zrobi z zatrzaskiem, więc kolejny odczyt zwróci ten
sam prawdziwy status. Bez tej własności całe podejście Fazy 2 nie działa.

**Nowy `StorageCondition` musi wejść do trzech list, nie do jednej.** `MESSAGES` (`StorageNotice.tsx:53`)
jest `Record<StorageCondition, string>`, więc kompilator wymusi copy. `STANDING` (`:101-107`) i `ORDER`
(`:119-131`) to tablice — **nic nie wymusi dopisania tam**. Pominięcie `STANDING` sprawi, że
`clearEpisodic` skasuje komunikat przy pierwszym udanym zapisie, mimo że zatrzask trwa całe ładowanie
strony. Pominięcie `ORDER` wywali warunek z renderowania albo zepsuje kolejność.

**Test F4 nie może wylądować w `merchant-session.test.ts`.** Ten plik nie importuje dziś żadnej
funkcji zatrzaskującej, więc nie ma `beforeEach` z `resetReadOnlyLatch`. Dodanie `promoteTransient`
wprowadziłoby dokładnie tę zależność od kolejności, przed którą ostrzega `merchant-storage.ts:163-165`
(*„the first test that latches would refuse every write in every test after it, and the suite would
quietly become order-dependent"*). Test idzie do `merchant-storage.test.ts`, gdzie fake i reset już są.

## Phase 1: Normalizacja nazw i niezmiennik mintowania

### Overview

F1 i F4 — obie w pełni weryfikowalne automatycznie, obie w `src/lib` i jego testach. Bez pauzy
na weryfikację ręczną.

### Changes Required:

#### 1. Klasa znaków formatujących dla ścieżki zapisu

**File**: `src/lib/merchant-library.ts`

**Intent**: Zamknąć lukę, przez którą nazwa złożona ze znaków formatujących innych niż trzy wyliczone
przechodzi strażnika pustki i zostaje zapisana jako pusty, nieodnajdywalny wiersz. Zastąpić zgadywanie,
które znaki MG wklei, tą samą kategorią Unicode, którą ścieżka wyszukiwania już stosuje — minus
joiner, który jest nośny w sekwencjach emoji.

**Contract**: Nowa stała na poziomie modułu, obok `INVISIBLE_NAME_CHARS` i `FORMAT_CHARS`, pokrywająca
`\p{Cf}` z wyłączeniem `U+200D`. `normalizeName` używa jej w miejscu dzisiejszego
`INVISIBLE_NAME_CHARS`. Sygnatura `normalizeName(raw: string): string | null` bez zmian.
`INVISIBLE_NAME_CHARS` znika, jeśli nie ma innego konsumenta.

Docblock nowej stałej musi powiedzieć trzy rzeczy, bo dokładnie ich brak wyprodukował ten defekt:
skąd biorą się te znaki (wklejanie z Worda i PDF-ów), dlaczego kategoria zamiast listy, i dlaczego
`U+200D` jest wyłączony. Wzorcem jest docblock `FORMAT_CHARS` (`:48-65`).

#### 2. Testy normalizacji

**File**: `src/lib/merchant-library.test.ts`

**Intent**: Przypiąć zamkniętą lukę i upewnić się, że joiner nadal przeżywa.

**Contract**: Rozszerzyć pętlę w `"returns null for a name made only of zero-width characters"`
(`:72-79`) o `U+00AD`, `U+2060`, `U+200E`, `U+200F`, `U+2066`. Dodać test, że niewidzialny znak
**w środku** nazwy zostaje usunięty, a nazwa zachowana — symetryczny do istniejącego
`normalizeForSearch("Ku­znia")` na `:317`, tak żeby obie strony miały asercję na ten sam znak.
Test `"keeps a zero-width joiner that is holding an emoji together"` (`:81-88`) zostaje bez zmian
i musi przechodzić.

#### 3. Prawdziwy test niezmiennika mintowania

**File**: `src/lib/merchant-storage.test.ts`

**Intent**: Przypiąć zależność `openedSavedIdFor` od tego, że `promoteTransient` bije świeże `id` —
tak, żeby mutacja tego drugiego wywaliła test, który się na nim opiera.

**Contract**: Nowy test w tym pliku (ma już fake i `resetReadOnlyLatch` w `beforeEach`), importujący
`openedSavedIdFor` z `@/lib/merchant-session`. Zasiać dokument z transientem, wywołać
`promoteTransient`, odczytać dokument przez `readDocument` i sprawdzić, że `openedSavedIdFor` zwraca
`null`. Kryterium poprawności: zamiana `newMerchantId()` na `transient.id` w `promoteTransient`
**musi** wywalić ten test.

#### 4. Usunięcie fałszywej deklaracji

**File**: `src/lib/merchant-session.test.ts`

**Intent**: Test na `:624-634` nie może obserwować tego, co obiecuje jego komentarz. Zostaje jako
test jednostkowy `openedSavedIdFor` na literałach, ale przestaje twierdzić, że pilnuje zachowania
innego modułu.

**Contract**: Przepisać komentarz `:626-629` tak, żeby opisywał to, co test faktycznie sprawdza
(dwa różne `id` nie linkują się), i wskazywał plik, w którym mieszka prawdziwa asercja
międzymodułowa. Nazwa testu bez zmian — `## Progress` innych zmian może się do niej odwoływać.

### Success Criteria:

#### Automated Verification:

- Testy przechodzą: `npm test`
- Typy przechodzą: `npm run typecheck`
- Lint przechodzi: `npm run lint`
- Mutacja kontrolna: zamiana `newMerchantId()` na `transient.id` w `merchant-storage.ts:642` wywala
  nowy test z `merchant-storage.test.ts` (przywrócić po sprawdzeniu)
- Mutacja kontrolna: cofnięcie klasy znaków do trzech znaków wywala rozszerzoną pętlę
  w `merchant-library.test.ts`

#### Manual Verification:

- Brak — faza jest w całości w `src/lib` i pokryta testami.

---

## Phase 2: Mapowanie statusów zapisu i komunikaty

### Overview

F2 i F3. Obie dotykają tej samej ścieżki — `raiseWriteFailure` i `engagesReadOnlyLatch` — więc idą
razem. Cały kod tej fazy leży w `.tsx`, którego runner nie widzi; weryfikacja jest ręczna.

### Changes Required:

#### 1. Warunek dla magazynu odmawiającego zapisu

**File**: `src/components/StorageNotice.tsx`

**Intent**: Rozdzielić „dane witryny są wyłączone" od „ten magazyn czyta, ale odmawia zapisu, a F-01
zatrzasnął się na całe ładowanie strony". Dziś oba mówią jednym komunikatem, który nie wspomina
o przeładowaniu — a dla trybu prywatnego Safari przeładowanie jest częścią lekarstwa.

**Contract**: Nowy wariant `StorageCondition`. Komunikat w `MESSAGES` musi nazwać skutek i lekarstwo,
wzorem `unreadable` (`:78-79`), które jako jedyne dziś mówi o odświeżeniu. Warunek dopisany do
**`STANDING`** (`:101-107`) — zatrzask trwa całe ładowanie strony, więc udany zapis go nie kończy —
oraz do **`ORDER`** (`:119-131`), obok pozostałych standing, przed `unavailable`.

#### 2. Rozpoznanie przyczyny po stronie konsumenta

**File**: `src/components/MerchantGenerator.tsx`

**Intent**: `loadForWrite` zwija cztery przyczyny w jeden status, więc komponent nie wie, czy odmowa
zapisu to zwykły magazyn tylko-do-odczytu, czy dokument nowszej wersji. Odzyskać tę wiedzę ponownym
odczytem, tak jak `deleteSavedMerchant` robi to już dla `not-found`.

**Contract**: `raiseWriteFailure` na statusie `read-only` doczytuje dokument przez `readDocument`
i rozgałęzia się po prawdziwym statusie: `future-version`, `needs-migration` i `unreadable` podnoszą
swój własny warunek **i wysyłają `persistence-off`**; `read-only` podnosi nowy warunek z punktu 1;
pozostałe zachowują dzisiejsze zachowanie. `engagesReadOnlyLatch` (`:190-192`) obejmuje nowy warunek.
Odczyt `read-only` na mount (`:584-593`) i w nasłuchu `storage` (`:685-693`) podnosi nowy warunek
zamiast `"unavailable"`.

Uwaga na kolejność: sprawdzenie warunków już stojących musi zostać **po** rozpoznaniu przyczyny,
inaczej deduplikacja znów wygasi komunikat, zanim ustali się, o czym on jest.

#### 3. Postrzegalny wynik nieudanego zapisu

**File**: `src/components/MerchantGenerator.tsx`

**Intent**: Gdy warunek już stoi, `raise` deduplikuje i naciśnięcie Zapisz nie zmienia w DOM nic —
ani wizualnie, ani dla czytnika ekranu. Kontrolka, której zadaniem jest „spróbuj jeszcze raz", musi
odpowiadać, gdy odpowiedź brzmi „nie".

**Contract**: Ścieżka `handleSave` → `addMerchant` zwracająca porażkę wypowiada komunikat przez
istniejący mechanizm `announceDelete` (`:1352-1355`), tym samym idiomem, którym mówi już nieudane
ponowienie autozapisu (`:1147`). Treść ma odsyłać do komunikatu o pamięci, a nie powtarzać go.

### Success Criteria:

#### Automated Verification:

- Typy przechodzą: `npm run typecheck` — `MESSAGES` jest `Record<StorageCondition, string>`, więc
  brak copy dla nowego wariantu jest błędem kompilacji
- Lint przechodzi: `npm run lint`
- Testy `src/lib` nadal przechodzą: `npm test`

#### Manual Verification:

- Tryb prywatny Safari (albo zablokowane dane witryny po wczytaniu strony): biblioteka jest widoczna,
  komunikat mówi o przeładowaniu, a naciśnięcie Zapisz daje wypowiedziany komunikat zamiast ciszy
- Czytnik ekranu na tej samej ścieżce: naciśnięcie Zapisz jest słyszalne
- Dokument podmieniony ręcznie w devtools na `schemaVersion: 2` **po** wczytaniu strony: pierwszy
  zapis wyłącza trwałość, przycisk przechodzi w stan wyłączony, komunikat mówi o nowszej wersji,
  a nie o danych witryny
- Ten sam scenariusz odkryty przez odczyt (podmiana przed wczytaniem): zachowanie bez zmian wobec dziś
- Pełny magazyn: przycisk **pozostaje** aktywny, komunikat mówi o zwolnieniu miejsca, usunięcie
  kupca i ponowny zapis kończą się sukcesem, a komunikat znika
- Dwie karty: usunięcie otwartego rekordu w drugiej karcie nadal podnosi `record-gone` i nie miesza
  się z nowym warunkiem

**Implementation Note**: Po zakończeniu tej fazy i przejściu weryfikacji automatycznej zatrzymaj się
i poczekaj na potwierdzenie, że kroki ręczne wypadły pomyślnie, zanim przejdziesz do Fazy 3.

---

## Phase 3: Zapis długu

### Overview

F5–F11 zostają poza zakresem, ale łączy je jedna reguła, która wróciła drugi raz. Zapisujemy regułę,
nie listę.

### Changes Required:

#### 1. Lekcja o bramce, która wygląda na włączoną

**File**: `context/foundation/lessons.md`

**Intent**: L-04 opisał bramkę a11y, która wyglądała na włączoną dla całego projektu i obejmowała
wyłącznie `.astro`. Ta sama klasa błędu wróciła jako bramka testowa: `vitest.config.ts:23` globuje
`src/**/*.test.ts`, więc 2 979 linii `.tsx` i `.astro` — całe mapowanie statusów, nasłuch cross-tab
i relink po zapisie — stoi za zielonym zestawem testów, który ich nie dotyka. Brak klucza `coverage`
gdziekolwiek sprawia, że nic tego nie pokazuje.

**Contract**: Nowy wpis `L-05` w formacie pozostałych — nagłówek z datą i źródłem, `**Obserwacja.**`,
`**Reguła.**`, `**Applies to:**`. Reguła ma brzmieć o sprawdzaniu **zasięgu** bramki przed powołaniem
się na nią, uogólniona z lintu na runner testów. Link `[[L-04]]` jako jawne wskazanie nawrotu
i wskaźnik do `context/changes/storage-layer-consistency-audit/research.md` jako źródła listy F5–F11.

### Success Criteria:

#### Automated Verification:

- Format pliku przechodzi: `npm run format` nie zmienia `context/foundation/lessons.md`

#### Manual Verification:

- Wpis czyta się jako reguła do zastosowania następnym razem, a nie jako raport z tego audytu
- Wskaźnik do `research.md` prowadzi do istniejącego pliku i do sekcji z F5–F11

---

## Testing Strategy

### Unit Tests:

- `normalizeName` odrzuca nazwę złożoną wyłącznie ze znaków `\p{Cf}` innych niż joiner
- `normalizeName` usuwa niewidzialny znak ze środka nazwy i zachowuje resztę
- `normalizeName` zachowuje sekwencję emoji spiętą `U+200D` — test istniejący, musi zostać zielony
- `openedSavedIdFor` zwraca `null` dla dokumentu pochodzącego z faktycznego `promoteTransient`

### Integration Tests:

Brak nowych. Test z punktu 3 Fazy 1 **jest** testem integracyjnym dwóch modułów — pierwszym w tym
repo, który przekracza granicę `merchant-storage` / `merchant-session` w kodzie zamiast w komentarzu.

### Manual Testing Steps:

1. Otworzyć aplikację w trybie prywatnym Safari, wygenerować kupca, nacisnąć Zapisz — sprawdzić,
   że komunikat wspomina o przeładowaniu i że naciśnięcie daje słyszalny wynik
2. Wczytać stronę normalnie, w devtools podmienić `schemaVersion` na `2`, wywołać zapis korektą ceny —
   sprawdzić, że trwałość zostaje wyłączona i że komunikat mówi o nowszej wersji
3. Zapełnić magazyn, wywołać zapis, sprawdzić że przycisk pozostaje aktywny, zwolnić miejsce,
   zapisać ponownie i sprawdzić, że komunikat znika
4. Wkleić w pole nazwy tekst skopiowany z dokumentu Worda zawierający miękki dywiz — sprawdzić,
   że nazwa zapisuje się bez niego i jest odnajdywalna wyszukiwaniem
5. Wkleić w pole nazwy sam miękki dywiz — sprawdzić, że wiersz zachowuje poprzednią nazwę

## Performance Considerations

Ponowny odczyt w `raiseWriteFailure` dokłada jedno `getItem` plus `JSON.parse` na ścieżce **awaryjnej**,
po nieudanym zapisie. `merchant-storage-contract/plan.md:571-576` odnotowuje, że `localStorage` jest
synchroniczny i blokuje wątek główny — ale ten odczyt zdarza się tylko wtedy, gdy zapis i tak nie
wyszedł, więc nie leży na żadnej gorącej ścieżce.

Zmiana klasy znaków w `normalizeName` zamienia wyliczenie trzech znaków na klasę Unicode — koszt
nieistotny przy nazwie ograniczonej do 60 grafemów, wywoływanej raz na zatwierdzenie zmiany nazwy.

## Migration Notes

**Brak migracji schematu.** `SCHEMA_VERSION` zostaje na `1`, `StorageDocument` bez zmian.

Jedna konsekwencja dla danych już zapisanych: nazwa zawierająca dziś niewidzialne znaki **nie jest
przepisywana** przy odczycie — reguła forward-only zabrania przepisywania cudzych bajtów. Zostanie
oczyszczona dopiero, gdy MG sam zmieni tej nazwie nazwę. Wyszukiwanie znajdzie ją w międzyczasie,
bo obie strony porównania przechodzą przez `normalizeForSearch` — co potwierdza istniejący test
`"finds a stored name carrying a zero-width space"` (`merchant-library.test.ts:329-334`).

Nowy `StorageCondition` nie jest persystowany — `conditions` to stan wyspy, żyje jedno ładowanie strony.

## References

- Research: `context/changes/storage-layer-consistency-audit/research.md` (F1–F4 w zakresie, F5–F11 poza)
- Powiązany research: `context/changes/generator-island-decomposition/research.md` — przyczyna
  strukturalna tego, że Faza 2 nie ma testów
- Precedens ponownego odczytu: `src/components/MerchantGenerator.tsx:1293-1332`
- Precedens wypowiadania nieudanej akcji: `src/components/MerchantGenerator.tsx:1147`, `:1352-1355`
- Konwencja nieamendowania F-01: `context/changes/merchant-search-and-delete/reviews/impl-review-phase-1.md:88`
- Odrzucony stand-down przy `read-only`: `context/changes/saved-merchants-library/reviews/impl-review-phase-2.md:60-110`
- Reguła forward-only: `AGENTS.md:16`

## Progress

> Konwencja: `- [ ]` w toku, `- [x]` zrobione. Dopisz ` — <commit sha>`, gdy krok wyląduje.
> Nie zmieniaj tytułów kroków. Zob. `references/progress-format.md`.

### Phase 1: Normalizacja nazw i niezmiennik mintowania

#### Automated

- [x] 1.1 Testy przechodzą: `npm test`
- [x] 1.2 Typy przechodzą: `npm run typecheck`
- [x] 1.3 Lint przechodzi: `npm run lint`
- [x] 1.4 Mutacja kontrolna: `newMerchantId()` → `transient.id` wywala nowy test w `merchant-storage.test.ts`
- [x] 1.5 Mutacja kontrolna: cofnięcie klasy znaków do trzech znaków wywala rozszerzoną pętlę

### Phase 2: Mapowanie statusów zapisu i komunikaty

#### Automated

- [ ] 2.1 Typy przechodzą: `npm run typecheck`
- [ ] 2.2 Lint przechodzi: `npm run lint`
- [ ] 2.3 Testy `src/lib` nadal przechodzą: `npm test`

#### Manual

- [ ] 2.4 Tryb prywatny Safari: biblioteka widoczna, komunikat o przeładowaniu, Zapisz daje wypowiedziany wynik
- [ ] 2.5 Czytnik ekranu: naciśnięcie Zapisz jest słyszalne
- [ ] 2.6 `schemaVersion: 2` podmieniony po wczytaniu: trwałość wyłączona, komunikat o nowszej wersji
- [ ] 2.7 Ten sam scenariusz odkryty przez odczyt: zachowanie bez zmian wobec dziś
- [ ] 2.8 Pełny magazyn: przycisk aktywny, zwolnienie miejsca kończy się udanym zapisem, komunikat znika
- [ ] 2.9 Dwie karty: `record-gone` nadal działa i nie miesza się z nowym warunkiem

### Phase 3: Zapis długu

#### Automated

- [ ] 3.1 `npm run format` nie zmienia `context/foundation/lessons.md`

#### Manual

- [ ] 3.2 Wpis czyta się jako reguła na przyszłość, nie jako raport z audytu
- [ ] 3.3 Wskaźnik do `research.md` prowadzi do istniejącego pliku i sekcji z F5–F11
