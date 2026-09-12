# Lessons

Powtarzalne reguły i pułapki wychwycone w trakcie pracy nad projektem.
Każdy wpis ma datę, obserwację i regułę do zastosowania następnym razem.

---

## L-01: Rozkład proporcji nie pilnuje sensu ekonomicznego

**Data:** 2026-09-11 · **Wyszło z:** implementacji S-01 (`first-generated-assortment`)

**Obserwacja.** Reguła domenowa dobiera przedmioty według proporcji rzadkości
(pospolite / niezwykłe / rzadkie) wyznaczonych przez zamożność osady. Proporcje są
dotrzymane co do sztuki — i mimo to `nędzna` osada wystawia towar za **84 720 gp**
w kategorii `przedmioty-magiczne` (m.in. `4 x Belt of Hill Giant Strength` po 5760 gp)
oraz **34 897 gp** u alchemika.

Powód: pula magiczna zaczyna się dopiero od 110 gp, a jej tier „niezwykłe" to
520–4800 gp bazowo. Zamożność steruje *którą część puli* bierzemy, a nie *ile złota
leży na półce*. Modyfikator ceny dla `nędzna` (×1.2) jeszcze to pogarsza, bo podnosi
ceny tam, gdzie osadu nie stać.

**Reguła.** Kiedy reguła domenowa normuje **udziały**, sprawdź osobno, czy normuje też
**wartości bezwzględne**. Proporcje mogą być idealne przy wyniku, który jest bez sensu.
Test na proporcje tego nie złapie — trzeba policzyć sumę i spojrzeć na nią oczami
użytkownika.

**Status w produkcie.** Świadomie zaakceptowane w v1. PRD Open Question #3 przewidziało
dokładnie to ryzyko i wybrało rozkład rzadkości zamiast budżetu sklepu jako prostszy do
zbudowania. Kandydaci na domknięcie, od najtańszego:

1. ilość zależna od ceny (drogie przedmioty 1–2 szt., nie 4)
2. filtr cenowy per zamożność (wymaga przeliczenia wykonalności wszystkich 12 par)
3. budżet sklepu — odrzucona alternatywa z PRD

**Konsekwencja dla kryterium sukcesu.** To jest najpoważniejsze znane zagrożenie dla
„8 na 10 MG uznaje asortyment za gotowy bez ręcznych modyfikacji". MG zobaczy 84 tys. gp
w nędznej wiosce i poprawi listę ręcznie. Zob. też `[[S-02 manual-item-corrections]]`,
który daje narzędzie do poprawki — ale kryterium mówi o *nie musieniu* poprawiać.

---

## L-02: `.gitattributes` naprawia indeks, nie katalog roboczy

**Data:** 2026-09-11 · **Wyszło z:** implementacji S-01, Faza 1, zmiana 5

**Obserwacja.** Plan zakładał, że `.gitattributes` (`* text=auto eol=lf`) plus
`git add --renormalize .` sprawi, że `npm run lint` zacznie przechodzić. Nie sprawiło.
Po obu krokach lint nadal zwracał **144 błędy `Delete ␍`**, bo `--renormalize` aktualizuje
**indeks**, a pliki na dysku zostają z CRLF. Git przy tym raportuje drzewo jako czyste,
bo filtr `clean` konwertuje CRLF→LF przy odczycie — więc nic tego nie sygnalizuje.

**Reguła.** Po zmianie `.gitattributes` katalog roboczy trzeba przepisać osobno. Najtańszy
sposób w tym repo: `npm run lint:fix` (Prettier 3 domyślnie zapisuje LF) — obejmuje dokładnie
te pliki, na które patrzy `npm run lint`, więc bramka staje się zielona bez ruszania
`.gitignore`, `.husky/*` czy `.vscode/*`, których i tak nikt nie lintuje.

**Weryfikacja.** Nie ufaj temu, że polecenie „powinno" zadziałać — uruchom bramkę i sprawdź
kod wyjścia. `git status` pokaże czysto również wtedy, gdy problem dalej istnieje.

---

## L-03: Test, który nigdy nie dochodzi do badanego kodu, przechodzi

**Data:** 2026-09-11 · **Wyszło z:** implementacji S-01, Faza 1, zmiana 4

**Obserwacja.** Test „gwarancja zero rzadkich w `nędzna` trzyma się nawet gdy trzeba
przelać nadmiar" przechodził — i nie sprawdzał niczego. Syntetyczna pula była zrobiona
tak płytko (4 + 3 przedmioty na 10–15 wierszy), że **wszystkie 20 ziaren rzucało wyjątek**,
a asercja o zerze rzadkich nigdy się nie wykonała. Był to najważniejszy test w całej fazie:
jedyny przypadek, w którym reguła przelewu i niezmiennik `nędzna` mogą sobie zaprzeczyć.

**Reguła.** Przy teście na ścieżkę awaryjną sprawdź, **czy test faktycznie w nią wchodzi**.
Dwie tanie metody:

- **sonda** — tymczasowy test, który wypisuje ile razy poszło happy path, a ile wyjątkiem;
- **mutacja** — zepsuj celowo badany warunek i upewnij się, że zestaw testów pada
  na właściwym teście. Jeśli nie pada, test niczego nie strzeże.

Tu obie metody zastosowano: sonda pokazała `threw=20 returned=0`, a po rozbiciu na dwa
testy mutacja (usunięcie strażnika `eligible`) prawidłowo wywaliła zestaw.

---

## L-04: Bramka, która wygląda na włączoną, a nie obejmuje niczego

**Data:** 2026-09-12 · **Wyszło z:** impl review S-02 (`manual-item-corrections`), Faza 3

**Obserwacja.** `eslint.config.js:83` rozwija
`eslintPluginAstro.configs["flat/jsx-a11y-recommended"]`. Wygląda to na włączoną bramkę
dostępności dla całego projektu — plan S-02 tak to właśnie zacytował: „`eslint.config.js:83`
enables `flat/jsx-a11y-recommended`, so the project has already opted into caring about this".
Reguły z tej paczki mają jednak przestrzeń nazw `astro/jsx-a11y/*` i obowiązują **wyłącznie w
plikach `.astro`**. Cały interfejs tego produktu to wyspy React, więc nie jest objęty niczym.

Sprawdzone, nie założone: sonda w `src/components/` z `<img src="x.png" />`, klikalnym `<a>`
bez `href` i `<input>` bez etykiety przechodzi lint **czysto** — odzywa się tylko reguła
TypeScriptowa.

Koszt: cztery ustalenia z jednej rundy review (nazwa dostępna pól edycji, wskaźnik focusa,
obramowanie przycisku Anuluj, brak `aria-describedby`) były dla CI niewidoczne i zawsze by były.

**Reguła.** Zanim powołasz się na bramkę w planie albo w review, sprawdź jej **zasięg plikowy**,
nie samą obecność wpisu w configu. Najtańszy dowód to sonda: plik z celowym naruszeniem,
uruchomiony lint, sprawdzony kod wyjścia. Nazwa paczki („jsx-a11y") mówi co reguła robi, nie
gdzie działa.

**Applies to:** każda konfiguracja bramki w tym repo (`eslint.config.js`, `tsconfig`,
`vitest.config.ts` — por. `[[L-03]]`, gdzie zawiódł zasięg testu, nie lintu), a w szczególności
każdy plan powołujący się na istniejącą bramkę jako uzasadnienie, że czegoś nie trzeba sprawdzać
ręcznie.
