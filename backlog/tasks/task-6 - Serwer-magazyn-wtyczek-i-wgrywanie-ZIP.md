---
id: TASK-6
title: 'Serwer: magazyn wtyczek i wgrywanie ZIP'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 11:48'
updated_date: '2026-09-28 12:04'
labels:
  - wtyczki
  - serwer
dependencies:
  - TASK-5
priority: high
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Katalog plugins/ obok state.json: każda wersja jako ZIP adresowany sha256 + metadane w stanie (nazwa katalogu *.koplugin, wersja i opis z _meta.lua, źródło: upload/galeria/urządzenie, data). API admina: POST /api/admin/plugins (upload multipart), GET lista, DELETE wersji. API urządzenia: GET /api/v1/plugins/{sha256}.zip (Bearer urządzenia, tylko dla przypisanych wtyczek). Walidacja ZIP-a: dokładnie jeden katalog *.koplugin, obecne _meta.lua i main.lua, brak ścieżek absolutnych i '..' (zip-slip), brak symlinków, limit rozmiaru. _meta.lua odczytywać parserem literałów, nie wykonywać.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Upload poprawnego ZIP-a zwraca sha256 i metadane
- [x] #2 ZIP ze zip-slip, symlinkiem, bez _meta.lua lub z wieloma katalogami → 400
- [x] #3 Urządzenie nie pobierze wtyczki nieprzypisanej do niego (403)
- [x] #4 Nazwa koligilo.koplugin jest odrzucana
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Dowody (go test -race): TestPluginUpload, TestPluginUploadRejects (zip-slip, abs, backslash, symlink, brak _meta/main, 2 katalogi, >20MB, koligilo/statistics.koplugin), TestPluginAssignSyncReport (403 nieprzypisana/inne urządzenie/bez zgody), TestPluginMetaParser (ekstraktor bez wykonywania), TestPluginZip. ZIP normalizowany (sha z bajtów po normalizacji). Approve dla źródła 'urządzenie' → TASK-13; wyciąganie katalogu z zipballa GitHuba → TASK-9.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Magazyn wtyczek: upload/lista/DELETE, walidacja i normalizacja ZIP, pobieranie przez urządzenie z kontrolą przypisania
<!-- SECTION:FINAL_SUMMARY:END -->
