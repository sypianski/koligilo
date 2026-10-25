---
id: TASK-48
title: 'Katalog: opds.lua (katalogi OPDS) jako konto synchronizowane'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-25 11:13'
updated_date: '2026-10-25 11:35'
labels:
  - catalog
  - panel
dependencies: []
priority: medium
ordinal: 48000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
opds.lua nie jest w catalog.go, a katalogi OPDS (np. Calibre) to konta wpisywane osobno na każdym czytniku. Dodać grupę Secret (hasła) i kartę w Konta jak cloud/kosync. Zbadać format opds.lua. Szerzej (decyzja projektowa, łamie zasadę catalog.go = jedyne źródło prawdy): funkcja dodaj plik ustawień do synchronizacji — wtyczka zgłasza listę plików i nazw kluczy bez wartości. Pozostałe niepokryte pliki: marjenoti, kotheme, hairline, boustrophedon, progresbreto, telegramdownloader, text_editor, appstore.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Nowa grupa katalogu konto_opds (Secret, Default true) dla settings/opds.lua klucz servers (hasła w katalogach OPDS); klucze downloads, pending_syncs, settings zostają lokalne; test TestCatalogExcludesDeviceKeys i test, że hasła nie wracają do przeglądarki (/api/admin/state)
- [x] #2 accounts.go: GET w /api/admin/accounts (lista bez haseł: title, url, username, has_password), PUT/DELETE pojedynczych pozycji w stylu cloud; walidacja url (http/https), zachowanie nieznanych pól wpisu; w panelu wiersz Katalogi OPDS w Konta (ACCOUNTS) z listą, dodaniem, edycją i usunięciem
- [x] #3 Szersza funkcja plik ustawień do synchronizacji NIE jest w zakresie (decyzja projektowa) — tylko notatka; make test i make e2e zielone
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Grupa konto_opds (Secret) z POST/DELETE /api/admin/accounts/opds, wiersz Katalogi OPDS w Kontach, hasła nie wracają do przeglądarki. DECYZJA dyrygenta: Default=false (nie true), bo servers to jedna wartość z lokalnymi polami sync_dir i last_download — last_download zmienia się po każdym pobraniu i wywoływałoby prośbę o restart na pozostałych czytnikach. Do zrobienia osobno: normalizacja wpisów w pluginie (wycinanie sync_dir/last_download przy wysyłaniu i zachowanie lokalnych przy scalaniu), potem można włączyć domyślnie. Brak Sprawdź połączenie dla OPDS.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Katalogi OPDS można synchronizować jako konto (domyślnie wyłączone) i edytować w Kontach
<!-- SECTION:FINAL_SUMMARY:END -->
