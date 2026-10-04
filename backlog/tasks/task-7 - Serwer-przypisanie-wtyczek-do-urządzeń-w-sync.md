---
id: TASK-7
title: 'Serwer: przypisanie wtyczek do urządzeń w sync'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 11:48'
updated_date: '2026-09-28 12:04'
labels:
  - wtyczki
  - serwer
dependencies:
  - TASK-6
priority: high
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Stan docelowy per urządzenie: {katalog.koplugin → sha256}. GET /api/v1/sync zwraca pole plugins (tylko gdy urządzenie zgłosiło plugins_allowed), POST /api/v1/sync przyjmuje raport: zainstalowane wtyczki (katalog, wersja z _meta.lua, czy zarządzana przez koligilo) i wyniki instalacji (ok/odrzucone przez użytkownika/błąd). API admina: POST /api/admin/devices/{id}/plugins. Wtyczki to zbiór wersji, bez scalania klucz po kluczu.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Urządzenie bez plugins_allowed nie dostaje pola plugins
- [x] #2 Panel widzi inwentarz wtyczek każdego urządzenia i ostatni wynik instalacji
- [x] #3 Testy Go przypisania i raportu
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Dowody: TestPluginAssignSyncReport — bez ?plugins_allowed=1 brak pola plugins; plugins_allowed z panelu ignorowane; adminState pokazuje plugins/plugin_inventory/plugin_results. Kontrakt drutu (dla TASK-8): GET /api/v1/sync?plugins_allowed=1 → plugins:[{dir,sha256,name,version,size,url}] (pełny stan docelowy, lista); GET /api/v1/plugins/<sha>.zip (X-Koligilo-Sha256); POST sync pole plugins:{installed:[{dir,name,version,managed,sha256?}], results:[{dir,sha256,action,status:ok|rejected|error,error?}]}; admin: POST /api/admin/devices/{id}/plugins {plugins:{dir:sha}}.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Docelowy zbiór wtyczek per urządzenie w sync, zgoda tylko z czytnika, inwentarz i wyniki w panelu
<!-- SECTION:FINAL_SUMMARY:END -->
