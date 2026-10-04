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
	Groups    map[string]bool `json:"groups"` // brak klucza = Group.Default

	// Wtyczki (plugins.go, PC-004). PluginsAllowed ustawia wyłącznie czytnik.
	PluginsAllowed  bool              `json:"plugins_allowed"`
	Plugins         map[string]string `json:"plugins,omitempty"` // cel: katalog → sha256
	PluginInventory []InstalledPlugin `json:"plugin_inventory,omitempty"`
	PluginResults   []PluginResult    `json:"plugin_results,omitempty"`
	PluginReportAt  *time.Time        `json:"plugin_report_at,omitempty"`
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
	Plugins   map[string]*PluginVersion `json:"plugins"` // sha256 → wersja
	// Favorites (TASK-20): ulubione wtyczki, wspólne dla panelu na komputerze i
	// na serwerze — "gh:owner/repo" (galeria) albo "dir:nazwa.koplugin"
	// (magazyn); prefiks rozróżnia obie przestrzenie nazw. Nie oznacza
	// instalacji — tylko zakładkę/filtr w panelu. Przechodzi przez
	// export/import razem z resztą State (transfer.go), bez osobnego kodu.
	Favorites []string `json:"favorites,omitempty"`
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
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
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
