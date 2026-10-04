---
id: TASK-22
title: 'Wspólne ustawienia po ludzku: nazwy, teksty i kontrolki jak w KOReaderze'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 16:41'
updated_date: '2026-09-29 17:33'
labels:
  - ui
  - ustawienia
dependencies:
  - TASK-21
priority: high
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Widok „Wspólne ustawienia” jest dziś techniczny: ID typu settings.reader.lua#copt_line_spacing, literały Lua, edytor surowej wartości. Cel: ustawienia wyświetlane tak, jak nazywa je KOReader i tym samym tekstem (po polsku z tłumaczeń KOReadera), pogrupowane jak w menu czytnika: Czcionka (krój, rozmiar, pogrubienie, gamma/kontrast), Układ (marginesy, interlinia, odstęp słów, wcięcie, justowanie, dzielenie wyrazów), Poprawki stylu, Stopka, Gesty itd.
Źródło nazw i zakresów: frontend/ui/data/creoptions.lua (opcje dolnego menu: nazwy, values, labels, domyślne), frontend/ui/elements/*, apps/reader/modules/readerfooter.lua, style tweaks z css_tweaks.lua; teksty PL z koreader-translations (pl_PL/koreader.po). Mapę klucz → {etykieta, opis, typ kontrolki, wartości, jednostka} trzymać w jednym pliku danych (np. web/koreader_opts.js lub JSON generowany skryptem z repo KOReadera przypiętego do tagu), żeby dało się ją odświeżać przy nowych wersjach.
Kontrolki jak w KOReaderze: przełączniki (toggle), przyciski segmentowe (np. interlinia), suwak/stepper z jednostką (pt, %), lista czcionek. Klucze bez mapy spadają do „Zaawansowane” (dzisiejszy edytor literałów), zwinięte domyślnie. Serializacja dalej przez literały Lua — kontrolka generuje literał identyczny z Sync.serialize (luavalue.go/TestLuaMatchesPlugin).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Znane klucze pokazane nazwą i opisem z KOReadera (PL), z kontrolką odpowiadającą typowi
- [x] #2 Surowe ID i literały Lua schowane w sekcji „Zaawansowane”, domyślnie zwiniętej
- [x] #3 Zapis z kontrolki daje literał bajt w bajt jak Sync.serialize (test)
- [x] #4 Mapa opcji w jednym pliku danych ze skryptem odświeżania i wersją KOReadera, z której pochodzi
- [x] #5 make test i make e2e zielone; zrzuty przed/po
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Źródła: KOReader v2026.07.2 + koreader-translations z commitu submodułu l10n tego tagu (pl/koreader.po).
2. scripts/koreader-opts.sh (klon tagu + l10n do cache) + scripts/koreader-opts.lua: wykonuje creoptions.lua i css_tweaks.lua z atrapami require (Device, G_defaults z defaults.lua, gettext → tłumaczenie z .po, pgettext z msgctxt), plus mała ręczna mapa (stopka, listy, czcionki) z msgid tłumaczonymi przez .po; zapis web/koreader_opts.js (wersja KOReadera, commit l10n, data).
3. web/lua.js: luaSerialize (lustro Sync.serialize, %.17g przez BigInt z round-half-even, sortowanie kluczy: liczby, potem napisy bajtowo UTF-8) i luaParse (format serialize, bez eval); tests/luaser_test.js porównuje z Sync.serialize (lua) bajt w bajt; dopięte do make test.
4. web/app.js: widok „Wspólne ustawienia” pogrupowany jak menu KOReadera (Czcionka, Układ, Poprawki stylu, Stopka, …); kontrolki: toggle, segmenty (role=radiogroup), stepper z jednostką, para lewo/prawo, lista czcionek (wartości obecne + wpisanie), lista poprawek stylu z checkboxami; wartość spoza presetów pokazana liczbą; meta „z urządzenia · kiedy”; S.valSel pod TASK-23. Klucze bez mapy → „Zaawansowane” (dotychczasowy edytor literałów), zwinięte domyślnie; tam też surowe ID/literał dla znanych.
5. index.html + style.css (Latte/Mocha, AA, klawiatura).
6. make test, make e2e, zrzuty przed/po chromium headless do scratchpadu.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Weryfikacja dyrygenta: AC1 zrzuty scratchpad/task22 (c-po-widok-0, c-po-ciemny-widok-1) — 7 sekcji z nazwami z .po, presety/toggle/stepper, „z: urządzenie · kiedy”. AC2 <details class=adv> „Zaawansowane” zwinięte. AC3 tests/luaser_test.js 182 wartości zgodne z Sync.serialize (w make test). AC4 web/koreader_opts.js generowany (v2026.07.2, l10n be4726d0fa58), make koreader-opts TAG=…. AC5 make test + e2e exit 0. Respawn 1: brak etykiety wiersza cre_font, artefakty „▶/- ” w opisach → poprawione w generatorze + asercje. Punkt zaczepienia TASK-23: valSelect(id) → S.valSel, .srow.sel. Poza mapą (→ Zaawansowane): collate, start_with, gesty, słowniki, profile.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wspólne ustawienia z nazwami, opisami i kontrolkami KOReadera (PL), surowe literały w „Zaawansowane”
<!-- SECTION:FINAL_SUMMARY:END -->
