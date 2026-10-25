---
id: TASK-45
title: 'Wtyczka: opt-in pobierania artykułów Wallabag po synchronizacji'
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-25 11:13'
updated_date: '2026-10-25 11:24'
labels:
  - plugin
dependencies: []
priority: low
ordinal: 45000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wtyczka Wallabag ma zdarzenie SynchronizeWallabag. Analogicznie do merge_after_sync (TASK-42): osobny opt-in w menu koligilo (np. wallabag_after_sync) z jasnym opisem, że pobiera pliki i bywa wolne; wysyłać tylko gdy konto Wallabag jest ustawione i synchronizacja nie zmieniła ustawień. Najpierw sprawdzić, czy zdarzenie bez argumentu jest ciche i czy nie nadpisuje otwartej książki.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Najpierw sprawdzone w źródle wallabag.koplugin (https://raw.githubusercontent.com/koreader/koreader/master/plugins/wallabag.koplugin/main.lua), czy zdarzenie SynchronizeWallabag bez argumentu jest ciche i nie rusza otwartej książki; wynik w notatce. Jeśli NIE jest bezpieczne w tle — zadanie kończy się notatką i statusem To Do z uzasadnieniem, bez kodu
- [ ] #2 Opt-in wallabag_after_sync w menu koligilo (ConfirmBox z opisem: pobiera pliki i bywa wolne), domyślnie wyłączony, zgoda tylko z czytnika; decyzja w czystej funkcji Sync (jak Sync.mergeEvents: tylko za zgodą i gdy synchronizacja nie zmieniła ustawień) z testami
- [ ] #3 Testy w tests/installer_test.lua (atrapa broadcastEvent), make test i make e2e zielone
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Odrzucone na tym etapie: Wallabag:onSynchronizeWallabag nie jest ciche — pokazuje InfoMessage 'Connecting…', 'Downloaded article N of M…', na końcu okno 'Sync finished' bez timeout, przy niepełnej konfiguracji MultiConfirmBox, i pobiera synchronicznie (blokuje UI); w odróżnieniu od statystyk/słowniczka nie ma trybu interactive=nil. Opcja na później: wysyłać zdarzenie tylko gdy czytnik jest w FileManagerze (nie w dokumencie), ale okno końcowe i tak zostaje. AC2/AC3 niespełnione celowo (brak kodu).
<!-- SECTION:NOTES:END -->
