---
id: TASK-38
title: 'UX panelu: warianty ekranu „Czcionki”'
status: Done
assignee: []
created_date: '2026-10-24 19:23'
updated_date: '2026-10-24 19:52'
labels:
  - ux
dependencies: []
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Selektor wariantów dla zakładki „Czcionki” (web/app.js: fontsTab, fontCatalogCard, fontDeviceRow). Powiązane: TASK-36, TASK-37.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Wdrożone w trzech commitach lokalnych wg zatwierdzonego wyboru (artefakt wybor/czcionki-panel): A — zakładki Biblioteka·Katalog·Czytniki, zdanie stanu, baner akceptacji, strefa upuszczania, filtr pisma (Tags w katalogu), rodziny zamiast tabeli plików; B — próbka kroju (GET /api/admin/fonts/{sha}/file, FontFace z bufora); C — przydział rodzin do czytników (Device.FontsOff, POST /api/admin/fonts/assign, macierz rodzina × czytnik). Rodzina liczona jedną regułą w Go i JS. Sprawdzone: make test, make e2e, przebieg w prawdziwej przeglądarce na serwerze testowym; na czytniku nie oglądano (czy KOReader po usunięciu pliku z fonts/koligilo/ nie trzyma go w pamięci do restartu — do sprawdzenia). Nie podbito wersji ani nie wdrożono.
<!-- SECTION:NOTES:END -->
