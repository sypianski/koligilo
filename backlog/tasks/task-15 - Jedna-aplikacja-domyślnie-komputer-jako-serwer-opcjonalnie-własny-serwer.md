---
id: TASK-15
title: 'Jedna aplikacja: domyślnie komputer jako serwer, opcjonalnie własny serwer'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 14:51'
updated_date: '2026-09-28 15:25'
labels:
  - desktop
  - architektura
dependencies: []
priority: medium
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dziś tryb desktop to tylko panel + proxy do zewnętrznego serwera, a żeby komputer był serwerem trzeba odpalić dwa procesy (koligilo serve + koligilo, patrz scripts/mac-start.sh). Cel: jeden proces. DOMYŚLNIE komputer jest serwerem (wbudowany serve: sync ustawień, magazyn wtyczek, galeria; czytniki znajdują go przez discovery UDP w Wi-Fi albo parowanie kablem), panel lokalny bez proxy. OPCJA w ustawieniach panelu 'Mój serwer' (adres + token admina) — wtedy komputer jest tylko panelem (obecne zachowanie proxy). Przenosiny danych między trybami: eksport stanu (state.json + magazyn wtyczek + cache galerii) z komputera na serwer (i z powrotem) bez ponownego parowania czytników — tokeny urządzeń muszą przetrwać, a czytniki dostać nowy adres (np. przy następnym sync odpowiedź 'przeniesiono na <url>' albo przez rendezvous). Uczciwy komunikat w UI: w trybie komputera czytniki synchronizują się tylko, gdy komputer jest włączony i widoczny (ta sama sieć/Tailscale); zmiany czekają na czytniku. Zachować ochronę guard() (CSRF/DNS rebinding) — w trybie lokalnym panel admina nie może być dostępny z LAN, a API urządzeń musi (osobne nasłuchy albo ścisły podział tras).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Pierwsze uruchomienie 'koligilo' bez argumentów daje działający serwer + panel w jednym procesie; czytnik w tym samym Wi-Fi paruje się bez wpisywania adresu
- [x] #2 Przełączenie na 'Mój serwer' w panelu działa bez restartu i bez utraty danych lokalnych
- [x] #3 Eksport/import stanu przenosi urządzenia, wartości i wtyczki; sparowany czytnik po przenosinach synchronizuje się z nowym serwerem bez ponownego parowania
- [x] #4 API admina w trybie lokalnym niedostępne z LAN (test), API urządzeń dostępne
- [x] #5 scripts/mac-start.sh uproszczony albo usunięty; README opisuje oba tryby
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Dowody: make test (Go + lua 107/40), make e2e exit 0 (73 + 10 przenosiny + tryb komputera na prawdziwej binarce); TestLocalListenerSplit (admin/UI 404 na nasłuchu czytników, obcy Host 403), TestModeSwitch, TestMoveOutAndBack (409 needs_replace, replace, stary token działa, 410 moved_to, powrót), TestImportRejectsTampered, TestConfigMigration — dyrygent sprawdził, że stara konfiguracja z adresem serwera → tryb remote (Mac usera z https://koligilo.sypian.ski zostaje na VPS). Wersja podbita do 0.4.0 (main.go, _meta.lua) — NIEWDROŻONA. Decyzje domyślne (a–f) opisane w raporcie: w trybie 'Mój serwer' komputer nie przyjmuje sync (503); https→http przekierowanie tylko na adresy prywatne/Tailscale/.local/.ts.net; niesparowane czytniki nie są przekierowywane; samo przełączenie nie przenosi danych. Do testu na Macu/czytniku: firewall macOS na :7210, discovery z Tailscale, ścieżka 410 w prawdziwym KOReaderze. Brak UI do importu pliku z panelu (jest CLI i endpoint).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Jedna aplikacja: komputer jako serwer (2 nasłuchy, guard), opcja Mój serwer bez restartu, eksport/import z migracją czytników przez 410 moved_to
<!-- SECTION:FINAL_SUMMARY:END -->
