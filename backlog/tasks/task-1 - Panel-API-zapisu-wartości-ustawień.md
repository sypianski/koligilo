---
id: TASK-1
title: 'Panel: API zapisu wartości ustawień'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 11:47'
updated_date: '2026-09-28 12:03'
labels:
  - serwer
  - ustawienia
dependencies: []
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
W store.go:339 jest SetFromPanel, ale nie wywołuje go żadna trasa. Dodać POST /api/admin/values (auth admina), body {set:{id:literał}, delete:[id]} — usunięcia osobną listą, zgodnie z niezmiennikiem. Walidacja: ID musi należeć do grupy z catalog.go (GroupOf), literał musi przejść parser z luavalue.go (tylko format Sync.serialize). Wartości grup Secret: zapis dozwolony, ale odpowiedź i adminState nigdy nie zwracają ich treści.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 POST /api/admin/values zapisuje wartości przez SetFromPanel, a usunięcia zapisuje jako nagrobki
- [x] #2 ID spoza katalogu → 400 z nazwą ID; niepoprawny literał Lua → 400
- [x] #3 Trasa zarejestrowana bez kolizji ServeMux (TestRoutesBuild przechodzi)
- [x] #4 Testy Go: zapis, usunięcie, odrzucenie spoza katalogu, odrzucenie złego literału
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Dowody: values_test.go (7 testów: Set, Delete, RejectUnknownID, RejectBadLiteral, SecretNeverLeaks, GetFull, RequiresJSONContentType) + TestRoutesBuild — zielone po scaleniu z master. Dodatkowo GET /api/admin/values/{id...} (pełny literał, Secret → 403) i 415 bez application/json (częściowa ochrona CSRF). decodeLua jest ścisły (tylko format Sync.serialize).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
POST /api/admin/values (+GET pełnej wartości) z walidacją katalogu i literału Lua
<!-- SECTION:FINAL_SUMMARY:END -->
