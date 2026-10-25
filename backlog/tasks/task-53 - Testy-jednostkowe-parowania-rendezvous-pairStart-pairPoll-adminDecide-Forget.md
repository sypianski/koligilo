---
id: TASK-53
title: >-
  Testy jednostkowe parowania: rendezvous, pairStart/pairPoll, adminDecide,
  Forget
status: Done
assignee: []
created_date: '2026-10-25 17:32'
updated_date: '2026-10-25 18:21'
labels: []
dependencies: []
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pokrycie 0% w ścieżkach krytycznych dla bezpieczeństwa; dziś pokrywa je tylko tests/run_e2e.sh. Do pokrycia: Rendezvous.tooMany (blokada po 10 nieudanych próbach/10 min, reset po TTL), lookup/claim, limit rvPerIP i globalny 500, expireLocked, normCode, pairStart/pairPoll, adminDecide (approve/deny, zły JSON), Rename, Forget, ResetAdmin. Cel: zmiana stałej limitu prób łamie test.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Zrobione: pairing_test.go (24 testy) — rendezvous (pełny przepływ, jednorazowość tokenu, claim 2x, walidacja claim, blokada po 10 błędach dla lookup i claim, wygasanie prób, X-Forwarded-For nie omija blokady, clientIP, normCode, limit 500, wygasanie sesji), pairStart/pairPoll/Decide (limit 5 oczekujących, token raz, odrzucenie, wygasła prośba, hash zamiast jawnego tokenu na dysku), granica admin/urządzenie (401 dla braku/złego/urządzeniowego tokenu), Rename/Forget/ResetAdmin, adminRVClaim z wycofaniem urządzenia. Testy mutacyjne: zmiana progu blokady, zdjęcie jednorazowości tokenu i zaufanie do XFF łamią testy. Znaleziony i naprawiony błąd: Store.Decide nie wygaszał próśb (expireLocked), więc wygasłą prośbę dało się zatwierdzić i powstawało urządzenie-sierota. Pokrycie Go 73,1% -> 77,4%.
<!-- SECTION:NOTES:END -->
