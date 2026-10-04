package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TASK-15: komputer jako serwer, „Mój serwer”, przenosiny danych.

func newTestDesktop(t *testing.T) *Desktop {
	t.Helper()
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("HOME", t.TempDir()) // macOS: UserConfigDir = $HOME/Library/Application Support
	dk, err := NewDesktop(t.TempDir(), "127.0.0.1:0", "")
	if err != nil {
		t.Fatal(err)
	}
	return dk
}

// panelDo: żądanie do panelu tak, jak robi je app.js (Host, X-Koligilo, Origin).
func panelDo(t *testing.T, dk *Desktop, method, path string, in any) (int, map[string]any) {
	t.Helper()
	var body io.Reader
	if in != nil {
		b, _ := json.Marshal(in)
		body = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, body)
	req.Host = fmt.Sprintf("127.0.0.1:%d", DesktopPort)
	req.Header.Set(guardHeader, "1")
	req.Header.Set("Origin", fmt.Sprintf("http://127.0.0.1:%d", DesktopPort))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	guard(DesktopPort, dk.Routes()).ServeHTTP(rec, req)
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func devGet(t *testing.T, base, path, tok string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest("GET", base+path, nil)
	if tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func devBase(dk *Desktop) string { return fmt.Sprintf("http://127.0.0.1:%d", dk.devPort) }

// AC1+AC4: jeden proces — nasłuch czytników w sieci obsługuje tylko /api/v1/*,
// panel admina działa bez tokenu wyłącznie za guard() (obcy Host → 403).
func TestLocalListenerSplit(t *testing.T) {
	dk := newTestDesktop(t)
	dk.startDevices()
	if !dk.devUp {
		t.Fatalf("nasłuch czytników nie wstał: %s", dk.devErr)
	}
	base := devBase(dk)
	for _, p := range []string{"/api/admin/state", "/api/admin/export", "/", "/index.html", "/api/local/config"} {
		if c, _ := devGet(t, base, p, ""); c != 404 {
			t.Errorf("nasłuch czytników: %s → %d, chcę 404", p, c)
		}
	}
	if c, _ := devGet(t, base, "/api/v1/ping", ""); c != 200 {
		t.Errorf("ping → %d", c)
	}
	// czytnik paruje się z wbudowanym serwerem i synchronizuje
	d, tok, _ := dk.st.Provision("Kobo", "Kobo", "Kobo", "")
	if c, out := devGet(t, base, "/api/v1/sync", tok); c != 200 || out["device"] == nil {
		t.Errorf("sync z wbudowanym serwerem → %d %v", c, out)
	}
	// panel: własny Host → 200 bez tokenu, obcy Host → 403
	if c, out := panelDo(t, dk, "GET", "/api/admin/state", nil); c != 200 || len(out["devices"].([]any)) != 1 {
		t.Errorf("panel lokalny /api/admin/state → %d", c)
	}
	req := httptest.NewRequest("GET", "/api/admin/state", nil)
	req.Host = "192.168.1.5:47471"
	req.Header.Set(guardHeader, "1")
	rec := httptest.NewRecorder()
	guard(DesktopPort, dk.Routes()).ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Errorf("panel z obcym Host → %d, chcę 403", rec.Code)
	}
	_ = d
}

// Migracja: istniejąca konfiguracja z serwerem zostaje w trybie „Mój serwer”.
func TestConfigMigration(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("HOME", t.TempDir())
	dk := &Desktop{}
	dk.load()
	if dk.cfg.Mode != ModeLocal || dk.cfg.Chosen {
		t.Errorf("brak konfiguracji → %+v, chcę local, niewybrany", dk.cfg)
	}
	os.MkdirAll(filepath.Dir(configPath()), 0o700)
	os.WriteFile(configPath(), []byte(`{"server":"https://koligilo.sypian.ski","admin_token":"kol-x"}`), 0o600)
	dk = &Desktop{}
	dk.load()
	if dk.cfg.Mode != ModeRemote || !dk.cfg.Chosen || dk.cfg.Server != "https://koligilo.sypian.ski" {
		t.Errorf("stara konfiguracja → %+v, chcę remote", dk.cfg)
	}
}

// remoteServer: „VPS” w teście — zwykły koligilo serve.
func remoteServer(t *testing.T) (*httptest.Server, *Store, string) {
	st, admin, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{st: st}
	srv.gal = NewGallery(st)
	ts := httptest.NewServer(srv.Routes())
	t.Cleanup(ts.Close)
	return ts, st, admin
}

// AC2: przełączenie na „Mój serwer” i z powrotem bez restartu i bez utraty danych.
func TestModeSwitch(t *testing.T) {
	dk := newTestDesktop(t)
	dk.startDevices()
	_, tok, _ := dk.st.Provision("Kobo", "Kobo", "Kobo", "")
	v := "true"
	dk.st.SetFromPanel(map[string]*string{"settings.reader.lua|footer": &v})

	if c, _ := panelDo(t, dk, "POST", "/api/local/mode", map[string]string{"mode": "remote"}); c != 400 {
		t.Errorf("remote bez serwera → %d, chcę 400", c)
	}
	remote, _, admin := remoteServer(t)
	if c, out := panelDo(t, dk, "POST", "/api/local/config", map[string]string{"server": remote.URL, "admin_token": admin}); c != 200 {
		t.Fatalf("Mój serwer → %d %v", c, out)
	}
	if c, out := panelDo(t, dk, "GET", "/api/admin/state", nil); c != 200 || len(out["devices"].([]any)) != 0 {
		t.Errorf("proxy do serwera → %d, urządzeń %v (chcę 0 — to inny serwer)", c, out["devices"])
	}
	// w trybie „Mój serwer” komputer nie przyjmuje synchronizacji
	if c, _ := devGet(t, devBase(dk), "/api/v1/sync", tok); c != 503 {
		t.Errorf("sync na komputerze w trybie remote → %d, chcę 503", c)
	}
	if c, _ := panelDo(t, dk, "POST", "/api/local/mode", map[string]string{"mode": "local"}); c != 200 {
		t.Fatalf("powrót do trybu komputera → %d", c)
	}
	if c, out := panelDo(t, dk, "GET", "/api/admin/state", nil); c != 200 || len(out["devices"].([]any)) != 1 || len(out["values"].([]any)) != 1 {
		t.Errorf("dane lokalne po powrocie → %d, urządzeń %v, wartości %v", c, len(out["devices"].([]any)), out["values"])
	}
	if c, _ := devGet(t, devBase(dk), "/api/v1/sync", tok); c != 200 {
		t.Errorf("sync po powrocie → %d", c)
	}
	if dk.get().Server != remote.URL {
		t.Errorf("adres własnego serwera powinien zostać zapamiętany")
	}
}

// AC3: komputer → serwer → komputer; czytnik synchronizuje się starym tokenem,
// stary adres odsyła 410 {moved_to}.
func TestMoveOutAndBack(t *testing.T) {
	dk := newTestDesktop(t)
	dk.startDevices()
	dev, tok, _ := dk.st.Provision("Kobo", "Kobo", "Kobo", "")
	v := "110"
	dk.st.SetFromPanel(map[string]*string{"settings.reader.lua#copt_line_spacing": &v})
	pv, err := dk.st.AddPlugin(goodZip(t, "e2e.koplugin"), SrcUpload, "", "")
	if err != nil {
		t.Fatal(err)
	}
	remote, rst, admin := remoteServer(t)

	// na serwerze są już dane → bez potwierdzenia odmowa
	rst.Provision("Inny", "", "", "")
	if c, out := panelDo(t, dk, "POST", "/api/local/move", map[string]any{"server": remote.URL, "admin_token": admin}); c != 409 || out["needs_replace"] != true {
		t.Fatalf("przenosiny na niepusty serwer → %d %v, chcę 409", c, out)
	}
	if dk.st.MovedTo() != "" || dk.mode() != ModeLocal {
		t.Fatalf("po odmowie nic nie powinno się zmienić")
	}
	c, out := panelDo(t, dk, "POST", "/api/local/move", map[string]any{"server": remote.URL, "admin_token": admin, "replace": true})
	if c != 200 {
		t.Fatalf("przenosiny → %d %v", c, out)
	}
	if dk.mode() != ModeRemote || dk.st.MovedTo() != remote.URL {
		t.Errorf("po przenosinach: tryb %s, moved_to %q", dk.mode(), dk.st.MovedTo())
	}
	if !rst.CheckAdmin(admin) {
		t.Errorf("import nie może zmienić tokenu administratora celu")
	}
	// serwer: ten sam czytnik, ten sam token, wartości i wtyczka
	c, sync := devGet(t, remote.URL, "/api/v1/sync", tok)
	if c != 200 || sync["values"].(map[string]any)["settings.reader.lua#copt_line_spacing"] != "110" {
		t.Errorf("sync starym tokenem na serwerze → %d %v", c, sync)
	}
	if sync["device"].(map[string]any)["id"] != dev.ID {
		t.Errorf("inne ID urządzenia po przenosinach")
	}
	if _, err := os.Stat(rst.pluginPath(pv.SHA256)); err != nil {
		t.Errorf("wtyczka nie przyjechała: %v", err)
	}
	if len(rst.ListPlugins()) != 1 {
		t.Errorf("wtyczek na serwerze %d, chcę 1", len(rst.ListPlugins()))
	}
	// komputer: 410 z nowym adresem dla znanego tokenu, 401 dla obcego
	c, moved := devGet(t, devBase(dk), "/api/v1/sync", tok)
	if c != 410 || moved["moved_to"] != remote.URL {
		t.Errorf("stary adres → %d %v, chcę 410 moved_to", c, moved)
	}
	if c, _ := devGet(t, devBase(dk), "/api/v1/sync", "dev-obcy"); c != 401 {
		t.Errorf("obcy token → %d, chcę 401", c)
	}
	// kopia stanu sprzed importu na serwerze
	if m, _ := filepath.Glob(filepath.Join(rst.Dir(), ".pre-import-*", "state.json")); len(m) != 1 {
		t.Errorf("brak kopii .pre-import: %v", m)
	}

	// i z powrotem: serwer → komputer
	dk.update(func(c *LocalConfig) { c.PublicURL = "http://192.168.1.5:7210" })
	w := "120"
	rst.SetFromPanel(map[string]*string{"settings.reader.lua#copt_line_spacing": &w})
	if c, out := panelDo(t, dk, "POST", "/api/local/move-here", map[string]any{}); c != 200 {
		t.Fatalf("przenosiny na komputer → %d %v", c, out)
	}
	if dk.mode() != ModeLocal || dk.st.MovedTo() != "" {
		t.Errorf("po powrocie: tryb %s, moved_to %q", dk.mode(), dk.st.MovedTo())
	}
	if c, out := devGet(t, remote.URL, "/api/v1/sync", tok); c != 410 || out["moved_to"] != "http://192.168.1.5:7210" {
		t.Errorf("serwer po oddaniu danych → %d %v, chcę 410", c, out)
	}
	c, sync = devGet(t, devBase(dk), "/api/v1/sync", tok)
	if c != 200 || sync["values"].(map[string]any)["settings.reader.lua#copt_line_spacing"] != "120" {
		t.Errorf("sync na komputerze po powrocie → %d %v", c, sync)
	}
}

// Import odrzuca archiwum z podmienioną wtyczką (suma się nie zgadza).
func TestImportRejectsTampered(t *testing.T) {
	st, _, _ := OpenStore(t.TempDir())
	pv, _ := st.AddPlugin(goodZip(t, "e2e.koplugin"), SrcUpload, "", "")
	os.WriteFile(st.pluginPath(pv.SHA256), []byte("podmienione"), 0o600)
	var buf bytes.Buffer
	if err := ExportArchive(st, &buf); err != nil {
		t.Fatal(err)
	}
	dst, _, _ := OpenStore(t.TempDir())
	if _, err := ImportArchive(dst, nil, &buf, false); err == nil || !strings.Contains(err.Error(), "sha256") {
		t.Errorf("import podmienionej wtyczki: %v", err)
	}
	if _, err := ImportArchive(dst, nil, strings.NewReader("nie tar"), false); err == nil {
		t.Errorf("import śmieci powinien się nie udać")
	}
}

func TestCheckMoveURL(t *testing.T) {
	for in, ok := range map[string]bool{
		"https://koligilo.sypian.ski": true, "http://192.168.1.5:7210/": true,
		"ftp://x": false, "https://user:pw@x": false, "javascript:alert(1)": false, "": false, "https://x/?a=1": false,
	} {
		if _, err := checkMoveURL(in); (err == nil) != ok {
			t.Errorf("checkMoveURL(%q) err=%v", in, err)
		}
	}
}
