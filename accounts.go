package main

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Konta wpisywane w panelu: kosync, Wallabag, konta w chmurze (Dropbox,
// WebDAV, FTP) oraz to, gdzie statystyki i słowniczek synchronizują bazę.
// Panel zapisuje je jako zwykłe wspólne wartości (literały Lua) — czytniki
// odbierają je tak samo, jak zmiany z innego urządzenia, więc plugin nie
// wymaga żadnej osobnej obsługi.
//
// Hasła nigdy nie wracają do przeglądarki: GET zwraca tylko has_password.
// Puste pole hasła przy zapisie = „zostaw dotychczasowe”.

const (
	kosyncFile   = "settings/kosync.lua|settings."
	wallabagFile = "settings/wallabag.lua|wallabag."
	cloudID      = "settings/cloudstorage.lua|cs_servers"
	rosettaFile  = "settings/rosetta.lua|"
)

// Cele synchronizacji baz: kopia konta z chmury + folder (pole url).
var syncTargets = map[string]string{
	"statystyki": readerFile + "|statistics.sync_server",
	"slowniczek": readerFile + "|vocabulary_builder.server",
}

// Adres wymiany kodu OAuth Dropboxa (zmienna — podmieniana w testach).
var dropboxTokenURL = "https://api.dropboxapi.com/oauth2/token"

func (s *Server) accountRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/admin/accounts", s.admin(s.accountsGet))
	m.HandleFunc("PUT /api/admin/accounts/kosync", s.admin(s.kosyncPut))
	m.HandleFunc("DELETE /api/admin/accounts/kosync", s.admin(s.kosyncDelete))
	m.HandleFunc("PUT /api/admin/accounts/wallabag", s.admin(s.wallabagPut))
	m.HandleFunc("DELETE /api/admin/accounts/wallabag", s.admin(s.wallabagDelete))
	m.HandleFunc("POST /api/admin/accounts/cloud", s.admin(s.cloudSave))
	m.HandleFunc("DELETE /api/admin/accounts/cloud/{i}", s.admin(s.cloudDelete))
	m.HandleFunc("PUT /api/admin/accounts/target/{which}", s.admin(s.targetPut))
	m.HandleFunc("DELETE /api/admin/accounts/target/{which}", s.admin(s.targetDelete))
	m.HandleFunc("PUT /api/admin/accounts/rosetta", s.admin(s.rosettaPut))
	m.HandleFunc("DELETE /api/admin/accounts/rosetta", s.admin(s.rosettaDelete))
}

// --- odczyt wartości ---

func (s *Server) getString(id string) string {
	if v := s.st.Get(id); v != nil {
		if x, err := decodeLua(*v); err == nil {
			if str, ok := x.(string); ok {
				return str
			}
		}
	}
	return ""
}

// Poniższe gettery zwracają wskaźnik: nil, gdy wartości nie ma ALBO ma inny
// typ niż oczekiwany (np. stary KOReader trzyma sync_forward jako liczbę
// enuma 1..3, nie jako bool — pomylenie typu przy odczycie kiedyś nadpisałoby
// je literałem złego typu przy najbliższym zapisie z panelu). Front-end
// odróżnia „nie skonfigurowane” (null) od realnej wartości i wysyła do PUT
// tylko pola, które użytkownik faktycznie zmienił — reszta zostaje wskaźnikiem
// nil (json: pole nieobecne), a setXxxPtr poniżej wtedy niczego nie rusza.

func (s *Server) getBoolPtr(id string) *bool {
	if v := s.st.Get(id); v != nil {
		if x, err := decodeLua(*v); err == nil {
			if b, ok := x.(bool); ok {
				return &b
			}
		}
	}
	return nil
}

func (s *Server) getIntPtr(id string) *int {
	if v := s.st.Get(id); v != nil {
		if x, err := decodeLua(*v); err == nil {
			if n, ok := x.(float64); ok {
				i := int(n)
				return &i
			}
		}
	}
	return nil
}

func (s *Server) getStringPtr(id string) *string {
	if v := s.st.Get(id); v != nil {
		if x, err := decodeLua(*v); err == nil {
			if str, ok := x.(string); ok {
				return &str
			}
		}
	}
	return nil
}

// getNumStrPtr: liczba jako napis do pola tekstowego w panelu — najkrótszy
// zapis, który wczyta się z powrotem na tę samą liczbę (numLua, 17 cyfr do
// bajtowej zgodności z Sync.serialize, pokazywałby np. 0.3 jako
// 0.29999999999999999). nil, gdy wartości nie ma albo ma inny typ.
func (s *Server) getNumStrPtr(id string) *string {
	if v := s.st.Get(id); v != nil {
		if x, err := decodeLua(*v); err == nil {
			if n, ok := x.(float64); ok {
				str := strconv.FormatFloat(n, 'g', -1, 64)
				return &str
			}
		}
	}
	return nil
}

// setXxxPtr: v == nil → pole nieobecne w JSON, użytkownik go nie dotknął —
// NIE dotykamy zapisanej wartości. Inaczej zapisujemy (pusty napis = usuń,
// wraca do domyślnej KOReadera; to jedyny sposób na świadome wyczyszczenie).

func setStringPtr(set map[string]*string, id string, v *string) {
	if v == nil {
		return
	}
	if *v == "" {
		set[id] = nil
	} else {
		set[id] = lit(*v)
	}
}

func setBoolPtr(set map[string]*string, id string, v *bool) {
	if v != nil {
		set[id] = lit(*v)
	}
}

// setIntPtr: jak setBoolPtr, ale z walidacją zakresu enuma [min, max].
func setIntPtr(w http.ResponseWriter, set map[string]*string, id string, v *int, min, max int, what string) bool {
	if v == nil {
		return true
	}
	if *v < min || *v > max {
		writeJSON(w, 400, map[string]string{"error": fmt.Sprintf("%s musi być %d–%d", what, min, max)})
		return false
	}
	set[id] = lit(float64(*v))
	return true
}

// setNumStrPtr: pole liczbowe wpisywane jako tekst — nil = nie dotykaj,
// pusty napis = usuń, inaczej sparsuj i zapisz jako liczbę.
func setNumStrPtr(w http.ResponseWriter, set map[string]*string, id string, v *string, what string) bool {
	if v == nil {
		return true
	}
	t := strings.TrimSpace(*v)
	if t == "" {
		set[id] = nil
		return true
	}
	n, err := strconv.ParseFloat(t, 64)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": what + " musi być liczbą"})
		return false
	}
	set[id] = lit(n)
	return true
}

func (s *Server) cloudList() ([]map[string]any, error) {
	v := s.st.Get(cloudID)
	if v == nil {
		return nil, nil
	}
	x, err := decodeLua(*v)
	if err != nil {
		return nil, fmt.Errorf("lista kont w chmurze jest nieczytelna: %w", err)
	}
	l, ok := asList(x)
	if !ok {
		return nil, errors.New("lista kont w chmurze ma nieoczekiwany format")
	}
	out := make([]map[string]any, 0, len(l))
	for _, e := range l {
		m, ok := e.(map[string]any)
		if !ok {
			return nil, errors.New("lista kont w chmurze ma nieoczekiwany format")
		}
		out = append(out, m)
	}
	return out, nil
}

func (s *Server) target(which string) map[string]any {
	v := s.st.Get(syncTargets[which])
	if v == nil {
		return nil
	}
	x, err := decodeLua(*v)
	if err != nil {
		return nil
	}
	m, _ := x.(map[string]any)
	return m
}

func str(m map[string]any, k string) string {
	s, _ := m[k].(string)
	return s
}

func lit(v any) *string {
	s, err := encodeLua(v)
	if err != nil {
		panic(err) // tylko napisy i tabele napisów — nie może się zdarzyć
	}
	return &s
}

// KOReader nadpisuje w pamięci zapisane konto Dropbox krótkotrwałym tokenem
// (password) i flagą username=true. Takie konto nie nadaje się do przeniesienia.
func sessionToken(m map[string]any) bool {
	return str(m, "type") == "dropbox" && m["username"] == true
}

// --- GET ---

type cloudView struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Address  string `json:"address,omitempty"` // WebDAV/FTP
	Username string `json:"username,omitempty"`
	AppKey   string `json:"app_key,omitempty"` // Dropbox
	Folder   string `json:"folder"`
	HasPass  bool   `json:"has_password"`
	HasApp   bool   `json:"has_app_secret,omitempty"`
	Broken   bool   `json:"broken,omitempty"` // krótkotrwały token zamiast refresh tokenu
}

func viewCloud(m map[string]any) cloudView {
	c := cloudView{Name: str(m, "name"), Type: str(m, "type"), Folder: str(m, "url"),
		HasPass: str(m, "password") != "", Broken: sessionToken(m)}
	if c.Type == "dropbox" {
		key, secret, _ := strings.Cut(str(m, "address"), ":")
		c.AppKey, c.HasApp = key, secret != ""
	} else {
		c.Address, c.Username = str(m, "address"), str(m, "username")
	}
	return c
}

func (s *Server) accountsGet(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{}
	if srv, user := s.getString(kosyncFile+"custom_server"), s.getString(kosyncFile+"username"); srv != "" || user != "" {
		out["kosync"] = map[string]any{"server": srv, "username": user,
			"has_password":    s.getString(kosyncFile+"userkey") != "",
			"auto_sync":       s.getBoolPtr(kosyncFile + "auto_sync"),
			"sync_forward":    s.getIntPtr(kosyncFile + "sync_forward"),
			"sync_backward":   s.getIntPtr(kosyncFile + "sync_backward"),
			"checksum_method": s.getIntPtr(kosyncFile + "checksum_method")}
	}
	if srv := s.getString(wallabagFile + "server_url"); srv != "" {
		out["wallabag"] = map[string]any{"server_url": srv,
			"client_id":           s.getString(wallabagFile + "client_id"),
			"username":            s.getString(wallabagFile + "username"),
			"has_client_secret":   s.getString(wallabagFile+"client_secret") != "",
			"has_password":        s.getString(wallabagFile+"password") != "",
			"filter_tag":          s.getStringPtr(wallabagFile + "filter_tag"),
			"ignore_tags":         s.getStringPtr(wallabagFile + "ignore_tags"),
			"auto_tags":           s.getStringPtr(wallabagFile + "auto_tags"),
			"articles_per_sync":   s.getNumStrPtr(wallabagFile + "articles_per_sync"),
			"is_delete_finished":  s.getBoolPtr(wallabagFile + "is_delete_finished"),
			"is_delete_read":      s.getBoolPtr(wallabagFile + "is_delete_read"),
			"is_auto_delete":      s.getBoolPtr(wallabagFile + "is_auto_delete"),
			"send_review_as_tags": s.getBoolPtr(wallabagFile + "send_review_as_tags")}
	}
	hasRosettaKey := s.getString(rosettaFile+"ai_api_key") != "" || s.getString(rosettaFile+"api_key") != ""
	base, model := s.getStringPtr(rosettaFile+"ai_base_url"), s.getStringPtr(rosettaFile+"ai_model")
	if hasRosettaKey || base != nil || model != nil {
		out["rosetta"] = map[string]any{
			"ai_base_url":    base,
			"ai_model":       model,
			"ai_max_tokens":  s.getNumStrPtr(rosettaFile + "ai_max_tokens"),
			"ai_temperature": s.getNumStrPtr(rosettaFile + "ai_temperature"),
			"has_api_key":    hasRosettaKey,
		}
	}
	list, err := s.cloudList()
	if err != nil {
		out["cloud_error"] = err.Error()
	}
	views := []cloudView{}
	for _, m := range list {
		views = append(views, viewCloud(m))
	}
	out["cloud"] = views
	targets := map[string]any{}
	for which := range syncTargets {
		t := s.target(which)
		if t == nil {
			continue
		}
		idx := -1
		for i, m := range list {
			if str(m, "name") == str(t, "name") && str(m, "type") == str(t, "type") {
				idx = i
				break
			}
		}
		targets[which] = map[string]any{"account": idx, "name": str(t, "name"), "type": str(t, "type"),
			"folder": str(t, "url"), "broken": sessionToken(t)}
	}
	out["targets"] = targets
	writeJSON(w, 200, out)
}

// --- kosync ---

func (s *Server) kosyncPut(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Server, Username, Password string
		// Wskaźniki: pole nieobecne w JSON zostawia dotychczasową wartość —
		// nie kasuje jej samym zapisem loginu/hasła. Formularz w web/app.js
		// wysyła tylko to, co użytkownik faktycznie zmienił (patrz getBoolPtr
		// wyżej). sync_forward/sync_backward to enum kosync.koplugin
		// SYNC_STRATEGY (1=Prompt, 2=Silent, 3=Disable), checksum_method to
		// enum CHECKSUM_METHOD (0=Binary, 1=Filename) — NIE bool/string.
		AutoSync       *bool `json:"auto_sync"`
		SyncForward    *int  `json:"sync_forward"`
		SyncBackward   *int  `json:"sync_backward"`
		ChecksumMethod *int  `json:"checksum_method"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	in.Username = strings.TrimSpace(in.Username)
	if in.Username == "" {
		writeJSON(w, 400, map[string]string{"error": "podaj login konta synchronizacji postępu"})
		return
	}
	srv := strings.TrimRight(strings.TrimSpace(in.Server), "/")
	if srv != "" && !strings.Contains(srv, "://") {
		srv = "https://" + srv
	}
	set := map[string]*string{kosyncFile + "username": lit(in.Username)}
	// pusty adres = domyślny serwer KOReadera (sync.koreader.rocks)
	if srv == "" {
		set[kosyncFile+"custom_server"] = nil
	} else {
		set[kosyncFile+"custom_server"] = lit(srv)
	}
	if in.Password != "" {
		// KOReader nie trzyma hasła, tylko jego md5 (userkey) — robimy to samo
		sum := md5.Sum([]byte(in.Password))
		set[kosyncFile+"userkey"] = lit(hex.EncodeToString(sum[:]))
	} else if s.getString(kosyncFile+"userkey") == "" {
		writeJSON(w, 400, map[string]string{"error": "podaj hasło — serwer nie zna go jeszcze"})
		return
	}
	setBoolPtr(set, kosyncFile+"auto_sync", in.AutoSync)
	if !setIntPtr(w, set, kosyncFile+"sync_forward", in.SyncForward, 1, 3, "sync_forward") {
		return
	}
	if !setIntPtr(w, set, kosyncFile+"sync_backward", in.SyncBackward, 1, 3, "sync_backward") {
		return
	}
	if !setIntPtr(w, set, kosyncFile+"checksum_method", in.ChecksumMethod, 0, 1, "checksum_method") {
		return
	}
	s.saveSet(w, set)
}

func (s *Server) kosyncDelete(w http.ResponseWriter, r *http.Request) {
	s.saveSet(w, map[string]*string{kosyncFile + "custom_server": nil,
		kosyncFile + "username": nil, kosyncFile + "userkey": nil,
		kosyncFile + "auto_sync": nil, kosyncFile + "sync_forward": nil,
		kosyncFile + "sync_backward": nil, kosyncFile + "checksum_method": nil})
}

// --- Wallabag ---

func (s *Server) wallabagPut(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ServerURL    string `json:"server_url"`
		ClientID     string `json:"client_id"`
		ClientSecret string `json:"client_secret"`
		Username     string `json:"username"`
		Password     string `json:"password"`
		// Wskaźniki: pole nieobecne w JSON zostawia dotychczasową wartość
		// (patrz komentarz w kosyncPut) — formularz wysyła tylko zmienione.
		FilterTag        *string `json:"filter_tag"`
		IgnoreTags       *string `json:"ignore_tags"`
		AutoTags         *string `json:"auto_tags"`
		ArticlesPerSync  *string `json:"articles_per_sync"`
		IsDeleteFinished *bool   `json:"is_delete_finished"`
		IsDeleteRead     *bool   `json:"is_delete_read"`
		IsAutoDelete     *bool   `json:"is_auto_delete"`
		SendReviewAsTags *bool   `json:"send_review_as_tags"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	srv := strings.TrimRight(strings.TrimSpace(in.ServerURL), "/")
	if srv != "" && !strings.Contains(srv, "://") {
		srv = "https://" + srv
	}
	if srv == "" || strings.TrimSpace(in.ClientID) == "" || strings.TrimSpace(in.Username) == "" {
		writeJSON(w, 400, map[string]string{"error": "podaj adres serwera, client ID i login"})
		return
	}
	set := map[string]*string{
		wallabagFile + "server_url": lit(srv),
		wallabagFile + "client_id":  lit(strings.TrimSpace(in.ClientID)),
		wallabagFile + "username":   lit(strings.TrimSpace(in.Username)),
	}
	for k, v := range map[string]string{"client_secret": in.ClientSecret, "password": in.Password} {
		if v != "" {
			set[wallabagFile+k] = lit(v)
		} else if s.getString(wallabagFile+k) == "" {
			writeJSON(w, 400, map[string]string{"error": "podaj client secret i hasło — serwer nie zna ich jeszcze"})
			return
		}
	}
	setStringPtr(set, wallabagFile+"filter_tag", in.FilterTag)
	setStringPtr(set, wallabagFile+"ignore_tags", in.IgnoreTags)
	setStringPtr(set, wallabagFile+"auto_tags", in.AutoTags)
	if !setNumStrPtr(w, set, wallabagFile+"articles_per_sync", in.ArticlesPerSync, "liczba artykułów na synchronizację") {
		return
	}
	setBoolPtr(set, wallabagFile+"is_delete_finished", in.IsDeleteFinished)
	setBoolPtr(set, wallabagFile+"is_delete_read", in.IsDeleteRead)
	setBoolPtr(set, wallabagFile+"is_auto_delete", in.IsAutoDelete)
	setBoolPtr(set, wallabagFile+"send_review_as_tags", in.SendReviewAsTags)
	s.saveSet(w, set)
}

func (s *Server) wallabagDelete(w http.ResponseWriter, r *http.Request) {
	set := map[string]*string{}
	for _, k := range []string{"server_url", "client_id", "client_secret", "username", "password",
		"filter_tag", "ignore_tags", "auto_tags", "articles_per_sync",
		"is_delete_finished", "is_delete_read", "is_auto_delete", "send_review_as_tags"} {
		set[wallabagFile+k] = nil
	}
	s.saveSet(w, set)
}

// --- konta w chmurze ---

type cloudIn struct {
	Index    int    `json:"index"` // -1 = nowe konto
	Type     string `json:"type"`
	Name     string `json:"name"`
	Folder   string `json:"folder"`
	Address  string `json:"address"` // WebDAV/FTP
	Username string `json:"username"`
	Password string `json:"password"`
	// Dropbox: własna aplikacja (app key + secret) i refresh token —
	// podany wprost albo wymieniany tu z jednorazowego kodu autoryzacji.
	AppKey       string `json:"app_key"`
	AppSecret    string `json:"app_secret"`
	RefreshToken string `json:"refresh_token"`
	Code         string `json:"code"`
}

func (s *Server) cloudSave(w http.ResponseWriter, r *http.Request) {
	var in cloudIn
	if !readJSON(w, r, &in) {
		return
	}
	list, err := s.cloudList()
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": err.Error()})
		return
	}
	var old map[string]any
	if in.Index >= 0 {
		if in.Index >= len(list) {
			writeJSON(w, 409, map[string]string{"error": "tego konta już nie ma — odśwież panel"})
			return
		}
		old = list[in.Index]
	}
	acc, err := buildCloud(in, old)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	for i, m := range list {
		if i != in.Index && str(m, "name") == str(acc, "name") && str(m, "type") == str(acc, "type") {
			writeJSON(w, 400, map[string]string{"error": "masz już konto o tej nazwie — wybierz inną"})
			return
		}
	}
	items := make([]any, 0, len(list)+1)
	for _, m := range list {
		items = append(items, m)
	}
	if old == nil {
		items = append(items, acc)
	} else {
		items[in.Index] = acc
	}
	set := map[string]*string{cloudID: lit(items)}
	// Statystyki i słowniczek trzymają WŁASNĄ kopię konta — odświeżamy ją,
	// żeby zmiana hasła czy tokenu nie zostawiła ich ze starymi danymi.
	if old != nil {
		for _, id := range syncTargets {
			t := s.targetByID(id)
			if t != nil && str(t, "name") == str(old, "name") && str(t, "type") == str(old, "type") {
				set[id] = lit(withFolder(acc, str(t, "url")))
			}
		}
	}
	s.saveSet(w, set)
}

func (s *Server) targetByID(id string) map[string]any {
	for which, tid := range syncTargets {
		if tid == id {
			return s.target(which)
		}
	}
	return nil
}

func withFolder(acc map[string]any, folder string) map[string]any {
	c := map[string]any{}
	for k, v := range acc {
		c[k] = v
	}
	c["url"] = folder
	return c
}

// buildCloud składa wpis cs_servers w formacie KOReadera. Nieznane pola
// starego wpisu zostają (np. dodane przez nowszy KOReader).
func buildCloud(in cloudIn, old map[string]any) (map[string]any, error) {
	acc := map[string]any{}
	for k, v := range old {
		acc[k] = v
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return nil, errors.New("nadaj kontu nazwę (widać ją w menu Chmura na czytniku)")
	}
	typ := in.Type
	if old != nil {
		typ = str(old, "type")
	}
	acc["name"], acc["type"] = name, typ
	switch typ {
	case "dropbox":
		key, secret, _ := strings.Cut(str(old, "address"), ":")
		if k := strings.TrimSpace(in.AppKey); k != "" {
			key = k
		}
		if sec := strings.TrimSpace(in.AppSecret); sec != "" {
			secret = sec
		}
		if key == "" || secret == "" {
			return nil, errors.New("podaj App key i App secret swojej aplikacji Dropbox")
		}
		acc["address"] = key + ":" + secret
		tok := strings.TrimSpace(in.RefreshToken)
		if c := strings.TrimSpace(in.Code); c != "" {
			var err error
			if tok, err = dropboxExchange(key, secret, c); err != nil {
				return nil, err
			}
		}
		if tok != "" {
			acc["password"] = tok
			delete(acc, "username") // zdejmujemy ewentualną flagę sesji KOReadera
		} else if str(old, "password") == "" || sessionToken(old) {
			return nil, errors.New("połącz konto z Dropboxem (kod autoryzacji) albo wklej refresh token")
		}
		acc["url"] = normFolder(in.Folder, "/")
	case "webdav", "ftp":
		addr := strings.TrimSpace(in.Address)
		if addr == "" {
			return nil, errors.New("podaj adres serwera")
		}
		acc["address"] = addr
		acc["username"] = strings.TrimSpace(in.Username)
		if in.Password != "" {
			acc["password"] = in.Password
		} else if _, ok := acc["password"]; !ok {
			acc["password"] = "" // FTP bywa anonimowy
		}
		acc["url"] = normFolder(in.Folder, "/")
	default:
		return nil, errors.New("nieznany rodzaj konta (dropbox, webdav albo ftp)")
	}
	return acc, nil
}

// normFolder: "/a/b" bez końcowego ukośnika; katalog główny jako root.
func normFolder(f, root string) string {
	f = strings.Trim(strings.TrimSpace(f), "/")
	if f == "" {
		return root
	}
	return "/" + f
}

func dropboxExchange(key, secret, code string) (string, error) {
	form := url.Values{"code": {code}, "grant_type": {"authorization_code"},
		"client_id": {key}, "client_secret": {secret}}
	c := &http.Client{Timeout: 15 * time.Second}
	resp, err := c.PostForm(dropboxTokenURL, form)
	if err != nil {
		return "", fmt.Errorf("nie mogę połączyć się z Dropboxem: %v", err)
	}
	defer resp.Body.Close()
	var out struct {
		RefreshToken string `json:"refresh_token"`
		Error        string `json:"error"`
		ErrorDesc    string `json:"error_description"`
	}
	json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&out)
	if resp.StatusCode != 200 || out.RefreshToken == "" {
		msg := out.ErrorDesc
		if msg == "" {
			msg = out.Error
		}
		if msg == "" {
			msg = "HTTP " + strconv.Itoa(resp.StatusCode)
		}
		return "", fmt.Errorf("Dropbox nie przyjął kodu (%s). Kod działa raz i krótko — wygeneruj nowy", msg)
	}
	return out.RefreshToken, nil
}

func (s *Server) cloudDelete(w http.ResponseWriter, r *http.Request) {
	i, err := strconv.Atoi(r.PathValue("i"))
	list, lerr := s.cloudList()
	if lerr != nil {
		writeJSON(w, 409, map[string]string{"error": lerr.Error()})
		return
	}
	if err != nil || i < 0 || i >= len(list) {
		writeJSON(w, 409, map[string]string{"error": "tego konta już nie ma — odśwież panel"})
		return
	}
	items := []any{}
	for j, m := range list {
		if j != i {
			items = append(items, m)
		}
	}
	// Cele (statystyki/słowniczek) zostają: mają własną kopię konta i nadal
	// działają — panel pokaże je jako „konto spoza listy”.
	s.saveSet(w, map[string]*string{cloudID: lit(items)})
}

// --- statystyki i słowniczek ---

func (s *Server) targetPut(w http.ResponseWriter, r *http.Request) {
	id, ok := syncTargets[r.PathValue("which")]
	if !ok {
		writeJSON(w, 404, map[string]string{"error": "nieznany cel synchronizacji"})
		return
	}
	var in struct {
		Account int    `json:"account"`
		Folder  string `json:"folder"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	list, err := s.cloudList()
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": err.Error()})
		return
	}
	if in.Account < 0 || in.Account >= len(list) {
		writeJSON(w, 400, map[string]string{"error": "wybierz konto w chmurze"})
		return
	}
	acc := list[in.Account]
	if sessionToken(acc) {
		writeJSON(w, 400, map[string]string{"error": "to konto Dropbox ma tylko krótkotrwały token — połącz je ponownie w „Konta w chmurze”"})
		return
	}
	s.saveSet(w, map[string]*string{id: lit(withFolder(acc, normFolder(in.Folder, "")))})
}

func (s *Server) targetDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := syncTargets[r.PathValue("which")]
	if !ok {
		writeJSON(w, 404, map[string]string{"error": "nieznany cel synchronizacji"})
		return
	}
	s.saveSet(w, map[string]*string{id: nil})
}

// --- Rosetta (klucze API tłumaczenia) ---
//
// Wtyczka zna klucz pod dwiema nazwami w zależności od wersji (ai_api_key —
// nowszy, api_key — starszy) — zapisujemy w obie, żeby działało niezależnie
// od tego, której wersji używa dany czytnik.

func (s *Server) rosettaPut(w http.ResponseWriter, r *http.Request) {
	var in struct {
		// Wskaźniki: pole nieobecne w JSON zostawia dotychczasową wartość —
		// formularz wysyła tylko to, co użytkownik zmienił (patrz kosyncPut).
		AiBaseURL     *string `json:"ai_base_url"`
		AiModel       *string `json:"ai_model"`
		AiMaxTokens   *string `json:"ai_max_tokens"`
		AiTemperature *string `json:"ai_temperature"`
		ApiKey        string  `json:"api_key"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	set := map[string]*string{}
	setStringPtr(set, rosettaFile+"ai_base_url", in.AiBaseURL)
	setStringPtr(set, rosettaFile+"ai_model", in.AiModel)
	if !setNumStrPtr(w, set, rosettaFile+"ai_max_tokens", in.AiMaxTokens, "limit tokenów") {
		return
	}
	if !setNumStrPtr(w, set, rosettaFile+"ai_temperature", in.AiTemperature, "temperatura") {
		return
	}
	if key := strings.TrimSpace(in.ApiKey); key != "" {
		set[rosettaFile+"ai_api_key"] = lit(key)
		set[rosettaFile+"api_key"] = lit(key)
	} else if s.getString(rosettaFile+"ai_api_key") == "" && s.getString(rosettaFile+"api_key") == "" {
		writeJSON(w, 400, map[string]string{"error": "podaj klucz API — serwer nie zna go jeszcze"})
		return
	}
	s.saveSet(w, set)
}

func (s *Server) rosettaDelete(w http.ResponseWriter, r *http.Request) {
	set := map[string]*string{}
	for _, k := range []string{"ai_api_key", "api_key", "ai_base_url", "ai_model", "ai_max_tokens", "ai_temperature"} {
		set[rosettaFile+k] = nil
	}
	s.saveSet(w, set)
}

// --- pomocnicze ---

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(v); err != nil {
		writeJSON(w, 400, map[string]string{"error": "zły JSON"})
		return false
	}
	return true
}

func (s *Server) saveSet(w http.ResponseWriter, set map[string]*string) {
	if err := s.st.SetFromPanel(set); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
