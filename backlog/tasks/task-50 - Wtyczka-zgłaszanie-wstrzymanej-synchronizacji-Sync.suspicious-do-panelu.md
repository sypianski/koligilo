---
id: TASK-50
title: 'Wtyczka: zgłaszanie wstrzymanej synchronizacji (Sync.suspicious) do panelu'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-25 11:13'
updated_date: '2026-10-25 11:24'
labels:
  - plugin
  - panel
dependencies: []
priority: low
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bezpiecznik wstrzymuje synchronizację i pokazuje okno tylko na czytniku; serwer nie wie, więc w panelu czytnik wygląda na cicho od N dni. Zgłosić przy następnej udanej synchronizacji (albo lekkim zapytaniem) fakt i liczbę kluczy; panel pokazuje powód przy czytniku.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Plugin: gdy Sync.suspicious wstrzyma synchronizację, zapamiętuje to w ustawieniach (sync_blocked = {at, deleted}) i przy następnej udanej synchronizacji (lub lekkim GET) zgłasza serwerowi (query sync_blocked=<liczba>); serwer zapisuje Device.SyncBlocked {At, Count} z walidacją liczby
- [x] #2 Panel przy czytniku pokazuje 'synchronizacja była wstrzymana: zniknęło N ustawień' w kolumnie stanu synchronizacji, znika po udanej synchronizacji; testy Go i Lua, make test i make e2e zielone
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Sync.blockedCount/blockedRecord, Koligilo:reportBlocked, GET ?report_only=1&sync_blocked=N, Device.SyncBlocked, stan 'stop' w syncHealth. make test + e2e zielone (dyrygent).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Panel pokazuje, że synchronizacja czytnika została wstrzymana przez bezpiecznik i ile ustawień zniknęło
<!-- SECTION:FINAL_SUMMARY:END -->
