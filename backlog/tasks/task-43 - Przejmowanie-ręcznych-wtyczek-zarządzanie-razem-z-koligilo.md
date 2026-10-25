---
id: TASK-43
title: 'Przejmowanie ręcznych wtyczek: zarządzanie razem z koligilo'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-25 10:53'
updated_date: '2026-10-25 12:02'
labels:
  - wtyczki
  - panel
dependencies: []
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Z komentarza usera w runda2 (TASK-41): czy da się scalić ręcznie zainstalowane wtyczki z zarządzanymi i dysponować nimi razem? Dziś: z menu czytnika „Wyślij wtyczkę na serwer” (TASK-13) → akceptacja w panelu → wtyczka zarządzana. Brak: wygodnej ścieżki z panelu (wskazówka przy ręcznej wtyczce, skrót). Wbudowanych w KOReadera nie ruszamy (PC-004); dane inwentarza nie odróżniają wbudowanych od ręcznych — wymagałoby zmiany w pluginie.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Plugin zgłasza w inwentarzu pole origin (builtin | manual | puste, gdy nie da się ustalić); testy Lua w tests/installer_test.lua
- [x] #2 Serwer zapisuje i przycina Origin (InstalledPlugin); gdy plugin nie zgłosi (stary plugin albo ten sam katalog danych co instalacja) — fallback po nazwie z builtinPlugins; testy Go
- [x] #3 Panel rozdziela w widoku Wtyczki ręczne od wbudowanych: ręczne widoczne i z podpowiedzią jak je przejąć (menu czytnika → wyślij na serwer → akceptacja w panelu), wbudowane zwinięte; przeglądarkowy węzeł node --check i make test zielone
- [x] #4 Zakres bez ścieżki żądania z panelu do czytnika (zgoda na czytniku zostaje, PC-004); wersja podbita spójnie (main.go + _meta.lua), CLAUDE.md zaktualizowany
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC1-4: origin z Sync.pluginOrigin (testy sync/installer Lua), Origin + normalizePluginOrigin z fallbackiem builtinPlugins (TestReportPluginsOrigin), panel: bloki 'Ręczne na czytnikach' (rozwinięty, TAKEOVER_HINT) i 'Wbudowane w KOReadera' (zwinięty). Weryfikacja dyrygenta: make test exit 0, przegląd diffu. Wersja 0.9.1 (nie wdrożona; czytniki muszą dostać plugin ręcznie albo samoaktualizacją). Bez ścieżki panel→czytnik (PC-004); ewentualny follow-up: 'poproś czytnik o wysłanie wtyczki' wymagałby nowego kanału i PC.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Plugin zgłasza origin wtyczek (builtin/manual), serwer zapisuje go z fallbackiem po nazwie, panel rozdziela ręczne (z instrukcją przejęcia) od wbudowanych.
<!-- SECTION:FINAL_SUMMARY:END -->
