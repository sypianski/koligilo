---
id: TASK-13
title: Przeniesienie wtyczki z urządzenia na serwer
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 11:48'
updated_date: '2026-09-28 12:25'
labels:
  - wtyczki
  - plugin
  - serwer
dependencies:
  - TASK-6
  - TASK-8
priority: low
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wtyczki spoza GitHuba (np. kopad, keyreader, których kod zniknął z kopii w dotfiles, bo .stignore pomija plugins/) trzeba skądś wziąć. Z menu czytnika: 'Wyślij wtyczkę X na serwer', czyli spakowanie katalogu i upload do magazynu. W panelu pojawia się ze źródłem 'urządzenie <nazwa>' i wymaga akceptacji admina, zanim da się ją przypisać innym urządzeniom.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Wtyczkę zainstalowaną ręcznie na jednym czytniku można zainstalować na drugim bez kabla
- [x] #2 Wtyczka wysłana z urządzenia nie trafia nigdzie bez akceptacji w panelu
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Dowody: TestDevicePluginUpload (upload d1 → 400 przed approve → approve → przypisanie d2 → download 200; zły token 401; zły ZIP 400); e2e 73/73 ze scenariuszem Kobo→Bigme (kopad.koplugin). Upload z czytnika nie wymaga plugins_allowed (czytnik wysyła, nie przyjmuje), ale wymaga potwierdzenia w menu; wersja approved=false. Przycisk 'Zaakceptuj' w panelu (POST /api/admin/plugins/{sha}/approve) dołożony w ramach TASK-12. Do testu na czytniku: Archiver.Writer na prawdziwym libarchive, komunikat przy ZIP >20 MB.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wysyłanie wtyczki z czytnika na serwer z akceptacją admina przed dystrybucją
<!-- SECTION:FINAL_SUMMARY:END -->
