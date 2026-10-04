package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Nagłówek, który web/app.js dokleja do każdego żądania /api/* w panelu
// desktopowym — wymuszony przez guard() jako obrona przed CSRF (proste
// żądania cross-site nie mogą ustawić niestandardowych nagłówków bez
// preflightu CORS, a desktop nigdy nie odpowiada Access-Control-Allow-*,
// więc przeglądarka nie dostanie zgody). Musi być identyczny z HDR w app.js.
const guardHeader = "X-Koligilo"

// Tryb desktopowy (TASK-15): jeden proces, dwa tryby.
//   - "local" (domyślny): ten komputer JEST serwerem — wbudowany Store w
//     katalogu konfiguracji użytkownika, API czytników na osobnym nasłuchu
//     (0.0.0.0:7210, tylko /api/v1/*), panel na 127.0.0.1 za guard()
//     obsługuje /api/admin/* lokalnie, bez tokenu.
//   - "remote" („Mój serwer”): panel + proxy /api/admin/* do zewnętrznego
//     serwera z doklejonym tokenem administratora (dawne zachowanie).
// Discovery UDP odpowiada czytnikom adresem serwera w obu trybach.

const (
	DiscoveryPort     = 47470
	DesktopPort       = 47471
	DevicePort        = 7210
	DefaultRendezvous = "https://koligilo.sypian.ski" // jak DEFAULT_RENDEZVOUS w main.lua
	discoveryAsk      = "koligilo?"
	ModeLocal         = "local"
	ModeRemote        = "remote"
)

type LocalConfig struct {
	Mode       string `json:"mode,omitempty"`   // "local" | "remote"
	Chosen     bool   `json:"chosen,omitempty"` // użytkownik przeszedł kreator
	Server     string `json:"server"`
	AdminToken string `json:"admin_token"`
	PublicURL  string `json:"public_url,omitempty"` // tryb komputera: adres dla czytników nadpisany w panelu
}

type Desktop struct {
	mu   sync.Mutex
	cfg  LocalConfig
	path string

	// wbudowany serwer — otwarty zawsze, żeby przełączać tryb bez restartu
	st       *Store
	gal      *Gallery
	adminMux http.Handler // Server z trustAdmin — WYŁĄCZNIE za guard() na 127.0.0.1
	devMux   http.Handler // osobny Server bez zaufania admina, odfiltrowany do /api/v1/*
	devAddr  string
	devPort  int
	devUp    bool
	devErr   string
	moving   bool // trwają przenosiny — czytniki dostają 503 zamiast zapisu, który by zginął
}

func configPath() string {
	d, err := os.UserConfigDir()
	if err != nil {
		d = "."
	}
	return filepath.Join(d, "koligilo", "config.json")
}

// defaultDataDir: dane wbudowanego serwera obok config.json, w formacie serve --data.
func defaultDataDir() string { return filepath.Join(filepath.Dir(configPath()), "dane") }

// load czyta config.json i migruje starą konfigurację: kto miał wpisany
// zewnętrzny serwer, zostaje w trybie „Mój serwer” (nic nie przełącza się samo).
func (dk *Desktop) load() {
	dk.path = configPath()
	if b, err := os.ReadFile(dk.path); err == nil {
		json.Unmarshal(b, &dk.cfg)
	}
	if dk.cfg.Mode == "" {
		if dk.cfg.Server != "" {
			dk.cfg.Mode, dk.cfg.Chosen = ModeRemote, true
		} else {
			dk.cfg.Mode = ModeLocal
		}
	}
	if dk.cfg.Mode == ModeRemote && dk.cfg.Server == "" {
		dk.cfg.Mode = ModeLocal
	}
}

func (dk *Desktop) save() error {
	os.MkdirAll(filepath.Dir(dk.path), 0o700)
	b, _ := json.MarshalIndent(dk.cfg, "", "  ")
	return os.WriteFile(dk.path, b, 0o600)
}

func (dk *Desktop) get() LocalConfig {
	dk.mu.Lock()
	defer dk.mu.Unlock()
	return dk.cfg
}

func (dk *Desktop) update(f func(c *LocalConfig)) error {
	dk.mu.Lock()
	defer dk.mu.Unlock()
	f(&dk.cfg)
	return dk.save()
}

func (dk *Desktop) mode() string { return dk.get().Mode }

// NewDesktop otwiera wbudowany serwer w katalogu data i buduje oba routery.
// devListen to adres nasłuchu API czytników (np. ":7210"); sam nasłuch
// startuje w startDevices().
func NewDesktop(data, devListen, rendezvous string) (*Desktop, error) {
	dk := &Desktop{devAddr: devListen}
	dk.load()
	st, _, err := OpenStore(data) // token admina zbędny: panel lokalny jest zaufany
	if err != nil {
		return nil, err
	}
	dk.st, dk.gal = st, NewGallery(st)
	rv := NewRendezvous()
	if rendezvous == "" {
		rendezvous = DefaultRendezvous // tam czytniki otwierają sesje parowania kodem
	}
	rvc := rvClient{self: rv, remote: strings.TrimRight(rendezvous, "/")}
	local := &Server{st: st, rv: rv, rvc: rvc, gal: dk.gal, pubFn: dk.publicURL, trustAdmin: true}
	dev := &Server{st: st, rv: rv, rvc: rvc, gal: dk.gal, pubFn: dk.publicURL}
	dk.adminMux = local.Routes()
	dk.devMux = dk.deviceOnly(dev.Routes())
	if _, p, err := net.SplitHostPort(devListen); err == nil {
		dk.devPort, _ = strconv.Atoi(p)
	}
	return dk, nil
}

// deviceOnly: nasłuch w sieci przepuszcza WYŁĄCZNIE API czytników. Panel,
// statyki i /api/admin/* są tu 404 (AC4) — niezależnie od tego, że ta
// instancja Server i tak wymaga tokenu administratora.
func (dk *Desktop) deviceOnly(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if !strings.HasPrefix(p, "/api/v1/") && p != "/koligilo.koplugin.zip" {
			http.NotFound(w, r)
			return
		}
		dk.mu.Lock()
		mode, moving := dk.cfg.Mode, dk.moving
		dk.mu.Unlock()
		if p == "/api/v1/ping" {
			h.ServeHTTP(w, r)
			return
		}
		if moving {
			writeJSON(w, 503, map[string]string{"error": "koligilo przenosi dane — spróbuj za chwilę"})
			return
		}
		// „Mój serwer”: lokalny magazyn nie przyjmuje synchronizacji (czytniki
		// nie mogą rozjechać się na dwa miejsca). Po przenosinach przepuszczamy
		// tylko to, co idzie przez Server.device — a ono odpowie 410 z nowym adresem.
		if mode != ModeLocal {
			viaDevice := p == "/api/v1/sync" || strings.HasPrefix(p, "/api/v1/plugins")
			if dk.st.MovedTo() == "" || !viaDevice {
				writeJSON(w, 503, map[string]string{"error": "ten komputer nie jest teraz serwerem koligilo (panel wskazuje własny serwer)"})
				return
			}
		}
		h.ServeHTTP(w, r)
	})
}

// startDevices uruchamia nasłuch API czytników, jeśli jeszcze nie działa.
// Raz uruchomiony zostaje — o zachowaniu decyduje tryb (deviceOnly).
func (dk *Desktop) startDevices() {
	dk.mu.Lock()
	defer dk.mu.Unlock()
	if dk.devUp {
		return
	}
	ln, err := net.Listen("tcp", dk.devAddr)
	if err != nil {
		dk.devErr = fmt.Sprintf("nie mogę nasłuchiwać na %s: %v (czy działa tu jeszcze osobny koligilo serve?)", dk.devAddr, err)
		log.Print(dk.devErr)
		return
	}
	dk.devUp, dk.devErr = true, ""
	dk.devPort = ln.Addr().(*net.TCPAddr).Port
	log.Printf("koligilo: API czytników na %s", ln.Addr())
	go http.Serve(ln, dk.devMux)
}

// publicURL: adres wbudowanego serwera dla czytników — nadpisany w panelu
// albo wykryty (Tailscale 100.x, potem prywatne IPv4).
func (dk *Desktop) publicURL() string {
	if c := dk.get(); c.PublicURL != "" {
		return c.PublicURL
	}
	return dk.urlFor(lanIP(nil))
}

func (dk *Desktop) urlFor(ip string) string {
	if ip == "" {
		return ""
	}
	dk.mu.Lock()
	port := dk.devPort
	dk.mu.Unlock()
	return "http://" + net.JoinHostPort(ip, strconv.Itoa(port))
}

var tailscaleNet = &net.IPNet{IP: net.IPv4(100, 64, 0, 0).To4(), Mask: net.CIDRMask(10, 32)}

// lanIP wybiera adres IPv4 tego komputera: najpierw z podsieci pytającego
// czytnika (discovery), potem Tailscale, potem pierwszy prywatny.
func lanIP(peer net.IP) string {
	addrs, _ := net.InterfaceAddrs()
	var ts, priv string
	for _, a := range addrs {
		n, ok := a.(*net.IPNet)
		if !ok || n.IP.To4() == nil || n.IP.IsLoopback() {
			continue
		}
		if peer != nil && n.Contains(peer) {
			return n.IP.String()
		}
		switch {
		case tailscaleNet.Contains(n.IP):
			if ts == "" {
				ts = n.IP.String()
			}
		case n.IP.IsPrivate():
			if priv == "" {
				priv = n.IP.String()
			}
		}
	}
	if ts != "" {
		return ts
	}
	return priv
}

func normalizeServer(s string) (string, error) {
	s = strings.TrimRight(strings.TrimSpace(s), "/")
	if s == "" {
		return "", errors.New("podaj adres serwera")
	}
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return "", errors.New("to nie wygląda na adres serwera")
	}
	return s, nil
}

// checkServer sprawdza adres i token, zwracając czytelny komunikat dla człowieka.
func checkServer(server, token string) error {
	c := &http.Client{Timeout: 8 * time.Second}
	resp, err := c.Get(server + "/api/v1/ping")
	if err != nil {
		return fmt.Errorf("nie mogę połączyć się z %s — sprawdź adres i internet (%v)", server, err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("pod %s odpowiada coś, co nie jest serwerem koligilo (HTTP %d)", server, resp.StatusCode)
	}
	req, _ := http.NewRequest("GET", server+"/api/admin/state", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err = c.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode == 401 {
		return errors.New("serwer działa, ale token administratora jest niepoprawny")
	}
	return nil
}

// remoteDo: żądanie do zewnętrznego serwera z tokenem administratora.
func remoteDo(method, server, token, path, ctype string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequest(method, server+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if ctype != "" {
		req.Header.Set("Content-Type", ctype)
	}
	resp, err := (&http.Client{Timeout: 5 * time.Minute}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("serwer nie odpowiada: %w", err)
	}
	return resp, nil
}

func (dk *Desktop) configView() map[string]any {
	c := dk.get()
	dk.mu.Lock()
	up, derr, port := dk.devUp, dk.devErr, dk.devPort
	dk.mu.Unlock()
	return map[string]any{
		"configured":      c.Mode == ModeLocal || c.Server != "",
		"chosen":          c.Chosen,
		"mode":            c.Mode,
		"server":          c.Server,
		"public_url":      dk.publicURL(),
		"public_override": c.PublicURL != "",
		"device_port":     port,
		"device_up":       up,
		"device_error":    derr,
		"moved_to":        dk.st.MovedTo(),
		"data_dir":        dk.st.Dir(),
		"local":           dk.st.summary(),
	}
}

func (dk *Desktop) Routes() *http.ServeMux {
	m := http.NewServeMux()
	m.HandleFunc("GET /api/local/config", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, dk.configView())
	})
	// „Mój serwer”: sprawdź adres i token, przełącz panel na proxy.
	m.HandleFunc("POST /api/local/config", func(w http.ResponseWriter, r *http.Request) {
		var in LocalConfig
		json.NewDecoder(r.Body).Decode(&in)
		srv, err := normalizeServer(in.Server)
		if err == nil {
			err = checkServer(srv, strings.TrimSpace(in.AdminToken))
		}
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error()})
			return
		}
		if err := dk.update(func(c *LocalConfig) {
			c.Mode, c.Chosen, c.Server, c.AdminToken = ModeRemote, true, srv, strings.TrimSpace(in.AdminToken)
		}); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	// Przełączenie trybu bez restartu i bez ruszania danych lokalnych.
	m.HandleFunc("POST /api/local/mode", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Mode string `json:"mode"`
		}
		json.NewDecoder(r.Body).Decode(&in)
		switch {
		case in.Mode == ModeRemote && dk.get().Server == "":
			writeJSON(w, 400, map[string]string{"error": "najpierw podaj adres i token swojego serwera"})
			return
		case in.Mode != ModeLocal && in.Mode != ModeRemote:
			writeJSON(w, 400, map[string]string{"error": "nieznany tryb"})
			return
		}
		if err := dk.update(func(c *LocalConfig) { c.Mode, c.Chosen = in.Mode, true }); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		if in.Mode == ModeLocal {
			dk.startDevices()
		}
		writeJSON(w, 200, dk.configView())
	})
	// dawne „Zmień serwer”: zapomnij zewnętrzny serwer, wróć do trybu komputera
	m.HandleFunc("POST /api/local/disconnect", func(w http.ResponseWriter, r *http.Request) {
		dk.update(func(c *LocalConfig) { *c = LocalConfig{Mode: ModeLocal, Chosen: true, PublicURL: c.PublicURL} })
		dk.startDevices()
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	m.HandleFunc("POST /api/local/public-url", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			URL string `json:"url"`
		}
		json.NewDecoder(r.Body).Decode(&in)
		u := ""
		if strings.TrimSpace(in.URL) != "" {
			var err error
			if u, err = checkMoveURL(in.URL); err != nil {
				writeJSON(w, 400, map[string]string{"error": err.Error()})
				return
			}
		}
		dk.update(func(c *LocalConfig) { c.PublicURL = u })
		writeJSON(w, 200, dk.configView())
	})
	// kopia danych tego komputera (niezależnie od trybu)
	m.HandleFunc("GET /api/local/export", func(w http.ResponseWriter, r *http.Request) {
		var buf bytes.Buffer
		if err := ExportArchive(dk.st, &buf); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		w.Header().Set("Content-Type", "application/gzip")
		w.Header().Set("Content-Disposition", `attachment; filename="koligilo-komputer-`+time.Now().Format("2006-01-02")+`.tar.gz"`)
		w.Write(buf.Bytes())
	})
	m.HandleFunc("POST /api/local/move", dk.handleMoveOut)
	m.HandleFunc("POST /api/local/move-here", dk.handleMoveHere)
	dk.usbRoutes(m)
	// /api/admin/*: w trybie komputera obsługuje je wbudowany serwer, w trybie
	// „Mój serwer” proxy — przeglądarka nie zna tokenu, dokleja go ten proces.
	m.HandleFunc("/api/admin/", func(w http.ResponseWriter, r *http.Request) {
		c := dk.get()
		if c.Mode == ModeLocal {
			dk.adminMux.ServeHTTP(w, r)
			return
		}
		if c.Server == "" {
			writeJSON(w, 409, map[string]string{"error": "nie wybrano jeszcze serwera"})
			return
		}
		target, _ := url.Parse(c.Server)
		p := httputil.NewSingleHostReverseProxy(target)
		orig := p.Director
		p.Director = func(req *http.Request) {
			orig(req)
			req.Host = target.Host
			req.Header.Set("Authorization", "Bearer "+c.AdminToken)
			// Nasz nagłówek-obrona i ciasteczka przeglądarki to sprawa
			// wyłącznie tej strony proxy — serwer ich nie potrzebuje.
			req.Header.Del(guardHeader)
			req.Header.Del("Cookie")
		}
		p.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
			writeJSON(w, 502, map[string]string{"error": "serwer nie odpowiada: " + err.Error()})
		}
		p.ServeHTTP(w, r)
	})
	sub, _ := fs.Sub(webFS, "web")
	// "/" bez metody: "GET /" koliduje w ServeMux (Go 1.22+) z "/api/admin/"
	m.Handle("/", http.FileServerFS(sub))
	return m
}

func (dk *Desktop) setMoving(v bool) {
	dk.mu.Lock()
	dk.moving = v
	dk.mu.Unlock()
}

// moveOut: komputer → własny serwer. Eksport lokalnego stanu, import na
// serwerze, potem lokalny magazyn odpowiada czytnikom 410 {moved_to}.
// Na czas przenosin API czytników daje 503 — zapis w tym oknie by zginął,
// a przedwczesne 410 skierowałoby czytnik na serwer, który go jeszcze nie zna
// (401 = plugin kasuje token).
func (dk *Desktop) moveOut(server, token string, replace bool) (ImportSummary, int, error) {
	srv, err := normalizeServer(server)
	if err == nil {
		err = checkServer(srv, token)
	}
	if err != nil {
		return ImportSummary{}, 400, err
	}
	dk.setMoving(true)
	defer dk.setMoving(false)
	var buf bytes.Buffer
	if err := ExportArchive(dk.st, &buf); err != nil {
		return ImportSummary{}, 500, err
	}
	q := ""
	if replace {
		q = "?replace=1"
	}
	resp, err := remoteDo("POST", srv, token, "/api/admin/import"+q, "application/gzip", &buf)
	if err != nil {
		return ImportSummary{}, 502, err
	}
	var out struct {
		Error    string        `json:"error"`
		Imported ImportSummary `json:"imported"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	resp.Body.Close()
	if resp.StatusCode != 200 {
		if out.Error == "" {
			out.Error = fmt.Sprintf("serwer odrzucił import (HTTP %d) — czy działa na nim koligilo ≥ 0.4?", resp.StatusCode)
		}
		return ImportSummary{}, resp.StatusCode, errors.New(out.Error)
	}
	// Czytniki kierujemy pod adres, pod którym serwer sam się widzi (public_url),
	// a gdy go nie zna — pod adres podany w panelu.
	moved := srv
	if resp, err := remoteDo("GET", srv, token, "/api/admin/state", "", nil); err == nil {
		var st struct {
			PublicURL string `json:"public_url"`
		}
		json.NewDecoder(resp.Body).Decode(&st)
		resp.Body.Close()
		if u, err := checkMoveURL(st.PublicURL); err == nil {
			moved = u
		}
	}
	if err := dk.st.SetMovedTo(moved); err != nil {
		return ImportSummary{}, 500, err
	}
	dk.update(func(c *LocalConfig) { c.Mode, c.Chosen, c.Server, c.AdminToken = ModeRemote, true, srv, token })
	dk.startDevices() // przekierowania 410 ktoś musi wydawać
	return out.Imported, 200, nil
}

// moveHere: własny serwer → komputer. Import eksportu z serwera do lokalnego
// magazynu, potem serwer przekierowuje czytniki na adres tego komputera.
func (dk *Desktop) moveHere(replace bool) (ImportSummary, int, error) {
	c := dk.get()
	if c.Mode != ModeRemote || c.Server == "" {
		return ImportSummary{}, 409, errors.New("panel nie jest połączony z własnym serwerem")
	}
	if !replace && !dk.st.Empty() && dk.st.MovedTo() == "" {
		return ImportSummary{}, 409, &errNotEmpty{dk.st.summary()}
	}
	dk.startDevices()
	pub := dk.publicURL()
	if _, err := checkMoveURL(pub); err != nil {
		return ImportSummary{}, 409, errors.New("nie znam adresu tego komputera w sieci — wpisz go w polu „Adres dla czytników”")
	}
	resp, err := remoteDo("GET", c.Server, c.AdminToken, "/api/admin/export", "", nil)
	if err != nil {
		return ImportSummary{}, 502, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return ImportSummary{}, 502, fmt.Errorf("serwer nie oddał eksportu (HTTP %d) — czy działa na nim koligilo ≥ 0.4?", resp.StatusCode)
	}
	sum, err := ImportArchive(dk.st, dk.gal, resp.Body, true)
	if err != nil {
		return ImportSummary{}, 500, err
	}
	b, _ := json.Marshal(map[string]string{"moved_to": pub})
	mr, err := remoteDo("POST", c.Server, c.AdminToken, "/api/admin/moved", "application/json", bytes.NewReader(b))
	if err == nil {
		mr.Body.Close()
		if mr.StatusCode != 200 {
			err = fmt.Errorf("HTTP %d", mr.StatusCode)
		}
	}
	if err != nil {
		return sum, 502, fmt.Errorf("dane skopiowane, ale serwer nie przyjął przekierowania czytników (%v) — panel zostaje przy serwerze", err)
	}
	dk.update(func(c *LocalConfig) { c.Mode, c.Chosen = ModeLocal, true })
	return sum, 200, nil
}

func (dk *Desktop) handleMoveOut(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Server     string `json:"server"`
		AdminToken string `json:"admin_token"`
		Replace    bool   `json:"replace"`
	}
	json.NewDecoder(r.Body).Decode(&in)
	sum, code, err := dk.moveOut(in.Server, strings.TrimSpace(in.AdminToken), in.Replace)
	moveReply(w, sum, code, err)
}

func (dk *Desktop) handleMoveHere(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Replace bool `json:"replace"`
	}
	json.NewDecoder(r.Body).Decode(&in)
	sum, code, err := dk.moveHere(in.Replace)
	moveReply(w, sum, code, err)
}

func moveReply(w http.ResponseWriter, sum ImportSummary, code int, err error) {
	if err != nil {
		var ne *errNotEmpty
		writeJSON(w, code, map[string]any{"error": err.Error(), "needs_replace": errors.As(err, &ne) || code == 409})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "imported": sum})
}

// discovery: czytnik rozgłasza "koligilo?" na DiscoveryPort, my odpowiadamy
// "koligilo;<adres serwera>" — w trybie komputera adresem tego komputera
// z podsieci czytnika, w trybie „Mój serwer” adresem zewnętrznego serwera.
func (dk *Desktop) discovery() {
	pc, err := net.ListenPacket("udp4", fmt.Sprintf(":%d", DiscoveryPort))
	if err != nil {
		log.Printf("discovery UDP niedostępne (%v) — czytniki poproszą o ręczny adres", err)
		return
	}
	buf := make([]byte, 64)
	for {
		n, addr, err := pc.ReadFrom(buf)
		if err != nil {
			continue
		}
		if strings.TrimSpace(string(buf[:n])) != discoveryAsk {
			continue
		}
		if u := dk.discoveryAnswer(addr); u != "" {
			pc.WriteTo([]byte("koligilo;"+u), addr)
			log.Printf("czytnik %s pyta o serwer → %s", addr, u)
		}
	}
}

func (dk *Desktop) discoveryAnswer(addr net.Addr) string {
	c := dk.get()
	switch {
	case c.Mode == ModeRemote:
		return c.Server
	case dk.st.MovedTo() != "":
		return dk.st.MovedTo()
	case c.PublicURL != "":
		return c.PublicURL
	}
	var peer net.IP
	if ua, ok := addr.(*net.UDPAddr); ok {
		peer = ua.IP
	}
	return dk.urlFor(lanIP(peer))
}

type desktopOpts struct {
	port       int    // panel (127.0.0.1)
	devListen  string // API czytników (np. ":7210")
	data       string // dane wbudowanego serwera
	rendezvous string
	open       bool
}

func runDesktop(o desktopOpts) error {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", o.port))
	if err != nil {
		// już działa (drugie uruchomienie) — po prostu otwórz przeglądarkę
		if o.open {
			openURL(fmt.Sprintf("http://127.0.0.1:%d/", o.port))
		}
		return fmt.Errorf("port %d zajęty — koligilo już działa? (%w)", o.port, err)
	}
	dk, err := NewDesktop(o.data, o.devListen, o.rendezvous)
	if err != nil {
		return err
	}
	if dk.mode() == ModeLocal || dk.st.MovedTo() != "" {
		dk.startDevices()
	}
	go dk.discovery()
	startGalleryTicker(dk.gal, func() bool { return dk.mode() == ModeLocal })
	u := fmt.Sprintf("http://127.0.0.1:%d/", o.port)
	if dk.mode() == ModeLocal {
		fmt.Printf("koligilo %s — ten komputer jest serwerem (czytniki: %s, dane: %s)\n", Version, dk.publicURL(), o.data)
	} else {
		fmt.Printf("koligilo %s — panel własnego serwera %s\n", Version, dk.get().Server)
	}
	fmt.Printf("panel: %s  (Ctrl+C kończy)\n", u)
	if o.open {
		openURL(u)
	}
	return http.Serve(ln, guard(o.port, dk.Routes()))
}

// guard opakowuje mux panelu desktopowego obroną przed CSRF i DNS rebindingiem.
// Nasłuchujemy tylko na 127.0.0.1, ale to nie wystarcza: dowolna strona w tej
// samej przeglądarce może wysłać żądanie na 127.0.0.1:<port>, a DNS rebinding
// (domena, której A-record zmienia się na 127.0.0.1 po pierwszym rozwiązaniu)
// omija nawet ograniczenie CORS same-origin dla odczytów. Dlatego sprawdzamy:
//   - Host: musi dosłownie wskazywać ten port na loopbacku — obcy Host (rebinding)
//     odrzucamy nawet dla GET;
//   - dla /api/*: musi być obecny nagłówek guardHeader — proste żądania cross-site
//     (formularz, <img>, <script src>) nie mogą go ustawić bez preflightu CORS,
//     a my nigdy nie odpowiadamy Access-Control-Allow-*, więc przeglądarka nie
//     puści takiego żądania z innej strony;
//   - dla metod innych niż GET/HEAD: musi być obecny i zgodny nagłówek Origin —
//     blokuje to również proste żądania POST (multipart/form-urlencoded), które
//     preflightu nie wymagają.
func guard(port int, h http.Handler) http.Handler {
	p := strconv.Itoa(port)
	hosts := map[string]bool{
		"127.0.0.1:" + p: true,
		"localhost:" + p: true,
		"[::1]:" + p:     true,
	}
	origins := map[string]bool{
		"http://127.0.0.1:" + p: true,
		"http://localhost:" + p: true,
		"http://[::1]:" + p:     true,
	}
	forbid := func(w http.ResponseWriter) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "żądanie spoza panelu koligilo odrzucone"})
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !hosts[r.Host] {
			forbid(w)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") && r.Header.Get(guardHeader) == "" {
			forbid(w)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if origin := r.Header.Get("Origin"); origin == "" || !origins[origin] {
				forbid(w)
				return
			}
		}
		h.ServeHTTP(w, r)
	})
}

func openURL(u string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", u)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
	default:
		cmd = exec.Command("xdg-open", u)
	}
	cmd.Start()
}
