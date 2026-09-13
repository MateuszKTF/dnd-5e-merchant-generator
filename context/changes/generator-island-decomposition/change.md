---
change_id: generator-island-decomposition
title: "Czyste reguły uwięzione w MerchantGenerator.tsx"
status: preparing
created: 2026-09-14
updated: 2026-09-14
archived_at: null
---

## Notes

Pytanie wyjściowe brzmiało „1694 linie — co wyciągnąć do `src/lib`", ale miara była zła:
połowa pliku to komentarze dokumentacyjne, a kodu jest 694 linie.

Prawdziwy problem jest inny i węższy — dziewięć czystych funkcji domenowych mieszka
w `.tsx`, gdzie `vitest` ich nie widzi. Zob. `research.md`.

Powiązane: `context/changes/storage-layer-consistency-audit/research.md`.
