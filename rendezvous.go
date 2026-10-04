package main

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Punkt kontaktowy (rendezvous) — parowanie kodem z dowolnej sieci, jak
// parowanie telewizora: czytnik pokazuje 6-cyfrowy kod, człowiek wpisuje go
// w panelu na komputerze, czytnik dostaje adres serwera i klucz.
//
// Czytnik i komputer nie muszą się „widzieć” (eduroam, hotel, VPN) — oba
// rozmawiają z punktem kontaktowym pod stałym adresem wbudowanym w plugin.
// Punkt kontaktowy trzyma sesje tylko w pamięci (10 min) i nie zna ustawień.
//
// Każdy serwer koligilo JEST punktem kontaktowym; panel serwera, który sam
// nim nie jest (--rendezvous wskazuje gdzie indziej), przekazuje tam claim.

const rvTTL = 10 * time.Minute

// rvPerIP: tyle naraz otwartych sesji z jednego adresu. Globalny limit (500)
// bez tego dawał się zapchać z jednego IP i blokował parowanie wszystkim;
// 20 zostawia zapas na wspólny NAT (eduroam, hotel).
const rvPerIP = 20

type rvSession struct {
	id, code, ip                 string
	name, model, platform, kover string
	created                      time.Time
	server, token, deviceID      string // wypełnione po claim
	claimed                      bool
}

type Rendezvous struct {
	mu       sync.Mutex
	byID     map[string]*rvSession
	byCode   map[string]*rvSession
	failures map[string][]time.Time // IP → nieudane lookup/claim (ochrona przed zgadywaniem)
}

func NewRendezvous() *Rendezvous {
	return &Rendezvous{byID: map[string]*rvSession{}, byCode: map[string]*rvSession{}, failures: map[string][]time.Time{}}
}

func (rv *Rendezvous) expireLocked() {
	for id, s := range rv.byID {
		if time.Since(s.created) > rvTTL {
			delete(rv.byID, id)
			delete(rv.byCode, s.code)
		}
	}
}

func normCode(c string) string {
	return strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, c)
}

// clientIP: X-Forwarded-For tylko od lokalnego reverse proxy (nginx) —
// inaczej klient podałby sobie dowolny nagłówek i omijał limit prób.
func clientIP(r *http.Request) string {
	h, _, _ := net.SplitHostPort(r.RemoteAddr)
	if ip := net.ParseIP(h); ip != nil && ip.IsLoopback() {
		if f := r.Header.Get("X-Forwarded-For"); f != "" {
			return strings.TrimSpace(strings.Split(f, ",")[0])
		}
	}
	return h
}

// tooMany: >10 nieudanych prób z jednego IP w ciągu 10 minut = blokada.
// Przy 6 cyfrach i 10 próbach szansa trafienia cudzego kodu to 1:100 000.
func (rv *Rendezvous) tooMany(ip string) bool {
	var keep []time.Time
	for _, t := range rv.failures[ip] {
		if time.Since(t) < rvTTL {
			keep = append(keep, t)
		}
	}
	rv.failures[ip] = keep
	return len(keep) >= 10
}

func (rv *Rendezvous) fail(ip string) { rv.failures[ip] = append(rv.failures[ip], time.Now()) }

func (rv *Rendezvous) Routes(m *http.ServeMux) {
	// czytnik: nowa sesja
	m.HandleFunc("POST /api/v1/rv", func(w http.ResponseWriter, r *http.Request) {
		var in map[string]string
		json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in)
		rv.mu.Lock()
		defer rv.mu.Unlock()
		rv.expireLocked()
		if len(rv.byID) > 500 {
			writeJSON(w, 429, map[string]string{"error": "punkt kontaktowy przeciążony — spróbuj za chwilę"})
			return
		}
		ip, open := clientIP(r), 0
		for _, s := range rv.byID {
			if s.ip == ip {
				open++
			}
		}
		if open >= rvPerIP {
			writeJSON(w, 429, map[string]string{"error": "za dużo kodów z tego adresu — odczekaj kilka minut"})
			return
		}
		var code string
		for {
			n, _ := rand.Int(rand.Reader, big.NewInt(1_000_000))
			code = fmt.Sprintf("%06d", n.Int64())
			if rv.byCode[code] == nil {
				break
			}
		}
		s := &rvSession{id: randHex(16), code: code, ip: ip, created: time.Now(),
			name: clip(in["name"], 60), model: clip(in["model"], 60),
			platform: clip(in["platform"], 30), kover: clip(in["ko_version"], 40)}
		rv.byID[s.id], rv.byCode[code] = s, s
		writeJSON(w, 200, map[string]any{"id": s.id, "code": code, "expires_in": int(rvTTL.Seconds())})
	})
	// czytnik: odpytywanie; adres i klucz wydawane jeden raz
	m.HandleFunc("GET /api/v1/rv/{id}", func(w http.ResponseWriter, r *http.Request) {
		rv.mu.Lock()
		defer rv.mu.Unlock()
		rv.expireLocked()
		s := rv.byID[r.PathValue("id")]
		if s == nil {
			writeJSON(w, 404, map[string]string{"status": "expired"})
			return
		}
		if !s.claimed {
			writeJSON(w, 200, map[string]string{"status": "waiting"})
			return
		}
		delete(rv.byID, s.id)
		delete(rv.byCode, s.code)
		writeJSON(w, 200, map[string]string{"status": "ready", "server": s.server, "token": s.token, "device_id": s.deviceID})
	})
	// panel: co to za czytnik pod tym kodem?
	m.HandleFunc("GET /api/v1/rv/code/{code}", func(w http.ResponseWriter, r *http.Request) {
		info, status := rv.lookup(clientIP(r), r.PathValue("code"))
		writeJSON(w, status, info)
	})
	// panel: przekaż czytnikowi adres serwera i klucz
	m.HandleFunc("POST /api/v1/rv/code/{code}/claim", func(w http.ResponseWriter, r *http.Request) {
		var in map[string]string
		json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in)
		status, err := rv.claim(clientIP(r), r.PathValue("code"), in["server"], in["token"], in["device_id"])
		if err != "" {
			writeJSON(w, status, map[string]string{"error": err})
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
}

func (rv *Rendezvous) lookup(ip, code string) (map[string]string, int) {
	rv.mu.Lock()
	defer rv.mu.Unlock()
	rv.expireLocked()
	if rv.tooMany(ip) {
		return map[string]string{"error": "za dużo błędnych kodów — odczekaj kilka minut"}, 429
	}
	s := rv.byCode[normCode(code)]
	if s == nil || s.claimed {
		rv.fail(ip)
		return map[string]string{"error": "nie ma czytnika z takim kodem — sprawdź cyfry albo odśwież kod na czytniku"}, 404
	}
	return map[string]string{"name": s.name, "model": s.model, "platform": s.platform, "ko_version": s.kover}, 200
}

func (rv *Rendezvous) claim(ip, code, server, token, devID string) (int, string) {
	rv.mu.Lock()
	defer rv.mu.Unlock()
	rv.expireLocked()
	if rv.tooMany(ip) {
		return 429, "za dużo błędnych kodów — odczekaj kilka minut"
	}
	s := rv.byCode[normCode(code)]
	if s == nil || s.claimed {
		rv.fail(ip)
		return 404, "nie ma czytnika z takim kodem"
	}
	if !strings.HasPrefix(server, "http") || token == "" {
		return 400, "brak adresu serwera albo klucza"
	}
	s.server, s.token, s.deviceID, s.claimed = server, token, devID, true
	return 200, ""
}

// --- panel serwera: lookup/claim lokalnie albo w zdalnym punkcie kontaktowym ---

type rvClient struct {
	self   *Rendezvous
	remote string // "" = ten serwer jest punktem kontaktowym
}

func (c rvClient) lookup(ip, code string) (map[string]string, int) {
	if c.remote == "" {
		return c.self.lookup(ip, code)
	}
	resp, err := http.Get(c.remote + "/api/v1/rv/code/" + normCode(code))
	if err != nil {
		return map[string]string{"error": "punkt kontaktowy nie odpowiada: " + err.Error()}, 502
	}
	defer resp.Body.Close()
	var out map[string]string
	json.NewDecoder(resp.Body).Decode(&out)
	return out, resp.StatusCode
}

func (c rvClient) claim(ip, code, server, token, devID string) (int, string) {
	if c.remote == "" {
		return c.self.claim(ip, code, server, token, devID)
	}
	b, _ := json.Marshal(map[string]string{"server": server, "token": token, "device_id": devID})
	resp, err := http.Post(c.remote+"/api/v1/rv/code/"+normCode(code)+"/claim", "application/json", bytes.NewReader(b))
	if err != nil {
		return 502, "punkt kontaktowy nie odpowiada: " + err.Error()
	}
	defer resp.Body.Close()
	var out map[string]string
	json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out["error"]
}
