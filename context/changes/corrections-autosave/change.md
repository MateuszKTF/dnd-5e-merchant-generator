---
change_id: corrections-autosave
title: Korekty zapisują się same, bez tworzenia duplikatu
status: implemented
created: 2026-09-12
updated: 2026-09-12
archived_at: null
---

## Notes

Wyszło z weryfikacji ręcznej S-04 i S-05 (2026-09-12). Dwie sprawy o różnych
przyczynach, domykane razem, bo user widzi je jako jeden objaw: „zmieniam cenę
albo ilość i to nie zostaje".

**1. Błąd.** `PriceQuantityCell` zatwierdza edycję wyłącznie na `blur` i Enter.
F5 z kursorem wciąż w polu nie wywołuje `blur`, więc `handleCorrect` nigdy się
nie wykonuje i nie ma czego zapisać. Wartość widać w tabeli tylko dlatego, że
to lokalny `draft`. Komentarz w `persist` (`MerchantGenerator.tsx`) twierdzi, że
broni przypadku „mobile OS ubija kartę w tle" — nie broni, z tego samego powodu.

**2. Zmiana zaprojektowanego zachowania — decyzja usera z 2026-09-12.** Korekta
u kupca otwartego z biblioteki ma lądować w tym samym rekordzie od razu, bez
klikania „Zapisz zmiany". Dziś idzie tylko do slotu transient, a po
przeładowaniu `openedSavedId` przepada i Zapisz robi duplikat — to jest ten
„kompletnie nowy sklep". Ograniczenie było świadomie zaakceptowane przy S-04
(Migration Notes) i właśnie okazało się nieakceptowalne w praktyce.

Wybrany wariant (z trzech przedstawionych): auto-zapis w miejscu, pełny.

Świadomie przyjęty koszt: **znika moment zatwierdzenia.** Literówka w cenie
nadpisuje zapisany rekord natychmiast, bez cofania i bez kosza. User zna ten
koszt i go akceptuje.

Odtworzenie „otwartego" po starcie **nie wymaga zmiany schematu**: transient
zapisany przy otwarciu niesie to samo `id` co rekord w bibliotece, a
`promoteTransient` zawsze bije nowe `id` — więc wspólne `id` może znaczyć tylko
„ten transient pochodzi z tego zapisanego rekordu". Reguła forward-only
(`AGENTS.md`) zostaje nietknięta.

Konsekwencja w UI, wynikająca z decyzji, nie doklejona: przycisk Zapisz i treść
dialogu „odrzucić ręczne korekty?" przestają pasować do nowego modelu —
przycisk, który nic nie robi, i ostrzeżenie o stracie, która nie nastąpi.

Termin: 2026-09-13 (PRD `hard_deadline`), czyli jutro.

---

## Uzupełnienie po drugiej turze testów (2026-09-12)

**Diagnoza „niezatwierdzony draft" była BŁĘDNA.** User potwierdza, że poprawiona
komórka *dostaje* bursztynowe podkreślenie, a marker zapala się wyłącznie dla
wartości zatwierdzonej (`isCorrected` porównuje z wygenerowaną; draft nie ma
markera). Czyli `handleCorrect` → `persist` → `putTransient` wykonuje się
normalnie. `commit-on-hide` zostaje w zakresie jako osobna, węższa dziura
(edycja + F5 bez blur), ale **nie jest przyczyną** zgłoszonego objawu — i nie
jest już punktem pierwszym co do wagi.

**Nowy błąd, nieobecny w żadnym planie: dialog ostrzega przed stratą, która nie
nastąpi.** Guard odpala `hasCorrections(rows, corrections)`, czyli pyta „czy ten
kupiec ma jakiekolwiek ręczne poprawki". Powinien pytać „czy zaraz zniknie
praca, której nie da się odzyskać". Dla rekordu, którego korekty są już
utrwalone, poprawna odpowiedź to „nie" — a dialog i tak straszy. Ostrzeżenie,
które kłamie, przestaje działać jako ostrzeżenie: MG nauczy się je odklikiwać i
przegapi ten jeden raz, kiedy naprawdę coś traci. Predykat guardu musi rozróżnić
„ma korekty" od „ma niezapisane korekty".

**Inwersja, którą zauważył user.** Dziś produkt zapisuje sam kupca
jednorazowego (transient), a od tego świadomie zapisanego w bibliotece wymaga
kliknięcia. Odwrotnie, niż podpowiada intuicja — i to jest właściwe uzasadnienie
tej zmiany, mocniejsze niż sama wygoda.

**Do rozstrzygnięcia w planie: semantyka bursztynowego markera.** Dziś znaczy
„różni się od wygenerowanego" i zostaje na zawsze, także po zapisie. User czyta
go jako „niezapisane". Po wejściu auto-zapisu ta lektura staje się wprost
fałszywa. Marker albo zmienia znaczenie na widoczne „ręcznie poprawione" (i nic
w interfejsie nie może już sugerować stanu niezapisanego), albo znika.

**Decyzja usera (2026-09-12): bursztynowy marker znika całkiem.**

To jest świadome wycofanie decyzji S-02, nie przeoczenie. Powód: w tym
interfejsie bursztyn jest też kolorem `StorageNotice`, więc marker czytał się
jako „coś jest nie tak", a po wejściu auto-zapisu lektura „niezapisane" staje
się wprost fałszywa. Przyjęty koszt: znika jedyne miejsce, w którym widać, które
ceny ustawił MG, a które generator — wartość wygenerowana nie jest nigdzie
pokazywana obok skorygowanej, więc tej informacji nie da się odtworzyć.

Marker znika tylko z WARSTWY WIZUALNEJ. Rozdział korekt od wartości
wygenerowanych w magazynie zostaje bez zmian (F-01/S-02) — na nim stoi
`hasCorrections`, a ten jest nadal potrzebny guardowi dla kupca, który nigdy nie
trafił do biblioteki. `isCorrected` przestaje mieć konsumenta w UI, ale nie w
regułach.
