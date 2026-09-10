---
project: "D&D 5e Merchant Generator"
context_type: greenfield
created: 2026-09-10
updated: 2026-09-10
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "context type"
      decision: "greenfield — no project markers in cwd; confirmed by user"
    - topic: "moment of use"
      decision: "both prep and at-table; at-table is the binding constraint"
    - topic: "pain category"
      decision: "workflow friction + missing capability"
    - topic: "core insight"
      decision: "persistence across sessions; existing generators are one-shot"
    - topic: "primary persona scope"
      decision: "any GM running D&D 5e; hobbyist niche, not other RPG systems"
    - topic: "auth model"
      decision: "local-only, no auth, LocalStorage — accounts+sync were chosen in Phase 2 then reverted in Phase 3 when the 2-day budget landed; deferred to v2"
    - topic: "auth gating"
      decision: "no gated routes at all; every feature is available immediately"
    - topic: "role model"
      decision: "flat, single role (GM); no player role, no sharing"
    - topic: "MVP scope vs budget"
      decision: "2 days is the real budget; scope cut to core loop (category -> generate -> table -> local save)"
    - topic: "category count in v1"
      decision: "four categories, small source pools (~30-40 items each)"
    - topic: "guardrail"
      decision: "a saved merchant never disappears silently"
    - topic: "domain rule shape"
      decision: "rarity-distribution classification driven by settlement wealth; budget-based alternative rejected as costlier"
    - topic: "pricing"
      decision: "SRD base price modified by settlement wealth; not a dynamic supply/demand economy"
    - topic: "NFR scope"
      decision: "only mobile readability raised to NFR; offline and on-device-only deliberately not committed"
    - topic: "product type"
      decision: "web-app; no dedicated mobile app"
    - topic: "target scale"
      decision: "medium (dozens to ~100 GMs)"
    - topic: "work mode and deadline"
      decision: "2 days of paid working time (not after-hours); hard deadline 2026-09-13"
  frs_drafted: 13
  quality_check_status: accepted
---

# Shape Notes — D&D 5e Merchant Generator

Seed input: `idea-notes.md` (read in full at session start).

## Vision & Problem Statement

Mistrz Gry prowadzący kampanię D&D 5e traci czas na ręczne wymyślanie, losowanie
i balansowanie asortymentu sklepów oraz handlarzy. Ból uderza najmocniej przy stole,
w trakcie sesji: gracze deklarują wizytę u kowala, której MG nie przewidział, i MG
musi na poczekaniu wyprodukować sensowną listę przedmiotów wraz z cenami i dostępnymi
ilościami. Dziś robi to z głowy albo kartkując podręczniki — wychodzi wolno, a wycena
i ilości bywają niespójne. Drugi koszt jest cichszy: wygenerowane wcześniej listy
gubią się między sesjami, więc ta sama praca jest wykonywana od nowa.

Insight: generatory sklepów do D&D już istnieją, ale wszystkie są jednorazowe —
odświeżenie strony kasuje kupca. Tymczasem sklep w kampanii nie jest zdarzeniem,
tylko obiektem, który żyje miesiącami: gracze wracają do tego samego kowala, pytają
o ten sam przedmiot, wydają zapas, który ktoś musi pamiętać. Trwałość kupca między
sesjami jest tą jedną rzeczą, której status quo nie daje.

> Socrates (typ bólu): user wskazał jednocześnie "tarcie w przepływie pracy" i
> "brakująca funkcja — nic tego nie robi dobrze". Rozstrzygnięcie: spójne — istniejące
> narzędzia oszczędzają czas jednorazowo, ale nie zamykają sprawy, bo nie pamiętają.
> Konsekwencja: funkcja zapisu nie jest dodatkiem do MVP, tylko jego rdzeniem.

## User & Persona

Mistrz Gry prowadzący kampanię w Dungeons & Dragons 5e. Hobbysta, nie zawodowiec;
prowadzi dla stałej drużyny, sesja po sesji, w kampanii ciągnącej się miesiącami.
Sięga po narzędzie w dwóch momentach — przy stole, gdy gracze skręcają w stronę
sklepu, którego nie było w planie, oraz wcześniej, przy przygotowaniach lokacji.
Ostrzejszy z tych momentów, i ten pod który projektujemy, to stół: MG ma kilka
sekund, gracze patrzą, a wynik musi nadawać się do przeczytania na głos bez
poprawiania.

Zasięg persony: dowolni MG prowadzący 5e — nie tylko autor. Wykluczone świadomie:
MG innych systemów RPG (wymagałoby oderwania bazy przedmiotów i cen od 5e, co
znacząco powiększa pierwszą wersję).

## Success Criteria

Pierwszy przepływ end-to-end (v1, po cięciu zakresu):

```
1. MG otwiera aplikację
2. wybiera kategorię asortymentu z listy (4 kategorie)
3. klika "Stwórz"
4. widzi tabelę 10–25 pozycji: nazwa, ilość, cena      ← wartość widoczna
5. (opcjonalnie) zapisuje kupca
6. na kolejnej sesji otwiera aplikację i wraca do zapisanego kupca
```

Cztery kroki do wartości widocznej dla użytkownika.

### Primary
- 8 na 10 Mistrzów Gry testujących aplikację uznaje wygenerowany asortyment za gotowy
  do natychmiastowego użycia na sesji, bez potrzeby ręcznych modyfikacji.
- Wygenerowanie pełnego asortymentu zajmuje użytkownikowi mniej niż 5 sekund od
  kliknięcia "Stwórz".
- Każda wygenerowana lista mieści się w przedziale 10–25 unikalnych pozycji.

### Secondary
- Mistrzowie Gry korzystają z funkcji zapisu i regularnie wracają do wcześniej
  stworzonych kupców na kolejnych sesjach.

### Guardrails
- Zapisany kupiec nigdy nie znika po cichu. Utrata zapisanego kupca bez ostrzeżenia
  jest regresją cięższą niż słaby asortyment — trwałość jest rdzeniem produktu,
  a nie funkcją dodatkową.

## User Stories

### US-01: MG generuje asortyment sklepu przy stole

- **Given** MG prowadzi sesję i gracze niespodziewanie deklarują wizytę u handlarza
- **When** MG wybiera kategorię asortymentu oraz poziom zamożności osady i klika "Stwórz"
- **Then** widzi tabelę pozycji z nazwą, ilością i ceną, gotową do przeczytania na głos

#### Acceptance Criteria
- Lista zawiera od 10 do 25 pozycji, zawsze w tym przedziale
- Żadna pozycja nie powtarza się w obrębie jednej listy; liczbę sztuk niesie kolumna Ilość
- Każda pozycja pasuje do wybranej kategorii oraz do poziomu zamożności osady
- Każda pozycja ma określoną cenę i dostępną ilość
- Wynik pojawia się w mniej niż 5 sekund od kliknięcia

### US-02: MG wraca do kupca na kolejnej sesji

- **Given** MG wygenerował wcześniej kupca, który zapisał się pod automatyczną nazwą
- **When** otwiera aplikację na kolejnej sesji i odnajduje go na liście zapisanych
- **Then** widzi dokładnie ten sam asortyment, w tym własne ręczne korekty

#### Acceptance Criteria
- Zapisany kupiec jest rozpoznawalny po nazwie — automatycznej lub zmienionej przez MG
- Zapisanego kupca da się odnaleźć po nazwie, gdy lista urośnie
- Asortyment po ponownym otwarciu jest identyczny z zapisanym
- Ręczne korekty ceny i ilości przetrwały zapis
- Zapisany kupiec nie znika bez wyraźnej akcji usunięcia przez MG

### US-03: MG zamyka kartę w środku sesji i nic nie traci

- **Given** MG wygenerował kupca i nie kliknął zapisu, bo wrócił do prowadzenia gry
- **When** zamyka kartę przeglądarki i otwiera aplikację ponownie
- **Then** widzi ostatnio wygenerowanego kupca w stanie, w jakim go zostawił

#### Acceptance Criteria
- Ostatni wygenerowany kupiec jest odtwarzany bez akcji ze strony MG
- Ręczne korekty wprowadzone przed zamknięciem karty są zachowane
- Jawny zapis pozostaje osobną akcją, oznaczającą kupca jako trwałego

## Functional Requirements

Numeracja przepisana po rundzie Socratesa (Faza 4.5). Dwie zdolności są nowe i wyszły
wprost z rundy: FR-002 (poziom zamożności) i FR-012 (wyszukiwanie).

### Generowanie

- FR-001: MG może wybrać kategorię asortymentu z listy. Priority: must-have
  > Socrates: Rozważone kontrargumenty — zła oś podziału (MG myśli lokacją, nie branżą);
  > zamknięta lista odcina nietypowe sklepy; klik przed wartością kosztuje sekundy.
  > Rozstrzygnięcie: żaden nie przyjęty, FR zostaje bez zmian.

- FR-002: MG może wybrać poziom zamożności osady (nędzna / typowa / bogata). Priority: must-have
  > Socrates: FR powstał jako rozstrzygnięcie kontrargumentu do generowania jednym
  > kliknięciem: "jeden klik nie daje kontroli nad zamożnością, a zamożność osady
  > zmienia asortyment mocniej niż branża". Przyjęty. Konsekwencja: to prawdopodobnie
  > główna dźwignia kryterium 8/10, ale dotyka reguły losowania, nie tylko interfejsu.

- FR-003: MG może uruchomić generowanie asortymentu jednym kliknięciem. Priority: must-have

- FR-004: MG otrzymuje asortyment złożony z 10–25 unikalnych pozycji dopasowanych do wybranej kategorii i poziomu zamożności. Priority: must-have
  > Socrates: Kontrargument przyjęty — "wymuszona unikalność wypacza obraz sklepu;
  > kowal ma dwanaście sztuk tego samego sztyletu". Rozstrzygnięcie: unikalność
  > zostaje. Zarzut jest trafny co do realizmu, ale rozwiązany przez projekt —
  > głębokość zapasu niesie kolumna Ilość, a nie powtórzony wiersz. Unikalność nazw
  > i liczba sztuk to dwie różne osie.

- FR-005: MG widzi dla każdej wygenerowanej pozycji jej cenę oraz dostępną ilość. Priority: must-have
  > Socrates: Kontrargument przyjęty — "ceny ekwipunku w 5e są podane w podręczniku,
  > więc ich przepisanie nie jest generowaniem; prawdziwa wartość leżałaby w wariacji
  > ceny zależnej od miejsca, a to jest w non-goals". Rozstrzygnięcie: ODROCZONE do
  > Fazy 5 — to nie jest zarzut wobec tego FR, tylko pytanie, czy aplikacja w ogóle
  > podejmuje decyzję za użytkownika. Rozstrzygnięte przy regule domenowej.

- FR-006: MG może przegenerować asortyment dla tej samej kategorii; jeśli wprowadził ręczne korekty, aplikacja prosi o potwierdzenie przed ich utratą. Priority: must-have
  > Socrates: Kontrargument przyjęty — "reroll bez historii kasuje listę, która była
  > prawie dobra; to ta sama klasa błędu co cicha utrata zapisanego kupca".
  > Rozstrzygnięcie: FR zmieniony — potwierdzenie wymagane, gdy istnieją ręczne
  > korekty. Chroni jedyną pracę nie do odtworzenia, bez kosztu pełnej historii stanu.

### Prezentacja wyniku

- FR-007: MG widzi wygenerowany asortyment w formie czytelnej tabeli z kolumnami Nazwa, Ilość, Cena. Priority: must-have
  > Socrates: Rozważone kontrargumenty — tabela nie jest formatem do czytania na głos;
  > trzy kolumny nie mieszczą się na telefonie. Rozstrzygnięcie: żaden nie przyjęty,
  > FR zostaje bez zmian.

- FR-008: MG może ręcznie skorygować cenę lub ilość pojedynczej pozycji. Priority: must-have
  > Socrates: Rozważone kontrargumenty — sprzeczne z obietnicą "gotowe bez modyfikacji";
  > najdroższy element v1; otwiera drzwi do homebrew, który jest w non-goals.
  > Rozstrzygnięcie: żaden nie przyjęty, FR zostaje must-have. Ryzyko budżetowe
  > odnotowane: to najdroższa pozycja w v1.

### Zapisani kupcy

- FR-009: Ostatni wygenerowany kupiec trwa automatycznie między wizytami MG w aplikacji; jawny zapis oznacza go jako trwałego. Priority: must-have
  > Socrates: Kontrargument przyjęty — "MG w środku sesji nie klika 'zapisz', tylko
  > zamyka kartę; ręczny zapis łamie guardrail, bo najczęstsza utrata to ta sprzed
  > zapisu". Rozstrzygnięcie: FR zmieniony — automatyczne utrwalenie ostatniego kupca
  > plus jawny zapis jako oznaczenie trwałości. Domyka guardrail bez zaśmiecania listy
  > jednorazówkami.

- FR-010: Zapisany kupiec otrzymuje automatyczną nazwę złożoną z kategorii i daty, którą MG może zmienić. Priority: must-have
  > Socrates: Kontrargument przyjęty — "wymuszona nazwa kosztuje sekundy w środku
  > sceny". Rozstrzygnięcie: FR zmieniony — nazwa nadawana automatycznie, edytowalna
  > później. Zapis nie blokuje niczego przy stole, a lista pozostaje czytelna.

- FR-011: MG może wrócić do listy zapisanych kupców i otworzyć wybranego. Priority: must-have

- FR-012: MG może wyszukać zapisanego kupca po nazwie. Priority: must-have
  > Socrates: FR powstał jako rozstrzygnięcie kontrargumentu do FR-011 — "lista bez
  > szukania pada przy kilkudziesięciu kupcach, a kampania trwa miesiącami; to rdzeń
  > produktu, więc musi wytrzymać skalę kampanii, nie jednego wieczoru". Przyjęty.
  > User wybrał wyszukiwanie zamiast tańszego sortowania po dacie — rozwiązuje problem
  > zamiast go odsuwać.

- FR-013: MG może usunąć zapisanego kupca. Priority: must-have
  > Socrates: Rozważone kontrargumenty — usuwanie łamie guardrail "kupiec nigdy nie
  > znika po cichu"; usuwanie to problem trzeciego miesiąca, zbędny w v1.
  > Rozstrzygnięcie: żaden nie przyjęty, FR zostaje bez zmian.

> Ryzyko budżetowe (odnotowane, nie rozstrzygnięte): runda Socratesa dołożyła do
> dwudniowego budżetu poziom zamożności osady (dotyka reguły losowania, nie tylko
> interfejsu), wyszukiwanie, automatyczne utrwalanie i dialog potwierdzenia — przy
> jednoczesnym utrzymaniu edytowalnej tabeli jako must-have. Zakres rośnie w tę samą
> stronę, z której zszedł w Fazie 3. Wraca w krzyżowym sprawdzeniu (Faza 7).

## Non-Functional Requirements

- Wygenerowany asortyment jest czytelny i użyteczny na wąskim ekranie telefonu, bez
  przewijania w poziomie i bez powiększania — MG przy stole częściej trzyma w ręku
  telefon niż laptop.

> Zakres tej sekcji: user świadomie nie podniósł do rangi NFR ani działania bez
> internetu, ani zobowiązania, że dane nie opuszczają urządzenia. Wymóg czasu reakcji
> (< 5 s od kliknięcia do widocznej tabeli) nie jest tu powtarzany, ponieważ żyje
> w `## Success Criteria / Primary` jako mierzalne kryterium sukcesu.

## Business Logic

Poziom zamożności osady wyznacza rozkład rzadkości przedmiotów w asortymencie oraz
modyfikator ich ceny, a aplikacja dobiera pozycje w ramach tych kwot i w granicach
wybranej kategorii.

Reguła konsumuje dwa wejścia podane przez MG: kategorię asortymentu i poziom
zamożności osady. Zamożność przekłada się na proporcje przedmiotów pospolitych,
niezwykłych i rzadkich — nędzna osada dostaje asortyment przechylony w stronę
pospolitych, bogata dopuszcza wyraźny udział rzadkich. Ta sama zamożność wyznacza
modyfikator ceny nakładany na wartość bazową przedmiotu, więc ten sam sztylet kosztuje
inaczej w wiosce niż w porcie.

Wyjściem reguły jest lista 10–25 unikalnych pozycji, w której miks rzadkości odpowiada
kwotom wyznaczonym przez zamożność, a każda pozycja ma cenę i dostępną ilość. MG
spotyka regułę dokładnie raz, w momencie kliknięcia "Stwórz" — nie konfiguruje jej,
nie widzi jej parametrów i nie musi rozumieć, jak działa. Widzi tylko, że asortyment
pasuje do miejsca, które opisał.

> Socrates (odroczony z FR-005): kontrargument brzmiał "ceny w 5e są stałe, więc ich
> przepisanie to iluzja pracy, a prawdziwa wartość leżałaby w wariacji ceny — którą
> wykluczyłeś jako non-goal". Rozstrzygnięcie: cena bazowa pochodzi z SRD, ale reguła
> nakłada na nią modyfikator zamożności. To jest realna decyzja cenowa, a jednocześnie
> nie jest dynamiczną ekonomią reagującą na podaż i popyt — non-goal pozostaje w mocy.

> Znane ograniczenie wybranej reguły: rozkład rzadkości pilnuje proporcji, ale nie
> pilnuje sensu ekonomicznego sklepu jako całości. Kwota "rzadkie" w nędznej osadzie
> może trafić w przedmiot, na który cała osada nie ma pieniędzy. Rozważaną alternatywą
> był budżet sklepu (łączna wartość towaru wyznaczona zamożnością), który domykałby
> tę lukę; user wybrał rozkład rzadkości jako prostszy do zbudowania. Trafia do
> Open Questions.

> Kontrola anty-wzorca: pusty CRUD NIE występuje. Aplikacja podejmuje decyzję za
> użytkownika (jaki miks rzadkości i jaki poziom cen pasuje do opisanego miejsca),
> a nie tylko przechowuje i wyświetla rekordy.

## Access Control

Pojedynczy użytkownik, brak uwierzytelniania, dane wyłącznie na urządzeniu. MG otwiera
aplikację i od razu jej używa — nie ma rejestracji, logowania ani kont. Zapisani kupcy
żyją w pamięci lokalnej przeglądarki i nie opuszczają urządzenia.

Model ról jest płaski i pusty — istnieje jedna rola, Mistrz Gry. Nie ma roli gracza;
gracze nigdy nie korzystają z aplikacji, MG czyta im asortyment z ekranu. Brak ról
oznacza brak macierzy uprawnień i brak pojęcia "treść ukryta przed graczem".
Nie istnieją trasy bramkowane, więc pytanie o zachowanie przy dostępie
nieuwierzytelnionym nie ma zastosowania.

Znane i przyjęte ograniczenie modelu lokalnego: zapisany kupiec jest przywiązany do
jednej przeglądarki na jednym urządzeniu. MG, który przygotowywał sesję na laptopie,
a prowadzi z tabletu, nie zobaczy tam swoich kupców; wyczyszczenie danych strony
kasuje dorobek kampanii. To jest realny koszt rdzenia produktu (trwałość między
sesjami) i został przyjęty świadomie na rzecz zmieszczenia się w budżecie dwóch dni.

> Socrates (rola gracza): rozważono tryb podglądu dla graczy i udostępnianie listy
> na zewnątrz. Rozstrzygnięcie: odrzucone — najmniejszy model dostępu, który wciąż
> czyni MVP użytecznym, to brak ról w ogóle.

> Historia decyzji: w trakcie Fazy 2 user cofnął zapis z notatek i wybrał konta
> z synchronizacją w chmurze, uzasadniając to tym, że trwałość zamknięta w jednej
> przeglądarce jest słabym rdzeniem produktu. Decyzja została wycofana w Fazie 3,
> gdy budżet czasowy wyszedł na dwa dni — konta, rejestracja, reset hasła, sesje
> i synchronizacja z obsługą konfliktów nie mieszczą się w tym budżecie. Konta
> wracają do Non-Goals jako świadomie odroczone do v2. Motywacja, która za nimi
> stała (dostęp z wielu urządzeń), pozostaje nierozwiązana — trafia do Open Questions.

## Non-Goals

Przeniesione wprost z `idea-notes.md`:

- **Fabularna otoczka kupca** (imię, rasa, wygląd, historia, cechy charakteru) — MVP
  generuje asortyment, nie postać. Otoczkę MG i tak improwizuje lepiej niż narzędzie.
- **Dynamiczna ekonomia** (ceny reagujące na region, podaż i popyt) — modyfikator
  zamożności z reguły domenowej jest stały i przewidywalny; symulacja rynku nie wchodzi.
- **Negocjacje i targowanie** z uwzględnieniem statystyk postaci graczy — to osobny
  system mechaniczny, nie generator asortymentu.
- **Homebrew — dodawanie własnych przedmiotów** do bazy aplikacji.
- **Konta użytkowników i synchronizacja w chmurze** — świadomie odroczone do v2.
  Decyzja przeszła pełny cykl: notatki ją wykluczały, Faza 2 ją przywróciła
  (uzasadnienie: trwałość w jednej przeglądarce jest słabym rdzeniem), Faza 3 ją
  ponownie wykluczyła, gdy budżet czasowy wyszedł na dwa dni.
- **Dedykowana aplikacja mobilna** — v1 to strona internetowa czytelna na telefonie,
  a nie aplikacja instalowana ze sklepu.

Dołożone w tej sesji:

- **Podgląd dla graczy i udostępnianie listy na zewnątrz** — model dostępu ma jedną
  rolę. Wykluczenie tego blokuje całą warstwę uprawnień i pojęcie "treść ukryta przed
  graczem" (Faza 2).
- **Wsparcie systemów RPG innych niż 5e** — persona to MG prowadzący 5e. Oderwanie
  bazy przedmiotów i cen od 5e znacząco powiększyłoby pierwszą wersję (Faza 1).
- **Pełna baza przedmiotów spoza SRD** — pule pozostają małe, rzędu 30–40 pozycji na
  kategorię. Wyklucza jednocześnie koszt czasu i problem licencyjny kompletnych list
  z podręczników innych niż SRD (Faza 3).

Rozważone i **nie** przyjęte jako non-goal:

- Gwarancja działania bez internetu — user jej nie wykluczył, ale też nie podniósł do
  rangi NFR w Fazie 5. Aplikacja może działać offline jako skutek uboczny modelu
  lokalnego; nikt tego nie obiecuje ani nie testuje.

## Open Questions

1. **Czy zakres v1 mieści się w budżecie?** — Trzynaście FR-ów, wszystkie `must-have`,
   przy 2 dniach pracy i twardym terminie 2026-09-13 (trzy dni kalendarzowe od
   rozpoczęcia shapingu). Faza 4.5 dołożyła poziom zamożności osady (dotyka reguły
   losowania, nie tylko interfejsu), wyszukiwanie zapisanych kupców, automatyczne
   utrwalanie ostatniego kupca i dialog potwierdzenia przed rerollem — przy
   jednoczesnym utrzymaniu edytowalnej tabeli (FR-008) jako `must-have`, wskazanej
   w trakcie sesji jako najdroższy pojedynczy element v1. Bramka czasowa formalnie
   przechodzi, bo 2 dni to mniej niż 3 tygodnie, ale jest to najsłabszy możliwy powód
   jej zaliczenia. Owner: user. Blokuje: nie, ale wymaga decyzji przed startem
   implementacji — najtańszym ruchem jest degradacja części FR-ów do `nice-to-have`.

2. **Skąd pochodzi baza przedmiotów i czy wolno ją rozdawać?** — Pule mają liczyć
   30–40 pozycji na każdą z czterech kategorii, z przypisaną rzadkością i ceną bazową.
   Nierozstrzygnięte: źródło danych, sposób klasyfikacji pozycji pod rzadkość oraz
   zakres licencji. SRD 5.1 (CC-BY-4.0) pokrywa część ekwipunku i przedmiotów
   magicznych; pełne listy z podręczników innych niż SRD nie są wolno licencjonowane,
   a przy skali kilkudziesięciu do stu użytkowników pytanie o licencję przestaje być
   teoretyczne. Owner: user. Blokuje: TAK — bez tej bazy generator nie ma czym
   generować, więc leży na krytycznej ścieżce. By: przed startem implementacji.

3. **Czy rozkład rzadkości wystarczy jako reguła domenowa?** — Wybrana reguła pilnuje
   proporcji pospolite / niezwykłe / rzadkie, ale nie pilnuje sensu ekonomicznego
   sklepu jako całości: kwota "rzadkie" w nędznej osadzie może trafić w przedmiot poza
   zasięgiem całej osady. Rozważaną i odrzuconą alternatywą był budżet sklepu (łączna
   wartość towaru wyznaczona zamożnością), który domykałby tę lukę kosztem większej
   złożoności. Owner: user. Blokuje: nie, ale to ta luka najpewniej zadecyduje
   o kryterium "8 na 10 MG bez ręcznych modyfikacji".

4. **Jak MG dostaje się do swoich kupców z drugiego urządzenia?** — Model lokalny
   przywiązuje zapisanych kupców do jednej przeglądarki na jednym urządzeniu;
   wyczyszczenie danych strony kasuje dorobek kampanii. To był powód, dla którego
   w Fazie 2 wybrano konta z synchronizacją, a Faza 3 usunęła rozwiązanie, nie problem.
   Kandydat na najtańsze domknięcie w v2: ręczny eksport i import pliku. Owner: user.
   Blokuje: nie — v1 działa bez tego, ale rdzeń produktu (trwałość między sesjami)
   pozostaje częściowo nierozwiązany.

---

# Poza schematem PRD

Poniższe bloki nie są sekcjami PRD. Zasilają frontmatter PRD (rodzaj produktu,
skala, budżet czasowy) albo dokumentują przebieg shapingu. `/10x-prd` nie kopiuje
ich do PRD jako sekcji.
## Product framing

- Rodzaj produktu: aplikacja webowa (`product_type: web-app`). Zgodne z notatkami —
  strona internetowa dostosowana do ekranów, bez dedykowanej aplikacji mobilnej.
- Skala: kilkadziesiąt do stu użytkowników (`target_scale.users: medium`). Ta skala
  czyni sensownym kryterium "8 na 10 MG testujących". Ruch i objętość danych są
  pochodną modelu w pełni lokalnego — obliczenia i dane żyją na urządzeniu MG.
- Budżet czasowy: 2 dni pracy **w ramach obowiązków zawodowych** (nie po godzinach),
  twardy termin **2026-09-13**.

> Socrates (skala ×100): przy dziesięciu tysiącach MG sama reguła domenowa nie zmienia
> się wcale — liczy się lokalnie, na urządzeniu każdego użytkownika. Zmienia się co
> innego: dystrybucja bazy przedmiotów do dziesięciu tysięcy osób to inna rozmowa
> o licencji niż udostępnienie jej kilku znajomym. Trafia do Open Questions.

> Uwaga do budżetu: tryb pracy zmienił się w tej fazie z "po godzinach" (założenie
> Fazy 3) na "w ramach pracy zawodowej". Dwa dni robocze to istotnie mocniejszy zasób
> niż dwa wieczory, co poprawia rachunek z Fazy 3 — ale nie unieważnia ryzyka
> budżetowego z Fazy 4.5, a twardy termin 2026-09-13 oznacza trzy dni kalendarzowe
> od dziś.

## Timeline budget

Szacunek użytkownika: **2 dni** pracy po godzinach (zapisane w PRD jako `mvp_weeks: 1`,
bo pole przyjmuje pełne tygodnie — literalny szacunek to dwa dni).

> Historia decyzji: pierwsza wersja przepływu obejmowała konta i synchronizację
> w chmurze, co dawało siedem kroków i wywalało gate zakresu na trzech kosztownych
> kawałkach naraz (backend z kontami; baza przedmiotów 5e z cenami i licencjonowaniem;
> reguła balansu). User początkowo wybrał "biorę dłuższy termin", ale podał szacunek
> dwóch dni — rozjazd rzędu wielkości został mu przedstawiony wprost. Rozstrzygnięcie:
> dwa dni są prawdziwe, zakres schodzi do rdzenia, konta wracają do Non-Goals.
> Ponieważ budżet wynosi poniżej trzech tygodni, formalna akceptacja kosztu
> wielotygodniowej pracy nie jest potrzebna i nie została zapisana.

## Zakres v1 — decyzje dotyczące danych

Cztery kategorie asortymentu (przedmioty magiczne, kowal, alchemik, towary ogólne),
każda z małą pulą źródłową rzędu 30–40 pozycji zamiast kompletnej listy. Mniej niż
dwie kategorie czyniłoby krok wyboru kategorii pustym; pełne pule nie mieszczą się
w budżecie dwóch dni.

## Quality cross-check

Bramka jakości przeszła w komplecie — żaden z pięciu elementów wymaganych dla sesji
greenfield nie jest pusty.

| Element | Status |
| --- | --- |
| Access Control | present — model lokalny, jedna rola, brak tras bramkowanych |
| Business Logic | present — jedno zdanie oznajmujące; anty-wzorzec pustego CRUD nie występuje |
| Project artifacts | present |
| Timeline-cost ack | present — budżet 2 dni, poniżej progu 3 tygodni, formalna akceptacja niewymagana |
| Non-Goals | present — 9 pozycji |
| Preserved behavior | n/a (greenfield) |

Bramka mierzy kompletność notatek, nie wykonalność. Cztery ryzyka pozostają otwarte
i są wypisane poniżej.

