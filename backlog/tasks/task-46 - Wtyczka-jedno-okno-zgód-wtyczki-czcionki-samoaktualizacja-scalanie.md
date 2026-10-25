---
id: TASK-46
title: 'Wtyczka: jedno okno zgód (wtyczki, czcionki, samoaktualizacja, scalanie)'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-25 11:13'
updated_date: '2026-10-25 11:24'
labels:
  - plugin
  - ux
dependencies: []
priority: medium
ordinal: 46000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Cztery osobne przełączniki zgód w menu koligilo. Zgoda musi pochodzić z czytnika (PC-004), ale można ją zebrać naraz: okno z listą pól wyboru po pierwszej synchronizacji (askFirstSync) i dostępne z menu. Panel: pokazać stan zgód samoaktualizacji i scalania (dziś tylko wtyczki i czcionki) — wymaga zgłaszania ich przy synchronizacji jak fonts_allowed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Jedno okno zgód (ConfirmBox/lista pól wyboru zgodna z widgetami KOReadera, np. MultiConfirmBox lub kolejne pytania w jednym przepływie) zbierające: wtyczki, czcionki, samoaktualizacja, scalanie statystyk (TASK-42), Wallabag jeśli TASK-45 jest Done; pokazywane po pierwszej synchronizacji (askFirstSync) i dostępne pozycją menu; każda zgoda nadal zapisywana osobnym kluczem ustawień (te same klucze co dziś), nic nie włącza się bez wyraźnej zgody
- [x] #2 Plugin zgłasza serwerowi merge_after_sync (query merge_after_sync=1, tylko z czytnika), serwer zapisuje w Device (MergeAfterSync), panel w tabeli urządzeń pokazuje stan zgody obok zgody na samoaktualizację
- [x] #3 Testy Lua/Go, make test i make e2e zielone
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Zrobione: podmenu Zgody…, jednorazowa informacja po pierwszej synchronizacji, merge_after_sync w Device i w tabeli urządzeń. Pominięte: wallabag_after_sync (zależało od TASK-45, odrzuconego). Zmiana: przełącznik scalania wywołuje teraz sync(true) jak pozostałe zgody.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Zgody czytnika w jednym podmenu, a stan zgody na scalanie widoczny w panelu
<!-- SECTION:FINAL_SUMMARY:END -->
