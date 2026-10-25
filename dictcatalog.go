package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

// Katalog słowników z listy KOReadera (TASK-55, PC-020). Dane generuje
// scripts/dict-catalog.py do dictcatalog.json (wbudowane przez go:embed).
//
// Inaczej niż katalog czcionek (TASK-37) NIE przypina sum sha256: adresy KOReadera
// to w większości „releases/latest/download/…”, czyli ruchomy cel. Zaufanie
// opiera się więc na liście hostów, https, braku przekierowań poza listę,
// twardych limitach i walidacji zawartości (StarDict, bez plików wykonywalnych),
// a suma jest liczona przy pobraniu i od tej chwili identyfikuje wersję.
//
// Serwer pobiera WYŁĄCZNIE adresy z katalogu, nigdy podane z panelu — panel nie
// staje się otwartym proxy (SSRF).

//go:embed dictcatalog.json
var dictCatalogJSON []byte

type CatalogDict struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Folder  string `json:"folder"` // nazwa katalogu na czytniku
	LangIn  string `json:"lang_in"`
	LangOut string `json:"lang_out"`
	Entries int    `json:"entries"`
	License string `json:"license"`
	URL     string `json:"url"`
	Origin  string `json:"origin"` // koreader | wikdict | koreader-dicts
}

type dictCatalogDoc struct {
	Source struct {
		Repo      string `json:"repo"`
		Ref       string `json:"ref"`
		Generated string `json:"generated"`
	} `json:"source"`
	Dicts []CatalogDict `json:"dicts"`
}

// Zmienne tylko po to, by testy mogły podstawić własny serwer.
var (
	dictCatalogList = loadDictCatalog()
	// Hosty, z których wolno pobierać (zgadza się ze scripts/dict-catalog.py).
	dictAllowedHosts = map[string]bool{
		"github.com": true, "gitlab.com": true, "build.koreader.rocks": true, "download.wikdict.com": true,
		"www.reader-dict.com": true, "khoicandev.github.io": true, "cyphar.github.io": true,
		"dicionario-aberto.net": true,
	}
	// Hosty, na które wolno przekierować (CDN-y GitHuba dla plików wydań).
	dictRedirectHosts = map[string]bool{
		"objects.githubusercontent.com": true, "release-assets.githubusercontent.com": true,
		"github-releases.githubusercontent.com": true, "raw.githubusercontent.com": true,
		"codeload.github.com": true,
	}
	dictTestHTTP     = false // testy: lokalny serwer http, bez blokady adresów prywatnych
	dictFetchTimeout = 20 * time.Minute
	errDictNoSuchCat = errors.New("nie ma takiego słownika w katalogu")
)

func loadDictCatalog() []CatalogDict {
	var doc dictCatalogDoc
	if err := json.Unmarshal(dictCatalogJSON, &doc); err != nil {
		panic("dictcatalog.json: " + err.Error())
	}
	return doc.Dicts
}

func findCatalogDict(id string) *CatalogDict {
	for i := range dictCatalogList {
		if dictCatalogList[i].ID == id {
			return &dictCatalogList[i]
		}
	}
	return nil
}

// dictHostOK: czy wolno otworzyć ten adres jako źródło (start) albo cel przekierowania.
// W testach (dictTestHTTP) hostem jest "127.0.0.1:port" i wystarcza zwykły http.
func dictHostOK(u *url.URL, redirect bool) bool {
	if u.User != nil || u.Host == "" {
		return false
	}
	if dictTestHTTP {
		return dictAllowedHosts[u.Host] || (redirect && dictRedirectHosts[u.Host])
	}
	if u.Scheme != "https" || u.Port() != "" {
		return false
	}
	h := u.Hostname()
	return dictAllowedHosts[h] || (redirect && dictRedirectHosts[h])
}

// dictClient nie łączy się z adresami prywatnymi — nawet jeśli host z listy
// kiedyś wskaże na sieć wewnętrzną (rebinding), serwer nie zrobi z tego sondy.
func newDictClient() *http.Client {
	d := &net.Dialer{Timeout: 30 * time.Second}
	if !dictTestHTTP {
		d.Control = func(network, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			ip := net.ParseIP(host)
			if ip == nil || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
				ip.IsUnspecified() || ip.IsMulticast() || cgnat.Contains(ip) {
				return fmt.Errorf("adres %s jest niedozwolony", host)
			}
			return nil
		}
	}
	tr := &http.Transport{
		DialContext:           d.DialContext,
		TLSHandshakeTimeout:   30 * time.Second,
		ResponseHeaderTimeout: 60 * time.Second,
		DisableCompression:    true, // plik ma przyjść bajt w bajt, jak go wydano
	}
	return &http.Client{
		Transport: tr,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > 5 {
				return errors.New("za dużo przekierowań")
			}
			if !dictHostOK(req.URL, true) {
				return fmt.Errorf("przekierowanie na %s — poza listą dozwolonych hostów", req.URL.Host)
			}
			return nil
		},
	}
}

var _, cgnat, _ = net.ParseCIDR("100.64.0.0/10")

// fetchDictToFile pobiera adres z katalogu do pliku; progress dostaje (pobrano, razem|0).
func fetchDictToFile(ctx context.Context, raw, dst string, progress func(done, total int64)) error {
	u, err := url.Parse(raw)
	if err != nil || !dictHostOK(u, false) {
		return fmt.Errorf("adres %q poza listą dozwolonych hostów", raw)
	}
	req, err := http.NewRequestWithContext(ctx, "GET", raw, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "koligilo/"+Version)
	resp, err := newDictClient().Do(req)
	if err != nil {
		return fmt.Errorf("pobieranie: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("pobieranie: serwer odpowiedział %d", resp.StatusCode)
	}
	if resp.ContentLength > dictMaxZip {
		return fmt.Errorf("plik większy niż %d MB", dictMaxZip>>20)
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	var done int64
	buf := make([]byte, 256<<10)
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if done += int64(n); done > dictMaxZip {
				out.Close()
				return fmt.Errorf("plik większy niż %d MB", dictMaxZip>>20)
			}
			if _, werr := out.Write(buf[:n]); werr != nil {
				out.Close()
				return werr
			}
			progress(done, resp.ContentLength)
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			out.Close()
			return fmt.Errorf("pobieranie: %w", rerr)
		}
	}
	return out.Close()
}

// --- joby w tle ---

// Pobranie dużego słownika trwa minuty — dłużej niż zniesie proxy czy przeglądarka
// przy jednym żądaniu — więc POST startuje zadanie w tle, a panel odpytuje stan.

type dictJob struct {
	ID      string    `json:"id"`
	State   string    `json:"state"` // pobieranie | przetwarzanie | błąd
	Error   string    `json:"error,omitempty"`
	Done    int64     `json:"done"`
	Total   int64     `json:"total"`
	Updated time.Time `json:"updated"`
}

type dictJobs struct {
	mu   sync.Mutex
	m    map[string]*dictJob
	slot chan struct{} // najwyżej dwa pobrania naraz
}

var dictJobPool = &dictJobs{m: map[string]*dictJob{}, slot: make(chan struct{}, 2)}

func (s *Server) dictJobsSnapshot() map[string]dictJob {
	dictJobPool.mu.Lock()
	defer dictJobPool.mu.Unlock()
	out := map[string]dictJob{}
	for id, j := range dictJobPool.m {
		// zakończone błędem zostają na 10 minut, żeby panel zdążył je pokazać
		if j.State == "błąd" && time.Since(j.Updated) > 10*time.Minute {
			delete(dictJobPool.m, id)
			continue
		}
		out[id] = *j
	}
	return out
}

// StartCatalogDict zakłada zadanie pobrania. Idempotentne: trwające zadanie jest zwracane.
func (s *Server) StartCatalogDict(id string) (*dictJob, error) {
	c := findCatalogDict(id)
	if c == nil {
		return nil, errDictNoSuchCat
	}
	dictJobPool.mu.Lock()
	if j := dictJobPool.m[id]; j != nil && j.State != "błąd" {
		cp := *j
		dictJobPool.mu.Unlock()
		return &cp, nil
	}
	j := &dictJob{ID: id, State: "pobieranie", Updated: time.Now()}
	dictJobPool.m[id] = j
	cp := *j
	dictJobPool.mu.Unlock()
	go s.runDictJob(*c, j)
	return &cp, nil
}

func (s *Server) runDictJob(c CatalogDict, j *dictJob) {
	set := func(f func(*dictJob)) {
		dictJobPool.mu.Lock()
		f(j)
		j.Updated = time.Now()
		dictJobPool.mu.Unlock()
	}
	fail := func(err error) { set(func(j *dictJob) { j.State, j.Error = "błąd", err.Error() }) }
	dictJobPool.slot <- struct{}{}
	defer func() { <-dictJobPool.slot }()
	ctx, cancel := context.WithTimeout(context.Background(), dictFetchTimeout)
	defer cancel()
	tmpDir, err := s.st.dictTmpDir()
	if err != nil {
		fail(err)
		return
	}
	src := filepath.Join(tmpDir, "dl-"+c.ID+"-"+randHex(4))
	defer os.Remove(src)
	err = fetchDictToFile(ctx, c.URL, src, func(done, total int64) {
		set(func(j *dictJob) { j.Done, j.Total = done, total })
	})
	if err != nil {
		fail(err)
		return
	}
	set(func(j *dictJob) { j.State = "przetwarzanie" })
	if _, err := s.st.AddDictFile(src, c.Folder, c.Name, SrcCatalog, c.ID); err != nil {
		fail(err)
		return
	}
	dictJobPool.mu.Lock()
	delete(dictJobPool.m, c.ID)
	dictJobPool.mu.Unlock()
}

// --- HTTP ---

func (s *Server) dictCatalogRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/admin/dict-catalog", s.admin(s.adminDictCatalog))
	m.HandleFunc("POST /api/admin/dict-catalog/{id}", s.admin(s.adminDictCatalogAdd))
}

// adminDictCatalog oddaje cały katalog (1,7 tys. pozycji, ok. 570 kB); panel filtruje u siebie.
func (s *Server) adminDictCatalog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, max-age=3600")
	writeJSON(w, 200, map[string]any{"dicts": dictCatalogList})
}

func (s *Server) adminDictCatalogAdd(w http.ResponseWriter, r *http.Request) {
	j, err := s.StartCatalogDict(r.PathValue("id"))
	switch {
	case errors.Is(err, errDictNoSuchCat):
		writeJSON(w, 404, map[string]string{"error": err.Error()})
	case err != nil:
		writeJSON(w, 500, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, 202, map[string]any{"job": j})
	}
}
