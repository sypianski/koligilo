---
id: TASK-12
title: Aktualizacje wtyczek z galerii
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 11:48'
updated_date: '2026-09-28 12:42'
labels:
  - wtyczki
  - galeria
dependencies:
  - TASK-9
  - TASK-11
priority: low
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Okresowe sprawdzanie nowszych release'ów/commitów dla wtyczek z galerii. W panelu 'dostępna aktualizacja', aktualizacja jednym kliknięciem (nowy SHA w stanie docelowym). Czytnik i tak pyta o zgodę.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Panel pokazuje dostępne aktualizacje z datą i changelogiem release'u
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Dowody: TestGalleryUpdatesReleaseAvailable (release v1.3 z datą i changelogiem → update_available, POST update podmienia sha na urządzeniu), TestGalleryUpdatesNoReleaseComparesCommits, TestGalleryUpdatesCheckRateLimit; make test + e2e 73/73. Changelog renderowany tylko jako tekst (brak innerHTML w app.js — sprawdzone). Dodatek: karta 'Wersje w magazynie' z badge 'czeka na akceptację' i przyciskiem Zaakceptuj (endpoint z TASK-13). Uproszczenie: w monorepo jeden wpis aktualizacji na repo. Sprawdzanie okresowe co 12 h w trybie serve. UI nie oglądane w przeglądarce.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Aktualizacje wtyczek z galerii (release/commit, changelog, jednym kliknięciem) + akceptacja wtyczek z czytnika w panelu
<!-- SECTION:FINAL_SUMMARY:END -->
