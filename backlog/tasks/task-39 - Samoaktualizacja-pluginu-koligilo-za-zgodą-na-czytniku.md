---
id: TASK-39
title: Samoaktualizacja pluginu koligilo za zgodą na czytniku
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-24 19:30'
updated_date: '2026-10-24 19:39'
labels:
  - plugin
dependencies: []
priority: medium
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Plugin koligilo.koplugin nie aktualizuje się sam (PC-004: instalator nigdy nie rusza koligilo.koplugin), więc każda nowa wersja wymaga ręcznego wgrania na każdy czytnik. Ficzer: czytnik przy synchronizacji dowiaduje się, że serwer ma nowszą wersję, pyta o zgodę na czytniku i dopiero wtedy pobiera zip, weryfikuje sha256 i podmienia siebie z odwracalnością (stara wersja zostaje, gdy coś się nie zgadza). Opt-in wyłącznie na czytniku, jak wtyczki (PC-004) i czcionki (PC-018). Decyzja i alternatywy: nowy rekord PC w libraro.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Decyzja PC zapisana w libraro/decyzje (zgoda tylko z czytnika, potwierdzenie z numerami wersji, sha256, odwracalność, co z downgrade'em i różnicą major)
- [x] #2 Serwer: zip pluginu jest serwowany z sha256 i wersją (GET /api/v1/sync?koligilo_version=... zwraca wskazanie nowszej wersji tylko czytnikowi, który zgłosił zgodę); wersja liczona z jednego źródła (_meta.lua)
- [x] #3 Plugin: menu „Aktualizuj koligilo” (zgoda opt-in) i okno potwierdzenia „koligilo X → Y, zainstalować?”; instalacja do katalogu roboczego, weryfikacja sha256, podmiana atomowa, stara wersja w .koligilo-old do czasu udanego startu; po instalacji prośba o restart KOReadera
- [x] #4 Bezpieczeństwo: brak aktualizacji bez zgody z czytnika; niezgodna suma lub zły zip przerywa bez naruszenia starej wersji; brak downgrade'u i wersji z innego źródła niż serwer czytnika; token i ustawienia (settings/koligilo.lua) nietknięte
- [x] #5 Testy: Lua (porównanie wersji, plan podmiany, odrzucenia), Go (zgoda, serwowanie, wersja), e2e na symulowanym czytniku; make test zielony
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Zrobione lokalnie, niezacommitowane i niewdrożone: plugin (sync.lua: versionParse/versionNewer/selfUpdateInfo/selfParentDir; main.lua: menu «Pozwól aktualizować koligilo», applySelfUpdate, handleSelfUpdate, cleanupSelfUpdate, restart_pending), serwer (plugin_dl.go: zip budowany raz + selfUpdateInfo; server.go: ?self_update=1), decyzja PC-019 w libraro, CLAUDE.md i README. Testy: sync_test.lua 167 ok, installer_test.lua 89 ok, plugin_dl_test.go, make e2e (3 nowe kroki), make test zielony. UWAGA z pracy: pierwszy test nadpisał prawdziwy plugin/ atrapą (sandbox nie był ustawiony na poziomie klasy); odzyskane z .koligilo-old-koligilo, bezpiecznik dodany w installer_test.lua. DO SPRAWDZENIA NA CZYTNIKU: rename katalogu pluginu na Androidzie (/sdcard, FUSE) i na Decku (/opt/koreader-shared/plugins w Flatpaku — może być tylko do odczytu), czy ConfirmBox/askForRestart działają w menedżerze plików. Wersja nie podbita; pierwsza wersja z tą funkcją musi być wgrana na czytniki ręcznie.

WDROŻONE 2026-10-24 jako koligilo 0.8.1 (commit d9089f7, PC-019 w libraro 01c0204): serwer VPS zrestartowany (origin = HEAD, zip z wersją 0.8.1; publiczny zip też 0.8.1), aplikacja na Macu przebudowana (stara: /Applications/koligilo.app.bak-0.8.0). CZYTNIKI NIEZAKTUALIZOWANE (tiket zostaje In Progress): Bigyo — Tailscale żyje, ale Termux:8022 odmawia (Android ubił Termux), SteamDeck — offline, Onyx NoteAir3C — offline, brak adb. Pierwsze wgranie 0.8.1 musi być ręczne (stary plugin nie zna samoaktualizacji); gotowy katalog na Macu: /Users/sypianski/tmp/koligilo-build-0.8.1/plugin/koligilo.koplugin. Cloudflare nie wyczyszczony (app.js, style.css, preview.js ~4 h).
<!-- SECTION:NOTES:END -->
