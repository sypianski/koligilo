---
id: TASK-5
title: 'Decyzja: model bezpieczeństwa instalowania wtyczek'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 11:48'
updated_date: '2026-09-28 11:57'
labels:
  - wtyczki
  - bezpieczenstwo
dependencies: []
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wtyczka to kod Lua z pełnymi uprawnieniami, więc instalowanie z serwera świadomie łamie zasadę 'dane z serwera nie są kodem'. Spisać decyzję w ~/utensili/libraro/decyzje/ (kolejny numer PC-…) i dopisać niezmienniki do CLAUDE.md. Do rozstrzygnięcia: opt-in per urządzenie (domyślnie off, włączany na czytniku, nie z panelu), potwierdzenie każdej instalacji/aktualizacji na czytniku, weryfikacja sha256, przypinanie wersji z galerii do SHA commita, co koligilo wolno usuwać (tylko wtyczki, które samo zainstalowało), zakaz nadpisywania koligilo.koplugin i wtyczek wbudowanych w KOReadera.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Rekord decyzji w libraro/decyzje z odrzuconymi alternatywami
- [x] #2 Sekcja Niezmienniki w CLAUDE.md zaktualizowana
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC1: ~/utensili/libraro/decyzje/PC-004-model-bezpieczenstwa-instalowania-wtyczek-koread.md (decyzja usera z 2026-09-28, 5 alternatyw a-e). AC2: 3 niezmienniki w CLAUDE.md z odnośnikiem do PC-004. Weryfikacja: dyrygent przeczytał rekord i diff, zgodność z decyzją z AskUserQuestion.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Model bezpieczeństwa wtyczek spisany jako PC-004 + niezmienniki w CLAUDE.md
<!-- SECTION:FINAL_SUMMARY:END -->
