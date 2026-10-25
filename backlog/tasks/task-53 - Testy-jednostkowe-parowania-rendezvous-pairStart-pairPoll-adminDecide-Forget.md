---
id: TASK-53
title: >-
  Testy jednostkowe parowania: rendezvous, pairStart/pairPoll, adminDecide,
  Forget
status: To Do
assignee: []
created_date: '2026-10-25 17:32'
labels: []
dependencies: []
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pokrycie 0% w ścieżkach krytycznych dla bezpieczeństwa; dziś pokrywa je tylko tests/run_e2e.sh. Do pokrycia: Rendezvous.tooMany (blokada po 10 nieudanych próbach/10 min, reset po TTL), lookup/claim, limit rvPerIP i globalny 500, expireLocked, normCode, pairStart/pairPoll, adminDecide (approve/deny, zły JSON), Rename, Forget, ResetAdmin. Cel: zmiana stałej limitu prób łamie test.
<!-- SECTION:DESCRIPTION:END -->
