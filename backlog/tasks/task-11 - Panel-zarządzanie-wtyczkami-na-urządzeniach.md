---
id: TASK-11
title: 'Panel: zarządzanie wtyczkami na urządzeniach'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 11:48'
updated_date: '2026-09-28 12:20'
labels:
  - wtyczki
  - ui
dependencies:
  - TASK-6
  - TASK-7
priority: medium
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tabela urządzenie × wtyczka: wersja zainstalowana/docelowa, stan (oczekuje na zgodę, zainstalowana, błąd), zarządzana przez koligilo czy ręcznie. Akcje: dodaj do urządzenia, usuń (tylko zarządzane), wgraj własny ZIP (task-6).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Widać rozbieżność między stanem docelowym a zainstalowanym
- [x] #2 Wtyczek zainstalowanych ręcznie nie da się usunąć z panelu
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Dowody: pluginRow/pluginStatus (kolumny zainstalowana vs docelowa, stany), canRemove wyłączone dla managed=false; upload ZIP przez apiUpload (multipart) sprawdzony curl-em. UI nie oglądane w przeglądarce. UWAGA bezpieczeństwo: nowe endpointy admina (upload multipart, devices/{id}/plugins, gallery/*) nie wymagają application/json — przez proxy desktop są podatne na CSRF (patrz propozycja ticketu CSRF).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Zakładka Wtyczki: urządzenie × wtyczka, rozbieżności, dodawanie/usuwanie zarządzanych, upload ZIP
<!-- SECTION:FINAL_SUMMARY:END -->
