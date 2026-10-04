package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

const testMeta = `local _ = require("gettext")
-- name = "podpucha w komentarzu"
--[[ version = "0.0" ]]
return {
    name = 'foo',
    fullname = _("Foo \"plus\""),
    description = _([[
Opis
w dwóch liniach.]]),
    version = 1.2,
}
`

type zent struct {
	name, body string
	mode       os.FileMode // 0 = zwykły plik
}

func mkZip(t *testing.T, ents ...zent) []byte {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range ents {
		h := &zip.FileHeader{Name: e.name, Method: zip.Deflate, Modified: time.Now()}
		if e.mode != 0 {
			h.SetMode(e.mode)
		}
		w, err := zw.CreateHeader(h)
		if err != nil {
			t.Fatal(err)
		}
		io.WriteString(w, e.body)
	}
	zw.Close()
	return buf.Bytes()
}

func goodZip(t *testing.T, dir string) []byte {
	return mkZip(t,
		zent{name: dir + "/_meta.lua", body: testMeta},
		zent{name: dir + "/main.lua", body: "return {}"},
		zent{name: dir + "/lib/x.lua", body: "return 1"},
	)
}

func TestPluginMetaParser(t *testing.T) {
	m := parsePluginMeta(testMeta)
	if m.Name != "foo" || m.Fullname != `Foo "plus"` || m.Description != "Opis\nw dwóch liniach." || m.Version != "1.2" {
		t.Errorf("meta = %+v", m)
	}
	m = parsePluginMeta(`return { name = [==[a]]b]==], version = _"2.0" }`)
	if m.Name != "a]]b" || m.Version != "2.0" {
		t.Errorf("meta2 = %+v", m)
	}
	// Kod zamiast literału — nic nie wykonujemy, pola puste.
	m = parsePluginMeta(`os.execute("rm -rf /") return { name = os.getenv("X") }`)
	if m != (pluginMeta{}) {
		t.Errorf("meta3 = %+v", m)
	}
	parsePluginMeta(`return { name = "niedomknięty`) // bez paniki
}

// pluginEnv: serwer, token admina i funkcja do żądań z dowolnym Bearerem.
type pluginEnv struct {
	t     *testing.T
	s     *Server
	mux   http.Handler
	admin string
}

func newPluginEnv(t *testing.T) *pluginEnv {
	st, admin, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{st: st}
	return &pluginEnv{t: t, s: s, mux: s.Routes(), admin: admin}
}

func (e *pluginEnv) do(tok, method, path string, body io.Reader, ctype string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, body)
	r.Header.Set("Authorization", "Bearer "+tok)
	if ctype != "" {
		r.Header.Set("Content-Type", ctype)
	}
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, r)
	return rec
}

func (e *pluginEnv) jsonDo(tok, method, path string, in any) (int, map[string]any) {
	var rd io.Reader = bytes.NewReader(nil)
	if in != nil {
		b, _ := json.Marshal(in)
		rd = bytes.NewReader(b)
	}
	rec := e.do(tok, method, path, rd, "application/json")
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func (e *pluginEnv) upload(zipb []byte) (int, map[string]any) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("file", "x.zip")
	fw.Write(zipb)
	mw.Close()
	rec := e.do(e.admin, "POST", "/api/admin/plugins", &buf, mw.FormDataContentType())
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func (e *pluginEnv) uploadOK(zipb []byte) map[string]any {
	c, out := e.upload(zipb)
	if c != 200 {
		e.t.Fatalf("upload: %d %v", c, out)
	}
	return out["plugin"].(map[string]any)
}

// TASK-6 AC1
func TestPluginUpload(t *testing.T) {
	e := newPluginEnv(t)
	p := e.uploadOK(goodZip(t, "foo.koplugin"))
	sha := p["sha256"].(string)
	if p["dir"] != "foo.koplugin" || p["name"] != "foo" || p["version"] != "1.2" || p["source"] != SrcUpload || p["approved"] != true {
		t.Errorf("plugin = %v", p)
	}
	b, err := os.ReadFile(e.s.st.pluginPath(sha))
	if err != nil {
		t.Fatal(err)
	}
	if sum := sha256.Sum256(b); hex.EncodeToString(sum[:]) != sha {
		t.Error("sha256 nie zgadza się z bajtami w magazynie")
	}
	// Normalizacja: inna kolejność, inne czasy, śmieci Findera → ten sam sha.
	again := e.uploadOK(mkZip(t,
		zent{name: "__MACOSX/foo.koplugin/._main.lua", body: "x"},
		zent{name: "foo.koplugin/", mode: os.ModeDir | 0o755},
		zent{name: "foo.koplugin/lib/x.lua", body: "return 1"},
		zent{name: "foo.koplugin/main.lua", body: "return {}"},
		zent{name: "foo.koplugin/.DS_Store", body: "x"},
		zent{name: "foo.koplugin/_meta.lua", body: testMeta},
	))
	if again["sha256"] != sha {
		t.Errorf("ta sama treść, inny sha: %s vs %s", again["sha256"], sha)
	}
	c, list := e.jsonDo(e.admin, "GET", "/api/admin/plugins", nil)
	if c != 200 || len(list["plugins"].([]any)) != 1 {
		t.Errorf("lista: %d %v", c, list)
	}
	// Brak pól w _meta.lua → puste, ale przyjęte.
	p2 := e.uploadOK(mkZip(t, zent{name: "bar.koplugin/_meta.lua", body: "return {}"}, zent{name: "bar.koplugin/main.lua", body: ""}))
	if p2["name"] != "" || p2["version"] != "" {
		t.Errorf("puste meta = %v", p2)
	}
	// DELETE nieprzypisanej wersji usuwa też plik.
	if c, _ := e.jsonDo(e.admin, "DELETE", "/api/admin/plugins/"+p2["sha256"].(string), nil); c != 200 {
		t.Errorf("delete: %d", c)
	}
	if _, err := os.Stat(e.s.st.pluginPath(p2["sha256"].(string))); !os.IsNotExist(err) {
		t.Error("plik po DELETE wciąż jest")
	}
	if c, _ := e.upload(goodZip(t, "foo.koplugin")); c != 200 {
		t.Error("ponowny upload")
	}
	if rec := e.do("", "POST", "/api/admin/plugins", nil, ""); rec.Code != 401 {
		t.Errorf("upload bez tokenu: %d", rec.Code)
	}
}

// TASK-6 AC2 + AC4
func TestPluginUploadRejects(t *testing.T) {
	e := newPluginEnv(t)
	meta := zent{name: "foo.koplugin/_meta.lua", body: testMeta}
	main := zent{name: "foo.koplugin/main.lua", body: ""}
	cases := map[string][]byte{
		"zip-slip ..":         mkZip(t, meta, main, zent{name: "foo.koplugin/../../evil.lua", body: "x"}),
		"zip-slip na starcie": mkZip(t, meta, main, zent{name: "../evil.lua", body: "x"}),
		"ścieżka absolutna":   mkZip(t, meta, main, zent{name: "/etc/evil", body: "x"}),
		"backslash":           mkZip(t, meta, main, zent{name: `foo.koplugin\..\..\evil`, body: "x"}),
		"symlink":             mkZip(t, meta, main, zent{name: "foo.koplugin/link", body: "/etc/passwd", mode: os.ModeSymlink | 0o777}),
		"bez _meta.lua":       mkZip(t, main),
		"bez main.lua":        mkZip(t, meta),
		"dwa katalogi":        mkZip(t, meta, main, zent{name: "bar.koplugin/main.lua", body: ""}),
		"plik w korzeniu":     mkZip(t, meta, main, zent{name: "README.md", body: ""}),
		"nie .koplugin":       mkZip(t, zent{name: "foo/_meta.lua", body: ""}, zent{name: "foo/main.lua", body: ""}),
		"koligilo.koplugin":   goodZip(t, "koligilo.koplugin"),
		"Koligilo.koplugin":   goodZip(t, "Koligilo.koplugin"),
		"wbudowana":           goodZip(t, "statistics.koplugin"),
		"nie ZIP":             []byte("to nie zip"),
		"pusty ZIP":           mkZip(t),
	}
	for name, b := range cases {
		c, out := e.upload(b)
		t.Logf("%s → %d %v", name, c, out["error"])
		if c != 400 {
			t.Errorf("%s: %d %v, chcę 400", name, c, out)
		}
	}
	if _, _, _, err := NormalizePluginZip(make([]byte, pluginMaxZip+1)); err == nil {
		t.Error("za duży ZIP przyjęty")
	}
	if n := len(e.s.st.ListPlugins()); n != 0 {
		t.Errorf("w magazynie %d wersji po samych odrzuceniach", n)
	}
}

// TASK-6 AC3, TASK-7 AC1–AC3
func TestPluginAssignSyncReport(t *testing.T) {
	e := newPluginEnv(t)
	foo := e.uploadOK(goodZip(t, "foo.koplugin"))["sha256"].(string)
	bar := e.uploadOK(goodZip(t, "bar.koplugin"))["sha256"].(string)
	d1, tok1, _ := e.s.st.Provision("Kobo", "", "", "")
	_, tok2, _ := e.s.st.Provision("Kindle", "", "", "")
	assign := "/api/admin/devices/" + d1.ID + "/plugins"

	// Walidacja przypisania.
	for name, body := range map[string]map[string]string{
		"nieznany sha":    {"foo.koplugin": strings.Repeat("0", 64)},
		"zły katalog":     {"bar.koplugin": foo},
		"koligilo":        {"koligilo.koplugin": foo},
		"nie ta wersja…":  {"foo.koplugin": bar},
		"pusty katalog…":  {"": foo},
		"sha jako nazwa…": {foo: foo},
	} {
		if c, _ := e.jsonDo(e.admin, "POST", assign, map[string]any{"plugins": body}); c != 400 {
			t.Errorf("przypisanie %s: %d, chcę 400", name, c)
		}
	}
	// Panel nie może włączyć zgody czytnika — pole jest ignorowane.
	if c, _ := e.jsonDo(e.admin, "POST", assign, map[string]any{"plugins": map[string]string{"foo.koplugin": foo}, "plugins_allowed": true}); c != 200 {
		t.Fatalf("przypisanie: %d", c)
	}
	if e.s.st.S.Devices[d1.ID].PluginsAllowed {
		t.Fatal("panel włączył plugins_allowed")
	}
	// Wersja z urządzenia czeka na akceptację — nie da się jej przypisać.
	dv, err := e.s.st.AddPlugin(goodZip(t, "baz.koplugin"), SrcDevice, d1.ID, "")
	if err != nil || dv.Approved {
		t.Fatalf("wersja z urządzenia: %v %+v", err, dv)
	}
	if c, _ := e.jsonDo(e.admin, "POST", assign, map[string]any{"plugins": map[string]string{"baz.koplugin": dv.SHA256}}); c != 400 {
		t.Errorf("niezaakceptowana wersja przypisana: %d", c)
	}

	// AC1: bez plugins_allowed nie ma pola plugins i nie ma pobierania.
	c, out := e.jsonDo(tok1, "GET", "/api/v1/sync", nil)
	if _, ok := out["plugins"]; c != 200 || ok {
		t.Errorf("sync bez zgody: %d, plugins obecne=%v", c, ok)
	}
	if rec := e.do(tok1, "GET", "/api/v1/plugins/"+foo+".zip", nil, ""); rec.Code != 403 {
		t.Errorf("pobranie bez zgody: %d, chcę 403", rec.Code)
	}

	// Ze zgodą: pole plugins i pobranie przypisanej wersji.
	c, out = e.jsonDo(tok1, "GET", "/api/v1/sync?plugins_allowed=1", nil)
	pl, _ := out["plugins"].([]any)
	if c != 200 || len(pl) != 1 {
		t.Fatalf("sync ze zgodą: %d %v", c, out["plugins"])
	}
	p := pl[0].(map[string]any)
	if p["dir"] != "foo.koplugin" || p["sha256"] != foo || p["version"] != "1.2" || p["url"] != "/api/v1/plugins/"+foo+".zip" {
		t.Errorf("wpis plugins = %v", p)
	}
	rec := e.do(tok1, "GET", p["url"].(string), nil, "")
	sum := sha256.Sum256(rec.Body.Bytes())
	if rec.Code != 200 || hex.EncodeToString(sum[:]) != foo || rec.Header().Get("Content-Type") != "application/zip" {
		t.Errorf("pobranie: %d, sha zgodny=%v", rec.Code, hex.EncodeToString(sum[:]) == foo)
	}
	// TASK-6 AC3: nieprzypisana wersja i cudze urządzenie → 403.
	if rec := e.do(tok1, "GET", "/api/v1/plugins/"+bar+".zip", nil, ""); rec.Code != 403 {
		t.Errorf("nieprzypisana: %d, chcę 403", rec.Code)
	}
	e.jsonDo(tok2, "GET", "/api/v1/sync?plugins_allowed=1", nil)
	if rec := e.do(tok2, "GET", "/api/v1/plugins/"+foo+".zip", nil, ""); rec.Code != 403 {
		t.Errorf("inne urządzenie: %d, chcę 403", rec.Code)
	}
	if rec := e.do("zly", "GET", "/api/v1/plugins/"+foo+".zip", nil, ""); rec.Code != 401 {
		t.Errorf("bez tokenu: %d, chcę 401", rec.Code)
	}
	if rec := e.do(tok1, "GET", "/api/v1/plugins/..%2fstate.json", nil, ""); rec.Code != 404 {
		t.Errorf("dziwna nazwa: %d, chcę 404", rec.Code)
	}
	// Przypisanej wersji nie można skasować z magazynu.
	if c, _ := e.jsonDo(e.admin, "DELETE", "/api/admin/plugins/"+foo, nil); c != 409 {
		t.Errorf("delete przypisanej: %d, chcę 409", c)
	}

	// Raport od czytnika → widoczny w panelu (AC2).
	rep := map[string]any{
		"set": map[string]string{}, "delete": []string{}, "received": 0,
		"plugins": map[string]any{
			"installed": []map[string]any{
				{"dir": "foo.koplugin", "name": "foo", "version": "1.2", "managed": true, "sha256": foo},
				{"dir": "reczna.koplugin", "version": "0.1", "managed": false},
			},
			"results": []map[string]any{
				{"dir": "foo.koplugin", "sha256": foo, "action": "install", "status": "ok"},
				{"dir": "bar.koplugin", "sha256": bar, "action": "install", "status": "rejected"},
				{"dir": "x.koplugin", "status": "cokolwiek", "error": "sha256 niezgodny"},
			},
		},
	}
	if c, out := e.jsonDo(tok1, "POST", "/api/v1/sync", rep); c != 200 {
		t.Fatalf("raport: %d %v", c, out)
	}
	// Kolejny sync bez wyników nie kasuje ostatniego wyniku instalacji.
	rep["plugins"] = map[string]any{"installed": []map[string]any{{"dir": "foo.koplugin", "version": "1.2", "managed": true}}}
	e.jsonDo(tok1, "POST", "/api/v1/sync", rep)
	// Sync bez pola plugins (stary plugin) nie rusza inwentarza.
	e.jsonDo(tok1, "POST", "/api/v1/sync", map[string]any{"set": map[string]string{}})

	_, st := e.jsonDo(e.admin, "GET", "/api/admin/state", nil)
	var dev map[string]any
	for _, x := range st["devices"].([]any) {
		if x.(map[string]any)["id"] == d1.ID {
			dev = x.(map[string]any)
		}
	}
	inv, _ := dev["plugin_inventory"].([]any)
	res, _ := dev["plugin_results"].([]any)
	if len(inv) != 1 || inv[0].(map[string]any)["managed"] != true {
		t.Errorf("inwentarz = %v", dev["plugin_inventory"])
	}
	if len(res) != 3 || res[1].(map[string]any)["status"] != "rejected" || res[2].(map[string]any)["status"] != "error" {
		t.Errorf("wyniki = %v", dev["plugin_results"])
	}
	if dev["plugins_allowed"] != true || dev["plugins"].(map[string]any)["foo.koplugin"] != foo {
		t.Errorf("urządzenie w panelu = %v", dev)
	}

	// Czytnik cofa zgodę → pobieranie znów 403.
	e.jsonDo(tok1, "GET", "/api/v1/sync", nil)
	if rec := e.do(tok1, "GET", "/api/v1/plugins/"+foo+".zip", nil, ""); rec.Code != 403 {
		t.Errorf("po cofnięciu zgody: %d, chcę 403", rec.Code)
	}
	// Odpięcie wszystkiego = pusty zbiór docelowy; wtedy wersję można skasować.
	if c, _ := e.jsonDo(e.admin, "POST", assign, map[string]any{"plugins": map[string]string{}}); c != 200 {
		t.Errorf("odpięcie: %d", c)
	}
	if c, _ := e.jsonDo(e.admin, "DELETE", "/api/admin/plugins/"+foo, nil); c != 200 {
		t.Errorf("delete po odpięciu: %d", c)
	}
}

// devicePluginUpload: ZIP jako surowe ciało żądania (nie multipart).
func (e *pluginEnv) deviceUpload(tok string, zipb []byte) (int, map[string]any) {
	rec := e.do(tok, "POST", "/api/v1/plugins", bytes.NewReader(zipb), "application/zip")
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// TASK-13 AC2: wtyczka wysłana z czytnika czeka na akceptację admina, zanim
// da się ją przypisać innemu urządzeniu; po akceptacji przypisanie działa.
func TestDevicePluginUpload(t *testing.T) {
	e := newPluginEnv(t)
	d1, tok1, err := e.s.st.Provision("Kobo", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	d2, tok2, _ := e.s.st.Provision("Kindle", "", "", "")

	c, out := e.deviceUpload(tok1, goodZip(t, "kopad.koplugin"))
	if c != 200 {
		t.Fatalf("upload z urządzenia: %d %v", c, out)
	}
	p := out["plugin"].(map[string]any)
	if p["source"] != SrcDevice || p["approved"] != false {
		t.Errorf("plugin = %v, chcę source=urządzenie approved=false", p)
	}
	wantRef := "Kobo (" + d1.ID + ")"
	if p["source_ref"] != wantRef {
		t.Errorf("source_ref = %v, chcę %q", p["source_ref"], wantRef)
	}
	sha := p["sha256"].(string)

	// AC2: nie da się przypisać przed akceptacją, ani nawet nadawcy, ani innemu.
	assign1 := "/api/admin/devices/" + d1.ID + "/plugins"
	if c, out := e.jsonDo(e.admin, "POST", assign1, map[string]any{"plugins": map[string]string{"kopad.koplugin": sha}}); c != 400 {
		t.Errorf("przypisanie przed akceptacją: %d %v, chcę 400", c, out)
	}

	// Akceptacja w panelu.
	c, out = e.jsonDo(e.admin, "POST", "/api/admin/plugins/"+sha+"/approve", nil)
	if c != 200 || out["plugin"].(map[string]any)["approved"] != true {
		t.Fatalf("approve: %d %v", c, out)
	}
	// Zły sha przy approve → 404.
	if c, _ := e.jsonDo(e.admin, "POST", "/api/admin/plugins/"+strings.Repeat("0", 64)+"/approve", nil); c != 404 {
		t.Errorf("approve nieznanej wersji: %d, chcę 404", c)
	}

	// AC1: po akceptacji można ją przypisać INNEMU urządzeniu i pobrać bez kabla.
	assign2 := "/api/admin/devices/" + d2.ID + "/plugins"
	if c, out := e.jsonDo(e.admin, "POST", assign2, map[string]any{"plugins": map[string]string{"kopad.koplugin": sha}}); c != 200 {
		t.Fatalf("przypisanie po akceptacji: %d %v", c, out)
	}
	e.jsonDo(tok2, "GET", "/api/v1/sync?plugins_allowed=1", nil) // zgoda czytnika
	if rec := e.do(tok2, "GET", "/api/v1/plugins/"+sha+".zip", nil, ""); rec.Code != 200 {
		t.Errorf("pobranie przez drugie urządzenie: %d, chcę 200", rec.Code)
	}

	// Zły token → 401.
	if c, _ := e.deviceUpload("zly-token", goodZip(t, "x.koplugin")); c != 401 {
		t.Errorf("upload złym tokenem: %d, chcę 401", c)
	}
	// Zły ZIP → 400, źródło się nie zmienia w magazynie admina.
	if c, out := e.deviceUpload(tok1, []byte("to nie zip")); c != 400 {
		t.Errorf("zły ZIP: %d %v, chcę 400", c, out)
	}
	// Ten sam ZIP wysłany drugi raz z urządzenia: ten sam sha, wciąż niezaakceptowany
	// staje się bez znaczenia (już zaakceptowany) — sanity check identyczności treści.
	c, out = e.deviceUpload(tok1, goodZip(t, "kopad.koplugin"))
	if c != 200 || out["plugin"].(map[string]any)["sha256"] != sha {
		t.Errorf("ponowny upload tej samej treści: %d %v", c, out)
	}
}

// TASK-20 AC1, AC2: gwiazdka — dodanie/usunięcie, walidacja klucza, widoczność
// w GET /api/admin/state (skąd czerpie ją panel dla obu zakładek).
func TestFavorites(t *testing.T) {
	e := newPluginEnv(t)

	// Zły klucz (brak prefiksu, zła postać) → 400, nic nie zapisane.
	for _, bad := range []string{"owner/repo", "gh:owner", "dir:foo", "dir:foo.koplugin/../x", "gh:" + strings.Repeat("a", 200) + "/x", ""} {
		if c, out := e.jsonDo(e.admin, "PUT", "/api/admin/plugins/favorites", map[string]string{"key": bad}); c != 400 {
			t.Errorf("PUT favorites klucz %q: %d %v, chcę 400", bad, c, out)
		}
	}
	if rec := e.do("", "PUT", "/api/admin/plugins/favorites", strings.NewReader(`{"key":"gh:a/b"}`), "application/json"); rec.Code != 401 {
		t.Errorf("PUT bez tokenu: %d, chcę 401", rec.Code)
	}

	// Dodanie dwóch (galeria + magazyn), potem GET /api/admin/state je widzi, posortowane.
	if c, out := e.jsonDo(e.admin, "PUT", "/api/admin/plugins/favorites", map[string]string{"key": "gh:koreader/plugin-example"}); c != 200 {
		t.Fatalf("PUT gh: %d %v", c, out)
	}
	if c, out := e.jsonDo(e.admin, "PUT", "/api/admin/plugins/favorites", map[string]string{"key": "dir:foo.koplugin"}); c != 200 {
		t.Fatalf("PUT dir: %d %v", c, out)
	}
	// Powtórne dodanie tego samego klucza — bez błędu, bez duplikatu.
	if c, out := e.jsonDo(e.admin, "PUT", "/api/admin/plugins/favorites", map[string]string{"key": "dir:foo.koplugin"}); c != 200 {
		t.Fatalf("PUT ponowny: %d %v", c, out)
	}
	_, st := e.jsonDo(e.admin, "GET", "/api/admin/state", nil)
	fav, _ := st["favorites"].([]any)
	if len(fav) != 2 || fav[0] != "dir:foo.koplugin" || fav[1] != "gh:koreader/plugin-example" {
		t.Errorf("favorites w state = %v", fav)
	}

	// Usunięcie jednego.
	if c, out := e.jsonDo(e.admin, "DELETE", "/api/admin/plugins/favorites", map[string]string{"key": "dir:foo.koplugin"}); c != 200 {
		t.Fatalf("DELETE: %d %v", c, out)
	}
	_, st = e.jsonDo(e.admin, "GET", "/api/admin/state", nil)
	fav, _ = st["favorites"].([]any)
	if len(fav) != 1 || fav[0] != "gh:koreader/plugin-example" {
		t.Errorf("favorites po DELETE = %v", fav)
	}
	// Usunięcie nieobecnego klucza — bez błędu (idempotentne).
	if c, out := e.jsonDo(e.admin, "DELETE", "/api/admin/plugins/favorites", map[string]string{"key": "dir:foo.koplugin"}); c != 200 {
		t.Errorf("DELETE ponowny: %d %v", c, out)
	}
	// Wtyczka o nazwie "favorites" w DELETE /api/admin/plugins/{sha} nie koliduje z trasą.
	if c, _ := e.jsonDo(e.admin, "DELETE", "/api/admin/plugins/"+strings.Repeat("0", 64), nil); c != 404 {
		t.Errorf("DELETE nieznanego sha: %d, chcę 404 (trasa favorites nie powinna go przechwycić)", c)
	}
}

// TASK-20 AC3: ulubione przechodzą przez eksport/import razem z resztą stanu.
func TestFavoritesExport(t *testing.T) {
	src, _, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := src.SetFavorite("gh:koreader/plugin-example", true); err != nil {
		t.Fatal(err)
	}
	if _, err := src.SetFavorite("dir:foo.koplugin", true); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := ExportArchive(src, &buf); err != nil {
		t.Fatal(err)
	}
	dst, _, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ImportArchive(dst, nil, &buf, false); err != nil {
		t.Fatal(err)
	}
	got := dst.Favorites()
	if len(got) != 2 || got[0] != "dir:foo.koplugin" || got[1] != "gh:koreader/plugin-example" {
		t.Errorf("favorites po imporcie = %v", got)
	}
}
