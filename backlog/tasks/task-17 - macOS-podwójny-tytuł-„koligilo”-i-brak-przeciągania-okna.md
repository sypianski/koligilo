---
id: TASK-17
title: 'macOS: podwójny tytuł „koligilo” i brak przeciągania okna'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-29 16:40'
updated_date: '2026-09-29 17:03'
labels:
  - ui
  - macos
  - bug
dependencies: []
priority: high
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
W koligilo.app (macapp/main.swift) napis „koligilo” w lewym górnym rogu pojawia się dwa razy: tytuł okna NSWindow (win.title przy titlebarAppearsTransparent + fullSizeContentView) nakłada się na .brand w pasku bocznym web/index.html. Okna nie da się też wygodnie przeciągać — WKWebView zajmuje cały contentView (także pas paska tytułu), a WebKit na macOS nie obsługuje -webkit-app-region, więc zdarzenia myszy idą do strony.
Kierunek: win.titleVisibility = .hidden (tytuł zostaje dla Mission Control/menu Okno); pas przeciągania nad WKWebView (np. przezroczysty NSView ~28–38 px, mouseDown → window.performDrag(with:), podwójny klik → zoom/minimalizacja wg AppleActionOnDoubleClick) albo przekazanie z JS (data-drag na pasku bocznym/nagłówku → WKScriptMessageHandler → performDrag). Przyciski semaforów nie mogą zasłaniać .brand — w trybie aplikacji panel dostaje odstęp u góry paska bocznego (np. klasa na <html> ustawiana przez nakładkę, żeby przeglądarka nie miała pustego paska).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Na macOS nazwa „koligilo” widoczna w lewym górnym rogu dokładnie raz, nie zasłonięta semaforami
- [ ] #2 Okno da się przeciągnąć za górny pas i za pusty obszar nagłówka/paska bocznego; podwójny klik działa jak w systemie
- [ ] #3 Elementy interaktywne w pasie (przyciski, pola) nadal klikalne, zaznaczanie tekstu w treści działa
- [ ] #4 Panel otwarty w zwykłej przeglądarce wygląda jak wcześniej (bez pustego odstępu)
- [ ] #5 Zrzut ekranu z Maca w notatkach; make test zielone
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1) win.titleVisibility=.hidden (tytul zostaje dla Mission Control/menu Okno, znika wizualnie). 2) contentView = kontener NSView z WKWebView (wypelnia caly obszar) + DragStripView (przezroczysty pasek 28px u gory, mouseDownCanMoveWindow=true, obsluguje dblclick wg AppleActionOnDoubleClick). 3) WKScriptMessageHandler "drag": WKUserScript (atDocumentStart) dodaje klase mac-app do <html> i nasluchuje mousedown na [data-drag] (poza button/a/input/select/textarea/label/contenteditable) -> postMessage -> performDrag(with: NSApp.currentEvent) badz akcja dblclick; pokrywa puste miejsca w pasku bocznym/naglowku poza gornym paskiem. 4) data-drag na <aside class="side"> (index.html) i na .view-head (app.js). 5) CSS .mac-app .side { padding-top: 28px } zeby semafory nie zaslanialy .brand; bez klasy (zwykla przegladarka) bez zmian. 6) usuniecie message handlera w windowWillClose (unikniecie cyklu retencji przez userContentController). Test: make test na VPS, build+recznie na Macu (scripts/mac-app.sh), zrzut ekranu, proba przeciagania cliclick.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Kod: titleVisibility=.hidden, DragStripView 28px (mouseDownCanMoveWindow + dblclick wg AppleActionOnDoubleClick), most JS [data-drag]→performDrag, .mac-app .side padding-top. make test zielone, build na Macu czysty. Weryfikacja dyrygenta: AC4 potwierdzony (serwowany HTML bez mac-app). AC1-3,5 NIEPOTWIERDZONE wizualnie — ssh na Macu bez Screen Recording/Accessibility. Wątpliwość: most JS woła performDrag z NSApp.currentEvent w asynchronicznym handlerze wiadomości — zdarzenie może już nie być mouseDown, więc przeciąganie za pusty pasek boczny może nie działać (pasek 28 px powinien). Testowy build: ~/tmp/koligilo-build/dist/koligilo.app na Macu.

Zrzut usera z Maca (2026-09-29 19:02, scratchpad/mac/shot1.png): tytuł „koligilo” widoczny raz, pod semaforami — AC1 potwierdzony wizualnie. Przeciąganie/dblclick czekają na potwierdzenie usera.
<!-- SECTION:NOTES:END -->
