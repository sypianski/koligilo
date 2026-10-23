---
id: TASK-28
title: 'KOPad: szerszy słownik akcji ról (14 → 48), grupy w panelu'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-13 08:25'
updated_date: '2026-10-13 08:26'
labels:
  - ui
  - kopad
  - gamepad
dependencies: []
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Karta „Gamepad (KOPad): akcje w czytaniu” oferowała tylko 14 akcji. Rozszerzyć zamknięty słownik PC-014 o nawigację (rozdziały, ±10 stron, początek/koniec, historia miejsc, idź do strony, przeglądanie), książkę (zakładki, mapa, szukanie, status, informacje, postęp), bibliotekę (poprzednia książka, ulubione, kolekcje), wygląd (czcionka, tryb nocny, obrót, odświeżenie, podświetlenie ekranu) oraz zrzut ekranu, ściągawkę i słownik — po obu stronach kontraktu (kopad padmap.lua/padnav.lua, koligilo padmap.go + web/padmap.js). Lista w panelu pogrupowana (optgroup). Wydanie 0.5.9.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Słownik 48 akcji zgodny w padmap.go, web/padmap.js i kopad padmap.lua; zgodność pilnują testy
- [x] #2 Serwer przyjmuje nowe akcje i odrzuca nieznane (400)
- [x] #3 Panel: lista akcji w 7 grupach, bez ucinanych etykiet
- [x] #4 make test i make e2e zielone
- [x] #5 Wdrożone: serwer koligilo.sypian.ski 0.5.9, aplikacja na Macu 0.5.9
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Słownik: padmap.go (padmapActions), web/padmap.js (ACTION_GROUPS → ACTION_IDS, etykiety), web/app.js (optgroup w padActRow), testy padmap_test.go / tests/padmap_test.js. Sprawdzone w przeglądarce na tymczasowej instancji: 7 grup, 48 opcji, zapis rb=next_chapter przyjęty, nieznana akcja → 400. Wdrożone 2026-10-13: usługa koligilo na VPS zrestartowana jako 0.5.9; koligilo.app 0.5.9 (podpis ad hoc) w /Applications na Macu, poprzednia w ~/koligilo.app.bak-0.5.8. Nie pushowano na GitHub (origin/public). Nazwy zdarzeń KOReadera po stronie kopad nie były testowane na urządzeniu — zob. kopad TASK-6.
<!-- SECTION:NOTES:END -->
