---
date: 2026-09-14T00:45:12+02:00
researcher: Mateusz Kotowicz
git_commit: c7ab09ab71e54f7918c1e9e521257f50c952264e
branch: review/impl-review-triage
repository: dnd-5e-merchant-generator
permalink_base: https://github.com/MateuszKTF/dnd-5e-merchant-generator/blob/c7ab09ab71e54f7918c1e9e521257f50c952264e
topic: "Rozjazdy i powielone strażniki w warstwie zapisu zbudowanej jako cztery osobne zmiany"
tags: [research, codebase, merchant-storage, merchant-session, merchant-library, persistence, guardrail]
status: complete
last_updated: 2026-09-14
last_updated_by: Mateusz Kotowicz
---

# Research: Rozjazdy i powielone strażniki w warstwie zapisu

**Date**: 2026-09-14T00:45:12+02:00
**Researcher**: Mateusz Kotowicz
**Git Commit**: `c7ab09a`
**Branch**: `review/impl-review-triage`
**Repository**: dnd-5e-merchant-generator

## Research Question

> Warstwa zapisu powstała jako 4 osobne zmiany bez wspólnego researchu — znajdź rozjazdy
> i powielone guardy między `merchant-storage.ts`, `merchant-session.ts` i `merchant-library.ts`.

Zakres rozszerzony o konsumentów (`MerchantGenerator.tsx`, `MerchantLibrary.tsx`,
`StorageNotice.tsx`) — decyzja podjęta przy starcie i odnotowana tutaj, bo powielone
strażniki i rozjazd między statusem zapisu a stanem przycisku żyją właśnie na tej granicy.

Metoda: cztery równoległe sub-agenty (konsumenci / moduły `src/lib` / testy / plany i review)
plus pełny odczyt trzech nazwanych plików w kontekście głównym. Agent testowy weryfikował
tezy **mutacjami** — 23 zasadzone mutanty przeciw prawdziwemu zestawowi testów (366 testów,
7 plików, wszystkie zielone na wejściu).

## Summary

**Warstwa jest w znacznie lepszym stanie, niż sugeruje jej historia.** Hipoteza „cztery zmiany
bez wspólnego researchu musiały się rozjechać" w większości się **nie potwierdziła**: powielone
strażniki istnieją, ale są świadome, udokumentowane i zgodne — `impl-review` F-01 Faza 2
rozstrzygnął to wprost i zostawił je celowo. Zestaw testów `src/lib` jest mocny: **21 z 23
mutantów zabitych**, żaden z sześciu testów ścieżek awaryjnych nie okazał się pusty.

Prawdziwy dryf jest gdzie indziej — **w szwach, których proces review strukturalnie nie widzi**:

1. **Jeden realny defekt** w normalizacji nazw, w zasięgu guardraila PRD (F1).
2. **Dwie pozostałości wewnątrz przyjętych kompromisów** — decyzje były słuszne, ale mechanizm,
   który miał je uczynić bezpiecznymi, w konkretnej ścieżce nie odpala (F2, F3).
3. **Jeden test typu L-03** — deklaruje w komentarzu, że pilnuje niezmiennika międzymodułowego,
   i strukturalnie nie może go zaobserwować (F4).
4. **2 979 linii `.tsx`** — całe mapowanie statusów, nasłuch cross-tab i relink po zapisie —
   siedzi za globem, który wygląda jak zielony zestaw testów i nie pokrywa z tego nic (F11).

Ostatni punkt to powtórka **L-04** w innym przebraniu: tam bramka a11y wyglądała na włączoną
i nie obejmowała `.tsx`; tutaj bramka testowa wygląda na zieloną i nie obejmuje `.tsx`.
Ta sama luka, oglądana dwa razy.

**Werdykt dla M-1:** F1 warto domknąć przed zamknięciem kamienia milowego — jest tani i dotyka
guardraila. F2–F4 to jedna sesja triage. Reszta to dług do nazwania, nie do naprawy teraz.

## Detailed Findings

### F1 — `normalizeName` przepuszcza niewidzialne znaki, które `normalizeForSearch` usuwa

**Nowe. Najpoważniejsze znalezisko w tym audycie.**

`merchant-library.ts` trzyma trzy klasy znaków i one się nie pokrywają:

| Stała | Wzorzec | Ścieżka |
| --- | --- | --- |
| `INVISIBLE_NAME_CHARS` (`:43`) | `U+200B`, `U+200C`, `U+FEFF` | zapis |
| `BLANK_NAME` (`:68`) | `\s` + `U+200D` | strażnik pustki |
| `FORMAT_CHARS` (`:67`) | cała kategoria `\p{Cf}` | wyszukiwanie |

`FORMAT_CHARS` obejmuje `U+00AD`, `U+200B`–`U+200F`, `U+2060`, `U+2066`–`U+2069`, `U+FEFF`.
`normalizeName` (`merchant-library.ts:143-164`) usuwa z tego **trzy**, `BLANK_NAME` łapie
czwarty. **`U+00AD`, `U+2060`, `U+200E`, `U+200F`, `U+2066`–`U+2069` przechodzą nietknięte.**

Prześledzone dla `U+00AD` (miękki dywiz):

```
normalizeName("­")
  -> INVISIBLE_NAME_CHARS nie trafia
  -> /\s+/u nie trafia (to Cf, nie whitespace)
  -> String.trim() nie usuwa
  -> BLANK_NAME nie trafia
  -> zwraca "­"   <-- trafia do renameMerchant i zostaje zapisane
```

`normalizeForSearch("­")` zwraca `""`. Efekt: **wiersz renderuje się pusty**
(`MerchantLibrary.tsx:374`, `:442`) i jest nieodnajdywalny po nazwie — zostaje tylko etykieta
kategorii (`matchesQuery`, `merchant-library.ts:325-327`).

To jest **dokładnie ta strata, przed którą `INVISIBLE_NAME_CHARS` został napisany**. Jego własny
docblock (`:36-40`) mówi: *„without this a name pasted as nothing but invisibles passes the blank
guard, reaches `renameMerchant`, and leaves a row that renders with no name at all across every
reload."* A docblock `FORMAT_CHARS` 150 linii niżej (`:53-55`) nazywa źródło po imieniu:
*„Word, PDFs and hyphenating browsers emit U+00AD."*

Jedna funkcja w tym pliku wie, skąd biorą się miękkie dywizy we wklejanych notatkach z sesji.
Funkcja powyżej nie wie. Żadne review nigdy tego nie podniosło.

**Naprawa jest jednoliniowa:** użyć `FORMAT_CHARS` (minus `U+200D`, nośny w sekwencjach emoji)
w `normalizeName`. Obie klasy istnieją w tym samym pliku.

### F2 — zatrzask zaskoczony wewnątrz zapisu nigdy nie wyłącza trwałości i jest błędnie etykietowany

**Pozostałość wewnątrz przyjętego kompromisu — nie re-litygacja decyzji.**

Historia: `saved-merchants-library/reviews/impl-review-phase-2.md:60-110` F1 CRITICAL —
*„A `read-only` write failure is completely silent"* — naprawione przez `raiseWriteFailure`.
Fix B (wyłączanie trwałości) **odrzucony świadomie**, bo *„`stood-down` is absorbing, so it kills
the button for the rest of the page load."* Ta decyzja jest słuszna i jej nie podważam.

Residuum: `loadForWrite` zwija `future-version`, `needs-migration`, `unreadable` i `read-only`
w **jeden** status zapisu `read-only` (`merchant-storage.ts:568-576`). Dokument z nowszej wersji,
pojawiający się w trakcie sesji, jest więc wykrywany przez `readDocument` **wewnątrz**
`putTransient` (`merchant-storage.ts:461-463` zatrzaskuje, `:570-576` zwraca `read-only`),
trafia do `raiseWriteFailure("read-only")` i — przy braku stojącego warunku — podnosi
**`"unavailable"`** (`MerchantGenerator.tsx:361-364`).

Skutek: jedyny status, o którym docblock biblioteki mówi wprost, że **musi** wyłączyć trwałość
(`merchant-session.ts:131-134`), zostawia przycisk `armed`, a MG czyta „dane witryny są wyłączone"
zamiast „twój dokument należy do nowszej wersji".

Komponent **wie**, że zatrzask może zaskoczyć wewnątrz zapisu — mówi to dosłownie
w `MerchantGenerator.tsx:345-352` — ale żadna ścieżka zapisu nie wysyła `persistence-off`.
Jedynym nadawcą jest `handleFailedRead` (`:514-522`), czyli ścieżka odczytu.

W scenariuszu cross-tab nasłuch `storage` (`:680`) zwykle wygrywa wyścig i wyłącza poprawnie,
więc dziura jest osiągalna głównie tam, gdzie odczyt własny zapisu widzi nowszy dokument jako pierwszy.

### F3 — po odczycie `read-only` naciśnięcie Zapisz nie zmienia w DOM niczego

**Druga pozostałość tego samego kompromisu.**

`readDocument` zatrzaskuje na gałęzi `read-only` (`merchant-storage.ts:492-500`), zatrzask jest
modułowy i nigdy nie czyszczony w kodzie aplikacji, więc każdy późniejszy zapis wraca `read-only`
przez pierwszą linię `loadForWrite` (`:553-556`).

Komponent mimo to zostawia przycisk uzbrojony (`MerchantGenerator.tsx:584-593`), z uzasadnieniem:
*„The GM presses Save, the write fails, and the failure names something they can act on."*

Prześledzone do końca — to się nie dzieje:

```
Zapisz -> addMerchant :986 -> persist :877 putTransient -> read-only
       -> raiseWriteFailure("read-only") :896
       -> :363 znajduje "unavailable" juz w conditions (podniesione na :593)
       -> zwraca current BEZ ZMIAN
       -> handleSave :955 wysyla promote-failed -> z powrotem armed
```

**Netto zero zmian w DOM.** Region `sr-only` (`:1631-1633`) odzywa się tylko przy
`state === "saved"`, więc użytkownik czytnika ekranu nie dostaje nic.

Copy jest przy tym nietrafne: `StorageNotice.tsx:54-55` mówi *„Zapisywanie jest wyłączone
w tej przeglądarce"*, bez wzmianki o przeładowaniu — w przeciwieństwie do `unreadable`
(`StorageNotice.tsx:78-79`): *„Nic nie zostanie zapisane do czasu odświeżenia strony"*.
Dla trybu prywatnego Safari lekarstwem nie jest „włącz dane witryny", tylko wyjście z trybu
prywatnego i przeładowanie.

### F4 — test deklaruje niezmiennik międzymodułowy, którego nie może zaobserwować (L-03)

`merchant-session.ts:351-356` opiera poprawność `openedSavedIdFor` na zachowaniu innego modułu:
*„`promoteTransient` always mints a **fresh** id… The inference is not a heuristic — it is sound
for exactly as long as promote keeps minting, which is why this comment names that dependency out loud."*

`merchant-session.test.ts:624-634` twierdzi, że tego pilnuje (`:628-629`): *„If this ever starts
returning the id, promote stopped minting and the whole inference underneath this function is unsound."*

**To nieprawda.** Test nigdy nie wywołuje `promoteTransient` — buduje ręcznie
`merchant({ id: "m-old" })` i `merchant({ id: "m-new" })` z identyfikatorami, które sam wybrał.

Dowód mutacją: `merchant-storage.ts:642` `id: newMerchantId()` → `id: transient.id`.
Zabiło dwa testy, **oba w `merchant-storage.test.ts`** (`:125`, `:153`).
`merchant-session.test.ts` pozostał **w całości zielony**.

Niezmiennik przeżywa więc dzięki zbiegowi okoliczności dwóch niezależnych zestawów, nie dzięki
powiązaniu. Prawdziwy test musiałby zaimportować `promoteTransient`, wywołać go na zasianym
transiencie i sprawdzić `openedSavedIdFor(readDocument(store).doc) === null`.

### F5 — docblock `toStoredCorrections` opisuje zachowanie, którego nie ma

`merchant.ts:291-296` obiecuje: *„An entry that is present but empty is dropped for the same reason."*

Kod (`:299-313`) pomija tylko wartości falsy (`if (!correction) continue`). `{}` i
`{quantity: undefined}` są truthy, więc `stored[itemId] = {}` **zostaje zapisane**.
`fromStoredCorrections` (`:325-339`) ma tę samą strukturę i tę samą lukę.

Konsekwencja sięga dalej, niż wygląda: pusty wpis liczy się do `Object.keys(a.corrections).length`
w `sameStoredWork` (`merchant-session.ts:379-381`), więc pusty wpis obecny po jednej stronie
i nieobecny po drugiej sprawia, że rekord czyta się jako rozjechany — i `openedSavedIdFor` zwraca
`null` nad rekordem, który jest otwarty.

Osiągalność ze ścieżki UI: **nieustalona**. Osiągalność z dokumentu edytowanego ręcznie lub
forward-only wynika z argumentacji samego `corrections.ts:134-139`.

### F6 — `savedAt`: jeden typ na dwa stany o wykluczających się niezmiennikach

**Strukturalne, nie defekt — ale to źródło czterech martwych gałęzi.**

`Merchant.savedAt: string | null` (`merchant.ts:85`), docblock (`:75-77`): *„`null` for the
transient last-generated merchant, set when the GM explicitly saves."*

Cztery miejsca zapisu, dwie rozłączne populacje:

| Miejsce | Wartość | Populacja |
| --- | --- | --- |
| `MerchantGenerator.tsx:869-870` | `savedAt: null` na sztywno | transient — **zawsze null** |
| `merchant-storage.ts:640-644` | `new Date().toISOString()` | trwała — **zawsze string** |
| `merchant-storage.ts:688-691` | `new Date().toISOString()` | trwała — odświeżane |
| `MerchantGenerator.tsx:1103-1104` | `new Date().toISOString()` | trwała, lustro w stanie Reacta |

`StorageDocument.transient` i `StorageDocument.saved` (`merchant-storage.ts:52-56`) używają
**tego samego typu** dla obu. Typ wyraża sumę, nie rozróżnienie — więc każdy konsument rekordu
trwałego musi obsłużyć `null`, który nie może wystąpić:

- `merchant-library.ts:202-203` — `?? null` broni przed `undefined`, które `isMerchant`
  (`merchant.ts:139`) już odrzuca, a `salvage` (`merchant-storage.ts:328`) już usuwa cały rekord
- `merchant-library.ts:374-377` — `if (iso === null) return null`
- `merchant-library.ts:231-232` — `savedAtLabel: string | null` propaguje fałszywą opcjonalność
- `MerchantLibrary.tsx:374` — `?? "brak daty"`

Para `TransientMerchant = Merchant & { savedAt: null }` / `SavedMerchant = Merchant & { savedAt: string }`
uczyniłaby dwie pierwsze gałęzie martwym kodem **w czasie kompilacji**.

### F7 — trzy niezależne polityki „czy to ta sama praca", i one się nie zgadzają

| Gdzie | Polityka |
| --- | --- |
| `sameStoredWork` (`merchant-session.ts:366-389`) | surowy `===` na floatach, wrażliwy na kolejność wierszy, tolerancyjny na `undefined` |
| `isCorrected` (`corrections.ts:111-123`) | porównanie **na siatce grosza** (`toCopper`), wartości filtrowane przez `isOverride` |
| bajty `JSON.stringify` (`MerchantGenerator.tsx:616`, `:878-890`) | równość bajtowa całego `Merchant`, wrażliwa na kolejność kluczy |

Rozjazd nie jest teoretyczny. `corrections.ts:66-74` formułuje regułę wprost: *„Comparing raw
floats would leave a reverted edit dirty forever — 0.5 gp typed back as `5 sp` is not bit-identical
to the value it came from."* `sameStoredWork` porównuje surowe floaty — i właśnie ono bramkuje
wynik `openedSavedIdFor` (`merchant-session.ts:412`).

Dwie wartości `priceGp` różne o 1e-15 — dokładnie to, co produkuje `0.505` vs `5.05/10` — są
**równe** dla `isCorrected` i **różne** dla `sameStoredWork`.

Kierunek awarii jest bezpieczny (rekord czyta się jako rozjechany, więc strażnik i przycisk się
uzbrajają), ale MG dostaje fałszywy stan „twoja praca jest tylko na ekranie" nad rekordem, który
jest w bibliotece.

Druga oś: `isOverride` odrzuca `NaN`, `sameStoredWork` nie. `NaN === NaN` to `false`, więc dwa
bajtowo identyczne dokumenty czytają się jako różna praca — **trwale, bez edycji, która by to wyczyściła**.

### F8 — awaryjna etykieta kategorii czyni kupca nieodnajdywalnym

`autoName` (`merchant.ts:237`) i `categoryLabelFor` (`merchant-library.ts:268-270`) mają **znak
w znak ten sam** wyraz awaryjny — deklaracja „exactly as `autoName` does" (`merchant-library.ts:243`)
jest **zweryfikowana i prawdziwa**.

Ale `matchesQuery` przeszukuje `normalizeForSearch(categoryLabel)` (`merchant-library.ts:326`).
Dla znanej kategorii to `"przedmioty magiczne"`; dla awaryjnego surowego id — `"przedmioty-magiczne"`.
`normalizeForSearch` zwija `\s+` (`:303`), ale **nigdy nie rusza myślnika**.

Wpisanie `przedmioty magiczne` znajduje kupca o znanej kategorii i **po cichu nie znajduje** tego
samego kupca, gdy kategoria przestała być znana tej wersji. Awaryjna etykieta została zaprojektowana,
żeby kupiec pozostał **rozpoznawalny** — czyni go **nieodnajdywalnym**.

Drugi, łagodniejszy skutek: `autoName` zamraża etykietę w chwili utworzenia, `categoryLabelFor`
liczy ją na żywo. Ten sam wiersz może więc pokazywać `"Kowal — 11.09.2026"` w nazwie i surowe
`"kowal"` w etykiecie kategorii — oba w jednym `aria-label` (`MerchantLibrary.tsx:374`).

### F9 — komentarz o konsolidacji strażników jest nieaktualny w połowie

`merchant.ts:113-120` twierdzi w czasie przeszłym: *„Two downstream modules had each re-derived
a partial version of this check — `restoreFromMerchant` and the library's row summary both guard
`Array.isArray(merchant.rows)`."*

`restoreFromMerchant` **został** przeniesiony na `isMerchant` (`merchant-session.ts:93`).
`merchant-library.ts:255` **nie został** — wciąż ma `Array.isArray(merchant.rows) ? … : 0`,
strażnika ściśle słabszego niż `isMerchant`, który już przebiegł; gałąź `: 0` jest nieosiągalna.

To nie defekt, tylko nieaktualny komentarz w module ogłaszającym się właścicielem kształtu.

### F10 — `writeDocument` obiecuje honorować zatrzask i nikt tego nie przypina

Mutant: uczynić sprawdzenie zatrzasku w `writeDocument` samo-czyszczącym (`merchant-storage.ts:521-523`).
**Wszystkie 366 testów przeszło.**

Wewnątrz modułu to prawie równoważne — `save()` dociera do `writeDocument` dopiero po tym, jak
`loadForWrite` już sprawdził zatrzask. Ale `writeDocument` jest **eksportowany** (`:520`), a jego
docblock (`:517-518`) obiecuje wprost *„It still honours the read-only latch"*. Tej obietnicy nic nie pilnuje.

### F11 — 2 979 linii za globem, który wygląda na zieloną bramkę (L-04 w drugim przebraniu)

`vitest.config.ts:23` — `include: ["src/**/*.test.ts"]`. `vitest.config.ts:18` — `environment: "node"`.
Zero jsdom, zero `@testing-library`, **zero klucza `coverage`** gdziekolwiek — więc nie istnieje
raport pokrycia, który by to uwidocznił.

Deklaracje w docblockach `src/lib` (*„globs `.ts` only and runs without jsdom"*) są **prawdziwe,
nie aspiracyjne**:

| Plik | Linie | Pokrycie |
| --- | --- | --- |
| `MerchantGenerator.tsx` | 1694 | zero |
| `MerchantLibrary.tsx` | 462 | zero |
| `StorageNotice.tsx` | 185 | zero |
| pozostałe `.tsx` + `.astro` | 638 | zero |

Co konkretnie siedzi w tej strefie: całe mapowanie statusów magazynu na komunikaty, nasłuch
cross-tab (`MerchantGenerator.tsx:660-790`), efekt przywracania na mount (`:573-646`), relink po
`promoteTransient` (`:975-1038`), polityka standing-vs-episodic (`StorageNotice.tsx:101-132`),
strażnik no-op przy zmianie nazwy (`MerchantLibrary.tsx:272` — `renameMerchant` takiego nie ma,
więc ten niezmiennik istnieje **wyłącznie** w nietestowanym pliku).

Dwa komentarze w `.tsx` mówią to na głos: `MerchantLibrary.tsx:160-168` (*„nothing in CI can catch
this (L-04)"*) i `StorageNotice.tsx:166-167`.

Bramka `npm run typecheck` (`ci.yml:25`) sięga `.tsx`, ale jest bramką typów, nie zachowania.

### Czego NIE znaleziono — negatywne wyniki warte odnotowania

- **Powielone `isMerchant` w `merchant-session.ts:93` jest martwe, ale nieszkodliwe i świadome.**
  Prześledzone: każdy zapis do stanu `saved` pochodzi z odczytu po `salvage`, więc drugie miejsce
  wywołania (`openMerchant`, `MerchantGenerator.tsx:1380`) dostaje dane już zwalidowane.
  `impl-review-phase-2.md:258` rozstrzygnął to celowo: *„they are harmless, and keeping them means
  `merchant-library.ts` and `merchant-session.ts` do not silently depend on the storage boundary
  having validated for them."* **Nie ruszać.**
- **Konsekwencja tej martwoty:** komentarz przy `MerchantGenerator.tsx:1382-1385` opisuje przypadek
  podwójnie nieosiągalny — a rekord z `rows: []` **przechodzi** `isMerchant` (`[].every(…) === true`),
  więc zostałby zaadoptowany, nie pominięty. Komentarz myli się co do zasady.
- **Obie strony porównania w wyszukiwaniu idą przez `normalizeForSearch`** — symetria obiecana
  w docblocku (`merchant-library.ts:279-283`) **trzyma się**.
- **Żaden z sześciu testów ścieżek awaryjnych nie jest pusty.** Każdy status (`quota-exceeded`,
  `unavailable`, `future-version`, `needs-migration`, `unreadable`, `quarantined`) zabił od 1 do 6
  testów pod mutacją. `storage-fake.test-helper.ts` naprawdę potrafi je wyprodukować.
- **`resetReadOnlyLatch` jest nośny, nie dekoracyjny.** Uczyniony no-opem → **26 z 366 testów padło**.
  Ostrzeżenie w komentarzu o zależności od kolejności jest realne i żywe.
- **Ścieżka awaryjna nieznanej kategorii jest czysta.** Żadne review nigdy nie podniosło przeciw niej
  defektu; `category: 42` i `wealth: {}` degradują się poprawnie.
- **Wszystkie trzy żywe miejsca odczytu obsługują `read-only` razem z `ok`.** Błąd znikającej
  biblioteki w trybie prywatnym Safari **nie występuje** na powierzchni, której produkt używa.

### Martwy kod

`listSaved` (`merchant-storage.ts:723-741`) **nie ma żadnego wywołania w aplikacji** — tylko
w testach. `MerchantGenerator.tsx` sięga po listę przez `readDocument().doc.saved` (`:607`),
z uzasadnieniem w prozie (`:317`, `:604`). Komentarz przy `listSaved` o „jednej z dwóch powierzchni
odczytu" jest więc dziś nieaktualny w odwrotną stronę: naprawiona powierzchnia to ta nieużywana.

## Code References

Wszystkie linki wskazują commit `c7ab09a` (wypchnięty na `origin/review/impl-review-triage`).
Baza: `https://github.com/MateuszKTF/dnd-5e-merchant-generator/blob/c7ab09ab71e54f7918c1e9e521257f50c952264e`

- `src/lib/merchant-library.ts:43` — `INVISIBLE_NAME_CHARS`, trzy znaki (F1)
- `src/lib/merchant-library.ts:67` — `FORMAT_CHARS`, cała kategoria `\p{Cf}` (F1)
- `src/lib/merchant-library.ts:143-164` — `normalizeName`, ścieżka zapisu (F1)
- `src/lib/merchant-storage.ts:568-576` — `loadForWrite` zwija cztery statusy w jeden (F2)
- `src/components/MerchantGenerator.tsx:359-372` — `raiseWriteFailure`, deduplikacja gasząca komunikat (F2, F3)
- `src/components/MerchantGenerator.tsx:514-522` — `handleFailedRead`, jedyny nadawca `persistence-off` (F2)
- `src/components/MerchantGenerator.tsx:584-593` — decyzja „nie wyłączaj trwałości na `read-only`" (F3)
- `src/lib/merchant-session.test.ts:624-634` — test, który nie może zaobserwować tego, co deklaruje (F4)
- `src/lib/merchant.ts:291-313` — `toStoredCorrections`, docblock vs kod (F5)
- `src/lib/merchant.ts:79-88` — `Merchant`, jeden typ na dwa stany (F6)
- `src/lib/merchant-session.ts:366-389` — `sameStoredWork`, surowe floaty (F7)
- `src/lib/corrections.ts:111-123` — `isCorrected`, siatka grosza (F7)
- `src/lib/merchant-library.ts:292-306` — `normalizeForSearch`, nie rusza myślnika (F8)
- `src/lib/merchant-library.ts:255` — nieskonsolidowana połowa strażnika (F9)
- `src/lib/merchant-storage.ts:520-523` — `writeDocument`, nieprzypięta obietnica (F10)
- `vitest.config.ts:23` — glob, który wyklucza cały UI (F11)

## Architecture Insights

**Granice własności są wyjątkowo dobrze utrzymane.** F-01 ogłasza się jedynym właścicielem formatu
(`merchant-storage-contract/plan.md:112-116`) i **żadna z czterech późniejszych zmian nie edytowała
tego modułu**. S-05 wprost odrzucił Fix B właśnie z tego powodu
(`merchant-search-and-delete/reviews/impl-review-phase-1.md:88`). To rzadkie i warte zachowania.

**Wzorzec, który się sprawdził:** F-01 dostarczył *kompletne* API — `renameMerchant`,
`updateSavedMerchant`, `deleteMerchant` bez ani jednego wywołania w chwili powstania — po to, żeby
późniejsze slice'y konsumowały zamiast dopisywać. Zadziałało.

**Wzorzec, który zawiódł:** niezmienniki międzymodułowe są trzymane **prozą**. Naliczono dziewięć
zależności kształtu „poprawność A zależy od zachowania B, stwierdzona w komentarzu". Istnieje
dokładnie **jeden** kontrprzykład egzekwowany mechanicznie — asercja
`MutuallyAssignable<StoredRow, AssortmentRow>` w `merchant.test.ts:24, 67-68`, sama powstała
z ustalenia review (`merchant-storage-contract/reviews/plan-review.md:99-114` F4). Każdy
z pozostałych dziewięciu mógł dostać to samo potraktowanie i nie dostał.

**Zatrzask read-only ma trzech niezależnych właścicieli list.** `merchant-storage.ts` ustawia
`readOnly` w siedmiu miejscach; `merchant-session.ts:131-143` opisuje regułę prozą;
`MerchantGenerator.tsx:190-192` i `:518` trzymają ręcznie utrzymywane lustro tej samej trójki.
Czwarty status zatrzaskujący wymagałby edycji w czterech miejscach i **nic by się nie wysypało
przy kompilacji**. To najpoważniejszy dług strukturalny w tej warstwie.

**Granica recoverability jest trudna i była mylona trzy razy.**
`last-merchant-persists/reviews/impl-review-phase-3.md:23` mówi wprost: *„This is the same
recoverability boundary got wrong for the third time in two days."* F2 i F3 są czwartym i piątym
wystąpieniem — tym razem nie w regule, tylko w tym, czy mechanizm egzekwuje ją na każdej ścieżce.

## Historical Context (from prior changes)

Przeskanowano komplet `plan.md`, `plan-brief.md` i `reviews/*` sześciu zmian. **Szesnaście świadomie
przyjętych ograniczeń** — nie są znaleziskami i nie należy ich ponownie zgłaszać. Najważniejsze:

- `merchant-storage-contract/plan.md:409-410` — kwarantanny nigdy nie są odzyskiwane, akumulacja przyjęta
- `merchant-storage-contract/plan.md:571-576` — `localStorage` blokuje wątek główny, *„but it is the
  real ceiling on this design"*
- `merchant-storage-contract/reviews/impl-review-phase-2.md:296` — luka read-modify-write między
  procesami *„cannot be closed with `localStorage` alone… Recorded as an accepted risk, not a fix"*
- `merchant-storage-contract/reviews/impl-review-phase-2.md:258` — **powielone strażniki zostawione
  celowo**; bezpośrednia odpowiedź na pytanie badawcze tego dokumentu
- `corrections-autosave/change.md:31-33` — znika moment zatwierdzenia, bez cofania i bez kosza;
  *„User zna ten koszt i go akceptuje"*
- `manual-item-corrections/plan.md:173-183` — ścieżka cross-tab nie jest bramkowana dialogiem;
  jedyne świadome wyłączenie z „każdej ścieżki"
- `last-merchant-persists/reviews/impl-review-phase-2.md:68` — *„the island is covered by exactly zero
  automated tests and always will be under this config"* (F11 był znany)

**Jedno ograniczenie zostało odwrócone i to jest istotne dla czytania kodu dziś:** brak trwałości
`openedSavedId` był przyjęty przy S-04 i *„właśnie okazał się nieakceptowalny w praktyce"*
(`corrections-autosave/change.md:26-27`). Zastąpiła go derywacja bez zmiany schematu —
`openedSavedIdFor` — czyli dokładnie ta funkcja, której niezmiennik nie jest przypięty testem (F4).

**Znaleziska review dotykające tych samych tematów:** siedem wcześniejszych ustaleń o zatrzasku
read-only, siedem o `persistence-off`, pięć o `dropped`/`salvage` — **wszystkie naprawione**.
Cztery ustalenia świadomie pominięte pozostają otwarte, w tym
`merchant-search-and-delete/reviews/impl-review-phase-2.md:197` F6 (stare zapytanie przeżywa
usunięcie wszystkich kupców) oraz F7 i F8, o których triage mówi: *„each a one-line change and are
the cheapest things left on this change if it is revisited."*

**Uwaga metodologiczna.** Wszystkie plany cytują `AGENTS.md:15` dla reguły forward-only i
`AGENTS.md:42` dla konwencji nazw. Na HEAD te reguły są w liniach **16** i **45** — plik przesunął
się o jedną i trzy linie. Ponadto `AGENTS.md` **nie zawiera** reguły „podbij wersję schematu dopiero
po napisaniu migracji"; to derywacja na poziomie planu (`merchant-storage-contract/plan.md:586-588`),
utwardzona w kodzie jako status `needs-migration`.

## Related Research

- `context/changes/generator-island-decomposition/research.md` — dziewięć czystych reguł uwięzionych
  w `.tsx`; F11 tutaj jest jego przyczyną strukturalną
- `context/changes/srd-52-catalog-migration/research.md` — denormalizacja `StoredRow` i dlaczego
  migracja katalogu nie dotyka storage
- `context/changes/cloud-sync-readiness/research.md` — `StorageLike` jako szew pod `localStorage`,
  nie pod trwałością
- `context/changes/item-name-localization/research.md` — nazwy pozycji: gdzie trafiają i czym nie są

Żaden `research.md` nie istniał przed 2026-09-14; `context/archive/` zawiera wyłącznie `README.md`.

## Open Questions

1. **Czy pusty wpis korekty `{}` jest osiągalny ze ścieżki UI?** (F5) Nieustalone. `handleCorrect`
   zawsze scala niepusty patch, ale `parseDraft` i ścieżka blur nie zostały prześledzone do końca.
2. **Czy `assortment.ts` faktycznie gwarantuje unikalność `itemId`?** `corrections.ts:31-33` opiera
   na tym kluczowanie `CorrectionMap` i ostrzega: *„If that guarantee ever weakens, corrections start
   leaking between rows with no visible symptom."* Nie zweryfikowane.
3. **Czy strażnik `restoreFromMerchant` miał pokryć przyszłe miejsce wywołania** (import, wklejanie)?
   Dziś takiego nie ma. Jeśli nie — komentarz uzasadniający powinien się zmienić razem z faktem.
4. **Ile z trzydziestu kilku niezweryfikowanych ręcznych kryteriów** (F-01 wiersze 1.5–1.6, 2.5–2.7,
   3.5–3.8; S-03 wiersze 1.5–1.6, 2.6–2.12, 3.5–3.14) **opisuje jeszcze aktualne zachowanie?**
   `merchant-storage-contract/reviews/impl-review-phase-3.md:29-30` ostrzega, że kilka już nie —
   a to jedyna bramka, jaką ma warstwa `.tsx`.
