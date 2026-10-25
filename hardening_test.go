package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// rawCall: ciało wysłane bajt w bajt (call() koduje JSON, więc nie nadaje się
// do zepsutego ciała).
func (hh *harness) rawCall(method, path, body string) int {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	rec := httptest.NewRecorder()
	hh.h.ServeHTTP(rec, req)
	return rec.Code
}

// TASK-52: zepsute ciało to 400, a nie ciche „odrzuć czytnik” (Approve=false).
func TestAdminHandlersRejectBadJSON(t *testing.T) {
	hh := newHarness(t)
	d, _, err := hh.s.st.Provision("Deck", "", "", "")
	if err != nil {
		t.Fatal(err)
	}

	c, out := hh.call("POST", "/api/v1/pair", map[string]string{"Name": "Kobo"})
	if c != 200 {
		t.Fatalf("pair start: %d %v", c, out)
	}
	id, _ := out["id"].(string)
	if id == "" {
		t.Fatalf("brak id prośby: %v", out)
	}

	for _, tc := range []struct{ name, path string }{
		{"decide", "/api/admin/pair/" + id},
		{"groups", "/api/admin/devices/" + d.ID + "/groups"},
		{"rename", "/api/admin/devices/" + d.ID + "/rename"},
	} {
		if got := hh.rawCall("POST", tc.path, "{nie json"); got != 400 {
			t.Errorf("%s: zepsuty JSON dał %d, chcę 400", tc.name, got)
		}
		if got := hh.rawCall("POST", tc.path, ""); got != 400 {
			t.Errorf("%s: puste ciało dało %d, chcę 400", tc.name, got)
		}
	}
	// prośba o parowanie nie została po cichu odrzucona
	if p := hh.s.st.Pending(); len(p) != 1 {
		t.Errorf("prośba o parowanie powinna nadal czekać, jest %d", len(p))
	}
}

// TASK-52: mapa nieudanych prób nie zatrzymuje IP, które już się uspokoiły.
func TestTooManyDropsExpiredIPs(t *testing.T) {
	rv := NewRendezvous()
	rv.failures["1.2.3.4"] = []time.Time{time.Now().Add(-2 * rvTTL)}
	if rv.tooMany("1.2.3.4") {
		t.Error("przeterminowane próby nie mogą blokować")
	}
	if _, ok := rv.failures["1.2.3.4"]; ok {
		t.Error("pusty wpis IP powinien zniknąć z mapy")
	}

	for i := 0; i < 10; i++ {
		rv.fail("5.6.7.8")
	}
	if !rv.tooMany("5.6.7.8") {
		t.Error("10 świeżych prób powinno blokować")
	}
}

func TestNewHTTPServerHasLimits(t *testing.T) {
	srv := newHTTPServer(http.NotFoundHandler())
	if srv.ReadHeaderTimeout <= 0 || srv.IdleTimeout <= 0 {
		t.Errorf("brak limitów: header=%v idle=%v", srv.ReadHeaderTimeout, srv.IdleTimeout)
	}
	if srv.WriteTimeout != 0 || srv.ReadTimeout != 0 {
		t.Error("ReadTimeout/WriteTimeout zerwałyby długie pobrania i import kopii")
	}
}

// TASK-52: zapis przez plik tymczasowy zostawia czysty katalog i dane do odczytu.
func TestSaveLockedPersistsWithoutLeftovers(t *testing.T) {
	dir := t.TempDir()
	st, _, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	d, _, err := st.Provision("Deck", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(st.path + ".tmp"); !os.IsNotExist(err) {
		t.Errorf("plik .tmp nie powinien zostać: %v", err)
	}
	st2, _, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if st2.S.Devices[d.ID] == nil {
		t.Error("urządzenie nie przetrwało ponownego otwarcia stanu")
	}
}
