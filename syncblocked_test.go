package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParseSyncBlocked(t *testing.T) {
	for raw, want := range map[string]int{
		"1": 1, "42": 42, "1000000": 1000000,
		"": 0, "0": 0, "-3": 0, "+5": 0, "1000001": 0, "99999999": 0, "1.5": 0, "abc": 0, "5%0A": 0, " 7": 0, "٣": 0,
	} {
		if got := ParseSyncBlocked(raw); got != want {
			t.Errorf("ParseSyncBlocked(%q) = %d, chciałem %d", raw, got, want)
		}
	}
}

// TASK-50: wstrzymana synchronizacja jest zgłaszana lekkim żądaniem, widać ją w panelu
// i znika po udanej synchronizacji.
func TestSyncBlockedReported(t *testing.T) {
	e := newPluginEnv(t)
	_, tok, _ := e.s.st.Provision("Kobo", "", "", "")
	dev := func() map[string]any {
		rec := e.do(e.admin, "GET", "/api/admin/state", nil, "")
		var out map[string]any
		json.Unmarshal(rec.Body.Bytes(), &out)
		return out["devices"].([]any)[0].(map[string]any)
	}
	get := func(q string) {
		if rec := e.do(tok, "GET", "/api/v1/sync"+q, nil, ""); rec.Code != 200 {
			t.Fatalf("sync%s: %d", q, rec.Code)
		}
	}
	blocked := func() map[string]any { b, _ := dev()["sync_blocked"].(map[string]any); return b }

	// pełna synchronizacja z zapamiętaną liczbą: zapis
	get("?plugin_version=0.8.1&sync_blocked=7")
	if b := blocked(); b == nil || b["count"] != float64(7) {
		t.Fatalf("zgłoszenie w pełnym GET: %v", dev())
	}
	// brak parametru = czyszczenie
	get("?plugin_version=0.8.1")
	if blocked() != nil {
		t.Error("brak parametru nie wyczyścił zgłoszenia")
	}
	// lekkie zgłoszenie: zapis liczby i NIE rusza danych o wtyczce
	get("?plugin_version=0.8.1&self_update=1&merge_after_sync=1")
	get("?report_only=1&sync_blocked=12")
	if b := blocked(); b == nil || b["count"] != float64(12) {
		t.Fatalf("report_only: %v", dev())
	}
	if d := dev(); d["plugin_version"] != "0.8.1" || d["self_update_allowed"] != true || d["merge_after_sync"] != true {
		t.Errorf("report_only zepsuł dane o wtyczce: %v", d)
	}
	// powtórka tej samej liczby nie zmienia czasu pierwszego zgłoszenia
	at := blocked()["at"]
	get("?report_only=1&sync_blocked=12")
	if blocked()["at"] != at {
		t.Error("powtórne zgłoszenie odświeżyło czas")
	}
	// zła wartość = czyszczenie (nigdy nie zapisuj śmieci)
	for _, bad := range []string{"0", "-1", "abc", "1000001", "1.5", "5%0A"} {
		get("?report_only=1&sync_blocked=12")
		get("?report_only=1&sync_blocked=" + bad)
		if blocked() != nil {
			t.Errorf("zła liczba %q przyjęta: %v", bad, blocked())
		}
	}
	get("?report_only=1&sync_blocked=12")
	get("?report_only=1") // zero/brak = czyść
	if blocked() != nil {
		t.Error("report_only bez liczby nie wyczyścił")
	}
	// udana synchronizacja (POST) czyści zgłoszenie
	get("?report_only=1&sync_blocked=3")
	if rec := e.do(tok, "POST", "/api/v1/sync", strings.NewReader(`{"received":0}`), "application/json"); rec.Code != 200 {
		t.Fatalf("POST: %d %s", rec.Code, rec.Body.String())
	}
	if blocked() != nil {
		t.Error("udana synchronizacja nie wyczyściła zgłoszenia")
	}
}

// TASK-46: zgoda na scalanie statystyk — zgłasza ją czytnik, stary plugin zeruje.
func TestMergeAfterSyncReported(t *testing.T) {
	e := newPluginEnv(t)
	_, tok, _ := e.s.st.Provision("Kobo", "", "", "")
	dev := func() map[string]any {
		rec := e.do(e.admin, "GET", "/api/admin/state", nil, "")
		var out map[string]any
		json.Unmarshal(rec.Body.Bytes(), &out)
		return out["devices"].([]any)[0].(map[string]any)
	}
	get := func(q string) { e.do(tok, "GET", "/api/v1/sync"+q, nil, "") }
	get("")
	if dev()["merge_after_sync"] != false {
		t.Errorf("domyślnie wyłączone: %v", dev())
	}
	get("?plugin_version=0.8.1&merge_after_sync=1")
	if dev()["merge_after_sync"] != true {
		t.Errorf("zgoda niezapamiętana: %v", dev())
	}
	for _, v := range []string{"true", "0", "2", "yes", ""} {
		get("?merge_after_sync=1")
		get("?merge_after_sync=" + v)
		if dev()["merge_after_sync"] != false {
			t.Errorf("wartość %q potraktowana jako zgoda", v)
		}
	}
	get("?merge_after_sync=1")
	get("") // stary plugin
	if dev()["merge_after_sync"] != false {
		t.Error("stary plugin nie zerował zgody")
	}
}

// TASK-45: zgoda na pobieranie artykułów Wallabag — zgłasza ją czytnik, stary plugin zeruje.
func TestWallabagAfterSyncReported(t *testing.T) {
	e := newPluginEnv(t)
	_, tok, _ := e.s.st.Provision("Kobo", "", "", "")
	dev := func() map[string]any {
		rec := e.do(e.admin, "GET", "/api/admin/state", nil, "")
		var out map[string]any
		json.Unmarshal(rec.Body.Bytes(), &out)
		return out["devices"].([]any)[0].(map[string]any)
	}
	get := func(q string) { e.do(tok, "GET", "/api/v1/sync"+q, nil, "") }
	get("")
	if dev()["wallabag_after_sync"] != false {
		t.Errorf("domyślnie wyłączone: %v", dev())
	}
	get("?wallabag_after_sync=1")
	if dev()["wallabag_after_sync"] != true || dev()["merge_after_sync"] != false {
		t.Errorf("zgoda niezapamiętana albo wpadła w scalanie: %v", dev())
	}
	for _, v := range []string{"true", "0", "2", "yes", ""} {
		get("?wallabag_after_sync=1")
		get("?wallabag_after_sync=" + v)
		if dev()["wallabag_after_sync"] != false {
			t.Errorf("wartość %q potraktowana jako zgoda", v)
		}
	}
	get("?wallabag_after_sync=1")
	get("") // stary plugin
	if dev()["wallabag_after_sync"] != false {
		t.Error("stary plugin nie zerował zgody")
	}
}
