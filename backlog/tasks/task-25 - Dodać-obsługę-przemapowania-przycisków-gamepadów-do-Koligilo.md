---
id: TASK-25
title: Dodać obsługę przemapowania przycisków gamepadów do Koligilo
status: Done
assignee:
  - '@claude'
created_date: '2026-10-09 17:49'
updated_date: '2026-10-11 14:49'
labels: []
dependencies: []
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Koligilo powinien obsługiwać przemapowanie przycisków dla gamepadów. Należy rozważyć, czy mapowanie powinno obejmować wszystkie gamepady świata, czy tylko te wykryte jako podłączone, czy też użytkownik ma wybierać z listy i ustawiać własne konfiguracje.

Z nagrania: „Też nasza nasz kompanion, czyli Koligilo, powinien obsługiwać przemapowania tych przycisków podglądy kilku gamepadów jakie mamy. Nie wiem czy tu należałoby mapować wszystkie gamepady świata, czy zależności od tego co jest wykryte jako podłączone dla użytkownika, czy rzeczywiście z listy wszystkich gamepadów i układów. Użytkownik wybiera kilka swoich i sobie ustawia na nich ustawienia, ale rozważmy to.”
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Format mapowania przycisków gamepada (profile per układ) zapisany jako PC w libraro/decyzje, z alternatywami i jawną granicą zakresu
- [x] #2 kopad czyta mapowanie z settings/kopad.lua; bez wpisu zachowuje się dokładnie jak dotąd (domyślne przypisania), a błędny wpis jest ignorowany z logiem, bez crasha
- [x] #3 Koligilo synchronizuje mapowanie jak zwykłe wspólne ustawienie; wybór aktywnego układu nie przecieka między urządzeniami z różnymi padami; nic z tego nie narusza niezmienników sync (DEVICE_KEYS, literały Lua bajt w bajt)
- [x] #4 Panel: edytor mapowania z listą znanych układów (min. Steam Deck, DualSense, Xbox, układ w stylu Nintendo), wyborem swoich, edycją przycisk→rola z podglądem układu i przywracaniem domyślnych; zapis przez istniejące API wartości
- [x] #5 Testy: make test zielone (nowe testy formatu/walidacji po stronie Go i JS) oraz test czystej funkcji mapowania w kopad (lua); make e2e zielone
- [x] #6 Dokumentacja: README kopad i opis w CLAUDE.md/README Koligilo; commity osobno w obu repo
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Łańcuch dwóch sub-agentów (opus), po kolei. A) kopad (~/projekti/koreader-kopad): PC-011 z formatem (zasięg: fizyczny przycisk/oś SDL → rola logiczna A/B/X/Y/LB/RB/LT/RT/Select/Start, profile per układ; mapowanie akcji per kontekst poza zakresem), warstwa mapowania w padnav.lua czytająca settings/kopad.lua, domyślne = obecne zachowanie, test czystej funkcji w lua, README. B) koligilo: katalog (grupa kopad), walidacja po stronie Go, edytor w panelu (web/app.js, style.css) z listą układów i podglądem, testy Go/JS, dokumentacja. Decyzja zakresu: PC-010.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decyzje: PC-010 (zakres: lista znanych układów, zmiana w obu repo), PC-011 (format: fizyczna kontrolka SDL → rola logiczna, profile per układ, aktywny układ lokalnie), PC-012 (katalog: grupa kopad synchronizuje tylko padmap, enabled lokalne).
AC1: PC-011 w libraro/decyzje (zakres, stan lokalny vs wspólny, kształt tabeli, walidacja, odrzucone alternatywy). AC2: koreader-kopad commit ef33335, tests/padmap_test.lua OK, luac -p OK, test różnicowy starego i nowego padnav.lua: identyczne na 2640 zdarzeniach (uruchomiony przez dyrygenta). AC3: TestCatalogKopadOnlyPadmap, TestPadmapSyncsButEnabledDoesNot, luaser_test.js 183 wartości bajt w bajt, e2e krok 9b (enabled zostaje lokalne, padmap dociera na oba czytniki, usunięcie z panelu usuwa). AC4: karta „Gamepad (KOPad): przyciski” w „Ustawieniach czytników”, 3 układy, inline SVG, listy ról, przywracanie, zapis przez api(); zrzut ekranu obejrzany przez dyrygenta. AC5: make test exit 0 (go test -count=1 OK), make e2e exit 0 (105 ok). AC6: CLAUDE.md, README EN/PL/EO (Koligilo), README/CLAUDE.md/nagłówki kopad.
Weryfikacja dyrygenta: niezależne uruchomienie make test i make e2e, przegląd diffu catalog.go/server.go/padmap.go i padmap.lua/padnav.lua, zrzut ekranu edytora.
Uwagi: (1) walidacja serwera działa tylko dla zapisu z panelu; urządzenie może przez /api/v1/sync wysłać padmap w innej wersji — panel pokaże ostrzeżenie z „Zacznij od zera”. (2) Po zawężeniu katalogu stare wartości settings/kopad.lua#… w state.json zostają sierotami (nieużywane, ukryte). (3) kopad podchwytuje zmianę padmap przy onReaderReady/onResume lub po zmianie układu w menu, nie natychmiast. (4) Zmiana w kopad dociera na urządzenia dopiero po pull w osobnym checkoucie ~/modi/koreader/koplugins/kopad.koplugin (remote sypianski/kopad.koplugin). (5) Poza zakresem: akcje per kontekst, D-pad/drążki/L3/R3, rola none, wykrywanie układu po nazwie pada.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Przemapowanie przycisków gamepada: kopad czyta padmap z ustawień, Koligilo synchronizuje go i edytuje w panelu per układ (Xbox, PlayStation, Nintendo)
<!-- SECTION:FINAL_SUMMARY:END -->
