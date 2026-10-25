package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/textproto"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// „Sprawdź połączenie” (TASK-31): serwer loguje się na konto tak, jak zrobi to czytnik, i oddaje
// wynik. Testuje WYŁĄCZNIE zapisane konta (adres, login i hasło biorą się ze stanu serwera, nie z
// formularza), więc panel nie może użyć serwera do odpytania dowolnego adresu ani wyciągnąć
// zapisanego sekretu: komunikat zawiera tylko wynik, bez haseł i bez adresów z danymi logowania.
//
// Niepowodzenie testu to wynik (HTTP 200, ok=false), a nie błąd żądania. Kod 409 oznacza, że
// konta nie ma (jeszcze nie zapisano albo zniknęło po stronie serwera).

const defaultKosyncServer = "https://sync.koreader.rocks:443" // jak w kosync.koplugin

// Domyślne wtyczki Rosetta (rosetta_config.lua), gdy konto nie ma własnego adresu lub modelu.
const (
	defaultRosettaURL   = "https://openrouter.ai/api/v1/chat/completions"
	defaultRosettaModel = "google/gemini-2.5-flash"
)

// Zmienne tylko po to, żeby testy mogły je skrócić.
var checkTimeout = 10 * time.Second

type checkResult struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

func fail(format string, a ...any) checkResult { return checkResult{false, fmt.Sprintf(format, a...)} }
func passed(msg string) checkResult            { return checkResult{true, msg} }

func (s *Server) connRoutes(m *http.ServeMux) {
	m.HandleFunc("POST /api/admin/accounts/kosync/test", s.admin(s.kosyncTest))
	m.HandleFunc("POST /api/admin/accounts/wallabag/test", s.admin(s.wallabagTest))
	m.HandleFunc("POST /api/admin/accounts/cloud/{i}/test", s.admin(s.cloudTest))
	m.HandleFunc("POST /api/admin/accounts/rosetta/test", s.admin(s.rosettaTest))
	m.HandleFunc("POST /api/admin/accounts/target/{which}/test", s.admin(s.targetTest))
}

func notSaved(w http.ResponseWriter, what string) {
	writeJSON(w, 409, map[string]string{"error": "najpierw zapisz " + what})
}

func (s *Server) kosyncTest(w http.ResponseWriter, r *http.Request) {
	user, key := s.getString(kosyncFile+"username"), s.getString(kosyncFile+"userkey")
	if user == "" || key == "" {
		notSaved(w, "konto kosync")
		return
	}
	srv := s.getString(kosyncFile + "custom_server")
	if srv == "" {
		srv = defaultKosyncServer
	}
	writeJSON(w, 200, checkKosync(r.Context(), srv, user, key))
}

func (s *Server) wallabagTest(w http.ResponseWriter, r *http.Request) {
	g := func(k string) string { return s.getString(wallabagFile + k) }
	if g("server_url") == "" || g("client_id") == "" || g("client_secret") == "" || g("username") == "" || g("password") == "" {
		notSaved(w, "konto Wallabag")
		return
	}
	writeJSON(w, 200, checkWallabag(r.Context(), g("server_url"), g("client_id"), g("client_secret"), g("username"), g("password")))
}

func (s *Server) cloudTest(w http.ResponseWriter, r *http.Request) {
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
	acc := list[i]
	switch str(acc, "type") {
	case "dropbox":
		if sessionToken(acc) {
			writeJSON(w, 200, fail("Zapisany jest tylko krótkotrwały token Dropboxa — połącz konto ponownie (Edytuj)."))
			return
		}
		key, secret, _ := strings.Cut(str(acc, "address"), ":")
		writeJSON(w, 200, checkDropbox(r.Context(), key, secret, str(acc, "password")))
	case "webdav":
		writeJSON(w, 200, checkWebDAV(r.Context(), str(acc, "address"), str(acc, "url"), str(acc, "username"), str(acc, "password")))
	case "ftp":
		writeJSON(w, 200, checkFTP(r.Context(), str(acc, "address"), str(acc, "username"), str(acc, "password")))
	default:
		writeJSON(w, 200, fail("Nieznany rodzaj konta."))
	}
}

// Rosetta (TASK-51): adres, model i klucz tylko z zapisanego stanu (jak czyta je wtyczka:
// ai_api_key, a w starszych wersjach api_key; puste adres/model = domyślne wtyczki).
func (s *Server) rosettaTest(w http.ResponseWriter, r *http.Request) {
	key := s.getString(rosettaFile + "ai_api_key")
	if key == "" {
		key = s.getString(rosettaFile + "api_key")
	}
	if key == "" {
		notSaved(w, "klucz API Rosetty")
		return
	}
	base, model := s.getString(rosettaFile+"ai_base_url"), s.getString(rosettaFile+"ai_model")
	if base == "" {
		base = defaultRosettaURL
	}
	if model == "" {
		model = defaultRosettaModel
	}
	writeJSON(w, 200, checkRosetta(r.Context(), base, model, key))
}

// Cel statystyk/słowniczka (TASK-51): konto i folder z zapisanego celu w settings.reader.lua.
func (s *Server) targetTest(w http.ResponseWriter, r *http.Request) {
	which := r.PathValue("which")
	if _, ok := syncTargets[which]; !ok {
		writeJSON(w, 404, map[string]string{"error": "nieznany cel synchronizacji"})
		return
	}
	t := s.target(which)
	if t == nil {
		notSaved(w, "ten cel (statystyki albo słowniczek)")
		return
	}
	switch str(t, "type") {
	case "webdav":
		writeJSON(w, 200, checkWebDAVFolder(r.Context(), str(t, "address"), str(t, "url"), str(t, "username"), str(t, "password")))
	case "dropbox", "ftp":
		writeJSON(w, 200, fail("Sprawdzanie folderu nie jest dla tego typu konta (%s) dostępne. Sprawdź samo konto w „Konta w chmurze” → „Sprawdź połączenie”, a folder upewnij się, że istnieje na koncie.", str(t, "type")))
	default:
		writeJSON(w, 200, fail("Nieznany rodzaj konta."))
	}
}

// --- wspólne ---

// Klient testu NIE idzie za przekierowaniami: nagłówki (x-auth-key) i ciało POST (client_secret,
// hasło) mogłyby trafić na inny host. Przekierowanie to wynik testu, nie powód do dalszej drogi.
func checkClient() *http.Client {
	return &http.Client{
		Timeout:       checkTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

func isRedirect(code int) bool { return code >= 300 && code < 400 }

func redirected(code int) checkResult {
	return fail("Serwer przekierował żądanie (HTTP %d) — nie idę za przekierowaniami, żeby nie wysłać haseł na inny adres. Podaj adres docelowy (np. https zamiast http albo ścieżkę z końcowym „/”).", code)
}

// netReason: powód błędu sieci bez adresu i bez danych logowania z URL-a.
func netReason(err error) string {
	var ue *url.Error
	if errors.As(err, &ue) {
		err = ue.Err
	}
	var ne net.Error
	switch {
	case errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &ne) && ne.Timeout()):
		return "serwer nie odpowiada (przekroczono czas)"
	case errors.As(err, new(*net.DNSError)):
		return "nie znaleziono takiego adresu"
	}
	return err.Error()
}

func unreachable(err error) checkResult {
	return fail("Nie mogę połączyć się z serwerem: %s.", netReason(err))
}

func readBody(resp *http.Response) []byte {
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	return b
}

// --- kosync ---

// GET /users/auth z loginem i md5 hasła (tak robi kosync.koplugin): 200 = dane przyjęte, 401 = odrzucone.
func checkKosync(ctx context.Context, server, user, key string) checkResult {
	req, err := http.NewRequestWithContext(ctx, "GET", strings.TrimRight(server, "/")+"/users/auth", nil)
	if err != nil {
		return fail("Adres serwera jest nieprawidłowy.")
	}
	req.Header.Set("Accept", "application/vnd.koreader.v1+json")
	req.Header.Set("x-auth-user", user)
	req.Header.Set("x-auth-key", key)
	resp, err := checkClient().Do(req)
	if err != nil {
		return unreachable(err)
	}
	defer resp.Body.Close()
	readBody(resp)
	switch {
	case resp.StatusCode == 200:
		return passed("Serwer przyjął login i hasło.")
	case resp.StatusCode == 401:
		return fail("Serwer odrzucił login lub hasło.")
	case isRedirect(resp.StatusCode):
		return redirected(resp.StatusCode)
	}
	return fail("Serwer odpowiedział HTTP %d — to nie wygląda na serwer synchronizacji postępu.", resp.StatusCode)
}

// --- Wallabag ---

// Token OAuth (grant password): to samo żądanie, od którego zaczyna wtyczka Wallabag.
func checkWallabag(ctx context.Context, server, clientID, clientSecret, user, pass string) checkResult {
	form := url.Values{"grant_type": {"password"}, "client_id": {clientID}, "client_secret": {clientSecret},
		"username": {user}, "password": {pass}}
	req, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(server, "/")+"/oauth/v2/token", strings.NewReader(form.Encode()))
	if err != nil {
		return fail("Adres serwera jest nieprawidłowy.")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := checkClient().Do(req)
	if err != nil {
		return unreachable(err)
	}
	defer resp.Body.Close()
	var out struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
		Description string `json:"error_description"`
	}
	json.Unmarshal(readBody(resp), &out)
	switch {
	case resp.StatusCode == 200 && out.AccessToken != "":
		return passed("Wallabag wydał token: login, hasło i klucze działają.")
	case out.Error == "invalid_client":
		return fail("Wallabag nie zna tego Client ID lub secretu.")
	case out.Error == "invalid_grant":
		return fail("Wallabag odrzucił login lub hasło.")
	case out.Error != "":
		return fail("Wallabag odmówił (%s).", out.Error)
	case isRedirect(resp.StatusCode):
		return redirected(resp.StatusCode)
	}
	return fail("Serwer odpowiedział HTTP %d — to nie wygląda na Wallabag.", resp.StatusCode)
}

// --- Dropbox ---

// Odświeżenie tokenu: jeśli Dropbox wydaje token dostępu, App key, secret i refresh token są dobre.
func checkDropbox(ctx context.Context, key, secret, refresh string) checkResult {
	if key == "" || secret == "" || refresh == "" {
		return fail("Konto Dropbox jest niekompletne — połącz je ponownie (Edytuj).")
	}
	form := url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}, "client_id": {key}, "client_secret": {secret}}
	req, err := http.NewRequestWithContext(ctx, "POST", dropboxTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return fail("Nie mogę zbudować żądania do Dropboxa.")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := checkClient().Do(req)
	if err != nil {
		return unreachable(err)
	}
	defer resp.Body.Close()
	var out struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	json.Unmarshal(readBody(resp), &out)
	switch {
	case resp.StatusCode == 200 && out.AccessToken != "":
		return passed("Dropbox przyjął token: App key, secret i połączenie działają (folderu startowego nie sprawdzam).")
	case out.Error == "invalid_grant":
		return fail("Dropbox odrzucił token (połączenie cofnięte albo token unieważniony) — połącz konto ponownie.")
	case out.Error == "invalid_client":
		return fail("Dropbox nie zna tego App key lub secretu.")
	case out.Error != "":
		return fail("Dropbox odmówił (%s).", out.Error)
	}
	if isRedirect(resp.StatusCode) {
		return redirected(resp.StatusCode)
	}
	return fail("Dropbox odpowiedział HTTP %d.", resp.StatusCode)
}

// --- WebDAV ---

func propfind(ctx context.Context, target, user, pass string) (int, error) {
	req, err := http.NewRequestWithContext(ctx, "PROPFIND", target, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Depth", "0")
	if user != "" {
		req.SetBasicAuth(user, pass)
	}
	resp, err := checkClient().Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	readBody(resp)
	return resp.StatusCode, nil
}

// PROPFIND (Depth 0) na adres konta, a gdy konto ma folder startowy, także na niego: 207 = jest.
func checkWebDAV(ctx context.Context, address, folder, user, pass string) checkResult {
	if address == "" {
		return fail("Konto nie ma adresu serwera.")
	}
	base := strings.TrimRight(address, "/")
	target := base
	folder = strings.Trim(folder, "/")
	if folder != "" {
		target = base + "/" + folder
	}
	code, err := propfind(ctx, target, user, pass)
	if err != nil {
		return unreachable(err)
	}
	switch {
	case code == 207 || code == 200:
		return passed("Serwer WebDAV przyjął login.")
	case code == 401 || code == 403:
		return fail("Serwer odrzucił login lub hasło (HTTP %d).", code)
	case isRedirect(code):
		return redirected(code)
	case code == 404 && folder != "":
		// adres może być dobry, a brakować samego folderu — odróżniamy, żeby nie szukać winy w haśle
		if c2, err := propfind(ctx, base, user, pass); err == nil && (c2 == 207 || c2 == 200) {
			return fail("Logowanie działa, ale folderu „/%s” nie ma na serwerze.", folder)
		}
	}
	return fail("Serwer odpowiedział HTTP %d — sprawdź adres (WebDAV zwykle kończy się ścieżką, np. /dav/Koofr).", code)
}

// Folder celu (statystyki/słowniczek): PROPFIND Depth 0 wprost na folder. Odróżnia zły login, brak
// folderu i zły adres serwera. Pusty folder to korzeń konta.
func checkWebDAVFolder(ctx context.Context, address, folder, user, pass string) checkResult {
	if address == "" {
		return fail("Konto nie ma adresu serwera.")
	}
	base := strings.TrimRight(address, "/")
	folder = strings.Trim(folder, "/")
	target, shown := base, "główny folder konta"
	if folder != "" {
		target, shown = base+"/"+folder, "folder „/"+folder+"”"
	}
	code, err := propfind(ctx, target, user, pass)
	if err != nil {
		return unreachable(err)
	}
	switch {
	case code == 207 || code == 200:
		return passed("Jest " + shown + ", a login działa (uprawnień zapisu nie sprawdzam).")
	case code == 401 || code == 403:
		return fail("Serwer odrzucił login lub hasło (HTTP %d).", code)
	case isRedirect(code):
		return redirected(code)
	case code == 404 && folder != "":
		if c2, err := propfind(ctx, base, user, pass); err == nil && (c2 == 207 || c2 == 200) {
			return fail("Logowanie działa, ale folderu „/%s” nie ma na koncie. Utwórz go (np. w przeglądarce plików konta) albo wpisz inny.", folder)
		}
	}
	return fail("Serwer odpowiedział HTTP %d — sprawdź adres konta (WebDAV zwykle kończy się ścieżką, np. /dav/Koofr).", code)
}

// --- Rosetta (API zgodne z OpenAI) ---

// Jedno krótkie żądanie chat/completions z nagłówkiem Bearer, jak w rosetta_ai.lua. Odpowiedzi
// dostawcy nie przepisujemy do komunikatu (mogłaby zawierać fragment klucza) — tylko kod i wniosek.
func checkRosetta(ctx context.Context, endpoint, model, key string) checkResult {
	if u, err := url.Parse(endpoint); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return fail("Adres API jest nieprawidłowy (oczekiwany https://…/chat/completions).")
	}
	body, _ := json.Marshal(map[string]any{
		"model":      model,
		"max_tokens": 5,
		"messages":   []map[string]string{{"role": "user", "content": "Say OK."}},
	})
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, strings.NewReader(string(body)))
	if err != nil {
		return fail("Adres API jest nieprawidłowy.")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	resp, err := checkClient().Do(req)
	if err != nil {
		return unreachable(err)
	}
	defer resp.Body.Close()
	var out struct {
		Choices []json.RawMessage `json:"choices"`
	}
	json.Unmarshal(readBody(resp), &out)
	switch c := resp.StatusCode; {
	case c == 200 && len(out.Choices) > 0:
		return passed("Model „" + model + "” odpowiedział: adres, model i klucz działają.")
	case c == 200:
		return fail("Serwer odpowiedział HTTP 200, ale bez odpowiedzi modelu — to nie wygląda na API zgodne z OpenAI.")
	case c == 401 || c == 403:
		return fail("Dostawca odrzucił klucz API (HTTP %d).", c)
	case c == 402:
		return fail("Dostawca odmówił (HTTP 402) — zwykle brakuje środków na koncie.")
	case c == 404:
		return fail("Pod tym adresem nic nie ma (HTTP 404) — adres ma kończyć się na /chat/completions, a model musi istnieć u dostawcy.")
	case c == 400 || c == 422:
		return fail("Dostawca odrzucił żądanie (HTTP %d) — sprawdź nazwę modelu „%s”.", c, model)
	case c == 429:
		return fail("Dostawca ogranicza liczbę zapytań (HTTP 429) — klucz jest przyjęty, ale limit wyczerpany.")
	case isRedirect(c):
		return redirected(c)
	}
	return fail("Dostawca odpowiedział HTTP %d.", resp.StatusCode)
}

// --- FTP ---

// Zwykły FTP (FTPS i SFTP nie są obsługiwane, tak jak w KOReaderze): połączenie, USER, PASS, QUIT. Bez listowania i bez sprawdzania folderu.
func checkFTP(ctx context.Context, address, user, pass string) checkResult {
	u, err := url.Parse(address)
	if err != nil || u.Host == "" {
		return fail("Adres FTP jest nieprawidłowy (oczekiwany ftp://serwer).")
	}
	host := u.Host
	if u.Port() == "" {
		host = net.JoinHostPort(u.Hostname(), "21")
	}
	d := net.Dialer{Timeout: checkTimeout}
	conn, err := d.DialContext(ctx, "tcp", host)
	if err != nil {
		return unreachable(err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(checkTimeout))
	tp := textproto.NewConn(conn)
	if _, _, err := tp.ReadResponse(220); err != nil {
		return fail("To nie wygląda na serwer FTP: %s.", ftpErr(err))
	}
	if user == "" {
		user, pass = "anonymous", "anonymous@"
	}
	if err := tp.PrintfLine("USER %s", user); err != nil {
		return unreachable(err)
	}
	code, _, err := tp.ReadResponse(0)
	if err != nil {
		return fail("Serwer FTP nie odpowiedział na login: %s.", ftpErr(err))
	}
	if code == 331 {
		if err := tp.PrintfLine("PASS %s", pass); err != nil {
			return unreachable(err)
		}
		if code, _, err = tp.ReadResponse(0); err != nil {
			return fail("Serwer FTP nie odpowiedział na hasło: %s.", ftpErr(err))
		}
	}
	tp.PrintfLine("QUIT")
	switch {
	case code == 230:
		return passed("Serwer FTP przyjął login (folderu startowego i uprawnień zapisu nie sprawdzam).")
	case code == 530 || code == 331 || code == 332:
		return fail("Serwer FTP odrzucił login lub hasło.")
	}
	return fail("Serwer FTP odpowiedział kodem %d.", code)
}

func ftpErr(err error) string {
	var pe *textproto.Error
	if errors.As(err, &pe) {
		return "kod " + strconv.Itoa(pe.Code)
	}
	return netReason(err)
}
