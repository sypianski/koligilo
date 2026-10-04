---
id: TASK-20
title: Ulubione wtyczki
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 16:41'
updated_date: '2026-09-29 18:20'
labels:
  - ui
  - wtyczki
dependencies:
  - TASK-19
priority: low
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Możliwość oznaczenia wtyczki gwiazdką (ulubione) — zarówno z galerii (repo owner/repo), jak i z magazynu. Ulubione: filtr/zakładka w widoku wtyczek, na górze listy „Wg wtyczek”, szybkie „przypisz do urządzenia”. Przechowywanie po stronie serwera (state.json, pole np. favorites: ["owner/repo" | nazwa katalogu .koplugin]), żeby ulubione były wspólne dla panelu na komputerze i na własnym serwerze oraz przechodziły przez eksport/import (transfer.go). Nowe endpointy /api/admin/plugins/favorites (PUT/DELETE) z X-Koligilo jak reszta. Ulubione nie oznacza instalacji — to tylko zakładka.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Gwiazdka przy wtyczce w galerii i na liście wtyczek; stan przeżywa restart i jest w eksporcie
- [x] #2 Filtr „Ulubione” w widoku wtyczek
- [x] #3 Testy Go dla zapisu/odczytu i eksportu; make test i make e2e zielone
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Zależne od TASK-19 (widok "Wg wtyczek"). Klucz ulubionej: prefiksowany, żeby rozróżnić przestrzenie nazw — "gh:owner/repo" (galeria) i "dir:nazwa.koplugin" (magazyn); walidacja regexem po stronie serwera (favKeyRe w plugins.go, wzorem repoRe/pluginDirRe). store.go: pole State.Favorites []string `json:"favorites,omitempty"` — przechodzi przez export/import automatycznie (transfer.go kopiuje całą strukturę State, bez zmian w transfer.go). plugins.go: Store.Favorites()/Store.SetFavorite(key,on) (mutex, sort, atomowy zapis jak reszta), handlery adminFavoritePut/adminFavoriteDelete, trasy PUT/DELETE /api/admin/plugins/favorites w pluginRoutes (literalna ścieżka bije wzorzec {sha}, bez kolizji w ServeMux). server.go adminState: dołożyć "favorites": s.st.Favorites() do odpowiedzi GET /api/admin/state. web/app.js: S.favBusy, funkcja toggleFavorite(key) (api PUT/DELETE, optymistycznie aktualizuje S.state.favorites po sukcesie, refresh()); przycisk-gwiazdka (aria-pressed, aria-label) przy repoCard (klucz "gh:"+full_name) i w widoku "Wg wtyczek" przy karcie katalogu (klucz "dir:"+dir); nowa zakładka/filtr "Ulubione" w tablist wtyczek (S.pluginTab="ulubione") pokazująca połączone karty (dir + repo) posortowane, z tym samym przypisz/usuń co "Wg wtyczek", plus link do pełnego wpisu w galerii/magazynie. web/style.css: styl gwiazdki (aria-pressed=true wypełniona, kontrast AA, spójna z Catppuccin). Testy Go: TestFavorites (PUT/DELETE przez HTTP, walidacja złego klucza → 400, GET /api/admin/state zawiera pole) i TestFavoritesExport (ExportArchive→ImportArchive zachowuje Favorites, wzorem TestImportRejectsTampered w local_test.go) w plugins_test.go. make test i make e2e zielone.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Weryfikacja dyrygenta: State.Favorites (gh:owner/repo | dir:nazwa.koplugin), PUT/DELETE /api/admin/plugins/favorites, TestFavorites + TestFavoritesExport PASS; naprawiony brak kopiowania Favorites w ImportArchive. Filtr „Tylko ulubione” + sekcja ulubionych z galerii jeszcze niezainstalowanych.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Ulubione wtyczki (galeria i magazyn), zapisane na serwerze, filtr, przechodzą przez eksport
<!-- SECTION:FINAL_SUMMARY:END -->
