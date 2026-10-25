<div align="center">
  <img src="docs/icon.png" width="96" height="96" alt="" />
  <h1>koligilo</h1>
  <p>Set up KOReader from a panel on your computer and keep those settings the same on all your e-readers.</p>
  <p>by <a href="https://sypian.ski/">Jakub Sypiański</a> · License: AGPL-3.0</p>
  <p>Version 0.9.1 · updated 25 October 2026</p>
  <p><strong>Beta.</strong> Feedback is very welcome: <a href="https://github.com/sypianski/koligilo/issues">open an issue</a>.</p>

  [![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
  ![Platform](https://img.shields.io/badge/computer-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-brightgreen)
  ![Reader](https://img.shields.io/badge/reader-KOReader-lightgrey)
  ![Interface](https://img.shields.io/badge/interface-Polski-orange)

  <p><a href="https://sypian.ski/koligilo/">Website</a></p>

  <p><b>English</b> · <a href="README.pl.md">Polski</a> · <a href="README.eo.md">Esperanto</a></p>
</div>

<p align="center">
  <img src="docs/demo.png" width="800" alt="Screenshots of the koligilo panel with demo data: a pairing request with a 4-digit code, three paired e-readers, the matrix of setting groups per device, font size presets, and a Wallabag account" />
</p>

Set the font, margins, status bar or style tweaks in a panel on your computer, with the same names, descriptions and presets as in KOReader, instead of going through the menus of each e-reader. Changes made on one e-reader reach the others too, and Wallabag, kosync or Dropbox accounts are entered only once. Everything stays with you: the server is your own computer, not a cloud.

The panel and the reader plugin are in Polish for now.

## Download

**[Download koligilo.dmg](https://github.com/sypianski/koligilo/releases/latest/download/koligilo.dmg)** for macOS, version 0.9.1, released 25 October 2026. Windows, Linux and the e-reader plugin are in the table below.

The computer side runs on **macOS, Windows and Linux**. It is the same app with the same panel everywhere. The e-reader needs KOReader.

| System | File | Notes |
|---|---|---|
| macOS (Apple Silicon and Intel) | [koligilo.dmg](https://github.com/sypianski/koligilo/releases/latest/download/koligilo.dmg) | Open it and drag koligilo into Applications. Signed and notarised by Apple. It stays in the menu bar after you close the window, so your readers can keep syncing. |
| Windows | [koligilo-windows-amd64.exe](https://github.com/sypianski/koligilo/releases/latest/download/koligilo-windows-amd64.exe) | The panel opens in your browser. On first start, allow access on **private networks** in Windows Firewall, or your readers will not find the computer. SmartScreen: “More info” → “Run anyway”. |
| Linux | [amd64](https://github.com/sypianski/koligilo/releases/latest/download/koligilo-linux-amd64) · [arm64](https://github.com/sypianski/koligilo/releases/latest/download/koligilo-linux-arm64) | `chmod +x` and run it; the panel opens in your browser. If you use a firewall, open TCP 7210 and UDP 47470. |
| E-reader | [koligilo.koplugin.zip](https://github.com/sypianski/koligilo/releases/latest/download/koligilo.koplugin.zip) | Unzip into `koreader/plugins/` and restart KOReader, or connect the reader by cable and let the panel install it. |

On Windows and Linux there is no tray icon yet: the panel works while the process runs, so closing its window stops syncing.

Most testing so far happened on macOS and on Android readers. Reports from Windows, Linux, Kobo, Kindle and PocketBook are especially welcome.

Before the first sync, back up `settings.reader.lua` and the `settings/` folder from your KOReader directory.

## What it does

### Set up once, in the panel

The “Ustawienia czytników” (reader settings) tab shows 30 KOReader options in seven sections (font, page layout, document settings, style tweaks, status bar, file browser, reading statistics) with KOReader's own names, descriptions, presets and ranges. A change made there reaches every reader at its next sync. Everything the map does not know is still editable as raw values under “Zaawansowane” (advanced).

Accounts are entered once in the panel: kosync, Wallabag, Dropbox (sign-in with a code), WebDAV and FTP for statistics and vocabulary sync. A new reader gets them with its first sync.

### Choose what goes where

You pick setting groups per device: appearance, font size and margins, style tweaks, fonts, footer and progress bar, dictionaries, gestures, keyboard shortcuts, profiles, file browser, statistics options, accounts, KOPad, on-screen keyboard, AI assistant, Rosetta. Your Kindle can share dictionaries and gestures but keep its own font size.

The KOPad group shares one thing: the gamepad button mapping — which control of each known pad layout (Xbox, PlayStation, Nintendo, Valve) plays which role, and what each role does while you read (for example RB opening the top menu instead of turning the page) — which you edit in the panel under Wtyczki → “Ustawienia wtyczek”. Whether KOPad is switched on, and which layout a pad uses, stay on each device.

Settings are merged key by key. Settings that belong to one device (screen DPI, frontlight, paths, Wi-Fi, rotation, night mode) are never synced. If more than half of the synced settings disappear at once, for example because of a damaged file, the reader stops and sends nothing.

### Pairing a reader

On the reader: **Menu → Tools → koligilo → Połącz z komputerem**.

- **Same Wi-Fi:** the reader finds the computer by itself; you compare a 4-digit code and confirm in the panel.
- **Cable:** the panel installs the plugin and pairs the reader.
- **Any other network** (university, hotel, VPN): the reader shows a 6-digit code that you type into the panel.

After pairing, the reader syncs whenever it connects to Wi-Fi, or when you tap “Synchronizuj teraz”. The computer has to be on and reachable (same network or Tailscale); until then changes wait on the reader.

#### What passes through the author's server

Only pairing with a 6-digit code from another network uses a rendezvous point at `koligilo.sypian.ski`, a server run by the author. For at most 10 minutes, in memory only, it holds the reader's model, your server's address and the key for that reader; it deletes them as soon as the reader picks them up. It never sees your settings, accounts or books. Pairing over the same Wi-Fi or by cable does not use it. You can run your own: `koligilo --rendezvous URL` on the computer and the `rendezvous` key in `settings/koligilo.lua` on the reader.

### Also

- **Your own server.** Instead of the computer, a VPS can be the server (`koligilo serve`). Data moves between the two without pairing the readers again. Details: [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md) (Polish).
- **Plugins.** A gallery of KOReader plugins from GitHub, pinned to a commit. Installing, updating or removing a plugin happens only after you confirm it on the reader (KOReader 2025.08 or newer).
- **Updating koligilo.** A reader can offer a newer koligilo version itself, but only if you turn that on in the reader's menu ("Pozwól aktualizować koligilo"). You confirm every update in a dialog showing both version numbers, the file is checked against a sha256 sum, and KOReader has to be restarted afterwards. The previous version stays in `.koligilo-old-koligilo` until the next start.
- **What koligilo does not do.** It does not move books or reading progress. How you sync those is up to you (for example KOReader's built-in progress sync, or Syncthing); koligilo only handles settings.

## Technical notes

**Architecture.** One Go binary (`koligilo`) is both the server and the panel, which is a web interface embedded in the binary and opened in the browser. On the computer it keeps its data locally and talks to the readers on port 7210 (the panel itself listens only on 127.0.0.1); `koligilo serve` runs the same server on a VPS. On the e-reader there is a Lua plugin, `koligilo.koplugin`, that does the syncing. Values travel as Lua literals, and the catalog in `catalog.go` is the single source of truth for what may be synchronised. More in [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md) (Polish).

**Data and network.** Settings and accounts stay on your computer (or your own server) and on your readers. The only exception is the optional 6-digit-code pairing described above, which uses the rendezvous point at `koligilo.sypian.ski`.

### Building from source

Needs Go 1.24 or newer.

```bash
make dist       # binaries for macOS, Linux, Windows + plugin zip
make mac-app    # koligilo.app and .dmg (on a Mac)
```

### Tests

```bash
make test       # Go tests, plugin logic in Lua, UI syntax
make e2e        # a fresh server and two simulated readers over real HTTP
```

## How this was made

koligilo was written largely by Claude, working from my specifications and under my direction ("vibe coding"). I reviewed and tested the results, but the code has not had an independent audit. Treat it as you would any young project and report what you find.

## Feedback

koligilo is in beta. If something breaks, behaves oddly or is missing, tell me:

<!-- feedback-form: https://sypian.ski/uwagi/?app=koligilo -->
- [Open an issue on GitHub](https://github.com/sypianski/koligilo/issues/new). Bug reports, ideas and questions are all fine there; include your reader model, KOReader version and your computer's system.
- Or email jakub.sypianski@gmail.com.

## Support

koligilo is free. If it is useful to you, you can [buy me a coffee on Ko-fi](https://ko-fi.com/sypianski).

## License and credits

koligilo is licensed under the GNU Affero General Public License v3.0, see [LICENSE](LICENSE).

[KOReader](https://github.com/koreader/koreader) (AGPL-3.0): the option names, descriptions and presets in the panel are generated from its source and translations. The panel uses [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next) (SIL OFL 1.1). 

---

<p align="center">koligilo · <a href="https://sypian.ski/">Jakub Sypiański</a> · AGPL-3.0</p>
