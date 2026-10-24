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
