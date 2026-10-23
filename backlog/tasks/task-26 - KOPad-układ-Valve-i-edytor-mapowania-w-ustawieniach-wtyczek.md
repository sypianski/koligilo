---
id: TASK-26
title: 'KOPad: układ Valve i edytor mapowania w ustawieniach wtyczek'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 15:52'
updated_date: '2026-10-11 16:04'
labels:
  - ui
  - kopad
  - gamepad
dependencies: []
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Poprawki po przeglądzie TASK-25. (1) Edytor mapowania przycisków gamepada jest dziś kartą w widoku „Ustawienia czytników”, czyli wśród ustawień urządzenia/KOReadera, a to ustawienie wtyczki KOPad — ma mieszkać w widoku „Wtyczki” (nowa zakładka wewnętrzna „Ustawienia wtyczek”), poza „Ustawieniami czytników”. (2) Brakuje układu Valve (Steam Deck / Steam Controller): dziś Deck jest wciśnięty w „Xbox / Steam Deck / generic”. Nowy układ o id valve, domyślnie tożsamość (pozycje jak Xbox), z etykietami Valve (A B X Y, Widok, Menu, L1/R1, L2/R2). To rozszerza zamknięty słownik układów z PC-011 po obu stronach (kopad + koligilo). Zakres wdrożenia na Decka (kopia w /opt/koreader-shared/plugins) i przebudowa aplikacji na Macu — poza tym taskiem.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Układ valve w słowniku po obu stronach (kopad padmap.lua + etykiety w menu, padmap.go, web/padmap.js), domyślnie tożsamość; stary układ xbox opisany jako „Xbox / ogólny”; zapis nowego PC rozszerzającego PC-011
- [x] #2 Karta „Gamepad (KOPad): przyciski” zniknęła z „Ustawień czytników” i jest w widoku „Wtyczki” w nowej zakładce wewnętrznej „Ustawienia wtyczek” (klawiatura, ARIA, zapamiętany wybór zakładki), pełna wartość padmap ładuje się tam poprawnie
- [x] #3 Panel pokazuje układ Valve: zakładka, sylwetka z etykietami Valve, opis; walidacja serwera przyjmuje valve, a nieznane układy nadal odrzuca
- [x] #4 make test i make e2e zielone (nowe przypadki valve w Go, JS i lua kopad); dokumentacja (README EN/PL/EO, CLAUDE.md, opis grupy w catalog.go, README i CLAUDE.md kopad) wskazuje nowe miejsce edytora
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decyzje: PC-013 (układ valve w zamkniętym słowniku, rozszerzenie PC-011). Umiejscowienie edytora (Wtyczki → Ustawienia wtyczek) to decyzja UI bez osobnego PC.
AC1: kopad commit 41d45e1 (padmap.lua: valve na końcu LAYOUT_ORDER, domyślnie tożsamość; menu: „Valve (Steam Deck / Steam Controller)”, xbox = „Xbox / generic”), PC-013 w libraro. Dyrygent: lua tests/padmap_test.lua OK, luac -p OK, test różnicowy starego i nowego padnav.lua identyczny na 2640 zdarzeniach (padnav.lua niezmieniony). AC2: karta w nowej zakładce wewnętrznej „Ustawienia wtyczek” (PLUGSET), usunięta z „Ustawień czytników”; zrzuty tk26-a (karta w Wtyczkach, 4 zakładki układów) i tk26-c (Ustawienia czytników bez karty) obejrzane przez dyrygenta; pełna wartość padmap (562 znaki) ładuje się przez padLoadFull; szkic przeżywa odświeżanie w tle (smoke sub-agenta 47 ok). AC3: zrzut tk26-b (Valve: Widok/Menu, L1/R1, L2/R2, opis); padmapLayouts ma valve, nieznane układy (steamdeck, Valve, snes) dają 400 — e2e. AC4: go test -count=1, make test, make e2e — wszystkie exit 0 (e2e 106 ok), uruchomione niezależnie przez dyrygenta; dokumentacja: README EN/PL/EO, CLAUDE.md, catalog.go, README i CLAUDE.md kopad.
Dodatkowo (poza AC, drobne, zweryfikowane): naprawiono istniejący błąd — zapamiętana zakładka wewnętrzna Wtyczek nigdy nie wracała po przeładowaniu strony (const PLUGTAB_KEY w TDZ, błąd połknięty przez try/catch).
Do wiadomości: (1) padSave składa literał z S.state, więc przy zmianie padmap z innego czytnika w trakcie edycji zapis może oprzeć się na starej wartości — naprawa: świeży GET wartości w padSave (follow-up, nie ruszone, istniało od TASK-25). (2) Licznik „Ustawienia czytników (N)” nadal liczy wiersz padmap widoczny tylko w „Zaawansowane”. (3) Wdrożenie: kopad na Decku żyje w /opt/koreader-shared/plugins (extra_plugin_paths), a skrypt kopad-deck-sync.sh celuje w katalog Flatpaka, którego KOReader tam nie ładuje — wymaga poprawki celu przed użyciem. Aplikacja desktopowa na Macu (0.5.4) ma stary wbudowany panel do przebudowy.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Edytor mapowania gamepada przeniesiony do Wtyczki → Ustawienia wtyczek i układ Valve dodany po obu stronach (kopad + panel)
<!-- SECTION:FINAL_SUMMARY:END -->
