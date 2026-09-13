---
change_id: cloud-sync-readiness
title: "Ile z deklarowanej ścieżki do cloud-sync istnieje naprawdę"
status: preparing
created: 2026-09-14
updated: 2026-09-14
archived_at: null
---

## Notes

`context/foundation/tech-stack.md` zapisuje, że warstwa Supabase „stays unwired in v1
and becomes the ready-made path to the deferred cloud-sync feature in v2".
Research sprawdza, ile z tego jest prawdą w kodzie, i czy `StorageLike` jest właściwym
szwem dla backendu asynchronicznego.

Nie jest. Zob. `research.md`.
