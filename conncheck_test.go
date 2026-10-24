package main

import (
	"bufio"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func testResult(t *testing.T, hh *harness, path string) (int, bool, string) {
	t.Helper()
	c, out := hh.call("POST", path, nil)
	ok, _ := out["ok"].(bool)
	msg, _ := out["message"].(string)
	if e, _ := out["error"].(string); e != "" {
		msg = e
	}
	return c, ok, msg
}

// Bez zapisanego konta nic nie jest testowane (i nie ma dokąd wysłać żądania).
func TestConnCheckNeedsSavedAccount(t *testing.T) {
	hh := newHarness(t)
	for _, p := range []string{"/api/admin/accounts/kosync/test", "/api/admin/accounts/wallabag/test", "/api/admin/accounts/cloud/0/test"} {
		if c, _, _ := testResult(t, hh, p); c != 409 {
			t.Errorf("%s bez konta: %d, chcę 409", p, c)
		}
	}
}

func TestConnCheckKosync(t *testing.T) {
	hh := newHarness(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/users/auth" {
			w.WriteHeader(404)
			return
		}
		// md5("tajne")
		if r.Header.Get("x-auth-user") == "jakub" && r.Header.Get("x-auth-key") == "77f869401de682f60e0e749493ab793d" {
			w.Write([]byte(`{"authorized":"OK"}`))
			return
		}
		w.WriteHeader(401)
	}))
	defer srv.Close()
	hh.call("PUT", "/api/admin/accounts/kosync", map[string]string{"server": srv.URL, "username": "jakub", "password": "tajne"})
	if c, ok, msg := testResult(t, hh, "/api/admin/accounts/kosync/test"); c != 200 || !ok {
		t.Errorf("dobre dane: %d %v %q", c, ok, msg)
	}
	hh.call("PUT", "/api/admin/accounts/kosync", map[string]string{"server": srv.URL, "username": "inny"})
	if c, ok, msg := testResult(t, hh, "/api/admin/accounts/kosync/test"); c != 200 || ok || !strings.Contains(msg, "odrzucił") {
		t.Errorf("zły login: %d %v %q", c, ok, msg)
	}
}

func TestConnCheckWallabag(t *testing.T) {
	hh := newHarness(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		switch {
		case r.URL.Path != "/oauth/v2/token":
			w.WriteHeader(404)
		case r.Form.Get("client_id") != "id":
			w.WriteHeader(400)
			w.Write([]byte(`{"error":"invalid_client"}`))
		case r.Form.Get("password") != "pw":
			w.WriteHeader(400)
			w.Write([]byte(`{"error":"invalid_grant"}`))
		default:
			w.Write([]byte(`{"access_token":"T"}`))
		}
	}))
	defer srv.Close()
	in := map[string]string{"server_url": srv.URL, "client_id": "id", "client_secret": "cs", "username": "u", "password": "pw"}
	hh.call("PUT", "/api/admin/accounts/wallabag", in)
	if _, ok, msg := testResult(t, hh, "/api/admin/accounts/wallabag/test"); !ok {
		t.Errorf("dobre dane: %q", msg)
	}
	in["password"] = "zle"
	hh.call("PUT", "/api/admin/accounts/wallabag", in)
	if _, ok, msg := testResult(t, hh, "/api/admin/accounts/wallabag/test"); ok || !strings.Contains(msg, "login lub hasło") {
		t.Errorf("złe hasło: %v %q", ok, msg)
	}
	in["client_id"] = "inny"
	hh.call("PUT", "/api/admin/accounts/wallabag", in)
	if _, ok, msg := testResult(t, hh, "/api/admin/accounts/wallabag/test"); ok || !strings.Contains(msg, "Client ID") {
		t.Errorf("zły client: %v %q", ok, msg)
	}
}

func TestConnCheckDropbox(t *testing.T) {
	hh := newHarness(t)
	dbx := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		if r.Form.Get("grant_type") == "refresh_token" && r.Form.Get("refresh_token") == "R" && r.Form.Get("client_id") == "K" && r.Form.Get("client_secret") == "S" {
			w.Write([]byte(`{"access_token":"A"}`))
			return
		}
		w.WriteHeader(400)
		w.Write([]byte(`{"error":"invalid_grant"}`))
	}))
	defer dbx.Close()
	old := dropboxTokenURL
	dropboxTokenURL = dbx.URL
	defer func() { dropboxTokenURL = old }()

	good := `{[1]={["address"]="K:S",["name"]="D",["password"]="R",["type"]="dropbox",["url"]="/"}}`
	hh.s.st.SetFromPanel(map[string]*string{cloudID: &good})
	if _, ok, msg := testResult(t, hh, "/api/admin/accounts/cloud/0/test"); !ok {
		t.Errorf("dobry token: %q", msg)
	}
	revoked := strings.Replace(good, `"R"`, `"X"`, 1)
	hh.s.st.SetFromPanel(map[string]*string{cloudID: &revoked})
	if _, ok, msg := testResult(t, hh, "/api/admin/accounts/cloud/0/test"); ok || !strings.Contains(msg, "połącz konto ponownie") {
		t.Errorf("cofnięty token: %v %q", ok, msg)
	}
	// token sesji KOReadera (username=true) nie jest testowany jako dobry
	broken := `{[1]={["address"]="K:S",["name"]="Z",["password"]="krotki",["type"]="dropbox",["url"]="/",["username"]=true}}`
	hh.s.st.SetFromPanel(map[string]*string{cloudID: &broken})
	if _, ok, msg := testResult(t, hh, "/api/admin/accounts/cloud/0/test"); ok || !strings.Contains(msg, "krótkotrwały") {
		t.Errorf("token sesji: %v %q", ok, msg)
	}
	if c, _, _ := testResult(t, hh, "/api/admin/accounts/cloud/7/test"); c != 409 {
		t.Errorf("zły indeks: %d, chcę 409", c)
	}
}

func TestConnCheckWebDAV(t *testing.T) {
	hh := newHarness(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, p, _ := r.BasicAuth()
		switch {
		case r.Method != "PROPFIND" || r.Header.Get("Depth") != "0":
			w.WriteHeader(405)
		case u != "a@b.pl" || p != "p1":
			w.WriteHeader(401)
		case r.URL.Path == "/dav" || r.URL.Path == "/dav/koreader":
			w.WriteHeader(207)
		default:
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()
	set := func(user, pass, folder string) {
		v := `{[1]={["address"]="` + srv.URL + `/dav/",["name"]="W",["password"]="` + pass + `",["type"]="webdav",["url"]="` + folder + `",["username"]="` + user + `"}}`
		hh.s.st.SetFromPanel(map[string]*string{cloudID: &v})
	}
	const p = "/api/admin/accounts/cloud/0/test"
	set("a@b.pl", "p1", "/koreader")
	if _, ok, msg := testResult(t, hh, p); !ok {
		t.Errorf("dobre dane: %q", msg)
	}
	set("a@b.pl", "zle", "/koreader")
	if _, ok, msg := testResult(t, hh, p); ok || !strings.Contains(msg, "login lub hasło") {
		t.Errorf("złe hasło: %v %q", ok, msg)
	}
	set("a@b.pl", "p1", "/nie-ma")
	if _, ok, msg := testResult(t, hh, p); ok || !strings.Contains(msg, "folderu") {
		t.Errorf("brak folderu: %v %q", ok, msg)
	}
}

// Minimalny serwer FTP: 220, USER, PASS → 230 albo 530, QUIT.
func fakeFTP(t *testing.T, user, pass string) string {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				c.Write([]byte("220 fake\r\n"))
				rd := bufio.NewReader(c)
				var gotUser string
				for {
					line, err := rd.ReadString('\n')
					if err != nil {
						return
					}
					line = strings.TrimSpace(line)
					switch {
					case strings.HasPrefix(line, "USER "):
						gotUser = line[5:]
						c.Write([]byte("331 hasło\r\n"))
					case strings.HasPrefix(line, "PASS "):
						if gotUser == user && line[5:] == pass {
							c.Write([]byte("230 ok\r\n"))
						} else {
							c.Write([]byte("530 nie\r\n"))
						}
					case line == "QUIT":
						c.Write([]byte("221 pa\r\n"))
						return
					}
				}
			}(c)
		}
	}()
	return "ftp://" + ln.Addr().String()
}

func TestConnCheckFTP(t *testing.T) {
	addr := fakeFTP(t, "jan", "sekret")
	hh := newHarness(t)
	set := func(pass string) {
		v := `{[1]={["address"]="` + addr + `",["name"]="F",["password"]="` + pass + `",["type"]="ftp",["url"]="/",["username"]="jan"}}`
		hh.s.st.SetFromPanel(map[string]*string{cloudID: &v})
	}
	set("sekret")
	if _, ok, msg := testResult(t, hh, "/api/admin/accounts/cloud/0/test"); !ok {
		t.Errorf("dobre dane: %q", msg)
	}
	set("zle")
	if _, ok, msg := testResult(t, hh, "/api/admin/accounts/cloud/0/test"); ok || !strings.Contains(msg, "login lub hasło") {
		t.Errorf("złe hasło: %v %q", ok, msg)
	}
}

// Nikt nie słucha / serwer milczy: wynik to czytelny komunik, bez wiszenia i bez adresu z danymi.
func TestConnCheckUnreachable(t *testing.T) {
	old := checkTimeout
	checkTimeout = 300 * time.Millisecond
	defer func() { checkTimeout = old }()

	ln, _ := net.Listen("tcp", "127.0.0.1:0") // przyjmuje połączenia, nie mówi nic
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			defer c.Close()
		}
	}()
	dead, _ := net.Listen("tcp", "127.0.0.1:0")
	deadAddr := dead.Addr().String()
	dead.Close()

	hh := newHarness(t)
	for _, addr := range []string{"ftp://" + ln.Addr().String(), "ftp://" + deadAddr} {
		v := `{[1]={["address"]="` + addr + `",["name"]="F",["password"]="TAJNE",["type"]="ftp",["url"]="/",["username"]="jan"}}`
		hh.s.st.SetFromPanel(map[string]*string{cloudID: &v})
		start := time.Now()
		_, ok, msg := testResult(t, hh, "/api/admin/accounts/cloud/0/test")
		if ok || msg == "" || time.Since(start) > 3*time.Second {
			t.Errorf("%s: ok=%v msg=%q po %v", addr, ok, msg, time.Since(start))
		}
		if strings.Contains(msg, "TAJNE") {
			t.Errorf("komunikat zdradza hasło: %q", msg)
		}
	}
}

// Przekierowanie na obcy host nie dostaje haseł ani nagłówków: test się na nim zatrzymuje.
func TestConnCheckDoesNotFollowRedirects(t *testing.T) {
	hits := 0
	evil := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++ }))
	defer evil.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, evil.URL+"/zbierz", http.StatusTemporaryRedirect)
	}))
	defer srv.Close()

	hh := newHarness(t)
	hh.call("PUT", "/api/admin/accounts/kosync", map[string]string{"server": srv.URL, "username": "jakub", "password": "tajne"})
	hh.call("PUT", "/api/admin/accounts/wallabag", map[string]string{"server_url": srv.URL, "client_id": "id", "client_secret": "cs", "username": "u", "password": "pw"})
	v := `{[1]={["address"]="` + srv.URL + `",["name"]="W",["password"]="p",["type"]="webdav",["url"]="/",["username"]="u"}}`
	hh.s.st.SetFromPanel(map[string]*string{cloudID: &v})
	for _, p := range []string{"/api/admin/accounts/kosync/test", "/api/admin/accounts/wallabag/test", "/api/admin/accounts/cloud/0/test"} {
		if _, ok, msg := testResult(t, hh, p); ok || !strings.Contains(msg, "przekierował") {
			t.Errorf("%s: ok=%v %q", p, ok, msg)
		}
	}
	if hits != 0 {
		t.Errorf("obcy host dostał %d żądań", hits)
	}
}
