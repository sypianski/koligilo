---
id: TASK-9
title: 'Serwer: galeria wtyczek z GitHuba'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 11:48'
updated_date: '2026-09-28 12:12'
labels:
  - wtyczki
  - galeria
  - serwer
dependencies:
  - TASK-6
priority: medium
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Indeks wtyczek jak w appstore.koplugin (na czytniku było 'Cached 619 plugins'): wyszukiwanie repozytoriów GitHuba po temacie koreader-plugin i nazwie *.koplugin, cache na dysku z odświeżaniem, opcjonalny token GitHuba (limit 60 zapytań na godzinę bez tokena). Na wpis: owner/repo, opis, gwiazdki, ostatni push, domyślna gałąź, najnowszy release. Instalacja z galerii: pobranie release'u lub zipballa przypiętego do SHA commita, znalezienie katalogu *.koplugin także w monorepo (np. KoInsight: plugins/koinsight.koplugin), repakowanie do formatu magazynu (task-6) z zapisanym źródłem.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 GET /api/admin/gallery?q=&sort= zwraca wyniki z cache
- [x] #2 Instalacja z galerii tworzy wpis w magazynie z owner/repo@sha
- [x] #3 Obsługa monorepo, w którym *.koplugin nie leży w korzeniu
- [x] #4 Działa bez tokena i czytelnie komunikuje limit zapytań
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Dowody (httptest udający api.github.com): TestGalleryListAutoRefreshAndSort, TestGalleryInstallMonorepo (plugins/koinsight.koplugin), TestGalleryInstallRootPlugin, TestGalleryInstallAmbiguous (400 + candidates, potem path), TestGalleryRefreshRateLimit (429 z godziną resetu i podpowiedzią KOLIGILO_GITHUB_TOKEN). make test/e2e zielone. NIE zrobiono smoke testu na żywym GitHubie (odmowa uprawnień w sesji) — do sprawdzenia po wdrożeniu. Bez tokena latest_release dociągany best-effort (limit 60/h).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Galeria wtyczek z GitHuba: indeks w cache, instalacja przypięta do SHA, monorepo, czytelny limit zapytań
<!-- SECTION:FINAL_SUMMARY:END -->
