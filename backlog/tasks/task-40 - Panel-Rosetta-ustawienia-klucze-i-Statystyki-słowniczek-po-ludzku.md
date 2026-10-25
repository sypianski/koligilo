---
id: TASK-40
title: 'Panel: Rosetta (ustawienia + klucze) i Statystyki/słowniczek po ludzku'
status: Done
assignee: []
created_date: '2026-10-25 10:38'
updated_date: '2026-10-25 10:41'
labels:
  - ux
  - panel
dependencies: []
ordinal: 40000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Zgłoszenie usera: nie wiadomo jak ustawić Rosettę, jej ustawień brakuje w Wtyczki → Ustawienia wtyczek, a ustawianie Statystyk i słowniczka jest niejasne. (1) Karta Rosetta w Ustawieniach wtyczek (backend, języki, wygląd panelu) na istniejącej grupie rosetta_ustawienia. (2) Konta → Rosetta: opisy pól, presety dostawcy, odsyłacz do ustawień. (3) Statystyki i słowniczek: kroki, podpisane pola, informacja że KOReader synchronizuje dopiero po „Synchronizuj teraz” na czytniku.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Karta Rosetta w Wtyczki → Ustawienia wtyczek (ROSETTA_OPTS, nowy rodzaj kontrolki text); Konta → Rosetta: presety OpenRouter/OpenAI, podpisane pola, odsyłacz; Statystyki i słowniczek: 3 kroki + podpisane pola Konto/Folder + informacja, że scalanie trzeba uruchomić na czytniku (źródło: statistics.koplugin, vocabbuilder.koplugin — brak auto-synchronizacji). make test zielony, kontrola w stubie DOM; bez podglądu w prawdziwej przeglądarce (brak Chrome na VPS).
<!-- SECTION:NOTES:END -->
