---
id: TASK-27
title: 'KOPad: zmiana akcji ról w czytaniu (panel + wtyczka)'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 18:45'
updated_date: '2026-10-11 19:10'
labels:
  - ui
  - kopad
  - gamepad
dependencies: []
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ustawienia KOPada w koligilo pozwalają zmieniać mapowanie przycisków (kontrolka → rola), ale nie samą akcję (np. następna strona → ustawienia). Dodać drugą warstwę: rola → akcja w czytaniu, jako opcjonalny klucz `actions` w `padmap` (PC-014). Po stronie wtyczki kopad (osobne repo `~/projekti/koreader-kopad`) akcja ma działać w czystym czytaniu; panel dostaje kartę „Gamepad (KOPad): akcje w czytaniu” w Wtyczki → Ustawienia wtyczek. Zakres wdrożenia na Decka i przebudowy aplikacji na Macu — poza tym taskiem.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Zamknięty słownik 14 akcji i domyślne akcje ról po obu stronach (kopad padmap.lua, koligilo padmap.go + web/padmap.js), zgodność pilnowana testem; zapis decyzji w PC-014
- [x] #2 Serwer przyjmuje poprawne `actions` (też samo, z układami, puste, równe domyślnej) i odrzuca błędne (nie tabela, nieznana rola/akcja, zły typ, brak version) komunikatem po polsku
- [x] #3 kopad stosuje nadpisanie tylko w czystym czytaniu (bez nakładki zaznaczania, słownika, X-kombinacji, poza FileManagerem); poza nim działa dotychczasowy handler; spusty i przyciski remapowane na spust też; modyfikator X da się przenieść na inną rolę
- [x] #4 Panel: karta z 10 rolami, podpowiedzią który przycisk pełni rolę na wybranym układzie, szkicem, zapisem/odrzuceniem/przywróceniem; zapis układu zachowuje akcje, a zapis akcji zachowuje układy; brak nadpisań = usunięcie wartości
- [x] #5 make test i make e2e zielone, lua tests/padmap_test.lua zielone (nowe sekcje 9–10, mutacje padnav wykrywane); dokumentacja (README EN/PL/EO, CLAUDE.md, opis grupy w catalog.go, README i CLAUDE.md kopad) opisuje nową warstwę
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decyzje: PC-014 (klucz `actions` po roli, zamknięty słownik, stosowany tylko w czystym czytaniu; odrzucone: akcje per kontrolka/układ, akcje we wszystkich kontekstach, podbicie version, dowolne zdarzenia).
AC1–2: padmap.go (`padmapActions`, `padmapDefaultActions`, `validatePadmapActions`), web/padmap.js (`ACTION_IDS`, `DEFAULT_ACTIONS`, `effectiveActions`, `actionOverrides`, `roleLabel(rola, akcje)`), TestPadmapActionsVocabulary, rozszerzone TestAdminValuesPadmapAccepts/Rejects i TestPadmapVocabularyMatchesPanel (literał z akcjami bajt w bajt jak z panelu).
AC3: kopad padmap.lua (`ACTION_ORDER`, `DEFAULT_ACTIONS`, `build_actions`, `role_of`), padnav.lua (`_override_action`, `ACTION_RUNNERS`, hooki w `_button_down` i `_trigger_event`, `_open_highlights` wyciągnięte z `onKPMenu`, dynamiczna ściągawka). Testy w tests/padmap_test.lua; test mutacyjny na kopii (7 mutacji: brak warunku nakładki/dokumentu/słownika/X-combo, domyślne nie odrzucane, actions gubione przy złym layouts, brak hooka w spuście) — wszystkie wykryte.
AC4: sprawdzone w przeglądarce na tymczasowej instancji (dane w scratchpadzie): RB → menu górne, Select → następna strona, zapis → literał `{["actions"]={["rb"]="top_menu",["select"]="next_page"},["version"]=1}`; zapis układu zachował akcje, zapis akcji zachował układ, przywrócenie obu usunęło wartość. Zrzuty tk27-a, tk27-b (poprawka: ucinane etykiety w selektach — skrócone).
Znaleziony i naprawiony przez test: `hasActions({rb: null})` dawało pusty `actions={}` w literale.
Do wiadomości: (1) nie przetestowano na prawdziwym urządzeniu (Deck/czytnik) — testy używają atrap KOReadera; na Decku kopad żyje w /opt/koreader-shared/plugins i wymaga skopiowania nowych padmap.lua + padnav.lua. (2) Serwer koligilo sprzed TASK-27 odrzuca zapis z `actions` — najpierw wdrożyć serwer (restart), potem edytować w panelu; aplikacja desktopowa na Macu ma wbudowany stary panel do przebudowy. (3) Akcje działają tylko w czytaniu — w nakładce zaznaczania i słowniku role nadal mają stałe znaczenie (zakres PC-014, możliwe rozszerzenie). (4) Wersja koligilo nie była podbijana (brak publikacji).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Ustawienia KOPada pozwalają teraz zmienić nie tylko mapowanie przycisków, ale i to, co dana rola robi w czytaniu (np. RB = menu górne zamiast następnej strony); nowy klucz `actions` w padmap, karta w panelu i obsługa w wtyczce kopad
<!-- SECTION:FINAL_SUMMARY:END -->
