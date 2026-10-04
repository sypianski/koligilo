package main

import (
	"bytes"
	"net/http/httptest"
	"testing"
)

// TASK-1: POST /api/admin/values — zapis i usuwanie wartości wprost z panelu.

func TestAdminValuesSet(t *testing.T) {
	hh := newHarness(t)
	id := readerFile + "|copt_font_size" // grupa "uklad"
	c, out := hh.call("POST", "/api/admin/values", map[string]any{"set": map[string]string{id: "24"}})
	if c != 200 {
		t.Fatalf("zapis: %d %v", c, out)
	}
	if got := hh.val(id); got != "24" {
		t.Errorf("wartość po zapisie = %s, chcę 24", got)
	}
	v := hh.s.st.S.Values[id]
	if v == nil || v.Dev != PanelDev {
		t.Errorf("autor zapisu = %v, chcę panel", v)
	}
}

func TestAdminValuesDelete(t *testing.T) {
	hh := newHarness(t)
	id := readerFile + "|copt_font_size"
	if c, out := hh.call("POST", "/api/admin/values", map[string]any{"set": map[string]string{id: "24"}}); c != 200 {
		t.Fatalf("zapis wstępny: %d %v", c, out)
	}
	c, out := hh.call("POST", "/api/admin/values", map[string]any{"delete": []string{id}})
	if c != 200 {
		t.Fatalf("usunięcie: %d %v", c, out)
	}
	v := hh.s.st.S.Values[id]
	if v == nil || v.V != nil {
		t.Errorf("po usunięciu chcę nagrobek (V=nil), mam %v", v)
	}
	if v.Dev != PanelDev {
		t.Errorf("autor nagrobka = %s, chcę panel", v.Dev)
	}
}

func TestAdminValuesRejectUnknownID(t *testing.T) {
	hh := newHarness(t)
	id := readerFile + "|device_id" // spoza katalogu (patrz TestCatalogMatches)
	c, out := hh.call("POST", "/api/admin/values", map[string]any{"set": map[string]string{id: `"hack"`}})
	if c != 400 {
		t.Fatalf("ID spoza katalogu: %d %v, chcę 400", c, out)
	}
	if e, _ := out["error"].(string); e == "" || !contains(e, id) {
		t.Errorf("błąd powinien nazywać ID: %v", out)
	}
}

func TestAdminValuesRejectBadLiteral(t *testing.T) {
	hh := newHarness(t)
	id := readerFile + "|copt_font_size"
	c, out := hh.call("POST", "/api/admin/values", map[string]any{"set": map[string]string{id: "os.exit(1)"}})
	if c != 400 {
		t.Fatalf("zły literał: %d %v, chcę 400", c, out)
	}
	if hh.val(id) != "<brak>" {
		t.Error("zły literał nie powinien nic zapisać")
	}
}

func TestAdminValuesSecretNeverLeaks(t *testing.T) {
	hh := newHarness(t)
	id := kosyncFile + "username" // grupa "konto_kosync" — Secret
	if c, out := hh.call("POST", "/api/admin/values", map[string]any{"set": map[string]string{id: `"jakub"`}}); c != 200 {
		t.Fatalf("zapis sekretu: %d %v", c, out)
	}
	// Wallabag i Rosetta — reszta grup Secret (TASK-21 AC3).
	hh.call("PUT", "/api/admin/accounts/wallabag", map[string]string{
		"server_url": "wb.example.com", "client_id": "id", "client_secret": "cs", "username": "u", "password": "sekretne-haslo"})
	hh.call("PUT", "/api/admin/accounts/rosetta", map[string]string{"api_key": "sk-tajny-klucz"})

	_, st := hh.call("GET", "/api/admin/state", nil)
	body := mustJSON(st)
	for _, secret := range []string{"jakub", "sekretne-haslo", "sk-tajny-klucz"} {
		if contains(body, secret) {
			t.Errorf("adminState nie może zdradzać treści grupy Secret (znaleziono %q)", secret)
		}
	}
	// GET pojedynczej wartości też odmawia
	c, out := hh.call("GET", "/api/admin/values/"+id, nil)
	if c != 403 {
		t.Errorf("GET wartości Secret: %d %v, chcę 403", c, out)
	}
	c, out = hh.call("GET", "/api/admin/values/"+rosettaFile+"ai_api_key", nil)
	if c != 403 {
		t.Errorf("GET klucza Rosetty: %d %v, chcę 403", c, out)
	}

	// /api/admin/accounts też nie może zdradzać sekretów, tylko flagi has_*.
	_, acc := hh.call("GET", "/api/admin/accounts", nil)
	accBody := mustJSON(acc)
	for _, secret := range []string{"sekretne-haslo", "sk-tajny-klucz"} {
		if contains(accBody, secret) {
			t.Errorf("GET /api/admin/accounts zdradza sekret %q", secret)
		}
	}
}

// TASK-21 AC1: grupy Secret nie mają się pojawiać w widoku wspólnych
// ustawień (odfiltrowane po stronie web/app.js) — tu pilnujemy tylko, że
// adminState oznacza je jako sekret w katalogu, żeby front-end miał po czym
// filtrować (marker "secret" na Group).
func TestAdminStateMarksSecretGroups(t *testing.T) {
	hh := newHarness(t)
	_, st := hh.call("GET", "/api/admin/state", nil)
	catalog, _ := st["catalog"].([]any)
	if len(catalog) == 0 {
		t.Fatal("pusty katalog w adminState")
	}
	want := map[string]bool{"konto_kosync": true, "konto_wallabag": true, "konta_chmura": true,
		"konto_statystyki": true, "rosetta_klucze": true}
	got := map[string]bool{}
	for _, gi := range catalog {
		g, _ := gi.(map[string]any)
		id, _ := g["id"].(string)
		if secret, _ := g["secret"].(bool); secret {
			got[id] = true
		}
	}
	for id := range want {
		if !got[id] {
			t.Errorf("grupa %s powinna być oznaczona jako secret", id)
		}
	}
}

func TestAdminValuesGetFull(t *testing.T) {
	hh := newHarness(t)
	id := readerFile + "|copt_font_size"
	hh.call("POST", "/api/admin/values", map[string]any{"set": map[string]string{id: "24"}})
	c, out := hh.call("GET", "/api/admin/values/"+id, nil)
	if c != 200 || out["value"] != "24" {
		t.Errorf("GET pełnej wartości: %d %v", c, out)
	}
}

// Ochrona przed CSRF z formularza w obcej karcie: bez application/json
// żądanie nie przechodzi, nawet z poprawnym tokenem admina w nagłówku.
func TestAdminValuesRequiresJSONContentType(t *testing.T) {
	hh := newHarness(t)
	id := readerFile + "|copt_font_size"
	body := []byte(`{"set":{"` + id + `":"24"}}`)
	req := httptest.NewRequest("POST", "/api/admin/values", bytes.NewReader(body))
	req.Header.Set("Content-Type", "text/plain;charset=UTF-8")
	rec := httptest.NewRecorder()
	hh.h.ServeHTTP(rec, req)
	if rec.Code != 415 {
		t.Errorf("bez application/json: %d, chcę 415", rec.Code)
	}
	if hh.val(id) != "<brak>" {
		t.Error("żądanie odrzucone przez 415 nie powinno nic zapisać")
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
