---
change_id: saved-merchants-library
title: "Lista zapisanych kupców: auto-nazwa, zmiana nazwy, otwieranie"
status: impl_reviewed
created: 2026-09-11
updated: 2026-09-13
archived_at: null
---

## Notes

GitHub #5  @context/foundation/roadmap.md

## Uwaga do weryfikacji ręcznej (2026-09-12)

Wiersze **2.9**, **3.8** i **3.9** opisują zachowanie, którego w chwili
weryfikacji już nie było — zastąpiła je zmiana `corrections-autosave`
(commity `c511e47`, `e5575a0`):

- **2.9** „otwarcie z korektami pyta o potwierdzenie" — dialog odpala teraz
  wyłącznie dla kupca spoza biblioteki, bo dla otwartego rekordu nie ma czego
  stracić. Predykat: `wouldLoseCorrections`.
- **3.8** „Zapisz zmiany aktualizuje w miejscu" — przycisk przy otwartym
  rekordzie nie istnieje; korekta zapisuje się sama.
- **3.9** „etykieta mówi, czy zaktualizuje czy doda" — etykieta ma już tylko
  jeden wariant, bo przycisk pokazuje się tylko dla kupca spoza biblioteki.

Odhaczone jako domknięte, nie jako zweryfikowane w oryginalnym brzmieniu.
Zachowanie, które je zastąpiło, zostało sprawdzone pod wierszami
`corrections-autosave` 1.6–1.12 i 2.5–2.11.
