package main

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
)

// Dane katalogu: każdy wpis musi dać się przyjąć przez AddFont i nie może kolidować nazwą.
func TestFontCatalogIntegrity(t *testing.T) {
	commit := regexp.MustCompile(`^/[^/]+/[^/]+/[0-9a-f]{40}/`)
	ids, files := map[string]bool{}, map[string]string{}
	starters := 0
	for _, f := range fontCatalog {
		if ids[f.ID] || f.Name == "" || f.License != "OFL-1.1" || f.Description == "" || f.Scripts == "" {
			t.Errorf("rodzina %q: powtórzone ID albo brak pól/licencji", f.ID)
		}
		ids[f.ID] = true
		if f.Starter {
			starters++
		}
		if !strings.HasPrefix(f.Source, "https://github.com/") {
			t.Errorf("%s: źródło %q", f.ID, f.Source)
		}
		if len(f.Fonts) != 4 {
			t.Errorf("%s: %d stylów, chcę 4 (Regular, Italic, Bold, BoldItalic)", f.ID, len(f.Fonts))
		}
		for _, c := range f.Fonts {
			u, err := url.Parse(c.URL)
			if err != nil || u.Scheme != "https" || u.Host != "raw.githubusercontent.com" || !commit.MatchString(u.Path) {
				t.Errorf("%s: adres %q nie jest przypięty do commita na dozwolonym hoście", c.File, c.URL)
			}
			if !shaRe.MatchString(c.SHA256) || c.Size < 12 || c.Size > fontMaxSize || checkFontName(c.File) != nil {
				t.Errorf("%s: zła suma, rozmiar albo nazwa", c.File)
			}
			if prev, dup := files[strings.ToLower(c.File)]; dup {
				t.Errorf("nazwa %s w %s i %s — kolidowałyby na czytniku", c.File, prev, f.ID)
			}
			files[strings.ToLower(c.File)] = f.ID
		}
	}
	if starters == 0 || starters > 4 {
		t.Errorf("zestaw startowy: %d rodzin", starters)
	}
}

type catEnv struct {
	*pluginEnv
	hits *int32
	srv  *httptest.Server
	body map[string][]byte // ścieżka → treść
}

// newCatEnv: serwer udający hosta czcionek i katalog z jedną rodziną dwóch stylów.
func newCatEnv(t *testing.T) *catEnv {
	e := &catEnv{pluginEnv: newPluginEnv(t), hits: new(int32), body: map[string][]byte{}}
	e.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(e.hits, 1)
		if r.URL.Path == "/redir" {
			http.Redirect(w, r, "http://evil.example/x.ttf", 302)
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
	oldList, oldHosts, oldHTTP := fontCatalogList, fontAllowedHosts, fontTestHTTP
	fontAllowedHosts, fontTestHTTP = map[string]bool{host: true}, true
	t.Cleanup(func() {
		e.srv.Close()
		fontCatalogList, fontAllowedHosts, fontTestHTTP = oldList, oldHosts, oldHTTP
	})
	mk := func(name, tag string) CatalogFont {
		b := fakeFont("\x00\x01\x00\x00", tag[0])
		e.body["/x/y/"+name] = b
		sum := sha256.Sum256(b)
		return CatalogFont{File: name, URL: e.srv.URL + "/x/y/" + name, SHA256: hex.EncodeToString(sum[:]), Size: int64(len(b))}
	}
	fontCatalogList = []FontFamily{
		{ID: "ok", Name: "Dobra", License: "OFL-1.1", Starter: true, Fonts: []CatalogFont{mk("Dobra-Regular.ttf", "a"), mk("Dobra-Bold.ttf", "b")}},
		{ID: "zla-suma", Name: "Zła", License: "OFL-1.1", Fonts: []CatalogFont{mk("Zla-Regular.ttf", "c")}},
		{ID: "obcy-host", Name: "Obca", License: "OFL-1.1", Fonts: []CatalogFont{{File: "Obca.ttf", URL: "https://evil.example/Obca.ttf", SHA256: strings.Repeat("a", 64), Size: 100}}},
		{ID: "redirect", Name: "Przekierowana", License: "OFL-1.1", Fonts: []CatalogFont{{File: "Redir.ttf", URL: e.srv.URL + "/redir", SHA256: strings.Repeat("b", 64), Size: 100}}},
	}
	// zły sha: serwer oddaje inne bajty niż w katalogu
	e.body["/x/y/Zla-Regular.ttf"] = fakeFont("\x00\x01\x00\x00", 'Z')
	return e
}

func TestFontCatalogAdd(t *testing.T) {
	e := newCatEnv(t)
	c, out := e.jsonDo(e.admin, "GET", "/api/admin/font-catalog", nil)
	fams, _ := out["families"].([]any)
	if c != 200 || len(fams) != 4 {
		t.Fatalf("katalog: %d %v", c, out)
	}
	first := fams[0].(map[string]any)
	if first["id"] != "ok" || first["have"] != float64(0) || first["files"] != float64(2) || first["starter"] != true {
		t.Fatalf("wpis katalogu: %v", first)
	}

	c, out = e.jsonDo(e.admin, "POST", "/api/admin/font-catalog/ok", nil)
	if c != 200 || out["added"] != float64(2) || out["had"] != float64(0) {
		t.Fatalf("dodanie: %d %v", c, out)
	}
	list := e.s.st.ListFonts()
	if len(list) != 2 || !list[0].Approved || list[0].Source != SrcCatalog || list[0].SourceRef != "Dobra" || !list[0].Active {
		t.Fatalf("magazyn po dodaniu: %+v", list)
	}
	// Drugi raz: nic nie pobiera.
	before := atomic.LoadInt32(e.hits)
	if c, out = e.jsonDo(e.admin, "POST", "/api/admin/font-catalog/ok", nil); c != 200 || out["added"] != float64(0) || out["had"] != float64(2) {
		t.Fatalf("ponowne dodanie: %d %v", c, out)
	}
	if atomic.LoadInt32(e.hits) != before {
		t.Error("ponowne dodanie znów pobierało pliki")
	}
	if _, out = e.jsonDo(e.admin, "GET", "/api/admin/font-catalog", nil); out["families"].([]any)[0].(map[string]any)["have"] != float64(2) {
		t.Errorf("have po dodaniu: %v", out)
	}
	// Dodana z katalogu trafia do celu czytnika za zgodą.
	_, tok, _ := e.s.st.Provision("Kobo", "", "", "")
	if fs, _ := e.syncFonts(tok, true)["fonts"].([]any); len(fs) != 2 {
		t.Errorf("cel czytnika: %v", fs)
	}
}

func TestFontCatalogRejects(t *testing.T) {
	e := newCatEnv(t)
	for _, id := range []string{"zla-suma", "obcy-host", "redirect"} {
		c, out := e.jsonDo(e.admin, "POST", "/api/admin/font-catalog/"+id, nil)
		if c != 502 {
			t.Errorf("%s: %d %v, chcę 502", id, c, out)
		}
	}
	if n := len(e.s.st.ListFonts()); n != 0 {
		t.Errorf("odrzucone pliki trafiły do magazynu: %d", n)
	}
	if c, _ := e.jsonDo(e.admin, "POST", "/api/admin/font-catalog/nie-ma", nil); c != 404 {
		t.Errorf("nieznana rodzina: %d", c)
	}
	// Obcy host nie jest w ogóle odpytywany, przekierowanie nie jest wykonywane.
	if rec := e.do("zly", "POST", "/api/admin/font-catalog/ok", nil, ""); rec.Code != 401 {
		t.Errorf("zły token: %d", rec.Code)
	}
	// Czcionka wcześniej wysłana z czytnika, potem potwierdzona przez katalog.
	cf := fontCatalogList[0].Fonts[0]
	if _, err := e.s.st.AddFont(e.body["/x/y/"+cf.File], cf.File, SrcDevice, "Kobo"); err != nil {
		t.Fatal(err)
	}
	if c, out := e.jsonDo(e.admin, "POST", "/api/admin/font-catalog/ok", nil); c != 200 || out["added"] != float64(2) {
		t.Fatalf("dodanie po wersji z czytnika: %d %v", c, out)
	}
	for _, f := range e.s.st.ListFonts() {
		if !f.Approved {
			t.Errorf("%s nadal niezaakceptowana", f.File)
		}
	}
}
