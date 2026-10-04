# CLAUDE.md

**koligilo** synchronizuje ustawienia KOReadera między urządzeniami. Składa się
z jednej binarki Go (`koligilo` = komputer jako serwer + panel w przeglądarce, albo
sam panel „Mój serwer”; `koligilo serve` = serwer na VPS)
i pluginu Lua `plugin/koligilo.koplugin`. Komentarze i UI są po polsku.
Architektura: `~/utensili/libraro/decyzje/PC-002-*.md`.

## Komendy

```bash
make test   # go vet/test + lua tests/sync_test.lua + tests/installer_test.lua (atrapy KOReadera) + node --check web/app.js
make e2e    # tests/run_e2e.sh: świeży serwer + 2 symulowane czytniki (sync.lua przez curl)
make dist   # cross-compile 5 platform + zip pluginu
```

Po zmianie w `web/` trzeba przebudować binarkę, bo UI jest wbudowane przez `//go:embed web`.

## Pliki

- `catalog.go` to **jedyne źródło prawdy** o tym, co wolno synchronizować (grupy → wpisy `Key`/`Prefix`).
- `store.go`: stan w `state.json` (atomowy zapis), parowanie (prośby tylko w pamięci, TTL 10 min, token wydawany raz).
- `server.go`: API urządzeń `/api/v1/*` (Bearer token urządzenia) i panelu `/api/admin/*` (Bearer token admina).
- `desktop.go`: jeden proces `koligilo` (TASK-15). Tryb `local` (domyślny): wbudowany Store w `<UserConfigDir>/koligilo/dane`, panel 127.0.0.1:47471 za `guard()` obsługuje `/api/admin/*` lokalnie (instancja `Server` z `trustAdmin`), API czytników na osobnym nasłuchu `:7210` (osobna instancja `Server` bez `trustAdmin`, filtr `deviceOnly`). Tryb `remote`: proxy `/api/admin/*` z doklejonym tokenem. Discovery UDP :47470 w obu trybach. Stara konfiguracja z `server` migruje do `remote`.
- `transfer.go`: eksport/import (tar.gz: manifest, `state.json`, `plugins/<sha>.zip`, `gallery*.json`), `/api/admin/{export,import,moved}`, `State.MovedTo` → 410 `{moved_to}` w `Server.device`.
- `accounts.go`: konta wpisywane w panelu (`/api/admin/accounts/*`: kosync, Wallabag, `cs_servers`, cele statystyk/słowniczka, wymiana kodu Dropbox → refresh token). Zapisuje je jako zwykłe wspólne wartości (`Dev = "panel"`).
- `plugins.go`: magazyn wtyczek (`<dane>/plugins/<sha256>.zip`, ZIP znormalizowany, sha256 z serwowanych bajtów), walidacja ZIP-a, ekstraktor pól `_meta.lua` (tokenizer, nic nie wykonuje), przypisanie wtyczek do urządzeń i raport z czytnika. Zgoda `plugins_allowed` przychodzi tylko z `GET /api/v1/sync?plugins_allowed=1`.
- `luavalue.go`: literały Lua po stronie Go — musi dawać **bajt w bajt** to samo co `Sync.serialize` (pilnuje `TestLuaMatchesPlugin`).
- `web/lua.js`: `luaSerialize`/`luaParse` — lustro `Sync.serialize` w przeglądarce; kontrolki „Wspólnych ustawień” zapisują wyłącznie przez nie (bajt w bajt, pilnuje `tests/luaser_test.js`).
- `web/koreader_opts.js`: **generowana** mapa ustawień KOReadera (nazwy/opisy PL, presety, zakresy, poprawki stylu) — odświeżaj `make koreader-opts TAG=vYYYY.MM` (`scripts/koreader-opts.{sh,lua}`), nie ręcznie.
- `plugin/…/sync.lua`: czysta logika (serializacja, parser, plan scalania), bez zależności od KOReadera.
- `plugin/…/main.lua`: warstwa KOReadera (menu, HTTP, pliki).

## Niezmienniki (nie łamać)

- **ID wartości:** `plik|ścieżka.z.kropkami` (wpis Key) albo `plik#klucz` (wpis Prefix, bez dzielenia po kropkach, bo nazwy profili mają kropki).
- **Wartości to literały Lua**, a nie JSON: JSON gubi różnicę między kluczem `1` a `"1"`. Parser `Sync.deserialize` przyjmuje **wyłącznie** format `Sync.serialize`. Nigdy nie używaj tu `load`/`loadstring`, bo dane z serwera nie mogą być kodem.
- **Usunięcia na drucie idą osobną listą** (`deleted`/`delete`), nie jako JSON `null`. Dekodery Lua gubią `null`, a zgubiony nagrobek wskrzesiłby ustawienie.
- **Czarna lista kluczy urządzenia** (`Sync.DEVICE_KEYS`) obowiązuje po stronie pluginu niezależnie od katalogu serwera.
- **Nieczytelny plik** (`broken`) nie oznacza, że plik jest pusty: jego klucze są pomijane, a baza zostaje. Brak pliku nie generuje usunięć. Bezpiecznik `Sync.suspicious` przerywa synchronizację, gdy znika ponad połowa kluczy naraz.
- **Konto Dropbox z `username = true`** to konto zepsute przez sesję KOReadera (krótkotrwały token w `password`). Plugin go nie wysyła (`Sync.hasSessionToken`, `plan.masked`), serwer nie przyjmuje go jako celu.
- **Stary KOReader (< 2026.06)** trzyma kosync w `settings.reader.lua` pod `kosync`. `loadFiles` podaje tę tabelę jako `settings/kosync.lua` → `settings`, więc ID na drucie są jednolite.
- **Plugin modyfikuje żywe obiekty `LuaSettings`** innych pluginów w miejscu (`findLiveSettings`, `replace_in_place`). Inaczej ich `onFlushSettings` nadpisałoby zmiany starą kopią.
- **Nasłuch czytników w trybie komputera przepuszcza wyłącznie `/api/v1/*` i `/koligilo.koplugin.zip`** (`deviceOnly`, reszta 404) i używa instancji `Server` BEZ `trustAdmin`. `trustAdmin` wolno ustawić tylko instancji podpiętej pod panel za `guard()` na 127.0.0.1. W trybie `remote` lokalny magazyn nie przyjmuje synchronizacji (503), a po przenosinach wydaje tylko 410.
- **Przenosiny nie zmieniają tokenów urządzeń** (hashe w `state.json`); import zachowuje hash tokenu admina celu i robi kopię `.pre-import-*`. Plugin przyjmuje `moved_to` tylko przez `Sync.movedURL` (http(s), bez loginu/zapytań, `https→http` wyłącznie na adres prywatny/Tailscale/`.local`), raz na synchronizację. Na czas przenosin API czytników daje 503 — przedwczesne 410 skierowałoby czytnik na serwer, który go nie zna, a 401 kasuje token na czytniku.
- **ServeMux (Go 1.22+):** statyczne UI jest pod `"/"`, bez metody. `"GET /"` koliduje z `"/api/admin/"` i panikuje przy starcie (pilnuje tego `TestRoutesBuild`).
- **Instalacja wtyczek jest opt-in wyłącznie na czytniku** (menu pluginu), nigdy z panelu/serwera; każda instalacja/aktualizacja/usunięcie wymaga potwierdzenia na czytniku z listą wtyczek i wersji. Zob. PC-004.
- **ZIP wtyczki jest weryfikowany sumą sha256** podaną przez serwer przed instalacją; niezgodność przerywa operację bez naruszenia starej wersji. Serwer waliduje strukturę ZIP-a (jeden katalog `*.koplugin`, `_meta.lua`, brak zip-slip/symlinków, limit rozmiaru) i **parsuje `_meta.lua` wyłącznie jako literał, nigdy go nie wykonuje**.
- **Wersje z galerii GitHub są przypięte do `owner/repo@sha` commita**, nigdy do gałęzi. koligilo rusza (aktualizuje/usuwa) tylko wtyczki oznaczone własnym znacznikiem `.koligilo`; ręcznie zainstalowanych, `koligilo.koplugin` i wtyczek wbudowanych w KOReadera nigdy nie dotyka. Wtyczka wysłana z czytnika na serwer wymaga akceptacji admina w panelu, zanim trafi na inne urządzenia.
- **Proxy panelu desktopowego (`guard()` w `desktop.go`) sprawdza Host, nagłówek `X-Koligilo` i (dla mutacji) `Origin`** przed dopuszczeniem do `/api/*` — bez tego dowolna strona w przeglądarce mogłaby użyć doklejonego tokenu admina (CSRF) albo, przez DNS rebinding, odczytać `/api/admin/state`; każdy fetch w `web/app.js` musi wysyłać ten nagłówek (stała `HDR`), a panel nigdy nie odpowiada `Access-Control-Allow-*`.
- **Katalogi robocze instalatora nie kończą się na `.koplugin`** (`plugins/.koligilo-new-<nazwa>`, `.koligilo-old-<nazwa>`, `.koligilo-dl-<nazwa>.zip`): PluginLoader ładuje każdy katalog `*.koplugin`, także zaczynający się od kropki. Znacznik `.koligilo` to linie `klucz=wartość` (`Sync.markerDecode`), a `_meta.lua` obcych wtyczek czytamy tylko wyrażeniem regularnym (`Sync.metaField`) — nigdy `dofile`/`load`.

## Testowanie na urządzeniach

Plugin kopiuje się do `koreader/plugins/`. Na Androidzie to `/sdcard/koreader/plugins/`, a Pixel ma Termux.
Logi pluginu (`logger.warn("koligilo: …")`) trafiają do `crash.log` w katalogu KOReadera.
