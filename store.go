package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Stan serwera — jeden plik state.json w katalogu danych, zapisywany atomowo
// (tmp + rename). Skala to kilka urządzeń jednej osoby, więc bez bazy danych.

type Device struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Model     string          `json:"model"`
	Platform  string          `json:"platform"`
	KOVersion string          `json:"ko_version"`
	TokenHash string          `json:"token_hash"`
	PairedAt  time.Time       `json:"paired_at"`
	LastSeen  time.Time       `json:"last_seen"`
	LastSync  *SyncReport     `json:"last_sync,omitempty"`
	Groups    map[string]bool `json:"groups"`           // brak klucza = Group.Default
	Screen    *Screen         `json:"screen,omitempty"` // zgłasza plugin przy synchronizacji (podgląd strony w panelu)

	// Wtyczki (plugins.go, PC-004). PluginsAllowed ustawia wyłącznie czytnik.
	PluginsAllowed  bool              `json:"plugins_allowed"`
	Plugins         map[string]string `json:"plugins,omitempty"` // cel: katalog → sha256
	PluginInventory []InstalledPlugin `json:"plugin_inventory,omitempty"`
	PluginResults   []PluginResult    `json:"plugin_results,omitempty"`
	PluginReportAt  *time.Time        `json:"plugin_report_at,omitempty"`

	// Czcionki (fonts.go, PC-018). FontsAllowed ustawia wyłącznie czytnik.
	FontsAllowed  bool            `json:"fonts_allowed"`
	FontInventory []InstalledFont `json:"font_inventory,omitempty"`
	FontReportAt  *time.Time      `json:"font_report_at,omitempty"`
	FontsOff      []string        `json:"fonts_off,omitempty"` // rodziny wyłączone dla tego czytnika (TASK-38); domyślnie wszystkie włączone

	// Słowniki (dicts.go, PC-020). DictsAllowed ustawia wyłącznie czytnik.
	DictsAllowed  bool            `json:"dicts_allowed"`
	DictInventory []InstalledDict `json:"dict_inventory,omitempty"`
	DictReportAt  *time.Time      `json:"dict_report_at,omitempty"`

	// Wtyczka koligilo na czytniku (TASK-49). Oba pola zgłasza wyłącznie czytnik przy
	// synchronizacji; SelfUpdateAllowed to zgoda z menu (PC-019), panel jej nie ustawia.
	PluginVersion     string `json:"plugin_version,omitempty"`
	SelfUpdateAllowed bool   `json:"self_update_allowed"`
	// Zgoda na ciche scalanie statystyk i słowniczka po synchronizacji (TASK-42/46) — też tylko
	// z menu czytnika; panel ją pokazuje, nie ustawia.
	MergeAfterSync bool `json:"merge_after_sync"`
	// Zgoda na pobieranie artykułów Wallabag po synchronizacji (TASK-45) — tylko poza książką;
	// też wyłącznie z menu czytnika.
	WallabagAfterSync bool `json:"wallabag_after_sync"`

	// Synchronizacja wstrzymana przez bezpiecznik wtyczki (TASK-50): czytnik wraca przed
	// wysłaniem czegokolwiek, więc bez tego zgłoszenia panel widziałby go jako „cicho”.
	// Zgłasza wyłącznie czytnik; czyści je udana synchronizacja (Apply) albo zgłoszenie bez liczby.
	SyncBlocked *SyncBlocked `json:"sync_blocked,omitempty"`
}

// SyncBlocked: kiedy czytnik zgłosił wstrzymanie i ile ustawień „zniknęło naraz”.
type SyncBlocked struct {
	At    time.Time `json:"at"`
	Count int       `json:"count"`
}

// Screen to ekran czytnika widziany przez KOReadera (piksele i ppi). Panel buduje
// z niego profil podglądu strony, więc nowy model nie wymaga zmian w kodzie.
type Screen struct {
	W     int  `json:"w"`
	H     int  `json:"h"`
	DPI   int  `json:"dpi"`
	Color bool `json:"color,omitempty"`
}

// ParseScreen czyta parametr `screen` synchronizacji: "1404x1872@227" z
// opcjonalnym ",c" (ekran kolorowy). Wartości spoza rozsądnych zakresów odpadają —
// panel liczy z nich rozmiar czcionki, a dane pochodzą z urządzenia.
func ParseScreen(v string) *Screen {
	var s Screen
	rest, color := strings.CutSuffix(v, ",c")
	if n, err := fmt.Sscanf(rest, "%dx%d@%d", &s.W, &s.H, &s.DPI); err != nil || n != 3 {
		return nil
	}
	if fmt.Sprintf("%dx%d@%d", s.W, s.H, s.DPI) != rest { // bez śmieci za liczbami
		return nil
	}
	if s.W < 200 || s.W > 10000 || s.H < 200 || s.H > 10000 || s.DPI < 50 || s.DPI > 1000 {
		return nil
	}
	s.Color = color
	return &s
}

// SetScreen zapisuje ekran zgłoszony przez czytnik; plik state.json rusza tylko
// przy zmianie (synchronizacja woła to za każdym razem).
func (st *Store) SetScreen(d *Device, s *Screen) error {
	if s == nil {
		return nil
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	if d.Screen != nil && *d.Screen == *s {
		return nil
	}
	c := *s
	d.Screen = &c
	return st.saveLocked()
}

var pluginVersionRe = regexp.MustCompile(`^\d{1,4}\.\d{1,5}\.\d{1,6}$`)

// PluginInfo to dane o wtyczce koligilo zgłaszane przez czytnik w zapytaniu o synchronizację.
type PluginInfo struct {
	Version           string
	SelfUpdate        bool
	MergeAfterSync    bool
	WallabagAfterSync bool
}

// SetPluginInfo zapamiętuje wersję wtyczki koligilo i zgody zgłoszone przez czytnik.
// Dane są niezaufane: zły format wersji = puste pole, a stary plugin bez parametrów
// zeruje wszystko (nigdy nie psuje stanu).
func (st *Store) SetPluginInfo(d *Device, in PluginInfo) error {
	if !pluginVersionRe.MatchString(in.Version) {
		in.Version = ""
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	if d.PluginVersion == in.Version && d.SelfUpdateAllowed == in.SelfUpdate && d.MergeAfterSync == in.MergeAfterSync && d.WallabagAfterSync == in.WallabagAfterSync {
		return nil
	}
	d.PluginVersion, d.SelfUpdateAllowed, d.MergeAfterSync = in.Version, in.SelfUpdate, in.MergeAfterSync
	d.WallabagAfterSync = in.WallabagAfterSync
	return st.saveLocked()
}

var syncBlockedRe = regexp.MustCompile(`^[0-9]{1,7}$`)

// ParseSyncBlocked: liczba ustawień z zapytania `sync_blocked`. Zwraca 0 (= brak zgłoszenia),
// gdy tekst nie jest liczbą całkowitą z zakresu 1..1000000 — dane z czytnika są niezaufane.
func ParseSyncBlocked(raw string) int {
	if !syncBlockedRe.MatchString(raw) {
		return 0
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 || n > 1000000 {
		return 0
	}
	return n
}

// SetSyncBlocked zapisuje (count > 0) albo czyści (count == 0) zgłoszenie wstrzymanej synchronizacji.
// Powtórne zgłoszenie tej samej liczby nie odświeża czasu: „od kiedy” ma zostać pierwszym zgłoszeniem.
func (st *Store) SetSyncBlocked(d *Device, count int) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	if count <= 0 {
		if d.SyncBlocked == nil {
			return nil
		}
		d.SyncBlocked = nil
		return st.saveLocked()
	}
	if d.SyncBlocked != nil && d.SyncBlocked.Count == count {
		return nil
	}
	d.SyncBlocked = &SyncBlocked{At: time.Now(), Count: count}
	return st.saveLocked()
}

type SyncReport struct {
	At       time.Time `json:"at"`
	Sent     int       `json:"sent"`
	Received int       `json:"received"`
	Note     string    `json:"note,omitempty"`
}

type PairRequest struct {
	ID        string    `json:"id"`
	Code      string    `json:"code"`
	Name      string    `json:"name"`
	Model     string    `json:"model"`
	Platform  string    `json:"platform"`
	KOVersion string    `json:"ko_version"`
	Created   time.Time `json:"created"`
	Status    string    `json:"status"` // pending | approved | rejected
	DeviceID  string    `json:"device_id,omitempty"`
	token     string    // tylko w pamięci: odbiera go plugin jednym odpytaniem
}

type Value struct {
	V   *string   `json:"v"` // literał Lua; nil = usunięte
	T   time.Time `json:"t"`
	Dev string    `json:"dev"`
}

type State struct {
	AdminHash string                    `json:"admin_hash"`
	Devices   map[string]*Device        `json:"devices"`
	Values    map[string]*Value         `json:"values"`
	Plugins   map[string]*PluginVersion `json:"plugins"`         // sha256 → wersja
	Fonts     map[string]*FontFile      `json:"fonts,omitempty"` // sha256 → plik czcionki (fonts.go)
	Dicts     map[string]*DictFile      `json:"dicts,omitempty"` // sha256 → słownik StarDict (dicts.go)
	// Favorites (TASK-20): ulubione wtyczki, wspólne dla panelu na komputerze i
	// na serwerze — "gh:owner/repo" (galeria) albo "dir:nazwa.koplugin"
	// (magazyn); prefiks rozróżnia obie przestrzenie nazw. Nie oznacza
	// instalacji — tylko zakładkę/filtr w panelu. Przechodzi przez
	// export/import razem z resztą State (transfer.go), bez osobnego kodu.
	Favorites []string `json:"favorites,omitempty"`
	// SharedPlugins (TASK-33, PC-017): „wtyczki wspólne” — katalog → sha256 zaakceptowanej
	// wersji. Każdy nowo sparowany czytnik dostaje je jako stan docelowy (applySharedLocked),
	// a zmiana listy trafia też do już sparowanych (SetSharedPlugins). To tylko stan
	// docelowy: zgodę i potwierdzenie instalacji nadal daje wyłącznie czytnik (PC-004).
	SharedPlugins map[string]string `json:"shared_plugins,omitempty"`
	// MovedTo: dane przeniesiono na inny serwer (TASK-15). Czytnik ze znanym
	// tokenem dostaje na /api/v1/* odpowiedź 410 {moved_to} i sam się przepina.
	MovedTo string `json:"moved_to,omitempty"`
	pending map[string]*PairRequest
}

type Store struct {
	mu   sync.Mutex
	path string
	S    State
}

const pairTTL = 10 * time.Minute

func OpenStore(dir string) (*Store, string, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, "", err
	}
	st := &Store{path: filepath.Join(dir, "state.json")}
	st.S.Devices = map[string]*Device{}
	st.S.Values = map[string]*Value{}
	b, err := os.ReadFile(st.path)
	if err == nil {
		if err := json.Unmarshal(b, &st.S); err != nil {
			return nil, "", fmt.Errorf("state.json uszkodzony: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, "", err
	}
	if st.S.Devices == nil {
		st.S.Devices = map[string]*Device{}
	}
	if st.S.Values == nil {
		st.S.Values = map[string]*Value{}
	}
	if st.S.Plugins == nil {
		st.S.Plugins = map[string]*PluginVersion{}
	}
	if st.S.Fonts == nil {
		st.S.Fonts = map[string]*FontFile{}
	}
	if st.S.Dicts == nil {
		st.S.Dicts = map[string]*DictFile{}
	}
	st.S.pending = map[string]*PairRequest{}
	// Pierwsze uruchomienie: generujemy token administratora i zwracamy go
	// JEDEN raz, do wypisania na konsolę. Na dysku leży tylko hash.
	var newAdmin string
	if st.S.AdminHash == "" {
		newAdmin = "kol-" + randHex(16)
		st.S.AdminHash = hash(newAdmin)
		if err := st.saveLocked(); err != nil {
			return nil, "", err
		}
	}
	return st, newAdmin, nil
}

// Dir: katalog danych (state.json, plugins/, gallery*.json).
func (st *Store) Dir() string { return filepath.Dir(st.path) }

func (st *Store) MovedTo() string {
	st.mu.Lock()
	defer st.mu.Unlock()
	return st.S.MovedTo
}

// SetMovedTo ustawia (albo czyści pustym napisem) adres, na który przeniesiono dane.
func (st *Store) SetMovedTo(u string) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.S.MovedTo = u
	return st.saveLocked()
}

// Empty: brak urządzeń i wartości — import nie ma czego nadpisać.
func (st *Store) Empty() bool {
	st.mu.Lock()
	defer st.mu.Unlock()
	return len(st.S.Devices) == 0 && len(st.S.Values) == 0 && len(st.S.Plugins) == 0
}

// ResetAdmin wystawia nowy token administratora (na dysku tylko hash).
func (st *Store) ResetAdmin() (string, error) {
	st.mu.Lock()
	defer st.mu.Unlock()
	tok := "kol-" + randHex(16)
	st.S.AdminHash = hash(tok)
	return tok, st.saveLocked()
}

func (st *Store) saveLocked() error {
	b, err := json.MarshalIndent(&st.S, "", "  ")
	if err != nil {
		return err
	}
	tmp := st.path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	// Sync przed Rename: inaczej po awarii zasilania rename może przetrwać,
	// a dane pliku nie — i state.json (z tokenami urządzeń) zostaje pusty.
	_, werr := f.Write(b)
	if serr := f.Sync(); werr == nil {
		werr = serr
	}
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		os.Remove(tmp)
		return werr
	}
	return os.Rename(tmp, st.path)
}

func (st *Store) CheckAdmin(tok string) bool {
	st.mu.Lock()
	defer st.mu.Unlock()
	return tok != "" && hash(tok) == st.S.AdminHash
}

func (st *Store) DeviceByToken(tok string) *Device {
	if tok == "" {
		return nil
	}
	h := hash(tok)
	st.mu.Lock()
	defer st.mu.Unlock()
	for _, d := range st.S.Devices {
		if d.TokenHash == h {
			return d
		}
	}
	return nil
}

// --- parowanie ---

func (st *Store) NewPairRequest(name, model, platform, kover string) (*PairRequest, error) {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.expireLocked()
	n := 0
	for _, p := range st.S.pending {
		if p.Status == "pending" {
			n++
		}
	}
	if n >= 5 {
		return nil, errors.New("za dużo oczekujących próśb o połączenie — zatwierdź albo odrzuć istniejące")
	}
	code, _ := rand.Int(rand.Reader, big.NewInt(10000))
	p := &PairRequest{
		ID: randHex(16), Code: fmt.Sprintf("%04d", code.Int64()),
		Name: clip(name, 60), Model: clip(model, 60), Platform: clip(platform, 30),
		KOVersion: clip(kover, 40), Created: time.Now(), Status: "pending",
	}
	st.S.pending[p.ID] = p
	return p, nil
}

func (st *Store) expireLocked() {
	for id, p := range st.S.pending {
		if time.Since(p.Created) > pairTTL {
			delete(st.S.pending, id)
		}
	}
}

// PollPair zwraca stan prośby; token urządzenia wydaje dokładnie raz.
func (st *Store) PollPair(id string) (*PairRequest, string) {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.expireLocked()
	p := st.S.pending[id]
	if p == nil {
		return nil, ""
	}
	tok := p.token
	if p.Status != "pending" {
		delete(st.S.pending, id)
	}
	return p, tok
}

func (st *Store) Pending() []*PairRequest {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.expireLocked()
	out := []*PairRequest{}
	for _, p := range st.S.pending {
		if p.Status == "pending" {
			out = append(out, p)
		}
	}
	return out
}

func (st *Store) Decide(id string, approve bool) (*Device, error) {
	st.mu.Lock()
	defer st.mu.Unlock()
	// Bez tego wygasłą prośbę dało się zatwierdzić: powstawało urządzenie,
	// którego token zniknąłby z pamięcią razem z prośbą przy najbliższym PollPair.
	st.expireLocked()
	p := st.S.pending[id]
	if p == nil || p.Status != "pending" {
		return nil, errors.New("prośba wygasła albo została już rozpatrzona")
	}
	if !approve {
		p.Status = "rejected"
		return nil, nil
	}
	tok := "dev-" + randHex(24)
	d := &Device{
		ID: randHex(8), Name: p.Name, Model: p.Model, Platform: p.Platform,
		KOVersion: p.KOVersion, TokenHash: hash(tok), PairedAt: time.Now(),
		Groups: map[string]bool{},
	}
	st.applySharedLocked(d)
	st.S.Devices[d.ID] = d
	p.Status, p.DeviceID, p.token = "approved", d.ID, tok
	return d, st.saveLocked()
}

// Provision zakłada urządzenie od razu, bez prośby z kodem — dla parowania
// kablem z panelu (fizyczne podłączenie = dowód, że urządzenie jest właściciela).
// Wywoływane wyłącznie przez API administratora.
func (st *Store) Provision(name, model, platform, kover string) (*Device, string, error) {
	st.mu.Lock()
	defer st.mu.Unlock()
	tok := "dev-" + randHex(24)
	d := &Device{
		ID: randHex(8), Name: clip(name, 60), Model: clip(model, 60), Platform: clip(platform, 30),
		KOVersion: clip(kover, 40), TokenHash: hash(tok), PairedAt: time.Now(),
		Groups: map[string]bool{},
	}
	st.applySharedLocked(d)
	st.S.Devices[d.ID] = d
	return d, tok, st.saveLocked()
}

// --- urządzenia ---

func (st *Store) SetGroup(devID, group string, on bool) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	d := st.S.Devices[devID]
	if d == nil || groupByID(group) == nil {
		return errors.New("nieznane urządzenie albo grupa")
	}
	d.Groups[group] = on
	return st.saveLocked()
}

func (st *Store) Rename(devID, name string) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	d := st.S.Devices[devID]
	if d == nil {
		return errors.New("nieznane urządzenie")
	}
	d.Name = clip(name, 60)
	return st.saveLocked()
}

func (st *Store) Forget(devID string) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	delete(st.S.Devices, devID)
	return st.saveLocked()
}

func (d *Device) GroupOn(g *Group) bool {
	if v, ok := d.Groups[g.ID]; ok {
		return v
	}
	return g.Default
}

// Allowed: czy urządzenie synchronizuje dane ID (grupa istnieje i jest włączona).
func (d *Device) Allowed(id string) bool {
	g := GroupOf(id)
	return g != nil && d.GroupOn(g)
}

// --- wartości ---

// Snapshot zwraca wartości widoczne dla urządzenia (łącznie z nagrobkami).
func (st *Store) Snapshot(d *Device) map[string]*string {
	st.mu.Lock()
	defer st.mu.Unlock()
	d.LastSeen = time.Now()
	out := map[string]*string{}
	for id, v := range st.S.Values {
		if d.Allowed(id) {
			out[id] = v.V
		}
	}
	return out
}

// Apply zapisuje zmiany od urządzenia (last-writer-wins po kolejności dotarcia).
// Zwraca ID odrzucone jako spoza włączonych grup.
func (st *Store) Apply(d *Device, set map[string]*string, received int, note string) ([]string, error) {
	st.mu.Lock()
	defer st.mu.Unlock()
	rejected := []string{}
	now := time.Now()
	for id, v := range set {
		if !d.Allowed(id) {
			rejected = append(rejected, id)
			continue
		}
		if v != nil && len(*v) > 256*1024 {
			rejected = append(rejected, id)
			continue
		}
		st.S.Values[id] = &Value{V: v, T: now, Dev: d.ID}
	}
	d.LastSeen = now
	d.LastSync = &SyncReport{At: now, Sent: len(set) - len(rejected), Received: received, Note: clip(note, 200)}
	d.SyncBlocked = nil // udana synchronizacja (TASK-50)
	return rejected, st.saveLocked()
}

// PanelDev — autor wartości wpisanych w panelu (zamiast ID urządzenia).
const PanelDev = "panel"

// SetFromPanel zapisuje wartości wpisane w panelu (np. konta). Dla czytnika
// to zwykła zmiana zdalna, jak z innego urządzenia. nil = usunięcie.
func (st *Store) SetFromPanel(set map[string]*string) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	now := time.Now()
	for id := range set {
		if GroupOf(id) == nil {
			return fmt.Errorf("%s nie należy do żadnej grupy", id)
		}
	}
	for id, v := range set {
		if v == nil && st.S.Values[id] == nil {
			continue // nie ma czego usuwać — bez zbędnych nagrobków
		}
		st.S.Values[id] = &Value{V: v, T: now, Dev: PanelDev}
	}
	return st.saveLocked()
}

// Get zwraca bieżący literał wartości (nil = brak albo usunięta).
func (st *Store) Get(id string) *string {
	st.mu.Lock()
	defer st.mu.Unlock()
	if v := st.S.Values[id]; v != nil {
		return v.V
	}
	return nil
}

// --- pomocnicze ---

func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func hash(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func clip(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}
