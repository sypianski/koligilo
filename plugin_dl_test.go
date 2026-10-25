package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"testing"
)

// TASK-39: serwer wskazuje wersję pluginu tylko czytnikowi ze zgodą, a suma w
// synchronizacji zgadza się co do bajta z tym, co serwuje /koligilo.koplugin.zip.
func TestSelfUpdateInfoMatchesServedZip(t *testing.T) {
	e := newPluginEnv(t)
	_, tok, err := e.s.st.Provision("Czytnik", "Test", "Android", "v2026.07")
	if err != nil {
		t.Fatal(err)
	}

	// Bez zgody nic o aktualizacji nie wychodzi.
	rec := e.do(tok, "GET", "/api/v1/sync", nil, "")
	var plain map[string]any
	json.Unmarshal(rec.Body.Bytes(), &plain)
	if _, ok := plain["self_update"]; ok {
		t.Fatalf("serwer wskazał aktualizację czytnikowi bez zgody: %v", plain["self_update"])
	}

	rec = e.do(tok, "GET", "/api/v1/sync?self_update=1", nil, "")
	var out struct {
		SelfUpdate struct {
			Version string `json:"version"`
			SHA256  string `json:"sha256"`
			Size    int    `json:"size"`
			URL     string `json:"url"`
		} `json:"self_update"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	su := out.SelfUpdate
	if su.Version == "" || su.URL != "/koligilo.koplugin.zip" {
		t.Fatalf("self_update = %+v", su)
	}

	// Zip serwowany bez zgody i bez tokenu (jak dotąd), ale z tą samą sumą.
	r := httptest.NewRequest("GET", su.URL, nil)
	w := httptest.NewRecorder()
	e.mux.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("zip: %d", w.Code)
	}
	sum := sha256.Sum256(w.Body.Bytes())
	if got := hex.EncodeToString(sum[:]); got != su.SHA256 || w.Body.Len() != su.Size {
		t.Errorf("zip: sha %s rozmiar %d, a synchronizacja zapowiedziała %s i %d", got, w.Body.Len(), su.SHA256, su.Size)
	}
	// Dwa pobrania dają te same bajty (bez tego suma by się rozjeżdżała).
	w2 := httptest.NewRecorder()
	e.mux.ServeHTTP(w2, httptest.NewRequest("GET", su.URL, nil))
	if w2.Body.String() != w.Body.String() {
		t.Error("zip różni się między pobraniami")
	}
}

// Wersja w _meta.lua to jedyne źródło prawdy dla czytnika; stała Version (nagłówek,
// nazwa pliku do pobrania) musi się z nią zgadzać, inaczej bump zostanie pominięty.
func TestVersionMatchesPluginMeta(t *testing.T) {
	info := selfUpdateInfo()
	if info == nil {
		t.Fatal("brak wskazania pluginu")
	}
	if info["version"] != Version {
		t.Errorf("_meta.lua: %v, main.go Version: %s — podbij oba naraz", info["version"], Version)
	}
}

// TASK-49: czytnik zgłasza wersję wtyczki i zgodę na samoaktualizację; panel dostaje je
// w state razem z wersją wtyczki wbudowanej w serwer.
func TestPluginVersionReported(t *testing.T) {
	e := newPluginEnv(t)
	d, tok, _ := e.s.st.Provision("Kobo", "", "", "")
	state := func() (map[string]any, map[string]any) {
		rec := e.do(e.admin, "GET", "/api/admin/state", nil, "")
		var out map[string]any
		json.Unmarshal(rec.Body.Bytes(), &out)
		devs, _ := out["devices"].([]any)
		if len(devs) != 1 {
			t.Fatalf("urządzenia: %v", out["devices"])
		}
		return out, devs[0].(map[string]any)
	}
	sync := func(q string) {
		if rec := e.do(tok, "GET", "/api/v1/sync"+q, nil, ""); rec.Code != 200 {
			t.Fatalf("sync%s: %d", q, rec.Code)
		}
	}

	// stary plugin: bez parametrów — pola puste, nic się nie psuje
	sync("")
	out, dev := state()
	if _, has := dev["plugin_version"]; has || dev["self_update_allowed"] != false {
		t.Errorf("bez parametrów: %v", dev)
	}
	// AC2: wersja wbudowanego pluginu = _meta.lua (= Version, pilnuje TestVersionMatchesPluginMeta)
	if out["server_plugin_version"] != selfUpdateInfo()["version"] || out["server_plugin_version"] == "" {
		t.Errorf("server_plugin_version: %v", out["server_plugin_version"])
	}

	sync("?plugin_version=0.8.1&self_update=1")
	_, dev = state()
	if dev["plugin_version"] != "0.8.1" || dev["self_update_allowed"] != true {
		t.Errorf("z parametrami: %v", dev)
	}
	if !e.s.st.S.Devices[d.ID].SelfUpdateAllowed {
		t.Error("zgoda nie zapamiętana")
	}
	// wersja bez zgody: zgoda cofnięta
	sync("?plugin_version=0.10.0")
	_, dev = state()
	if dev["plugin_version"] != "0.10.0" || dev["self_update_allowed"] != false {
		t.Errorf("cofnięta zgoda: %v", dev)
	}
	// dane z czytnika są niezaufane: zły format = puste pole
	for _, bad := range []string{"1.2", "1.2.3.4", "abc", "1.2.3-beta", "12345.1.1", "1.2.3%0A", "%3Cscript%3E"} {
		sync("?plugin_version=" + bad)
		if _, dev = state(); dev["plugin_version"] != nil {
			t.Errorf("zła wersja %q przyjęta: %v", bad, dev["plugin_version"])
		}
	}
}
