package main

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"testing"
)

// fakeFont: nagłówek sfnt + wypełnienie (serwer sprawdza tylko nagłówek i rozmiar).
func fakeFont(magic string, tag byte) []byte {
	return append([]byte(magic+"\x00\x00\x00\x00\x00\x00\x00\x00"), bytes.Repeat([]byte{tag}, 64)...)
}

func (e *pluginEnv) fontUpload(name string, b []byte) (int, map[string]any) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("file", name)
	fw.Write(b)
	mw.Close()
	rec := e.do(e.admin, "POST", "/api/admin/fonts", &buf, mw.FormDataContentType())
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func (e *pluginEnv) fontOK(name string, b []byte) string {
	c, out := e.fontUpload(name, b)
	if c != 200 {
		e.t.Fatalf("upload czcionki %s: %d %v", name, c, out)
	}
	return out["font"].(map[string]any)["sha256"].(string)
}

func (e *pluginEnv) syncFonts(tok string, allowed bool) map[string]any {
	path := "/api/v1/sync"
	if allowed {
		path += "?fonts_allowed=1"
	}
	rec := e.do(tok, "GET", path, bytes.NewReader(nil), "")
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return out
}

func TestFontUploadRejects(t *testing.T) {
	e := newPluginEnv(t)
	ttf := fakeFont("\x00\x01\x00\x00", 1)
	for name, tc := range map[string]struct {
		file string
		b    []byte
	}{
		"zły nagłówek":            {"A.ttf", []byte("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\x00")},
		"za krótki":               {"A.ttf", []byte("OTTO")},
		"zły sufiks":              {"A.exe", ttf},
		"kolekcja jako ttf":       {"A.ttf", fakeFont("ttcf", 1)},
		"pojedyncza jako ttc":     {"A.ttc", ttf},
		"kropki w nazwie":         {"A..ttf", ttf},
		"nazwa z kropką z przodu": {".A.ttf", ttf},
	} {
		if c, _ := e.fontUpload(tc.file, tc.b); c != 400 {
			t.Errorf("%s: %d, chcę 400", name, c)
		}
	}
	// ścieżka w nagłówku części jest obcinana do nazwy pliku
	if c, out := e.fontUpload("../../Evil.ttf", ttf); c != 200 || out["font"].(map[string]any)["file"] != "Evil.ttf" {
		t.Errorf("basename: %d %v", c, out)
	}
	if c, _ := e.fontUpload("Big.ttf", append(ttf, make([]byte, fontMaxSize)...)); c != 400 {
		t.Errorf("za duży plik: %d", c)
	}
	if c, _ := e.fontUpload("Coll.ttc", fakeFont("ttcf", 2)); c != 200 {
		t.Errorf("kolekcja ttc: %d", c)
	}
	if rec := e.do("zly", "POST", "/api/admin/fonts", bytes.NewReader(nil), ""); rec.Code != 401 {
		t.Errorf("zły token admina: %d", rec.Code)
	}
}

// Zgoda tylko z czytnika; pobranie tylko za zgodą; nowsza wersja tej samej nazwy wypiera starą.
func TestFontSyncConsentAndSupersede(t *testing.T) {
	e := newPluginEnv(t)
	d, tok, _ := e.s.st.Provision("Kobo", "", "", "")
	v1 := e.fontOK("Charis.ttf", fakeFont("\x00\x01\x00\x00", 1))

	out := e.syncFonts(tok, false)
	if _, ok := out["fonts"]; ok {
		t.Fatalf("lista czcionek bez zgody czytnika: %v", out["fonts"])
	}
	if rec := e.do(tok, "GET", "/api/v1/fonts/"+v1, nil, ""); rec.Code != 403 {
		t.Errorf("pobranie bez zgody: %d", rec.Code)
	}
	out = e.syncFonts(tok, true)
	fs, _ := out["fonts"].([]any)
	if len(fs) != 1 || fs[0].(map[string]any)["sha256"] != v1 || fs[0].(map[string]any)["url"] != "/api/v1/fonts/"+v1 {
		t.Fatalf("cel: %v", out["fonts"])
	}
	if !e.s.st.S.Devices[d.ID].FontsAllowed {
		t.Error("zgoda nie zapamiętana")
	}
	rec := e.do(tok, "GET", "/api/v1/fonts/"+v1, nil, "")
	if rec.Code != 200 || rec.Header().Get("X-Koligilo-Sha256") != v1 || !bytes.HasPrefix(rec.Body.Bytes(), []byte("\x00\x01\x00\x00")) {
		t.Fatalf("pobranie: %d", rec.Code)
	}
	if rec := e.do(tok, "GET", "/api/v1/fonts/"+strings.Repeat("0", 64), nil, ""); rec.Code != 404 {
		t.Errorf("nieznana: %d", rec.Code)
	}
	if rec := e.do("zly", "GET", "/api/v1/fonts/"+v1, nil, ""); rec.Code != 401 {
		t.Errorf("zły token urządzenia: %d", rec.Code)
	}
	// Cofnięcie zgody znika z zapamiętanego stanu.
	e.syncFonts(tok, false)
	if e.s.st.S.Devices[d.ID].FontsAllowed {
		t.Error("zgoda nie cofnięta")
	}

	// Nowa wersja tej samej nazwy: tylko ona w celu; panel pokazuje, która jest aktywna.
	v2 := e.fontOK("Charis.ttf", fakeFont("\x00\x01\x00\x00", 2))
	fs, _ = e.syncFonts(tok, true)["fonts"].([]any)
	if len(fs) != 1 || fs[0].(map[string]any)["sha256"] != v2 {
		t.Fatalf("po nowej wersji: %v", fs)
	}
	active := map[string]bool{}
	for _, f := range e.s.st.ListFonts() {
		active[f.SHA256] = f.Active
	}
	if active[v1] || !active[v2] {
		t.Errorf("active: %v", active)
	}
	// Ten sam plik drugi raz — ta sama wersja, bez duplikatu.
	if again := e.fontOK("Inna.ttf", fakeFont("\x00\x01\x00\x00", 2)); again != v2 || len(e.s.st.ListFonts()) != 2 {
		t.Errorf("duplikat: %s, %d", again, len(e.s.st.ListFonts()))
	}
	// Usunięcie: znika z celu i z dysku.
	if rec := e.do(e.admin, "DELETE", "/api/admin/fonts/"+v2, nil, ""); rec.Code != 200 {
		t.Fatalf("usunięcie: %d", rec.Code)
	}
	if _, err := os.Stat(e.s.st.fontPath(v2)); err == nil {
		t.Error("plik został w magazynie")
	}
	fs, _ = e.syncFonts(tok, true)["fonts"].([]any)
	if len(fs) != 1 || fs[0].(map[string]any)["sha256"] != v1 {
		t.Errorf("po usunięciu v2 wraca v1: %v", fs)
	}
	if rec := e.do(e.admin, "DELETE", "/api/admin/fonts/"+v2, nil, ""); rec.Code != 404 {
		t.Errorf("ponowne usunięcie: %d", rec.Code)
	}
}

// Czcionka z czytnika czeka na akceptację w panelu; do tego czasu nikt jej nie dostaje.
func TestDeviceFontUploadNeedsApproval(t *testing.T) {
	e := newPluginEnv(t)
	_, tok1, _ := e.s.st.Provision("Kobo", "", "", "")
	_, tok2, _ := e.s.st.Provision("Kindle", "", "", "")
	post := func(tok, name string, b []byte) (int, map[string]any) {
		rec := e.do(tok, "POST", "/api/v1/fonts?file="+name, bytes.NewReader(b), "application/octet-stream")
		var out map[string]any
		json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}
	if c, _ := post(tok1, "Zly.ttf", []byte("not a font at all")); c != 400 {
		t.Errorf("zły plik z czytnika: %d", c)
	}
	if c, _ := post(tok1, "..%2FEvil.ttf", fakeFont("OTTO", 3)); c != 400 {
		t.Errorf("ścieżka w ?file=: %d", c)
	}
	c, out := post(tok1, "Moja.otf", fakeFont("OTTO", 3))
	if c != 200 {
		t.Fatalf("wysyłka: %d %v", c, out)
	}
	f := out["font"].(map[string]any)
	sha := f["sha256"].(string)
	if f["approved"] != false || f["source"] != SrcDevice {
		t.Fatalf("wersja z czytnika: %v", f)
	}
	if fs, _ := e.syncFonts(tok2, true)["fonts"].([]any); len(fs) != 0 {
		t.Fatalf("niezaakceptowana trafiła do celu: %v", fs)
	}
	if rec := e.do(tok2, "GET", "/api/v1/fonts/"+sha, nil, ""); rec.Code != 403 {
		t.Errorf("pobranie niezaakceptowanej: %d", rec.Code)
	}
	if rec := e.do(e.admin, "POST", "/api/admin/fonts/"+sha+"/approve", nil, ""); rec.Code != 200 {
		t.Fatalf("akceptacja: %d", rec.Code)
	}
	if fs, _ := e.syncFonts(tok2, true)["fonts"].([]any); len(fs) != 1 {
		t.Errorf("po akceptacji: %v", fs)
	}
}

// Inwentarz od czytnika trafia do stanu (bez śmieci), a panel go widzi.
func TestFontReport(t *testing.T) {
	e := newPluginEnv(t)
	d, tok, _ := e.s.st.Provision("Kobo", "", "", "")
	v := e.fontOK("A.ttf", fakeFont("true", 1))
	body := map[string]any{"received": 0, "fonts": map[string]any{"installed": []map[string]string{
		{"file": "A.ttf", "sha256": v}, {"file": "../x.ttf", "sha256": v}, {"file": "B.ttf", "sha256": "zly"},
	}}}
	b, _ := json.Marshal(body)
	if rec := e.do(tok, "POST", "/api/v1/sync", bytes.NewReader(b), "application/json"); rec.Code != http.StatusOK {
		t.Fatalf("sync POST: %d %s", rec.Code, rec.Body)
	}
	inv := e.s.st.S.Devices[d.ID].FontInventory
	if len(inv) != 1 || inv[0].File != "A.ttf" || inv[0].SHA256 != v {
		t.Errorf("inwentarz: %v", inv)
	}
	rec := e.do(e.admin, "GET", "/api/admin/state", nil, "")
	var st struct {
		Fonts   []FontFile `json:"fonts"`
		Devices []Device   `json:"devices"`
	}
	json.Unmarshal(rec.Body.Bytes(), &st)
	if len(st.Fonts) != 1 || len(st.Devices) != 1 || len(st.Devices[0].FontInventory) != 1 {
		t.Errorf("stan panelu: %+v", st)
	}
}

// Przenosiny komputer ↔ serwer (TASK-15) zabierają czcionki, a zmanipulowane archiwum odpada.
func TestFontsExportImport(t *testing.T) {
	src, _, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	f, err := src.AddFont(fakeFont("\x00\x01\x00\x00", 7), "Moja.ttf", SrcUpload, "")
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := ExportArchive(src, &buf); err != nil {
		t.Fatal(err)
	}
	raw := buf.Bytes()
	dst, _, _ := OpenStore(t.TempDir())
	if _, err := ImportArchive(dst, nil, bytes.NewReader(raw), false); err != nil {
		t.Fatal(err)
	}
	if got := dst.ListFonts(); len(got) != 1 || got[0].SHA256 != f.SHA256 || got[0].File != "Moja.ttf" {
		t.Fatalf("po imporcie: %+v", got)
	}
	if b, err := os.ReadFile(dst.fontPath(f.SHA256)); err != nil || !bytes.Equal(b, fakeFont("\x00\x01\x00\x00", 7)) {
		t.Errorf("plik po imporcie: %v", err)
	}
	// stan z czcionką, której pliku brak w archiwum
	var bad bytes.Buffer
	src2, _, _ := OpenStore(t.TempDir())
	src2.S.Fonts = map[string]*FontFile{f.SHA256: f}
	if err := ExportArchive(src2, &bad); err == nil {
		t.Error("eksport bez pliku czcionki powinien się nie udać")
	}
}

// Podgląd w panelu (TASK-38): admin pobiera bajty także niezaakceptowanej
// czcionki, czytnik i brak tokenu — nie; zły sha i nieznana wersja to 404.
func TestAdminFontFile(t *testing.T) {
	e := newPluginEnv(t)
	_, tok, _ := e.s.st.Provision("Kobo", "", "", "")
	body := fakeFont("OTTO", 9)
	rec := e.do(tok, "POST", "/api/v1/fonts?file=Moja.otf", bytes.NewReader(body), "application/octet-stream")
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	sha := out["font"].(map[string]any)["sha256"].(string)

	got := e.do(e.admin, "GET", "/api/admin/fonts/"+sha+"/file", nil, "")
	if got.Code != 200 || !bytes.Equal(got.Body.Bytes(), body) {
		t.Fatalf("admin: %d, %d bajtów", got.Code, got.Body.Len())
	}
	if got.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("brak nosniff: %v", got.Header())
	}
	if c := e.do(tok, "GET", "/api/admin/fonts/"+sha+"/file", nil, "").Code; c != 401 && c != 403 {
		t.Errorf("token czytnika w trasie admina: %d", c)
	}
	if c := e.do("", "GET", "/api/admin/fonts/"+sha+"/file", nil, "").Code; c != 401 && c != 403 {
		t.Errorf("bez tokenu: %d", c)
	}
	for _, bad := range []string{strings.Repeat("0", 64), "nie-sha", "..%2F..%2Fstate.json"} {
		if c := e.do(e.admin, "GET", "/api/admin/fonts/"+bad+"/file", nil, "").Code; c != 404 {
			t.Errorf("sha %q: %d", bad, c)
		}
	}
}

func TestFontFamilyName(t *testing.T) {
	for _, c := range []struct {
		f    FontFile
		want string
	}{
		{FontFile{File: "Charis-Regular.ttf"}, "Charis"},
		{FontFile{File: "PT_Serif-Web-Regular.ttf"}, "PT Serif"},
		{FontFile{File: "Moja.otf"}, "Moja"},
		{FontFile{File: "-x.ttf"}, "-x"},
		{FontFile{File: "AtkinsonHyperlegible-Regular.ttf", Source: SrcCatalog, SourceRef: "Atkinson Hyperlegible"}, "Atkinson Hyperlegible"},
		{FontFile{File: "Lora-Bold.ttf", Source: SrcCatalog}, "Lora"},
	} {
		if got := fontFamilyName(&c.f); got != c.want {
			t.Errorf("%s: %q, chciałem %q", c.f.File, got, c.want)
		}
	}
}

// Przydział rodzin (TASK-38): wyłączona rodzina znika ze stanu docelowego i z
// pobierania tylko u tego czytnika, a włączenie ją przywraca.
func TestFontAssign(t *testing.T) {
	e := newPluginEnv(t)
	d1, tok1, _ := e.s.st.Provision("Kobo", "", "", "")
	d2, tok2, _ := e.s.st.Provision("Kindle", "", "", "")
	shaA := e.fontOK("Alfa-Regular.ttf", fakeFont("OTTO", 1))
	e.fontOK("Alfa-Bold.ttf", fakeFont("OTTO", 2))
	e.fontOK("Beta-Regular.ttf", fakeFont("OTTO", 3))
	names := func(tok string) []string {
		var out []string
		fs, _ := e.syncFonts(tok, true)["fonts"].([]any)
		for _, f := range fs {
			out = append(out, f.(map[string]any)["file"].(string))
		}
		return out
	}
	assign := func(dev, fam string, on bool) int {
		b, _ := json.Marshal(map[string]any{"device": dev, "family": fam, "on": on})
		return e.do(e.admin, "POST", "/api/admin/fonts/assign", bytes.NewReader(b), "application/json").Code
	}
	if n := len(names(tok1)); n != 3 {
		t.Fatalf("domyślnie wszystko: %v", names(tok1))
	}
	if c := assign(d1.ID, "Alfa", false); c != 200 {
		t.Fatalf("wyłączenie: %d", c)
	}
	if got := names(tok1); len(got) != 1 || got[0] != "Beta-Regular.ttf" {
		t.Errorf("czytnik 1 po wyłączeniu Alfy: %v", got)
	}
	if n := len(names(tok2)); n != 3 {
		t.Errorf("czytnik 2 nie powinien się zmienić: %d", n)
	}
	if rec := e.do(tok1, "GET", "/api/v1/fonts/"+shaA, nil, ""); rec.Code != 403 {
		t.Errorf("pobranie wyłączonej rodziny: %d", rec.Code)
	}
	if rec := e.do(tok2, "GET", "/api/v1/fonts/"+shaA, nil, ""); rec.Code != 200 {
		t.Errorf("pobranie u czytnika bez wyłączenia: %d", rec.Code)
	}
	// panel widzi rodzinę z serwera i listę wyłączonych
	var st struct {
		Devices []struct {
			ID       string   `json:"id"`
			FontsOff []string `json:"fonts_off"`
		} `json:"devices"`
	}
	json.Unmarshal(e.do(e.admin, "GET", "/api/admin/state", nil, "").Body.Bytes(), &st)
	var off []string
	for _, d := range st.Devices {
		if d.ID == d1.ID {
			off = d.FontsOff
		}
	}
	if len(off) != 1 || off[0] != "Alfa" {
		t.Errorf("fonts_off w stanie panelu: %v (%+v)", off, st)
	}
	var fl struct {
		Fonts []struct{ File, Family string } `json:"fonts"`
	}
	json.Unmarshal(e.do(e.admin, "GET", "/api/admin/fonts", nil, "").Body.Bytes(), &fl)
	for _, f := range fl.Fonts {
		if f.Family == "" {
			t.Errorf("brak family przy %s", f.File)
		}
	}
	// powtórzenie niczego nie psuje, nieznana rodzina i urządzenie
	if c := assign(d1.ID, "Alfa", false); c != 200 {
		t.Errorf("powtórne wyłączenie: %d", c)
	}
	if n := len(e.s.st.S.Devices[d1.ID].FontsOff); n != 1 {
		t.Errorf("duplikat w FontsOff: %d", n)
	}
	if c := assign(d1.ID, "Nieznana", false); c != 404 {
		t.Errorf("nieznana rodzina: %d", c)
	}
	if c := assign("nie-ma", "Alfa", true); c != 400 {
		t.Errorf("nieznane urządzenie: %d", c)
	}
	if c := assign(d1.ID, "   ", true); c != 400 {
		t.Errorf("pusta rodzina: %d", c)
	}
	// "*" wyłącza u wszystkich, włączenie przywraca
	if c := assign("*", "Beta", false); c != 200 {
		t.Fatalf("wyłączenie u wszystkich: %d", c)
	}
	if got := names(tok2); len(got) != 2 {
		t.Errorf("czytnik 2 po wyłączeniu Bety: %v", got)
	}
	if c := assign(d1.ID, "Alfa", true); c != 200 {
		t.Fatalf("włączenie: %d", c)
	}
	if got := names(tok1); len(got) != 2 {
		t.Errorf("czytnik 1 po włączeniu Alfy (Beta nadal off): %v", got)
	}
	_ = d2
}
