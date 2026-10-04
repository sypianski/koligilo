// koligilo — synchronizacja ustawień KOReadera między urządzeniami.
// Jedna binarka: `koligilo` (panel na komputerze) albo `koligilo serve` (serwer).
package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

var Version = "0.5.4"

const usage = `koligilo %s — synchronizacja ustawień KOReadera

  koligilo                 ten komputer jako serwer + panel w przeglądarce
                           (w panelu można zamiast tego wskazać własny serwer)
      --port N             port panelu, tylko 127.0.0.1 (domyślnie %d)
      --listen ADDR        API czytników w sieci (domyślnie :7210)
      --data DIR           dane wbudowanego serwera
                           (domyślnie <katalog konfiguracji>/koligilo/dane)
      --rendezvous URL     punkt kontaktowy parowania kodem
      --no-browser         nie otwieraj przeglądarki

  koligilo serve           serwer synchronizacji (np. na VPS)
      --listen ADDR        adres nasłuchu (domyślnie 127.0.0.1:7210)
      --data DIR           katalog danych (domyślnie ./koligilo-data)
      --public-url URL     publiczny adres, pod którym widzą go czytniki
      --rendezvous URL     zewnętrzny punkt kontaktowy do parowania kodem
                           (domyślnie: ten serwer)

  koligilo admin-token      nowy token administratora (stary przestaje działać)
      --data DIR           katalog danych serwera
      --out PLIK           zapisz token do pliku (0600) zamiast wypisywać

  koligilo export --data DIR PLIK.tar.gz
                           eksport danych (urządzenia, wartości, wtyczki, galeria)
  koligilo import --data DIR [--replace] PLIK.tar.gz
                           import eksportu (serwer musi być wyłączony); tokeny
                           czytników zostają, kopia starego stanu w .pre-import-*

  koligilo version
`

func main() {
	log.SetFlags(log.LstdFlags)
	args := os.Args[1:]
	cmd := ""
	if len(args) > 0 && args[0] != "" && args[0][0] != '-' {
		cmd, args = args[0], args[1:]
	}
	switch cmd {
	case "", "desktop":
		fs := flag.NewFlagSet("koligilo", flag.ExitOnError)
		port := fs.Int("port", DesktopPort, "")
		listen := fs.String("listen", fmt.Sprintf(":%d", DevicePort), "")
		data := fs.String("data", defaultDataDir(), "")
		rendezvous := fs.String("rendezvous", "", "")
		noBrowser := fs.Bool("no-browser", false, "")
		fs.Usage = func() { fmt.Printf(usage, Version, DesktopPort) }
		fs.Parse(args)
		if err := runDesktop(desktopOpts{port: *port, devListen: *listen, data: *data, rendezvous: *rendezvous, open: !*noBrowser}); err != nil {
			log.Fatal(err)
		}
	case "serve":
		fs := flag.NewFlagSet("serve", flag.ExitOnError)
		listen := fs.String("listen", "127.0.0.1:7210", "")
		data := fs.String("data", "koligilo-data", "")
		public := fs.String("public-url", "", "")
		rendezvous := fs.String("rendezvous", "", "")
		fs.Usage = func() { fmt.Printf(usage, Version, DesktopPort) }
		fs.Parse(args)
		st, newAdmin, err := OpenStore(*data)
		if err != nil {
			log.Fatal(err)
		}
		if newAdmin != "" {
			fmt.Printf("\n  Pierwsze uruchomienie. Token administratora (pokazywany TYLKO RAZ):\n\n      %s\n\n  Wklej go w panelu koligilo na komputerze.\n\n", newAdmin)
		}
		srv := &Server{st: st, publicURL: strings.TrimRight(*public, "/")}
		srv.rv = NewRendezvous()
		srv.rvc = rvClient{self: srv.rv, remote: strings.TrimRight(*rendezvous, "/")}
		srv.gal = NewGallery(st)
		routes := srv.Routes()
		startGalleryTicker(srv.gal, nil)
		log.Printf("koligilo %s serwer na %s (dane: %s)", Version, *listen, *data)
		log.Fatal(http.ListenAndServe(*listen, routes))
	case "admin-token":
		// Token wypisywany TU, w terminalu — nie w logach usługi (journald).
		// Też ratunek, gdy token zginął: urządzenia i ustawienia zostają.
		fs := flag.NewFlagSet("admin-token", flag.ExitOnError)
		data := fs.String("data", "koligilo-data", "")
		out := fs.String("out", "", "")
		fs.Parse(args)
		st, _, err := OpenStore(*data)
		if err != nil {
			log.Fatal(err)
		}
		tok, err := st.ResetAdmin()
		if err != nil {
			log.Fatal(err)
		}
		if *out != "" { // do pliku (0600), np. żeby przekazać go dalej bez wyświetlania
			if err := os.WriteFile(*out, []byte(tok+"\n"), 0o600); err != nil {
				log.Fatal(err)
			}
			fmt.Printf("Nowy token administratora zapisany w %s\n", *out)
			return
		}
		fmt.Printf("Nowy token administratora (wklej w panelu koligilo):\n\n    %s\n\n", tok)
	case "export", "import":
		fs := flag.NewFlagSet(cmd, flag.ExitOnError)
		data := fs.String("data", "koligilo-data", "")
		replace := fs.Bool("replace", false, "")
		fs.Parse(args)
		if fs.NArg() != 1 {
			fmt.Printf(usage, Version, DesktopPort)
			os.Exit(2)
		}
		st, _, err := OpenStore(*data)
		if err != nil {
			log.Fatal(err)
		}
		if cmd == "export" {
			f, err := os.OpenFile(fs.Arg(0), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
			if err != nil {
				log.Fatal(err)
			}
			if err := ExportArchive(st, f); err != nil {
				log.Fatal(err)
			}
			if err := f.Close(); err != nil {
				log.Fatal(err)
			}
			fmt.Printf("Eksport zapisany w %s\n", fs.Arg(0))
			return
		}
		f, err := os.Open(fs.Arg(0))
		if err != nil {
			log.Fatal(err)
		}
		defer f.Close()
		sum, err := ImportArchive(st, nil, f, *replace)
		if err != nil {
			log.Fatal(err, " (dodaj --replace, żeby nadpisać)")
		}
		fmt.Printf("Zaimportowano: %d urządzeń, %d wartości, %d wtyczek. Czytniki synchronizują się dalej swoimi tokenami.\n", sum.Devices, sum.Values, sum.Plugins)
	case "version":
		fmt.Println(Version)
	case "help", "-h", "--help":
		fmt.Printf(usage, Version, DesktopPort)
	default:
		fmt.Printf(usage, Version, DesktopPort)
		os.Exit(2)
	}
}

// startGalleryTicker: okresowe sprawdzanie aktualizacji wtyczek z galerii
// (TASK-12) — nie od razu (żeby nie palić limitu GitHub API przy każdym
// restarcie), tylko co 12h; „od razu” i tak sprawdza pierwszy GET z panelu.
// active (może być nil) pozwala pominąć sprawdzenie, np. gdy komputer nie
// jest akurat serwerem.
func startGalleryTicker(g *Gallery, active func() bool) {
	go func() {
		t := time.NewTicker(12 * time.Hour)
		defer t.Stop()
		for range t.C {
			if active != nil && !active() {
				continue
			}
			if n, err := g.CheckUpdates(); err != nil {
				log.Printf("koligilo: okresowe sprawdzenie aktualizacji galerii nie powiodło się (sprawdzono %d): %v", n, err)
			}
		}
	}()
}
