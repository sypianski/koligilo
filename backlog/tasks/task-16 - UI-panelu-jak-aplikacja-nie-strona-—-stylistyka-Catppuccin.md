---
id: TASK-16
title: 'UI panelu jak aplikacja, nie strona — stylistyka Catppuccin'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 14:51'
updated_date: '2026-09-28 15:08'
labels:
  - ui
  - design
dependencies: []
priority: medium
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Panel (web/index.html, app.js, style.css) wygląda dziś jak strona internetowa (nagłówek, zakładki jak linki, stopka). Cel: wygląd i zachowanie aplikacji desktopowej — np. boczny pasek nawigacji z ikonami (Urządzenia, Ustawienia, Konta, Wtyczki, Galeria), zwarty układ, brak przewijania całej strony tam, gdzie wystarczą panele, pasek stanu (połączenie z serwerem, wersja, ostatnia synchronizacja), systemowe czcionki, brak zaznaczania tekstu na elementach sterujących, skróty klawiszowe. Paleta Catppuccin: Latte (jasny) i Mocha (ciemny) wg prefers-color-scheme + ręczny przełącznik; kolory jako zmienne CSS z oficjalnej palety (catppuccin/palette), akcent do wyboru (np. Mauve). Użyć skilla /frontend-design; zgodnie z globalnymi zasadami można skonsultować inspirację (gemini), ale decyzje należą do usera. Bez zewnętrznych bibliotek i CDN (UI jest wbudowane w binarkę przez go:embed, ma działać offline). Nie zmieniać logiki ani API; wszystkie fetch nadal przez api()/apiRaw()/apiUpload() z nagłówkiem X-Koligilo. Dostępność: kontrast WCAG AA w obu wariantach, obsługa klawiaturą, role ARIA dla nawigacji.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Nawigacja boczna/aplikacyjna zamiast zakładek-linków; wszystkie dotychczasowe widoki dostępne
- [x] #2 Catppuccin Latte i Mocha: automatycznie wg systemu + przełącznik zapamiętany lokalnie
- [x] #3 Kontrast AA w obu motywach (sprawdzony narzędziem), pełna obsługa klawiaturą
- [x] #4 Zrzuty ekranu przed/po dołączone do notatek taska; node --check i make e2e zielone
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Dowody: zrzuty przed/po (Latte, Mocha, desktop wizard, wąski 420px) w scratchpad/ui/ — dyrygent obejrzał before-latte-urzadzenia, after-latte-urzadzenia, after-mocha-wtyczki; kontrast 58/58 par ≥ AA (Latte: akcenty przyciemnione color-mix, subtext1 zamiast subtext0, overlay2 na ramki); skróty Alt+1..7, '/', strzałki w nawigacji sprawdzone przez CDP; make test + e2e 73/73; fetch nadal 6× przez wrappery z X-Koligilo; innerHTML tylko dla stałych ikon SVG. Poprawiony przy okazji 'false' w pasku połączenia. Drobiazgi: niestylizowany input type=file, możliwy błysk Latte przy ładowaniu wymuszonej Mocha.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Panel jak aplikacja: nawigacja boczna, pasek stanu, Catppuccin Latte/Mocha z przełącznikiem, AA, skróty
<!-- SECTION:FINAL_SUMMARY:END -->
