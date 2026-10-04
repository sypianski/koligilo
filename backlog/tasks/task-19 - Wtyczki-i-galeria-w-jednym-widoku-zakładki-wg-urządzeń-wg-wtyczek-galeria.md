---
id: TASK-19
title: 'Wtyczki i galeria w jednym widoku: zakładki wg urządzeń, wg wtyczek, galeria'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 16:41'
updated_date: '2026-09-29 18:20'
labels:
  - ui
  - wtyczki
dependencies: []
priority: medium
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dziś „Wtyczki” (pluginsTab: aktualizacje, wgrywanie, magazyn, karty urządzeń) i „Galeria wtyczek” (galleryTab) to osobne pozycje nawigacji. Cel: jedna pozycja „Wtyczki” z zakładkami (role=tablist):
- Wg urządzeń — obecne karty devicePluginCard: co ma każdy czytnik, co ma dostać, status z raportu.
- Wg wtyczek — lista wtyczek z magazynu/galerii (wiersz = wtyczka), kolumny/odznaki: na których urządzeniach jest, wersja przypisana vs zainstalowana, aktualizacja dostępna; akcje przypisz/usuń dla urządzeń bez przechodzenia między kartami.
- Galeria — obecna przeglądarka GitHuba (wyszukiwanie, sortowanie, instalacja).
Magazyn i wgrywanie ZIP-a przenieść tam, gdzie pasują (np. „Wg wtyczek”). Wybrana zakładka zapamiętana lokalnie. Niezmienniki bez zmian: panel tylko przypisuje stan docelowy, instalację potwierdza czytnik (PC-004), wersje z galerii przypięte do sha.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 W nawigacji jedna pozycja „Wtyczki”; galeria dostępna jako zakładka
- [x] #2 Widok wg wtyczek pokazuje dla każdej wtyczki urządzenia, wersje i dostępne aktualizacje, pozwala przypisać/usunąć
- [x] #3 Wszystkie dotychczasowe akcje (aktualizacje, wgrywanie, akceptacja wtyczki z czytnika, instalacja z galerii) nadal działają
- [x] #4 Zakładki obsługiwane klawiaturą (strzałki), ARIA tablist; make test i make e2e zielone
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
web/app.js: scalić "wtyczki" i "galeria" w jedną pozycję VIEWS ("wtyczki") z wewnętrznym tablist S.pluginTab (urzadzenia|wtyczki|galeria, localStorage koligilo.pluginTab, wzorzec jak themeGet/Set). Nowa funkcja pluginTablist() (role=tablist/tab, strzałki+Home/End, roving tabindex, aria-controls/aria-selected) + showPluginTab(id) (ustawia S.pluginTab, zapisuje, woła refresh()). pluginsTab() renderuje tablist + panel wg S.pluginTab: "urzadzenia" = dotychczasowe devicePluginCard (bez storeCard/uploadCard); "wtyczki" = nowy widok pivotujący dane per katalog wtyczki (dir z S.plugins) — dla każdego dir: karta z tabelą urządzenie×stan (reużywa istniejący pluginRow(d,dir,inv,lastResult)), formularz przypisania do urządzenia bez tego dir, sekcja wersji w magazynie z approve (reużywa storeRow), przenosi tu uploadCard()+updatesCard(); "galeria" = dotychczasowa treść galleryTab (bez zmian logiki) opakowana w tabpanel. Routing: usunąć "galeria" z VIEWS/TABS, main() dispatch, refresh() (fetch S.plugins/S.galUpdates gdy S.tab==="wtyczki" niezależnie od subtaba, S.gallery tylko gdy pluginTab==="galeria"), showTab (bez specjalnego przypadku "galeria"). Hash routing: start i "/" (szukajka galerii) mapują na S.tab="wtyczki"+S.pluginTab="galeria". Zaktualizować shortcutsList (Alt+1…6, było 7). web/style.css: klasy .tabs/.tab dla tablist (spójne z Catppuccin, kontrast AA, focus-visible). Testy: make test (m.in. sync.lua, installer_test.lua, node --check web/app.js) i make e2e zielone — bez zmian w Go, więc głównie regresja. Zrzuty ekranu (headless chromium wzorem scratchpad/task18/shot_serve.js) każdej zakładki w Latte i Mocha do scratchpad/task19/shots, obejrzane Read.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Weryfikacja dyrygenta: VIEWS ma jedną pozycję „wtyczki” (6 widoków, Alt+1…6 w index.html i O aplikacji), zakładki Wg urządzeń / Wg wtyczek / Galeria (zrzut scratchpad/task19/shots/02-wg-wtyczek-latte.png), #galeria → wtyczki+galeria, tablist ze strzałkami (08-po-strzalce-mocha.png). make test + e2e exit 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wtyczki i galeria w jednym widoku z zakładkami wg urządzeń / wg wtyczek / galeria
<!-- SECTION:FINAL_SUMMARY:END -->
