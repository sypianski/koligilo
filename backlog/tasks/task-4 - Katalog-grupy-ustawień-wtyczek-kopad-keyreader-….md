---
id: TASK-4
title: 'Katalog: grupy ustawień wtyczek (kopad, keyreader, …)'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 11:47'
updated_date: '2026-09-28 11:58'
labels:
  - serwer
  - ustawienia
dependencies: []
priority: low
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Panel edytuje tylko to, co jest w catalog.go. Dodać grupy dla plików ustawień używanych wtyczek (np. settings/kopad.lua, settings/kokeyboard.lua, settings/assistant.lua, settings/rosetta.lua), domyślnie wyłączone. Przejrzeć każdy plik pod kątem kluczy zależnych od urządzenia i sekretów (klucze API assistant → Secret).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Nowe grupy mają opis, Warning tam, gdzie trzeba, i poprawne Secret
- [x] #2 Żaden klucz z Sync.DEVICE_KEYS nie wchodzi do nowych grup
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC1: 5 grup (kopad, klawiatura, asystent, rosetta_ustawienia, rosetta_klucze[Secret]); klucze zgodne z plikami w dotfiles, paraligilo_path i book__* pominięte. AC2: TestCatalogExcludesDeviceKeys (kopia DEVICE_KEYS w teście — trzeba ją aktualizować przy zmianie sync.lua). Weryfikacja: make test zielony. Pominięte pliki do ew. rozszerzenia: marjenoti, kotheme, hairline, boustrophedon, progresbreto, telegramdownloader, text_editor, appstore.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Grupy katalogu dla ustawień wtyczek kopad, kokeyboard, assistant, rosetta
<!-- SECTION:FINAL_SUMMARY:END -->
