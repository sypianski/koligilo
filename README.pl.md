<div align="center">
  <img src="docs/icon.png" width="96" height="96" alt="" />
  <h1>koligilo</h1>
  <p>Ustawiaj KOReadera w panelu na komputerze, a te same ustawienia trafią na wszystkie Twoje czytniki.</p>
  <p>autor: <a href="https://sypian.ski/">Jakub Sypiański</a></p>
  <p><strong>Beta.</strong> Chętnie przyjmę uwagi: <a href="https://github.com/sypianski/koligilo/issues">zgłoś na GitHubie</a> albo napisz na jakub.sypianski@gmail.com.</p>

  [![Licencja: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
  ![Platforma](https://img.shields.io/badge/computer-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-brightgreen)
  ![Czytnik](https://img.shields.io/badge/reader-KOReader-lightgrey)
  ![Interfejs](https://img.shields.io/badge/interface-Polski-orange)

  <p><a href="README.md">English</a> · <b>Polski</b> · <a href="README.eo.md">Esperanto</a></p>
</div>

<p align="center">
  <img src="docs/demo.png" width="800" alt="Zrzuty panelu koligilo z danymi demo: prośba o parowanie z czterocyfrowym kodem, trzy połączone czytniki, macierz grup ustawień dla każdego urządzenia, presety rozmiaru czcionki i konto Wallabag" />
</p>

Czcionkę, marginesy, pasek stanu czy ulepszenia stylu ustawiasz w panelu na komputerze, z tymi samymi nazwami, opisami i presetami co w KOReaderze, zamiast klikać w menu każdego czytnika osobno. Ustawienia zmienione na jednym czytniku też trafiają na pozostałe, a konta Wallabag, kosync czy Dropbox wpisujesz tylko raz. Wszystko zostaje u Ciebie: serwerem jest Twój komputer, a nie chmura.

## Pobieranie

Część na komputer działa na **macOS, Windowsie i Linuksie**. Wszędzie to ta sama aplikacja z tym samym panelem.

| System | Plik | Uwagi |
|---|---|---|
| macOS (Apple Silicon i Intel) | [koligilo.dmg](https://github.com/sypianski/koligilo/releases/latest/download/koligilo.dmg) | Otwórz i przeciągnij koligilo do Aplikacji. Podpisane i notaryzowane przez Apple. Po zamknięciu okna zostaje w pasku menu, więc czytniki dalej się synchronizują. |
| Windows | [koligilo-windows-amd64.exe](https://github.com/sypianski/koligilo/releases/latest/download/koligilo-windows-amd64.exe) | Panel otwiera się w przeglądarce. Przy pierwszym uruchomieniu zezwól w Zaporze Windows na dostęp w **sieciach prywatnych**, inaczej czytniki nie znajdą komputera. SmartScreen: „Więcej informacji” → „Uruchom mimo to”. |
| Linux | [amd64](https://github.com/sypianski/koligilo/releases/latest/download/koligilo-linux-amd64) · [arm64](https://github.com/sypianski/koligilo/releases/latest/download/koligilo-linux-arm64) | `chmod +x` i uruchom; panel otworzy się w przeglądarce. Jeśli masz zaporę, otwórz TCP 7210 i UDP 47470. |
| Czytnik | [koligilo.koplugin.zip](https://github.com/sypianski/koligilo/releases/latest/download/koligilo.koplugin.zip) | Rozpakuj do `koreader/plugins/` i uruchom KOReadera ponownie albo podłącz czytnik kablem, a panel wgra plugin sam. |

Na Windowsie i Linuksie nie ma jeszcze ikony w zasobniku: panel działa, dopóki działa proces, więc zamknięcie jego okna zatrzymuje synchronizację.

Najwięcej testów przeszło na macOS i na czytnikach z Androidem. Uwagi z Windowsa, Linuksa, Kobo, Kindle'a i PocketBooka są szczególnie cenne.

## Ustawiasz raz, w panelu

Zakładka „Ustawienia czytników” pokazuje 30 opcji KOReadera w siedmiu działach (czcionka, układ strony, ustawienia dokumentu, ulepszenia stylu, pasek stanu, przeglądarka plików, statystyki czytania), z jego własnymi nazwami, opisami, presetami i zakresami. Zmiana trafia na każdy czytnik przy jego następnej synchronizacji. Wszystko, czego ta mapa nie zna, da się edytować jako surowe wartości w „Zaawansowane”.

Konta wpisujesz raz, w panelu: kosync, Wallabag, Dropbox (logowanie kodem), WebDAV i FTP do synchronizacji statystyk i słowniczka. Nowy czytnik dostaje je przy pierwszej synchronizacji.

## Wybierasz, co gdzie trafia

Grupy ustawień wybierasz dla każdego urządzenia: wygląd tekstu, rozmiar czcionki i marginesy, poprawki stylu, czcionki, stopka i pasek postępu, słowniki, gesty, skróty klawiszowe, profile, menedżer plików, opcje statystyk, konta, KOPad, klawiatura ekranowa, asystent AI, Rosetta. Kindle może dzielić słowniki i gesty, a zostać przy własnym rozmiarze czcionki.

Ustawienia scalają się klucz po kluczu. Ustawienia należące do jednego urządzenia (DPI ekranu, podświetlenie, ścieżki, Wi-Fi, obrót, tryb nocny) nigdy nie są synchronizowane. Jeśli naraz zniknie ponad połowa synchronizowanych ustawień, np. przez uszkodzony plik, czytnik się zatrzymuje i nic nie wysyła.

## Parowanie czytnika

Na czytniku: **Menu → Narzędzia → koligilo → Połącz z komputerem**.

- **Ta sama sieć Wi-Fi:** czytnik sam znajduje komputer; porównujesz czterocyfrowy kod i potwierdzasz w panelu.
- **Kabel:** panel wgrywa plugin i paruje czytnik.
- **Każda inna sieć** (uczelniana, hotelowa, VPN): czytnik pokazuje sześciocyfrowy kod, który wpisujesz w panelu.

Po sparowaniu czytnik synchronizuje się przy każdym połączeniu z Wi-Fi albo po „Synchronizuj teraz”. Komputer musi być włączony i osiągalny (ta sama sieć albo Tailscale); do tego czasu zmiany czekają na czytniku.

### Co przechodzi przez serwer autora

Tylko parowanie sześciocyfrowym kodem z innej sieci korzysta z punktu kontaktowego `koligilo.sypian.ski`, serwera prowadzonego przez autora. Przez najwyżej 10 minut, tylko w pamięci, trzyma on model czytnika, adres Twojego serwera i klucz dla tego czytnika; kasuje je, gdy tylko czytnik je odbierze. Twoich ustawień, kont ani książek nie widzi. Parowanie w tej samej sieci Wi-Fi albo kablem go nie używa. Możesz postawić własny: `koligilo --rendezvous ADRES` na komputerze i klucz `rendezvous` w `settings/koligilo.lua` na czytniku.

## Poza tym

- **Własny serwer.** Zamiast komputera serwerem może być VPS (`koligilo serve`). Dane przenoszą się między nimi bez ponownego parowania czytników. Szczegóły: [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md).
- **Wtyczki.** Galeria wtyczek KOReadera z GitHuba, przypiętych do konkretnego commita. Instalacja, aktualizacja i usunięcie wtyczki dzieją się dopiero po potwierdzeniu na czytniku (KOReader 2025.08 lub nowszy).
- **Czego koligilo nie robi.** Nie przenosi książek ani postępu czytania. Postęp i statystyki dalej synchronizują mechanizmy KOReadera; koligilo rozwozi tylko ich konfigurację.

## Uwagi

koligilo jest w becie. Jeśli coś się psuje, działa dziwnie albo czegoś brakuje, daj znać:

- [Zgłoś na GitHubie](https://github.com/sypianski/koligilo/issues/new). Błędy, pomysły i pytania — wszystko tam pasuje; podaj model czytnika, wersję KOReadera i system komputera.
- Albo napisz na jakub.sypianski@gmail.com.

Przed pierwszą synchronizacją zrób kopię `settings.reader.lua` i katalogu `settings/` z katalogu KOReadera.

## Budowanie ze źródeł

Wymaga Go 1.24 lub nowszego.

```bash
make test       # testy Go, logika pluginu w Lua, składnia UI
make dist       # binarki dla macOS, Linuksa i Windowsa + zip pluginu
make mac-app    # koligilo.app i .dmg (na Macu)
```

## Wsparcie

koligilo jest darmowe. Jeśli Ci się przydaje, możesz [postawić mi kawę na Ko-fi](https://ko-fi.com/sypianski).

## Podziękowania

[KOReader](https://github.com/koreader/koreader) (AGPL-3.0): nazwy, opisy i presety opcji w panelu są generowane z jego kodu i tłumaczeń. Panel używa kroju [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next) (SIL OFL 1.1). koligilo jest na licencji GNU Affero General Public License v3.0, zob. [LICENSE](LICENSE).

---

<p align="center">koligilo · <a href="https://sypian.ski/">Jakub Sypiański</a> · AGPL-3.0</p>
