# Korekty zapisują się same — Plan Brief

> Pełny plan: `context/changes/corrections-autosave/plan.md`
> Zapis decyzji i framing: `context/changes/corrections-autosave/change.md`

## What & Why

Korekta ceny lub ilości u kupca otwartego z biblioteki idzie dziś wyłącznie do slotu „ostatni
kupiec" — rekord w bibliotece czeka na kliknięcie „Zapisz zmiany", a po przeładowaniu to
kliknięcie tworzy **duplikat**. Produkt zapisuje więc sam kupca jednorazowego, a od tego świadomie
zapisanego wymaga akcji. To inwersja względem intuicji i to ona jest powodem tej zmiany.

## Starting Point

S-01 – S-05 są dowiezione i na `origin/main`. `handleCorrect` wywołuje wyłącznie `putTransient`;
`updateSavedMerchant` ma jedyne wywołanie z przycisku; `openedSavedId` nie jest utrwalany, więc
przeładowanie zrywa powiązanie z rekordem w bibliotece (udokumentowane w S-04 jako zaakceptowane
ograniczenie — i właśnie odrzucone w praktyce).

## Desired End State

MG otwiera kupca, poprawia cenę, odkłada telefon. Nic nie klika. Za tydzień otwiera tego samego
kupca i cena jest poprawiona. Nie ma przycisku zapisu, bo nie ma czego zapisywać; nie ma
podkreśleń, bo nie ma stanu „niezapisane"; dialog o odrzuceniu korekt pojawia się tylko wtedy, gdy
MG faktycznie zaraz coś straci. Duplikat jest nieosiągalny żadną ścieżką.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Źródło |
| --- | --- | --- | --- |
| Model zapisu korekt | Auto-zapis w miejscu | Zapisany kupiec ma się zachowywać jak dokument, nie jak brudnopis | change.md |
| Odtworzenie „otwartego" po starcie | Wspólne `id` transientu i rekordu | `promoteTransient` zawsze bije nowe `id`, więc kolizja nie powstaje przypadkiem — zero zmian schematu | Plan |
| Bursztynowy marker | Znika całkiem | Bursztyn to w tym UI kolor błędów magazynu; po auto-zapisie lektura „niezapisane" jest fałszywa | change.md |
| Nieudany auto-zapis | Bez akcji „Ponów" | Trwały baner `StorageNotice` niesie sygnał; ponowienie przy następnej korekcie | Plan |
| Przycisk Zapisz przy otwartym rekordzie | Znika | Nie pokazywać kontrolki, która nie ma czego zrobić — i odciąć drogę do duplikatu | Plan |
| Predykat guardu | „Czy praca zginie", nie „czy są korekty" | Ostrzeżenie, które kłamie, uczy MG odklikiwania go na ślepo | Plan |
| Zasięg domknięcia edycji | `pagehide` + `visibilitychange` | Pokrywa telefon w tle — przypadek, który PRD nazywa wprost | Plan |

## Scope

**In scope:** auto-zapis do rekordu z biblioteki; odtworzenie „otwartego" po przeładowaniu i po
zapisie nowego kupca; znikający przycisk; usunięcie markera; nowy predykat guardu; domknięcie
edycji przy opuszczaniu strony.

**Out of scope:** zmiana schematu i nowe operacje magazynu; cofanie, kosz, wersjonowanie; akcja
„Ponów zapis"; dławienie zapisu w czasie; generator, wyszukiwanie, usuwanie; jsdom.

## Architecture / Approach

Reguły trafiają do `merchant-session.ts` — dwie czyste funkcje: `openedSavedIdFor(doc)` (czy
transient pochodzi z zapisanego rekordu) i `wouldLoseCorrections(hasCorrections, openedSavedId)`
(czy guard ma prawo straszyć). `MerchantGenerator` je konsumuje: `handleCorrect` dokłada zapis do
biblioteki obok zapisu transientu, `addMerchant` ustanawia link po promocie, a przycisk znika,
gdy coś jest otwarte. Transient zostaje mimo dublowania — to on przywraca ekran i niesie `id`.

## Phases at a Glance

| Faza | Co dowozi | Główne ryzyko |
| --- | --- | --- |
| 1. Auto-zapis w miejscu | Korekty trzymają się kupca, duplikat nieosiągalny | Przeoczenie linku po promocie — skarga wraca o krok później |
| 2. Porządki w interfejsie | Marker znika, guard mówi prawdę, edycja przeżywa F5 | Brak; w całości wycinalna |

**Prerequisites:** S-02, S-03, S-04 i S-05 w kodzie (są). Brak zależności zewnętrznych.
**Estimated effort:** jedna sesja; faza 1 to ~4 punkty w dwóch plikach, faza 2 ~4 w czterech.

## Open Risks & Assumptions

- **Nieudany auto-zapis nie ma ścieżki ponowienia jednym kliknięciem** — ryzyko przyjęte świadomie
  przez usera. Jedynym sygnałem jest trwały baner; jeśli MG skończy poprawiać przy zablokowanej
  pamięci, praca zostaje poza biblioteką.
- **Znika moment zatwierdzenia** — literówka w cenie nadpisuje zapisany rekord natychmiast, bez
  cofania. Świadomy koszt wybranego modelu.
- **Zakłada się, że `id` transientu równe `id` rekordu z biblioteki oznacza „otwarty".** Wniosek
  jest poprawny dopóki `promoteTransient` bije nowe `id` — gdyby to kiedyś zmienić, reguła
  zaczyna błędnie wiązać rekordy.
- **Ta zmiana wycofuje dwie świadome decyzje z S-02 i S-04.** Udokumentowane, żeby nie wróciły
  jako „zgubiona funkcja".

## Success Criteria (Summary)

- Poprawiona cena u kupca z biblioteki jest tam po ponownym otwarciu — bez żadnego kliknięcia
- Duplikat nie powstaje żadną ścieżką, także po przeładowaniu
- Dialog o odrzuceniu korekt pojawia się wyłącznie wtedy, gdy praca naprawdę zginie
