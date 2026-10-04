package main

import (
	"archive/zip"
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Budowa routerów panikuje przy kolizji wzorców ServeMux — łapiemy to w teście,
// a nie dopiero przy pierwszym uruchomieniu panelu.
func TestRoutesBuild(t *testing.T) {
	st, _, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	srv := (&Server{st: st}).Routes()
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	dk, err := NewDesktop(t.TempDir(), "127.0.0.1:0", "")
	if err != nil {
		t.Fatal(err)
	}
	desk := dk.Routes()
	for _, c := range []struct {
		name string
		h    interface {
			ServeHTTP(http.ResponseWriter, *http.Request)
		}
		path string
		want int
	}{
		{"serwer: UI", srv, "/", 200},
		{"serwer: admin bez tokenu", srv, "/api/admin/state", 401},
		{"desktop: UI", desk, "/", 200},
		{"desktop: config", desk, "/api/local/config", 200},
		{"desktop: admin w trybie komputera — lokalnie", desk, "/api/admin/state", 200},
		{"desktop: urządzenia — admin to 404", dk.devMux, "/api/admin/state", 404},
		{"desktop: urządzenia — UI to 404", dk.devMux, "/", 404},
		{"desktop: urządzenia — ping", dk.devMux, "/api/v1/ping", 200},
	} {
		rec := httptest.NewRecorder()
		c.h.ServeHTTP(rec, httptest.NewRequest("GET", c.path, nil))
		if rec.Code != c.want {
			t.Errorf("%s: %s → %d, chcę %d", c.name, c.path, rec.Code, c.want)
		}
	}
}

func TestCatalogMatches(t *testing.T) {
	cases := map[string]string{
		"settings.reader.lua#copt_line_spacing":    "wyglad",
		"settings.reader.lua#copt_font_size":       "", // tylko jako Key w „uklad”
		"settings.reader.lua|copt_font_size":       "uklad",
		"settings.reader.lua#copt_rotation_mode":   "",
		"settings/profiles.lua#Nocny v1.2":         "profile",
		"settings/wallabag.lua|wallabag.password":  "konto_wallabag",
		"settings/wallabag.lua|wallabag.directory": "",
		"settings.reader.lua|device_id":            "",
		"settings/kopad.lua#anything":              "kopad",
		"settings/kokeyboard.lua#label_order":      "klawiatura",
		"settings/assistant.lua|provider":          "asystent",
		"settings/rosetta.lua|font_size":           "rosetta_ustawienia",
		"settings/rosetta.lua|ai_api_key":          "rosetta_klucze",
		"settings/rosetta.lua|paraligilo_path":     "", // ścieżka urządzenia — celowo poza katalogiem
		"settings/rosetta.lua|book__x":             "", // klucze per-książka — celowo poza katalogiem
	}
	for id, want := range cases {
		got := ""
		if g := GroupOf(id); g != nil {
			got = g.ID
		}
		if got != want {
			t.Errorf("GroupOf(%q) = %q, chcę %q", id, got, want)
		}
	}
}

// deviceKeys — kopia Sync.DEVICE_KEYS z plugin/koligilo.koplugin/sync.lua (bez "*").
// Trzymana osobno, bo Go nie parsuje tu Lua — przy zmianie czarnej listy w sync.lua
// zaktualizuj też tę mapę.
var deviceKeys = map[string]map[string]bool{
	"settings.reader.lua": {
		"device_id": true, "last_migration_date": true,
		"home_dir": true, "lastdir": true, "lastfile": true, "inbox_dir": true,
		"download_dir": true, "screenshot_dir": true, "screensaver_dir": true,
		"screensaver_image": true, "wikipedia_save_dir": true, "extra_plugin_paths": true,
		"cover_image_path": true, "cover_image_cache_path": true, "cover_image_fallback_path": true,
		"screen_dpi": true, "custom_screen_dpi": true, "dev_no_hw_dither": true,
		"dev_no_sw_dither": true, "closed_rotation_mode": true, "fm_rotation_mode": true,
		"lock_rotation": true, "copt_rotation_mode": true,
		"frontlight_intensity": true, "frontlight_warmth": true, "is_frontlight_on": true,
		"night_mode": true,
		"wifi_enable_action": true, "wifi_disable_action": true, "wifi_was_on": true,
		"auto_restore_wifi": true, "auto_disable_wifi": true,
		"kindle_hall_effect_sensor_enabled": true, "system_fonts": true,
		"screensaver_cycle_index": true, "httpinspector": true, "SSH_port": true,
	},
	"settings/wallabag.lua": {"wallabag.directory": true, "wallabag.access_token": true, "wallabag.token_expiry": true},
}

// TASK-4 AC2: żaden wpis Key w Catalog nie może być kluczem urządzenia z
// czarnej listy pluginu (Sync.DEVICE_KEYS w sync.lua).
func TestCatalogExcludesDeviceKeys(t *testing.T) {
	for _, g := range Catalog {
		for _, e := range g.Entries {
			if e.Key == "" {
				continue // wpisy Prefix sprawdzane osobno niżej
			}
			if bad, ok := deviceKeys[e.File]; ok && bad[e.Key] {
				t.Errorf("grupa %q: Key %q w pliku %q jest na czarnej liście DEVICE_KEYS", g.ID, e.Key, e.File)
			}
		}
	}
	// settings/koligilo.lua jest w całości na czarnej liście (["*"] = true) —
	// żadna grupa katalogu nie powinna go w ogóle dotykać.
	for _, g := range Catalog {
		for _, e := range g.Entries {
			if e.File == "settings/koligilo.lua" {
				t.Errorf("grupa %q: settings/koligilo.lua jest w całości zastrzeżony dla urządzenia", g.ID)
			}
		}
	}
}

func TestPluginZip(t *testing.T) {
	st, _, _ := OpenStore(t.TempDir())
	rec := httptest.NewRecorder()
	(&Server{st: st}).Routes().ServeHTTP(rec, httptest.NewRequest("GET", "/koligilo.koplugin.zip", nil))
	b := rec.Body.Bytes()
	zr, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if rec.Code != 200 || err != nil {
		t.Fatalf("zip: %d %v", rec.Code, err)
	}
	want := map[string]bool{"koligilo.koplugin/main.lua": false, "koligilo.koplugin/sync.lua": false, "koligilo.koplugin/_meta.lua": false}
	for _, f := range zr.File {
		if _, ok := want[f.Name]; ok {
			want[f.Name] = true
		}
	}
	for n, ok := range want {
		if !ok {
			t.Errorf("brak %s w zipie", n)
		}
	}
}
