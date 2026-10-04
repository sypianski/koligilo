package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Przenosiny danych między serwerami (TASK-15): komputer ↔ własny serwer.
//
// Archiwum to tar.gz:
//   manifest.json          {"format":1,"koligilo":"0.4.0","created":"…"}
//   state.json             urządzenia (z hashami tokenów), wartości, wtyczki
//   plugins/<sha256>.zip   magazyn wtyczek (nazwa = suma bajtów, sprawdzana przy imporcie)
//   gallery.json, gallery-updates.json   cache galerii (opcjonalne)
//
// Tokeny urządzeń leżą w state.json jako hashe, więc przechodzą bez zmian:
// czytnik dalej wysyła ten sam token, tylko pod nowy adres. Hash tokenu
// administratora NIE jest eksportowany — cel zachowuje własny.

const (
	transferFormat  = 1
	transferMaxSize = 512 << 20 // łącznie po rozpakowaniu
)

var galleryFiles = []string{"gallery.json", "gallery-updates.json"}

type transferManifest struct {
	Format   int       `json:"format"`
	Koligilo string    `json:"koligilo"`
	Created  time.Time `json:"created"`
}

type ImportSummary struct {
	Devices int `json:"devices"`
	Values  int `json:"values"`
	Plugins int `json:"plugins"`
}

// errNotEmpty: cel ma już dane, a nie poproszono o nadpisanie.
type errNotEmpty struct{ have ImportSummary }

func (e *errNotEmpty) Error() string {
	return fmt.Sprintf("na tym serwerze są już dane (%d urządzeń, %d wartości, %d wtyczek) — import je zastąpi; potwierdź nadpisanie",
		e.have.Devices, e.have.Values, e.have.Plugins)
}

func (st *Store) summary() ImportSummary {
	st.mu.Lock()
	defer st.mu.Unlock()
	return ImportSummary{len(st.S.Devices), len(st.S.Values), len(st.S.Plugins)}
}

// ExportArchive zapisuje stan w formacie przenosin.
func ExportArchive(st *Store, w io.Writer) error {
	st.mu.Lock()
	c := st.S
	c.AdminHash, c.MovedTo = "", ""
	stateJSON, err := json.MarshalIndent(&c, "", "  ")
	shas := make([]string, 0, len(st.S.Plugins))
	for sha := range st.S.Plugins {
		shas = append(shas, sha)
	}
	st.mu.Unlock()
	if err != nil {
		return err
	}
	gz := gzip.NewWriter(w)
	tw := tar.NewWriter(gz)
	add := func(name string, b []byte) error {
		if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o600, Size: int64(len(b)), ModTime: time.Now(), Typeflag: tar.TypeReg}); err != nil {
			return err
		}
		_, err := tw.Write(b)
		return err
	}
	man, _ := json.Marshal(transferManifest{Format: transferFormat, Koligilo: Version, Created: time.Now().UTC()})
	if err := add("manifest.json", man); err != nil {
		return err
	}
	if err := add("state.json", stateJSON); err != nil {
		return err
	}
	for _, sha := range shas {
		b, err := os.ReadFile(st.pluginPath(sha))
		if err != nil {
			return fmt.Errorf("brak pliku wtyczki %s w magazynie: %w", sha[:12], err)
		}
		if err := add("plugins/"+sha+".zip", b); err != nil {
			return err
		}
	}
	for _, n := range galleryFiles {
		if b, err := os.ReadFile(filepath.Join(st.Dir(), n)); err == nil {
			if err := add(n, b); err != nil {
				return err
			}
		}
	}
	if err := tw.Close(); err != nil {
		return err
	}
	return gz.Close()
}

// readArchive rozpakowuje archiwum do pamięci i sprawdza jego spójność,
// zanim cokolwiek dotknie dysku.
func readArchive(r io.Reader) (*State, map[string][]byte, map[string][]byte, error) {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return nil, nil, nil, errors.New("to nie jest archiwum koligilo (tar.gz)")
	}
	tr := tar.NewReader(gz)
	files := map[string][]byte{}
	var total int64
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, nil, nil, fmt.Errorf("uszkodzone archiwum: %w", err)
		}
		if h.Typeflag != tar.TypeReg {
			continue
		}
		total += h.Size
		if total > transferMaxSize {
			return nil, nil, nil, errors.New("archiwum za duże")
		}
		b, err := io.ReadAll(io.LimitReader(tr, h.Size))
		if err != nil {
			return nil, nil, nil, err
		}
		files[h.Name] = b
	}
	var man transferManifest
	if err := json.Unmarshal(files["manifest.json"], &man); err != nil || man.Format == 0 {
		return nil, nil, nil, errors.New("brak manifest.json — to nie jest eksport koligilo")
	}
	if man.Format > transferFormat {
		return nil, nil, nil, fmt.Errorf("archiwum w nowszym formacie (%d) — zaktualizuj koligilo na tym serwerze", man.Format)
	}
	var s State
	if err := json.Unmarshal(files["state.json"], &s); err != nil {
		return nil, nil, nil, errors.New("state.json w archiwum uszkodzony")
	}
	if s.Devices == nil {
		s.Devices = map[string]*Device{}
	}
	if s.Values == nil {
		s.Values = map[string]*Value{}
	}
	if s.Plugins == nil {
		s.Plugins = map[string]*PluginVersion{}
	}
	plugins := map[string][]byte{}
	for name, b := range files {
		if !strings.HasPrefix(name, "plugins/") {
			continue
		}
		sha := strings.TrimSuffix(strings.TrimPrefix(name, "plugins/"), ".zip")
		sum := sha256.Sum256(b)
		if !shaRe.MatchString(sha) || !strings.HasSuffix(name, ".zip") || hex.EncodeToString(sum[:]) != sha {
			return nil, nil, nil, fmt.Errorf("plik %s w archiwum nie zgadza się z sumą sha256", name)
		}
		plugins[sha] = b
	}
	for sha := range s.Plugins {
		if plugins[sha] == nil {
			return nil, nil, nil, fmt.Errorf("w archiwum brak pliku wtyczki %s", sha)
		}
	}
	gal := map[string][]byte{}
	for _, n := range galleryFiles {
		if b, ok := files[n]; ok && json.Valid(b) {
			gal[n] = b
		}
	}
	return &s, plugins, gal, nil
}

func writeAtomic(p string, b []byte) error {
	tmp := p + ".tmp" + randHex(4)
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, p); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

// ImportArchive zastępuje urządzenia, wartości i wtyczki stanem z archiwum.
// Bez replace odmawia, gdy cel ma już dane (chyba że cel sam jest
// „przeniesiony” — wtedy jego dane są nieaktualne z definicji). Przed
// zapisem robi kopię <dane>/.pre-import-<czas>/. Hash tokenu administratora
// celu zostaje; MovedTo jest czyszczone (to teraz jest serwer właściwy).
func ImportArchive(st *Store, gal *Gallery, r io.Reader, replace bool) (ImportSummary, error) {
	s, plugins, galFiles, err := readArchive(r)
	if err != nil {
		return ImportSummary{}, err
	}
	if !replace && !st.Empty() && st.MovedTo() == "" {
		return ImportSummary{}, &errNotEmpty{st.summary()}
	}
	dir := st.Dir()
	backup := filepath.Join(dir, ".pre-import-"+time.Now().Format("20060102-150405"))
	if err := os.MkdirAll(backup, 0o700); err != nil {
		return ImportSummary{}, err
	}
	for _, n := range append([]string{"state.json"}, galleryFiles...) {
		if b, err := os.ReadFile(filepath.Join(dir, n)); err == nil {
			if err := os.WriteFile(filepath.Join(backup, n), b, 0o600); err != nil {
				return ImportSummary{}, err
			}
		}
	}
	// Wtyczki adresowane treścią — dopisujemy, starych nie kasujemy (kopia).
	if err := os.MkdirAll(st.pluginDir(), 0o700); err != nil {
		return ImportSummary{}, err
	}
	for sha, b := range plugins {
		if _, err := os.Stat(st.pluginPath(sha)); err == nil {
			continue
		}
		if err := writeAtomic(st.pluginPath(sha), b); err != nil {
			return ImportSummary{}, err
		}
	}
	for n, b := range galFiles {
		if err := writeAtomic(filepath.Join(dir, n), b); err != nil {
			return ImportSummary{}, err
		}
	}
	st.mu.Lock()
	st.S.Devices, st.S.Values, st.S.Plugins = s.Devices, s.Values, s.Plugins
	st.S.Favorites = s.Favorites
	st.S.MovedTo = ""
	st.S.pending = map[string]*PairRequest{}
	err = st.saveLocked()
	sum := ImportSummary{len(s.Devices), len(s.Values), len(s.Plugins)}
	st.mu.Unlock()
	if gal != nil {
		gal.reload()
	}
	return sum, err
}

// reload wczytuje cache galerii z dysku od nowa (po imporcie).
func (g *Gallery) reload() {
	g.mu.Lock()
	g.cache = galleryCache{}
	g.loadCache()
	g.mu.Unlock()
	g.updMu.Lock()
	g.upd = updatesCache{}
	g.loadUpdatesCache()
	g.updMu.Unlock()
}

// checkMoveURL: dokąd wolno przekierować czytniki — tylko http(s) z hostem,
// bez danych logowania w adresie.
func checkMoveURL(s string) (string, error) {
	s = strings.TrimRight(strings.TrimSpace(s), "/")
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("adres musi mieć postać http(s)://host[:port]")
	}
	return s, nil
}

// --- HTTP (API administratora) ---

func (s *Server) transferRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/admin/export", s.admin(s.adminExport))
	m.HandleFunc("POST /api/admin/import", s.admin(s.adminImport))
	m.HandleFunc("POST /api/admin/moved", s.admin(s.adminMoved))
}

func (s *Server) adminExport(w http.ResponseWriter, r *http.Request) {
	var buf bytes.Buffer
	if err := ExportArchive(s.st, &buf); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Disposition", `attachment; filename="koligilo-eksport-`+time.Now().Format("2006-01-02")+`.tar.gz"`)
	w.Write(buf.Bytes())
}

// adminImport: ciało to surowe archiwum (application/gzip). ?replace=1
// potwierdza nadpisanie istniejących danych.
func (s *Server) adminImport(w http.ResponseWriter, r *http.Request) {
	body := http.MaxBytesReader(w, r.Body, transferMaxSize)
	sum, err := ImportArchive(s.st, s.gal, body, r.URL.Query().Get("replace") == "1")
	var ne *errNotEmpty
	if errors.As(err, &ne) {
		writeJSON(w, 409, map[string]any{"error": ne.Error(), "have": ne.have})
		return
	}
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "imported": sum})
}

// adminMoved ustawia albo (pusty moved_to) czyści przekierowanie czytników.
func (s *Server) adminMoved(w http.ResponseWriter, r *http.Request) {
	var in struct {
		MovedTo string `json:"moved_to"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	u := ""
	if strings.TrimSpace(in.MovedTo) != "" {
		var err error
		if u, err = checkMoveURL(in.MovedTo); err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error()})
			return
		}
	}
	if err := s.st.SetMovedTo(u); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]string{"moved_to": u})
}
