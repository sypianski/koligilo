---
id: TASK-49
title: 'Panel: wersja wtyczki koligilo i zgoda na samoaktualizację w tabeli urządzeń'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-25 11:13'
updated_date: '2026-10-25 11:17'
labels:
  - plugin
  - panel
  - ux
dependencies: []
priority: high
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Device ma KOVersion, ale nie wersję wtyczki koligilo, więc panel nie pokaże czytnika ze starą wtyczką ani czy self_update_allowed jest włączone. Wtyczka dopisuje wersję (Koligilo.selfVersion) do zapytania synchronizacji, serwer zapisuje ją w Device (plugin_version), panel pokazuje ją w tabeli urządzeń z oznaczeniem nieaktualna względem wersji serwera (Version w main.go) oraz stan self_update_allowed. Niezmienniki: PC-019, zgoda tylko z czytnika.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Wtyczka dopisuje plugin_version (Koligilo.selfVersion) do zapytania GET /api/v1/sync; serwer zapisuje Device.PluginVersion (json plugin_version) i zwraca w /api/admin/state; test Go; stary plugin bez parametru nie psuje (pole puste)
- [x] #2 Stan self_update_allowed też trafia do Device (self_update_allowed, tylko z czytnika, jak fonts_allowed) i do state
- [x] #3 Panel w tabeli urządzeń pokazuje wersję wtyczki, oznaczenie nieaktualna gdy Sync-style porównanie z Version z main.go (serwer podaje server_plugin_version w state) i stan zgody na samoaktualizację; widoczne też w wąskim układzie kart; make test i make e2e zielone
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Device.PluginVersion/SelfUpdateAllowed (walidacja ^\d{1,4}\.\d{1,5}\.\d{1,6}$), state.server_plugin_version z embeddedPluginVersion(), kolumna Wtyczka w tabeli urządzeń z badge nieaktualna. Do czasu wydania nowej wtyczki wszystkie czytniki pokażą nieznana (stara wtyczka).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Panel pokazuje wersję wtyczki koligilo na czytniku, oznaczenie nieaktualnej i stan zgody na samoaktualizację
<!-- SECTION:FINAL_SUMMARY:END -->
