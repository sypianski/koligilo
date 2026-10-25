package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"
)

// TASK-53: parowanie, punkt kontaktowy (rendezvous) i zarządzanie urządzeniami.
// Do tej pory pokrywał je tylko tests/run_e2e.sh — zmiana limitu prób albo
// jednorazowości tokenu nie łamała żadnego testu Go.

const (
	ipA = "198.51.100.7:4000"
	ipB = "198.51.100.8:4000"
)

type pairEnv struct {
	t     *testing.T
	s     *Server
	mux   http.Handler
	admin string
}

// newPairEnv: prawdziwy Server bez wstrzykiwania tokenu (w odróżnieniu od
// harness), żeby dało się sprawdzać odmowy dostępu.
func newPairEnv(t *testing.T, publicURL string) *pairEnv {
	t.Helper()
	st, admin, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{st: st, publicURL: publicURL}
	return &pairEnv{t: t, s: s, mux: s.Routes(), admin: admin}
}

func (e *pairEnv) req(method, path string, body any) *http.Request {
	var rd io.Reader = http.NoBody
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	return httptest.NewRequest(method, path, rd)
}

func (e *pairEnv) serve(r *http.Request) (int, map[string]any) {
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, r)
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// do: żądanie z opcjonalnym tokenem Bearer i adresem zdalnym.
func (e *pairEnv) do(method, path string, body any, bearer, remote string) (int, map[string]any) {
	r := e.req(method, path, body)
	if bearer != "" {
		r.Header.Set("Authorization", "Bearer "+bearer)
	}
	if remote != "" {
		r.RemoteAddr = remote
	}
	return e.serve(r)
}

func (e *pairEnv) adm(method, path string, body any) (int, map[string]any) {
	return e.do(method, path, body, e.admin, "")
}

// readerStartsRV: czytnik prosi punkt kontaktowy o kod.
func (e *pairEnv) readerStartsRV(name string) (id, code string) {
	e.t.Helper()
	c, out := e.do("POST", "/api/v1/rv", map[string]string{"name": name, "model": "Libra"}, "", ipB)
	if c != 200 {
		e.t.Fatalf("start rv: %d %v", c, out)
	}
	return out["id"].(string), out["code"].(string)
}

func wrongCode(real string) string {
	if real == "000000" {
		return "000001"
	}
	return "000000"
}

// --- rendezvous ---

func TestRendezvousFullFlowAndSingleUseToken(t *testing.T) {
	e := newPairEnv(t, "")
	id, code := e.readerStartsRV("Kobo Libra")
	if !regexp.MustCompile(`^\d{6}$`).MatchString(code) {
		t.Fatalf("kod %q nie jest 6-cyfrowy", code)
	}
	if c, out := e.do("GET", "/api/v1/rv/"+id, nil, "", ""); c != 200 || out["status"] != "waiting" {
		t.Fatalf("przed claim: %d %v", c, out)
	}
	// człowiek wpisuje kod z separatorem — normCode go oczyszcza
	c, info := e.do("GET", "/api/v1/rv/code/"+code[:3]+"-"+code[3:], nil, "", ipA)
	if c != 200 || info["name"] != "Kobo Libra" {
		t.Fatalf("lookup: %d %v", c, info)
	}
	claim := map[string]string{"server": "https://s.test", "token": "tok-1", "device_id": "dev-1"}
	if c, out := e.do("POST", "/api/v1/rv/code/"+code+"/claim", claim, "", ipA); c != 200 {
		t.Fatalf("claim: %d %v", c, out)
	}
	c, out := e.do("GET", "/api/v1/rv/"+id, nil, "", "")
	if c != 200 || out["status"] != "ready" || out["token"] != "tok-1" || out["server"] != "https://s.test" || out["device_id"] != "dev-1" {
		t.Fatalf("po claim: %d %v", c, out)
	}
	// token wydawany raz: sesja znika razem z kodem
	if c, out := e.do("GET", "/api/v1/rv/"+id, nil, "", ""); c != 404 || out["status"] != "expired" {
		t.Errorf("drugi odbiór: %d %v, chcę 404 expired", c, out)
	}
	if c, _ := e.do("GET", "/api/v1/rv/code/"+code, nil, "", ipA); c != 404 {
		t.Errorf("kod po odbiorze nadal działa: %d", c)
	}
}

func TestRendezvousClaimedCodeCannotBeClaimedTwice(t *testing.T) {
	e := newPairEnv(t, "")
	_, code := e.readerStartsRV("Kobo")
	claim := map[string]string{"server": "https://s.test", "token": "tok-1", "device_id": "d"}
	if c, _ := e.do("POST", "/api/v1/rv/code/"+code+"/claim", claim, "", ipA); c != 200 {
		t.Fatalf("pierwszy claim: %d", c)
	}
	claim["token"] = "tok-przejęty"
	if c, _ := e.do("POST", "/api/v1/rv/code/"+code+"/claim", claim, "", ipA); c != 404 {
		t.Errorf("drugi claim tego samego kodu: %d, chcę 404", c)
	}
	if c, _ := e.do("GET", "/api/v1/rv/code/"+code, nil, "", ipA); c != 404 {
		t.Errorf("lookup zajętego kodu: %d, chcę 404", c)
	}
}

func TestRendezvousClaimValidation(t *testing.T) {
	e := newPairEnv(t, "")
	id, code := e.readerStartsRV("Kobo")
	for _, bad := range []map[string]string{
		{"server": "ftp://s.test", "token": "t"},
		{"server": "https://s.test", "token": ""},
		{},
	} {
		if c, _ := e.do("POST", "/api/v1/rv/code/"+code+"/claim", bad, "", ipA); c != 400 {
			t.Errorf("claim %v: %d, chcę 400", bad, c)
		}
	}
	// odrzucone claimy nie zajmują sesji
	if c, out := e.do("GET", "/api/v1/rv/"+id, nil, "", ""); out["status"] != "waiting" {
		t.Fatalf("sesja po złych claimach: %d %v", c, out)
	}
	ok := map[string]string{"server": "http://s.test", "token": "t"}
	if c, _ := e.do("POST", "/api/v1/rv/code/"+code+"/claim", ok, "", ipA); c != 200 {
		t.Errorf("poprawny claim po odrzuconych: %d", c)
	}
}

// Jedyna ochrona 6-cyfrowego kodu: >=10 nieudanych prób z jednego adresu
// w ciągu rvTTL blokuje ten adres — nawet dla poprawnego kodu.
func TestRendezvousBruteForceLockout(t *testing.T) {
	e := newPairEnv(t, "")
	id, code := e.readerStartsRV("Kobo")
	wrong := wrongCode(code)
	for i := 1; i <= 10; i++ {
		if c, _ := e.do("GET", "/api/v1/rv/code/"+wrong, nil, "", ipA); c != 404 {
			t.Fatalf("błędna próba %d: %d, chcę 404", i, c)
		}
	}
	if c, _ := e.do("GET", "/api/v1/rv/code/"+code, nil, "", ipA); c != 429 {
		t.Errorf("poprawny kod po 10 błędach: %d, chcę 429", c)
	}
	claim := map[string]string{"server": "https://s.test", "token": "t"}
	if c, _ := e.do("POST", "/api/v1/rv/code/"+code+"/claim", claim, "", ipA); c != 429 {
		t.Errorf("claim po 10 błędach: %d, chcę 429", c)
	}
	if _, out := e.do("GET", "/api/v1/rv/"+id, nil, "", ""); out["status"] != "waiting" {
		t.Errorf("zablokowany claim nie może zająć sesji: %v", out)
	}
	// inny adres nie jest blokowany
	if c, _ := e.do("GET", "/api/v1/rv/code/"+code, nil, "", ipB); c != 200 {
		t.Errorf("inny adres: %d, chcę 200", c)
	}
	// po rvTTL próby się przedawniają
	old := time.Now().Add(-2 * rvTTL)
	e.s.rv.mu.Lock()
	for i := range e.s.rv.failures[clientIPHost(ipA)] {
		e.s.rv.failures[clientIPHost(ipA)][i] = old
	}
	e.s.rv.mu.Unlock()
	if c, _ := e.do("GET", "/api/v1/rv/code/"+code, nil, "", ipA); c != 200 {
		t.Errorf("po przedawnieniu prób: %d, chcę 200", c)
	}
}

func clientIPHost(addr string) string { return strings.Split(addr, ":")[0] }

// Błędne claimy liczą się tak samo jak błędne lookupy.
func TestRendezvousBruteForceCountsClaims(t *testing.T) {
	e := newPairEnv(t, "")
	_, code := e.readerStartsRV("Kobo")
	wrong := wrongCode(code)
	claim := map[string]string{"server": "https://s.test", "token": "t"}
	for i := 0; i < 10; i++ {
		e.do("POST", "/api/v1/rv/code/"+wrong+"/claim", claim, "", ipA)
	}
	if c, _ := e.do("POST", "/api/v1/rv/code/"+code+"/claim", claim, "", ipA); c != 429 {
		t.Errorf("claim po 10 błędnych claimach: %d, chcę 429", c)
	}
}

// Obcy klient nie omija limitu, podstawiając X-Forwarded-For.
func TestRendezvousForwardedForCannotBypassLockout(t *testing.T) {
	e := newPairEnv(t, "")
	_, code := e.readerStartsRV("Kobo")
	wrong := wrongCode(code)
	for i := 0; i < 10; i++ {
		r := e.req("GET", "/api/v1/rv/code/"+wrong, nil)
		r.RemoteAddr = ipA
		r.Header.Set("X-Forwarded-For", fmt.Sprintf("203.0.113.%d", i+1))
		e.serve(r)
	}
	r := e.req("GET", "/api/v1/rv/code/"+code, nil)
	r.RemoteAddr = ipA
	r.Header.Set("X-Forwarded-For", "203.0.113.200")
	if c, _ := e.serve(r); c != 429 {
		t.Errorf("rotacja X-Forwarded-For ominęła blokadę: %d, chcę 429", c)
	}
}

func TestClientIP(t *testing.T) {
	for _, tc := range []struct{ remote, xff, want string }{
		{"198.51.100.7:1", "1.1.1.1", "198.51.100.7"},           // nie z proxy: nagłówek ignorowany
		{"127.0.0.1:1", "203.0.113.9, 10.0.0.1", "203.0.113.9"}, // lokalny nginx: pierwszy z XFF
		{"127.0.0.1:1", "", "127.0.0.1"},
		{"[::1]:5", "203.0.113.9", "203.0.113.9"},
	} {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = tc.remote
		if tc.xff != "" {
			r.Header.Set("X-Forwarded-For", tc.xff)
		}
		if got := clientIP(r); got != tc.want {
			t.Errorf("clientIP(%s, xff=%q) = %q, chcę %q", tc.remote, tc.xff, got, tc.want)
		}
	}
}

func TestNormCode(t *testing.T) {
	for in, want := range map[string]string{
		"123456": "123456", "123-456": "123456", " 12 34 56 ": "123456", "abc": "", "": "",
	} {
		if got := normCode(in); got != want {
			t.Errorf("normCode(%q) = %q, chcę %q", in, got, want)
		}
	}
}

func TestRendezvousGlobalCap(t *testing.T) {
	e := newPairEnv(t, "")
	e.s.rv.mu.Lock()
	for i := 0; i <= 500; i++ {
		s := &rvSession{id: fmt.Sprintf("id%d", i), code: fmt.Sprintf("9%05d", i), ip: fmt.Sprintf("10.0.%d.%d", i/250, i%250), created: time.Now()}
		e.s.rv.byID[s.id], e.s.rv.byCode[s.code] = s, s
	}
	e.s.rv.mu.Unlock()
	if c, _ := e.do("POST", "/api/v1/rv", map[string]string{"name": "Kobo"}, "", ipA); c != 429 {
		t.Errorf("przy >500 sesjach: %d, chcę 429", c)
	}
}

func TestRendezvousSessionExpires(t *testing.T) {
	e := newPairEnv(t, "")
	id, code := e.readerStartsRV("Kobo")
	e.s.rv.mu.Lock()
	e.s.rv.byID[id].created = time.Now().Add(-2 * rvTTL)
	e.s.rv.mu.Unlock()
	if c, out := e.do("GET", "/api/v1/rv/"+id, nil, "", ""); c != 404 || out["status"] != "expired" {
		t.Errorf("wygasła sesja: %d %v", c, out)
	}
	if c, _ := e.do("GET", "/api/v1/rv/code/"+code, nil, "", ipA); c != 404 {
		t.Errorf("wygasły kod nadal działa: %d", c)
	}
	if n := len(e.s.rv.byCode); n != 0 {
		t.Errorf("byCode zawiera %d wygasłych wpisów", n)
	}
}

// --- parowanie z kodu pokazanego na czytniku (pairStart / pairPoll / Decide) ---

func TestPairStartValidation(t *testing.T) {
	e := newPairEnv(t, "")
	if c, _ := e.serve(e.req("POST", "/api/v1/pair", nil)); c != 400 {
		t.Errorf("puste ciało: %d, chcę 400", c)
	}
	r := e.req("POST", "/api/v1/pair", nil)
	r.Body = io.NopCloser(strings.NewReader("{nie json"))
	if c, _ := e.serve(r); c != 400 {
		t.Errorf("zepsuty JSON: %d, chcę 400", c)
	}
	c, out := e.do("POST", "/api/v1/pair", map[string]string{"model": "Libra"}, "", "")
	if c != 200 {
		t.Fatalf("start: %d %v", c, out)
	}
	if !regexp.MustCompile(`^\d{4}$`).MatchString(out["code"].(string)) {
		t.Errorf("kod %v nie jest 4-cyfrowy", out["code"])
	}
	if out["expires_in"] != float64(pairTTL.Seconds()) {
		t.Errorf("expires_in = %v", out["expires_in"])
	}
	// brak nazwy → nazwa z modelu
	if p := e.s.st.Pending(); len(p) != 1 || p[0].Name != "Libra" {
		t.Errorf("oczekujące: %+v", p)
	}
}

func TestPairPendingLimit(t *testing.T) {
	e := newPairEnv(t, "")
	var first string
	for i := 0; i < 5; i++ {
		c, out := e.do("POST", "/api/v1/pair", map[string]string{"name": "K"}, "", "")
		if c != 200 {
			t.Fatalf("prośba %d: %d %v", i+1, c, out)
		}
		if i == 0 {
			first = out["id"].(string)
		}
	}
	if c, _ := e.do("POST", "/api/v1/pair", map[string]string{"name": "K"}, "", ""); c != 429 {
		t.Errorf("szósta oczekująca: %d, chcę 429", c)
	}
	// odrzucenie zwalnia miejsce
	e.adm("POST", "/api/admin/pair/"+first, map[string]bool{"approve": false})
	if c, _ := e.do("POST", "/api/v1/pair", map[string]string{"name": "K"}, "", ""); c != 200 {
		t.Errorf("po odrzuceniu jednej: %d, chcę 200", c)
	}
}

func TestPairApproveIssuesTokenExactlyOnce(t *testing.T) {
	e := newPairEnv(t, "")
	_, out := e.do("POST", "/api/v1/pair", map[string]string{"name": "Kobo"}, "", "")
	id := out["id"].(string)

	c, out := e.do("GET", "/api/v1/pair/"+id, nil, "", "")
	if c != 200 || out["status"] != "pending" || out["token"] != nil {
		t.Fatalf("przed zatwierdzeniem: %d %v", c, out)
	}
	c, out = e.adm("POST", "/api/admin/pair/"+id, map[string]bool{"approve": true})
	if c != 200 || out["device"] == nil {
		t.Fatalf("zatwierdzenie: %d %v", c, out)
	}
	c, out = e.do("GET", "/api/v1/pair/"+id, nil, "", "")
	if c != 200 || out["status"] != "approved" {
		t.Fatalf("po zatwierdzeniu: %d %v", c, out)
	}
	tok, _ := out["token"].(string)
	devID, _ := out["device_id"].(string)
	if tok == "" || devID == "" {
		t.Fatalf("brak tokenu/id: %v", out)
	}
	if c, _ := e.do("GET", "/api/v1/sync", nil, tok, ""); c != 200 {
		t.Errorf("token z parowania nie działa: %d", c)
	}
	// drugi odbiór: prośba zniknęła, a token nie wycieka
	if c, out := e.do("GET", "/api/v1/pair/"+id, nil, "", ""); c != 404 || out["token"] != nil {
		t.Errorf("drugi odbiór: %d %v, chcę 404 bez tokenu", c, out)
	}
	// na dysku tylko hash, i token przeżywa restart
	raw, err := os.ReadFile(e.s.st.path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), tok) {
		t.Error("state.json zawiera jawny token urządzenia")
	}
	st2, _, err := OpenStore(e.s.st.Dir())
	if err != nil {
		t.Fatal(err)
	}
	if d := st2.DeviceByToken(tok); d == nil || d.ID != devID {
		t.Errorf("token nie działa po ponownym otwarciu stanu: %v", d)
	}
}

func TestPairDenyIssuesNothing(t *testing.T) {
	e := newPairEnv(t, "")
	_, out := e.do("POST", "/api/v1/pair", map[string]string{"name": "Kobo"}, "", "")
	id := out["id"].(string)
	c, out := e.adm("POST", "/api/admin/pair/"+id, map[string]bool{"approve": false})
	if c != 200 || out["device"] != nil {
		t.Fatalf("odrzucenie: %d %v", c, out)
	}
	c, out = e.do("GET", "/api/v1/pair/"+id, nil, "", "")
	if c != 200 || out["status"] != "rejected" || out["token"] != nil {
		t.Errorf("poll po odrzuceniu: %d %v", c, out)
	}
	if c, _ := e.do("GET", "/api/v1/pair/"+id, nil, "", ""); c != 404 {
		t.Errorf("drugi poll po odrzuceniu: %d, chcę 404", c)
	}
	if n := len(e.s.st.Pending()); n != 0 {
		t.Errorf("oczekujących: %d", n)
	}
	if n := len(e.s.st.S.Devices); n != 0 {
		t.Errorf("urządzeń po odrzuceniu: %d", n)
	}
}

func TestPairDecideErrors(t *testing.T) {
	e := newPairEnv(t, "")
	if c, _ := e.adm("POST", "/api/admin/pair/nie-ma", map[string]bool{"approve": true}); c != 409 {
		t.Errorf("nieznana prośba: %d, chcę 409", c)
	}
	if c, _ := e.do("GET", "/api/v1/pair/nie-ma", nil, "", ""); c != 404 {
		t.Errorf("poll nieznanej prośby: %d, chcę 404", c)
	}
	_, out := e.do("POST", "/api/v1/pair", map[string]string{"name": "Kobo"}, "", "")
	id := out["id"].(string)
	e.adm("POST", "/api/admin/pair/"+id, map[string]bool{"approve": true})
	if c, _ := e.adm("POST", "/api/admin/pair/"+id, map[string]bool{"approve": true}); c != 409 {
		t.Errorf("drugie zatwierdzenie: %d, chcę 409", c)
	}
	if n := len(e.s.st.S.Devices); n != 1 {
		t.Errorf("podwójne zatwierdzenie utworzyło %d urządzeń", n)
	}
}

func TestPairRequestExpires(t *testing.T) {
	e := newPairEnv(t, "")
	_, out := e.do("POST", "/api/v1/pair", map[string]string{"name": "Kobo"}, "", "")
	id := out["id"].(string)
	e.s.st.mu.Lock()
	e.s.st.S.pending[id].Created = time.Now().Add(-2 * pairTTL)
	e.s.st.mu.Unlock()
	if c, _ := e.adm("POST", "/api/admin/pair/"+id, map[string]bool{"approve": true}); c != 409 {
		t.Errorf("zatwierdzenie wygasłej: %d, chcę 409", c)
	}
	if c, out := e.do("GET", "/api/v1/pair/"+id, nil, "", ""); c != 404 || out["status"] != "expired" {
		t.Errorf("poll wygasłej: %d %v", c, out)
	}
}

// --- granica admin / urządzenie ---

func TestAdminEndpointsRequireAdminToken(t *testing.T) {
	e := newPairEnv(t, "https://s.test")
	d, devTok, err := e.s.st.Provision("Deck", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, ep := range []struct{ method, path string }{
		{"GET", "/api/admin/state"},
		{"POST", "/api/admin/pair/x"},
		{"POST", "/api/admin/devices"},
		{"POST", "/api/admin/devices/" + d.ID + "/groups"},
		{"POST", "/api/admin/devices/" + d.ID + "/rename"},
		{"DELETE", "/api/admin/devices/" + d.ID},
		{"GET", "/api/admin/rv/123456"},
		{"POST", "/api/admin/rv/123456/claim"},
		{"POST", "/api/admin/values"},
	} {
		body := map[string]any{"name": "przejęty", "group": "kopad", "on": true, "approve": true}
		for _, who := range []struct{ name, tok string }{{"bez tokenu", ""}, {"zły token", "kol-zly"}, {"token urządzenia", devTok}} {
			if c, _ := e.do(ep.method, ep.path, body, who.tok, ""); c != 401 {
				t.Errorf("%s %s (%s): %d, chcę 401", ep.method, ep.path, who.name, c)
			}
		}
	}
	// odmowy niczego nie zmieniły
	got := e.s.st.S.Devices[d.ID]
	if got == nil || got.Name != "Deck" || got.Groups["kopad"] {
		t.Errorf("urządzenie po odrzuconych żądaniach: %+v", got)
	}
	// i w drugą stronę: token admina nie jest tokenem urządzenia
	for _, tok := range []string{"", e.admin} {
		if c, _ := e.do("GET", "/api/v1/sync", nil, tok, ""); c != 401 {
			t.Errorf("sync z tokenem %q: %d, chcę 401", tok, c)
		}
	}
}

// --- Rename / Forget / ResetAdmin ---

func TestRenameDevice(t *testing.T) {
	e := newPairEnv(t, "")
	d, _, _ := e.s.st.Provision("Deck", "", "", "")
	path := "/api/admin/devices/" + d.ID + "/rename"
	if c, _ := e.adm("POST", path, map[string]string{"name": "   "}); c != 400 {
		t.Errorf("pusta nazwa: %d, chcę 400", c)
	}
	if c, _ := e.adm("POST", "/api/admin/devices/nie-ma/rename", map[string]string{"name": "X"}); c != 400 {
		t.Errorf("nieznane urządzenie: %d, chcę 400", c)
	}
	if c, _ := e.adm("POST", path, map[string]string{"name": strings.Repeat("ł", 100)}); c != 200 {
		t.Fatalf("zmiana nazwy: %d", c)
	}
	st2, _, err := OpenStore(e.s.st.Dir())
	if err != nil {
		t.Fatal(err)
	}
	if got := []rune(st2.S.Devices[d.ID].Name); len(got) != 60 {
		t.Errorf("nazwa po restarcie ma %d znaków, chcę 60 (clip)", len(got))
	}
}

func TestForgetDeviceRevokesToken(t *testing.T) {
	e := newPairEnv(t, "")
	d, tok, _ := e.s.st.Provision("Deck", "", "", "")
	if c, _ := e.do("GET", "/api/v1/sync", nil, tok, ""); c != 200 {
		t.Fatalf("token przed usunięciem: %d", c)
	}
	if c, _ := e.adm("DELETE", "/api/admin/devices/"+d.ID, nil); c != 200 {
		t.Fatalf("usunięcie: %d", c)
	}
	if c, _ := e.do("GET", "/api/v1/sync", nil, tok, ""); c != 401 {
		t.Errorf("token usuniętego urządzenia: %d, chcę 401", c)
	}
	st2, _, err := OpenStore(e.s.st.Dir())
	if err != nil {
		t.Fatal(err)
	}
	if st2.DeviceByToken(tok) != nil {
		t.Error("usunięte urządzenie wróciło po ponownym otwarciu stanu")
	}
	// idempotentne: panel może kliknąć dwa razy
	if c, _ := e.adm("DELETE", "/api/admin/devices/"+d.ID, nil); c != 200 {
		t.Errorf("powtórne usunięcie: %d, chcę 200", c)
	}
}

func TestResetAdminReplacesToken(t *testing.T) {
	e := newPairEnv(t, "")
	st := e.s.st
	if st.CheckAdmin("") {
		t.Error("pusty token nie może być adminem")
	}
	if !st.CheckAdmin(e.admin) {
		t.Fatal("pierwszy token admina nie działa")
	}
	fresh, err := st.ResetAdmin()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(fresh, "kol-") || fresh == e.admin {
		t.Errorf("nowy token %q", fresh)
	}
	if st.CheckAdmin(e.admin) {
		t.Error("stary token admina nadal działa po ResetAdmin")
	}
	if c, _ := e.do("GET", "/api/admin/state", nil, e.admin, ""); c != 401 {
		t.Errorf("stary token przez HTTP: %d, chcę 401", c)
	}
	if c, _ := e.do("GET", "/api/admin/state", nil, fresh, ""); c != 200 {
		t.Errorf("nowy token przez HTTP: %d, chcę 200", c)
	}
	raw, _ := os.ReadFile(st.path)
	if strings.Contains(string(raw), fresh) {
		t.Error("state.json zawiera jawny token admina")
	}
	st2, _, err := OpenStore(st.Dir())
	if err != nil {
		t.Fatal(err)
	}
	if !st2.CheckAdmin(fresh) {
		t.Error("nowy token nie przeżył restartu")
	}
}

// --- admin: czytnik z kodem → nowe urządzenie ---

func TestAdminRVClaimProvisionsDevice(t *testing.T) {
	e := newPairEnv(t, "https://s.test")
	id, code := e.readerStartsRV("Kobo Libra")

	c, out := e.adm("GET", "/api/admin/rv/"+code, nil)
	if c != 200 || out["name"] != "Kobo Libra" {
		t.Fatalf("lookup przez panel: %d %v", c, out)
	}
	c, out = e.adm("POST", "/api/admin/rv/"+code+"/claim", nil)
	if c != 200 {
		t.Fatalf("claim przez panel: %d %v", c, out)
	}
	c, out = e.do("GET", "/api/v1/rv/"+id, nil, "", "")
	if c != 200 || out["status"] != "ready" || out["server"] != "https://s.test" {
		t.Fatalf("czytnik po claim: %d %v", c, out)
	}
	tok, _ := out["token"].(string)
	if d := e.s.st.DeviceByToken(tok); d == nil || d.ID != out["device_id"] || d.Name != "Kobo Libra" {
		t.Errorf("token z rendezvous nie wskazuje nowego urządzenia: %+v", d)
	}
}

func TestAdminRVClaimWithoutPublicURLOrCode(t *testing.T) {
	e := newPairEnv(t, "")
	_, code := e.readerStartsRV("Kobo")
	if c, _ := e.adm("POST", "/api/admin/rv/"+code+"/claim", nil); c != 409 {
		t.Errorf("bez --public-url: %d, chcę 409", c)
	}
	e2 := newPairEnv(t, "https://s.test")
	if c, _ := e2.adm("POST", "/api/admin/rv/123456/claim", nil); c != 404 {
		t.Errorf("nieznany kod: %d, chcę 404", c)
	}
	if n := len(e2.s.st.S.Devices); n != 0 {
		t.Errorf("nieznany kod utworzył %d urządzeń", n)
	}
}

// Gdy zdalny punkt kontaktowy odmówi claim, utworzone urządzenie jest
// wycofywane — czytnik nigdy nie odbierze jego tokenu.
func TestAdminRVClaimRollsBackDeviceOnRemoteFailure(t *testing.T) {
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			writeJSON(w, 200, map[string]string{"name": "Kobo", "model": "Libra"})
			return
		}
		writeJSON(w, 404, map[string]string{"error": "nie ma czytnika z takim kodem"})
	}))
	defer remote.Close()
	e := newPairEnv(t, "https://s.test")
	e.s.rvc.remote = remote.URL
	c, out := e.adm("POST", "/api/admin/rv/123456/claim", nil)
	if c != 404 || out["error"] == nil {
		t.Fatalf("claim odrzucony zdalnie: %d %v", c, out)
	}
	if n := len(e.s.st.S.Devices); n != 0 {
		t.Errorf("po nieudanym claim zostało %d urządzeń", n)
	}
}
