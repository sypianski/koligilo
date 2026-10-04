package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Galeria wtyczek z GitHuba (TASK-9). Serwer nie ufa GitHubowi bardziej niż
// zwykłemu uploadowi: zipball przechodzi przez tę samą walidację/normalizację
// co ZIP wgrany ręcznie (NormalizePluginZip w plugins.go), a wersja trafia do
// magazynu ze źródłem "galeria" i SourceRef "owner/repo@sha" — czyli
// zapisanym, niezmiennym commitem, nie ruchomą gałęzią.
//
// Cache wyników wyszukiwania leży w <dane>/gallery.json (TTL 24h) i jest
// jedynym źródłem dla GET /api/admin/gallery — samo wyszukiwanie po GitHubie
// robi tylko POST /api/admin/gallery/refresh (albo GET raz, gdy cache jest
// zupełnie pusty). Token GitHuba (KOLIGILO_GITHUB_TOKEN) jest opcjonalny:
// bez niego limit to 60 zapytań/h, więc dociąganie "najnowszego release" per
// repozytorium ucina się samo, gdy limit się kończy.

const (
	ghDefaultBase = "https://api.github.com"
	galleryMaxZip = 50 << 20 // limit zipballa z GitHuba
	galleryTTL    = 24 * time.Hour
	galleryPageSz = 30

	// Autor koligilo: jego wtyczki galeria pokazuje osobno, na samej górze
	// („Od autora koligilo”), niezależnie od gwiazdek — ogólne wyszukiwanie
	// bierze najwyżej 300 wyników na zapytanie, a te z 0–2 gwiazdkami wypadają.
	galleryPromotedOwner = "sypianski"
)

// GalleryRepo — jeden wpis w indeksie (appstore.koplugin nazywa to "cached plugin").
type GalleryRepo struct {
	Owner         string    `json:"owner"`
	Repo          string    `json:"repo"`
	FullName      string    `json:"full_name"`
	Description   string    `json:"description"`
	Stars         int       `json:"stars"`
	PushedAt      time.Time `json:"pushed_at"`
	DefaultBranch string    `json:"default_branch"`
	LatestRelease string    `json:"latest_release,omitempty"`
	HTMLURL       string    `json:"html_url,omitempty"`
	Promoted      bool      `json:"promoted,omitempty"`
}

type galleryCache struct {
	UpdatedAt time.Time     `json:"updated_at"`
	Repos     []GalleryRepo `json:"repos"`
}

// Gallery — klient GitHub API + cache na dysku. baseURL jest konfigurowalny,
// żeby testy mogły podstawić httptest.Server zamiast prawdziwego GitHuba.
type Gallery struct {
	st      *Store
	baseURL string
	rawURL  string // raw.githubusercontent.com; pusty = domyślny (gallery_tree.go)
	token   string
	// promoted: właściciel, którego wtyczki idą do sekcji „Od autora
	// koligilo” (pusty = brak sekcji; testy go nie ustawiają).
	promoted string
	hc       *http.Client
	path     string

	mu    sync.Mutex
	cache galleryCache

	// TASK-12: cache aktualizacji, osobny plik i osobny zamek (odświeżanie
	// aktualizacji robi dużo więcej zapytań do GitHuba niż odczyt z cache
	// repozytoriów, więc nie chcemy blokować GET /api/admin/gallery na czas
	// długiego sprawdzania).
	updMu   sync.Mutex
	upd     updatesCache
	updPath string
}

// GalleryUpdate — jeden wpis w GET /api/admin/gallery/updates: repozytorium z
// galerii, z którego zainstalowano co najmniej jedną wersję wtyczki, wraz z
// wynikiem porównania z najnowszym release'em (albo, gdy repo nie ma
// release'ów, z najnowszym commitem domyślnej gałęzi).
type GalleryUpdate struct {
	Repo            string    `json:"repo"`
	Dir             string    `json:"dir"` // katalog *.koplugin (dla aktualizacji SetDevicePlugins)
	Path            string    `json:"-"`   // ścieżka w repo (monorepo), do ponownej instalacji
	CurrentSHA      string    `json:"current_sha"`
	CurrentVersion  string    `json:"current_version,omitempty"`
	LatestSHA       string    `json:"latest_sha,omitempty"`
	LatestTag       string    `json:"latest_tag,omitempty"`
	PublishedAt     time.Time `json:"published_at,omitempty"`
	Changelog       string    `json:"changelog,omitempty"`
	HTMLURL         string    `json:"html_url,omitempty"`
	UpdateAvailable bool      `json:"update_available"`
	Error           string    `json:"error,omitempty"` // repo się nie sprawdziło (np. limit) — reszta pól z poprzedniego sprawdzenia
}

type updatesCache struct {
	UpdatedAt time.Time       `json:"updated_at"`
	Updates   []GalleryUpdate `json:"updates"`
}

func NewGallery(st *Store) *Gallery {
	g := &Gallery{
		st:       st,
		baseURL:  ghDefaultBase,
		promoted: galleryPromotedOwner,
		token:    os.Getenv("KOLIGILO_GITHUB_TOKEN"),
		hc:       &http.Client{Timeout: 20 * time.Second},
		path:     filepath.Join(filepath.Dir(st.path), "gallery.json"),
		updPath:  filepath.Join(filepath.Dir(st.path), "gallery-updates.json"),
	}
	g.loadCache()
	g.loadUpdatesCache()
	return g
}

func (g *Gallery) Cached() galleryCache {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.cache
}

func (g *Gallery) CachedUpdates() updatesCache {
	g.updMu.Lock()
	defer g.updMu.Unlock()
	return g.upd
}

func (g *Gallery) loadUpdatesCache() {
	b, err := os.ReadFile(g.updPath)
	if err != nil {
		return
	}
	var c updatesCache
	if json.Unmarshal(b, &c) == nil {
		g.upd = c
	}
}

func (g *Gallery) saveUpdatesCache() error {
	b, err := json.MarshalIndent(&g.upd, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(g.updPath), 0o700); err != nil {
		return err
	}
	tmp := g.updPath + ".tmp" + randHex(4)
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, g.updPath)
}

func (g *Gallery) loadCache() {
	b, err := os.ReadFile(g.path)
	if err != nil {
		return
	}
	var c galleryCache
	if json.Unmarshal(b, &c) == nil {
		g.cache = c
	}
}

func (g *Gallery) saveCache() error {
	b, err := json.MarshalIndent(&g.cache, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(g.path), 0o700); err != nil {
		return err
	}
	tmp := g.path + ".tmp" + randHex(4)
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, g.path)
}

// --- limit zapytań ---

var errGHNotFound = errors.New("nie ma takiego repozytorium, gałęzi ani commita na GitHubie")

type rateLimitError struct {
	resetAt  time.Time
	hasToken bool
}

func (e *rateLimitError) Error() string {
	hint := "bez tokena GitHuba limit to 60 zapytań/h — ustaw zmienną środowiskową KOLIGILO_GITHUB_TOKEN, żeby podnieść go do 5000/h"
	if e.hasToken {
		hint = "poczekaj na reset limitu"
	}
	return fmt.Sprintf("limit zapytań do GitHub API wyczerpany, reset o %s (%s)", e.resetAt.Local().Format("15:04:05"), hint)
}

func rateLimitErrorFrom(h http.Header, hasToken bool) error {
	resetAt := time.Now().Add(time.Minute)
	if v := h.Get("X-RateLimit-Reset"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			resetAt = time.Unix(n, 0)
		}
	}
	return &rateLimitError{resetAt: resetAt, hasToken: hasToken}
}

func galleryErrCode(err error) int {
	var rl *rateLimitError
	if errors.As(err, &rl) {
		return 429
	}
	if errors.Is(err, errGHNotFound) {
		return 404
	}
	return 502
}

// --- klient GitHub API ---

// doGet: GET do GitHub API, dekoduje JSON do out (o ile nie nil). Zwraca
// nagłówki odpowiedzi (nawet przy błędzie) — wołający czyta z nich
// X-RateLimit-Remaining, żeby dociągać dane, dopóki starcza limitu.
func (g *Gallery) doGet(p string, out any) (http.Header, error) {
	req, err := http.NewRequest("GET", g.baseURL+p, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if g.token != "" {
		req.Header.Set("Authorization", "Bearer "+g.token)
	}
	resp, err := g.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("żądanie do GitHub API nie powiodło się: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 5<<20))
	if err != nil {
		return resp.Header, err
	}
	switch {
	case resp.StatusCode == 429 || (resp.StatusCode == 403 && resp.Header.Get("X-RateLimit-Remaining") == "0"):
		return resp.Header, rateLimitErrorFrom(resp.Header, g.token != "")
	case resp.StatusCode == 404:
		return resp.Header, errGHNotFound
	case resp.StatusCode >= 300:
		var e struct {
			Message string `json:"message"`
		}
		json.Unmarshal(body, &e)
		if e.Message == "" {
			e.Message = resp.Status
		}
		return resp.Header, fmt.Errorf("GitHub API: %s", e.Message)
	}
	if out != nil {
		if err := json.Unmarshal(body, out); err != nil {
			return resp.Header, fmt.Errorf("zła odpowiedź GitHub API: %w", err)
		}
	}
	return resp.Header, nil
}

func rateRemaining(h http.Header) int {
	if h == nil {
		return -1
	}
	if v := h.Get("X-RateLimit-Remaining"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return -1
}

type ghSearchResp struct {
	Items []ghRepoItem `json:"items"`
}

type ghRepoItem struct {
	FullName string `json:"full_name"`
	Name     string `json:"name"`
	Owner    struct {
		Login string `json:"login"`
	} `json:"owner"`
	Description     string    `json:"description"`
	StargazersCount int       `json:"stargazers_count"`
	PushedAt        time.Time `json:"pushed_at"`
	DefaultBranch   string    `json:"default_branch"`
	HTMLURL         string    `json:"html_url"`
}

// search: strony wyników wyszukiwania repozytoriów (do 3×100), zatrzymuje się
// wcześniej, gdy strona zwróci mniej niż pełną setkę.
func (g *Gallery) search(query string, remaining *int) ([]GalleryRepo, error) {
	var out []GalleryRepo
	for pg := 1; pg <= 3; pg++ {
		p := fmt.Sprintf("/search/repositories?q=%s&sort=stars&order=desc&per_page=100&page=%d", url.QueryEscape(query), pg)
		var resp ghSearchResp
		hdr, err := g.doGet(p, &resp)
		if r := rateRemaining(hdr); r >= 0 {
			*remaining = r
		}
		if err != nil {
			return out, err
		}
		for _, it := range resp.Items {
			out = append(out, GalleryRepo{
				Owner: it.Owner.Login, Repo: it.Name, FullName: it.FullName,
				Description: clip(it.Description, 500), Stars: it.StargazersCount,
				PushedAt: it.PushedAt, DefaultBranch: it.DefaultBranch, HTMLURL: it.HTMLURL,
			})
		}
		if len(resp.Items) < 100 {
			break
		}
	}
	return out, nil
}

func (g *Gallery) latestReleaseTag(owner, repo string) (string, int, error) {
	var resp struct {
		TagName string `json:"tag_name"`
	}
	hdr, err := g.doGet(fmt.Sprintf("/repos/%s/%s/releases/latest", owner, repo), &resp)
	rem := rateRemaining(hdr)
	if errors.Is(err, errGHNotFound) {
		return "", rem, nil // brak release'ów to nie błąd
	}
	if err != nil {
		return "", rem, err
	}
	return resp.TagName, rem, nil
}

type ghRelease struct {
	TagName     string    `json:"tag_name"`
	PublishedAt time.Time `json:"published_at"`
	Body        string    `json:"body"`
	HTMLURL     string    `json:"html_url"`
}

// latestRelease (pełne dane, TASK-12): jak latestReleaseTag, ale zwraca też
// datę publikacji i treść release'u (changelog) — nil, gdy repo nie ma
// żadnego release'u (to nie jest błąd).
func (g *Gallery) latestRelease(owner, repo string) (*ghRelease, int, error) {
	var resp ghRelease
	hdr, err := g.doGet(fmt.Sprintf("/repos/%s/%s/releases/latest", owner, repo), &resp)
	rem := rateRemaining(hdr)
	if errors.Is(err, errGHNotFound) {
		return nil, rem, nil
	}
	if err != nil {
		return nil, rem, err
	}
	return &resp, rem, nil
}

// updateTargets: dla każdego repozytorium galerii reprezentowanego w
// magazynie wybiera "bieżącą" wersję (najświeżej dodaną) — to ona daje
// current_sha/current_version/dir/path w wyniku CheckUpdates. Repo z
// wieloma zainstalowanymi wtyczkami (monorepo) dostaje jeden wpis na
// repozytorium, licząc od jego ostatnio dodanej wtyczki — uproszczenie,
// bo GitHub API nie daje taniego sposobu porównania wielu wtyczek z tego
// samego repo naraz bez dodatkowych zapytań na każdą z osobna.
func updateTargets(versions []PluginVersion) map[string]PluginVersion {
	out := map[string]PluginVersion{}
	for _, v := range versions {
		if v.Source != SrcGallery {
			continue
		}
		at := strings.LastIndex(v.SourceRef, "@")
		if at <= 0 {
			continue
		}
		full := v.SourceRef[:at]
		sha := v.SourceRef[at+1:]
		if !gitShaRe.MatchString(sha) {
			continue
		}
		cur, ok := out[full]
		if !ok || v.Added.After(cur.Added) {
			out[full] = v
		}
	}
	return out
}

// CheckUpdates (TASK-12) sprawdza, dla każdego repozytorium galerii użytego w
// magazynie, czy jest nowszy release (albo, gdy repo nie ma release'ów,
// nowszy commit domyślnej gałęzi) niż sha przypięty w source_ref bieżącej
// wersji. Zapytania robi tylko dla repo faktycznie użytych (nie całej
// galerii) i przerywa, gdy limit GitHub API się kończy — wynik (nawet
// częściowy) trafia do cache na dysku.
func (g *Gallery) CheckUpdates() (int, error) {
	targets := updateTargets(g.st.ListPlugins())
	repos := make([]string, 0, len(targets))
	for full := range targets {
		repos = append(repos, full)
	}
	sort.Strings(repos)

	prevByRepo := map[string]GalleryUpdate{}
	for _, u := range g.CachedUpdates().Updates {
		prevByRepo[u.Repo] = u
	}

	remaining := 1000
	fresh := map[string]GalleryUpdate{}
	var firstErr error
	for _, full := range repos {
		if remaining <= 2 {
			break
		}
		u, rem, err := g.checkOneRepo(full, targets[full])
		if rem >= 0 {
			remaining = rem
		} else {
			remaining -= 2
		}
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			var rl *rateLimitError
			if errors.As(err, &rl) {
				break // limit wyczerpany — reszta zostaje przy ostatniej znanej wartości (jeśli była)
			}
			continue // repo się nie sprawdziło (np. skasowane) — pomiń, zostanie stara wartość z cache
		}
		fresh[full] = u
	}

	out := make([]GalleryUpdate, 0, len(repos))
	for _, full := range repos {
		if u, ok := fresh[full]; ok {
			out = append(out, u)
		} else if u, ok := prevByRepo[full]; ok {
			out = append(out, u) // nieodświeżone w tym przebiegu — zostaje ostatnia znana wartość
		}
	}

	g.updMu.Lock()
	g.upd = updatesCache{UpdatedAt: time.Now(), Updates: out}
	err := g.saveUpdatesCache()
	g.updMu.Unlock()
	if err != nil {
		return len(out), err
	}
	if len(fresh) == 0 && firstErr != nil {
		return len(out), firstErr
	}
	return len(out), nil
}

// checkOneRepo sprawdza jedno repozytorium galerii (release albo, w jego
// braku, commit domyślnej gałęzi) i zwraca gotowy GalleryUpdate. Zużywa 1-2
// zapytania do GitHub API.
func (g *Gallery) checkOneRepo(full string, cur PluginVersion) (GalleryUpdate, int, error) {
	parts := strings.SplitN(full, "/", 2)
	owner, repo := parts[0], parts[1]
	at := strings.LastIndex(cur.SourceRef, "@")
	curSHA := cur.SourceRef[at+1:]

	u := GalleryUpdate{
		Repo: full, Dir: cur.Dir, Path: cur.Path,
		CurrentSHA: curSHA, CurrentVersion: cur.Version,
		HTMLURL: "https://github.com/" + full,
	}
	rel, rem, err := g.latestRelease(owner, repo)
	if err != nil {
		return u, rem, err
	}
	var latestSHA string
	if rel != nil {
		u.LatestTag = rel.TagName
		u.PublishedAt = rel.PublishedAt
		u.Changelog = clip(rel.Body, 4000)
		if rel.HTMLURL != "" {
			u.HTMLURL = rel.HTMLURL
		}
		sha, err := g.ResolveSHA(owner, repo, rel.TagName)
		if err != nil {
			return u, -1, err
		}
		latestSHA = sha
	} else {
		sha, err := g.ResolveSHA(owner, repo, "")
		if err != nil {
			return u, -1, err
		}
		latestSHA = sha
	}
	u.LatestSHA = latestSHA
	u.UpdateAvailable = latestSHA != "" && latestSHA != curSHA
	if rem >= 0 {
		rem-- // druga runda zapytań (ResolveSHA) nie zwraca tu nagłówka — przybliżenie
	}
	return u, rem, nil
}

// Refresh odpytuje GitHub Search API (temat koreader-plugin + nazwy
// *koplugin*), scala i odduplikowuje wyniki po full_name, po czym dociąga
// najnowszy release dla każdego repo, dopóki starcza limitu zapytań. Wynik
// zapisuje do cache na dysku (nawet częściowy, jeśli limit padł w trakcie).
func (g *Gallery) Refresh() (int, error) {
	remaining := 1000
	var repos []GalleryRepo
	seen := map[string]bool{}
	queries := []string{"topic:koreader-plugin", "koplugin in:name"}
	if g.promoted != "" {
		u := "user:" + g.promoted + " fork:false "
		queries = append([]string{u + "topic:koreader-plugin", u + "koplugin in:name"}, queries...)
	}
	for _, q := range queries {
		items, err := g.search(q, &remaining)
		if err != nil {
			if len(repos) > 0 {
				break // częściowe wyniki (np. limit padł na drugim zapytaniu) lepsze niż żadne
			}
			return 0, err
		}
		for _, it := range items {
			if seen[strings.ToLower(it.FullName)] {
				continue
			}
			seen[strings.ToLower(it.FullName)] = true
			it.Promoted = g.promoted != "" && strings.EqualFold(it.Owner, g.promoted)
			repos = append(repos, it)
		}
	}
	// Polecane pierwsze, żeby to one dostały tag release, gdy limit API się kończy.
	sort.Slice(repos, func(i, j int) bool {
		if repos[i].Promoted != repos[j].Promoted {
			return repos[i].Promoted
		}
		return repos[i].Stars > repos[j].Stars
	})
	for i := range repos {
		if remaining <= 2 {
			break
		}
		tag, rem, err := g.latestReleaseTag(repos[i].Owner, repos[i].Repo)
		if rem >= 0 {
			remaining = rem
		} else {
			remaining--
		}
		if err == nil {
			repos[i].LatestRelease = tag
		}
		var rl *rateLimitError
		if errors.As(err, &rl) {
			break
		}
	}
	g.mu.Lock()
	g.cache = galleryCache{UpdatedAt: time.Now(), Repos: repos}
	err := g.saveCache()
	g.mu.Unlock()
	return len(repos), err
}

// defaultBranch: podpowiedź z cache, żeby nie płacić dodatkowym zapytaniem
// o /repos/{o}/{r}, kiedy repo jest już zindeksowane.
func (g *Gallery) defaultBranch(owner, repo string) string {
	g.mu.Lock()
	defer g.mu.Unlock()
	full := owner + "/" + repo
	for _, r := range g.cache.Repos {
		if strings.EqualFold(r.FullName, full) {
			return r.DefaultBranch
		}
	}
	return ""
}

// ResolveSHA zamienia ref (tag, gałąź, sha albo pusty = domyślna gałąź) na
// pełny SHA commita — instalacja zawsze przypina konkretny commit, nigdy
// ruchomą gałąź.
func (g *Gallery) ResolveSHA(owner, repo, ref string) (string, error) {
	if ref == "" {
		ref = g.defaultBranch(owner, repo)
		if ref == "" {
			var info struct {
				DefaultBranch string `json:"default_branch"`
			}
			if _, err := g.doGet(fmt.Sprintf("/repos/%s/%s", owner, repo), &info); err != nil {
				return "", err
			}
			ref = info.DefaultBranch
			if ref == "" {
				ref = "HEAD"
			}
		}
	}
	var c struct {
		SHA string `json:"sha"`
	}
	if _, err := g.doGet(fmt.Sprintf("/repos/%s/%s/commits/%s", owner, repo, url.PathEscape(ref)), &c); err != nil {
		return "", err
	}
	if c.SHA == "" {
		return "", errors.New("GitHub nie zwrócił sha commita")
	}
	return c.SHA, nil
}

// downloadZipball ściąga archiwum repozytorium przypięte do konkretnego sha
// (https://api.github.com/repos/{o}/{r}/zipball/{sha}) z limitem rozmiaru.
func (g *Gallery) downloadZipball(owner, repo, sha string) ([]byte, error) {
	req, err := http.NewRequest("GET", fmt.Sprintf("%s/repos/%s/%s/zipball/%s", g.baseURL, owner, repo, sha), nil)
	if err != nil {
		return nil, err
	}
	if g.token != "" {
		req.Header.Set("Authorization", "Bearer "+g.token)
	}
	resp, err := g.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("pobieranie zipballa nie powiodło się: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == 429 || (resp.StatusCode == 403 && resp.Header.Get("X-RateLimit-Remaining") == "0") {
		return nil, rateLimitErrorFrom(resp.Header, g.token != "")
	}
	if resp.StatusCode == 404 {
		return nil, errGHNotFound
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GitHub zwrócił %s przy pobieraniu zipballa", resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, galleryMaxZip+1))
	if err != nil {
		return nil, err
	}
	if len(data) > galleryMaxZip {
		return nil, fmt.Errorf("zipball repozytorium większy niż %d MB", galleryMaxZip>>20)
	}
	return data, nil
}

// --- repakowanie zipballa do formatu magazynu (task-6) ---

// findKopluginCandidates szuka katalogów *.koplugin z _meta.lua w środku,
// gdziekolwiek w zipballu (także w monorepo, np. KoInsight:
// plugins/koinsight.koplugin). Zwraca prefiks katalogu-korzenia zipballa
// (zawsze "owner-repo-sha") i listę kandydatów: pełną ścieżkę katalogu, albo
// "" jako oznaczenie specjalnego przypadku "_meta.lua leży w korzeniu
// repozytorium" (samo repo jest wtyczką).
func findKopluginCandidates(zr *zip.Reader) (topPrefix string, candidates []string, err error) {
	for _, f := range zr.File {
		name := strings.TrimSuffix(f.Name, "/")
		if name == "" {
			continue
		}
		topPrefix = strings.SplitN(name, "/", 2)[0]
		break
	}
	if topPrefix == "" {
		return "", nil, errors.New("pusty zipball repozytorium")
	}
	seen := map[string]bool{}
	for _, f := range zr.File {
		name := strings.TrimSuffix(f.Name, "/")
		if path.Base(name) != "_meta.lua" {
			continue
		}
		dir := path.Dir(name)
		if dir == topPrefix {
			if !seen[""] {
				seen[""] = true
				candidates = append(candidates, "")
			}
			continue
		}
		if strings.HasSuffix(dir, ".koplugin") && !seen[dir] {
			seen[dir] = true
			candidates = append(candidates, dir)
		}
	}
	sort.Strings(candidates)
	return topPrefix, candidates, nil
}

// candidateRel: ścieżka kandydata względem korzenia repo, do pokazania
// userowi i do porównania z parametrem "path" żądania instalacji.
func candidateRel(c, topPrefix string) string {
	if c == "" {
		return ""
	}
	return strings.TrimPrefix(c, topPrefix+"/")
}

// pluginDirFor ustala nazwę katalogu docelowego wtyczki w magazynie.
func pluginDirFor(chosen, repo string) (string, error) {
	if chosen == "" {
		if !strings.HasSuffix(strings.ToLower(repo), ".koplugin") {
			return "", fmt.Errorf("_meta.lua jest w korzeniu repozytorium, ale nazwa repo %q nie kończy się na .koplugin — nie da się jednoznacznie ustalić katalogu wtyczki", repo)
		}
		return repo, nil
	}
	return path.Base(chosen), nil
}

// repackPlugin przepakowuje pliki spod prefiksu (katalog *.koplugin w
// zipballu) do nowego ZIP-a z jednym katalogiem najwyższego poziomu o nazwie
// pluginDir. Wynik trafia dalej do AddPlugin/NormalizePluginZip — to ona
// pilnuje bezpieczeństwa nazw (checkZipName) i poprawności wtyczki.
func repackPlugin(zr *zip.Reader, prefix, pluginDir string) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	want := prefix + "/"
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		if !strings.HasPrefix(f.Name, want) {
			continue
		}
		rel := strings.TrimPrefix(f.Name, want)
		if rel == "" || strings.HasPrefix(rel, "__MACOSX/") || path.Base(rel) == ".DS_Store" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(io.LimitReader(rc, pluginMaxUnpacked+1))
		rc.Close()
		if err != nil {
			return nil, err
		}
		h := &zip.FileHeader{Name: pluginDir + "/" + rel, Method: zip.Deflate, Modified: time.Now()}
		h.SetMode(0o644)
		w, err := zw.CreateHeader(h)
		if err != nil {
			return nil, err
		}
		if _, err := w.Write(data); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// --- HTTP ---

func (s *Server) galleryRoutes(m *http.ServeMux) {
	if s.gal == nil {
		s.gal = NewGallery(s.st)
	}
	m.HandleFunc("GET /api/admin/gallery", s.admin(s.adminGalleryList))
	m.HandleFunc("POST /api/admin/gallery/refresh", s.admin(s.adminGalleryRefresh))
	m.HandleFunc("POST /api/admin/gallery/install", s.admin(s.adminGalleryInstall))
	m.HandleFunc("GET /api/admin/gallery/updates", s.admin(s.adminGalleryUpdatesList))
	m.HandleFunc("POST /api/admin/gallery/updates/check", s.admin(s.adminGalleryUpdatesCheck))
	m.HandleFunc("POST /api/admin/gallery/update", s.admin(s.adminGalleryUpdate))
}

// adminGalleryList: GET /api/admin/gallery?q=&sort=stars|updated&page= —
// czyta wyłącznie z cache. Gdy cache jeszcze nigdy nie był odświeżony, robi
// to raz sam (bo pusta galeria przy pierwszym uruchomieniu nie jest
// użyteczna); błąd tego jednorazowego odświeżenia trafia do pola "note",
// nie przerywa odpowiedzi.
func (s *Server) adminGalleryList(w http.ResponseWriter, r *http.Request) {
	g := s.gal
	c := g.Cached()
	note := ""
	if len(c.Repos) == 0 && c.UpdatedAt.IsZero() {
		if _, err := g.Refresh(); err != nil {
			note = "galeria jest pusta, a automatyczne odświeżenie się nie powiodło: " + err.Error()
		}
		c = g.Cached()
	}
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	filtered := make([]GalleryRepo, 0, len(c.Repos))
	promoted := []GalleryRepo{}
	for _, rp := range c.Repos {
		if q != "" && !strings.Contains(strings.ToLower(rp.FullName), q) && !strings.Contains(strings.ToLower(rp.Description), q) {
			continue
		}
		if rp.Promoted {
			promoted = append(promoted, rp)
			continue
		}
		filtered = append(filtered, rp)
	}
	sort.Slice(promoted, func(i, j int) bool { return promoted[i].PushedAt.After(promoted[j].PushedAt) })
	if r.URL.Query().Get("sort") == "updated" {
		sort.Slice(filtered, func(i, j int) bool { return filtered[i].PushedAt.After(filtered[j].PushedAt) })
	} else {
		sort.Slice(filtered, func(i, j int) bool { return filtered[i].Stars > filtered[j].Stars })
	}
	total := len(filtered)
	start := (page - 1) * galleryPageSz
	if start > total {
		start = total
	}
	end := start + galleryPageSz
	if end > total {
		end = total
	}
	out := map[string]any{
		"repos":      filtered[start:end],
		"promoted":   promoted, // osobna sekcja nad listą, poza stronicowaniem
		"total":      total,
		"page":       page,
		"updated_at": c.UpdatedAt,
	}
	switch {
	case note != "":
		out["note"] = note
	case c.UpdatedAt.IsZero():
		out["note"] = "galeria jeszcze nie odświeżona — wywołaj POST /api/admin/gallery/refresh"
	case time.Since(c.UpdatedAt) > galleryTTL:
		out["stale"] = true
	}
	writeJSON(w, 200, out)
}

func (s *Server) adminGalleryRefresh(w http.ResponseWriter, r *http.Request) {
	n, err := s.gal.Refresh()
	if err != nil {
		writeJSON(w, galleryErrCode(err), map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"repos": n, "updated_at": s.gal.Cached().UpdatedAt})
}

var repoRe = regexp.MustCompile(`^[A-Za-z0-9._-]{1,100}/[A-Za-z0-9._-]{1,100}$`)

// gitShaRe — sha commita w SourceRef ("owner/repo@sha"); to sha z GitHuba
// (git, zwykle 40 znaków), nie mylić z shaRe w plugins.go (sha256 zawartości
// ZIP-a wtyczki w magazynie, zawsze 64 znaki).
var gitShaRe = regexp.MustCompile(`^[0-9a-f]{7,40}$`)

// ambiguousCandidates: błąd zwracany zamiast pliku, kiedy repo ma więcej niż
// jeden katalog *.koplugin, a "path" nie wskazał jednoznacznie, który.
type ambiguousCandidates struct{ rels []string }

func (e *ambiguousCandidates) Error() string {
	return `wiele katalogów *.koplugin w repozytorium — podaj "path" z jednym z candidates`
}

// packGalleryPlugin (lokalne, bez sieci) znajduje kandydatów *.koplugin w już
// pobranym zipballu i repakuje wybranego (wantPath) do ZIP-a gotowego dla
// AddPlugin. Współdzielone przez POST /api/admin/gallery/install (task-9) i
// POST /api/admin/gallery/update (task-12) — ta sama logika wyboru
// kandydata, żeby aktualizacja z zapamiętanym Path działała identycznie jak
// pierwsza instalacja.
func packGalleryPlugin(zr *zip.Reader, repoName, wantPath string) ([]byte, string, string, error) {
	topPrefix, candidates, err := findKopluginCandidates(zr)
	if err != nil {
		return nil, "", "", err
	}
	if len(candidates) == 0 {
		return nil, "", "", errors.New("nie znaleziono katalogu *.koplugin z _meta.lua w repozytorium")
	}
	chosen := candidates[0]
	if len(candidates) > 1 {
		want := strings.Trim(strings.TrimSpace(wantPath), "/")
		found := false
		for _, c := range candidates {
			if candidateRel(c, topPrefix) == want {
				chosen, found = c, true
				break
			}
		}
		if !found {
			rels := make([]string, len(candidates))
			for i, c := range candidates {
				rel := candidateRel(c, topPrefix)
				if rel == "" {
					rel = "." // korzeń repozytorium
				}
				rels[i] = rel
			}
			return nil, "", "", &ambiguousCandidates{rels: rels}
		}
	}
	pluginDir, err := pluginDirFor(chosen, repoName)
	if err != nil {
		return nil, "", "", err
	}
	prefix := chosen
	if prefix == "" {
		prefix = topPrefix
	}
	repacked, err := repackPlugin(zr, prefix, pluginDir)
	if err != nil {
		return nil, "", "", err
	}
	return repacked, pluginDir, candidateRel(chosen, topPrefix), nil
}

// adminGalleryInstall: POST /api/admin/gallery/install
// {"repo":"owner/name","ref":"tag albo sha (opcjonalnie)","path":"do
// rozstrzygnięcia wielu kandydatów *.koplugin (opcjonalnie)"}.
func (s *Server) adminGalleryInstall(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Repo string `json:"repo"`
		Ref  string `json:"ref"`
		Path string `json:"path"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	in.Repo = strings.TrimSpace(in.Repo)
	if !repoRe.MatchString(in.Repo) {
		writeJSON(w, 400, map[string]string{"error": `pole "repo" musi mieć postać owner/nazwa`})
		return
	}
	parts := strings.SplitN(in.Repo, "/", 2)
	owner, repo := parts[0], parts[1]

	g := s.gal
	sha, err := g.ResolveSHA(owner, repo, strings.TrimSpace(in.Ref))
	if err != nil {
		writeJSON(w, galleryErrCode(err), map[string]string{"error": err.Error()})
		return
	}
	zipb, err := g.fetchRepoZip(owner, repo, sha, in.Path)
	if err != nil {
		writeJSON(w, galleryErrCode(err), map[string]string{"error": err.Error()})
		return
	}
	zr, err := zip.NewReader(bytes.NewReader(zipb), int64(len(zipb)))
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "zipball z GitHuba nie jest poprawnym ZIP-em: " + err.Error()})
		return
	}
	repacked, _, rel, err := packGalleryPlugin(zr, repo, in.Path)
	var amb *ambiguousCandidates
	switch {
	case errors.As(err, &amb):
		writeJSON(w, 400, map[string]any{"error": err.Error(), "candidates": amb.rels})
		return
	case err != nil:
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	v, err := s.st.AddPlugin(repacked, SrcGallery, owner+"/"+repo+"@"+sha, rel)
	var bz *badZip
	switch {
	case errors.As(err, &bz):
		writeJSON(w, 400, map[string]string{"error": bz.Error()})
	case err != nil:
		writeJSON(w, 500, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, 200, map[string]any{"plugin": v})
	}
}

// adminGalleryUpdatesList: GET /api/admin/gallery/updates — czyta wyłącznie z
// cache (jak adminGalleryList), z jednorazowym auto-sprawdzeniem, gdy cache
// jeszcze nigdy nie było liczone i jest co sprawdzać.
func (s *Server) adminGalleryUpdatesList(w http.ResponseWriter, r *http.Request) {
	g := s.gal
	c := g.CachedUpdates()
	note := ""
	if c.UpdatedAt.IsZero() && len(updateTargets(g.st.ListPlugins())) > 0 {
		if _, err := g.CheckUpdates(); err != nil {
			note = "sprawdzenie aktualizacji się nie powiodło: " + err.Error()
		}
		c = g.CachedUpdates()
	}
	out := map[string]any{"updates": c.Updates, "updated_at": c.UpdatedAt}
	if note != "" {
		out["note"] = note
	}
	writeJSON(w, 200, out)
}

func (s *Server) adminGalleryUpdatesCheck(w http.ResponseWriter, r *http.Request) {
	n, err := s.gal.CheckUpdates()
	if err != nil && n == 0 {
		writeJSON(w, galleryErrCode(err), map[string]string{"error": err.Error()})
		return
	}
	out := map[string]any{"updates": s.gal.CachedUpdates().Updates, "updated_at": s.gal.CachedUpdates().UpdatedAt}
	if err != nil {
		out["note"] = "sprawdzenie części repozytoriów się nie powiodło: " + err.Error()
	}
	writeJSON(w, 200, out)
}

// adminGalleryUpdate: POST /api/admin/gallery/update {"repo":"owner/name"} —
// instaluje najnowszy sha z ostatnio policzonych /api/admin/gallery/updates
// (ten sam Path co poprzednia wersja tego repo) i podmienia sha w stanie
// docelowym każdego urządzenia, które miało starą wersję tej wtyczki.
// Czytnik i tak poprosi o osobne potwierdzenie instalacji.
func (s *Server) adminGalleryUpdate(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Repo string `json:"repo"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	full := strings.TrimSpace(in.Repo)
	if !repoRe.MatchString(full) {
		writeJSON(w, 400, map[string]string{"error": `pole "repo" musi mieć postać owner/nazwa`})
		return
	}
	var upd *GalleryUpdate
	for _, u := range s.gal.CachedUpdates().Updates {
		if strings.EqualFold(u.Repo, full) {
			c := u
			upd = &c
			break
		}
	}
	if upd == nil {
		writeJSON(w, 400, map[string]string{"error": `brak danych o aktualizacji dla tego repozytorium — najpierw wywołaj POST /api/admin/gallery/updates/check`})
		return
	}
	if !upd.UpdateAvailable || upd.LatestSHA == "" {
		writeJSON(w, 400, map[string]string{"error": "brak dostępnej aktualizacji dla tego repozytorium"})
		return
	}
	parts := strings.SplitN(full, "/", 2)
	owner, repo := parts[0], parts[1]

	zipb, err := s.gal.fetchRepoZip(owner, repo, upd.LatestSHA, upd.Path)
	if err != nil {
		writeJSON(w, galleryErrCode(err), map[string]string{"error": err.Error()})
		return
	}
	zr, err := zip.NewReader(bytes.NewReader(zipb), int64(len(zipb)))
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "zipball z GitHuba nie jest poprawnym ZIP-em: " + err.Error()})
		return
	}
	repacked, _, rel, err := packGalleryPlugin(zr, repo, upd.Path)
	var amb *ambiguousCandidates
	switch {
	case errors.As(err, &amb):
		writeJSON(w, 400, map[string]any{"error": err.Error(), "candidates": amb.rels})
		return
	case err != nil:
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	v, err := s.st.AddPlugin(repacked, SrcGallery, full+"@"+upd.LatestSHA, rel)
	var bz *badZip
	switch {
	case errors.As(err, &bz):
		writeJSON(w, 400, map[string]string{"error": bz.Error()})
		return
	case err != nil:
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	devices, err := s.st.UpdateGalleryPluginSHA(v.Dir, full, v.SHA256)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"plugin": v, "devices": devices})
}
