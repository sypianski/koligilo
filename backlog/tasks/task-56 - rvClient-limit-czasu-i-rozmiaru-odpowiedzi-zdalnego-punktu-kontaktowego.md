---
id: TASK-56
title: 'rvClient: limit czasu i rozmiaru odpowiedzi zdalnego punktu kontaktowego'
status: Done
assignee: []
created_date: '2026-10-25 19:09'
updated_date: '2026-10-25 19:09'
labels: []
dependencies: []
ordinal: 56000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
rendezvous.go: rvClient.lookup/claim używają http.Get/http.Post z DefaultClient bez timeoutu — zawieszony zdalny punkt kontaktowy (--rendezvous) zawiesza żądanie panelu. Dodać klienta z Timeout i limit czytanej odpowiedzi + test.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
rvHTTP (Timeout 15 s) zamiast DefaultClient w rvClient.lookup/claim, odpowiedź czytana do 64 kB. Testy: TestRVClientTimesOutOnHungRemote, TestRVClientIgnoresOversizedReply.
<!-- SECTION:NOTES:END -->
