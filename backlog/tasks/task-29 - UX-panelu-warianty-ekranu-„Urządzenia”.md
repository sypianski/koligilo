---
id: TASK-29
title: 'UX panelu: warianty ekranu „Urządzenia”'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-23 17:24'
updated_date: '2026-10-23 19:35'
labels:
  - ux
  - panel
dependencies: []
priority: medium
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Selektor wariantów UX (skill /ux): kod widoku + zrzut → artefakt z 2–4 wariantami na sekcję i osobną stylistyką → wybór zapisany w db → wdrożenie po zatwierdzeniu. Niezmienniki panelu (guard() desktop.go, nagłówek X-Koligilo, zapis padmap/luaSerialize bajt w bajt) są nietykalne. Widok: `urzadzenia` (web/app.js, VIEWS).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Wybór usera (artefakt https://claude.ai/artifact/C9dHYq74sWTWZap7j3WgxL, wybor/urzadzenia, zatwierdzony 2026-10-23): stylistyka Tusz ze stanem; wstęp → podpis pod nagłówkiem; prośba → zwarty baner; wiersz → tabela; stan → kropka i słowo (próg ciszy do ustalenia); dodawanie → jedna karta z zakładkami (domyślnie Kablem USB); zapomnij/zmiana nazwy → pasek w miejscu. Uwaga usera: wątpliwość, czy „Dodaj czytnik” jest sensownie pomyślany — do omówienia przed wdrożeniem tej części.

Wdrożone lokalnie (5 commitów, make test zielone, sprawdzone w Chromium na kopii z symulowanymi czytnikami): tokeny stanu + kropki (próg QUIET_DAYS=7), podpis pod nagłówkiem (VIEW_SUB), zwarty baner, tabela z paskiem w miejscu (S.devEdit), karta „Dodaj czytnik” z zakładkami wg sytuacji (domyślnie Kabel USB). NIE zrobiono: bump wersji, build/wdrożenie na Maca i VPS, test na prawdziwym czytniku i w oknie aplikacji (WKWebView).

Wdrożono 2026-10-23 jako 0.5.10: serwer (usługa zrestartowana, pliki panelu na originie zgodne z HEAD), aplikacja na Macu (zanotaryzowany DMG z wydania v0.5.10, otwarta i uruchomiona), publiczne repo i wydanie GitHub v0.5.10. Cache Cloudflare nie wymagał czyszczenia (publicznie serwowane app.js, style.css, padmap.js były aktualne).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Widok „Urządzenia” przebudowany wg zatwierdzonego wyboru: stylistyka „Tusz ze stanem”, podpis pod nagłówkiem zamiast wstępu, zwarty baner prośby o połączenie, tabela czytników ze stanem synchronizacji (kropka i słowo, próg ciszy 7 dni), zmiana nazwy i zapomnienie paskiem w miejscu, jedna karta „Dodaj czytnik” z zakładkami wg sytuacji czytnika. make test zielone; sprawdzone w Chromium na kopii z symulowanymi czytnikami (fokus, odświeżanie co 3 s, Escape, brak poziomego przewijania przy 420 px). Nie sprawdzono: wyglądu w oknie aplikacji macOS (WKWebView) po wdrożeniu ani działania na prawdziwym czytniku; brak testów automatycznych dla samego UI.
<!-- SECTION:FINAL_SUMMARY:END -->
