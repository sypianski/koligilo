---
id: TASK-8
title: 'Plugin Lua: instalator wtyczek'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 11:48'
updated_date: '2026-09-28 12:15'
labels:
  - wtyczki
  - plugin
dependencies:
  - TASK-7
priority: high
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Czysta logika w sync.lua (plan: instaluj/aktualizuj/usuń na podstawie stanu docelowego i inwentarza, z testami w tests/sync_test.lua), a I/O w main.lua. Przełącznik w menu 'Pozwól instalować wtyczki' (domyślnie off). Przed zmianą okno potwierdzenia z listą wtyczek i wersji. Pobranie, sprawdzenie sha256, rozpakowanie do katalogu tymczasowego, atomowa podmiana z kopią poprzedniej wersji (rollback), znacznik .koligilo w zarządzanych katalogach. Na koniec prośba o restart KOReadera. Sprawdzić, czego do rozpakowania używa KOReader (ffi/archiver) na Kindle/Kobo/Androidzie.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Bez zgody użytkownika na czytniku nic nie jest instalowane ani usuwane
- [x] #2 Zła suma sha256 przerywa instalację bez naruszania starej wersji
- [x] #3 Usuwane są tylko katalogi ze znacznikiem .koligilo
- [x] #4 Testy planu w tests/sync_test.lua; make test przechodzi
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Dowody: make test (sync_test 86 ok, installer_test 32 ok — prawdziwy main.lua z atrapami KOReadera), make e2e 67 ok. AC1: operacje tylko w ok_callback ConfirmBox, bez przełącznika brak plugins_allowed. AC2: sha256 liczone przed zapisem, stara wersja nietknięta. AC3: plan + ponowne sprawdzenie znacznika na dysku. Dyrygent potwierdził w upstream pluginloader.lua (entry:sub(-9)=='.koplugin'), że katalogi z kropką są ładowane → katalogi robocze bez końcówki .koplugin. Wymaga KOReadera ≥ 2025.08 (ffi/archiver). Do testu na czytniku: extract/rename na /sdcard i FAT, sha256 w Lua na 20 MB, https. make test wymaga teraz zip/unzip/sha256sum/python3. Otwarte: inwentarz wysyłany także przy wyłączonej zgodzie.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Instalator wtyczek w pluginie: zgoda na czytniku, potwierdzenie, sha256, atomowa podmiana z rollbackiem, znacznik .koligilo
<!-- SECTION:FINAL_SUMMARY:END -->
