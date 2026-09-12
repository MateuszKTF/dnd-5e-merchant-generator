---
project: "D&D 5e Merchant Generator"
version: 1
status: draft
created: 2026-09-11
updated: 2026-09-12
prd_version: 1
main_goal: speed
top_blocker: time
milestone_id: usable-merchant-loop
milestone_seq: 1
milestone_status: open
---

# Roadmap: D&D 5e Merchant Generator

> Wyprowadzone z `context/foundation/prd.md` (v1) + automatycznie zbadanej bazy kodu,
> z `context/foundation/tech-stack.md` i `context/deployment/deploy-plan.md` jako wejściami
> pomocniczymi.
> Edycja w miejscu; archiwizacja, gdy dokument zostanie zastąpiony.
> Kawałki poniżej są wypisane w kolejności zależności. Tabela "At a glance" jest indeksem.

## Milestone

**M-1: Działająca pętla kupca — od kliknięcia do powrotu na kolejnej sesji** — Status: open

- **Intent:** MG ma przejść całą pętlę z PRD bez wychodzenia z narzędzia: wybrać kategorię
  i zamożność, dostać czytelny asortyment, poprawić w nim to, co chce poprawić, i odnaleźć
  tego samego kupca na kolejnej sesji. Zakres jest wyznaczony wynikiem, nie datą.
- **Source materials:** `context/foundation/prd.md` (v1)
- **Done when:** każdy `F-NN` i `S-NN` poniżej ma status `done`.
- **Scope anchors:** FR-001 – FR-013 (wszystkie trzynaście, wszystkie `must-have`),
  US-01, US-02, US-03, oraz jedyny NFR z PRD (czytelność na wąskim ekranie telefonu).

## Vision recap

MG traci czas przy stole, gdy gracze niespodziewanie skręcają do sklepu, którego nie
przewidział: musi na poczekaniu wyprodukować sensowną listę przedmiotów z cenami
i ilościami. Generatory sklepów do 5e istnieją, ale wszystkie są jednorazowe — odświeżenie
strony kasuje kupca, więc ta sama praca wraca na kolejnej sesji.

Ta jedna rzecz, której status quo nie daje, to trwałość kupca między sesjami. Dlatego
w tym produkcie zapis nie jest funkcją dodatkową, tylko rdzeniem — i dlatego PRD stawia
twardy warunek ochronny: zapisany kupiec nigdy nie znika po cichu.

## North star

**S-01: MG wybiera kategorię asortymentu i poziom zamożności osady, klika „Stwórz" i widzi
tabelę 10–25 pozycji z nazwą, ilością i ceną** — to najmniejszy pełny przepływ, który
dowodzi, że produkt działa, i przy wybranym celu `speed` nie ma powodu, żeby cokolwiek
stało przed nim.

> Co znaczy „north star" w tym dokumencie: najmniejszy kawałek działający od początku do
> końca, którego dowiezienie dowodzi głównej hipotezy produktu — ustawiony tak wcześnie,
> jak pozwalają zależności, bo wszystko inne ma znaczenie tylko wtedy, gdy on wyjdzie.
> Tutaj: przepływ z PRD `## Success Criteria`, którego krok 4 sam jest opisany jako
> „← wartość widoczna", i na którym wisi główne kryterium sukcesu („8 na 10 MG uznaje
> asortyment za gotowy bez ręcznych modyfikacji", wynik w mniej niż 5 sekund).

## At a glance

| ID   | Change ID                   | Outcome (MG może …)                                                                             | Prerequisites          | PRD refs                                                                        | Status   |
| ---- | --------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------- | -------- |
| F-01 | `merchant-storage-contract` | (foundation) kontrakt kupca i zapisu w przeglądarce, z jawnym zachowaniem przy awarii magazynu | —                      | Guardrails (§ Success Criteria), Access Control, FR-009                         | in-progress |
| S-01 | `first-generated-assortment` | wybrać kategorię i zamożność, kliknąć „Stwórz" i zobaczyć tabelę 10–25 pozycji                 | —                      | US-01, FR-001, FR-002, FR-003, FR-004, FR-005, FR-007, NFR (czytelność na telefonie) | in-progress |
| S-02 | `manual-item-corrections`   | skorygować cenę lub ilość pozycji i przegenerować listę bez cichej utraty tych korekt          | S-01                   | FR-006, FR-008                                                                  | in-progress |
| S-03 | `last-merchant-persists`    | zamknąć kartę w środku sesji, wrócić i zastać ostatniego kupca; oznaczyć go jako trwałego       | F-01, S-01, S-02       | US-03, FR-009                                                                   | in-progress |
| S-04 | `saved-merchants-library`   | odnaleźć zapisanego kupca na liście, otworzyć go i zmienić mu nazwę                            | F-01, S-03             | US-02, FR-010, FR-011                                                           | in-progress |
| S-05 | `merchant-search-and-delete` | wyszukać kupca po nazwie i usunąć niepotrzebnego, gdy lista urośnie przez miesiące kampanii    | S-04                   | US-02, FR-012, FR-013                                                           | planning |

## Streams

Pomoc w nawigacji — grupuje kawałki dzielące ten sam łańcuch zależności. Kanoniczna
kolejność nadal żyje w grafie zależności poniżej; ta tabela jest proponowaną kolejnością
czytania równoległych torów.

| Stream | Theme                    | Chain                                          | Note                                                                                                                        |
| ------ | ------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| A      | Generowanie i tabela     | `S-01` → `S-02`                                | Tor wartości widocznej. Nie ma żadnej zależności wstępnej, więc przy celu `speed` startuje natychmiast.                     |
| B      | Trwałość między sesjami  | `F-01` → `S-03` → `S-04` → `S-05`              | `F-01` też nie ma zależności, więc oba tory mogą ruszyć równolegle. Strumień A dołącza tutaj w `S-03`.                       |

## Baseline

Co już stoi w bazie kodu na `2026-09-11` (automatycznie zbadane + potwierdzone przez
użytkownika). Foundations poniżej zakładają, że to jest na miejscu, i tego nie stawiają
od nowa.

- **Frontend:** partial — Astro 6 + React 19 + Tailwind v4 + shadcn podłączone
  (`astro.config.mjs:9-18`), ale jedyna trasa `src/pages/index.astro` renderuje wciąż
  placeholder startera (`src/components/Welcome.astro:29-32`), z martwymi linkami do
  `/auth/signin`. Zero interfejsu produktu.
- **Backend / API:** partial — `output: "server"` i adapter Cloudflare skonfigurowane
  (`astro.config.mjs:10,18`); zero tras API, brak middleware, brak logiki domenowej po
  stronie serwera (`src/env.d.ts:1-3`).
- **Data:** partial — **katalog obecny**: 160 pozycji SRD, dokładnie 40 na każdą z czterech
  kategorii, `rarity` i `priceGp` wypełnione we wszystkich 160 wierszach
  (`src/data/items.generated.ts`; kontrakt `src/data/items.ts:15-23`; pochodzenie
  `src/data/ATTRIBUTION.md`; generator `scripts/build-item-catalog.mjs`). Typy domenowe
  częściowo: `CategoryId`, `Rarity`, `Wealth`, `CatalogItem`, `CATEGORIES`, `WEALTH_LEVELS`,
  `RARITY_TIERS` istnieją — **typu kupca nie ma**. Trwałość po stronie przeglądarki
  **nieobecna** (zero odwołań do `localStorage` / `IndexedDB` w `src/`).
- **Auth:** absent jako kod aplikacji — brak middleware, brak sesji, brak stron logowania,
  jedna trasa. Zostały wyłącznie resztki w konfiguracji i zależnościach (paczki Supabase
  w `package.json:26-27,57`, blok `[auth]` w `supabase/config.toml:150-255`, opcjonalne
  zmienne środowiskowe w `astro.config.mjs:21-22`). Access Control w PRD nie przewiduje
  uwierzytelniania, więc to nie jest luka do zasypania.
- **Deploy / infra:** present — produkcja żyje od 2026-09-10 pod
  `https://dnd-5e-merchant-generator.mateusz-kotowicz.workers.dev`; `wrangler.jsonc`
  plus CI (`.github/workflows/ci.yml` — lint i build, bez kroku deploy, promocja jest
  ręczna); pętla `build → deploy → tail → rollback` przećwiczona i opisana
  (`context/deployment/deploy-plan.md`).
- **Observability:** absent — brak biblioteki logującej, śledzenia błędów, metryk i OTel.
  Narzędzi testowych również brak: zero plików testowych, brak runnera; CI robi tylko
  lint i build. Żaden NFR w PRD tego nie wymaga, więc roadmapa tego nie dokłada.

> **Rozstrzygnięte od czasu PRD:** Otwarte pytanie #2 z PRD („Skąd pochodzi baza przedmiotów
> i czy wolno ją rozdawać?") — jedyne w PRD oznaczone jako blokujące i opisane jako leżące
> na krytycznej ścieżce — **jest zamknięte**. Katalog jest zbudowany i wersjonowany: SRD 5.1
> na licencji CC-BY-4.0, atrybucja w `src/data/ATTRIBUTION.md`. Skutek dla roadmapy: żaden
> kawałek nie startuje ze statusem `blocked`. Zastrzeżenie stąd: treści z podręczników poza
> SRD (i kompendia fanowskie, które je powielają) nie mogą wejść do tego publicznego repo.

## Foundations

### F-01: Kontrakt kupca i trwałości w przeglądarce

- **Outcome:** (foundation) istnieje kształt encji kupca oraz wersjonowany kontrakt zapisu
  i odczytu w magazynie przeglądarki, z jawnie określonym zachowaniem, gdy magazyn jest
  niedostępny albo pełny. Nic z tego nie jest widoczne dla MG.
- **Change ID:** `merchant-storage-contract`
- **PRD refs:** Guardrails (§ Success Criteria), Access Control, FR-009
- **Unlocks:** `S-03`, `S-04`, `S-05` — wszystkie trzy czytają i zapisują tego samego kupca.
  Redukuje ryzyko nazwane w PRD jako najcięższa regresja („zapisany kupiec nigdy nie znika
  po cichu") i otwiera ścieżkę weryfikacji, której te kawałki potrzebują: zamknij kartę,
  otwórz ponownie, kupiec wraca w tym samym stanie.
- **Prerequisites:** —
- **Parallel with:** `S-01`, `S-02`
- **Blockers:** —
- **Unknowns:**
  - Co MG ma zobaczyć, gdy magazyn przeglądarki jest pełny albo wyłączony? Guardrail zakazuje
    cichej utraty, więc to zachowanie musi być jawne, a PRD go nie rozstrzyga. Owner: user.
    Block: no.
- **Risk:** trzy kawałki czytają ten sam zapis, a `AGENTS.md` odnotowuje, że magazyn
  przeglądarki jest jednokierunkowy — po pierwszym prawdziwym kupcu pomyłka w kształcie
  danych przestaje być tania do odkręcenia. Dlatego kontrakt stoi przed `S-03`, a nie
  powstaje w środku niego. Zakres jest celowo wąski: kształt, klucz, odczyt, zapis,
  zachowanie przy awarii — bez interfejsu i bez listy zapisanych.
- **Status:** in-progress

## Slices

### S-01: Pierwszy wygenerowany asortyment

- **Outcome:** MG może wybrać kategorię asortymentu i poziom zamożności osady, kliknąć
  „Stwórz" i zobaczyć tabelę 10–25 unikalnych pozycji z nazwą, ilością i ceną — gotową do
  przeczytania na głos, czytelną na telefonie.
- **Change ID:** `first-generated-assortment`
- **PRD refs:** US-01, FR-001, FR-002, FR-003, FR-004, FR-005, FR-007, NFR (czytelność na telefonie)
- **Prerequisites:** —
- **Parallel with:** `F-01`
- **Blockers:** —
- **Unknowns:**
  - Czy rozkład rzadkości wystarczy, żeby 8 na 10 MG nie poprawiało listy? PRD Otwarte
    pytanie #3 wprost mówi, że reguła pilnuje proporcji, ale nie sensu ekonomicznego sklepu
    jako całości; odrzuconą alternatywą był budżet sklepu. Owner: user. Block: no.
  - Katalog ma 40 pozycji na kategorię, a jedna lista bierze 10–25 z nich. Czy pula tej
    wielkości wystarczy, żeby kolejne losowania dla tej samej kategorii nie wyglądały
    niemal identycznie? To wyszło z obrazu bazy kodu, nie z PRD. Owner: user. Block: no.
- **Risk:** tu wisi całe główne kryterium sukcesu, a reguła losowania jest jedyną
  niesprawdzoną częścią produktu — katalog już jest, interfejs jest przewidywalny, ryzyko
  siedzi w tym, czy wynik faktycznie nadaje się do użycia bez poprawek. Kawałek stoi
  pierwszy, bo nie ma żadnej zależności i bo dowozi krok, który PRD sam oznacza jako
  wartość widoczną. Generowanie liczone po stronie przeglądarki trzyma kryterium „< 5 s"
  z dala od limitu 10 ms CPU w Workers (patrz Open Roadmap Questions #4).
- **Status:** in-progress

### S-02: Ręczne korekty, których nie da się zgubić

- **Outcome:** MG może skorygować cenę lub ilość pojedynczej pozycji, a próba
  przegenerowania listy pyta o potwierdzenie, zamiast po cichu skasować te korekty.
- **Change ID:** `manual-item-corrections`
- **PRD refs:** FR-006, FR-008
- **Prerequisites:** `S-01`
- **Parallel with:** `F-01`
- **Blockers:** —
- **Unknowns:**
  - Czy korekta jest wpisywana wprost w komórce tabeli, czy w osobnym kroku? PRD wskazuje
    FR-008 jako najdroższy pojedynczy element v1, a jedyny NFR wymaga czytelności na wąskim
    ekranie — edycja w komórce na telefonie jest tu głównym ryzykiem wykonania.
    Owner: user. Block: no.
- **Risk:** PRD sam nazywa FR-008 najdroższą pozycją v1, więc to ten kawałek najmocniej
  zderza się z dwudniowym budżetem. Potwierdzenie przed przegenerowaniem jest tu razem
  z edycją celowo: chroni jedyną pracę MG, której narzędzie nie umie odtworzyć, i nie ma
  sensu bez niej. Jeśli zakres trzeba będzie ciąć, to jest pierwszy kandydat do rozmowy
  — patrz Open Roadmap Questions #1.
- **Status:** in-progress

### S-03: Ostatni kupiec wraca sam

- **Outcome:** MG może zamknąć kartę przeglądarki w środku sesji i po ponownym otwarciu
  zastać ostatnio wygenerowanego kupca w stanie, w jakim go zostawił — razem z ręcznymi
  korektami — a jawnym zapisem oznaczyć go jako trwałego.
- **Change ID:** `last-merchant-persists`
- **PRD refs:** US-03, FR-009
- **Prerequisites:** `F-01`, `S-01`, `S-02`
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Czy „jawny zapis" tworzy nowy wpis, czy oznacza istniejący automatyczny? FR-009
    dopuszcza obie lektury, a od tego zależy, czy lista z `S-04` może dostać duplikaty.
    Owner: user. Block: no.
- **Risk:** to ten kawałek domyka warunek ochronny z PRD, czyli najcięższą nazwaną regresję
  w całym dokumencie. Zależy od `S-02`, bo kryterium akceptacji US-03 wymaga, żeby przetrwały
  także ręczne korekty — utrwalenie samego surowego wyniku losowania nie spełnia tej
  historyjki.
- **Status:** in-progress

### S-04: Biblioteka zapisanych kupców

- **Outcome:** MG może wrócić do listy zapisanych kupców, rozpoznać właściwego po nazwie
  nadanej automatycznie z kategorii i daty, zmienić tę nazwę na swoją i otworzyć kupca
  z asortymentem identycznym jak w chwili zapisu.
- **Change ID:** `saved-merchants-library`
- **PRD refs:** US-02, FR-010, FR-011
- **Prerequisites:** `F-01`, `S-03`
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** tu zaczyna się to, czym produkt różni się od istniejących generatorów, więc
  kawałek jest ważniejszy, niż wygląda. Stoi po `S-03`, bo lista potrzebuje akcji jawnego
  zapisu, żeby miała co pokazywać, i po `F-01`, bo pomyłka w kształcie zapisu zostałaby
  spłacona właśnie tutaj.
- **Status:** in-progress

### S-05: Lista, która wytrzymuje miesiące kampanii

- **Outcome:** MG może wyszukać zapisanego kupca po nazwie i usunąć takiego, którego już nie
  potrzebuje, gdy lista urośnie do kilkudziesięciu pozycji przez miesiące kampanii.
- **Change ID:** `merchant-search-and-delete`
- **PRD refs:** US-02, FR-012, FR-013
- **Prerequisites:** `S-04`
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Czy usunięcie wymaga potwierdzenia? FR-013 jest konieczne, a warunek ochronny mówi, że
    kupiec nigdy nie znika po cichu — PRD tego napięcia nie rozstrzyga. Owner: user.
    Block: no.
- **Risk:** kawałek jest sekwencjonowany na końcu świadomie: przy celu `speed` to on boli
  najmniej, jeśli termin 2026-09-13 przyciśnie, bo na pierwszej sesji MG ma jednego kupca,
  nie czterdziestu. Jednocześnie PRD uzasadnia FR-012 wprost skalą kampanii, więc nie jest
  to kandydat do wykreślenia — tylko do dowiezienia jako ostatni.
- **Status:** planning

## Backlog Handoff

| Roadmap ID | Change ID                    | Suggested issue title                                                  | Ready for `/10x-plan` | Notes                                                        |
| ---------- | ---------------------------- | ---------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------ |
| F-01       | `merchant-storage-contract`  | Kontrakt encji kupca i trwałości w magazynie przeglądarki              | yes                   | Bez zależności; może iść równolegle z `S-01`                  |
| S-01       | `first-generated-assortment` | Generowanie asortymentu: kategoria, zamożność, tabela 10–25 pozycji    | yes                   | North star. `/10x-plan first-generated-assortment`            |
| S-02       | `manual-item-corrections`    | Ręczna korekta ceny i ilości + potwierdzenie przed przegenerowaniem    | no                    | Czeka na `S-01`                                               |
| S-03       | `last-merchant-persists`     | Automatyczne utrwalenie ostatniego kupca i jawny zapis                 | no                    | Czeka na `F-01`, `S-01`, `S-02`                               |
| S-04       | `saved-merchants-library`    | Lista zapisanych kupców: auto-nazwa, zmiana nazwy, otwieranie          | no                    | Czeka na `F-01`, `S-03`                                       |
| S-05       | `merchant-search-and-delete` | Wyszukiwanie kupca po nazwie i usuwanie                                | no                    | Czeka na `S-04`                                               |

## Open Roadmap Questions

1. **Czy zakres v1 mieści się w budżecie?** — Trzynaście wymagań, wszystkie konieczne, przy
   dwóch dniach pracy i twardym terminie 2026-09-13 (dziś 2026-09-11). PRD sam wskazuje
   najtańszy ruch: degradacja części wymagań do „przydatnych". Roadmapa nie robi tego za
   użytkownika — wszystkie trzynaście są `must-have`, więc wszystkie są posekwencjonowane.
   Jedyna ochrona, którą roadmapa daje, jest w kolejności: `S-05` jest ostatni, bo boli
   najmniej, gdy nie zdąży. Owner: user. Block: roadmap-wide — decyzja potrzebna przed
   startem implementacji, ale nie blokuje planowania `F-01` ani `S-01`.

2. **Czy rozkład rzadkości wystarczy jako reguła domenowa?** — Reguła pilnuje proporcji
   pospolite / niezwykłe / rzadkie, ale nie pilnuje sensu ekonomicznego sklepu jako całości:
   kwota „rzadkie" w nędznej osadzie może trafić w przedmiot poza zasięgiem całej osady.
   Odrzuconą alternatywą był budżet sklepu. Owner: user. Block: nie blokuje planowania
   `S-01`, ale rozstrzyga jego kryterium sukcesu („8 na 10 MG bez ręcznych modyfikacji").

   > **ZMIERZONE 2026-09-11, po wdrożeniu `S-01`.** Luka nie jest teoretyczna. `nędzna`
   > osada wystawia towar za **84 720 gp** w `przedmioty-magiczne` (m.in.
   > `4 x Belt of Hill Giant Strength` po 5760 gp) i **34 897 gp** u alchemika. Proporcje
   > rzadkości są dotrzymane co do sztuki — problemem jest wartość bezwzględna, bo pula
   > magiczna zaczyna się od 110 gp, a modyfikator `nędzna` (×1.2) jeszcze ją podnosi.
   > Świadomie zaakceptowane w v1 przy terminie 2026-09-13; kod `S-01` nie został zmieniony.
   > Szczegóły i kandydaci na domknięcie: `context/foundation/lessons.md` → **L-01**.
   > To jest obecnie najpoważniejsze znane zagrożenie dla głównego kryterium sukcesu.

3. **Jak MG dostaje się do swoich kupców z drugiego urządzenia?** — Model lokalny przywiązuje
   zapisanych kupców do jednej przeglądarki na jednym urządzeniu; wyczyszczenie danych strony
   kasuje dorobek kampanii. Faza 3 shapingu usunęła rozwiązanie (konta z synchronizacją), nie
   problem. Kandydat na najtańsze domknięcie w v2: ręczny eksport i import pliku.
   Owner: user. Block: nie — v1 działa bez tego.

4. **`output: "static"` czy `output: "server"`, i gdzie liczy się losowanie?** — Nowe,
   wyszło z obrazu bazy kodu i z `context/deployment/deploy-plan.md` (Faza 9, opisane tam
   jako najwartościowsza otwarta decyzja). Każde wymaganie z PRD jest spełnialne buildem
   statycznym plus magazynem przeglądarki, a losowanie po stronie przeglądarki zdejmuje
   limit 10 ms CPU w Workers ze ścieżki kryterium „< 5 s". Owner: user. Block: nie blokuje
   planowania, ale dotyczy `S-01` i warto rozstrzygnąć przed nim.

5. **Dokumentacja dla agentów opisuje usunięty kod jako żywy.** — Nowe, wyszło z sondy bazy
   kodu: `AGENTS.md:7,19,21` wciąż wskazuje `src/lib/supabase.ts`, `/auth/*`,
   `PROTECTED_ROUTES` i `src/middleware.ts` wypełniający `context.locals.user`, a
   `CLAUDE.md.scaffold:18,24-30,39,47-48,54` opisuje cały skasowany przepływ uwierzytelniania.
   Żadne z tych miejsc już nie istnieje. Owner: user. Block: nie blokuje żadnego kawałka,
   ale dotyczy wszystkich — kod w tym projekcie pisze w większości agent, a te pliki są jego
   pierwszym źródłem prawdy.

> Otwarte pytanie #2 z PRD („Skąd pochodzi baza przedmiotów i czy wolno ją rozdawać?") nie
> jest tu wypisane, ponieważ zostało rozstrzygnięte — patrz `## Baseline`.

## Parked

- **Fabularna otoczka kupca** (imię, rasa, wygląd, historia, cechy) — Why parked:
  PRD § Non-Goals; MVP generuje asortyment, nie postać.
- **Dynamiczna ekonomia** (ceny reagujące na region, podaż i popyt) — Why parked:
  PRD § Non-Goals; modyfikator zamożności jest stały i przewidywalny, symulacja rynku nie wchodzi.
- **Negocjacje i targowanie** z uwzględnieniem statystyk postaci graczy — Why parked:
  PRD § Non-Goals; osobny system mechaniczny, nie generator asortymentu.
- **Homebrew — dodawanie własnych przedmiotów do bazy** — Why parked: PRD § Non-Goals.
- **Konta użytkowników i synchronizacja w chmurze** — Why parked: PRD § Non-Goals, świadomie
  odroczone do v2; nie mieszczą się w budżecie dwóch dni. Powiązane z Open Roadmap Questions #3.
- **Dedykowana aplikacja mobilna** — Why parked: PRD § Non-Goals; v1 to strona czytelna na
  telefonie, nie aplikacja ze sklepu.
- **Podgląd dla graczy i udostępnianie listy na zewnątrz** — Why parked: PRD § Non-Goals;
  model dostępu ma jedną rolę, co wyklucza całą warstwę uprawnień.
- **Wsparcie systemów RPG innych niż 5e** — Why parked: PRD § Non-Goals; oderwanie bazy
  przedmiotów i cen od 5e znacząco powiększyłoby pierwszą wersję.
- **Pełna baza przedmiotów spoza SRD** — Why parked: PRD § Non-Goals; pule zostają rzędu
  30–40 pozycji na kategorię. Wzmocnione przez rozstrzygnięcie licencyjne z `## Baseline`:
  treści poza SRD nie mogą wejść do tego publicznego repo.
- **Śledzenie błędów, metryki, biblioteka logująca** — Why parked: żaden NFR w PRD tego nie
  wymaga, a przy celu `speed` roadmapa nie dokłada warstw, których nic nie wymusza.
  Do produkcyjnego wglądu wystarcza `npx wrangler tail` opisany w `deploy-plan.md`.
- **Wyłączenie sesji Astro, żeby przestać provisionować nieużywany magazyn KV** —
  Why parked: `deploy-plan.md` Faza 9; porządek, nie wymaganie z PRD.

## Milestone History

(Pusta — to pierwszy milestone.)

## Done

(Pusta przy pierwszym generowaniu. `/10x-archive` dopisuje tu wpis — i przestawia status
kawałka na `done` — gdy archiwizowana zmiana ma `Change ID` zgodny z pozycją roadmapy.)
