---
id: TASK-57
title: >-
  Słowniki: dicts_order i dicts_disabled kluczowane absolutną ścieżką .ifo —
  przemapować na ścieżkę względną
status: To Do
assignee: []
created_date: '2026-10-25 19:14'
labels:
  - plugin
dependencies: []
ordinal: 57000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
KOReader (readerdictionary.lua) zapisuje dicts_order i dicts_disabled z kluczem = ifo.file, czyli ABSOLUTNĄ ścieżką pliku .ifo (np. /storage/emulated/0/koreader/data/dict/X/x.ifo vs /mnt/onboard/.adds/koreader/data/dict/X/x.ifo). Grupa „slowniki” synchronizuje te tablice wprost, więc kolejność i wyłączenia pasują tylko między czytnikami o identycznym katalogu danych. Po TASK-55 (pliki słowników trafiają do data/dict/koligilo/<nazwa>/) problem staje się widoczny. Pomysł: w wtyczce przy wysyłaniu zamieniać prefiks <datadir>/data/dict/ na znacznik, a przy odbiorze z powrotem na lokalny — w sync.lua (serializacja kluczy) bez zmian w serwerze; uważać na niezmiennik ID wartości i na ręczne słowniki poza data/dict. Do zbadania: dict_presets (nazwy, nie ścieżki?) oraz data/dict_ext.
<!-- SECTION:DESCRIPTION:END -->
