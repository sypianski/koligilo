---
id: TASK-3
title: 'E2E: zmiana z panelu trafia na czytnik'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 11:47'
updated_date: '2026-09-28 12:03'
labels:
  - testy
  - ustawienia
dependencies:
  - TASK-1
priority: medium
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rozszerzyć tests/run_e2e.sh: panel ustawia i usuwa wartość przez /api/admin/values, symulowany czytnik (sync.lua przez curl) po synchronizacji ma ją w pliku, a usunięcie znika bez wskrzeszenia przy kolejnym sync z drugiego czytnika.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 make e2e obejmuje scenariusz zapisu i usunięcia z panelu
- [x] #2 Drugi czytnik ze starą wartością nie wskrzesza usuniętego klucza
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Dowód: make e2e 57 ok / 0 fail, scenariusz 9 (Kobo+Bigme; Bigme ze starą wartością dostaje nagrobek i nie wskrzesza).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
E2E: zmiana i usunięcie z panelu dociera do dwóch czytników bez wskrzeszenia
<!-- SECTION:FINAL_SUMMARY:END -->
