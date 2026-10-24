---
id: TASK-39
title: Samoaktualizacja pluginu koligilo za zgodą na czytniku
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-24 19:30'
updated_date: '2026-10-24 19:35'
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
<!-- SECTION:NOTES:END -->
