package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"sync"
	"time"
)

// Duże repozytoria (monorepo aplikacji z wtyczką w podkatalogu, np.
// readest/readest → apps/readest.koplugin) mają zipballe po kilkaset MB —
// ponad galleryMaxZip. Dla nich zamiast zipballa pobieramy drzewo commita
// (jedno zapytanie do API) i tylko pliki wybranego katalogu *.koplugin
// z raw.githubusercontent.com (bez limitu API). Wynik to syntetyczny ZIP
// o tym samym układzie co zipball ("owner-repo-sha7/..."), więc dalej idzie
// przez packGalleryPlugin i NormalizePluginZip bez żadnych wyjątków.

const (
	ghDefaultRaw        = "https://raw.githubusercontent.com"
	galleryTreeRepoKB   = 20 << 10 // repo większe niż 20 MB → drzewo zamiast zipballa
	galleryTreeParallel = 8
)

type ghTree struct {
	Truncated bool `json:"truncated"`
	Tree      []struct {
		Path string `json:"path"`
		Mode string `json:"mode"`
		Type string `json:"type"`
		Size int64  `json:"size"`
	} `json:"tree"`
}

// fetchRepoZip zwraca archiwum repozytorium przypięte do sha: zwykły zipball
// dla małych repo, a dla dużych — syntetyczny ZIP z samą wtyczką.
func (g *Gallery) fetchRepoZip(owner, repo, sha, wantPath string) ([]byte, error) {
	var info struct {
		Size int64 `json:"size"` // KB
	}
	if _, err := g.doGet(fmt.Sprintf("/repos/%s/%s", owner, repo), &info); err == nil && info.Size > galleryTreeRepoKB {
		return g.pluginZipFromTree(owner, repo, sha, wantPath)
	}
	return g.downloadZipball(owner, repo, sha)
}

func (g *Gallery) pluginZipFromTree(owner, repo, sha, wantPath string) ([]byte, error) {
	var t ghTree
	if _, err := g.doGet(fmt.Sprintf("/repos/%s/%s/git/trees/%s?recursive=1", owner, repo, sha), &t); err != nil {
		return nil, err
	}
	if t.Truncated {
		return nil, fmt.Errorf("repozytorium %s/%s jest za duże nawet na listę plików GitHuba", owner, repo)
	}
	// Kandydaci jak w findKopluginCandidates: katalog *.koplugin z _meta.lua
	// albo _meta.lua w korzeniu ("").
	var cands []string
	for _, e := range t.Tree {
		if e.Type != "blob" || path.Base(e.Path) != "_meta.lua" {
			continue
		}
		if dir := path.Dir(e.Path); dir == "." {
			cands = append(cands, "")
		} else if strings.HasSuffix(dir, ".koplugin") {
			cands = append(cands, dir)
		}
	}
	chosen, ok := "", false
	if len(cands) == 1 {
		chosen, ok = cands[0], true
	} else {
		want := strings.Trim(strings.TrimSpace(wantPath), "/")
		for _, c := range cands {
			if c == want {
				chosen, ok = c, true
			}
		}
	}

	type file struct {
		path string
		data []byte
	}
	var files []*file
	var total int64
	for _, e := range t.Tree {
		inChosen := ok && (chosen == "" || strings.HasPrefix(e.Path, chosen+"/"))
		switch {
		case e.Type == "commit" && inChosen:
			return nil, fmt.Errorf("wtyczka zawiera submoduł git (%s) — nie da się jej zainstalować z galerii", e.Path)
		case e.Type != "blob":
			continue
		case e.Mode == "120000" && inChosen:
			return nil, fmt.Errorf("wtyczka zawiera dowiązanie symboliczne (%s)", e.Path)
		case inChosen:
			total += e.Size
			if total > pluginMaxUnpacked {
				return nil, fmt.Errorf("wtyczka większa niż %d MB", pluginMaxUnpacked>>20)
			}
			files = append(files, &file{path: e.Path})
		case path.Base(e.Path) == "_meta.lua" && (path.Dir(e.Path) == "." || strings.HasSuffix(path.Dir(e.Path), ".koplugin")):
			// Pozostali kandydaci: sama nazwa wystarczy, żeby packGalleryPlugin
			// zwrócił tę samą listę candidates co przy zipballu.
			files = append(files, &file{path: e.Path, data: []byte{}})
		}
	}

	// Pobieranie równoległe; pierwszy błąd przerywa całość.
	var (
		wg       sync.WaitGroup
		mu       sync.Mutex
		firstErr error
		sem      = make(chan struct{}, galleryTreeParallel)
	)
	for _, f := range files {
		if f.data != nil {
			continue
		}
		wg.Add(1)
		go func(f *file) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			data, err := g.rawFile(owner, repo, sha, f.path)
			mu.Lock()
			defer mu.Unlock()
			if err != nil && firstErr == nil {
				firstErr = err
			}
			f.data = data
		}(f)
	}
	wg.Wait()
	if firstErr != nil {
		return nil, firstErr
	}

	top := owner + "-" + repo + "-" + sha[:min(7, len(sha))]
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, f := range files {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: top + "/" + f.path, Method: zip.Deflate, Modified: time.Now()})
		if err != nil {
			return nil, err
		}
		if _, err := w.Write(f.data); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func (g *Gallery) rawFile(owner, repo, sha, p string) ([]byte, error) {
	base := g.rawURL
	if base == "" {
		base = ghDefaultRaw
	}
	segs := strings.Split(p, "/")
	for i, s := range segs {
		segs[i] = url.PathEscape(s)
	}
	req, err := http.NewRequest("GET", fmt.Sprintf("%s/%s/%s/%s/%s", base, owner, repo, sha, strings.Join(segs, "/")), nil)
	if err != nil {
		return nil, err
	}
	if g.token != "" {
		req.Header.Set("Authorization", "Bearer "+g.token)
	}
	resp, err := g.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("pobieranie %s nie powiodło się: %w", p, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GitHub zwrócił %s przy pobieraniu %s", resp.Status, p)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, pluginMaxUnpacked+1))
	if err != nil {
		return nil, err
	}
	if len(data) > pluginMaxUnpacked {
		return nil, fmt.Errorf("plik %s większy niż %d MB", p, pluginMaxUnpacked>>20)
	}
	return data, nil
}
