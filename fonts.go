package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Magazyn czcionek (TASK-36, PC-018). Czcionka to dane, nie kod, więc — inaczej
// niż przy wtyczkach (PC-004) — czytnik nie pyta o każdą zmianę. Zostaje to,
// co chroni przed nadużyciem: zgoda wyłącznie z czytnika
// (?fonts_allowed=1 w GET /api/v1/sync), pliki adresowane sha256, twarde limity
// i walidacja nazwy oraz nagłówka pliku.
//
// Pliki leżą w <dane>/fonts/<sha256> (bez rozszerzenia; nazwę i typ trzyma
// FontFile). Ten sam plik wgrany drugi raz daje ten sam sha.

const (
	fontMaxSize  = 40 << 20 // jeden plik (duże CJK mają 15–25 MB)
	fontMaxCount = 300      // wersji w magazynie
)

type FontFile struct {
	SHA256    string    `json:"sha256"`
	File      string    `json:"file"` // nazwa pliku na czytniku, np. "Charis-Regular.ttf"
	Size      int64     `json:"size"`
	Source    string    `json:"source"`               // upload | urządzenie
	SourceRef string    `json:"source_ref,omitempty"` // nazwa (ID) urządzenia
	Approved  bool      `json:"approved"`             // czcionka z urządzenia czeka na admina
	Added     time.Time `json:"added"`
	Active    bool      `json:"active,omitempty"` // tylko w odpowiedzi: ta wersja trafia na czytniki
}

// InstalledFont — wpis inwentarza czcionek zarządzanych przez koligilo na czytniku.
type InstalledFont struct {
	File   string `json:"file"`
	SHA256 string `json:"sha256"`
}

// FontReport — pole "fonts" w POST /api/v1/sync.
type FontReport struct {
	Installed []InstalledFont `json:"installed"`
}

var fontNameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 ._+()\-]{0,95}\.(?i:ttf|otf|ttc|otc)$`)

// checkFontName: nazwa pliku bez ścieżki, tylko bezpieczne znaki i rozszerzenie czcionki.
func checkFontName(name string) error {
	if !fontNameRe.MatchString(name) || strings.Contains(name, "..") {
		return errors.New("zła nazwa pliku czcionki — dozwolone litery, cyfry, spacja i . _ + ( ) -, rozszerzenie .ttf, .otf, .ttc albo .otc")
	}
	return nil
}

// checkFontData sprawdza nagłówek (sfnt: TrueType, OpenType/CFF, kolekcja) i zgodność z rozszerzeniem.
func checkFontData(name string, b []byte) error {
	if len(b) > fontMaxSize {
		return fmt.Errorf("plik większy niż %d MB", fontMaxSize>>20)
	}
	if len(b) < 12 {
		return errors.New("plik za krótki, żeby być czcionką")
	}
	magic := string(b[:4])
	collection := magic == "ttcf"
	switch {
	case magic == "\x00\x01\x00\x00", magic == "OTTO", magic == "true":
		if collection {
			break
		}
	case collection:
	default:
		return errors.New("to nie jest czcionka TrueType/OpenType (zły nagłówek pliku)")
	}
	ext := strings.ToLower(filepath.Ext(name))
	if collection != (ext == ".ttc" || ext == ".otc") {
		return errors.New("rozszerzenie nie pasuje do zawartości (kolekcje to .ttc/.otc, pojedyncze kroje .ttf/.otf)")
	}
	return nil
}

func (st *Store) fontDir() string { return filepath.Join(filepath.Dir(st.path), "fonts") }

func (st *Store) fontPath(sha string) string { return filepath.Join(st.fontDir(), sha) }

type badFont struct{ error }

// AddFont waliduje i zapisuje plik. Ten sam sha → istniejąca wersja (bez zmiany nazwy).
func (st *Store) AddFont(raw []byte, file, source, ref string) (*FontFile, error) {
	if err := checkFontName(file); err != nil {
		return nil, &badFont{err}
	}
	if err := checkFontData(file, raw); err != nil {
		return nil, &badFont{err}
	}
	sum := sha256.Sum256(raw)
	sha := hex.EncodeToString(sum[:])
	st.mu.Lock()
	if v := st.S.Fonts[sha]; v != nil {
		c := *v
		st.mu.Unlock()
		return &c, nil
	}
	if len(st.S.Fonts) >= fontMaxCount {
		st.mu.Unlock()
		return nil, &badFont{fmt.Errorf("w magazynie jest już %d czcionek — usuń niepotrzebne", fontMaxCount)}
	}
	st.mu.Unlock()
	// Plik adresowany treścią — zapis poza zamkiem jest bezpieczny.
	if err := os.MkdirAll(st.fontDir(), 0o700); err != nil {
		return nil, err
	}
	if _, err := os.Stat(st.fontPath(sha)); err != nil {
		if err := writeAtomic(st.fontPath(sha), raw); err != nil {
			return nil, err
		}
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.S.Fonts == nil {
		st.S.Fonts = map[string]*FontFile{}
	}
	if v := st.S.Fonts[sha]; v != nil {
		c := *v
		return &c, nil
	}
	v := &FontFile{
		SHA256: sha, File: file, Size: int64(len(raw)), Source: source,
		SourceRef: clip(ref, 200), Approved: source != SrcDevice, Added: time.Now(),
	}
	st.S.Fonts[sha] = v
	c := *v
	return &c, st.saveLocked()
}

// activeFontsLocked: dla każdej nazwy pliku najnowsza zaakceptowana wersja.
func (st *Store) activeFontsLocked() map[string]*FontFile {
	act := map[string]*FontFile{}
	for _, v := range st.S.Fonts {
		if !v.Approved {
			continue
		}
		if cur := act[v.File]; cur == nil || v.Added.After(cur.Added) ||
			(v.Added.Equal(cur.Added) && v.SHA256 > cur.SHA256) {
			act[v.File] = v
		}
	}
	return act
}

// ListFonts: wszystkie wersje; Active oznacza tę, która trafia na czytniki.
func (st *Store) ListFonts() []FontFile {
	st.mu.Lock()
	defer st.mu.Unlock()
	act := st.activeFontsLocked()
	out := []FontFile{}
	for _, v := range st.S.Fonts {
		c := *v
		c.Active = act[v.File] == v
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool {
		if li, lj := strings.ToLower(out[i].File), strings.ToLower(out[j].File); li != lj {
			return li < lj
		}
		return out[i].Added.Before(out[j].Added)
	})
	return out
}

func (st *Store) ApproveFont(sha string) (*FontFile, error) {
	st.mu.Lock()
	defer st.mu.Unlock()
	v := st.S.Fonts[sha]
	if v == nil {
		return nil, errNotFound
	}
	if !v.Approved {
		v.Approved = true
		if err := st.saveLocked(); err != nil {
			return nil, err
		}
	}
	c := *v
	return &c, nil
}

// DeleteFont usuwa wersję z magazynu; czytniki, które ją mają, usuną plik przy
// następnej synchronizacji (o ile nie ma nowszej wersji tej samej nazwy).
func (st *Store) DeleteFont(sha string) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.S.Fonts[sha] == nil {
		return errNotFound
	}
	delete(st.S.Fonts, sha)
	if err := st.saveLocked(); err != nil {
		return err
	}
	os.Remove(st.fontPath(sha))
	return nil
}

// FontTarget zwraca stan docelowy czcionek urządzenia i zapamiętuje, czy
// czytnik zgłosił zgodę. Zgoda pochodzi wyłącznie z żądania czytnika.
func (st *Store) FontTarget(d *Device, allowed bool) []FontFile {
	st.mu.Lock()
	defer st.mu.Unlock()
	if d.FontsAllowed != allowed {
		d.FontsAllowed = allowed
		st.saveLocked()
	}
	out := []FontFile{}
	if !allowed {
		return out
	}
	for _, v := range st.activeFontsLocked() {
		out = append(out, *v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].File < out[j].File })
	return out
}

// ReportFonts zapisuje inwentarz czcionek zarządzanych przez koligilo.
func (st *Store) ReportFonts(d *Device, rep *FontReport) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	now := time.Now()
	inv := []InstalledFont{}
	for _, f := range rep.Installed {
		if len(inv) >= fontMaxCount {
			break
		}
		if checkFontName(f.File) != nil || !shaRe.MatchString(f.SHA256) {
			continue
		}
		inv = append(inv, InstalledFont{File: f.File, SHA256: f.SHA256})
	}
	sort.Slice(inv, func(i, j int) bool { return inv[i].File < inv[j].File })
	d.FontInventory = inv // nowe slice'y, nie modyfikacja w miejscu
	d.FontReportAt = &now
	return st.saveLocked()
}

// FontForDevice: ścieżka pliku, o ile urządzenie ma zgodę, a wersja jest zaakceptowana.
func (st *Store) FontForDevice(d *Device, sha string) (string, int) {
	st.mu.Lock()
	defer st.mu.Unlock()
	if !d.FontsAllowed {
		return "", 403
	}
	v := st.S.Fonts[sha]
	if v == nil {
		return "", 404
	}
	if !v.Approved {
		return "", 403
	}
	return st.fontPath(sha), 200
}

// FontStored: ścieżka pliku z magazynu, o ile wersja jest zapisana (bez względu
// na akceptację i zgodę czytnika — to widok administratora).
func (st *Store) FontStored(sha string) (string, bool) {
	if !shaRe.MatchString(sha) {
		return "", false
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.S.Fonts[sha] == nil {
		return "", false
	}
	return st.fontPath(sha), true
}

// --- HTTP ---

func (s *Server) fontRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/v1/fonts/{sha}", s.device(s.fontDownload))
	m.HandleFunc("POST /api/v1/fonts", s.device(s.deviceFontUpload))
	m.HandleFunc("GET /api/admin/fonts", s.admin(s.adminFonts))
	m.HandleFunc("POST /api/admin/fonts", s.admin(s.adminFontUpload))
	m.HandleFunc("GET /api/admin/fonts/{sha}/file", s.admin(s.adminFontFile))
	m.HandleFunc("POST /api/admin/fonts/{sha}/approve", s.admin(s.adminFontApprove))
	m.HandleFunc("DELETE /api/admin/fonts/{sha}", s.admin(s.adminFontDelete))
}

func (s *Server) fontDownload(w http.ResponseWriter, r *http.Request, d *Device) {
	sha := r.PathValue("sha")
	if !shaRe.MatchString(sha) {
		writeJSON(w, 404, map[string]string{"error": "nie ma takiego pliku"})
		return
	}
	p, code := s.st.FontForDevice(d, sha)
	if code != 200 {
		msg := "czytnik nie pozwala synchronizować czcionek albo ta czcionka czeka na akceptację w panelu"
		if code == 404 {
			msg = "nie ma takiej czcionki"
		}
		writeJSON(w, code, map[string]string{"error": msg})
		return
	}
	f, err := os.Open(p)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "brak pliku w magazynie"})
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("X-Koligilo-Sha256", sha)
	http.ServeContent(w, r, sha, time.Time{}, f)
}

// adminFontFile oddaje bajty zapisanej czcionki do podglądu w panelu (próbka
// kroju). W odróżnieniu od fontDownload nie wymaga zgody czytnika ani
// akceptacji: admin ma prawo obejrzeć także to, co jeszcze czeka na decyzję.
// Plik jest adresowany sha256, więc treść pod danym adresem się nie zmienia.
func (s *Server) adminFontFile(w http.ResponseWriter, r *http.Request) {
	sha := r.PathValue("sha")
	p, ok := s.st.FontStored(sha)
	if !ok {
		writeJSON(w, 404, map[string]string{"error": "nie ma takiej czcionki"})
		return
	}
	f, err := os.Open(p)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "brak pliku w magazynie"})
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeContent(w, r, sha, time.Time{}, f)
}

func fontError(w http.ResponseWriter, err error) bool {
	var bf *badFont
	switch {
	case err == nil:
		return false
	case errors.As(err, &bf):
		writeJSON(w, 400, map[string]string{"error": bf.Error()})
	default:
		writeJSON(w, 500, map[string]string{"error": err.Error()})
	}
	return true
}

// deviceFontUpload: czytnik wysyła czcionkę ze swojego katalogu fonts/ (surowe
// ciało, nazwa w ?file=). Wersja trafia jako niezaakceptowana — dopóki admin
// jej nie zatwierdzi w panelu, nie jest dystrybuowana na inne czytniki.
func (s *Server) deviceFontUpload(w http.ResponseWriter, r *http.Request, d *Device) {
	r.Body = http.MaxBytesReader(w, r.Body, fontMaxSize+1<<10)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": fmt.Sprintf("wyślij plik czcionki jako ciało żądania (do %d MB)", fontMaxSize>>20)})
		return
	}
	ref := fmt.Sprintf("%s (%s)", d.Name, d.ID)
	v, err := s.st.AddFont(raw, r.URL.Query().Get("file"), SrcDevice, ref)
	if fontError(w, err) {
		return
	}
	writeJSON(w, 200, map[string]any{"font": v})
}

func (s *Server) adminFonts(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"fonts": s.st.ListFonts()})
}

// adminFontUpload: multipart, pole "file"; nazwa pliku z nagłówka części
// (bez ścieżki) albo z pola "name", gdy panel chce ją zmienić.
func (s *Server) adminFontUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, fontMaxSize+1<<20)
	f, hdr, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": fmt.Sprintf("wyślij czcionkę w polu „file” (multipart/form-data, do %d MB)", fontMaxSize>>20)})
		return
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, fontMaxSize+1))
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	name := strings.TrimSpace(r.FormValue("name"))
	if name == "" {
		name = hdr.Filename
		if i := strings.LastIndexAny(name, `/\`); i >= 0 {
			name = name[i+1:]
		}
	}
	v, err := s.st.AddFont(raw, name, SrcUpload, "")
	if fontError(w, err) {
		return
	}
	writeJSON(w, 200, map[string]any{"font": v})
}

func (s *Server) adminFontApprove(w http.ResponseWriter, r *http.Request) {
	v, err := s.st.ApproveFont(r.PathValue("sha"))
	switch {
	case errors.Is(err, errNotFound):
		writeJSON(w, 404, map[string]string{"error": "nie ma takiej czcionki"})
	case err != nil:
		writeJSON(w, 500, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, 200, map[string]any{"font": v})
	}
}

func (s *Server) adminFontDelete(w http.ResponseWriter, r *http.Request) {
	err := s.st.DeleteFont(r.PathValue("sha"))
	switch {
	case errors.Is(err, errNotFound):
		writeJSON(w, 404, map[string]string{"error": "nie ma takiej czcionki"})
	case err != nil:
		writeJSON(w, 500, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, 200, map[string]bool{"ok": true})
	}
}

// fontsWire — pole "fonts" w GET /api/v1/sync.
func fontsWire(vs []FontFile) []map[string]any {
	out := []map[string]any{}
	for _, v := range vs {
		out = append(out, map[string]any{
			"file": v.File, "sha256": v.SHA256, "size": v.Size,
			"url": "/api/v1/fonts/" + v.SHA256,
		})
	}
	return out
}
