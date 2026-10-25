---
id: TASK-47
title: 'Panel: karta Asystent AI (assistant) w Ustawieniach wtyczek'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-25 11:13'
updated_date: '2026-10-25 11:31'
labels:
  - ux
  - panel
dependencies: []
priority: medium
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Grupa asystent jest w katalogu (provider, response_language, dict_language, dict_popup_*, use_stream_mode, stream_mode_auto_scroll, large_stream_dialog, auto_copy_asked_question), ale w panelu nie ma kontrolek (tylko Zaawansowane). Zrobić kartę jak ROSETTA_OPTS (TASK-40): settingRow/control, domyślne zgodne z wtyczką, wskazówka że klucze API leżą w lokalnym configuration.lua czytnika. Rozważyć też kartę dla klawiatury ekranowej (prefiks całego pliku kokeyboard.lua).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Karta Asystent AI w Wtyczki → Ustawienia wtyczek przez ten sam mechanizm co ROSETTA_OPTS (web/app.js: settingRow/control, ustawienia z catalog.go grupy asystent), z domyślnymi zgodnymi z wtyczką assistant.koplugin (sprawdzić w źródle w ~/modi/koreader/koplugins/assistant.koplugin) i wskazówką, że klucze API są w lokalnym configuration.lua czytnika i się nie synchronizują
- [x] #2 Ostrzeżenie gdy provider wskazuje dostawcę, dla którego nic nie wiadomo o kluczu — NIE zgadywać; tylko tekst pomocy. Ustawienia assistant oznaczone jako mapped w valuesTab (nie liczą się do Zaawansowane)
- [x] #3 Rozważona karta Klawiatura ekranowa (kokeyboard: label_order, label_style) jako prosty wybór; make test zielony
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Karta Asystent AI (ASSISTANT_OPTS), domyślne tylko potwierdzone w źródle wtyczki; provider jako tekst z ostrzeżeniem (wtyczka nadpisuje nieistniejącego dostawcę); klucze API w lokalnym configuration.lua, nie synchronizują się. Klawiatura ekranowa pominięta: label_order/label_style występują w keyreader.koplugin (settings/keyreader.lua), nie w kokeyboard — źródła kokeyboard brak lokalnie. Wniosek: warto osobno rozważyć grupę katalogu dla settings/keyreader.lua. Uwaga na TASK-43: configuration.lua w katalogu wtyczki assistant może zawierać klucze, a ZIP wtyczki jedzie na serwer.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Ustawienia Asystenta AI mają kartę w Ustawieniach wtyczek
<!-- SECTION:FINAL_SUMMARY:END -->
