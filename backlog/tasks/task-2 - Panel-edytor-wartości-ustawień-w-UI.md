---
id: TASK-2
title: 'Panel: edytor wartości ustawień w UI'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 11:47'
updated_date: '2026-09-28 12:03'
labels:
  - ui
  - ustawienia
dependencies:
  - TASK-1
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
W web/app.js wartości są dziś tylko podglądem (valueView.Preview). Dodać edycję: dla prostych typów (liczba, bool, tekst) zwykłe pola, dla tabel edytor surowego literału Lua z walidacją po stronie serwera. Możliwość usunięcia wartości (nagrobek). Wartości Secret: pole hasła, bez odczytu starej wartości. Po zmianie w web/ przebudować binarkę (go:embed).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Wartość zmieniona w panelu pojawia się w panelu z autorem 'panel'
- [x] #2 Błąd walidacji z serwera wyświetla się przy polu, nie gubi wpisanego tekstu
- [x] #3 Można dodać wartość dla ID z katalogu, którego jeszcze nie ma w stanie
- [x] #4 node --check web/app.js przechodzi
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Dowody: kod web/app.js (valSave → POST, refresh pokazuje from=panel; błąd w d.error bez kasowania draftu; missingKeys/newPrefixForm dla nowych ID); node --check zielony. UI nie testowane wizualnie w przeglądarce — tylko przegląd kodu + e2e API. Uwaga: JS ma uproszczone lustro kodowania literałów (luaQuote), fallback do surowego literału przy nietypowych znakach.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Edytor wartości ustawień w panelu (proste typy, surowy literał, usuwanie, Secret jako hasło)
<!-- SECTION:FINAL_SUMMARY:END -->
