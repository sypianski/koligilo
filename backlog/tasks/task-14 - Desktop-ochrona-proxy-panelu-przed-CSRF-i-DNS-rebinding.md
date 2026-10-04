---
id: TASK-14
title: 'Desktop: ochrona proxy panelu przed CSRF i DNS rebinding'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 12:21'
updated_date: '2026-09-28 12:26'
labels:
  - bezpieczenstwo
  - desktop
dependencies: []
priority: high
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Panel desktopowy (desktop.go) nasłuchuje na 127.0.0.1 i dokleja token admina do każdego żądania /api/admin/* (reverse proxy), bez sprawdzania Origin/Host. Dowolna strona w tej samej przeglądarce może wysłać żądanie (np. multipart upload wtyczki, przypisanie wtyczki, zatwierdzenie parowania, POST /api/local/config zmieniający serwer) i proxy je uwierzytelni. Dodatkowo DNS rebinding pozwala czytać /api/admin/state. Naprawa: middleware na całym mux desktopu — Host musi być 127.0.0.1:<port> / localhost:<port>; dla metod innych niż GET/HEAD wymagany Origin równy origin panelu (brak Origin → odrzuć) ORAZ własny nagłówek (np. X-Koligilo: 1) doklejany przez web/app.js we wszystkich fetch (api, apiUpload, apiRaw). Tryb serwera (koligilo serve) używa Bearer z JS, bez ciasteczek — nie jest podatny, ale nie może się zepsuć.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Żądanie do proxy z obcym Origin albo bez nagłówka X-Koligilo → 403, nic nie trafia do serwera
- [x] #2 Żądanie z obcym Host (DNS rebinding) → 403 także dla GET
- [x] #3 Panel (app.js) działa: wszystkie wywołania mają nagłówek, upload multipart przechodzi
- [x] #4 Testy Go dla middleware (Origin, Host, nagłówek, GET vs POST); make test i make e2e zielone
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Dowody: guard_test.go (TestGuard 11 podtestów + TestGuardStaticIgnoresOrigin) zielone po scaleniu; agent sprawdził curl-em na żywym procesie (obcy Origin 403, obcy Host 403 dla GET, bez nagłówka 403, poprawny 200); dyrygent potwierdził, że wszystkie 6 fetch w app.js mają X-Koligilo (api/apiRaw/apiUpload + 3 bezpośrednie); make test + e2e 73/73. Proxy usuwa Cookie i X-Koligilo przed przekazaniem.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
guard(): Host na białej liście, X-Koligilo dla /api/*, Origin dla mutacji — panel desktop odporny na CSRF i DNS rebinding
<!-- SECTION:FINAL_SUMMARY:END -->
