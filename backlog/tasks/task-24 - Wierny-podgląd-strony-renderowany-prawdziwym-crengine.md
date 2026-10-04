---
id: TASK-24
title: Wierny podgląd strony renderowany prawdziwym crengine
status: To Do
assignee: []
created_date: '2026-09-29 16:45'
labels:
  - ui
  - ustawienia
  - podglad
dependencies:
  - TASK-23
priority: low
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Uzupełnienie TASK-23 (tam podgląd CSS na żywo). Przycisk „wierny podgląd” w panelu podglądu: ta sama strona przykładowa i te same ustawienia renderowane przez crengine KOReadera (headless po stronie serwera koligilo → PNG, albo crengine w WASM). Do zbadania: rozmiar binarki i fontów, cross-compile dla 5 platform z make dist, czas renderu. Decyzja o wariancie jako PC.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Wierny podgląd daje obraz zgodny z czytnikiem dla tych samych ustawień i profilu ekranu
- [ ] #2 Decyzja o wariancie (serwer/WASM) zapisana jako PC; wpływ na rozmiar dystrybucji opisany
<!-- AC:END -->
