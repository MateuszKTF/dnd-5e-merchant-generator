---
date: 2026-09-14T00:45:12+02:00
researcher: Mateusz Kotowicz
git_commit: c7ab09ab71e54f7918c1e9e521257f50c952264e
branch: review/impl-review-triage
repository: dnd-5e-merchant-generator
permalink_base: https://github.com/MateuszKTF/dnd-5e-merchant-generator/blob/c7ab09ab71e54f7918c1e9e521257f50c952264e
topic: "Ile z deklarowanej ścieżki Supabase istnieje w kodzie i czy StorageLike zniesie backend asynchroniczny"
tags: [research, codebase, supabase, storage-like, v2, cloud-sync, architecture]
status: complete
last_updated: 2026-09-14
last_updated_by: Mateusz Kotowicz
---

# Research: Gotowość do cloud-sync — Supabase i `StorageLike`

**Date**: 2026-09-14T00:45:12+02:00
**Researcher**: Mateusz Kotowicz
**Git Commit**: `c7ab09a`
**Branch**: `review/impl-review-triage`
**Repository**: dnd-5e-merchant-generator

## Research Question

> `tech-stack.md` twierdzi, że Supabase to gotowa ścieżka do v2, ale grep po `src/` nie znajduje
> użycia — sprawdź, co zostało i czy `StorageLike` zniesie backend asynchroniczny.

## Summary

**Zostały trzy paczki npm, lokalny config bez schematu i dwie opcjonalne zmienne środowiskowe.
W `src/` zero.** Deklaracja z `tech-stack.md` nie jest fałszywa, ale jest myląco optymistyczna —
`AGENTS.md` mówi to samo ostrzej i uczciwiej.

**`StorageLike` nie zniesie backendu asynchronicznego** — i to nie jest kwestia sygnatury, którą
da się przepisać. Trzy zachowania warstwy zależą od synchroniczności w sposób, którego podmiana
adaptera nie załatwia; jedno z nich (`pagehide`) jest niemożliwe do odtworzenia po sieci bez
zmiany projektu.

Odpowiedź na pytanie „podmiana adaptera czy przepisanie warstwy" brzmi: **ani jedno**.
`StorageLike` jest szwem **pod `localStorage`**, nie pod trwałością — więc dla v2 to zły szew.
Właściwy leży **nad** publicznym API `merchant-storage.ts`, a sam kontrakt przeżyje port prawie
nietknięty. **Przepisaniem jest mechanizm, nie kontrakt** — to znacznie tańszy wniosek niż
„przepisz warstwę".

## Detailed Findings

### Co zostało — siedem miejsc, zero w `src/`

| Gdzie | Co |
| --- | --- |
| `package.json` | `@supabase/ssr` ^0.10.3, `@supabase/supabase-js` ^2.99.1 (deps), `supabase` ^2.23.4 (devDeps) |
| `supabase/` | tylko `config.toml` i `.gitignore` — **zero migracji, zero schematu** |
| `astro.config.mjs:19-24` | schemat env: `SUPABASE_URL`, `SUPABASE_KEY`, oba `optional: true`, `context: "server"`, `access: "secret"` |
| `.env.example` | dwie linie z `###` |
| `.github/workflows/ci.yml:29-31` | krok `npm run build` dostaje oba sekrety |
| `.astro/env.d.ts` | generowane z `astro.config.mjs` |
| `README.md:73-134` | cały rozdział „Supabase Configuration" |

W `src/` nie ma **nic**: żadnego importu, `src/middleware.ts`, `src/db/` ani `src/pages/api/`.
`src/env.d.ts` mówi to sam:

> *„No `App.Locals` augmentation: v1 has no middleware, no accounts and no server-side session.
> Saved merchants live in browser storage on the GM's device (PRD Access Control).
> Re-add typing here if v2 cloud sync lands."*

### Repozytorium już to rozstrzygnęło — ostrzej niż `tech-stack.md`

`AGENTS.md:5`:

> *„**There is no auth, no server session, and no API route in v1.** The starter's entire auth surface
> was deleted on 2026-09-10 (commit `3c21436`). If a doc, a tutorial, or your own recall mentions
> `src/middleware.ts`, `src/lib/supabase.ts`, `/auth/*`, `/api/auth/*`, `PROTECTED_ROUTES`, or
> `context.locals.user` in this repo — it is describing code that no longer exists."*

`AGENTS.md:9`:

> *„The `@supabase/*` packages are still in `package.json` as the v2 cloud-sync hook, but **nothing
> imports them and nothing should**. Do not reintroduce an auth layer, middleware, or a server session
> to solve a v1 problem."*

Czyli „ready-made path" jest prawdziwe co do **intencji**, a nie co do **zawartości**. Nie ma klienta,
tabel, migracji, typów ani middleware — jest miejsce, w które to wszystko trzeba dopiero włożyć.

### Pułapka dla v2: README kłamie

`README.md` to nadal readme startera i instruuje konfigurację Supabase **Auth** — `npx supabase init`,
`npx supabase start`, tabela `auth.users`, wyłączanie potwierdzeń e-mail. `AGENTS.md:27` ostrzega wprost:

> *„`README.md` is still the upstream **starter template's** readme… It does **not** describe this
> product — do not treat it as a source of truth, and do not follow its Supabase instructions."*

Kto zacznie v2 od README, zbuduje warstwę uwierzytelniania, której PRD nie chce, zamiast synchronizacji
danych, której chce.

### `StorageLike` a backend asynchroniczny — trzy poziomy blokady

#### Poziom 1: typ

```ts
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
```

`merchant-storage.ts:59-63`. Wszystkie trzy synchroniczne; `getItem` zwraca `string | null`,
nie `Promise`. Interfejsu nie da się zaimplementować nad I/O sieciowym.

#### Poziom 2: cały moduł

Grep na `async |await |Promise<` po `src/lib/*.ts` i `src/components/*.tsx` (z pominięciem testów)
zwraca **pustkę**. Osiem publicznych operacji — `readDocument`, `writeDocument`, `putTransient`,
`promoteTransient`, `renameMerchant`, `updateSavedMerchant`, `deleteMerchant`, `listSaved` — wszystkie
synchroniczne, wszystkie oddają unię dyskryminowaną wprost, nie przez `Promise`.

Uczynienie ich asynchronicznymi zmienia **każde** miejsce wywołania w `MerchantGenerator.tsx`.

#### Poziom 3: semantyka — prawdziwy bloker

**a) `pagehide` — nie da się przenieść.**
`MerchantGenerator.tsx` commituje półedytowaną komórkę przez blur przy `pagehide` i
`visibilitychange`, z uzasadnieniem: *„`localStorage` writes synchronously, so the save lands before
the page is gone."* Zapis sieciowy przy `pagehide` **nie ma gwarancji dojścia**. To wymaga innego
projektu — `navigator.sendBeacon`, kolejka offline, albo świadome przyjęcie straty — nie innego adaptera.

**b) `probeWritable` — round-trip na każdy odczyt.**
`merchant-storage.ts:238-247` pisze i kasuje klucz próbny przy **każdym** `readDocument`, bo tryb
prywatny Safari wystawia `localStorage` i rzuca dopiero na `setItem`. Review już to odnotowało:
*„`readDocument` does write on every call via `probeWritable`, so 'a read never mutates the store'
is not true"* (`merchant-storage-contract/reviews/impl-review-phase-2.md:291`).
Po sieci ten sam mechanizm to dodatkowy round-trip przy każdym odczycie.

**c) `loadForWrite` — dwa round-tripy na mutację i szersze okno wyścigu.**
Każda operacja zapisu idzie `loadForWrite` → `save`, *„re-reading immediately before they write so
a change from another tab is never overwritten blind"* (`merchant-storage.ts:508-512`). Po sieci to
dwa round-tripy na mutację, a okno read-modify-write rośnie z mikrosekund do setek milisekund —
czyli dokładnie ta luka, którą review już zapisało jako przyjęte ryzyko:
*„cannot be closed with `localStorage` alone… **Recorded as an accepted risk, not a fix**"*
(`impl-review-phase-2.md:296`).

**d) Zdarzenie `storage` i zatrzask `readOnly` — mechanizmy, nie interfejsy.**
Nasłuch cross-tab (`MerchantGenerator.tsx:660-790`) opiera się na zdarzeniu `storage`, które jest
specyficzne dla `localStorage`. Supabase Realtime to **inny mechanizm**, nie implementacja tego samego
interfejsu. `readOnly` (`merchant-storage.ts:157`) to zmienna modułowa o zasięgu jednego ładowania
strony — dla backendu nie znaczy nic.

### Plan sam nazwał ten sufit

`merchant-storage-contract/plan.md:571-576`:

> *„`localStorage` is synchronous and blocks the main thread, which is the accepted cost of the layout
> chosen for atomicity… That is immaterial at v1 scale and is the explicit trade for atomic writes —
> **but it is the real ceiling on this design**."*

To nie jest odkrycie tego researchu; to ostrzeżenie zapisane przy projektowaniu F-01 i dziś osiągnięte.

### Co przeżyje port, a co nie

**Przeżyje — kontrakt:**

- jeden dokument pod jednym kluczem, zapis atomowy (`merchant-storage.ts:36-50`)
- typowane wyniki zamiast wyjątków — `ReadResult`, `WriteResult`, `MutationResult`, `PromoteResult`,
  `ListResult`. `AGENTS.md:14` wskazuje ten moduł jako wzorzec dla całego repo
- wstrzykiwany magazyn jako parametr, nie globalny
- rozdział `transient` / `saved` i reguła, że tylko `deleteMerchant` usuwa

`ReadResult` i `WriteResult` dostałyby po prostu nowych członków — `offline`, `conflict`, `stale` —
i to jest **rozszerzenie unii**, nie przepisanie.

**Nie przeżyje — mechanizm:** `StorageLike`, `probeWritable`, zatrzask `readOnly`, nasłuch `storage`,
commit przy `pagehide`, synchroniczne przywracanie na mount bez stanu ładowania.

## Code References

Baza: `https://github.com/MateuszKTF/dnd-5e-merchant-generator/blob/c7ab09ab71e54f7918c1e9e521257f50c952264e`

- `src/lib/merchant-storage.ts:59-63` — `StorageLike`, trzy metody synchroniczne
- `src/lib/merchant-storage.ts:238-247` — `probeWritable`, zapis przy każdym odczycie
- `src/lib/merchant-storage.ts:508-512` — `loadForWrite`, re-odczyt przed każdym zapisem
- `src/lib/merchant-storage.ts:157` — zatrzask `readOnly`, zasięg jednego ładowania strony
- `src/components/MerchantGenerator.tsx:660-790` — nasłuch `storage`, mechanizm localStorage
- `src/env.d.ts` — brak `App.Locals`, z adnotacją o v2
- `astro.config.mjs:19-24` — schemat env, oba pola `optional`
- `AGENTS.md:5`, `:9`, `:27` — usunięta powierzchnia auth, zakaz importu, ostrzeżenie o README
- `context/changes/merchant-storage-contract/plan.md:571-576` — „the real ceiling on this design"

## Architecture Insights

**`StorageLike` był szwem testowym, nie szwem portowalności — i to była właściwa decyzja.**
Docblock (`merchant-storage.ts:11-13`) mówi wprost, że istnieje po to, żeby *„turn quota exhaustion,
corruption and version skew into ordinary unit tests instead of manual browser theatre"*. Zadziałał:
audyt testów pokazał, że fake potrafi wyprodukować każdy z sześciu statusów awaryjnych. Zarzut
mógłby paść tylko wtedy, gdyby ktoś obiecywał, że to jest **też** szew na backend — i `tech-stack.md`
podchodzi do tej obietnicy niebezpiecznie blisko.

**Właściwy szew dla v2 leży wyżej.** Publiczne API `merchant-storage.ts` opisuje **intencje**
(„utrwal transient", „promuj", „zmień nazwę", „usuń"), a `StorageLike` opisuje **mechanizm**
(„getItem", „setItem"). Backend podstawia się pod intencje, nie pod mechanizm.

**Trzy paczki nic nie kosztują w bundlu.** Nic ich nie importuje, więc bundler je wycina w całości.
Koszt to czas instalacji i powierzchnia supply-chain, nie rozmiar artefaktu. `AGENTS.md:9` świadomie
każe je zostawić jako zaczep — to rozstrzygnięte, nie do ponownej dyskusji.

## Historical Context (from prior changes)

- `AGENTS.md:5` — cała powierzchnia auth ze startera usunięta 2026-09-10, commit `3c21436`
- `merchant-storage-contract/plan.md:571-576` — synchroniczność jako świadomy koszt i nazwany sufit
- `merchant-storage-contract/reviews/impl-review-phase-2.md:296` — luka read-modify-write między
  procesami jako **przyjęte ryzyko**, nie do naprawy w tej architekturze
- `merchant-storage-contract/plan.md:120`, `last-merchant-persists/plan.md:111` — eksport/import
  i cross-device odłożone do **PRD Open Question #3**, v2
- `context/foundation/tech-stack.md` — źródło badanego twierdzenia; deklaruje też jeden świadomy
  mismatch („the starter bundles Supabase auth and Postgres, which Access Control rules out")

## Related Research

- `context/changes/storage-layer-consistency-audit/research.md` — stan warstwy, którą v2 miałoby
  portować; F6 (`savedAt` jako jeden typ na dwa stany) jest długiem, który przy backendzie zaboli mocniej
- `context/changes/generator-island-decomposition/research.md` — sekwencjonowanie efektów opiera się
  na synchroniczności; port asynchroniczny dotknie tego pliku najmocniej

## Open Questions

1. **Czy v2 to naprawdę cloud-sync, czy wystarczy eksport/import?** PRD Open Question #3 trzyma oba
   razem. Plik `.json` do pobrania rozwiązuje „chcę tego kupca na innym urządzeniu" bez serwera,
   kont i RODO — i jest o rząd wielkości tańszy. Powinien być rozważony jako alternatywa, nie tylko
   jako krok pośredni.
2. **Jak rozwiązać `pagehide` przy backendzie?** To jedyne zachowanie bez oczywistego odpowiednika.
   `sendBeacon`, kolejka offline w IndexedDB z późniejszą synchronizacją, albo świadoma akceptacja
   straty półedytowanej komórki — trzy różne produkty.
3. **Czy `localStorage` zostaje jako cache offline?** Jeśli tak, warstwa nie jest zastępowana, tylko
   dublowana — i pojawia się problem rozstrzygania konfliktów, którego dziś nie ma nigdzie.
4. **Czy Supabase w ogóle jest właściwym wyborem dla v2?** Zaczep istnieje, bo tak zdecydował starter,
   a nie dlatego, że ktoś porównał opcje pod ten konkretny kształt danych (jeden mały dokument
   na użytkownika, bez relacji, bez zapytań). Decyzja nigdy nie była podjęta świadomie — została
   odziedziczona.
