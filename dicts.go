package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/bzip2"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/klauspost/compress/zstd"
)

// Magazyn słowników StarDict (TASK-55, PC-020). Słownik to dane, nie kod, więc —
// jak przy czcionkach (PC-018) — czytnik nie pyta o każdą zmianę; zostaje zgoda
// wyłącznie z czytnika (?dicts_allowed=1), sha256, twarde limity i walidacja.
//
// Jedna wersja = jedno znormalizowane ZIP-owe archiwum <dane>/dicts/<sha256>.zip
// z jednym katalogiem głównym (nazwa słownika). Serwer przyjmuje zip, tar.gz,
// tar.bz2, tar.zst i tar (KOReader wydaje słowniki we wszystkich), sprawdza, że
// to StarDict (.ifo + .idx + .dict[.dz]), i zawsze oddaje czytnikowi ZIP, który
// instalator wtyczek już umie rozpakować (libarchive w KOReaderze).
//
// UWAGA: zostają tylko znane typy plików słownika (dictKeepExt), reszta jest
// pomijana. KOReader wykonuje <słownik>.lua leżący obok .ifo jako kod
// (fix_html_func), a kod wolno instalować tylko za potwierdzeniem na czytniku
// (PC-004) — tu go nie ma, więc zostałby tylko tą drogą.

const (
	dictMaxZip      = 300 << 20 // znormalizowany ZIP jednego słownika
	dictMaxUnpacked = 1500 << 20
	dictMaxFiles    = 5000
	dictMaxCount    = 300 // wersji w magazynie
	dictMaxPath     = 200
	dictMaxDepth    = 6
	dictMaxSyncSize = 150 << 20 // limit pobrań na synchronizację — egzekwuje plugin
)

type DictFile struct {
	SHA256    string    `json:"sha256"`
	Name      string    `json:"name"`                 // katalog na czytniku: data/dict/koligilo/<Name>
	Title     string    `json:"title"`                // bookname z .ifo (to widzi użytkownik w KOReaderze)
	Words     int64     `json:"words"`                // wordcount z .ifo (0 = brak)
	Size      int64     `json:"size"`                 // rozmiar ZIP-a
	Unpacked  int64     `json:"unpacked"`             // rozmiar po rozpakowaniu (miejsce na czytniku)
	Dropped   int       `json:"dropped,omitempty"`    // pominięte pliki spoza słownika (m.in. .lua)
	Source    string    `json:"source"`               // upload | katalog
	SourceRef string    `json:"source_ref,omitempty"` // id pozycji katalogu
	Approved  bool      `json:"approved"`
	Added     time.Time `json:"added"`
	Active    bool      `json:"active,omitempty"` // tylko w odpowiedzi: ta wersja trafia na czytniki
}

// InstalledDict — wpis inwentarza słowników zarządzanych przez koligilo na czytniku.
type InstalledDict struct {
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
}

// DictReport — pole "dicts" w POST /api/v1/sync.
type DictReport struct {
	Installed []InstalledDict `json:"installed"`
}

var dictNameRe = regexp.MustCompile(`^[\p{L}\p{N}][\p{L}\p{M}\p{N}\p{Ps}\p{Pe} ._+()'&,\-・·]{0,95}$`)

// checkDictName: nazwa katalogu na czytniku — bez ścieżek, kropek na początku
// i końcu, ukośników; litery dowolnego pisma wraz ze znakami łączonymi (słowniki tajskie, chińskie, arabskie…).
func checkDictName(name string) error {
	if !dictNameRe.MatchString(name) || strings.Contains(name, "..") ||
		strings.HasSuffix(name, ".") || strings.HasSuffix(name, " ") || strings.Contains(name, "  ") {
		return errors.New("zła nazwa słownika — litery, cyfry, spacja, nawiasy i . _ + ' & , - ・ ·, do 96 znaków, bez „..” i bez kropki lub spacji na końcu")
	}
	return nil
}

// sanitizeDictName robi z dowolnego tekstu (nazwa pliku, bookname) poprawną nazwę katalogu.
func sanitizeDictName(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == '/' || r == '\\' || r == ':' || r == '*' || r == '?' || r == '"' || r == '<' || r == '>' || r == '|' || r < 0x20:
			b.WriteRune(' ')
		default:
			b.WriteRune(r)
		}
	}
	out := strings.Join(strings.Fields(b.String()), " ")
	for strings.Contains(out, "..") {
		out = strings.ReplaceAll(out, "..", ".")
	}
	out = strings.Trim(out, ". ")
	for utf8.RuneCountInString(out) > 96 {
		_, n := utf8.DecodeLastRuneInString(out)
		out = strings.TrimRight(out[:len(out)-n], ". ")
	}
	return out
}

type badDict struct{ error }

func dictErr(format string, a ...any) error { return &badDict{fmt.Errorf(format, a...)} }

// --- czytanie archiwów ---

// archEntry to jeden plik z archiwum po oczyszczeniu nazwy.
type archEntry struct {
	name string
	size int64
}

type archWalker func(fn func(name string, size int64, r io.Reader) error) error

// cleanArchivePath: względna ścieżka bez '..', bez backslashy i bajtów sterujących.
// Zwraca "" dla wpisów do pominięcia (katalogi, śmieci systemowe).
func cleanArchivePath(raw string) (string, bool, error) {
	if raw == "" || strings.ContainsAny(raw, "\\\x00") || strings.HasPrefix(raw, "/") || len(raw) > dictMaxPath*2 {
		return "", false, dictErr("niedozwolona ścieżka w archiwum: %q", clip(raw, 80))
	}
	p := strings.TrimPrefix(raw, "./")
	p = strings.TrimSuffix(p, "/")
	if p == "" || p == "." {
		return "", true, nil
	}
	parts := strings.Split(p, "/")
	skip := false
	for _, e := range parts {
		if e == "" || e == ".." || e == "." {
			return "", false, dictErr("niedozwolona ścieżka w archiwum: %q", clip(raw, 80))
		}
		// Czytniki trzymają dane na FAT/exFAT/NTFS: tam końcowa kropka lub spacja jest
		// obcinana ("x.lua." → "x.lua"), a znaki :*?"<>| są zakazane albo podmieniane.
		// Odrzucamy takie nazwy, żeby filtr rozszerzeń widział to, co trafi na dysk.
		if strings.HasSuffix(e, ".") || strings.HasSuffix(e, " ") || strings.ContainsAny(e, `:*?"<>|`) {
			return "", false, dictErr("niedozwolona nazwa w archiwum: %q", clip(raw, 80))
		}
		for _, r := range e {
			if r < 0x20 || r == 0x7f {
				return "", false, dictErr("niedozwolona ścieżka w archiwum: %q", clip(raw, 80))
			}
		}
		if e == "__MACOSX" || strings.HasPrefix(e, ".") {
			skip = true // .DS_Store, ._plik, ukryte katalogi
		}
	}
	if len(p) > dictMaxPath || len(parts) > dictMaxDepth {
		return "", false, dictErr("za długa albo za głęboka ścieżka w archiwum: %q", clip(raw, 80))
	}
	return p, skip, nil
}

// openDictArchive rozpoznaje format po nagłówku i zwraca iterator wpisów.
// Dozwolone są wyłącznie zwykłe pliki (i katalogi, które pomijamy); linki i
// urządzenia odrzucamy. Iterator wolno wywołać wielokrotnie (czytamy dwa razy).
func openDictArchive(p string) (archWalker, error) {
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	head := make([]byte, 512)
	n, _ := io.ReadFull(f, head)
	head = head[:n]
	f.Close()
	switch {
	case bytes.HasPrefix(head, []byte("PK\x03\x04")):
		return func(fn func(string, int64, io.Reader) error) error {
			zr, err := zip.OpenReader(p)
			if err != nil {
				return dictErr("nieczytelny ZIP: %v", err)
			}
			defer zr.Close()
			for _, zf := range zr.File {
				if zf.FileInfo().IsDir() {
					continue
				}
				if !zf.Mode().IsRegular() {
					return dictErr("niedozwolony typ wpisu w ZIP-ie: %q", clip(zf.Name, 80))
				}
				rc, err := zf.Open()
				if err != nil {
					return dictErr("uszkodzony ZIP (%s): %v", clip(zf.Name, 80), err)
				}
				err = fn(zf.Name, int64(zf.UncompressedSize64), rc)
				rc.Close()
				if err != nil {
					return err
				}
			}
			return nil
		}, nil
	case bytes.HasPrefix(head, []byte{0x1f, 0x8b}), bytes.HasPrefix(head, []byte("BZh")),
		bytes.HasPrefix(head, []byte{0x28, 0xb5, 0x2f, 0xfd}), (len(head) >= 262 && string(head[257:262]) == "ustar"):
		kind := "tar"
		switch {
		case head[0] == 0x1f:
			kind = "gz"
		case head[0] == 'B':
			kind = "bz2"
		case head[0] == 0x28:
			kind = "zst"
		}
		return func(fn func(string, int64, io.Reader) error) error {
			f, err := os.Open(p)
			if err != nil {
				return err
			}
			defer f.Close()
			var r io.Reader = f
			switch kind {
			case "gz":
				gz, err := gzip.NewReader(f)
				if err != nil {
					return dictErr("nieczytelny gzip: %v", err)
				}
				defer gz.Close()
				r = gz
			case "bz2":
				r = bzip2.NewReader(f)
			case "zst":
				// pojedynczy wątek i limit okna — dekoder nie ma zjeść pamięci czytnika/serwera
				zd, err := zstd.NewReader(f, zstd.WithDecoderConcurrency(1), zstd.WithDecoderMaxMemory(512<<20))
				if err != nil {
					return dictErr("nieczytelny zstd: %v", err)
				}
				defer zd.Close()
				r = zd
			}
			tr := tar.NewReader(r)
			for {
				h, err := tr.Next()
				if err == io.EOF {
					return nil
				}
				if err != nil {
					return dictErr("uszkodzone archiwum tar: %v", err)
				}
				switch h.Typeflag {
				case tar.TypeReg, tar.TypeRegA:
					if err := fn(h.Name, h.Size, tr); err != nil {
						return err
					}
				case tar.TypeDir, tar.TypeXGlobalHeader:
				default:
					return dictErr("niedozwolony typ wpisu w archiwum: %q", clip(h.Name, 80))
				}
			}
		}, nil
	}
	return nil, dictErr("nierozpoznany format archiwum — oczekuję ZIP, tar.gz, tar.bz2, tar.zst albo tar")
}

// dictMeta — to, co wiemy o słowniku po przeczytaniu .ifo.
type dictMeta struct {
	Title    string
	Words    int64
	Unpacked int64
	Files    int
	Dropped  int
}

// ifoField czyta pole „klucz=wartość” z .ifo.
func ifoField(ifo []byte, key string) string {
	for _, ln := range strings.Split(string(ifo), "\n") {
		ln = strings.TrimRight(ln, "\r")
		if k, v, ok := strings.Cut(ln, "="); ok && strings.TrimSpace(k) == key {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// dictKeepExt — co z archiwum słownika zostaje. Biała lista, nie czarna: KOReader
// wykonuje <słownik>.lua jako kod, a wariantów zapisu ".lua" jest za dużo, żeby je
// wyliczać (wielkość liter, FAT, kompresja). Reszta (README, LICENSE, kod, nieznane
// formaty) jest pomijana i liczona w DictFile.Dropped.
var dictKeepExt = map[string]bool{
	".ifo": true, ".idx": true, ".dict": true, ".syn": true, ".css": true,
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".svg": true, ".webp": true, ".bmp": true,
	".ogg": true, ".oga": true, ".opus": true, ".mp3": true, ".wav": true,
	".woff": true, ".woff2": true, ".ttf": true, ".otf": true,
}

// dictFileKept: czy plik słownika zostaje w znormalizowanym ZIP-ie.
func dictFileKept(p string) bool {
	low := strings.ToLower(path.Base(p))
	for _, suf := range []string{".idx.gz", ".dict.dz", ".syn.dz", ".syn.gz"} {
		if strings.HasSuffix(low, suf) {
			return true
		}
	}
	return dictKeepExt[path.Ext(low)]
}

// zipStoredExt — pliki, które już są skompresowane; nie pakujemy ich drugi raz.
var zipStoredExt = map[string]bool{".dz": true, ".gz": true, ".zip": true, ".png": true, ".jpg": true,
	".jpeg": true, ".gif": true, ".ogg": true, ".mp3": true, ".wav": true, ".woff": true, ".woff2": true, ".webp": true}

// normalizeDict czyta archiwum z dysku, sprawdza, że to StarDict, i zapisuje
// znormalizowany ZIP pod dst (katalog główny = name). Zwraca sha256 ZIP-a i metadane.
// Ta sama zawartość w tej samej kolejności wpisów daje ten sam sha256.
func normalizeDict(src, dst, name string) (string, dictMeta, error) {
	var meta dictMeta
	if err := checkDictName(name); err != nil {
		return "", meta, &badDict{err}
	}
	walk, err := openDictArchive(src)
	if err != nil {
		return "", meta, err
	}
	// Przebieg 1: nazwy, rozmiary, nagłówki .ifo — jeszcze nic nie zapisujemy.
	var files []archEntry
	ifos := map[string][]byte{}
	seen := map[string]bool{}
	var total int64
	err = walk(func(raw string, size int64, r io.Reader) error {
		p, skip, err := cleanArchivePath(raw)
		if err != nil {
			return err
		}
		if skip || p == "" {
			return nil
		}
		if !dictFileKept(p) {
			meta.Dropped++
			return nil
		}
		if seen[strings.ToLower(p)] {
			return dictErr("ten sam plik dwa razy w archiwum: %q", clip(p, 80))
		}
		seen[strings.ToLower(p)] = true
		total += size
		if total > dictMaxUnpacked || len(files) >= dictMaxFiles {
			return dictErr("słownik po rozpakowaniu przekracza limit (%d MB albo %d plików)", dictMaxUnpacked>>20, dictMaxFiles)
		}
		files = append(files, archEntry{p, size})
		if strings.HasSuffix(p, ".ifo") {
			b, err := io.ReadAll(io.LimitReader(r, 64<<10))
			if err != nil {
				return dictErr("uszkodzony plik %s: %v", clip(p, 80), err)
			}
			ifos[p] = b
		}
		return nil
	})
	if err != nil {
		return "", meta, err
	}
	if len(files) == 0 {
		return "", meta, dictErr("archiwum jest puste")
	}
	// Wspólny katalog główny zdejmujemy (KOReader robi to samo przy własnych pobraniach).
	root := ""
	if first, _, ok := strings.Cut(files[0].name, "/"); ok {
		root = first + "/"
		for _, f := range files {
			if !strings.HasPrefix(f.name, root) {
				root = ""
				break
			}
		}
	}
	rel := func(n string) string { return strings.TrimPrefix(n, root) }
	have := map[string]bool{}
	for i := range files {
		files[i].name = rel(files[i].name)
		have[files[i].name] = true
	}
	ifoNames := make([]string, 0, len(ifos))
	for p := range ifos {
		ifoNames = append(ifoNames, rel(p))
	}
	sort.Strings(ifoNames)
	good := 0
	for _, ifo := range ifoNames {
		base := strings.TrimSuffix(ifo, ".ifo")
		if !strings.HasPrefix(strings.TrimSpace(string(ifos[root+ifo])), "StarDict's dict ifo file") {
			continue
		}
		if !(have[base+".idx"] || have[base+".idx.gz"]) || !(have[base+".dict"] || have[base+".dict.dz"]) {
			continue
		}
		good++
		if meta.Title == "" {
			meta.Title = clip(ifoField(ifos[root+ifo], "bookname"), 200)
			meta.Words, _ = strconv.ParseInt(ifoField(ifos[root+ifo], "wordcount"), 10, 64)
		}
	}
	if good == 0 {
		return "", meta, dictErr("to nie jest słownik StarDict — brakuje kompletu .ifo + .idx + .dict (albo .dict.dz) o tej samej nazwie")
	}
	sort.Slice(files, func(i, j int) bool { return files[i].name < files[j].name })
	meta.Files = len(files)
	meta.Unpacked = total
	// Przebieg 2: zapis ZIP-a (archiwum czytamy drugi raz, już wiedząc, co przyjąć).
	out, err := os.Create(dst)
	if err != nil {
		return "", meta, err
	}
	h := sha256.New()
	cw := &countWriter{w: io.MultiWriter(out, h)}
	zw := zip.NewWriter(cw)
	stamp := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	fail := func(err error) (string, dictMeta, error) {
		out.Close()
		os.Remove(dst)
		return "", meta, err
	}
	// Katalogi w ZIP-ie (deterministycznie), potem pliki.
	dirs := map[string]bool{}
	for _, f := range files {
		for d := path.Dir(f.name); d != "." && d != ""; d = path.Dir(d) {
			dirs[d] = true
		}
	}
	dirList := []string{name}
	for d := range dirs {
		dirList = append(dirList, name+"/"+d)
	}
	sort.Strings(dirList)
	for _, d := range dirList {
		hd := &zip.FileHeader{Name: d + "/", Method: zip.Store, Modified: stamp}
		hd.SetMode(os.ModeDir | 0o755)
		if _, err := zw.CreateHeader(hd); err != nil {
			return fail(err)
		}
	}
	// Archiwum jest strumieniem, więc wpisy w ZIP-ie idą w kolejności źródła.
	want := map[string]int64{}
	for _, f := range files {
		want[f.name] = f.size
	}
	written := 0
	err = walk(func(raw string, size int64, r io.Reader) error {
		p, skip, err := cleanArchivePath(raw)
		if err != nil || skip || p == "" || !dictFileKept(p) {
			return err
		}
		p = rel(p)
		if _, ok := want[p]; !ok {
			return dictErr("archiwum zmieniło się w trakcie czytania")
		}
		method := zip.Deflate
		if zipStoredExt[strings.ToLower(path.Ext(p))] {
			method = zip.Store
		}
		hd := &zip.FileHeader{Name: name + "/" + p, Method: method, Modified: stamp}
		hd.SetMode(0o644)
		wr, err := zw.CreateHeader(hd)
		if err != nil {
			return err
		}
		n, err := io.Copy(wr, io.LimitReader(r, want[p]+1))
		if err != nil {
			return dictErr("uszkodzony plik %s: %v", clip(p, 80), err)
		}
		if n != want[p] {
			return dictErr("plik %s ma inny rozmiar niż zapowiada archiwum", clip(p, 80))
		}
		written++
		if cw.n > dictMaxZip {
			return dictErr("słownik po spakowaniu przekracza %d MB", dictMaxZip>>20)
		}
		return nil
	})
	if err != nil {
		return fail(err)
	}
	if written != len(files) {
		return fail(dictErr("archiwum zmieniło się w trakcie czytania"))
	}
	if err := zw.Close(); err != nil {
		return fail(err)
	}
	if err := out.Close(); err != nil {
		os.Remove(dst)
		return "", meta, err
	}
	if cw.n > dictMaxZip {
		os.Remove(dst)
		return "", meta, dictErr("słownik po spakowaniu przekracza %d MB", dictMaxZip>>20)
	}
	return hex.EncodeToString(h.Sum(nil)), meta, nil
}

type countWriter struct {
	w io.Writer
	n int64
}

func (c *countWriter) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	c.n += int64(n)
	return n, err
}

// --- magazyn ---

func (st *Store) dictDir() string { return filepath.Join(filepath.Dir(st.path), "dicts") }

func (st *Store) dictPath(sha string) string { return filepath.Join(st.dictDir(), sha+".zip") }

// dictTmpDir: pliki robocze (pobrania, składanie ZIP-a) — poza magazynem, żeby
// nieudana operacja nie zostawiła śmieci wyglądających na słownik.
func (st *Store) dictTmpDir() (string, error) {
	d := filepath.Join(st.dictDir(), ".tmp")
	return d, os.MkdirAll(d, 0o700)
}

// AddDictFile normalizuje archiwum z dysku (src zostaje nietknięte), zapisuje je
// w magazynie i rejestruje wersję. Nowa wersja zastępuje starsze o tej samej
// nazwie (czytniki biorą najnowszą, a słowniki są duże).
func (st *Store) AddDictFile(src, name, title, source, ref string) (*DictFile, error) {
	tmpDir, err := st.dictTmpDir()
	if err != nil {
		return nil, err
	}
	tmp := filepath.Join(tmpDir, "norm-"+randHex(6)+".zip")
	sha, meta, err := normalizeDict(src, tmp, name)
	if err != nil {
		return nil, err
	}
	defer os.Remove(tmp)
	fi, err := os.Stat(tmp)
	if err != nil {
		return nil, err
	}
	st.mu.Lock()
	if v := st.S.Dicts[sha]; v != nil {
		c := *v
		st.mu.Unlock()
		return &c, nil
	}
	if len(st.S.Dicts) >= dictMaxCount {
		st.mu.Unlock()
		return nil, dictErr("w magazynie jest już %d słowników — usuń niepotrzebne", dictMaxCount)
	}
	st.mu.Unlock()
	if _, err := os.Stat(st.dictPath(sha)); err != nil {
		if err := os.Rename(tmp, st.dictPath(sha)); err != nil {
			return nil, err
		}
	}
	title = clip(title, 200)
	if meta.Title != "" {
		title = meta.Title
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.S.Dicts == nil {
		st.S.Dicts = map[string]*DictFile{}
	}
	if v := st.S.Dicts[sha]; v != nil {
		c := *v
		return &c, nil
	}
	v := &DictFile{
		SHA256: sha, Name: name, Title: title, Words: meta.Words, Size: fi.Size(), Unpacked: meta.Unpacked,
		Dropped: meta.Dropped, Source: source, SourceRef: clip(ref, 200), Approved: true, Added: time.Now(),
	}
	// Starsze wersje tej samej nazwy znikają razem z plikami.
	var old []string
	for k, o := range st.S.Dicts {
		if o.Name == name {
			old = append(old, k)
			delete(st.S.Dicts, k)
		}
	}
	st.S.Dicts[sha] = v
	err = st.saveLocked()
	for _, k := range old {
		os.Remove(st.dictPath(k))
	}
	c := *v
	return &c, err
}

// activeDictsLocked: dla każdej nazwy najnowsza zaakceptowana wersja.
func (st *Store) activeDictsLocked() map[string]*DictFile {
	act := map[string]*DictFile{}
	for _, v := range st.S.Dicts {
		if !v.Approved {
			continue
		}
		if cur := act[v.Name]; cur == nil || v.Added.After(cur.Added) ||
			(v.Added.Equal(cur.Added) && v.SHA256 > cur.SHA256) {
			act[v.Name] = v
		}
	}
	return act
}

func (st *Store) ListDicts() []DictFile {
	st.mu.Lock()
	defer st.mu.Unlock()
	act := st.activeDictsLocked()
	out := []DictFile{}
	for _, v := range st.S.Dicts {
		c := *v
		c.Active = act[v.Name] == v
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool {
		if li, lj := strings.ToLower(out[i].Name), strings.ToLower(out[j].Name); li != lj {
			return li < lj
		}
		return out[i].Added.Before(out[j].Added)
	})
	return out
}

func (st *Store) DeleteDict(sha string) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.S.Dicts[sha] == nil {
		return errNotFound
	}
	delete(st.S.Dicts, sha)
	if err := st.saveLocked(); err != nil {
		return err
	}
	os.Remove(st.dictPath(sha))
	return nil
}

// DictTarget zwraca stan docelowy słowników urządzenia i zapamiętuje, czy
// czytnik zgłosił zgodę. Zgoda pochodzi wyłącznie z żądania czytnika.
func (st *Store) DictTarget(d *Device, allowed bool) []DictFile {
	st.mu.Lock()
	defer st.mu.Unlock()
	if d.DictsAllowed != allowed {
		d.DictsAllowed = allowed
		st.saveLocked()
	}
	out := []DictFile{}
	if !allowed {
		return out
	}
	for _, v := range st.activeDictsLocked() {
		out = append(out, *v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// ReportDicts zapisuje inwentarz słowników zarządzanych przez koligilo.
func (st *Store) ReportDicts(d *Device, rep *DictReport) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	now := time.Now()
	inv := []InstalledDict{}
	for _, f := range rep.Installed {
		if len(inv) >= dictMaxCount {
			break
		}
		if checkDictName(f.Name) != nil || !shaRe.MatchString(f.SHA256) {
			continue
		}
		inv = append(inv, InstalledDict{Name: f.Name, SHA256: f.SHA256})
	}
	sort.Slice(inv, func(i, j int) bool { return inv[i].Name < inv[j].Name })
	d.DictInventory = inv
	d.DictReportAt = &now
	return st.saveLocked()
}

// DictForDevice: ścieżka ZIP-a, o ile urządzenie ma zgodę, a wersja jest aktualna i zaakceptowana.
func (st *Store) DictForDevice(d *Device, sha string) (string, int) {
	st.mu.Lock()
	defer st.mu.Unlock()
	if !d.DictsAllowed {
		return "", 403
	}
	v := st.S.Dicts[sha]
	if v == nil {
		return "", 404
	}
	if !v.Approved {
		return "", 403
	}
	return st.dictPath(sha), 200
}

// --- HTTP ---

func (s *Server) dictRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/v1/dicts/{sha}", s.device(s.dictDownload))
	m.HandleFunc("GET /api/admin/dicts", s.admin(s.adminDicts))
	m.HandleFunc("POST /api/admin/dicts", s.admin(s.adminDictUpload))
	m.HandleFunc("DELETE /api/admin/dicts/{sha}", s.admin(s.adminDictDelete))
	s.dictCatalogRoutes(m)
}

func (s *Server) dictDownload(w http.ResponseWriter, r *http.Request, d *Device) {
	sha := r.PathValue("sha")
	if !shaRe.MatchString(sha) {
		writeJSON(w, 404, map[string]string{"error": "nie ma takiego pliku"})
		return
	}
	p, code := s.st.DictForDevice(d, sha)
	if code != 200 {
		msg := "czytnik nie pozwala synchronizować słowników"
		if code == 404 {
			msg = "nie ma takiego słownika"
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

func dictError(w http.ResponseWriter, err error) bool {
	var bd *badDict
	switch {
	case err == nil:
		return false
	case errors.As(err, &bd):
		writeJSON(w, 400, map[string]string{"error": bd.Error()})
	default:
		writeJSON(w, 500, map[string]string{"error": err.Error()})
	}
	return true
}

func (s *Server) adminDicts(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"dicts": s.st.ListDicts(), "jobs": s.dictJobsSnapshot()})
}

// dictArchiveStem: nazwa pliku bez rozszerzeń archiwum — domyślna nazwa katalogu.
func dictArchiveStem(file string) string {
	if i := strings.LastIndexAny(file, `/\`); i >= 0 {
		file = file[i+1:]
	}
	low := strings.ToLower(file)
	for _, ext := range []string{".tar.gz", ".tar.bz2", ".tar.zst", ".tgz", ".tar", ".zip"} {
		if strings.HasSuffix(low, ext) {
			return file[:len(file)-len(ext)]
		}
	}
	return strings.TrimSuffix(file, filepath.Ext(file))
}

// adminDictUpload: multipart. Pole "file" (jedno) = archiwum słownika, albo
// kilka pól "file" = luźne pliki StarDict (.ifo/.idx/.dict.dz/.syn…). Opcjonalne
// pole "name" ustawia nazwę katalogu na czytniku.
func (s *Server) adminDictUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, dictMaxZip+dictMaxUnpacked/4+1<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeJSON(w, 400, map[string]string{"error": "wyślij słownik w polu „file” (multipart/form-data)"})
		return
	}
	defer r.MultipartForm.RemoveAll()
	parts := r.MultipartForm.File["file"]
	if len(parts) == 0 {
		writeJSON(w, 400, map[string]string{"error": "wyślij słownik w polu „file” (multipart/form-data)"})
		return
	}
	tmpDir, err := s.st.dictTmpDir()
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	src := filepath.Join(tmpDir, "up-"+randHex(6))
	defer os.Remove(src)
	stem := ""
	if len(parts) == 1 {
		// Jedno archiwum — kopiujemy do pliku roboczego.
		in, err := parts[0].Open()
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error()})
			return
		}
		defer in.Close()
		if err := copyLimited(src, in, dictMaxZip+dictMaxUnpacked/4); err != nil {
			dictError(w, err)
			return
		}
		stem = dictArchiveStem(parts[0].Filename)
	} else {
		// Luźne pliki: składamy z nich tar, żeby dalej szła ta sama ścieżka.
		if err := tarParts(src, parts); err != nil {
			dictError(w, err)
			return
		}
		stem = dictArchiveStem(strings.TrimSuffix(parts[0].Filename, filepath.Ext(parts[0].Filename)))
		for _, p := range parts {
			if strings.HasSuffix(strings.ToLower(p.Filename), ".ifo") {
				stem = strings.TrimSuffix(filepath.Base(p.Filename), filepath.Ext(p.Filename))
			}
		}
	}
	name := strings.TrimSpace(r.FormValue("name"))
	if name == "" {
		name = sanitizeDictName(stem)
	}
	v, err := s.st.AddDictFile(src, name, "", SrcUpload, "")
	if dictError(w, err) {
		return
	}
	writeJSON(w, 200, map[string]any{"dict": v})
}

func copyLimited(dst string, in io.Reader, limit int64) error {
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	n, err := io.Copy(out, io.LimitReader(in, limit+1))
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return err
	}
	if n > limit {
		return dictErr("plik większy niż %d MB", limit>>20)
	}
	return nil
}

// tarParts składa przesłane luźne pliki w jeden tar (źródło dla normalizeDict).
func tarParts(dst string, parts []*multipart.FileHeader) error {
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	tw := tar.NewWriter(out)
	for _, p := range parts {
		name := p.Filename
		if i := strings.LastIndexAny(name, `/\`); i >= 0 {
			name = name[i+1:]
		}
		in, err := p.Open()
		if err != nil {
			return err
		}
		if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: p.Size, Typeflag: tar.TypeReg}); err != nil {
			in.Close()
			return err
		}
		_, err = io.Copy(tw, io.LimitReader(in, p.Size))
		in.Close()
		if err != nil {
			return err
		}
	}
	return tw.Close()
}

func (s *Server) adminDictDelete(w http.ResponseWriter, r *http.Request) {
	err := s.st.DeleteDict(r.PathValue("sha"))
	switch {
	case errors.Is(err, errNotFound):
		writeJSON(w, 404, map[string]string{"error": "nie ma takiego słownika"})
	case err != nil:
		writeJSON(w, 500, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, 200, map[string]bool{"ok": true})
	}
}

// dictsWire — pole "dicts" w GET /api/v1/sync.
func dictsWire(vs []DictFile) []map[string]any {
	out := []map[string]any{}
	for _, v := range vs {
		out = append(out, map[string]any{
			"name": v.Name, "sha256": v.SHA256, "size": v.Size, "unpacked": v.Unpacked,
			"url": "/api/v1/dicts/" + v.SHA256,
		})
	}
	return out
}
