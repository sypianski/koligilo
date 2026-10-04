---
id: TASK-18
title: 'Widok „Ustawienia” aplikacji: motyw i serwer zamiast luźnych przycisków'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 16:40'
updated_date: '2026-09-29 18:08'
labels:
  - ui
  - design
dependencies: []
priority: medium
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dziś w stopce paska bocznego wiszą dwa luźne elementy: radiogrupa motywu (#theme, trzy ikony) i przycisk trybu serwera (#mode, renderModeButton) — ten drugi nie pasuje stylistycznie do reszty nawigacji. Cel: jeden wpis „Ustawienia” (ikona koła zębatego) na dole paska bocznego, prowadzący do widoku z sekcjami: Wygląd (Motyw: jak w systemie / Latte / Mocha, ewentualnie akcent), Serwer (obecna zawartość serverTab: ten komputer / własny serwer, przenosiny, eksport/import), O aplikacji (wersja, skróty klawiszowe). W trybie „serve” (VPS) sekcja Serwer odpowiednio okrojona. Stopka paska bocznego może pokazywać tylko dyskretny wskaźnik trybu (tekst/kropka), spójny z .nav-item. Bez zmian w API i logice motywu (localStorage koligilo.theme).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Przełącznik motywu zniknął ze stopki; motyw zmienia się w Ustawienia → Wygląd i dalej jest zapamiętywany
- [x] #2 Zmiana serwera dostępna z Ustawień; brak osobnego, niepasującego przycisku
- [x] #3 Skróty Alt+N zaktualizowane, obsługa klawiaturą i ARIA zachowane, kontrast AA w Latte i Mocha
- [x] #4 Zrzuty przed/po; make test i make e2e zielone
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. index.html: usuń #theme (radiogroup motywu) i przebuduj #mode z pełnego przycisku trybu na dyskretny wskaźnik trybu (kropka+tekst, tylko desktop); dodaj kontener #settings-nav w .side-foot na jeden wpis "Ustawienia" (styl .nav-item, ikona kola zebatego).
2. app.js: ICONS — dodaj "ustawienia" (ikona kola zebatego, spojna stylistycznie z reszta).
3. app.js: renderModeButton() -> renderSideFoot() — renderuje dyskretny wskaznik trybu w #mode (tylko tryb desktop, tekst "Ten komputer"/"Wlasny serwer") oraz przycisk .nav-item "Ustawienia" w #settings-nav (zawsze gdy ready), wywolywany z renderNav() jak dotychczas renderModeButton().
4. app.js: renderTheme() -> themeControl() — zwraca wezel (nie mutuje stalego DOM), uzywany wylacznie wewnatrz nowego widoku Ustawienia; themeSet() woła pelny render() zamiast renderTheme() i donawiguje return-focus po data-t. Usun poczatkowe wywolanie renderTheme() przy starcie (theme.apply zostaje, FOUC bez zmian).
5. app.js: nowa funkcja ustawieniaTab() — sekcje "Wyglad" (themeControl()+opis), "Serwer" (S.mode==="desktop": obecna zawartosc serverTab() bez zmian logiki; S.mode==="serve": krotki, okrojony opis — panel zarzadza serwerem, na ktorym dziala), "O aplikacji" (wersja S.state.version + lista skrotow klawiszowych: Alt+1..7, "/", strzalki/Home/End).
6. app.js: main() — dispatch mapa: usun "serwer" (bylo osobnym tabem), dodaj "ustawienia": ustawieniaTab; naglowek widoku dla S.tab==="ustawienia" -> "Ustawienia"; usun specjalna obsluge S.tab==="serwer" (linia z view = ...).
7. app.js: hash routing przy starcie — zamien akceptacje "#serwer" na "#ustawienia" (TABS.includes || location.hash==="#ustawienia"); serverTab() zostaje funkcja pomocnicza wywolywana z ustawieniaTab(), nie samodzielnym tabem.
8. app.js: renderConn() — usun przycisk "Zmien"; w trybie desktop opakuj tresc (kropka+tekst) w <button> nawigujacy do showTab("ustawienia"), w trybie serve zostaw jako zwykly, nieklikalny wskaznik (bez API do zmiany serwera w tym trybie).
9. style.css: .side-mode — nowy styl tekstowy (kropka+tekst, subtext, male, spojny z .nav-item typografia); .conn > button reset stylu (usun/dostosuj stare ".conn button" pod "Zmien"); dodaj .shortcuts (dl) do listy skrotow w "O aplikacji"; w @media (max-width:760px) zastap martwa regule ".theme { width:108px }" ukryciem .side-mode (za malo miejsca w poziomym pasku), sprawdz .mac-app .side padding-top (TASK-17) — nie ruszac.
10. Weryfikacja kontrastu AA (Latte/Mocha) dla nowych par kolorow (.side-mode text/tlo, .conn button hover) malym skryptem node liczacym WCAG contrast ratio na zmiennych z :root / [data-theme=dark].
11. make test, make e2e.
12. Zrzuty przed (checkout HEAD do osobnego katalogu/worktree) i po zmianach — Latte+Mocha, desktop local (i serve jesli sie da) — .../scratchpad/task18/, obejrzenie przez Read.
13. NIE ruszac plugin/koligilo.koplugin/main.lua (niezacommitowana zmiana z innej sesji).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Uwaga dyrygenta (zrzut z Maca 2026-09-29): drugi przycisk zmiany serwera „Zmień” jest też w pasku stanu obok „Połączono z …” (renderConn) — też przenieść do Ustawień / ujednolicić.

Weryfikacja dyrygenta: zrzut scratchpad/task18/shots/after-dark-3-serwer-lub-ustawienia.png — w stopce paska tylko wskaźnik „Ten komputer” + „Ustawienia”; widok Wygląd (radiogrupa motywu) / Serwer / O aplikacji; przycisk „Zmień” w pasku stanu zastąpiony klikalnym wskaźnikiem połączenia → Ustawienia. Kontrast ≥4.54:1 (contrast.js). make test + e2e exit 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Widok „Ustawienia” (motyw, serwer, o aplikacji) zamiast luźnych przycisków w stopce i pasku stanu
<!-- SECTION:FINAL_SUMMARY:END -->
