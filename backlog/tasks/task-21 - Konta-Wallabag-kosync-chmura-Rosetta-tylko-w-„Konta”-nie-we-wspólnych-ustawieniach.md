---
id: TASK-21
title: >-
  Konta (Wallabag, kosync, chmura, Rosetta) tylko w „Konta”, nie we wspólnych
  ustawieniach
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 16:41'
updated_date: '2026-09-29 17:15'
labels:
  - ui
  - konta
dependencies: []
priority: medium
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Grupy z danymi logowania (Secret: konto_kosync, konto_wallabag, konta_chmura, konto_statystyki, rosetta_klucze w catalog.go) pokazują się dziś także w „Wspólnych ustawieniach” jako surowe wartości (valuesTab), obok zakładki „Konta” (accountsTab), która robi to po ludzku. Cel: wspólne ustawienia pokazują wyłącznie ustawienia czytania/interfejsu; wszystko, co jest kontem/poświadczeniem, żyje w „Konta” — z kartą dla każdego typu (w tym klucze API Rosetty, którego dziś w Kontach nie ma). W karcie konta: stan (skonfigurowane / z którego urządzenia przyszło / kiedy), edycja, usunięcie. Surowy podgląd ID wartości ewentualnie w trybie zaawansowanym (TASK o ukrywaniu technikaliów). Niezmienniki: dane logowania nigdy nie wracają do przeglądarki, konto Dropbox z username=true nie jest przyjmowane.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Grupy Secret nie pojawiają się w widoku wspólnych ustawień
- [x] #2 Każda grupa Secret ma swoją kartę w „Konta” (w tym Rosetta — klucze API) z edycją i usuwaniem
- [x] #3 Sekrety nadal nie są wysyłane do przeglądarki (test Go na /api/admin/state)
- [x] #4 make test i make e2e zielone
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. accounts.go: dodaj const rosettaFile; helpery getBool/getNumStr (decodeLua bool/float); helper setOrDel dla string->literal/usunięcie.
2. accounts.go: rozszerz accountsGet o pola niesekretne kosync (auto_sync, sync_forward, sync_backward, checksum_method) i wallabag (filter_tag, ignore_tags, auto_tags, articles_per_sync, is_delete_finished, is_delete_read, is_auto_delete, send_review_as_tags) oraz nowy blok "rosetta" (ai_base_url, ai_model, ai_max_tokens, ai_temperature, has_api_key) — klucz API tylko jako flaga.
3. accounts.go: kosyncPut/wallabagPut zapisują też pola niesekretne; nowe rosettaPut (PUT, wymaga klucza API przy pierwszym zapisie, pisze do ai_api_key I api_key dla kompatybilności wersji) i rosettaDelete (DELETE, czyści wszystkie klucze grupy). Rejestracja tras w accountRoutes.
4. web/app.js valuesTab(): odfiltruj grupy Secret (catalog i values) — nie pojawiają się we „Wspólnych ustawieniach” (AC1).
5. web/app.js accountsTab(): dodaj rosettaCard() (pola + edycja/usuwanie klucza) oraz sekcje „Więcej opcji” (details) w kosyncCard/wallabagCard dla pól niesekretnych. Dodaj acctStatus(groupId) pokazujący z S.state.values (from/t) informację „skonfigurowane od kiedy/z jakiego urządzenia” w każdej karcie (AC2).
6. Testy Go: values_test.go/accounts_test.go — rozszerz TestAdminValuesSecretNeverLeaks (albo dodaj nowy test) o wallabag.password i rosetta ai_api_key/api_key w treści /api/admin/state; test PUT/GET/DELETE dla /api/admin/accounts/rosetta (pusty klucz przy edycji nie kasuje starego, GET nie oddaje klucza) (AC3).
7. make test (go vet/test, lua, node --check web/app.js) i make e2e — zielone (AC4). Smoke: build binarki do scratchpada + curl /api/admin/state i /api/admin/accounts.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Weryfikacja dyrygenta: AC1 valuesTab filtruje catalog/values po g.secret (app.js ~1321). AC2 karty kosync/wallabag/chmura/cele + nowa rosettaCard (PUT/DELETE /api/admin/accounts/rosetta), stan skąd/kiedy, niesekretne pola w „Więcej opcji”. AC3 TestAdminValuesSecretNeverLeaks (wallabag.password, rosetta ai_api_key) + TestRosettaAccount PASS. AC4 make test + e2e exit 0. Respawn 1: sync_forward/backward/checksum_method to enumy liczbowe KOReadera (1..3, 0..1) — były traktowane jako bool/string, zapis karty psułby ustawienia; teraz *int z walidacją, PUT tylko zmienionych pól (changedOnly), TestKosyncEnumFields. Respawn 2: odwrócone etykiety forward/backward. Klucz Rosetty zapisywany w ai_api_key i api_key. Wymaga wdrożenia serwera (panel usera w trybie remote → koligilo.sypian.ski).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Konta (w tym Rosetta) tylko w „Konta”; wspólne ustawienia bez grup z danymi logowania
<!-- SECTION:FINAL_SUMMARY:END -->
