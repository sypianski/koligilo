---
id: TASK-23
title: 'Podgląd strony: symulacja wyglądu jak w KOReaderze przy zmianie ustawienia'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-29 16:41'
updated_date: '2026-09-29 17:55'
labels:
  - ui
  - ustawienia
  - podglad
dependencies:
  - TASK-22
priority: medium
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Po kliknięciu ustawienia w widoku wspólnych ustawień otwiera się boczny panel podglądu, który pokazuje stronę książki przed/po zmianie (albo na żywo przy przesuwaniu suwaka). Wzorzec: dokładna symulacja tego, co zrobi crengine na czytniku.
Strona przykładowa powinna zawierać maksymalnie dużo elementów podlegających ustawieniom: tytuł rozdziału i podtytuł (h1–h3), akapity z wcięciem i bez, justowanie i dzielenie wyrazów po polsku, inicjał (drop cap), cytat blokowy, wiersz/poezja, listy, przypis (odnośnik + treść na dole strony/popup), obraz z podpisem, tabelę, kursywę/pogrubienie/kapitaliki, tekst w innym języku (np. arabski/grecki — wybór czcionki zapasowej), wdowy/sieroty na granicy strony, stopkę z paskiem postępu i nagłówek. Profil ekranu do wyboru (rozdzielczość/DPI — np. BigMe, Kindle, telefon), bo pt i marginesy zależą od ekranu.
Decyzja do podjęcia na starcie (spisać jako PC w ~/utensili/libraro/decyzje/): (a) przybliżenie CSS w przeglądarce — mapowanie copt_* na CSS (pt→px wg DPI profilu, interlinia %, odstęp słów, hyphens z lang=pl, font-weight/embolden, marginesy, style tweaks jako te same reguły CSS co w KOReaderze), szybkie, ale nie piksel w piksel; (b) prawdziwy crengine: render po stronie serwera (koreader/crengine w trybie headless, PNG) albo crengine skompilowany do WASM — wierny, ale ciężki (binarka, fonty, cross-compile). Możliwe podejście mieszane: CSS na żywo + „wierny podgląd” z crengine na żądanie. Bez CDN, działa offline (go:embed).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Kliknięcie ustawienia otwiera panel podglądu z przykładową stroną; zmiana wartości od razu widoczna (przed/po)
- [x] #2 Strona przykładowa obejmuje wszystkie wymienione elementy
- [x] #3 Wybór profilu ekranu wpływa na rozmiar czcionki i marginesy
- [x] #4 Decyzja o silniku podglądu zapisana jako PC; znane rozbieżności z KOReaderem opisane w notatkach
- [ ] #5 Podgląd porównany ze zrzutem ekranu z czytnika dla kilku ustawień (czcionka, marginesy, interlinia) — zrzuty w notatkach
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Generator (scripts/koreader-opts.lua/.sh): dołożyć do KO prawdziwy CSS poprawek stylu (css_tweaks.lua → tweaks[].css), domyślny arkusz crengine epub.css (przypięty do sha crengine z submodułu base), ReaderFooter.default_settings, domyślną czcionkę i czcionki zapasowe z credocument.lua; przegenerować web/koreader_opts.js.
2. web/preview.js (nowy): profile ekranów (BigMe HiBreak, Kindle PW, Kobo Libra, Kobo Clara, telefon) + dopasowanie po modelu urządzenia; mapowanie copt_* → CSS wg KOReadera (scaleBySize = ceil(v·min(w,h)/600) dla rozmiaru czcionki i marginesów, interlinia względem zmierzonego line-height:normal, word spacing, embolden → font-weight, gamma → przybliżenie, kerning → font-kerning, render_dpi → skala jednostek bezwzględnych, block_rendering_mode → float inicjału, status_line → nagłówek crengine, footer → pasek stanu z paskiem postępu); strona przykładowa PL ze wszystkimi elementami z opisu; <iframe srcdoc> w skali panelu.
3. Panel boczny (aside poza #app, więc render() co 3 s go nie niszczy): tytuł ustawienia, wybór profilu (localStorage w try/catch), przełącznik Przed/Po/Obok, metryki px, nieaktywny przycisk „Wierny podgląd (crengine)” pod TASK-24; Esc/× zamyka; ARIA complementary; na wąskim ekranie pełny ekran.
4. app.js: valSelect otwiera panel; kandydat „po” z najechania/fokusu na preset, wpisywania w pole własnej wartości, przełącznika (odwrotność), poprawki/flagi stopki (przełączenie), nazwy czcionki.
5. index.html, style.css (Catppuccin), Makefile (node --check + tests/preview_test.js na czyste funkcje mapowania).
6. PC-005 w ~/utensili/libraro/decyzje/ (CSS teraz, crengine w TASK-24, rozbieżności). Notatki: znane rozbieżności.
7. AC5: próba zrzutu z BigMe (ssh bigyo / adb przez Maca); zrzuty podglądu dla tych samych ustawień (czcionka, marginesy, interlinia) w scratchpadzie task23; make test + make e2e.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decyzja usera 2026-09-29: silnik = przybliżenie CSS w przeglądarce (na żywo). Wierny render crengine przeniesiony do osobnego taska TASK-24. PC do spisania w ~/utensili/libraro/decyzje/ w ramach tego taska.

Implementacja (2026-09-29): web/preview.js — panel boczny (aside#pv poza #app, role=complementary, Esc/× zamyka, na oknie <1100 px nakładka, na telefonie pełna szerokość). Klik/fokus wiersza w „Wspólnych ustawieniach” otwiera podgląd; Przed = wartość z chwili otwarcia, Po = najechanie/fokus na preset, wpisywanie własnej wartości, najechanie na przełącznik/poprawkę/pole stopki, albo zapisana wartość. Tryby Przed/Po/Obok siebie, strony ‹ ›, profile ekranu (BigMe HiBreak 824×1648, Kindle PW 1236×1648, Kobo Libra 2, Kobo Clara, telefon 1080×2400) z doborem po modelu połączonego czytnika, wybór w localStorage. Przeliczenia wg KOReadera: Screen:scaleBySize = ceil(v·min(w,h)/600) dla czcionki i marginesów, dolny margines + pasek stanu (reclaim_height), interlinia × zmierzony line-height:normal kroju. Generator (make koreader-opts) dokłada do KO.preview: epub.css crengine (commit crengine z submodułu base), CSS poprawek stylu, ReaderFooter.default_settings, czcionki; -cr-only-if tłumaczone. Decyzja: ~/utensili/libraro/decyzje/PC-005-podglad-strony-koligilo-przyblizenie-css-teraz-cr.md.

Znane rozbieżności z KOReaderem (pełna lista w PC-005): łamanie wierszy/stron przeglądarki ≠ crengine (paginacja kolumnami CSS); dzielenie wyrazów z miękkich łączników (wzorce pl, left 2/right 2) zamiast wzorców TeX crengine; kroje z systemu przeglądarki (brak Noto Serif → ogólny szeryfowy, panel to mówi); brak odpowiedników: hinting, zmniejszanie spacji, rozszerzenie słów, CJK, wygładzanie obrazów, obrazy w trybie nocnym; przybliżone: gamma, grubość, kerning, odstęp wyrazów, nagłówek crengine, ikony paska stanu; przypis na stronie skraca wszystkie strony podglądu; dwie kolumny tylko w poziomie (podgląd pionowy); priorytety poprawek pominięte.

AC5 — stan: czytnik niedostępny autonomicznie (ssh bigyo: Connection refused na :8022 — Termux sshd nie działa; ssh mac: timeout, więc adb kablem też nie). Nie zmieniano niczego na czytniku. Rendery podglądu 1:1 (824×1648, profil BigMe, pozostałe ustawienia jak w seedzie) gotowe do porównania: /tmp/claude-1000/-home-yaqub-utensili-koligilo/670f066e-dd75-4523-b39d-7ad566fc5cfe/scratchpad/task23/shots/1do1-czcionka-22.png, 1do1-czcionka-30.png, 1do1-marginesy-10x10.png, 1do1-marginesy-30x30.png, 1do1-interlinia-100.png, 1do1-interlinia-130.png. Potrzebne od użytkownika: na BigMe w KOReaderze otworzyć dowolny EPUB i zrobić zrzut (gest „Zrzut ekranu” albo dwa rogi naraz; ląduje w koreader/screenshots/) przy: (1) rozmiar 22 i 30, (2) L/P margines 10 i 30, (3) odstęp wierszy 100 % i 130 %; potem uruchomić sshd w Termux (sshd) albo podłączyć kablem do Maca — zrzuty dopiszemy tu obok renderów. Zrzuty panelu: /tmp/claude-1000/-home-yaqub-utensili-koligilo/670f066e-dd75-4523-b39d-7ad566fc5cfe/scratchpad/task23/shots/1-otwarty.png … 9-telefon-panel.png.

Weryfikacja dyrygenta: AC1 zrzut shots/2-czcionka-najechanie-30.png (Przed 22 / Po 30 obok siebie). AC2 tests/preview_test.js (24 elementy) w make test. AC3 scaleBySize ceil(v·min(w,h)/600), profile BigMe/Kindle/Kobo/telefon, auto wg modelu. AC4 PC-005 w ~/utensili/libraro/decyzje/. make test + e2e exit 0. AC5 OTWARTE: ssh bigyo → connection refused, ssh mac timeout; rendery 1:1 do porównania w scratchpad/task23/shots/1do1-*.png; potrzebne 3 zrzuty z KOReadera (czcionka 22/30, marginesy 10/30, interlinia 100/130) od usera.
<!-- SECTION:NOTES:END -->
