package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Wzorce wygenerowane przez Sync.serialize z pluginu — Go musi dawać
// identyczne bajty, inaczej plugin widziałby „zmianę” przy każdej synchronizacji.
func TestLuaMatchesPlugin(t *testing.T) {
	cases := []struct {
		v    any
		want string
	}{
		{[]any{
			map[string]any{"name": "Moj Dropbox", "type": "dropbox", "address": "k:s", "password": "tok", "url": "/"},
			map[string]any{"name": "Koofr", "type": "webdav", "address": "https://app.koofr.net/dav/Koofr",
				"username": "a@b.pl", "password": "p\"\\\n\x01ż", "url": "/koreader"},
		}, `{[1]={["address"]="k:s",["name"]="Moj Dropbox",["password"]="tok",["type"]="dropbox",["url"]="/"},[2]={["address"]="https://app.koofr.net/dav/Koofr",["name"]="Koofr",["password"]="p\"\\\n\001ż",["type"]="webdav",["url"]="/koreader",["username"]="a@b.pl"}}`},
		{map[string]any{"a": 1.5, "b": -3.0, "c": 1e20, "d": true, "e": map[string]any{}},
			`{["a"]=1.5,["b"]=-3,["c"]=1e+20,["d"]=true,["e"]={}}`},
	}
	for _, c := range cases {
		got, err := encodeLua(c.v)
		if err != nil || got != c.want {
			t.Errorf("encodeLua:\n got %s (%v)\nwant %s", got, err, c.want)
		}
		back, err := decodeLua(c.want)
		if err != nil {
			t.Fatalf("decodeLua(%s): %v", c.want, err)
		}
		if again, _ := encodeLua(back); again != c.want {
			t.Errorf("roundtrip: %s", again)
		}
	}
	for _, evil := range []string{`os.exit(1)`, `{[1]=print}`, `{[1]=1`, `"\300"`, `1 2`, `{[1]=1,["a"]=2}`, `{[2]=1}`} {
		if _, err := decodeLua(evil); err == nil {
			t.Errorf("decodeLua przyjął %q", evil)
		}
	}
}

type harness struct {
	t *testing.T
	s *Server
	h http.Handler
}

func newHarness(t *testing.T) *harness {
	st, admin, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{st: st}
	hh := &harness{t: t, s: s}
	mux := s.Routes()
	hh.h = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Header.Set("Authorization", "Bearer "+admin)
		mux.ServeHTTP(w, r)
	})
	return hh
}

func (hh *harness) call(method, path string, body any) (int, map[string]any) {
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	hh.h.ServeHTTP(rec, req)
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func (hh *harness) val(id string) string {
	if v := hh.s.st.Get(id); v != nil {
		return *v
	}
	return "<brak>"
}

func TestKosyncAccount(t *testing.T) {
	hh := newHarness(t)
	if c, _ := hh.call("PUT", "/api/admin/accounts/kosync", map[string]string{"username": "jakub"}); c != 400 {
		t.Errorf("bez hasła za pierwszym razem: %d, chcę 400", c)
	}
	c, _ := hh.call("PUT", "/api/admin/accounts/kosync", map[string]string{"server": "sync.example.com/", "username": "jakub", "password": "tajne"})
	if c != 200 {
		t.Fatalf("zapis: %d", c)
	}
	// md5("tajne") — tak samo liczy KOReader
	if got := hh.val(kosyncFile + "userkey"); got != `"77f869401de682f60e0e749493ab793d"` {
		t.Errorf("userkey = %s", got)
	}
	if got := hh.val(kosyncFile + "custom_server"); got != `"https://sync.example.com"` {
		t.Errorf("custom_server = %s", got)
	}
	key := hh.val(kosyncFile + "userkey")
	hh.call("PUT", "/api/admin/accounts/kosync", map[string]string{"username": "jakub2"})
	if hh.val(kosyncFile+"userkey") != key {
		t.Error("puste hasło przy edycji nie powinno zmieniać userkey")
	}
	if hh.val(kosyncFile+"custom_server") != "<brak>" {
		t.Error("pusty adres = domyślny serwer KOReadera → custom_server usunięty")
	}
	_, acc := hh.call("GET", "/api/admin/accounts", nil)
	k := acc["kosync"].(map[string]any)
	if k["username"] != "jakub2" || k["has_password"] != true {
		t.Errorf("GET kosync = %v", k)
	}
	if strings.Contains(mustJSON(acc), strings.Trim(key, `"`)) {
		t.Error("GET nie może zwracać userkey")
	}
}

// sync_forward/sync_backward/checksum_method to enumy liczbowe kosync.koplugin
// (SYNC_STRATEGY 1..3, CHECKSUM_METHOD 0..1) — NIE bool ani string. Zapis
// karty, który nie dotyka tych pól (bo panel wysyła tylko zmienione), nie
// może ich nadpisać/skasować; GET musi zwrócić liczby, nie true/false.
func TestKosyncEnumFields(t *testing.T) {
	hh := newHarness(t)
	hh.call("PUT", "/api/admin/accounts/kosync", map[string]any{"server": "sync.example.com", "username": "jakub", "password": "tajne"})
	// symulujemy stan zsynchronizowany ze starego KOReadera: sync_forward=2 (Silent), checksum_method=1 (Filename)
	two, one := "2", "1"
	hh.s.st.SetFromPanel(map[string]*string{kosyncFile + "sync_forward": &two, kosyncFile + "checksum_method": &one})

	// zapis samego loginu (bez enumów w body) NIE może ich ruszyć
	if c, out := hh.call("PUT", "/api/admin/accounts/kosync", map[string]any{"username": "jakub2", "server": "sync.example.com"}); c != 200 {
		t.Fatalf("zapis: %d %v", c, out)
	}
	if hh.val(kosyncFile+"sync_forward") != "2" {
		t.Errorf("sync_forward nadpisany mimo braku w body: %s", hh.val(kosyncFile+"sync_forward"))
	}
	if hh.val(kosyncFile+"checksum_method") != "1" {
		t.Errorf("checksum_method nadpisany mimo braku w body: %s", hh.val(kosyncFile+"checksum_method"))
	}

	_, acc := hh.call("GET", "/api/admin/accounts", nil)
	k := acc["kosync"].(map[string]any)
	if k["sync_forward"] != float64(2) || k["checksum_method"] != float64(1) {
		t.Errorf("GET kosync enumy = %v (chcę liczby 2 i 1)", k)
	}

	// poza zakresem → 400, nic nie zmienia
	if c, out := hh.call("PUT", "/api/admin/accounts/kosync", map[string]any{"username": "jakub2", "server": "sync.example.com", "sync_forward": 4}); c != 400 {
		t.Errorf("sync_forward=4: %d %v, chcę 400", c, out)
	}
	if hh.val(kosyncFile+"sync_forward") != "2" {
		t.Errorf("zły zakres nie powinien niczego zmienić: %s", hh.val(kosyncFile+"sync_forward"))
	}

	// jawna zmiana działa
	hh.call("PUT", "/api/admin/accounts/kosync", map[string]any{"username": "jakub2", "server": "sync.example.com", "sync_backward": 3, "auto_sync": true})
	if hh.val(kosyncFile+"sync_backward") != "3" {
		t.Errorf("sync_backward po jawnej zmianie: %s", hh.val(kosyncFile+"sync_backward"))
	}
	if hh.val(kosyncFile+"auto_sync") != "true" {
		t.Errorf("auto_sync po jawnej zmianie: %s", hh.val(kosyncFile+"auto_sync"))
	}
}

func TestCloudAndTargets(t *testing.T) {
	hh := newHarness(t)
	dbx := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		if r.Form.Get("code") != "dobry" || r.Form.Get("client_id") != "KEY" || r.Form.Get("client_secret") != "SEC" {
			w.WriteHeader(400)
			w.Write([]byte(`{"error":"invalid_grant","error_description":"code doesn't exist or has expired"}`))
			return
		}
		w.Write([]byte(`{"access_token":"krotki","refresh_token":"REFRESH"}`))
	}))
	defer dbx.Close()
	old := dropboxTokenURL
	dropboxTokenURL = dbx.URL
	defer func() { dropboxTokenURL = old }()

	add := map[string]any{"index": -1, "type": "dropbox", "name": "Dropbox", "app_key": "KEY", "app_secret": "SEC", "code": "zły"}
	if c, out := hh.call("POST", "/api/admin/accounts/cloud", add); c != 400 || !strings.Contains(out["error"].(string), "expired") {
		t.Errorf("zły kod: %d %v", c, out)
	}
	add["code"] = "dobry"
	if c, out := hh.call("POST", "/api/admin/accounts/cloud", add); c != 200 {
		t.Fatalf("dodanie Dropboxa: %d %v", c, out)
	}
	hh.call("POST", "/api/admin/accounts/cloud", map[string]any{"index": -1, "type": "webdav", "name": "Koofr",
		"address": "https://app.koofr.net/dav/Koofr", "username": "a@b.pl", "password": "p1", "folder": "koreader/"})
	want := `{[1]={["address"]="KEY:SEC",["name"]="Dropbox",["password"]="REFRESH",["type"]="dropbox",["url"]="/"},[2]={["address"]="https://app.koofr.net/dav/Koofr",["name"]="Koofr",["password"]="p1",["type"]="webdav",["url"]="/koreader",["username"]="a@b.pl"}}`
	if got := hh.val(cloudID); got != want {
		t.Errorf("cs_servers:\n got %s\nwant %s", got, want)
	}

	// statystyki na Dropboxie, folder /koreader
	if c, out := hh.call("PUT", "/api/admin/accounts/target/statystyki", map[string]any{"account": 0, "folder": "/koreader/"}); c != 200 {
		t.Fatalf("cel: %d %v", c, out)
	}
	if got := hh.val(readerFile + "|statistics.sync_server"); got != `{["address"]="KEY:SEC",["name"]="Dropbox",["password"]="REFRESH",["type"]="dropbox",["url"]="/koreader"}` {
		t.Errorf("sync_server = %s", got)
	}

	// zmiana sekretu aplikacji: puste pola tokenu zostawiają stary token,
	// a kopia w statystykach aktualizuje się razem z kontem
	hh.call("POST", "/api/admin/accounts/cloud", map[string]any{"index": 0, "name": "Dropbox", "app_secret": "NOWY"})
	if got := hh.val(readerFile + "|statistics.sync_server"); !strings.Contains(got, `"KEY:NOWY"`) || !strings.Contains(got, `"REFRESH"`) || !strings.Contains(got, `"/koreader"`) {
		t.Errorf("kopia w statystykach nie nadążyła: %s", got)
	}

	// hasło WebDAV nie wraca do przeglądarki
	_, acc := hh.call("GET", "/api/admin/accounts", nil)
	if s := mustJSON(acc); strings.Contains(s, "p1") || strings.Contains(s, "REFRESH") || strings.Contains(s, "NOWY") {
		t.Errorf("GET zdradza sekrety: %s", s)
	}
	tg := acc["targets"].(map[string]any)["statystyki"].(map[string]any)
	if tg["account"].(float64) != 0 || tg["folder"] != "/koreader" {
		t.Errorf("GET targets = %v", tg)
	}

	// konto z krótkotrwałym tokenem KOReadera nie może zostać celem
	broken := `{[1]={["address"]="K:S",["name"]="Zepsute",["password"]="krotki",["type"]="dropbox",["url"]="/",["username"]=true}}`
	hh.s.st.SetFromPanel(map[string]*string{cloudID: &broken})
	if c, _ := hh.call("PUT", "/api/admin/accounts/target/slowniczek", map[string]any{"account": 0}); c != 400 {
		t.Errorf("cel z tokenem sesji: %d, chcę 400", c)
	}
	// …a ponowne połączenie zdejmuje flagę sesji
	hh.call("POST", "/api/admin/accounts/cloud", map[string]any{"index": 0, "name": "Zepsute", "refresh_token": "R2"})
	if got := hh.val(cloudID); strings.Contains(got, "username") || !strings.Contains(got, `"R2"`) {
		t.Errorf("po naprawie: %s", got)
	}

	if c, _ := hh.call("DELETE", "/api/admin/accounts/cloud/0", nil); c != 200 || hh.val(cloudID) != "{}" {
		t.Errorf("usunięcie ostatniego konta: %s", hh.val(cloudID))
	}
}

func TestWallabagAccount(t *testing.T) {
	hh := newHarness(t)
	in := map[string]string{"server_url": "wb.example.com", "client_id": "id", "client_secret": "cs", "username": "u", "password": "pw"}
	if c, out := hh.call("PUT", "/api/admin/accounts/wallabag", in); c != 200 {
		t.Fatalf("%d %v", c, out)
	}
	in["client_secret"], in["password"] = "", ""
	hh.call("PUT", "/api/admin/accounts/wallabag", in)
	if hh.val(wallabagFile+"password") != `"pw"` || hh.val(wallabagFile+"server_url") != `"https://wb.example.com"` {
		t.Errorf("wallabag: %s %s", hh.val(wallabagFile+"password"), hh.val(wallabagFile+"server_url"))
	}
	hh.call("DELETE", "/api/admin/accounts/wallabag", nil)
	if v := hh.s.st.S.Values[wallabagFile+"password"]; v == nil || v.V != nil || v.Dev != PanelDev {
		t.Error("usunięcie konta ma zostawić nagrobek od panelu")
	}
}

func TestRosettaAccount(t *testing.T) {
	hh := newHarness(t)
	if c, out := hh.call("PUT", "/api/admin/accounts/rosetta", map[string]string{"ai_base_url": "https://api.example.com/v1"}); c != 400 {
		t.Errorf("bez klucza za pierwszym razem: %d %v, chcę 400", c, out)
	}
	c, out := hh.call("PUT", "/api/admin/accounts/rosetta", map[string]string{
		"ai_base_url": "https://api.example.com/v1", "ai_model": "gpt-4o-mini",
		"ai_max_tokens": "2048", "ai_temperature": "0.3", "api_key": "sk-tajny"})
	if c != 200 {
		t.Fatalf("zapis: %d %v", c, out)
	}
	// klucz idzie do OBU nazw pola — plugin zna go pod dowolną z nich
	if hh.val(rosettaFile+"ai_api_key") != `"sk-tajny"` || hh.val(rosettaFile+"api_key") != `"sk-tajny"` {
		t.Errorf("klucz API nie zapisany w obu polach: %s / %s", hh.val(rosettaFile+"ai_api_key"), hh.val(rosettaFile+"api_key"))
	}
	if hh.val(rosettaFile+"ai_max_tokens") != "2048" {
		t.Errorf("ai_max_tokens = %s", hh.val(rosettaFile+"ai_max_tokens"))
	}

	// edycja bez podania klucza zostawia stary
	hh.call("PUT", "/api/admin/accounts/rosetta", map[string]string{"ai_base_url": "https://api.example.com/v1", "ai_model": "gpt-4o"})
	if hh.val(rosettaFile+"ai_api_key") != `"sk-tajny"` {
		t.Error("puste pole klucza przy edycji nie powinno kasować starego")
	}
	if hh.val(rosettaFile+"ai_model") != `"gpt-4o"` {
		t.Errorf("ai_model po edycji = %s", hh.val(rosettaFile+"ai_model"))
	}

	// GET nie oddaje klucza, tylko flagę
	_, acc := hh.call("GET", "/api/admin/accounts", nil)
	ro := acc["rosetta"].(map[string]any)
	if ro["has_api_key"] != true || ro["ai_model"] != "gpt-4o" {
		t.Errorf("GET rosetta = %v", ro)
	}
	if strings.Contains(mustJSON(acc), "sk-tajny") {
		t.Error("GET nie może zwracać klucza API")
	}

	// usunięcie czyści wszystkie klucze grupy
	hh.call("DELETE", "/api/admin/accounts/rosetta", nil)
	for _, k := range []string{"ai_api_key", "api_key", "ai_base_url", "ai_model", "ai_max_tokens", "ai_temperature"} {
		v := hh.s.st.S.Values[rosettaFile+k]
		if v == nil || v.V != nil {
			t.Errorf("po usunięciu %s powinien zostać nagrobek", k)
		}
	}
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
