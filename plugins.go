package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Magazyn wtyczek KOReadera (PC-004). Wtyczka to kod Lua z pełnymi
// uprawnieniami, więc serwer tylko przechowuje i przypisuje wersje — zgodę na
// instalację daje wyłącznie czytnik (?plugins_allowed=1 w GET /api/v1/sync),
// a każdą operację potwierdza człowiek na czytniku.
//
// ZIP-y leżą w <dane>/plugins/<sha256>.zip. Zapisujemy postać znormalizowaną
// (tylko wpisy X.koplugin/…, posortowane, stały czas, bez __MACOSX): czytnik
// dostaje dokładnie to, co przeszło walidację, sha256 liczymy z tych samych
// bajtów, które serwujemy, a ten sam kod wgrany drugi raz daje ten sam sha.

const (
	pluginMaxZip      = 20 << 20  // limit wgrywanego ZIP-a
	pluginMaxUnpacked = 100 << 20 // limit po rozpakowaniu (zip-bomba)
	pluginMaxFiles    = 5000
	pluginMaxMeta     = 64 << 10
)

// Źródła wersji.
const (
	SrcUpload  = "upload"
	SrcGallery = "galeria"
	SrcDevice  = "urządzenie"
)

type PluginVersion struct {
	SHA256      string    `json:"sha256"`
	Dir         string    `json:"dir"` // np. "foo.koplugin"
	Name        string    `json:"name"`
	Fullname    string    `json:"fullname"`
	Description string    `json:"description"`
	Version     string    `json:"version"`
	Size        int64     `json:"size"`
	Source      string    `json:"source"`               // upload | galeria | urządzenie
	SourceRef   string    `json:"source_ref,omitempty"` // owner/repo@sha albo ID urządzenia
	Path        string    `json:"path,omitempty"`       // TASK-12: ścieżka *.koplugin względem korzenia repo (galeria, monorepo); "" = korzeń
	Approved    bool      `json:"approved"`             // wersja z urządzenia czeka na akceptację admina
	Added       time.Time `json:"added"`
}

// InstalledPlugin — wpis inwentarza zgłoszony przez czytnik.
type InstalledPlugin struct {
	Dir     string `json:"dir"`
	Name    string `json:"name,omitempty"`
	Version string `json:"version,omitempty"`
	Managed bool   `json:"managed"` // ma znacznik .koligilo
	SHA256  string `json:"sha256,omitempty"`
}

// PluginResult — wynik jednej operacji na czytniku.
type PluginResult struct {
	Dir    string    `json:"dir"`
	SHA256 string    `json:"sha256,omitempty"`
	Action string    `json:"action,omitempty"` // install | update | remove
	Status string    `json:"status"`           // ok | rejected | error
	Error  string    `json:"error,omitempty"`
	At     time.Time `json:"at"`
}

// PluginReport — pole "plugins" w POST /api/v1/sync.
type PluginReport struct {
	Installed []InstalledPlugin `json:"installed"`
	Results   []PluginResult    `json:"results"`
}

// Wtyczki wbudowane w KOReadera (plugins/ w wydaniu). Lista niepełna i tylko
// pomocnicza — o tym, czego nie ruszać, decyduje głównie czytnik (znacznik
// .koligilo). Serwer odmawia przyjęcia ZIP-a o takiej nazwie, żeby nie
// przesłonić wtyczki z wydania.
var builtinPlugins = map[string]bool{
	"archiveviewer": true, "autodim": true, "autofrontlight": true, "autostandby": true,
	"autosuspend": true, "autoturn": true, "autowarmth": true, "backgroundrunner": true,
	"batterystat": true, "bookshortcuts": true, "calibre": true, "coverbrowser": true,
	"coverimage": true, "docsettingtweak": true, "exporter": true, "externalkeyboard": true,
	"gestures": true, "hello": true, "hotkeys": true, "httpinspector": true,
	"japanese": true, "keepalive": true, "kosync": true, "movetoarchive": true,
	"newsdownloader": true, "opds": true, "patchmanagement": true, "perceptionexpander": true,
	"profiles": true, "qrclipboard": true, "readtimer": true, "ssh": true,
	"statistics": true, "systemstat": true, "terminal": true, "texteditor": true,
	"timesync": true, "vocabbuilder": true, "wallabag": true, "zsync": true,
}

var pluginDirRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,62}\.koplugin$`)
var shaRe = regexp.MustCompile(`^[0-9a-f]{64}$`)

// checkPluginDir: czy wolno przyjąć/przypisać wtyczkę o tej nazwie katalogu.
func checkPluginDir(dir string) error {
	if !pluginDirRe.MatchString(dir) {
		return fmt.Errorf("zła nazwa katalogu wtyczki %q", dir)
	}
	base := strings.ToLower(strings.TrimSuffix(dir, ".koplugin"))
	if base == "koligilo" {
		return errors.New("koligilo.koplugin nie może być zarządzany przez koligilo")
	}
	if builtinPlugins[base] {
		return fmt.Errorf("%s to wtyczka wbudowana w KOReadera", dir)
	}
	return nil
}

// --- walidacja i normalizacja ZIP-a ---

type pluginMeta struct{ Name, Fullname, Description, Version string }

// NormalizePluginZip sprawdza ZIP wtyczki i zwraca jego postać znormalizowaną,
// nazwę katalogu i pola z _meta.lua. Błąd = ZIP odrzucony (400).
func NormalizePluginZip(b []byte) ([]byte, string, pluginMeta, error) {
	var meta pluginMeta
	if len(b) > pluginMaxZip {
		return nil, "", meta, fmt.Errorf("ZIP większy niż %d MB", pluginMaxZip>>20)
	}
	zr, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		return nil, "", meta, fmt.Errorf("to nie jest poprawny ZIP: %v", err)
	}
	if len(zr.File) > pluginMaxFiles {
		return nil, "", meta, errors.New("za dużo plików w ZIP-ie")
	}
	type file struct {
		name string
		data []byte
	}
	var files []file
	dirs := map[string]bool{}
	seen := map[string]bool{}
	top := ""
	var total int64
	for _, f := range zr.File {
		name := f.Name
		if strings.HasPrefix(name, "__MACOSX/") || path.Base(name) == ".DS_Store" {
			continue // śmieci Findera
		}
		if err := checkZipName(name); err != nil {
			return nil, "", meta, err
		}
		mode := f.Mode()
		if mode&os.ModeSymlink != 0 {
			return nil, "", meta, fmt.Errorf("symlink w ZIP-ie: %s", name)
		}
		isDir := strings.HasSuffix(name, "/")
		if (isDir && !mode.IsDir() && mode.Type() != 0) || (!isDir && !mode.IsRegular()) {
			return nil, "", meta, fmt.Errorf("nietypowy wpis w ZIP-ie: %s", name)
		}
		if f.Flags&0x1 != 0 {
			return nil, "", meta, errors.New("zaszyfrowany ZIP")
		}
		first := strings.SplitN(strings.TrimSuffix(name, "/"), "/", 2)[0]
		if top == "" {
			top = first
		} else if first != top {
			return nil, "", meta, fmt.Errorf("więcej niż jeden katalog w ZIP-ie (%s, %s)", top, first)
		}
		clean := strings.TrimSuffix(name, "/")
		if seen[clean] {
			return nil, "", meta, fmt.Errorf("powtórzony wpis: %s", name)
		}
		seen[clean] = true
		if isDir {
			dirs[clean] = true
			continue
		}
		if clean == top {
			return nil, "", meta, fmt.Errorf("plik %s poza katalogiem *.koplugin", name)
		}
		rc, err := f.Open()
		if err != nil {
			return nil, "", meta, fmt.Errorf("%s: %v", name, err)
		}
		data, err := io.ReadAll(io.LimitReader(rc, pluginMaxUnpacked-total+1))
		rc.Close()
		if err != nil {
			return nil, "", meta, fmt.Errorf("%s: %v", name, err)
		}
		total += int64(len(data))
		if total > pluginMaxUnpacked {
			return nil, "", meta, fmt.Errorf("po rozpakowaniu ponad %d MB", pluginMaxUnpacked>>20)
		}
		files = append(files, file{clean, data})
	}
	if top == "" {
		return nil, "", meta, errors.New("pusty ZIP")
	}
	if !strings.HasSuffix(top, ".koplugin") {
		return nil, "", meta, fmt.Errorf("katalog %q nie kończy się na .koplugin", top)
	}
	if err := checkPluginDir(top); err != nil {
		return nil, "", meta, err
	}
	var metaSrc []byte
	hasMain := false
	for _, f := range files {
		switch f.name {
		case top + "/_meta.lua":
			metaSrc = f.data
		case top + "/main.lua":
			hasMain = true
		}
	}
	if metaSrc == nil {
		return nil, "", meta, errors.New("brak _meta.lua")
	}
	if !hasMain {
		return nil, "", meta, errors.New("brak main.lua")
	}
	if len(metaSrc) > pluginMaxMeta {
		return nil, "", meta, errors.New("_meta.lua za duży")
	}
	meta = parsePluginMeta(string(metaSrc))

	// Postać znormalizowana: katalogi i pliki posortowane, stały czas i tryby.
	sort.Slice(files, func(i, j int) bool { return files[i].name < files[j].name })
	dirList := []string{top}
	for d := range dirs {
		if d != top {
			dirList = append(dirList, d)
		}
	}
	for _, f := range files { // katalogi pośrednie, których ZIP nie wymienił
		for d := path.Dir(f.name); d != top && d != "."; d = path.Dir(d) {
			if !dirs[d] {
				dirs[d] = true
				dirList = append(dirList, d)
			}
		}
	}
	sort.Strings(dirList)
	stamp := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	var out bytes.Buffer
	zw := zip.NewWriter(&out)
	for _, d := range dirList {
		h := &zip.FileHeader{Name: d + "/", Method: zip.Store, Modified: stamp}
		h.SetMode(os.ModeDir | 0o755)
		if _, err := zw.CreateHeader(h); err != nil {
			return nil, "", meta, err
		}
	}
	for _, f := range files {
		h := &zip.FileHeader{Name: f.name, Method: zip.Deflate, Modified: stamp}
		h.SetMode(0o644)
		wr, err := zw.CreateHeader(h)
		if err != nil {
			return nil, "", meta, err
		}
		if _, err := wr.Write(f.data); err != nil {
			return nil, "", meta, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, "", meta, err
	}
	return out.Bytes(), top, meta, nil
}

// checkZipName odrzuca ścieżki absolutne, '..', backslashe i inne dziwactwa
// (zip-slip). Dopuszcza tylko postać już kanoniczną.
func checkZipName(name string) error {
	bad := func() error { return fmt.Errorf("niedozwolona ścieżka w ZIP-ie: %q", name) }
	if name == "" || strings.HasPrefix(name, "/") || strings.ContainsAny(name, "\\\x00:") {
		return bad()
	}
	trim := strings.TrimSuffix(name, "/")
	if trim == "" || path.Clean(trim) != trim {
		return bad()
	}
	for _, part := range strings.Split(trim, "/") {
		if part == ".." || part == "." || part == "" {
			return bad()
		}
	}
	return nil
}

// --- _meta.lua: ekstraktor pól, nigdy nie wykonuje kodu ---

// parsePluginMeta wyciąga name/fullname/description/version z _meta.lua.
// Typowa postać: `local _ = require("gettext") return { name = "x",
// fullname = _("X"), description = _([[...]]), version = "1.2" }`.
// Tokenizer rozumie komentarze, stringi "…"/'…'/[[…]]/[==[…]==], liczby
// i identyfikatory; bierzemy pierwsze wystąpienie `pole = wartość`, gdzie
// wartość to string, liczba albo `_(string)`. Czego nie rozumiemy → pusto.
func parsePluginMeta(src string) pluginMeta {
	toks := luaTokens(src)
	found := map[string]string{}
	for i := 0; i+2 < len(toks); i++ {
		t := toks[i]
		if t.kind != tkIdent || toks[i+1].kind != tkPunct || toks[i+1].s != "=" {
			continue
		}
		switch t.s {
		case "name", "fullname", "description", "version":
		default:
			continue
		}
		if _, ok := found[t.s]; ok {
			continue
		}
		v := toks[i+2]
		switch {
		case v.kind == tkString || v.kind == tkNumber:
			found[t.s] = v.s
		case v.kind == tkIdent && v.s == "_" && i+4 < len(toks) &&
			toks[i+3].kind == tkPunct && toks[i+3].s == "(" && toks[i+4].kind == tkString:
			found[t.s] = toks[i+4].s
		case v.kind == tkIdent && v.s == "_" && i+3 < len(toks) && toks[i+3].kind == tkString:
			found[t.s] = toks[i+3].s // _"x" / _[[x]] bez nawiasów
		}
	}
	return pluginMeta{
		Name:        clip(strings.TrimSpace(found["name"]), 100),
		Fullname:    clip(strings.TrimSpace(found["fullname"]), 200),
		Description: clip(strings.TrimSpace(found["description"]), 2000),
		Version:     clip(strings.TrimSpace(found["version"]), 60),
	}
}

const (
	tkIdent = iota
	tkString
	tkNumber
	tkPunct
)

type luaTok struct {
	kind int
	s    string
}

// longBracket: jeśli src[i:] zaczyna się od [==[ zwraca poziom i długość otwarcia.
func longBracket(src string, i int) (int, int) {
	if i >= len(src) || src[i] != '[' {
		return -1, 0
	}
	j := i + 1
	for j < len(src) && src[j] == '=' {
		j++
	}
	if j < len(src) && src[j] == '[' {
		return j - i - 1, j - i + 1
	}
	return -1, 0
}

func luaTokens(src string) []luaTok {
	var out []luaTok
	i := 0
	for i < len(src) && len(out) < 10000 {
		c := src[i]
		switch {
		case c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v':
			i++
		case strings.HasPrefix(src[i:], "--"):
			i += 2
			if lvl, n := longBracket(src, i); lvl >= 0 {
				end := strings.Index(src[i+n:], "]"+strings.Repeat("=", lvl)+"]")
				if end < 0 {
					return out
				}
				i += n + end + lvl + 2
			} else {
				for i < len(src) && src[i] != '\n' {
					i++
				}
			}
		case c == '[':
			if lvl, n := longBracket(src, i); lvl >= 0 {
				closer := "]" + strings.Repeat("=", lvl) + "]"
				end := strings.Index(src[i+n:], closer)
				if end < 0 {
					return out
				}
				s := src[i+n : i+n+end]
				s = strings.TrimPrefix(strings.TrimPrefix(s, "\r"), "\n") // Lua pomija pierwszy znak nowej linii
				out = append(out, luaTok{tkString, s})
				i += n + end + len(closer)
			} else {
				out = append(out, luaTok{tkPunct, "["})
				i++
			}
		case c == '"' || c == '\'':
			s, n, ok := luaQuoted(src[i:])
			if !ok {
				return out
			}
			out = append(out, luaTok{tkString, s})
			i += n
		case c == '_' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z':
			j := i
			for j < len(src) && (src[j] == '_' || src[j] >= 'a' && src[j] <= 'z' || src[j] >= 'A' && src[j] <= 'Z' || src[j] >= '0' && src[j] <= '9') {
				j++
			}
			out = append(out, luaTok{tkIdent, src[i:j]})
			i = j
		case c >= '0' && c <= '9':
			j := i
			for j < len(src) && (src[j] >= '0' && src[j] <= '9' || src[j] == '.' || src[j] >= 'a' && src[j] <= 'z' || src[j] >= 'A' && src[j] <= 'Z') {
				j++
			}
			out = append(out, luaTok{tkNumber, src[i:j]})
			i = j
		default:
			out = append(out, luaTok{tkPunct, string(c)})
			i++
		}
	}
	return out
}

// luaQuoted czyta string w cudzysłowach (s[0] to ' albo "). Zwraca treść,
// liczbę zjedzonych bajtów i czy string był domknięty.
func luaQuoted(s string) (string, int, bool) {
	q := s[0]
	var b strings.Builder
	for i := 1; i < len(s); i++ {
		c := s[i]
		switch {
		case c == q:
			return b.String(), i + 1, true
		case c == '\n':
			return "", 0, false
		case c == '\\' && i+1 < len(s):
			i++
			e := s[i]
			switch e {
			case 'n', '\n':
				b.WriteByte('\n')
			case 't':
				b.WriteByte('\t')
			case 'r':
				b.WriteByte('\r')
			case 'a', 'b', 'f', 'v':
			case 'z':
				for i+1 < len(s) && strings.IndexByte(" \t\r\n", s[i+1]) >= 0 {
					i++
				}
			case 'x':
				if i+2 < len(s) {
					if v, err := strconv.ParseUint(s[i+1:i+3], 16, 8); err == nil {
						b.WriteByte(byte(v))
						i += 2
					}
				}
			default:
				if e >= '0' && e <= '9' {
					j := i
					for j < len(s) && j < i+3 && s[j] >= '0' && s[j] <= '9' {
						j++
					}
					if v, err := strconv.Atoi(s[i:j]); err == nil && v < 256 {
						b.WriteByte(byte(v))
					}
					i = j - 1
				} else {
					b.WriteByte(e) // \\ \" \' i inne
				}
			}
		default:
			b.WriteByte(c)
		}
	}
	return "", 0, false
}

// --- magazyn ---

func (st *Store) pluginDir() string { return filepath.Join(filepath.Dir(st.path), "plugins") }

func (st *Store) pluginPath(sha string) string {
	return filepath.Join(st.pluginDir(), sha+".zip")
}

// AddPlugin waliduje, normalizuje i zapisuje ZIP. Ten sam sha → istniejąca wersja.
// path (TASK-12) to ścieżka *.koplugin względem korzenia repo — tylko dla
// source == SrcGallery, zapamiętywana, żeby POST /api/admin/gallery/update
// wiedziała, którego kandydata z monorepo wybrać ponownie bez pytania admina.
func (st *Store) AddPlugin(raw []byte, source, ref, path string) (*PluginVersion, error) {
	norm, dir, meta, err := NormalizePluginZip(raw)
	if err != nil {
		return nil, &badZip{err}
	}
	sum := sha256.Sum256(norm)
	sha := hex.EncodeToString(sum[:])
	// Plik adresowany treścią — zapis poza zamkiem jest bezpieczny.
	if err := os.MkdirAll(st.pluginDir(), 0o700); err != nil {
		return nil, err
	}
	p := st.pluginPath(sha)
	if _, err := os.Stat(p); err != nil {
		tmp := p + ".tmp" + randHex(4)
		if err := os.WriteFile(tmp, norm, 0o600); err != nil {
			return nil, err
		}
		if err := os.Rename(tmp, p); err != nil {
			os.Remove(tmp)
			return nil, err
		}
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	if v := st.S.Plugins[sha]; v != nil {
		c := *v
		return &c, nil
	}
	v := &PluginVersion{
		SHA256: sha, Dir: dir, Name: meta.Name, Fullname: meta.Fullname,
		Description: meta.Description, Version: meta.Version, Size: int64(len(norm)),
		Source: source, SourceRef: clip(ref, 200), Path: clip(path, 300),
		Approved: source != SrcDevice, Added: time.Now(),
	}
	st.S.Plugins[sha] = v
	c := *v
	return &c, st.saveLocked()
}

type badZip struct{ error }

func (st *Store) ListPlugins() []PluginVersion {
	st.mu.Lock()
	defer st.mu.Unlock()
	out := []PluginVersion{}
	for _, v := range st.S.Plugins {
		out = append(out, *v)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Dir != out[j].Dir {
			return out[i].Dir < out[j].Dir
		}
		return out[i].Added.Before(out[j].Added)
	})
	return out
}

// DeletePlugin usuwa wersję, o ile nie jest przypisana do żadnego urządzenia
// (inaczej czytniki dostałyby polecenie odinstalowania — to musi być świadome
// odpięcie w panelu, nie efekt uboczny sprzątania magazynu).
func (st *Store) DeletePlugin(sha string) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.S.Plugins[sha] == nil {
		return errNotFound
	}
	users := []string{}
	for _, d := range st.S.Devices {
		for _, s := range d.Plugins {
			if s == sha {
				users = append(users, d.Name)
			}
		}
	}
	if len(users) > 0 {
		sort.Strings(users)
		return fmt.Errorf("wersja przypisana do: %s — najpierw ją odepnij", strings.Join(users, ", "))
	}
	delete(st.S.Plugins, sha)
	if err := st.saveLocked(); err != nil {
		return err
	}
	os.Remove(st.pluginPath(sha))
	return nil
}

var errNotFound = errors.New("nie ma takiej wersji")

// ApprovePlugin oznacza wersję z urządzenia (TASK-13) jako zaakceptowaną przez
// admina — dopiero wtedy SetDevicePlugins pozwoli przypisać ją innym urządzeniom.
func (st *Store) ApprovePlugin(sha string) (*PluginVersion, error) {
	st.mu.Lock()
	defer st.mu.Unlock()
	v := st.S.Plugins[sha]
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

// UpdateGalleryPluginSHA (TASK-12) podmienia w stanie docelowym urządzeń stary
// sha wtyczki z danego repozytorium galerii (dowolna wersja tego katalogu,
// której source_ref zaczyna się od "owner/repo@") na nowy sha po aktualizacji.
// Zwraca posortowaną listę nazw zmienionych urządzeń.
func (st *Store) UpdateGalleryPluginSHA(dir, repoFullName, newSHA string) ([]string, error) {
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.S.Plugins[newSHA] == nil {
		return nil, errNotFound
	}
	prefix := strings.ToLower(repoFullName) + "@"
	old := map[string]bool{}
	for sha, v := range st.S.Plugins {
		if v.Source == SrcGallery && v.Dir == dir && strings.HasPrefix(strings.ToLower(v.SourceRef), prefix) && sha != newSHA {
			old[sha] = true
		}
	}
	changed := []string{}
	for _, d := range st.S.Devices {
		cur, ok := d.Plugins[dir]
		if !ok || !old[cur] {
			continue
		}
		d.Plugins[dir] = newSHA
		changed = append(changed, d.Name)
	}
	if len(changed) > 0 {
		if err := st.saveLocked(); err != nil {
			return nil, err
		}
	}
	sort.Strings(changed)
	return changed, nil
}

// SetDevicePlugins zastępuje docelowy zbiór wtyczek urządzenia
// (katalog → sha256). Wtyczki to zbiór wersji, bez scalania klucz po kluczu.
func (st *Store) SetDevicePlugins(devID string, want map[string]string) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	d := st.S.Devices[devID]
	if d == nil {
		return errors.New("nieznane urządzenie")
	}
	next := map[string]string{}
	for dir, sha := range want {
		v := st.S.Plugins[sha]
		if v == nil {
			return fmt.Errorf("nie ma wersji %s", sha)
		}
		if v.Dir != dir {
			return fmt.Errorf("wersja %s to %s, nie %s", sha[:12], v.Dir, dir)
		}
		if !v.Approved {
			return fmt.Errorf("%s (%s) czeka na akceptację w panelu", dir, sha[:12])
		}
		if err := checkPluginDir(dir); err != nil {
			return err
		}
		next[dir] = sha
	}
	d.Plugins = next // nowa mapa: adminState kopiuje Device płytko
	return st.saveLocked()
}

// DevicePluginTarget zwraca stan docelowy urządzenia i zapamiętuje, czy
// czytnik zgłosił zgodę. Zgoda pochodzi wyłącznie z żądania czytnika.
func (st *Store) DevicePluginTarget(d *Device, allowed bool) []PluginVersion {
	st.mu.Lock()
	defer st.mu.Unlock()
	if d.PluginsAllowed != allowed {
		d.PluginsAllowed = allowed
		st.saveLocked()
	}
	out := []PluginVersion{}
	if !allowed {
		return out
	}
	for _, sha := range d.Plugins {
		if v := st.S.Plugins[sha]; v != nil {
			out = append(out, *v)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Dir < out[j].Dir })
	return out
}

// ReportPlugins zapisuje inwentarz i wyniki instalacji od czytnika.
func (st *Store) ReportPlugins(d *Device, rep *PluginReport) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	now := time.Now()
	inv := []InstalledPlugin{}
	for _, p := range rep.Installed {
		if len(inv) >= 300 {
			break
		}
		inv = append(inv, InstalledPlugin{
			Dir: clip(p.Dir, 80), Name: clip(p.Name, 100), Version: clip(p.Version, 60),
			Managed: p.Managed, SHA256: clip(p.SHA256, 64),
		})
	}
	sort.Slice(inv, func(i, j int) bool { return inv[i].Dir < inv[j].Dir })
	d.PluginInventory = inv // nowe slice'y, nie modyfikacja w miejscu
	d.PluginReportAt = &now
	if len(rep.Results) > 0 {
		res := []PluginResult{}
		for _, r := range rep.Results {
			if len(res) >= 300 {
				break
			}
			switch r.Status {
			case "ok", "rejected", "error":
			default:
				r.Status = "error"
			}
			res = append(res, PluginResult{
				Dir: clip(r.Dir, 80), SHA256: clip(r.SHA256, 64), Action: clip(r.Action, 20),
				Status: r.Status, Error: clip(r.Error, 300), At: now,
			})
		}
		d.PluginResults = res
	}
	return st.saveLocked()
}

// PluginForDevice: ścieżka ZIP-a, o ile urządzenie ma zgodę i tę wersję przypisaną.
func (st *Store) PluginForDevice(d *Device, sha string) (string, int) {
	st.mu.Lock()
	defer st.mu.Unlock()
	assigned := false
	for _, s := range d.Plugins {
		if s == sha {
			assigned = true
		}
	}
	if !d.PluginsAllowed || !assigned {
		return "", 403
	}
	if st.S.Plugins[sha] == nil {
		return "", 404
	}
	return st.pluginPath(sha), 200
}

// --- ulubione (TASK-20) ---
//
// Klucz ulubionej wtyczki ma jeden z dwóch prefiksów — rozróżniają dwie
// przestrzenie nazw, żeby repozytorium galerii o takiej samej nazwie jak
// katalog wtyczki w magazynie nie kolidowały:
//   gh:owner/repo        — wpis z galerii GitHuba (niezależnie, czy już
//                           zainstalowany)
//   dir:nazwa.koplugin    — katalog wtyczki w magazynie
// Ulubione są współdzielone przez panel na komputerze i na serwerze
// (State.Favorites, store.go) i przechodzą przez eksport/import razem z
// resztą stanu. Oznaczenie gwiazdką NIE instaluje niczego — to tylko
// zakładka/filtr w panelu.

var favKeyRe = regexp.MustCompile(`^(gh:[A-Za-z0-9._-]{1,100}/[A-Za-z0-9._-]{1,100}|dir:[A-Za-z0-9][A-Za-z0-9._-]{0,62}\.koplugin)$`)

// Favorites zwraca posortowaną listę kluczy ulubionych wtyczek.
func (st *Store) Favorites() []string {
	st.mu.Lock()
	defer st.mu.Unlock()
	out := append([]string{}, st.S.Favorites...)
	sort.Strings(out)
	return out
}

// SetFavorite dodaje (on=true) albo usuwa (on=false) klucz z ulubionych i
// zwraca pełną, posortowaną listę po zmianie.
func (st *Store) SetFavorite(key string, on bool) ([]string, error) {
	if !favKeyRe.MatchString(key) {
		return nil, fmt.Errorf("zła nazwa ulubionej wtyczki: %q", key)
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	idx := -1
	for i, k := range st.S.Favorites {
		if k == key {
			idx = i
			break
		}
	}
	changed := false
	switch {
	case on && idx < 0:
		st.S.Favorites = append(st.S.Favorites, key)
		changed = true
	case !on && idx >= 0:
		st.S.Favorites = append(st.S.Favorites[:idx], st.S.Favorites[idx+1:]...)
		changed = true
	}
	sort.Strings(st.S.Favorites)
	out := append([]string{}, st.S.Favorites...)
	if !changed {
		return out, nil // już w żądanym stanie
	}
	if err := st.saveLocked(); err != nil {
		return nil, err
	}
	return out, nil
}

// --- HTTP ---

func (s *Server) pluginRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/v1/plugins/{file}", s.device(s.pluginDownload))
	m.HandleFunc("POST /api/v1/plugins", s.device(s.devicePluginUpload))
	m.HandleFunc("GET /api/admin/plugins", s.admin(s.adminPlugins))
	m.HandleFunc("POST /api/admin/plugins", s.admin(s.adminPluginUpload))
	m.HandleFunc("POST /api/admin/plugins/{sha}/approve", s.admin(s.adminPluginApprove))
	m.HandleFunc("DELETE /api/admin/plugins/{sha}", s.admin(s.adminPluginDelete))
	m.HandleFunc("POST /api/admin/devices/{id}/plugins", s.admin(s.adminDevicePlugins))
	m.HandleFunc("PUT /api/admin/plugins/favorites", s.admin(s.adminFavoritePut))
	m.HandleFunc("DELETE /api/admin/plugins/favorites", s.admin(s.adminFavoriteDelete))
}

// adminFavoritePut/adminFavoriteDelete: {"key": "gh:owner/repo" | "dir:nazwa.koplugin"}.
func (s *Server) adminFavoritePut(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Key string `json:"key"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	out, err := s.st.SetFavorite(strings.TrimSpace(in.Key), true)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"favorites": out})
}

func (s *Server) adminFavoriteDelete(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Key string `json:"key"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	out, err := s.st.SetFavorite(strings.TrimSpace(in.Key), false)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"favorites": out})
}

func (s *Server) pluginDownload(w http.ResponseWriter, r *http.Request, d *Device) {
	sha := strings.TrimSuffix(r.PathValue("file"), ".zip")
	if !shaRe.MatchString(sha) || !strings.HasSuffix(r.PathValue("file"), ".zip") {
		writeJSON(w, 404, map[string]string{"error": "nie ma takiego pliku"})
		return
	}
	p, code := s.st.PluginForDevice(d, sha)
	if code != 200 {
		msg := "ta wtyczka nie jest przypisana do tego urządzenia albo czytnik nie pozwala instalować wtyczek"
		if code == 404 {
			msg = "nie ma takiej wersji"
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
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("X-Koligilo-Sha256", sha)
	http.ServeContent(w, r, sha+".zip", time.Time{}, f)
}

// devicePluginUpload (TASK-13): czytnik wysyła wtyczkę zainstalowaną ręcznie
// (spoza galerii), żeby przenieść ją na inny czytnik bez kabla. Ciało to
// surowy ZIP (Content-Type: application/zip), nie multipart. Nie wymagamy
// plugins_allowed — to czytnik wysyła kod, a nie przyjmuje polecenie jego
// wykonania, i tak czy inaczej zgoda w menu poprzedza samo żądanie (PC-004);
// wersja i tak trafia jako Approved=false i czeka na admina w panelu.
func (s *Server) devicePluginUpload(w http.ResponseWriter, r *http.Request, d *Device) {
	r.Body = http.MaxBytesReader(w, r.Body, pluginMaxZip+1<<20)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "wyślij ZIP jako ciało żądania (application/zip, do 20 MB)"})
		return
	}
	ref := fmt.Sprintf("%s (%s)", d.Name, d.ID)
	v, err := s.st.AddPlugin(raw, SrcDevice, ref, "")
	var bz *badZip
	if errors.As(err, &bz) {
		writeJSON(w, 400, map[string]string{"error": bz.Error()})
		return
	} else if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"plugin": v})
}

func (s *Server) adminPlugins(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"plugins": s.st.ListPlugins()})
}

// adminPluginUpload: multipart, pole "file" z ZIP-em.
func (s *Server) adminPluginUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, pluginMaxZip+1<<20)
	f, _, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "wyślij ZIP w polu „file” (multipart/form-data, do 20 MB)"})
		return
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, pluginMaxZip+1))
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	v, err := s.st.AddPlugin(raw, SrcUpload, "", "")
	var bz *badZip
	if errors.As(err, &bz) {
		writeJSON(w, 400, map[string]string{"error": bz.Error()})
		return
	} else if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"plugin": v})
}

// adminPluginApprove (TASK-13): akceptuje wersję wysłaną z czytnika — dopiero
// wtedy SetDevicePlugins pozwoli przypisać ją innym urządzeniom.
func (s *Server) adminPluginApprove(w http.ResponseWriter, r *http.Request) {
	v, err := s.st.ApprovePlugin(r.PathValue("sha"))
	switch {
	case errors.Is(err, errNotFound):
		writeJSON(w, 404, map[string]string{"error": err.Error()})
	case err != nil:
		writeJSON(w, 500, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, 200, map[string]any{"plugin": v})
	}
}

func (s *Server) adminPluginDelete(w http.ResponseWriter, r *http.Request) {
	err := s.st.DeletePlugin(r.PathValue("sha"))
	switch {
	case errors.Is(err, errNotFound):
		writeJSON(w, 404, map[string]string{"error": err.Error()})
	case err != nil:
		writeJSON(w, 409, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, 200, map[string]bool{"ok": true})
	}
}

// adminDevicePlugins: {"plugins": {"foo.koplugin": "<sha256>", …}} — pełny
// stan docelowy (brak katalogu = do odinstalowania, o ile ma znacznik .koligilo).
// Panel NIE może tu włączyć zgody urządzenia na instalację.
func (s *Server) adminDevicePlugins(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Plugins map[string]string `json:"plugins"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in); err != nil {
		writeJSON(w, 400, map[string]string{"error": "zły JSON"})
		return
	}
	if err := s.st.SetDevicePlugins(r.PathValue("id"), in.Plugins); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// pluginsWire — pole "plugins" w GET /api/v1/sync.
func pluginsWire(vs []PluginVersion) []map[string]any {
	out := []map[string]any{}
	for _, v := range vs {
		out = append(out, map[string]any{
			"dir": v.Dir, "sha256": v.SHA256, "name": v.Name, "version": v.Version,
			"size": v.Size, "url": "/api/v1/plugins/" + v.SHA256 + ".zip",
		})
	}
	return out
}
