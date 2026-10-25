---
id: TASK-44
title: 'Wtyczka: cicha synchronizacja przy wybudzeniu i zamknięciu książki'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-25 11:13'
updated_date: '2026-10-25 11:17'
labels:
  - plugin
dependencies: []
priority: high
ordinal: 44000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dziś jedyny automatyczny start to onNetworkConnected (ponowne połączenie z Wi-Fi, min. 15 min). Czytnik z wyłączonym Wi-Fi nie pobiera zmian z panelu ani nie wysyła swoich. Dodać onResume (i ewentualnie onCloseDocument): cicha synchronizacja, gdy sieć już jest (NetworkMgr:isOnline, bez budzenia Wi-Fi), parowanie jest, auto_sync włączone i minął AUTO_SYNC_MIN_INTERVAL. Nie przerywać czytania, nie pokazywać okien poza podejrzaną synchronizacją. Testy: atrapa w tests/installer_test.lua. Wymaga podbicia wersji wtyczki przy wydaniu.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Sync.shouldSyncOnResume(paired, auto_sync, online, last_sync, now, min_interval) w sync.lua: true tylko gdy sparowany, auto_sync włączone, sieć już jest i minął próg; testy w tests/sync_test.lua (granice progu, brak last_sync, brak sieci, auto_sync wyłączone)
- [x] #2 Koligilo:onResume wywołuje sync(true) (cicho) przez UIManager:scheduleIn, nigdy nie budzi Wi-Fi (NetworkMgr:isOnline, nie runWhenOnline); pierwsza synchronizacja nadal tylko ręcznie (brak last_sync = nic); test w tests/installer_test.lua z atrapą
- [x] #3 Brak okien przy cichej synchronizacji poza podejrzaną (Sync.suspicious); make test i make e2e zielone
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Sync.shouldSyncOnResume + Koligilo:onResume (scheduleIn 8 s, decyzja powtórzona po zwłoce, flaga _resume_pending). Testy: sync_test 176 ok, installer_test 103 ok; make e2e 127 ok bez FAIL (sprawdzone przez dyrygenta). Do wydania: podbić wersję wtyczki.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Cicha synchronizacja po wybudzeniu czytnika, tylko gdy sieć już jest
<!-- SECTION:FINAL_SUMMARY:END -->
