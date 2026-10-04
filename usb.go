package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

// Parowanie kablem: panel na komputerze sam znajduje podłączony czytnik,
// zakłada go na serwerze, wgrywa plugin i zapisuje na czytniku adres serwera
// z kluczem. Działa tam, gdzie wykrywanie w Wi-Fi nie ma szans (sieci
// uczelniane z izolacją klientów, komputer na kablu, czytnik w innej sieci).
//
// Dwie drogi do czytnika:
//   - Android (Bigme, Boox, telefon): adb — wymaga włączonego debugowania USB,
//   - Kobo / Kindle / PocketBook: czytnik montuje się jako dysk z katalogiem KOReadera.

type Reader struct {
	ID       string `json:"id"`       // serial adb albo ścieżka katalogu KOReadera na dysku
	Kind     string `json:"kind"`     // "android" | "dysk"
	Label    string `json:"label"`    // np. "Bigme HiBreak", "Kobo (KOBOeReader)"
	Platform string `json:"platform"` // Android / Kobo / Kindle / PocketBook
	Paired   bool   `json:"paired"`   // na czytniku jest już konfiguracja koligilo
}

var androidKOReaderPackages = []string{"org.koreader.launcher", "org.koreader.launcher.fdroid"}

const androidKOReaderDir = "/sdcard/koreader"

func adbPath() string {
	if p, err := exec.LookPath("adb"); err == nil {
		return p
	}
	home, _ := os.UserHomeDir()
	for _, p := range []string{
		"/opt/homebrew/bin/adb", "/usr/local/bin/adb",
		filepath.Join(home, "Library/Android/sdk/platform-tools/adb"),
		filepath.Join(home, "Android/Sdk/platform-tools/adb"),
		filepath.Join(home, "AppData/Local/Android/Sdk/platform-tools/adb.exe"),
	} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func adb(args ...string) (string, error) {
	p := adbPath()
	if p == "" {
		return "", errors.New("brak adb")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, p, args...).CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// findReaders zwraca czytniki z KOReaderem podłączone kablem.
func findReaders() []Reader {
	var out []Reader
	if adbPath() != "" {
		list, _ := adb("devices")
		for _, line := range strings.Split(list, "\n")[1:] {
			f := strings.Fields(line)
			if len(f) < 2 || f[1] != "device" {
				continue
			}
			serial := f[0]
			if has, _ := adb("-s", serial, "shell", "ls", "-d", androidKOReaderDir); !strings.Contains(has, androidKOReaderDir) || strings.Contains(has, "No such") {
				continue
			}
			brand, _ := adb("-s", serial, "shell", "getprop", "ro.product.brand")
			model, _ := adb("-s", serial, "shell", "getprop", "ro.product.model")
			label := strings.TrimSpace(capitalize(brand) + " " + model)
			cfg, _ := adb("-s", serial, "shell", "cat", androidKOReaderDir+"/settings/koligilo.lua")
			out = append(out, Reader{ID: serial, Kind: "android", Label: label, Platform: "Android",
				Paired: strings.Contains(cfg, `["token"]`)})
		}
	}
	for _, root := range volumeRoots() {
		for rel, platform := range map[string]string{".adds/koreader": "Kobo", "koreader": "Kindle", "applications/koreader": "PocketBook"} {
			dir := filepath.Join(root, filepath.FromSlash(rel))
			if st, err := os.Stat(filepath.Join(dir, "plugins")); err == nil && st.IsDir() {
				cfg, _ := os.ReadFile(filepath.Join(dir, "settings", "koligilo.lua"))
				out = append(out, Reader{ID: dir, Kind: "dysk",
					Label: fmt.Sprintf("%s (%s)", platform, filepath.Base(root)), Platform: platform,
					Paired: bytes.Contains(cfg, []byte(`["token"]`))})
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Label < out[j].Label })
	return out
}

func volumeRoots() []string {
	var globs []string
	switch runtime.GOOS {
	case "darwin":
		globs = []string{"/Volumes/*"}
	case "windows":
		for c := 'D'; c <= 'Z'; c++ {
			globs = append(globs, string(c)+`:\`)
		}
	default:
		u := os.Getenv("USER")
		globs = []string{"/media/" + u + "/*", "/run/media/" + u + "/*", "/media/*"}
	}
	var out []string
	for _, g := range globs {
		m, _ := filepath.Glob(g)
		out = append(out, m...)
	}
	return out
}

func capitalize(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// koligiloSettings: plik settings/koligilo.lua w formacie LuaSettings (dofile).
func koligiloSettings(server, token, deviceID string) []byte {
	// literał Lua — nie JSON: LuaJIT nie rozumie ucieczek \uXXXX
	q := func(s string) string {
		return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`, "\r", `\r`).Replace(s) + `"`
	}
	return []byte(fmt.Sprintf(`-- zapisane przez koligilo (parowanie kablem)
return {
    ["base"] = {},
    ["device_id"] = %s,
    ["server"] = %s,
    ["token"] = %s,
}
`, q(deviceID), q(server), q(token)))
}

// writePlugin zapisuje wbudowany plugin do katalogu docelowego (…/plugins).
func writePlugin(pluginsDir string) error {
	return fs.WalkDir(pluginFS, "plugin", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		dst := filepath.Join(pluginsDir, filepath.FromSlash(strings.TrimPrefix(p, "plugin/")))
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		b, _ := pluginFS.ReadFile(p)
		return os.WriteFile(dst, b, 0o644)
	})
}

// provision zakłada urządzenie na serwerze (API administratora).
func provision(c LocalConfig, r Reader) (id, token string, err error) {
	body, _ := json.Marshal(map[string]string{"name": r.Label, "model": r.Label, "platform": r.Platform})
	req, _ := http.NewRequest("POST", c.Server+"/api/admin/devices", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+c.AdminToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return "", "", fmt.Errorf("serwer nie odpowiada: %w", err)
	}
	defer resp.Body.Close()
	var out struct {
		Device struct{ ID string } `json:"device"`
		Token  string              `json:"token"`
		Error  string              `json:"error"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if resp.StatusCode != 200 {
		return "", "", fmt.Errorf("serwer odmówił: %s", out.Error)
	}
	return out.Device.ID, out.Token, nil
}

func forget(c LocalConfig, id string) {
	req, _ := http.NewRequest("DELETE", c.Server+"/api/admin/devices/"+id, nil)
	req.Header.Set("Authorization", "Bearer "+c.AdminToken)
	if resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req); err == nil {
		resp.Body.Close()
	}
}

// usbTarget: gdzie założyć urządzenie. Tryb komputera — wprost w lokalnym
// Store (bez HTTP do samego siebie: panel lokalny nie ma tokenu admina, a
// Provision i tak jest tą samą funkcją, którą woła API). Tryb „Mój serwer” —
// przez API administratora zewnętrznego serwera.
type usbTarget struct {
	server string // adres zapisywany na czytniku
	add    func(r Reader) (id, token string, err error)
	undo   func(id string)
}

func (dk *Desktop) usbTarget() (usbTarget, error) {
	c := dk.get()
	if c.Mode == ModeRemote {
		if c.Server == "" {
			return usbTarget{}, errors.New("najpierw połącz panel z serwerem")
		}
		return usbTarget{server: c.Server,
			add:  func(r Reader) (string, string, error) { return provision(c, r) },
			undo: func(id string) { forget(c, id) }}, nil
	}
	pub := dk.publicURL()
	if pub == "" {
		return usbTarget{}, errors.New("nie znam adresu tego komputera w sieci — wpisz go w ustawieniach serwera („Adres dla czytników”)")
	}
	return usbTarget{server: pub,
		add: func(r Reader) (string, string, error) {
			d, tok, err := dk.st.Provision(r.Label, r.Label, r.Platform, "")
			if err != nil {
				return "", "", err
			}
			return d.ID, tok, nil
		},
		undo: func(id string) { dk.st.Forget(id) }}, nil
}

// pairUSB: serwer → plugin → konfiguracja na czytniku. Przy błędzie kopiowania
// wycofuje urządzenie z serwera, żeby nie zostawić „martwego” wpisu.
func pairUSB(t usbTarget, r Reader) (string, error) {
	id, token, err := t.add(r)
	if err != nil {
		return "", err
	}
	cfg := koligiloSettings(t.server, token, id)
	switch r.Kind {
	case "android":
		err = pairAndroid(r.ID, cfg)
	case "dysk":
		err = writePlugin(filepath.Join(r.ID, "plugins"))
		if err == nil {
			os.MkdirAll(filepath.Join(r.ID, "settings"), 0o755)
			err = os.WriteFile(filepath.Join(r.ID, "settings", "koligilo.lua"), cfg, 0o644)
		}
	default:
		err = errors.New("nieznany rodzaj czytnika")
	}
	if err != nil {
		t.undo(id)
		return "", err
	}
	if r.Kind == "android" {
		return "Gotowe. KOReader na czytniku uruchomił się ponownie i zapyta o pierwszą synchronizację.", nil
	}
	return "Gotowe. Odłącz czytnik (bezpiecznie wysuń dysk) — po starcie KOReader zapyta o pierwszą synchronizację.", nil
}

func pairAndroid(serial string, cfg []byte) error {
	tmp, err := os.MkdirTemp("", "koligilo-usb")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	if err := writePlugin(tmp); err != nil {
		return err
	}
	cfgPath := filepath.Join(tmp, "koligilo.lua")
	if err := os.WriteFile(cfgPath, cfg, 0o644); err != nil {
		return err
	}
	// KOReader trzyma koligilo.lua w pamięci — zatrzymujemy go, żeby przy
	// wyjściu nie nadpisał nowej konfiguracji starą.
	running := ""
	for _, pkg := range androidKOReaderPackages {
		if out, _ := adb("-s", serial, "shell", "pm", "path", pkg); strings.HasPrefix(out, "package:") {
			running = pkg
			adb("-s", serial, "shell", "am", "force-stop", pkg)
		}
	}
	if out, err := adb("-s", serial, "push", filepath.Join(tmp, "koligilo.koplugin"), androidKOReaderDir+"/plugins/"); err != nil {
		return fmt.Errorf("nie udało się wgrać pluginu: %s", out)
	}
	adb("-s", serial, "shell", "mkdir", "-p", androidKOReaderDir+"/settings")
	if out, err := adb("-s", serial, "push", cfgPath, androidKOReaderDir+"/settings/koligilo.lua"); err != nil {
		return fmt.Errorf("nie udało się zapisać konfiguracji: %s", out)
	}
	if running != "" {
		adb("-s", serial, "shell", "monkey", "-p", running, "-c", "android.intent.category.LAUNCHER", "1")
	}
	return nil
}

// --- HTTP (tylko tryb desktopowy) ---

func (dk *Desktop) usbRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/local/usb", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"readers": findReaders(), "adb": adbPath() != ""})
	})
	m.HandleFunc("POST /api/local/usb/pair", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			ID string `json:"id"`
		}
		json.NewDecoder(r.Body).Decode(&in)
		t, err := dk.usbTarget()
		if err != nil {
			writeJSON(w, 409, map[string]string{"error": err.Error()})
			return
		}
		for _, rd := range findReaders() {
			if rd.ID == in.ID {
				msg, err := pairUSB(t, rd)
				if err != nil {
					writeJSON(w, 500, map[string]string{"error": err.Error()})
					return
				}
				writeJSON(w, 200, map[string]string{"message": msg})
				return
			}
		}
		writeJSON(w, 404, map[string]string{"error": "czytnik zniknął — sprawdź kabel"})
	})
}
