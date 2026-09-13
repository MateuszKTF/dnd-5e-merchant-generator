# Triage audytu warstwy zapisu (F1–F4) — Plan Brief

> Pełny plan: `context/changes/storage-layer-consistency-audit/plan.md`
> Research: `context/changes/storage-layer-consistency-audit/research.md`

## What & Why

Audyt warstwy zapisu znalazł jedenaście ustaleń. Cztery domykamy teraz, bo każde z nich to ten sam
kształt błędu: **mechanizm, który miał egzekwować przyjętą regułę, w konkretnej ścieżce nie odpala** —
a nic tego nie łapie, bo ścieżka leży poza zasięgiem bramek. Jedno z nich jest realnym defektem
w zasięgu guardraila PRD („zapisany kupiec nigdy nie znika po cichu"), jedno to test, który deklaruje
w komentarzu więcej, niż strukturalnie może sprawdzić.

## Starting Point

Warstwa jest w dobrym stanie — 21 z 23 zasadzonych mutantów zabitych, powielone strażniki są świadome
i udokumentowane. Ale `normalizeName` przepuszcza znaki formatujące, których `normalizeForSearch`
usuwa, więc nazwa kupca może zostać zapisana i renderować się jako pusty, nieodnajdywalny wiersz.
`loadForWrite` zwija cztery przyczyny odmowy zapisu w jeden status, więc konsument nie wie, o czym
mówić MG. Naciśnięcie Zapisz na magazynie odmawiającym zapisu daje **zero zmian w DOM**.
A test pilnujący niezmiennika międzymodułowego nigdy nie wywołuje funkcji, o której mówi.

## Desired End State

Nazwa złożona z niewidzialnych znaków nie może zostać zapisana, a niewidzialny znak w środku dobrej
nazwy zostaje z niej usunięty — przy czym sekwencja emoji spięta joinerem przeżywa nietknięta.
Zapis odrzucony dlatego, że dokument należy do nowszej wersji, wyłącza trwałość i mówi o tym właściwym
komunikatem, niezależnie od tego, czy odkrył to odczyt, czy zapis. Naciśnięcie Zapisz zawsze daje MG
postrzegalny wynik — także dla czytnika ekranu. Niezmiennik „promote bije świeże `id`" jest przypięty
testem, który ten kod faktycznie wykonuje.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Źródło |
| --- | --- | --- | --- |
| Zakres triage | F1–F4 | Werdykt researchu: wszystko, co dotyka guardraila albo udaje pokrycie | Research |
| Odzyskanie przyczyny (F2) | Ponowny odczyt po stronie konsumenta | Precedens istnieje (`deleteSavedMerchant:1306`); nie amenduje `merchant-storage.ts`, więc konwencja czterech slice'ów zostaje | Plan |
| Kształt naprawy F1 | Strip `\p{Cf}` bez `U+200D` | Idiom już jest w pliku; joiner musi przeżyć, bo trzyma sekwencje emoji | Plan |
| Reakcja na nieudany zapis (F3) | Ogłoszenie `sr-only` **i** własne copy | To dwa osobne defekty — milczenie i myląca treść | Plan |
| Testy dla F2/F3 | Kroki ręczne, bez `jsdom` | Konwencja projektu, świadomie wybrana i udokumentowana; triage nie ma się rozrastać w zmianę infrastruktury | Plan |
| Miejsce testu F4 | `merchant-storage.test.ts` | `merchant-session.test.ts` nie ma `resetReadOnlyLatch`; dodanie funkcji zatrzaskującej wprowadziłoby zależność od kolejności | Plan |
| Dług F5–F11 | Lekcja L-05 + research jako źródło | `lessons.md` jest czytany przez `/10x-plan` i `/10x-impl-review` jako priors, więc reguła wraca sama | Plan |

## Scope

**In scope:**
- F1 — klasa znaków formatujących w `normalizeName` plus testy
- F2 — rozpoznanie prawdziwej przyczyny odmowy zapisu i wyłączenie trwałości dla właściwych statusów
- F3 — nowy `StorageCondition` z własnym copy oraz wypowiedziany komunikat nieudanego zapisu
- F4 — test wywołujący `promoteTransient` i karmiący wynik do `openedSavedIdFor`
- Lekcja L-05 o powtórce L-04

**Out of scope:**
- F5–F11 (docblock `toStoredCorrections`, `savedAt` jako dwa typy, trzy polityki porównania, awaryjna
  etykieta kategorii psująca wyszukiwanie, nieaktualny komentarz konsolidacji, nieprzypięta obietnica
  `writeDocument`, luka testowa `.tsx`)
- Amendowanie `merchant-storage.ts`
- `jsdom` i testy `.tsx`
- `autoName`, który omija `normalizeName` w całości
- Wyłączanie trwałości przy zwykłym `read-only` — odrzucone wcześniej i słusznie

## Architecture / Approach

Faza 1 leży w całości w `src/lib` i jest weryfikowalna automatycznie, więc idzie bez pauzy i zostawia
rozszerzony zestaw testów, o który może się oprzeć Faza 2. Faza 2 dotyka wyłącznie `.tsx`, którego
runner nie widzi — stąd jej kryteria są w większości ręczne i wymienione krok po kroku.

Kluczowa własność, na której stoi Faza 2: `readDocument` bada `isFutureVersion` na **sparsowanym
ładunku**, nie na zatrzasku (`merchant-storage.ts:461-463`), więc ponowny odczyt po nieudanym zapisie
naprawdę odzyskuje prawdziwą przyczynę. Bez tego całe podejście by nie działało.

## Phases at a Glance

| Faza | Co dowozi | Główne ryzyko |
| --- | --- | --- |
| 1. Normalizacja nazw i niezmiennik mintowania | Zamknięta luka w `normalizeName`, prawdziwy test niezmiennika | Zbyt szeroka klasa znaków rozbiłaby sekwencje emoji — istniejący test to łapie |
| 2. Mapowanie statusów zapisu i komunikaty | Właściwy komunikat i wyłączenie trwałości dla właściwych statusów | Kod bez testów w pliku bez pokrycia; nowy warunek musi trafić do trzech list, a dwie z nich to tablice, których nic nie wymusza |
| 3. Zapis długu | Lekcja L-05 | Wpis, który opisuje ten audyt zamiast reguły na przyszłość |

**Prerequisites:** brak — `research.md` jest kompletny, wszystkie decyzje podjęte.
**Estimated effort:** ~1 sesja na Fazę 1, ~1 sesja plus przeklikanie na Fazę 2, kilkanaście minut na Fazę 3.

## Open Risks & Assumptions

- **Faza 2 nie ma pokrycia testowego i mieć nie będzie.** Dokładamy kod do pliku, który ma 1694 linie
  bez testów — czyli świadomie pogłębiamy F11. Kroki ręczne są jedyną bramką.
- **Nowy `StorageCondition` musi wejść do `STANDING` i `ORDER`, a to tablice.** Kompilator wymusi
  tylko copy w `MESSAGES`. Pominięcie `STANDING` sprawi, że komunikat zniknie przy pierwszym udanym
  zapisie, mimo że zatrzask trwa całe ładowanie strony.
- **Nazwy już zapisane nie są czyszczone.** Reguła forward-only zabrania przepisywania cudzych bajtów,
  więc istniejąca nazwa z niewidzialnym znakiem zostanie oczyszczona dopiero przy ręcznej zmianie
  nazwy. Wyszukiwanie znajdzie ją w międzyczasie.
- **Scenariusz `future-version` jest nadal nieweryfikowalny produkcyjnie** — nie ma urządzenia
  z dokumentem v2. Weryfikacja ręczna opiera się na podmianie w devtools.

## Success Criteria (Summary)

- MG wkleja nazwę z notatek z Worda i dostaje czytelny, odnajdywalny wiersz — albo zachowuje
  poprzednią nazwę, gdy wkleił samą niewidzialność
- Każde naciśnięcie Zapisz ma postrzegalny skutek: sukces, albo komunikat mówiący co się stało
  i co z tym zrobić — także dla czytnika ekranu
- Zestaw testów wywala się, gdy `promoteTransient` przestanie bić świeże `id`
