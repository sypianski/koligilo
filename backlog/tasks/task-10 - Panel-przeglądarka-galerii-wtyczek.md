---
id: TASK-10
title: 'Panel: przeglądarka galerii wtyczek'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 11:48'
updated_date: '2026-09-28 12:20'
labels:
  - wtyczki
  - galeria
  - ui
dependencies:
  - TASK-9
  - TASK-7
priority: medium
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Widok galerii w web/: wyszukiwarka, sortowanie (gwiazdki, ostatnia aktualizacja), karta wtyczki (opis, README, link do repo, wersje), przycisk 'Zainstaluj na…' z wyborem urządzeń (tylko tych z plugins_allowed). Wyraźne ostrzeżenie, że to kod zewnętrznego autora z pełnymi uprawnieniami na czytniku. Oznaczenie wtyczek już zainstalowanych i tych z dostępną aktualizacją.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Można znaleźć wtyczkę, wybrać urządzenia i zlecić instalację
- [x] #2 Urządzenia bez zgody na wtyczki są wyszarzone z wyjaśnieniem
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Dowody: przegląd kodu web/app.js (galleryTab, galleryInstallPanel: gallery/install + devices/{id}/plugins; checkbox disabled gdy !plugins_allowed z wyjaśnieniem, bez przełącznika zgody); agent sprawdził API curl-em na lokalnym serwerze; make test/e2e zielone. UI NIE oglądane w przeglądarce. Heurystyka aktualizacji: latest_release vs version z _meta.lua wersji z galerii (przybliżenie).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Zakładka Galeria wtyczek: wyszukiwanie, sortowanie, instalacja na wybrane urządzenia
<!-- SECTION:FINAL_SUMMARY:END -->
