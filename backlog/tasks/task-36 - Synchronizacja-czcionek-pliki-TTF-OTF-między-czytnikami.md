---
id: TASK-36
title: 'Synchronizacja czcionek: pliki TTF/OTF między czytnikami'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-24 15:07'
updated_date: '2026-10-24 15:18'
labels:
  - panel
dependencies: []
priority: medium
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Grupa „fonty” synchronizuje tylko WYBÓR czcionki (cre_font…), a nie same pliki — na czytniku bez tych plików KOReader wraca do domyślnej. Ficzer: magazyn czcionek na serwerze (pliki adresowane sha256, jak wtyczki), dystrybucja do czytników, które same na to pozwoliły, plus wysyłka czcionki z czytnika na serwer. Czcionki to dane, nie kod, więc bez potwierdzenia każdej zmiany — ale wciąż opt-in na czytniku, sha256 i twarde limity (patrz PC-018).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Panel: widok „Czcionki” — wgranie TTF/OTF/TTC/OTC (do 40 MB), lista z rozmiarem i źródłem, usunięcie, akceptacja czcionek wysłanych z czytnika
- [x] #2 Serwer: magazyn <dane>/fonts/<sha256>.<ext>, walidacja nazwy, rozszerzenia i magic bytes; GET /api/v1/sync?fonts_allowed=1 zwraca listę docelową tylko dla czytnika, który zgłosił zgodę; pobieranie /api/v1/fonts/<sha256> tylko dla takiego czytnika
- [x] #3 Plugin: menu „Pozwól synchronizować czcionki”, instalacja do <dane KOReadera>/fonts/koligilo/ z weryfikacją sha256, usuwanie wyłącznie plików z własnego manifestu, ręcznie dodanych nigdy nie ruszamy
- [x] #4 Plugin: „Wyślij czcionkę na serwer…” — czcionka z czytnika trafia do magazynu jako niezaakceptowana, do czasu akceptacji w panelu nie jest dystrybuowana
- [x] #5 Panel pokazuje per urządzenie: zgodę, zainstalowane czcionki i czego brakuje; ostrzeżenie grupy „fonty” odsyła do tej funkcji
- [x] #6 Testy: Go (magazyn, walidacja, sync/zgoda, pobieranie), Lua (plan instalacji/usunięcia, manifest), e2e (czcionka z panelu trafia na dwa symulowane czytniki), make test zielony
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Zrobione: serwer (fonts.go, magazyn sha256, zgoda ?fonts_allowed=1, upload z panelu i z czytnika + akceptacja, eksport/import w transfer.go), plugin (sync.lua fontPlan/manifest, main.lua menu «Synchronizuj czcionki» + «Wyślij czcionkę na serwer…», instalacja do fonts/koligilo), panel (zakładka «Czcionki»). Tryb komputera (bez serwera) działa tak samo — logika w Store/Server; sprawdzone w run_e2e.sh (wgranie przez panel → pobranie przez :DP). Decyzja: PC-018 (libraro). Dowody: go test (fonts_test.go), lua tests/sync_test.lua 147 ok, installer_test.lua 59 ok, make e2e 98 ok + tryb komputera. DO SPRAWDZENIA NA CZYTNIKU: czy KOReader skanuje fonts/koligilo/ rekurencyjnie i czy nowa czcionka pojawia się po restarcie; zachowanie na Androidzie (rename nad istniejącym plikiem). Nie zrobione (świadomie): przypisanie czcionek per urządzenie (dziś wszystkie zaakceptowane idą na każdy czytnik ze zgodą); wersja nie podbita — podbić przy wdrożeniu.
<!-- SECTION:NOTES:END -->
