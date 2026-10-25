---
id: TASK-42
title: >-
  Wtyczka: po synchronizacji koligilo uruchom scalanie statystyk i słowniczka
  (opt-in) + ostrzeżenie o braku klucza Rosetty
status: Done
assignee: []
created_date: '2026-10-25 10:50'
updated_date: '2026-10-25 10:52'
labels:
  - ux
  - plugin
dependencies: []
ordinal: 42000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up TASK-40. (1) Opt-in na czytniku (menu wtyczki): po udanej synchronizacji ustawień wtyczka rozsyła ciche zdarzenia SyncBookStats / SyncVocabBuilder (bez argumentu = cichy tryb), więc krok „Synchronizuj teraz” na czytniku znika. Nigdy z panelu. (2) Panel: ostrzeżenie, gdy backend Rosetty = Model AI/Gotowy przekład, a w Konta brak klucza.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Plugin: opt-in merge_after_sync (menu koligilo), Sync.mergeEvents + Koligilo:mergeSharedData (ciche SyncBookStats/SyncVocabBuilder po synchronizacji bez zmian ustawień). Panel: ostrzeżenie o braku klucza przy backend ai/aligned, krok 3 przepisany. Testy Lua+JS zielone. Do wydania wymaga podbicia wersji wtyczki (_meta.lua + Version w main.go) — nie podbite.
<!-- SECTION:NOTES:END -->
