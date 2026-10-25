---
id: TASK-58
title: 'UX panelu: warianty ekranu „Słowniki”'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-25 19:21'
updated_date: '2026-10-25 20:39'
labels:
  - panel
dependencies: []
ordinal: 58000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Runda /ux dla zakładki „Słowniki” (TASK-55): Biblioteka · Katalog · Czytniki. Pliki: web/app.js (sekcja Dicts), web/dicts.js, web/style.css. Powiązane: TASK-55, TASK-38 (Czcionki — wzorzec).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Wybór zatwierdzony 2026-10-25 (wybor/slowniki): szata dziś, jedna strona + arkusz, kafle, wgrywanie jako ostatni wiersz listy (na stronie, nie w arkuszu — katalog ma 1772 pozycje), wiersz dziś, katalog: dwa powiązane filtry z języka/na język z zachętą na starcie i wynik od największego, wybór wielu naraz, macierz słownik × czytnik, stały pasek zadań. Kod gotowy lokalnie (1e00e45, d732f7a, 9956826, 764cbab; make test zielony; sprawdzone na kopii panelu w Chromium: arkusz, filtry, pobranie 2 słowników, pasek w arkuszu i na stronie, 390 px bez przewijania poziomego). NIE wdrożone (bump/restart/Mac). Odstępstwa: pasek nie rozróżnia kolejki od aktywnych pobrań (serwer ma jeden stan), bez Anuluj, bez sumy rozmiaru zaznaczonych (katalog go nie zna); ostatni komunikat żyje tylko w karcie przeglądarki.

Wdrożone jako 0.10.1 (2026-10-25): serwer VPS (origin zgodny z HEAD) i aplikacja na Macu (stara jako /Applications/koligilo.app.bak-0.10.0). Bez pusha i bez wydania na GitHubie.

Runda 2 (wybor/slowniki2: zakładki „Z katalogu”/„Własny plik”, filtry języków jako żetony z podpowiedziami; commit 4c483bb) wdrożona jako 0.10.2 (2026-10-25): VPS (origin = HEAD) i aplikacja na Macu (stara: /Applications/koligilo.app.bak-0.10.1). Bez pusha i wydania na GitHubie.
<!-- SECTION:NOTES:END -->
