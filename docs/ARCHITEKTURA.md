# koligilo — architektura i tryby pracy

Dokument techniczny (po polsku). Opis dla użytkowników: [README](../README.md) · [po polsku](../README.pl.md) · [Esperante](../README.eo.md).

Synchronizacja **ustawień KOReadera** między czytnikami: gesty, stopka, słowniki,
profile, wygląd tekstu, a także konta (Wallabag, kosync, serwer statystyk). Po
jednorazowym sparowaniu nowego urządzenia nie trzeba niczego wpisywać.

*koligi* (eo.) — łączyć.

## Jak to działa

Jedna binarka, dwa tryby — wybór w panelu (widok „Serwer”), bez restartu:

```
 Ten komputer (domyślnie):   czytnik ──HTTP :7210──▶ koligilo (serwer + panel na 127.0.0.1)

 Mój serwer:                 czytnik ──HTTP──▶ koligilo serve (VPS) ◀──proxy── koligilo (panel)
```

- **Plugin** `koligilo.koplugin` scala ustawienia **klucz po kluczu** (trójstronnie:
  lokalnie / baza z ostatniej synchronizacji / serwer). Wysyła zmiany lokalne,
  pobiera zmiany z innych urządzeń, a przy konflikcie wygrywa wersja wspólna.
  Klucze zależne od urządzenia (DPI, podświetlenie, ścieżki, Wi-Fi, `device_id`)
  są na twardej czarnej liście.
- **Serwer** trzyma urządzenia, ich wybór grup, wspólne wartości (`state.json`)
  i magazyn wtyczek. Może nim być sam komputer z panelem albo `koligilo serve`.
- **Panel** to UI w przeglądarce. Pokazuje prośby o parowanie z kodem,
  macierz „grupa × urządzenie”, wspólne wartości, wtyczki i galerię.

## Uruchomienie

### Tryb „Ten komputer” (domyślny)

```bash
koligilo            # serwer + panel; otwiera http://127.0.0.1:47471 w przeglądarce
```

Nic nie trzeba wpisywać. Jeden proces:

- **panel** na `127.0.0.1:47471`: tylko ten komputer (ochrona przed CSRF i DNS
  rebinding, bez tokenu — dostęp do panelu = siedzenie przy tym komputerze);
- **API czytników** na `0.0.0.0:7210` (`--listen`): wyłącznie `/api/v1/*`
  i plik pluginu, panel i `/api/admin/*` są tam niedostępne (404);
- **discovery UDP :47470**: czytnik w tej samej sieci Wi-Fi sam znajduje komputer.

Dane leżą obok konfiguracji, w tym samym formacie co `koligilo serve --data`:
`~/Library/Application Support/koligilo/dane/` (Linux: `~/.config/koligilo/dane/`,
Windows: `%AppData%\koligilo\dane\`), albo `--data KATALOG`.
Adres dla czytników jest wykrywany (Tailscale 100.x ma pierwszeństwo, potem
adres z sieci czytnika / prywatne IPv4) i można go nadpisać w panelu.

**Uczciwie:** w tym trybie czytniki synchronizują się tylko wtedy, gdy komputer
jest włączony i widoczny (ta sama sieć albo Tailscale). Do tego czasu zmiany
czekają na czytniku i dojdą przy następnej synchronizacji.

### Tryb „Mój serwer” (VPS)

```bash
koligilo serve --listen 127.0.0.1:7210 --data /var/lib/koligilo --public-url https://koligilo.example.com
```

Przy pierwszym uruchomieniu serwer wypisze **token administratora**, tylko ten
jeden raz (zgubiony: `koligilo admin-token --data …`). Na dysku leży wyłącznie
jego hash. Serwer postaw za reverse proxy z TLS. W panelu na komputerze wybierz
„Mój serwer” i podaj adres + token — panel staje się wtedy tylko panelem
(proxy z doklejonym tokenem), a jego lokalne dane zostają nietknięte.
Dotychczasowa konfiguracja z wpisanym serwerem zostaje w tym trybie po aktualizacji.

### Przenosiny między trybami

W widoku „Serwer”:

- **Przenieś na mój serwer** — eksport z komputera, import na serwerze
  (`POST /api/admin/import`), a komputer odpowiada potem czytnikom
  `410 {"moved_to": …}`;
- **Przenieś dane na ten komputer** — odwrotnie; serwer zaczyna kierować czytniki
  na adres komputera.

Czytniki **nie parują się od nowa**: tokeny urządzeń są w `state.json` jako hashe
i przechodzą w eksporcie. Plugin (≥ 0.4.0) po `410` zapisuje nowy adres, pokazuje
„koligilo przeniesiono na …” i ponawia synchronizację. Przyjmuje tylko
`http(s)://host[:port][/ścieżka]`; przejście z `https` na `http` wyłącznie na adres
prywatny / Tailscale / `.local`. Import zachowuje token administratora celu,
a przed nadpisaniem robi kopię `<dane>/.pre-import-<czas>/`.

Ręcznie (serwer wyłączony):

```bash
koligilo export --data KATALOG kopia.tar.gz
koligilo import --data KATALOG [--replace] kopia.tar.gz
```

Archiwum: `manifest.json` (wersja formatu), `state.json`, `plugins/<sha256>.zip`
(suma sprawdzana przy imporcie), `gallery.json`, `gallery-updates.json`.

### Czytnik

1. Skopiuj `koligilo.koplugin/` do `koreader/plugins/` i uruchom KOReader ponownie
   (albo podłącz czytnik kablem — panel wgra plugin sam).
2. **Menu → Narzędzia → koligilo → Połącz z komputerem…**
3. W panelu pojawi się prośba z 4-cyfrowym kodem. Porównaj go z czytnikiem i kliknij „połącz”.

W tej samej sieci Wi-Fi czytnik sam znajdzie komputer (broadcast UDP na port
47470). W innej sieci pokaże 6-cyfrowy kod do wpisania w panelu.

## Rozwój

```bash
make test    # go vet + go test + testy logiki pluginu (Lua) + składnia UI
make e2e     # serwer + dwa symulowane czytniki przez prawdziwe HTTP
make dist    # binarki: macOS arm64/amd64, Linux amd64/arm64, Windows amd64 + zip pluginu
```

## Stan (0.5.4)

- [x] Własny serwer, parowanie kodem, grupy per urządzenie, auto-sync po Wi-Fi
- [x] Konta w panelu: kosync, Wallabag, konta w chmurze (Dropbox z logowaniem przez kod, WebDAV, FTP), gdzie statystyki i słowniczek trzymają bazę
- [x] Starszy KOReader (< 2026.06): kosync w `settings.reader.lua`
- [x] Edycja wspólnych ustawień w panelu (API z walidacją literałów Lua)
- [x] Wtyczki: magazyn na serwerze, galeria z GitHuba (przypięta do SHA), aktualizacje, wysyłanie wtyczki z czytnika — instalacja tylko za zgodą i potwierdzeniem na czytniku (PC-004, KOReader ≥ 2025.08)
- [x] Panel desktop odporny na CSRF i DNS rebinding
- [x] Jedna aplikacja: komputer jako serwer (domyślnie) albo własny serwer; przenosiny danych bez ponownego parowania
- [ ] Test na prawdziwych czytnikach (Pixel 8a, Kobo/PocketBook)
- [ ] Transport Dropbox (OAuth PKCE z panelu) i WebDAV (Koofr), z szyfrowaniem sekretów kluczem z parowania
- [ ] Rozwożenie plików: `styletweaks/`, `patches/`, fonty
