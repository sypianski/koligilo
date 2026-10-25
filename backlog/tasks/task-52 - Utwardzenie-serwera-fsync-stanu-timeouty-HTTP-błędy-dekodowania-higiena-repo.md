---
id: TASK-52
title: >-
  Utwardzenie serwera: fsync stanu, timeouty HTTP, błędy dekodowania, higiena
  repo
status: Done
assignee: []
created_date: '2026-10-25 17:32'
updated_date: '2026-10-25 17:36'
labels: []
dependencies: []
ordinal: 52000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pakiet drobnych poprawek z przeglądu 2026-10-25. (1) store.go saveLocked: fsync pliku tmp przed Rename, żeby awaria zasilania nie zerowała state.json (tokeny urządzeń). (2) main.go: http.Server z ReadHeaderTimeout i IdleTimeout zamiast gołego ListenAndServe (bez WriteTimeout — długie pobrania zipów/czcionek). (3) server.go adminDecide/adminGroups/adminRename (i desktop.go, usb.go): sprawdzać błąd Decode (400 zamiast cichego Approve=false) i dodać MaxBytesReader. (4) rendezvous.go tooMany: usuwać klucz IP z mapy failures, gdy slice jest pusty. (5) .gitignore: koligilo.bak-* i koligilo.prev-*; sprawdzić .claude/worktrees.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Zrobione: fsync w saveLocked (store.go), newHTTPServer z ReadHeaderTimeout 10 s i IdleTimeout 2 min dla serwera, nasłuchu czytników i panelu (bez Read/WriteTimeout — długie pobrania i import), readJSON zamiast cichego Decode w adminDecide/adminGroups/adminRename oraz /api/local/{config,move,move-here,usb/pair} (400 + limit 64 kB), delete pustego klucza IP w tooMany, .gitignore dla koligilo.bak-*/prev-*. Testy: hardening_test.go. .claude/worktrees to 12 zarejestrowanych worktree'ów po agentach — świadomie nietknięte.
<!-- SECTION:NOTES:END -->
