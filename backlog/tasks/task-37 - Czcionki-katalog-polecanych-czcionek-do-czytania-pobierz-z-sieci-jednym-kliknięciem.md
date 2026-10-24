---
id: TASK-37
title: >-
  Czcionki: katalog polecanych czcionek do czytania (pobierz z sieci jednym
  kliknięciem)
status: Done
assignee:
  - '@claude'
created_date: '2026-10-24 15:24'
updated_date: '2026-10-24 15:31'
labels:
  - serwer
dependencies:
  - TASK-36
priority: medium
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Zakładka „Czcionki” (TASK-36) wymaga ręcznego wgrania plików. Dodać wbudowany katalog sprawdzonych czcionek o otwartych licencjach (SIL OFL / Apache), które serwer pobiera sam, jednym kliknięciem, do magazynu. Każdy wpis przypięty do konkretnego URL-a i sha256 (jak galeria wtyczek do commita), pobierany tylko z listy dozwolonych hostów, z wyświetlaną licencją.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Katalog (Go, jedno źródło prawdy jak catalog.go): nazwa, krój, licencja, URL pliku, sha256, rozmiar, opis po polsku, pismo (łaciński/grecki/arabski/cyrylica)
- [x] #2 Panel: sekcja „Polecane do czytania” z rozmiarem (podgląd odłożony), i przyciskiem „Dodaj” oraz „Dodaj zestaw”
- [x] #3 Serwer pobiera tylko z listy dozwolonych hostów, bez przekierowań na inny host, z limitem rozmiaru, i odrzuca plik o innym sha256 niż w katalogu
- [x] #4 Pobrana czcionka od razu zaakceptowana (źródło „katalog”), trafia na czytniki ze zgodą jak każda inna
- [x] #5 Testy: serwer HTTP udający hosta czcionek, zła suma sha256, host spoza listy, przekierowanie
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Zrobione: katalog 11 rodzin × 4 style (Literata, Source Serif 4, EB Garamond, Merriweather, Lora, Noto Serif, Charis, Gentium Book, Amiri, Atkinson Hyperlegible, OpenDyslexic), 19 MB, wszystko SIL OFL 1.1 (Noto Serif: OFL potwierdzone w tabeli name czcionki; repo ma Apache dla kodu), adresy przypięte do commitów, sha256 policzone z pobranych plików. Generator: scripts/font-catalog.py. Serwer: POST /api/admin/font-catalog/{id}, lista dozwolonych hostów, brak przekierowań, zgodność sha256. Panel: sekcja «Polecane do czytania» + «zestaw startowy» (Literata, Source Serif 4, Atkinson). Sprawdzone na prawdziwym GitHubie (rodzina w <1 s). Odłożone: podgląd kroju w panelu (AC 2 bez «podglądu»); Alegreya pominięta — repo autora nie ma gotowych plików. Do przeglądu: komplet 4 stylów wymusza test integralności (TestFontCatalogIntegrity); dopisz rodzinę przez skrypt.
<!-- SECTION:NOTES:END -->
