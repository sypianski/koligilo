package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestGuard pokrywa TASK-14 AC1/AC2: proxy panelu desktopowego musi odrzucić
// żądania spoza siebie (obcy Origin/brak nagłówka X-Koligilo dla mutacji,
// obcy Host nawet dla GET — DNS rebinding), a przepuścić własne żądania.
func TestGuard(t *testing.T) {
	const port = 47499
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	g := guard(port, ok)

	cases := []struct {
		name   string
		method string
		host   string
		origin string
		path   string
		hdr    bool
		want   int
	}{
		{"GET statyk bez nagłówka, poprawny host — przechodzi", "GET", "127.0.0.1:47499", "", "/", false, 200},
		{"GET /api bez nagłówka X-Koligilo — 403", "GET", "127.0.0.1:47499", "", "/api/local/config", false, 403},
		{"GET /api z nagłówkiem, poprawny host — przechodzi", "GET", "127.0.0.1:47499", "", "/api/local/config", true, 200},
		{"GET /api z nagłówkiem, localhost — przechodzi", "GET", "localhost:47499", "", "/api/local/config", true, 200},
		{"GET obcy Host (DNS rebinding) — 403 mimo nagłówka", "GET", "evil.example:47499", "", "/api/local/config", true, 403},
		{"GET obcy Host bez portu — 403", "GET", "127.0.0.1", "", "/api/local/config", true, 403},
		{"POST /api bez Origin — 403", "POST", "127.0.0.1:47499", "", "/api/admin/state", true, 403},
		{"POST /api z obcym Origin — 403", "POST", "127.0.0.1:47499", "http://evil.example", "/api/admin/state", true, 403},
		{"POST /api z poprawnym Origin i nagłówkiem — przechodzi", "POST", "127.0.0.1:47499", "http://127.0.0.1:47499", "/api/admin/state", true, 200},
		{"POST /api z poprawnym Origin ale bez nagłówka X-Koligilo — 403", "POST", "127.0.0.1:47499", "http://127.0.0.1:47499", "/api/admin/state", false, 403},
		{"POST /api Origin z localhost gdy Host=127.0.0.1 — przechodzi (obie formy dozwolone)", "POST", "127.0.0.1:47499", "http://localhost:47499", "/api/admin/state", true, 200},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(c.method, c.path, nil)
			req.Host = c.host
			if c.origin != "" {
				req.Header.Set("Origin", c.origin)
			}
			if c.hdr {
				req.Header.Set(guardHeader, "1")
			}
			rec := httptest.NewRecorder()
			g.ServeHTTP(rec, req)
			if rec.Code != c.want {
				t.Errorf("%s → %d, chcę %d", c.name, rec.Code, c.want)
			}
			for k := range rec.Header() {
				if len(k) >= 15 && k[:15] == "Access-Control-" {
					t.Errorf("guard nie powinien ustawiać %s", k)
				}
			}
		})
	}
}

// TestGuardNoStaticLeak: żądanie do statyku ("/") z obcym Origin przy GET nadal
// przechodzi — nagłówek Origin jest sprawdzany tylko dla metod innych niż GET/HEAD.
func TestGuardStaticIgnoresOrigin(t *testing.T) {
	const port = 47498
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	g := guard(port, ok)
	req := httptest.NewRequest("GET", "/", nil)
	req.Host = "127.0.0.1:47498"
	req.Header.Set("Origin", "http://evil.example")
	rec := httptest.NewRecorder()
	g.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Errorf("GET / z obcym Origin → %d, chcę 200 (Origin liczy się tylko dla mutacji)", rec.Code)
	}
}
