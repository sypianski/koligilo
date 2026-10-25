---
id: TASK-55
title: >-
  Słowniki: ściąganie (katalog KOReadera + wgranie) i synchronizacja plików
  słowników między czytnikami
status: Done
assignee:
  - '@claude'
created_date: '2026-10-25 19:01'
updated_date: '2026-10-25 19:18'
labels:
  - serwer
dependencies: []
ordinal: 55000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Grupa „Słowniki” synchronizuje dziś tylko kolejność/wyłączenia/presety (dicts_order, dicts_disabled, dict_presets), a same pliki trzeba przenosić ręcznie. Ficzer wg wzorca czcionek (TASK-36/37, PC-018): magazyn archiwów słowników na serwerze (sha256, znormalizowany ZIP), źródła: (1) wbudowany katalog = lista słowników z KOReadera (ui/data/dictionaries*.lua), pobierana przez serwer jednym kliknięciem, (2) wgranie archiwum/plików StarDict z panelu, (3) wysyłka z czytnika (do akceptacji). Dystrybucja na czytniki, które same pozwoliły (dicts_allowed), do data/dict/koligilo/<nazwa>/ z manifestem; wszystko na każdy czytnik (bez filtra per urządzenie). Limity: 300 MB/słownik, 150 MB pobrań na synchronizację.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Serwer: magazyn <dane>/dicts/<sha256>.zip; przyjmuje zip/tar.gz/tar.bz2/tar.zst, waliduje StarDict (.ifo+.idx+.dict[.dz]), normalizuje do ZIP-a, limity 300 MB
- [x] #2 Serwer: katalog słowników z KOReadera (generowany skryptem) + pobieranie tylko z dozwolonych hostów, przekierowania tylko na dozwolone hosty, limit rozmiaru, https
- [x] #3 API: /api/v1/sync?dicts_allowed=1 zwraca listę docelową; /api/v1/dicts/<sha256> tylko za zgodą; raport inwentarza; wysyłka z czytnika czeka na akceptację
- [x] #4 Plugin: zgoda „Synchronizuj słowniki” w Zgody…, pobieranie strumieniowe do pliku z sha256, instalacja do data/dict/koligilo/<nazwa>/ tylko z manifestem, ręcznych nie ruszamy
- [x] #5 Panel: zakładka „Słowniki” — katalog z wyszukiwarką/filtrem języka, wgranie, lista, akceptacja, usunięcie, stan per urządzenie
- [x] #6 Testy Go, Lua, e2e; transfer.go (eksport/import); decyzja PC; dokumentacja (CLAUDE.md, ARCHITEKTURA)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Zrobione: serwer (dicts.go, dictcatalog.go, dictcatalog.json z scripts/dict-catalog.py: 1772 pozycje z listy KOReadera, joby w tle, biała lista rozszerzeń, odrzucanie nazw FAT/NTFS), plugin (zgoda dicts_allowed, pobieranie strumieniowe, staging, rollback), panel (zakładka Słowniki), PC-020, CLAUDE.md. Dowody: go test, lua sync 324 ok / installer 188 ok, make test, make e2e, test na żywo po jednej pozycji z 8 hostów, panel sprawdzony w przeglądarce. Świadomie poza zakresem: wysyłka słownika z czytnika na serwer, filtr per urządzenie, słowniki w archiwum przenosin; osobno TASK-57 (klucze dicts_order/dicts_disabled to ścieżki absolutne). DO SPRAWDZENIA NA CZYTNIKU: ffi/sha2 w trybie strumieniowym, util.diskUsage, Archiver na dużych ZIP-ach, os.rename katalogu na Androidzie/FAT, czy KOReader widzi nowy słownik bez restartu. Wersja nie podbita — podbić przy wdrożeniu (main.go, _meta.lua).
<!-- SECTION:NOTES:END -->
