package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// Katalog polecanych czcionek do czytania (TASK-37). Dane (adresy przypięte do
// commitu, sha256, rozmiary) generuje scripts/font-catalog.py do
// fontcatalog_data.go. Serwer pobiera WYŁĄCZNIE adresy z tego katalogu — nigdy
// adres podany z panelu — więc panel nie staje się otwartym proxy (SSRF).
// Dodatkowo: tylko dozwolone hosty, bez przekierowań, limit rozmiaru i zgodność
// sha256 z katalogiem; plik o innej sumie jest odrzucany.

const SrcCatalog = "katalog"

type CatalogFont struct {
	File   string
	URL    string
	SHA256 string
	Size   int64
}

type FontFamily struct {
	ID          string
	Name        string
	Description string
	Scripts     string
	License     string
	Source      string // strona repozytorium (przypięta do commitu)
	Starter     bool   // wchodzi do „zestawu startowego”
	Fonts       []CatalogFont
}

// Zmienne tylko po to, by testy mogły podstawić własny serwer.
var (
	fontCatalogList   = fontCatalog
	fontAllowedHosts  = map[string]bool{"raw.githubusercontent.com": true}
	fontFetchClient   = &http.Client{Timeout: 90 * time.Second}
	fontTestHTTP      = false // testy podstawiają lokalny serwer http
	errFontNoSuchFamy = errors.New("nie ma takiej rodziny w katalogu")
)

func findFamily(id string) *FontFamily {
	for i := range fontCatalogList {
		if fontCatalogList[i].ID == id {
			return &fontCatalogList[i]
		}
	}
	return nil
}

func (f *FontFamily) totalSize() (n int64) {
	for _, c := range f.Fonts {
		n += c.Size
	}
	return
}

// fetchCatalogFont pobiera jeden plik z katalogu i sprawdza go z sumą z katalogu.
func fetchCatalogFont(ctx context.Context, c CatalogFont) ([]byte, error) {
	u, err := url.Parse(c.URL)
	if err != nil || !fontAllowedHosts[u.Host] || u.User != nil || (u.Scheme != "https" && !fontTestHTTP) {
		return nil, fmt.Errorf("adres %q poza listą dozwolonych hostów", c.URL)
	}
	cl := *fontFetchClient
	cl.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	req, err := http.NewRequestWithContext(ctx, "GET", c.URL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := cl.Do(req)
	if err != nil {
		return nil, fmt.Errorf("pobieranie %s: %w", c.File, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("pobieranie %s: serwer odpowiedział %d", c.File, resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, fontMaxSize+1))
	if err != nil {
		return nil, fmt.Errorf("pobieranie %s: %w", c.File, err)
	}
	sum := sha256.Sum256(b)
	if hex.EncodeToString(sum[:]) != c.SHA256 {
		return nil, fmt.Errorf("%s: suma sha256 pobranego pliku nie zgadza się z katalogiem — odrzucony", c.File)
	}
	return b, nil
}

// AddCatalogFamily pobiera i dodaje do magazynu wszystkie style rodziny.
// Idempotentne: pliki już obecne (ta sama suma) są pomijane bez pobierania.
func (st *Store) AddCatalogFamily(ctx context.Context, id string) (added, had int, err error) {
	fam := findFamily(id)
	if fam == nil {
		return 0, 0, errFontNoSuchFamy
	}
	for _, c := range fam.Fonts {
		st.mu.Lock()
		cur := st.S.Fonts[c.SHA256]
		st.mu.Unlock()
		if cur != nil && cur.Approved {
			had++
			continue
		}
		b, err := fetchCatalogFont(ctx, c)
		if err != nil {
			return added, had, err
		}
		v, err := st.AddFont(b, c.File, SrcCatalog, fam.Name)
		if err != nil {
			return added, had, err
		}
		if !v.Approved { // ten sam plik wcześniej przyszedł z czytnika — katalog go potwierdza
			if _, err := st.ApproveFont(v.SHA256); err != nil {
				return added, had, err
			}
		}
		added++
	}
	return added, had, nil
}

// --- HTTP ---

func (s *Server) fontCatalogRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/admin/font-catalog", s.admin(s.adminFontCatalog))
	m.HandleFunc("POST /api/admin/font-catalog/{id}", s.admin(s.adminFontCatalogAdd))
}

func (s *Server) adminFontCatalog(w http.ResponseWriter, r *http.Request) {
	s.st.mu.Lock()
	have := map[string]bool{}
	for sha, f := range s.st.S.Fonts {
		if f.Approved {
			have[sha] = true
		}
	}
	s.st.mu.Unlock()
	out := []map[string]any{}
	for _, f := range fontCatalogList {
		n := 0
		for _, c := range f.Fonts {
			if have[c.SHA256] {
				n++
			}
		}
		out = append(out, map[string]any{
			"id": f.ID, "name": f.Name, "description": f.Description, "scripts": f.Scripts,
			"license": f.License, "source": f.Source, "starter": f.Starter,
			"files": len(f.Fonts), "have": n, "size": f.totalSize(),
		})
	}
	writeJSON(w, 200, map[string]any{"families": out})
}

func (s *Server) adminFontCatalogAdd(w http.ResponseWriter, r *http.Request) {
	added, had, err := s.st.AddCatalogFamily(r.Context(), r.PathValue("id"))
	var bf *badFont
	switch {
	case errors.Is(err, errFontNoSuchFamy):
		writeJSON(w, 404, map[string]string{"error": err.Error()})
	case errors.As(err, &bf):
		writeJSON(w, 400, map[string]string{"error": bf.Error()})
	case err != nil:
		// 502: sieć albo zła suma po stronie źródła; to, co już dodane, zostaje
		writeJSON(w, 502, map[string]any{"error": err.Error(), "added": added, "had": had})
	default:
		writeJSON(w, 200, map[string]any{"added": added, "had": had})
	}
}
