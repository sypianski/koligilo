---
id: TASK-55
title: >-
  Słowniki: ściąganie (katalog KOReadera + wgranie) i synchronizacja plików
  słowników między czytnikami
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-25 19:01'
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
- [ ] #1 Serwer: magazyn <dane>/dicts/<sha256>.zip; przyjmuje zip/tar.gz/tar.bz2/tar.zst, waliduje StarDict (.ifo+.idx+.dict[.dz]), normalizuje do ZIP-a, limity 300 MB
- [ ] #2 Serwer: katalog słowników z KOReadera (generowany skryptem) + pobieranie tylko z dozwolonych hostów, przekierowania tylko na dozwolone hosty, limit rozmiaru, https
- [ ] #3 API: /api/v1/sync?dicts_allowed=1 zwraca listę docelową; /api/v1/dicts/<sha256> tylko za zgodą; raport inwentarza; wysyłka z czytnika czeka na akceptację
- [ ] #4 Plugin: zgoda „Synchronizuj słowniki” w Zgody…, pobieranie strumieniowe do pliku z sha256, instalacja do data/dict/koligilo/<nazwa>/ tylko z manifestem, ręcznych nie ruszamy
- [ ] #5 Panel: zakładka „Słowniki” — katalog z wyszukiwarką/filtrem języka, wgranie, lista, akceptacja, usunięcie, stan per urządzenie
- [ ] #6 Testy Go, Lua, e2e; transfer.go (eksport/import); decyzja PC; dokumentacja (CLAUDE.md, ARCHITEKTURA)
<!-- AC:END -->
