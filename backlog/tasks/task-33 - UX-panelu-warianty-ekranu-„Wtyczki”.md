---
id: TASK-33
title: 'UX panelu: warianty ekranu „Wtyczki”'
status: In Progress
assignee: []
created_date: '2026-10-23 17:24'
updated_date: '2026-10-24 12:24'
labels:
  - ux
  - panel
dependencies: []
priority: medium
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Selektor wariantów UX (skill /ux): kod widoku + zrzut → artefakt z 2–4 wariantami na sekcję i osobną stylistyką → wybór zapisany w db → wdrożenie po zatwierdzeniu. Niezmienniki panelu (guard() desktop.go, nagłówek X-Koligilo, zapis padmap/luaSerialize bajt w bajt) są nietykalne. Widok: `wtyczki` (web/app.js, VIEWS).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Wybór z selektora: https://claude.ai/artifact/GdGEgpwKDLTk7oJAr3Z9Nj (wybor/wtyczki). Zrobione: kroki 1–2 (teksty, macierz Zainstalowane). Dalej: jedna strona + wstęp 3 kroki, kreator dodawania, karta 3 kroki, wtyczki wspólne (PC-017).

Krok 3+4 (wdrożone lokalnie, bez wersji): jedna strona bez zakładek; przyciski „＋ Dodaj wtyczkę” i „Ustawienia wtyczek” (osobny ekran z powrotem); kartka „Trzy kroki” z „Zrozumiano” (zapamiętane w localStorage, wraca przyciskiem „Jak to działa?”); arkusz „Dodaj wtyczkę” (galeria / ZIP / magazyn, wybór czytników, pełne ostrzeżenie dla wtyczek społeczności przed przyciskiem, Esc, pułapka Tab, / i #galeria otwierają arkusz). Zostało: krok 5 (karta „3 kroki” dla nowego czytnika) i 6 (wtyczki wspólne, PC-017).
<!-- SECTION:NOTES:END -->
