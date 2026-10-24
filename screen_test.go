package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestParseScreen(t *testing.T) {
	for in, want := range map[string]*Screen{
		"1404x1872@227":   {W: 1404, H: 1872, DPI: 227},
		"1404x1872@227,c": {W: 1404, H: 1872, DPI: 227, Color: true},
		"1280x800@216":    {W: 1280, H: 800, DPI: 216},
		"":                nil,
		"1404x1872":       nil,
		"100x1872@227":    nil, // za wąski
		"1404x99999@227":  nil,
		"1404x1872@5":     nil,
		"1404x1872@227x":  nil, // śmieci za liczbami
		"1404x1872@227,d": nil,
		"axb@c":           nil,
	} {
		got := ParseScreen(in)
		if (got == nil) != (want == nil) || (got != nil && *got != *want) {
			t.Errorf("ParseScreen(%q) = %+v, chcę %+v", in, got, want)
		}
	}
}

// Czytnik zgłasza ekran przy synchronizacji; panel dostaje go w stanie, a state.json
// zmienia się tylko wtedy, gdy ekran się zmienił.
func TestScreenReportedOnSync(t *testing.T) {
	e := newPluginEnv(t)
	d, tok, err := e.s.st.Provision("Nowy", "Nowy 1", "Android", "v2026.07")
	if err != nil {
		t.Fatal(err)
	}
	if d.Screen != nil {
		t.Fatalf("nowy czytnik ma ekran z niczego: %+v", d.Screen)
	}
	if rec := e.do(tok, "GET", "/api/v1/sync?screen=1404x1872@227,c", nil, ""); rec.Code != 200 {
		t.Fatalf("sync: %d %s", rec.Code, rec.Body)
	}
	if got := e.s.st.S.Devices[d.ID].Screen; got == nil || *got != (Screen{W: 1404, H: 1872, DPI: 227, Color: true}) {
		t.Fatalf("ekran po sync = %+v", got)
	}
	c, out := e.jsonDo(e.admin, "GET", "/api/admin/state", nil)
	if c != 200 {
		t.Fatalf("state: %d", c)
	}
	raw, _ := json.Marshal(out["devices"])
	var devs []struct {
		Screen *Screen `json:"screen"`
	}
	json.Unmarshal(raw, &devs)
	if len(devs) != 1 || devs[0].Screen == nil || devs[0].Screen.W != 1404 || !devs[0].Screen.Color {
		t.Errorf("panel nie dostał ekranu: %s", raw)
	}

	// Zły parametr nie kasuje zapisanego ekranu; brak parametru (stary plugin) też nie.
	for _, q := range []string{"?screen=bzdura", "?screen=1x1@1", ""} {
		if rec := e.do(tok, "GET", "/api/v1/sync"+q, nil, ""); rec.Code != 200 {
			t.Fatalf("sync%s: %d", q, rec.Code)
		}
		if got := e.s.st.S.Devices[d.ID].Screen; got == nil || got.W != 1404 {
			t.Errorf("sync%s skasował ekran: %+v", q, got)
		}
	}

	// Ten sam ekran nie przepisuje pliku; inny (obrót) go aktualizuje.
	path := filepath.Join(e.s.st.Dir(), "state.json")
	before, _ := os.Stat(path)
	e.do(tok, "GET", "/api/v1/sync?screen=1404x1872@227,c", nil, "")
	after, _ := os.Stat(path)
	if !after.ModTime().Equal(before.ModTime()) {
		t.Error("niezmieniony ekran przepisał state.json")
	}
	e.do(tok, "GET", "/api/v1/sync?screen=1872x1404@227,c", nil, "")
	if got := e.s.st.S.Devices[d.ID].Screen; got.W != 1872 || got.H != 1404 {
		t.Errorf("zmiana ekranu nie zapisana: %+v", got)
	}
}
