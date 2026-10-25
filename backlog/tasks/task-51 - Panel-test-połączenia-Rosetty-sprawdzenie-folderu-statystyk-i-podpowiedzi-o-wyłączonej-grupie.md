---
id: TASK-51
title: >-
  Panel: test połączenia Rosetty, sprawdzenie folderu statystyk i podpowiedzi o
  wyłączonej grupie
status: Done
assignee:
  - '@claude'
created_date: '2026-10-25 11:13'
updated_date: '2026-10-25 11:31'
labels:
  - panel
dependencies: []
priority: medium
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dokończenie TASK-40/42: (a) Rosetta jedyna bez Sprawdź połączenie w conncheck.go — mały testowy request na zapisany adres z zapisanym kluczem (tylko zapisane konto, bez SSRF z formularza); (b) sprawdzenie, czy folder statystyk/słowniczka istnieje na koncie, z przyciskiem Utwórz folder; (c) w Co synchronizować podpowiedź, gdy grupa konta jest włączona, a konta w Kontach brak.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 conncheck.go: test połączenia Rosetty (POST /api/admin/accounts/rosetta/test): tylko zapisane konto, mały request chat/completions (max_tokens ~5) na zapisany adres z zapisanym kluczem, bez przekierowań, wynik {ok,message} bez sekretów, nieudany test = HTTP 200 ok:false, 409 gdy konta nie ma; testy Go w stylu istniejących
- [x] #2 Sprawdzenie folderu statystyk/słowniczka na koncie (WebDAV PROPFIND Depth 0 jak w conncheck dla WebDAV; dla Dropbox/FTP komunikat że sprawdzenie nie jest wspierane) z przyciskiem Sprawdź folder w widoku Statystyki i słowniczek
- [x] #3 Podpowiedź w Co synchronizować: grupa konta (kosync, wallabag, chmura, statystyki, rosetta, opds) włączona dla czytnika, a konta w Konta brak — komunikat z odnośnikiem do Konta; make test zielone
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Test połączenia Rosetty, sprawdzenie folderu statystyk/słowniczka (WebDAV; Dropbox/FTP: brak wsparcia, ok:false), podpowiedź w Co synchronizować. Poza zakresem: Utwórz folder (WebDAV MKCOL — proste).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Panel testuje połączenie Rosetty i folder statystyk oraz ostrzega o włączonej grupie bez konta
<!-- SECTION:FINAL_SUMMARY:END -->
