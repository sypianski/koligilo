package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

// galleryEnv: serwer koligilo + podstawiony fake GitHub (httptest.Server) w
// polu Gallery.baseURL, żeby testy nie dotykały sieci.
type galleryEnv struct {
	t     *testing.T
	s     *Server
	mux   http.Handler
	admin string
	gh    *httptest.Server
}

func newGalleryEnv(t *testing.T, ghHandler http.HandlerFunc) *galleryEnv {
	st, admin, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	gh := httptest.NewServer(ghHandler)
	t.Cleanup(gh.Close)
	s := &Server{st: st}
	s.gal = &Gallery{
		st:      st,
		baseURL: gh.URL,
		hc:      http.DefaultClient,
		path:    filepath.Join(filepath.Dir(st.path), "gallery.json"),
		updPath: filepath.Join(filepath.Dir(st.path), "gallery-updates.json"),
	}
	return &galleryEnv{t: t, s: s, mux: s.Routes(), admin: admin, gh: gh}
}

func (e *galleryEnv) jsonDo(method, path string, in any) (int, map[string]any) {
	var body []byte
	if in != nil {
		body, _ = json.Marshal(in)
	}
	r := httptest.NewRequest(method, path, strings.NewReader(string(body)))
	r.Header.Set("Authorization", "Bearer "+e.admin)
	r.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, r)
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// ghSearchItem — pomocniczy budowniczy wpisu wyszukiwania GitHuba w testach.
func ghSearchItem(owner, repo string, stars int, defaultBranch string) map[string]any {
	return map[string]any{
		"full_name":        owner + "/" + repo,
		"name":             repo,
		"owner":            map[string]string{"login": owner},
		"description":      "opis " + repo,
		"stargazers_count": stars,
		"pushed_at":        "2026-01-01T00:00:00Z",
		"default_branch":   defaultBranch,
		"html_url":         "https://github.com/" + owner + "/" + repo,
	}
}

// TASK-9 AC1: GET /api/admin/gallery zwraca wyniki z cache (z auto-odświeżeniem,
// gdy cache jest jeszcze pusty), posortowane malejąco po gwiazdkach.
func TestGalleryListAutoRefreshAndSort(t *testing.T) {
	e := newGalleryEnv(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/search/repositories"):
			w.Header().Set("X-RateLimit-Remaining", "59")
			items := []map[string]any{
				ghSearchItem("alice", "small.koplugin", 3, "main"),
				ghSearchItem("bob", "big.koplugin", 100, "main"),
			}
			json.NewEncoder(w).Encode(map[string]any{"total_count": len(items), "items": items})
		case strings.Contains(r.URL.Path, "/releases/latest"):
			w.WriteHeader(404)
			json.NewEncoder(w).Encode(map[string]string{"message": "Not Found"})
		default:
			t.Fatalf("nieoczekiwane żądanie do GH: %s", r.URL.String())
		}
	})
	code, out := e.jsonDo("GET", "/api/admin/gallery", nil)
	if code != 200 {
		t.Fatalf("GET gallery: %d %v", code, out)
	}
	repos, _ := out["repos"].([]any)
	if len(repos) != 2 {
		t.Fatalf("repos = %v", out)
	}
	first := repos[0].(map[string]any)
	if first["full_name"] != "bob/big.koplugin" || first["stars"].(float64) != 100 {
		t.Errorf("sortowanie po stars: %v", first)
	}
	// Drugi GET czyta już tylko z cache — nie odpytuje GH ponownie
	// (handler zwróciłby t.Fatal przy nieoczekiwanym żądaniu, jeśli by trafiło).
	code, out = e.jsonDo("GET", "/api/admin/gallery?q=small", nil)
	if code != 200 {
		t.Fatalf("GET gallery q=: %d %v", code, out)
	}
	repos, _ = out["repos"].([]any)
	if len(repos) != 1 || repos[0].(map[string]any)["full_name"] != "alice/small.koplugin" {
		t.Errorf("filtr q=: %v", out)
	}
}

// TASK-9 AC4: bez tokena, przy wyczerpanym limicie GitHub API, odświeżenie
// zwraca 429 z czytelnym komunikatem po polsku zawierającym godzinę resetu.
func TestGalleryRefreshRateLimit(t *testing.T) {
	e := newGalleryEnv(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-RateLimit-Remaining", "0")
		w.Header().Set("X-RateLimit-Reset", "9999999999") // daleka przyszłość, stabilne w testach
		w.WriteHeader(403)
		json.NewEncoder(w).Encode(map[string]string{"message": "API rate limit exceeded"})
	})
	code, out := e.jsonDo("POST", "/api/admin/gallery/refresh", nil)
	if code != 429 {
		t.Fatalf("refresh przy rate limit: %d %v", code, out)
	}
	msg, _ := out["error"].(string)
	if !strings.Contains(msg, "limit") || !strings.Contains(msg, "KOLIGILO_GITHUB_TOKEN") {
		t.Errorf("komunikat nie wygląda na czytelny po polsku: %q", msg)
	}
}

// ghInstallHandler: fake GitHub obsługujący ścieżkę instalacji (commits,
// zipball) dla jednego repo z zadaną zawartością zipballa.
func ghInstallHandler(t *testing.T, owner, repo, sha string, zipb []byte) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		switch {
		case p == fmt.Sprintf("/repos/%s/%s", owner, repo):
			json.NewEncoder(w).Encode(map[string]string{"default_branch": "main"})
		case strings.HasSuffix(p, "/commits/main"):
			json.NewEncoder(w).Encode(map[string]string{"sha": sha})
		case p == fmt.Sprintf("/repos/%s/%s/zipball/%s", owner, repo, sha):
			w.Header().Set("Content-Type", "application/zip")
			w.Write(zipb)
		default:
			t.Fatalf("nieoczekiwane żądanie do GH: %s", p)
		}
	}
}

// TASK-9 AC2 + AC3: instalacja z galerii repozytorium typu monorepo (KoInsight),
// gdzie *.koplugin leży głębiej niż korzeń, tworzy wpis w magazynie z
// owner/repo@sha.
func TestGalleryInstallMonorepo(t *testing.T) {
	const owner, repo, sha = "kolodz", "koinsight", "deadbeef1234567890deadbeef1234567890dead"
	top := owner + "-" + repo + "-" + sha[:7]
	zipb := mkZip(t,
		zent{name: top + "/plugins/koinsight.koplugin/_meta.lua", body: testMeta},
		zent{name: top + "/plugins/koinsight.koplugin/main.lua", body: "return {}"},
		zent{name: top + "/README.md", body: "readme"},
	)
	e := newGalleryEnv(t, ghInstallHandler(t, owner, repo, sha, zipb))
	code, out := e.jsonDo("POST", "/api/admin/gallery/install", map[string]string{"repo": owner + "/" + repo})
	if code != 200 {
		t.Fatalf("install monorepo: %d %v", code, out)
	}
	p, _ := out["plugin"].(map[string]any)
	if p["dir"] != "koinsight.koplugin" {
		t.Errorf("dir = %v", p["dir"])
	}
	if p["source"] != SrcGallery || p["source_ref"] != owner+"/"+repo+"@"+sha {
		t.Errorf("source/source_ref = %v / %v", p["source"], p["source_ref"])
	}
}

// TASK-9 AC3: repozytorium, w którym samo repo (nazwa kończąca się na
// .koplugin) jest wtyczką — _meta.lua w korzeniu zipballa.
func TestGalleryInstallRootPlugin(t *testing.T) {
	const owner, repo, sha = "someone", "foo.koplugin", "cafebabe1234567890cafebabe1234567890cafe"
	top := owner + "-" + repo + "-" + sha[:7]
	zipb := mkZip(t,
		zent{name: top + "/_meta.lua", body: testMeta},
		zent{name: top + "/main.lua", body: "return {}"},
	)
	e := newGalleryEnv(t, ghInstallHandler(t, owner, repo, sha, zipb))
	code, out := e.jsonDo("POST", "/api/admin/gallery/install", map[string]string{"repo": owner + "/" + repo})
	if code != 200 {
		t.Fatalf("install root plugin: %d %v", code, out)
	}
	p, _ := out["plugin"].(map[string]any)
	if p["dir"] != "foo.koplugin" {
		t.Errorf("dir = %v", p["dir"])
	}
}

// TASK-9 AC3: dwaj kandydaci *.koplugin → 400 z listą, potem instalacja z
// jawnie podanym "path" rozstrzyga.
func TestGalleryInstallAmbiguous(t *testing.T) {
	const owner, repo, sha = "multi", "repo", "1234567890abcdef1234567890abcdef12345678"
	top := owner + "-" + repo + "-" + sha[:7]
	zipb := mkZip(t,
		zent{name: top + "/plugins/a.koplugin/_meta.lua", body: testMeta},
		zent{name: top + "/plugins/a.koplugin/main.lua", body: ""},
		zent{name: top + "/plugins/b.koplugin/_meta.lua", body: testMeta},
		zent{name: top + "/plugins/b.koplugin/main.lua", body: ""},
	)
	e := newGalleryEnv(t, ghInstallHandler(t, owner, repo, sha, zipb))
	code, out := e.jsonDo("POST", "/api/admin/gallery/install", map[string]string{"repo": owner + "/" + repo})
	if code != 400 {
		t.Fatalf("install wieloznaczny: %d %v", code, out)
	}
	cands, _ := out["candidates"].([]any)
	if len(cands) != 2 {
		t.Fatalf("candidates = %v", out)
	}
	code, out = e.jsonDo("POST", "/api/admin/gallery/install", map[string]string{
		"repo": owner + "/" + repo, "path": "plugins/b.koplugin",
	})
	if code != 200 {
		t.Fatalf("install z path: %d %v", code, out)
	}
	p, _ := out["plugin"].(map[string]any)
	if p["dir"] != "b.koplugin" {
		t.Errorf("dir = %v", p["dir"])
	}
}

// ghUpdatesHandler: fake GitHub obsługujący zarówno instalację (task-9) jak i
// sprawdzanie/aplikowanie aktualizacji (task-12) dla jednego repo.
// releaseTag == "" → repo bez release'ów (porównanie po commitach gałęzi).
func ghUpdatesHandler(t *testing.T, owner, repo, oldSha, newSha, releaseTag string, oldZip, newZip []byte) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		switch {
		case p == fmt.Sprintf("/repos/%s/%s", owner, repo):
			json.NewEncoder(w).Encode(map[string]string{"default_branch": "main"})
		case strings.HasSuffix(p, "/releases/latest"):
			if releaseTag == "" {
				w.WriteHeader(404)
				json.NewEncoder(w).Encode(map[string]string{"message": "Not Found"})
				return
			}
			json.NewEncoder(w).Encode(map[string]any{
				"tag_name": releaseTag, "published_at": "2026-05-01T12:00:00Z",
				"body": "## Changelog\n- coś naprawiono", "html_url": "https://github.com/" + owner + "/" + repo + "/releases/" + releaseTag,
			})
		case strings.HasSuffix(p, "/commits/"+releaseTag) && releaseTag != "":
			json.NewEncoder(w).Encode(map[string]string{"sha": newSha})
		case strings.HasSuffix(p, "/commits/main"):
			json.NewEncoder(w).Encode(map[string]string{"sha": newSha})
		case p == fmt.Sprintf("/repos/%s/%s/zipball/%s", owner, repo, oldSha):
			w.Write(oldZip)
		case p == fmt.Sprintf("/repos/%s/%s/zipball/%s", owner, repo, newSha):
			w.Write(newZip)
		default:
			t.Fatalf("nieoczekiwane żądanie do GH: %s", p)
		}
	}
}

// TASK-12 AC1: release nowszy niż sha zainstalowanej wersji → update_available
// z datą i changelogiem; POST /api/admin/gallery/update instaluje nowy sha i
// podmienia go w stanie docelowym urządzenia, które miało starą wersję.
func TestGalleryUpdatesReleaseAvailable(t *testing.T) {
	const owner, repo, oldSha, newSha = "own", "plug.koplugin", "1111111111111111111111111111111111baaa", "2222222222222222222222222222222222dead"
	oldZip := mkZip(t,
		zent{name: owner + "-" + repo + "-" + oldSha[:7] + "/_meta.lua", body: testMeta},
		zent{name: owner + "-" + repo + "-" + oldSha[:7] + "/main.lua", body: "return {}"},
	)
	// treść inna niż oldZip (wersja 1.3), żeby dostać INNY sha256 wtyczki —
	// inaczej AddPlugin (adresowanie treścią) zwróciłoby istniejący wpis ze
	// starym source_ref zamiast utworzyć nowy.
	newMeta := strings.Replace(testMeta, "version = 1.2,", "version = 1.3,", 1)
	newZip := mkZip(t,
		zent{name: owner + "-" + repo + "-" + newSha[:7] + "/_meta.lua", body: newMeta},
		zent{name: owner + "-" + repo + "-" + newSha[:7] + "/main.lua", body: "return {}"},
	)
	e := newGalleryEnv(t, ghInstallHandler(t, owner, repo, oldSha, oldZip))
	code, out := e.jsonDo("POST", "/api/admin/gallery/install", map[string]string{"repo": owner + "/" + repo})
	if code != 200 {
		t.Fatalf("install: %d %v", code, out)
	}
	p, _ := out["plugin"].(map[string]any)
	oldPluginSHA := p["sha256"].(string)

	// urządzenie ma przypisaną starą wersję
	d, _, err := e.s.st.Provision("czytnik", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := e.s.st.SetDevicePlugins(d.ID, map[string]string{"plug.koplugin": oldPluginSHA}); err != nil {
		t.Fatalf("przypisanie starej wersji: %v", err)
	}

	e.gh.Config.Handler = ghUpdatesHandler(t, owner, repo, oldSha, newSha, "v1.3", oldZip, newZip)

	code, out = e.jsonDo("POST", "/api/admin/gallery/updates/check", nil)
	if code != 200 {
		t.Fatalf("updates/check: %d %v", code, out)
	}
	ups, _ := out["updates"].([]any)
	if len(ups) != 1 {
		t.Fatalf("updates = %v", out)
	}
	u := ups[0].(map[string]any)
	if u["repo"] != owner+"/"+repo || u["update_available"] != true {
		t.Fatalf("update entry: %v", u)
	}
	if u["latest_tag"] != "v1.3" || u["published_at"] == nil || u["changelog"] == "" {
		t.Errorf("brak daty/changelogu release'u: %v", u)
	}

	code, out = e.jsonDo("GET", "/api/admin/gallery/updates", nil)
	if code != 200 {
		t.Fatalf("GET updates: %d %v", code, out)
	}
	ups2, _ := out["updates"].([]any)
	if len(ups2) != 1 {
		t.Fatalf("GET updates cache: %v", out)
	}

	code, out = e.jsonDo("POST", "/api/admin/gallery/update", map[string]string{"repo": owner + "/" + repo})
	if code != 200 {
		t.Fatalf("update: %d %v", code, out)
	}
	np, _ := out["plugin"].(map[string]any)
	if np["source_ref"] != owner+"/"+repo+"@"+newSha {
		t.Errorf("nowa wersja source_ref = %v", np["source_ref"])
	}
	devs, _ := out["devices"].([]any)
	if len(devs) != 1 || devs[0] != d.Name {
		t.Errorf("zmienione urządzenia = %v", out["devices"])
	}
	// stan docelowy urządzenia wskazuje teraz nowy sha
	got := e.s.st.S.Devices[d.ID].Plugins["plug.koplugin"]
	if got != np["sha256"] {
		t.Errorf("stan docelowy urządzenia nie podmieniony: %v != %v", got, np["sha256"])
	}
}

// TASK-12: repo bez release'ów porównuje commit domyślnej gałęzi; brak
// nowego commita → update_available=false.
func TestGalleryUpdatesNoReleaseComparesCommits(t *testing.T) {
	const owner, repo, sha = "noreleases", "plug.koplugin", "3333333333333333333333333333333333cafe"
	zipb := mkZip(t,
		zent{name: owner + "-" + repo + "-" + sha[:7] + "/_meta.lua", body: testMeta},
		zent{name: owner + "-" + repo + "-" + sha[:7] + "/main.lua", body: "return {}"},
	)
	e := newGalleryEnv(t, ghInstallHandler(t, owner, repo, sha, zipb))
	code, out := e.jsonDo("POST", "/api/admin/gallery/install", map[string]string{"repo": owner + "/" + repo})
	if code != 200 {
		t.Fatalf("install: %d %v", code, out)
	}
	e.gh.Config.Handler = ghUpdatesHandler(t, owner, repo, sha, sha, "", zipb, zipb)
	code, out = e.jsonDo("POST", "/api/admin/gallery/updates/check", nil)
	if code != 200 {
		t.Fatalf("updates/check: %d %v", code, out)
	}
	ups, _ := out["updates"].([]any)
	if len(ups) != 1 {
		t.Fatalf("updates = %v", out)
	}
	u := ups[0].(map[string]any)
	if u["update_available"] != false {
		t.Errorf("update_available powinno być false: %v", u)
	}
}

// TASK-12 AC "429 czytelnie": limit GitHuba wyczerpany podczas sprawdzania
// aktualizacji zwraca 429 z czytelnym komunikatem (jak refresh galerii).
func TestGalleryUpdatesCheckRateLimit(t *testing.T) {
	const owner, repo, sha = "limited", "plug.koplugin", "4444444444444444444444444444444444beef"
	zipb := mkZip(t,
		zent{name: owner + "-" + repo + "-" + sha[:7] + "/_meta.lua", body: testMeta},
		zent{name: owner + "-" + repo + "-" + sha[:7] + "/main.lua", body: "return {}"},
	)
	e := newGalleryEnv(t, ghInstallHandler(t, owner, repo, sha, zipb))
	code, out := e.jsonDo("POST", "/api/admin/gallery/install", map[string]string{"repo": owner + "/" + repo})
	if code != 200 {
		t.Fatalf("install: %d %v", code, out)
	}
	e.gh.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-RateLimit-Remaining", "0")
		w.Header().Set("X-RateLimit-Reset", "9999999999")
		w.WriteHeader(403)
		json.NewEncoder(w).Encode(map[string]string{"message": "API rate limit exceeded"})
	})
	code, out = e.jsonDo("POST", "/api/admin/gallery/updates/check", nil)
	if code != 429 {
		t.Fatalf("updates/check przy rate limit: %d %v", code, out)
	}
	msg, _ := out["error"].(string)
	if !strings.Contains(msg, "limit") {
		t.Errorf("komunikat nie wygląda na czytelny: %q", msg)
	}
}

// Duże monorepo (readest/readest, ~300 MB): zamiast zipballa drzewo commita
// i pliki samej wtyczki z raw.githubusercontent.com (gallery_tree.go).
func TestGalleryInstallLargeRepoViaTree(t *testing.T) {
	const owner, repo, sha = "readest", "readest", "abcdef1234567890abcdef1234567890abcdef12"
	raw := map[string]string{
		"apps/readest.koplugin/_meta.lua":       testMeta,
		"apps/readest.koplugin/main.lua":        "return {}",
		"apps/readest.koplugin/library/a b.lua": "return 1",
	}
	var e *galleryEnv
	e = newGalleryEnv(t, func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		switch {
		case p == fmt.Sprintf("/repos/%s/%s", owner, repo):
			json.NewEncoder(w).Encode(map[string]any{"default_branch": "main", "size": 300000})
		case strings.HasSuffix(p, "/commits/main"):
			json.NewEncoder(w).Encode(map[string]string{"sha": sha})
		case p == fmt.Sprintf("/repos/%s/%s/git/trees/%s", owner, repo, sha):
			tree := []map[string]any{
				{"path": "apps", "type": "tree", "mode": "040000"},
				{"path": "README.md", "type": "blob", "mode": "100644", "size": 10},
				{"path": "apps/web/huge.bin", "type": "blob", "mode": "100644", "size": 900 << 20},
			}
			for fp, body := range raw {
				tree = append(tree, map[string]any{"path": fp, "type": "blob", "mode": "100644", "size": len(body)})
			}
			json.NewEncoder(w).Encode(map[string]any{"tree": tree})
		case strings.HasPrefix(p, fmt.Sprintf("/raw/%s/%s/%s/", owner, repo, sha)):
			fp := strings.TrimPrefix(p, fmt.Sprintf("/raw/%s/%s/%s/", owner, repo, sha))
			body, ok := raw[fp]
			if !ok {
				t.Errorf("pobrano plik spoza wtyczki: %s", fp)
				http.NotFound(w, r)
				return
			}
			w.Write([]byte(body))
		default:
			t.Errorf("nieoczekiwane żądanie do GH: %s", p)
			http.NotFound(w, r)
		}
	})
	e.s.gal.rawURL = e.gh.URL + "/raw"
	code, out := e.jsonDo("POST", "/api/admin/gallery/install", map[string]string{"repo": owner + "/" + repo})
	if code != 200 {
		t.Fatalf("install dużego repo: %d %v", code, out)
	}
	p, _ := out["plugin"].(map[string]any)
	if p["dir"] != "readest.koplugin" || p["source_ref"] != owner+"/"+repo+"@"+sha {
		t.Errorf("dir/source_ref = %v / %v", p["dir"], p["source_ref"])
	}
}

// Wtyczki autora koligilo (Gallery.promoted) idą osobną listą "promoted" nad
// stronicowaną listą społeczności — niezależnie od gwiazdek.
func TestGalleryPromotedOwner(t *testing.T) {
	var queries []string
	e := newGalleryEnv(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/search/repositories"):
			q := r.URL.Query().Get("q")
			queries = append(queries, q)
			items := []map[string]any{ghSearchItem("bob", "big.koplugin", 100, "main")}
			if strings.HasPrefix(q, "user:me ") {
				items = []map[string]any{ghSearchItem("me", "mine.koplugin", 0, "main")}
			}
			json.NewEncoder(w).Encode(map[string]any{"total_count": len(items), "items": items})
		case strings.Contains(r.URL.Path, "/releases/latest"):
			w.WriteHeader(404)
		default:
			t.Fatalf("nieoczekiwane żądanie do GH: %s", r.URL.String())
		}
	})
	e.s.gal.promoted = "me"
	code, out := e.jsonDo("GET", "/api/admin/gallery", nil)
	if code != 200 {
		t.Fatalf("GET gallery: %d %v", code, out)
	}
	if len(queries) < 3 || !strings.HasPrefix(queries[0], "user:me ") {
		t.Errorf("zapytania: %q", queries)
	}
	prom, _ := out["promoted"].([]any)
	if len(prom) != 1 || prom[0].(map[string]any)["full_name"] != "me/mine.koplugin" {
		t.Fatalf("promoted = %v", out["promoted"])
	}
	repos, _ := out["repos"].([]any)
	if len(repos) != 1 || repos[0].(map[string]any)["full_name"] != "bob/big.koplugin" {
		t.Errorf("repos (bez polecanych) = %v", repos)
	}
	_, out = e.jsonDo("GET", "/api/admin/gallery?q=big", nil)
	if prom, _ := out["promoted"].([]any); len(prom) != 0 {
		t.Errorf("filtr q= nie objął polecanych: %v", prom)
	}
}
