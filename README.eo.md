<div align="center">
  <img src="docs/icon.png" width="96" height="96" alt="" />
  <h1>koligilo</h1>
  <p>Agordu KOReader per panelo en via komputilo, kaj la samaj agordoj atingos ĉiujn viajn legilojn.</p>
  <p>de <a href="https://sypian.ski/">Jakub Sypiański</a></p>
  <p><strong>Beta.</strong> Rimarkoj estas tre bonvenaj: <a href="https://github.com/sypianski/koligilo/issues">raportu ĉe GitHub</a> aŭ skribu al jakub.sypianski@gmail.com.</p>

  [![Permesilo: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
  ![Platformo](https://img.shields.io/badge/computer-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-brightgreen)
  ![Legilo](https://img.shields.io/badge/reader-KOReader-lightgrey)
  ![Interfaco](https://img.shields.io/badge/interface-Polski-orange)

  <p><a href="https://sypian.ski/koligilo/">Retejo</a></p>

  <p><a href="README.md">English</a> · <a href="README.pl.md">Polski</a> · <b>Esperanto</b></p>
</div>

<p align="center">
  <img src="docs/demo.png" width="800" alt="Ekrankopioj de la panelo de koligilo kun ekzemplaj datumoj: peto pri parigo kun kvarcifera kodo, tri parigitaj legiloj, la matrico de agordo-grupoj por ĉiu aparato, antaŭagordoj de tipara grando kaj konto de Wallabag" />
</p>

Tiparon, marĝenojn, statusbreton aŭ stilajn plibonigojn vi agordas per panelo en via komputilo, kun la samaj nomoj, priskriboj kaj antaŭagordoj kiel en KOReader, anstataŭ trairi la menuojn de ĉiu legilo aparte. Ŝanĝoj faritaj en unu legilo ankaŭ atingas la aliajn, kaj kontojn de Wallabag, kosync aŭ Dropbox vi entajpas nur unufoje. Ĉio restas ĉe vi: la servilo estas via propra komputilo, ne nubo.

La panelo kaj la kromprogramo por la legilo estas provizore nur polalingvaj.

## Elŝuto

La parto por la komputilo funkcias en **macOS, Windows kaj Linux**. Ĉie ĝi estas la sama aplikaĵo kun la sama panelo.

| Sistemo | Dosiero | Rimarkoj |
|---|---|---|
| macOS (Apple Silicon kaj Intel) | [koligilo.dmg](https://github.com/sypianski/koligilo/releases/latest/download/koligilo.dmg) | Malfermu ĝin kaj trenu koligilo en Aplikaĵojn. Subskribita kaj notariigita de Apple. Post fermo de la fenestro ĝi restas en la menubreto, do la legiloj plu sinkroniĝas. |
| Windows | [koligilo-windows-amd64.exe](https://github.com/sypianski/koligilo/releases/latest/download/koligilo-windows-amd64.exe) | La panelo malfermiĝas en via retumilo. Ĉe la unua lanĉo permesu aliron en **privataj retoj** en la fajroŝirmilo de Windows, alie la legiloj ne trovos la komputilon. SmartScreen: „More info” → „Run anyway”. |
| Linux | [amd64](https://github.com/sypianski/koligilo/releases/latest/download/koligilo-linux-amd64) · [arm64](https://github.com/sypianski/koligilo/releases/latest/download/koligilo-linux-arm64) | `chmod +x` kaj lanĉu ĝin; la panelo malfermiĝas en via retumilo. Se vi uzas fajroŝirmilon, malfermu TCP 7210 kaj UDP 47470. |
| Legilo | [koligilo.koplugin.zip](https://github.com/sypianski/koligilo/releases/latest/download/koligilo.koplugin.zip) | Malpaku en `koreader/plugins/` kaj relanĉu KOReader, aŭ konektu la legilon per kablo, kaj la panelo mem instalos ĝin. |

En Windows kaj Linux ankoraŭ ne estas piktogramo en la taskopleto: la panelo funkcias, dum la procezo funkcias, do fermo de ĝia fenestro haltigas la sinkronigon.

Ĝis nun ĝi estis testita ĉefe en macOS kaj en legiloj kun Android. Raportoj el Windows, Linux, Kobo, Kindle kaj PocketBook estas aparte bonvenaj.

## Agordu unufoje, en la panelo

La langeto „Ustawienia czytników” (agordoj de legiloj) montras 30 opciojn de KOReader en sep fakoj (tiparo, paĝa aranĝo, dokumentaj agordoj, stilaj plibonigoj, statusbreto, dosierfoliumilo, legaj statistikoj), kun la propraj nomoj, priskriboj, antaŭagordoj kaj intervaloj de KOReader. Ŝanĝo farita tie atingas ĉiun legilon ĉe ĝia sekva sinkronigo. Ĉion, kion la mapo ne konas, vi ankoraŭ povas redakti kiel krudajn valorojn sub „Zaawansowane” (altnivelaj).

Kontojn vi entajpas unufoje en la panelo: kosync, Wallabag, Dropbox (ensaluto per kodo), WebDAV kaj FTP por sinkronigo de statistikoj kaj vortaro. Nova legilo ricevas ilin ĉe sia unua sinkronigo.

## Elektu, kio iras kien

Vi elektas grupojn de agordoj por ĉiu aparato: aspekto de teksto, tipara grando kaj marĝenoj, stilaj korektoj, tiparoj, piedlinio kaj progresbreto, vortaroj, gestoj, klavkombinoj, profiloj, dosiermastrumilo, opcioj de statistikoj, kontoj, KOPad, ekrana klavaro, AI-asistanto, Rosetta. Via Kindle povas kunhavi vortarojn kaj gestojn, sed konservi sian propran tiparan grandon.

Agordoj kunfandiĝas ŝlosilon post ŝlosilo. Agordoj, kiuj apartenas al unu aparato (ekrana DPI, fronta lumo, vojoj, Wi-Fi, turnado, nokta reĝimo), neniam estas sinkronigataj. Se pli ol duono de la sinkronigataj agordoj malaperas samtempe, ekzemple pro difektita dosiero, la legilo haltas kaj sendas nenion.

## Parigo de legilo

En la legilo: **Menu → Tools → koligilo → Połącz z komputerem**.

- **Sama Wi-Fi-reto:** la legilo mem trovas la komputilon; vi komparas kvarciferan kodon kaj konfirmas en la panelo.
- **Kablo:** la panelo instalas la kromprogramon kaj parigas la legilon.
- **Ajna alia reto** (universitata, hotela, VPN): la legilo montras sesciferan kodon, kiun vi entajpas en la panelon.

Post la parigo la legilo sinkroniĝas ĉiufoje, kiam ĝi konektiĝas al Wi-Fi, aŭ kiam vi frapetas „Synchronizuj teraz”. La komputilo devas esti ŝaltita kaj atingebla (sama reto aŭ Tailscale); ĝis tiam la ŝanĝoj atendas en la legilo.

### Kio trapasas la servilon de la aŭtoro

Nur parigo per sescifera kodo el alia reto uzas la renkontejon `koligilo.sypian.ski`, servilon de la aŭtoro. Dum maksimume 10 minutoj, nur en la memoro, ĝi tenas la modelon de la legilo, la adreson de via servilo kaj la ŝlosilon por tiu legilo; ĝi forigas ilin, tuj kiam la legilo ricevas ilin. Viajn agordojn, kontojn aŭ librojn ĝi neniam vidas. Parigo en la sama Wi-Fi-reto aŭ per kablo ne uzas ĝin. Vi povas funkciigi vian propran: `koligilo --rendezvous ADRESO` en la komputilo kaj la ŝlosilo `rendezvous` en `settings/koligilo.lua` en la legilo.

## Krome

- **Via propra servilo.** Anstataŭ la komputilo, VPS povas esti la servilo (`koligilo serve`). La datumoj transiras inter ili sen nova parigo de la legiloj. Detaloj: [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md) (pole).
- **Kromprogramoj.** Galerio de kromprogramoj por KOReader el GitHub, fiksitaj al konkreta enmeto (commit). Instalo, ĝisdatigo aŭ forigo okazas nur post via konfirmo en la legilo (KOReader 2025.08 aŭ pli nova).
- **Kion koligilo ne faras.** Ĝi ne movas librojn nek legoprogreson. Progreso kaj statistikoj plu sinkroniĝas per la propraj mekanismoj de KOReader; koligilo nur disdonas ilian agordaron.

## Rimarkoj

koligilo estas en beta-stadio. Se io rompiĝas, kondutas strange aŭ mankas, sciigu min:

- [Raportu ĉe GitHub](https://github.com/sypianski/koligilo/issues/new). Cimoj, ideoj kaj demandoj ĉiuj taŭgas tie; indiku la modelon de via legilo, la version de KOReader kaj la sistemon de via komputilo.
- Aŭ skribu al jakub.sypianski@gmail.com.

Antaŭ la unua sinkronigo faru sekurkopion de `settings.reader.lua` kaj de la dosierujo `settings/` el via dosierujo de KOReader.

## Kompilado el fontkodo

Necesas Go 1.24 aŭ pli nova.

```bash
make test       # testoj de Go, logiko de la kromprogramo en Lua, sintakso de la interfaco
make dist       # programoj por macOS, Linux kaj Windows + zip de la kromprogramo
make mac-app    # koligilo.app kaj .dmg (en Mac)
```

## Subteno

koligilo estas senpaga. Se ĝi utilas al vi, vi povas [regali min per kafo ĉe Ko-fi](https://ko-fi.com/sypianski).

## Dankoj

[KOReader](https://github.com/koreader/koreader) (AGPL-3.0): la nomoj, priskriboj kaj antaŭagordoj de la opcioj en la panelo estas generitaj el ĝia fontkodo kaj tradukoj. La panelo uzas la tiparon [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next) (SIL OFL 1.1). koligilo estas sub la permesilo GNU Affero General Public License v3.0, vidu [LICENSE](LICENSE).

---

<p align="center">koligilo · <a href="https://sypian.ski/">Jakub Sypiański</a> · AGPL-3.0</p>
