package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"mime"
	"net/http"
	"sort"
	"strings"
	"time"
)

// Go nie zna .woff2 bez systemowego mime.types — czcionka panelu (web/fonts).
func init() { mime.AddExtensionType(".woff2", "font/woff2") }

//go:embed web
var webFS embed.FS

type Server struct {
	st        *Store
	publicURL string
	rv        *Rendezvous
	rvc       rvClient
	gal       *Gallery
	// pubFn (tryb komputera): adres dla czytników liczony na bieżąco
	// (interfejs LAN/Tailscale albo nadpisany w panelu); nil = publicURL.
	pubFn func() string
	// trustAdmin: tylko instancja za panelem lokalnym (127.0.0.1 + guard) —
	// tam dostęp do panelu = bycie na tej maszynie, token nie istnieje.
	// Nasłuch urządzeń używa ZAWSZE osobnej instancji bez tego pola.
	trustAdmin bool
}

func (s *Server) public() string {
	if s.pubFn != nil {
		return s.pubFn()
	}
	return s.publicURL
}

func (s *Server) Routes() *http.ServeMux {
	m := http.NewServeMux()
	// API urządzeń (plugin KOReadera)
	m.HandleFunc("GET /api/v1/ping", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]string{"koligilo": Version})
	})
	m.HandleFunc("POST /api/v1/pair", s.pairStart)
	m.HandleFunc("GET /api/v1/pair/{id}", s.pairPoll)
	m.HandleFunc("GET /api/v1/sync", s.device(s.syncGet))
	m.HandleFunc("POST /api/v1/sync", s.device(s.syncPost))
	// API panelu
	m.HandleFunc("GET /api/admin/state", s.admin(s.adminState))
	m.HandleFunc("POST /api/admin/values", s.admin(s.adminSetValues))
	m.HandleFunc("GET /api/admin/values/{id...}", s.admin(s.adminGetValue))
	m.HandleFunc("POST /api/admin/pair/{id}", s.admin(s.adminDecide))
	m.HandleFunc("POST /api/admin/devices", s.admin(s.adminProvision))
	m.HandleFunc("POST /api/admin/devices/{id}/groups", s.admin(s.adminGroups))
	m.HandleFunc("POST /api/admin/devices/{id}/rename", s.admin(s.adminRename))
	m.HandleFunc("DELETE /api/admin/devices/{id}", s.admin(s.adminForget))
	s.accountRoutes(m)
	s.pluginRoutes(m)
	s.galleryRoutes(m)
	s.transferRoutes(m)
	m.HandleFunc("GET /koligilo.koplugin.zip", servePluginZip)
	if s.rv == nil {
		s.rv = NewRendezvous()
		s.rvc.self = s.rv
	}
	s.rv.Routes(m)
	m.HandleFunc("GET /api/admin/rv/{code}", s.admin(s.adminRVLookup))
	m.HandleFunc("POST /api/admin/rv/{code}/claim", s.admin(s.adminRVClaim))
	// UI
	sub, _ := fs.Sub(webFS, "web")
	m.Handle("GET /", http.FileServerFS(sub))
	return m
}

func bearer(r *http.Request) string {
	return strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
}

func (s *Server) admin(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.trustAdmin && !s.st.CheckAdmin(bearer(r)) {
			writeJSON(w, 401, map[string]string{"error": "brak albo zły token administratora"})
			return
		}
		h(w, r)
	}
}

type devHandler func(http.ResponseWriter, *http.Request, *Device)

func (s *Server) device(h devHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		d := s.st.DeviceByToken(bearer(r))
		if d == nil {
			writeJSON(w, 401, map[string]string{"error": "urządzenie niesparowane albo usunięte z panelu"})
			return
		}
		// Dane przeniesiono (TASK-15): sparowany czytnik dostaje nowy adres
		// i sam się przepina; token urządzenia na nowym serwerze jest ten sam.
		if moved := s.st.MovedTo(); moved != "" {
			writeJSON(w, 410, map[string]string{"moved_to": moved,
				"error": "koligilo przeniesiono na " + moved})
			return
		}
		h(w, r, d)
	}
}

// --- parowanie ---

func (s *Server) pairStart(w http.ResponseWriter, r *http.Request) {
	var in struct{ Name, Model, Platform, KOVersion string }
	var raw map[string]string
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&raw); err != nil {
		writeJSON(w, 400, map[string]string{"error": "zły JSON"})
		return
	}
	in.Name, in.Model, in.Platform, in.KOVersion = raw["name"], raw["model"], raw["platform"], raw["ko_version"]
	if in.Name == "" {
		in.Name = in.Model
	}
	p, err := s.st.NewPairRequest(in.Name, in.Model, in.Platform, in.KOVersion)
	if err != nil {
		writeJSON(w, 429, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"id": p.ID, "code": p.Code, "expires_in": int(pairTTL.Seconds())})
}

func (s *Server) pairPoll(w http.ResponseWriter, r *http.Request) {
	p, tok := s.st.PollPair(r.PathValue("id"))
	if p == nil {
		writeJSON(w, 404, map[string]string{"status": "expired"})
		return
	}
	out := map[string]any{"status": p.Status}
	if p.Status == "approved" {
		out["device_id"], out["token"] = p.DeviceID, tok
	}
	writeJSON(w, 200, out)
}

// --- synchronizacja ---

func (s *Server) syncGet(w http.ResponseWriter, r *http.Request, d *Device) {
	entries := []Entry{}
	groups := []string{}
	for _, g := range Catalog {
		if d.GroupOn(&g) {
			entries = append(entries, g.Entries...)
			groups = append(groups, g.ID)
		}
	}
	// Usunięcia osobną listą, bez JSON null — dekodery Lua bywają różne
	// (rapidjson.null vs nil), a zgubiony nagrobek wskrzesiłby ustawienie.
	vals, deleted := map[string]string{}, []string{}
	for id, v := range s.st.Snapshot(d) {
		if v == nil {
			deleted = append(deleted, id)
		} else {
			vals[id] = *v
		}
	}
	out := map[string]any{
		"device":  map[string]string{"id": d.ID, "name": d.Name},
		"groups":  groups,
		"entries": entries,
		"values":  vals,
		"deleted": deleted,
	}
	// Wtyczki tylko dla czytnika, który sam zgłosił zgodę (PC-004).
	allowed := r.URL.Query().Get("plugins_allowed") == "1"
	if vs := s.st.DevicePluginTarget(d, allowed); allowed {
		out["plugins"] = pluginsWire(vs)
	}
	writeJSON(w, 200, out)
}

func (s *Server) syncPost(w http.ResponseWriter, r *http.Request, d *Device) {
	var in struct {
		Set      map[string]string `json:"set"`
		Delete   []string          `json:"delete"`
		Received int               `json:"received"`
		Note     string            `json:"note"`
		Plugins  *PluginReport     `json:"plugins"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<20)).Decode(&in); err != nil {
		writeJSON(w, 400, map[string]string{"error": "zły JSON"})
		return
	}
	set := map[string]*string{}
	for id, v := range in.Set {
		set[id] = &v
	}
	for _, id := range in.Delete {
		set[id] = nil
	}
	rej, err := s.st.Apply(d, set, in.Received, in.Note)
	if err == nil && in.Plugins != nil {
		err = s.st.ReportPlugins(d, in.Plugins)
	}
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"rejected": rej})
}

// --- panel ---

type valueView struct {
	ID      string    `json:"id"`
	Group   string    `json:"group"`
	Preview string    `json:"preview"`
	Deleted bool      `json:"deleted"`
	T       time.Time `json:"t"`
	From    string    `json:"from"`
}

func (s *Server) adminState(w http.ResponseWriter, r *http.Request) {
	s.st.mu.Lock()
	devs := []Device{} // kopie — serializujemy już po zwolnieniu zamka
	for _, d := range s.st.S.Devices {
		c := *d
		c.Groups = map[string]bool{}
		for _, g := range Catalog { // efektywny stan (z domyślnymi), nie surowa mapa
			c.Groups[g.ID] = d.GroupOn(&g)
		}
		devs = append(devs, c)
	}
	sort.Slice(devs, func(i, j int) bool { return devs[i].PairedAt.Before(devs[j].PairedAt) })
	vals := []valueView{}
	for id, v := range s.st.S.Values {
		g := GroupOf(id)
		vv := valueView{ID: id, T: v.T, Deleted: v.V == nil}
		if g != nil {
			vv.Group = g.ID
		}
		if d := s.st.S.Devices[v.Dev]; d != nil {
			vv.From = d.Name
		} else if v.Dev == PanelDev {
			vv.From = "panel"
		}
		if v.V != nil {
			if g != nil && g.Secret {
				vv.Preview = "•••••• (ukryte — dane logowania)"
			} else {
				vv.Preview = clip(*v.V, 400)
			}
		}
		vals = append(vals, vv)
	}
	s.st.mu.Unlock()
	sort.Slice(vals, func(i, j int) bool { return vals[i].ID < vals[j].ID })
	writeJSON(w, 200, map[string]any{
		"version":    Version,
		"public_url": s.public(),
		"moved_to":   s.st.MovedTo(),
		"devices":    devs,
		"pending":    s.st.Pending(),
		"catalog":    Catalog,
		"never":      NeverSynced,
		"values":     vals,
		"favorites":  s.st.Favorites(),
	})
}

// adminSetValues: panel zapisuje/usuwa wartości wspólne wprost (edytor w
// zakładce „Wspólne ustawienia”). ID musi należeć do katalogu, a literał
// przejść ten sam parser co Sync.deserialize po stronie pluginu — inaczej
// panel mógłby zapisać śmieci, których żaden czytnik nie odczyta.
// Usunięcia to osobna lista (`delete`), zgodnie z niezmiennikiem — nie JSON null.
func (s *Server) adminSetValues(w http.ResponseWriter, r *http.Request) {
	// Wymagamy jawnego Content-Type: proste żądanie z formularza w obcej
	// karcie (CSRF) nie potrafi go ustawić na application/json.
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		writeJSON(w, 415, map[string]string{"error": "oczekuję Content-Type: application/json"})
		return
	}
	var in struct {
		Set    map[string]string `json:"set"`
		Delete []string          `json:"delete"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	set := map[string]*string{}
	for id, lit := range in.Set {
		if GroupOf(id) == nil {
			writeJSON(w, 400, map[string]string{"error": "nieznane ID spoza katalogu: " + id})
			return
		}
		if _, err := decodeLua(lit); err != nil {
			writeJSON(w, 400, map[string]string{"error": fmt.Sprintf("niepoprawny literał Lua dla %s: %v", id, err)})
			return
		}
		v := lit
		set[id] = &v
	}
	for _, id := range in.Delete {
		if GroupOf(id) == nil {
			writeJSON(w, 400, map[string]string{"error": "nieznane ID spoza katalogu: " + id})
			return
		}
		set[id] = nil
	}
	s.saveSet(w, set)
}

// adminGetValue: pełny literał jednej wartości (podgląd w adminState jest
// przycięty do 400 znaków). Grupy Secret nigdy nie oddają swojej treści.
func (s *Server) adminGetValue(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	g := GroupOf(id)
	if g == nil {
		writeJSON(w, 404, map[string]string{"error": "nieznane ID spoza katalogu"})
		return
	}
	if g.Secret {
		writeJSON(w, 403, map[string]string{"error": "grupa zawiera dane logowania — treść nie jest oddawana panelowi"})
		return
	}
	v := s.st.Get(id)
	if v == nil {
		writeJSON(w, 404, map[string]string{"error": "brak wartości"})
		return
	}
	writeJSON(w, 200, map[string]string{"value": *v})
}

func (s *Server) adminDecide(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Approve bool `json:"approve"`
	}
	json.NewDecoder(r.Body).Decode(&in)
	d, err := s.st.Decide(r.PathValue("id"), in.Approve)
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"device": d})
}

func (s *Server) adminRVLookup(w http.ResponseWriter, r *http.Request) {
	info, status := s.rvc.lookup(clientIP(r), r.PathValue("code"))
	writeJSON(w, status, info)
}

// adminRVClaim: czytnik z kodem → nowe urządzenie na tym serwerze → adres
// i klucz do punktu kontaktowego, skąd odbierze je czytnik.
func (s *Server) adminRVClaim(w http.ResponseWriter, r *http.Request) {
	pub := s.public()
	if pub == "" {
		writeJSON(w, 409, map[string]string{"error": "serwer nie zna swojego publicznego adresu — uruchom go z --public-url"})
		return
	}
	code := r.PathValue("code")
	info, status := s.rvc.lookup(clientIP(r), code)
	if status != 200 {
		writeJSON(w, status, info)
		return
	}
	d, tok, err := s.st.Provision(info["name"], info["model"], info["platform"], info["ko_version"])
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	if st, msg := s.rvc.claim(clientIP(r), code, pub, tok, d.ID); st != 200 {
		s.st.Forget(d.ID) // nie zostawiamy urządzenia, którego czytnik nigdy nie odbierze
		writeJSON(w, st, map[string]string{"error": msg})
		return
	}
	writeJSON(w, 200, map[string]any{"device": d})
}

func (s *Server) adminProvision(w http.ResponseWriter, r *http.Request) {
	var in map[string]string
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in); err != nil || in["name"] == "" {
		writeJSON(w, 400, map[string]string{"error": "podaj nazwę urządzenia"})
		return
	}
	d, tok, err := s.st.Provision(in["name"], in["model"], in["platform"], in["ko_version"])
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"device": d, "token": tok})
}

func (s *Server) adminGroups(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Group string `json:"group"`
		On    bool   `json:"on"`
	}
	json.NewDecoder(r.Body).Decode(&in)
	if err := s.st.SetGroup(r.PathValue("id"), in.Group, in.On); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) adminRename(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
	}
	json.NewDecoder(r.Body).Decode(&in)
	if strings.TrimSpace(in.Name) == "" {
		writeJSON(w, 400, map[string]string{"error": "pusta nazwa"})
		return
	}
	if err := s.st.Rename(r.PathValue("id"), in.Name); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) adminForget(w http.ResponseWriter, r *http.Request) {
	if err := s.st.Forget(r.PathValue("id")); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
