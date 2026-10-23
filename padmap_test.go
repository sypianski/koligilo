package main

import (
	"encoding/json"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
)

// TASK-25 (PC-010/011/012): wspólne mapowanie przycisków gamepada KOPad.
// TASK-26: dochodzi układ valve (Steam Deck / Steam Controller) — słownik układów
// to xbox, playstation, nintendo, valve (w tej kolejności).
// TASK-27 (PC-014): opcjonalny klucz `actions` — rola → akcja w czytaniu.

// Wartość, jaką zapisuje panel (web/lua.js luaSerialize) i jaką czyta kopad.
const padmapExample = `{["layouts"]={["nintendo"]={["east"]="b",["south"]="a"},["xbox"]={["ltrigger"]="rt",["rtrigger"]="lt"}},["version"]=1}`

// Jak wyżej, ale z układem valve (TASK-26): klucze posortowane, valve między nintendo a xbox.
const padmapValveExample = `{["layouts"]={["nintendo"]={["east"]="b",["south"]="a"},["valve"]={["back"]="start",["start"]="select"},["xbox"]={["ltrigger"]="rt",["rtrigger"]="lt"}},["version"]=1}`

// Z akcjami (TASK-27): klucze posortowane, actions przed layouts.
const padmapActionsExample = `{["actions"]={["rb"]="top_menu",["select"]="next_page"},["version"]=1}`
const padmapBothExample = `{["actions"]={["rb"]="top_menu"},["layouts"]={["nintendo"]={["east"]="b",["south"]="a"}},["version"]=1}`

func TestPadmapActionsVocabulary(t *testing.T) {
	if got := strings.Join(padmapActions, ","); got != "next_page,prev_page,pages_forward_10,pages_back_10,next_chapter,prev_chapter,first_page,last_page,back_location,forward_location,goto_page,skim,top_menu,footer_menu,config_menu,toc,bookmarks,toggle_bookmark,next_bookmark,prev_bookmark,book_map,page_browser,fulltext_search,book_status,book_info,reading_progress,history,file_browser,last_book,favorites,collections,sentence_select,highlights,word_walk,crosshair,dict_lookup,font_bigger,font_smaller,night_mode,rotate,full_refresh,frontlight_toggle,frontlight_up,frontlight_down,screenshot,cheat_sheet,x_modifier,none" {
		t.Errorf("padmapActions = %s", got)
	}
	for role, act := range padmapDefaultActions {
		if !inList(padmapRoles, role) {
			t.Errorf("domyślna akcja dla nieznanej roli %q", role)
		}
		if !inList(padmapActions, act) {
			t.Errorf("domyślna akcja %q (rola %s) spoza słownika", act, role)
		}
	}
	if _, has := padmapDefaultActions["b"]; has {
		t.Error("B nie ma domyślnej akcji (działa Wstecz KOReadera)")
	}
	if len(padmapDefaultActions) != len(padmapRoles)-1 {
		t.Errorf("domyślne akcje mają %d ról, chcę %d (wszystkie poza B)", len(padmapDefaultActions), len(padmapRoles)-1)
	}
}

func TestPadmapLayoutsOrder(t *testing.T) {
	if got := strings.Join(padmapLayouts, ","); got != "xbox,playstation,nintendo,valve" {
		t.Errorf("padmapLayouts = %s, chcę xbox,playstation,nintendo,valve (valve na końcu)", got)
	}
}

func TestCatalogKopadOnlyPadmap(t *testing.T) {
	g := groupByID("kopad")
	if g == nil {
		t.Fatal("brak grupy kopad")
	}
	if len(g.Entries) != 1 {
		t.Fatalf("grupa kopad ma %d wpisów, chcę dokładnie 1: %+v", len(g.Entries), g.Entries)
	}
	e := g.Entries[0]
	if e.File != kopadFile || e.Key != "padmap" || e.Prefix != nil {
		t.Errorf("wpis grupy kopad = %+v, chcę Key \"padmap\" w %s (bez Prefix — flaga enabled jest lokalna)", e, kopadFile)
	}
	if g.Secret {
		t.Error("padmap nie jest sekretem — panel musi móc go odczytać i edytować")
	}
	for id, want := range map[string]string{
		padmapID:                                  "kopad",
		kopadFile + "|enabled":                    "",
		kopadFile + "#enabled":                    "",
		kopadFile + "#padmap":                     "",
		"settings/kopad_device.lua|padmap_layout": "",
	} {
		got := ""
		if gg := GroupOf(id); gg != nil {
			got = gg.ID
		}
		if got != want {
			t.Errorf("GroupOf(%q) = %q, chcę %q", id, got, want)
		}
	}
}

// devCall: żądanie z tokenem URZĄDZENIA (harness podstawia token admina).
func devCall(hh *harness, tok, method, path string, body any) (int, map[string]any) {
	var rd *strings.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = strings.NewReader(string(b))
	} else {
		rd = strings.NewReader("")
	}
	req := httptest.NewRequest(method, path, rd)
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	hh.s.Routes().ServeHTTP(rec, req)
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// AC3: padmap jedzie na czytnik, a enabled (i układ urządzenia) nie przyjmuje się
// ani z urządzenia, ani z panelu, ani nie trafia do wpisów synchronizacji.
func TestPadmapSyncsButEnabledDoesNot(t *testing.T) {
	hh := newHarness(t)
	d, tok, err := hh.s.st.Provision("Deck", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if c, out := hh.call("POST", "/api/admin/devices/"+d.ID+"/groups", map[string]any{"group": "kopad", "on": true}); c != 200 {
		t.Fatalf("włączenie grupy kopad: %d %v", c, out)
	}
	// panel zapisuje padmap
	if c, out := hh.call("POST", "/api/admin/values", map[string]any{"set": map[string]string{padmapID: padmapExample}}); c != 200 {
		t.Fatalf("zapis padmap z panelu: %d %v", c, out)
	}
	// czytnik dostaje padmap i tylko jego wpis w pliku kopad
	c, sync := devCall(hh, tok, "GET", "/api/v1/sync", nil)
	if c != 200 {
		t.Fatalf("sync GET: %d", c)
	}
	vals, _ := sync["values"].(map[string]any)
	if vals[padmapID] != padmapExample {
		t.Errorf("czytnik nie dostał padmap: %v", vals)
	}
	for _, e := range sync["entries"].([]any) {
		m := e.(map[string]any)
		if m["file"] == kopadFile && (m["key"] != "padmap" || m["prefix"] != nil) {
			t.Errorf("wpis kopad w sync = %v, chcę wyłącznie Key padmap", m)
		}
	}
	// czytnik próbuje wysłać enabled i swój układ: odrzucone; padmap przyjęty
	c, out := devCall(hh, tok, "POST", "/api/v1/sync", map[string]any{"set": map[string]string{
		kopadFile + "|enabled":                    "true",
		kopadFile + "#enabled":                    "true",
		"settings/kopad_device.lua|padmap_layout": `"nintendo"`,
		padmapID: `{["layouts"]={["xbox"]={["ltrigger"]="rt"}},["version"]=1}`,
	}})
	if c != 200 {
		t.Fatalf("sync POST: %d %v", c, out)
	}
	rej := map[string]bool{}
	for _, id := range out["rejected"].([]any) {
		rej[id.(string)] = true
	}
	for _, id := range []string{kopadFile + "|enabled", kopadFile + "#enabled", "settings/kopad_device.lua|padmap_layout"} {
		if !rej[id] {
			t.Errorf("%s powinno zostać odrzucone (lokalne dla urządzenia)", id)
		}
	}
	if rej[padmapID] {
		t.Error("padmap od urządzenia powinien zostać przyjęty")
	}
	for _, id := range []string{kopadFile + "|enabled", kopadFile + "#enabled"} {
		if v := hh.s.st.Get(id); v != nil {
			t.Errorf("%s trafiło do stanu serwera: %s", id, *v)
		}
		// panel też nie zapisze enabled jako wartości wspólnej
		c, out := hh.call("POST", "/api/admin/values", map[string]any{"set": map[string]string{id: "true"}})
		if c != 400 {
			t.Errorf("panel przyjął %s: %d %v, chcę 400", id, c, out)
		}
	}
}

func TestAdminValuesPadmapAccepts(t *testing.T) {
	for name, lit := range map[string]string{
		"przykład z PC-011":        padmapExample,
		"sama wersja":              `{["version"]=1}`,
		"pusty layouts":            `{["layouts"]={},["version"]=1}`,
		"pusty układ":              `{["layouts"]={["xbox"]={}},["version"]=1}`,
		"wszystkie układy":         `{["layouts"]={["nintendo"]={["north"]="lt"},["playstation"]={["back"]="rt"},["valve"]={["start"]="select"},["xbox"]={["rtrigger"]="b"}},["version"]=1}`,
		"valve z nadpisaniem":      `{["layouts"]={["valve"]={["back"]="start",["start"]="select"}},["version"]=1}`,
		"pusty układ valve":        `{["layouts"]={["valve"]={}},["version"]=1}`,
		"przykład z valve":         padmapValveExample,
		"same akcje":               padmapActionsExample,
		"układ i akcje":            padmapBothExample,
		"pusty actions":            `{["actions"]={},["version"]=1}`,
		"akcja none dla B":         `{["actions"]={["b"]="none"},["version"]=1}`,
		"akcja równa domyślnej":    `{["actions"]={["rb"]="next_page"},["version"]=1}`,
		"akcje i pusty układ":      `{["actions"]={["a"]="toc"},["layouts"]={["xbox"]={}},["version"]=1}`,
		"każda rola dostaje akcję": `{["actions"]={["a"]="word_walk",["b"]="crosshair",["lb"]="bookmarks",["lt"]="history",["rb"]="file_browser",["rt"]="footer_menu",["select"]="highlights",["start"]="sentence_select",["x"]="none",["y"]="x_modifier"},["version"]=1}`,
		"wszystkie 10 kontr.":      `{["layouts"]={["xbox"]={["back"]="a",["east"]="x",["lshoulder"]="rt",["ltrigger"]="y",["north"]="select",["rshoulder"]="lt",["rtrigger"]="b",["south"]="start",["start"]="lb",["west"]="rb"}},["version"]=1}`,
	} {
		hh := newHarness(t)
		c, out := hh.call("POST", "/api/admin/values", map[string]any{"set": map[string]string{padmapID: lit}})
		if c != 200 {
			t.Errorf("%s: %d %v, chcę 200", name, c, out)
		} else if hh.val(padmapID) != lit {
			t.Errorf("%s: zapisano %s", name, hh.val(padmapID))
		}
	}
}

func TestAdminValuesPadmapRejects(t *testing.T) {
	for _, c := range []struct{ name, lit, msg string }{
		{"pusta tabela (brak version)", `{}`, "version"},
		{"inna wersja", `{["version"]=2}`, "version"},
		{"wersja jako napis", `{["version"]="1"}`, "version"},
		{"layouts nie tabela", `{["layouts"]="x",["version"]=1}`, "layouts"},
		{"layouts jako lista", `{["layouts"]={[1]={}},["version"]=1}`, "layouts"},
		{"nieznany klucz górny", `{["extra"]=true,["version"]=1}`, "extra"},
		{"nieznany układ", `{["layouts"]={["snes"]={}},["version"]=1}`, "snes"},
		{"komunikat o nieznanym układzie wylicza dozwolone, w tym valve", `{["layouts"]={["snes"]={}},["version"]=1}`, `"valve"`},
		{"stary id układu Decka", `{["layouts"]={["steamdeck"]={}},["version"]=1}`, "steamdeck"},
		{"układ wielką literą (id są małymi)", `{["layouts"]={["Valve"]={}},["version"]=1}`, "Valve"},
		{"nieznana kontrolka w valve (tylne przyciski L4)", `{["layouts"]={["valve"]={["l4"]="a"}},["version"]=1}`, "l4"},
		{"nieznana rola w valve", `{["layouts"]={["valve"]={["south"]="l4"}},["version"]=1}`, "l4"},
		{"układ nie tabela", `{["layouts"]={["xbox"]="a"},["version"]=1}`, "xbox"},
		{"układ jako lista (klucz liczbowy)", `{["layouts"]={["xbox"]={[1]="a"}},["version"]=1}`, "xbox"},
		{"nieznana kontrolka", `{["layouts"]={["xbox"]={["dpad_up"]="a"}},["version"]=1}`, "dpad_up"},
		{"kontrolka Guide", `{["layouts"]={["xbox"]={["guide"]="a"}},["version"]=1}`, "guide"},
		{"nieznana rola", `{["layouts"]={["xbox"]={["south"]="none"}},["version"]=1}`, "none"},
		{"rola wielką literą", `{["layouts"]={["xbox"]={["south"]="A"}},["version"]=1}`, "south"},
		{"rola nie napis", `{["layouts"]={["xbox"]={["south"]=1}},["version"]=1}`, "south"},
		{"napis zamiast tabeli", `"abc"`, "tabelą"},
		{"liczba zamiast tabeli", `42`, "tabelą"},
		{"lista zamiast tabeli", `{[1]="a"}`, "tabelą"},
		{"kod zamiast literału", `os.exit(1)`, "literał"},
		{"actions nie tabela", `{["actions"]="x",["version"]=1}`, "actions"},
		{"actions jako lista", `{["actions"]={[1]="toc"},["version"]=1}`, "actions"},
		{"nieznana rola w actions", `{["actions"]={["dpad"]="next_page"},["version"]=1}`, "dpad"},
		{"rola wielką literą w actions", `{["actions"]={["RB"]="toc"},["version"]=1}`, "RB"},
		{"nieznana akcja", `{["actions"]={["rb"]="teleport"},["version"]=1}`, "teleport"},
		{"komunikat o nieznanej akcji wylicza dozwolone", `{["actions"]={["rb"]="teleport"},["version"]=1}`, `"top_menu"`},
		{"akcja wielką literą", `{["actions"]={["rb"]="Top_Menu"},["version"]=1}`, "Top_Menu"},
		{"akcja nie napis", `{["actions"]={["rb"]=1},["version"]=1}`, "rb"},
		{"akcja jako tabela", `{["actions"]={["rb"]={}},["version"]=1}`, "rb"},
		{"actions bez version", `{["actions"]={["rb"]="toc"}}`, "version"},
		{"poprawne actions obok błędnego układu", `{["actions"]={["rb"]="toc"},["layouts"]={["snes"]={}},["version"]=1}`, "snes"},
		{"błędne actions obok poprawnego układu", `{["actions"]={["rb"]="teleport"},["layouts"]={["xbox"]={}},["version"]=1}`, "teleport"},
	} {
		hh := newHarness(t)
		code, out := hh.call("POST", "/api/admin/values", map[string]any{"set": map[string]string{padmapID: c.lit}})
		if code != 400 {
			t.Errorf("%s: %d %v, chcę 400", c.name, code, out)
			continue
		}
		if e, _ := out["error"].(string); !strings.Contains(e, c.msg) {
			t.Errorf("%s: komunikat %q powinien wspominać %q", c.name, e, c.msg)
		}
		if hh.val(padmapID) != "<brak>" {
			t.Errorf("%s: odrzucona wartość nie powinna nic zapisać", c.name)
		}
	}
}

func TestAdminValuesPadmapDelete(t *testing.T) {
	hh := newHarness(t)
	hh.call("POST", "/api/admin/values", map[string]any{"set": map[string]string{padmapID: padmapExample}})
	if c, out := hh.call("POST", "/api/admin/values", map[string]any{"delete": []string{padmapID}}); c != 200 {
		t.Fatalf("usunięcie padmap: %d %v", c, out)
	}
	if hh.val(padmapID) != "<brak>" {
		t.Errorf("po usunięciu wartość = %s", hh.val(padmapID))
	}
}

// Słownik serwera == słownik panelu (web/padmap.js), a literał złożony przez
// panel (luaSerialize) to dokładnie przykład z PC-011 i przechodzi walidację.
func TestPadmapVocabularyMatchesPanel(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("brak node — zgodność słownika z web/padmap.js sprawdza też make test")
	}
	js := `const P = require("./web/padmap.js");
console.log(JSON.stringify({id: P.ID, v: P.VERSION, l: P.LAYOUT_IDS, c: P.CONTROL_IDS, r: P.ROLE_IDS, a: P.ACTION_IDS, da: P.DEFAULT_ACTIONS,
  litA: P.toLiteral({}, {select: "next_page", rb: "top_menu"}),
  litBoth: P.toLiteral({nintendo: {south: "a", east: "b"}}, {rb: "top_menu"}),
  noneA: P.toLiteral({xbox: {}}, {}),
  lit: P.toLiteral({nintendo: {south: "a", east: "b"}, xbox: {ltrigger: "rt", rtrigger: "lt"}}),
  litValve: P.toLiteral({nintendo: {south: "a", east: "b"}, valve: {back: "start", start: "select"}, xbox: {ltrigger: "rt", rtrigger: "lt"}}),
  valveDefault: P.defaultMap("valve"), identity: P.IDENTITY,
  none: P.toLiteral({nintendo: {}, valve: {}, xbox: {}})}))`
	raw, err := exec.Command(node, "-e", js).Output()
	if err != nil {
		t.Fatalf("node: %v", err)
	}
	var got struct {
		ID    string            `json:"id"`
		V     int               `json:"v"`
		L     []string          `json:"l"`
		C     []string          `json:"c"`
		R     []string          `json:"r"`
		A     []string          `json:"a"`
		DA    map[string]any    `json:"da"`
		LitA  string            `json:"litA"`
		LitB  string            `json:"litBoth"`
		NoneA *string           `json:"noneA"`
		Lit   string            `json:"lit"`
		LitV  string            `json:"litValve"`
		VDef  map[string]string `json:"valveDefault"`
		Id    map[string]string `json:"identity"`
		None  *string           `json:"none"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	same := func(name string, a, b []string) {
		if strings.Join(a, ",") != strings.Join(b, ",") {
			t.Errorf("%s: panel %v != serwer %v", name, a, b)
		}
	}
	same("układy", got.L, padmapLayouts)
	same("kontrolki", got.C, padmapControls)
	same("role", got.R, padmapRoles)
	same("akcje", got.A, padmapActions)
	// domyślne akcje: te same role i te same wartości (B = null po stronie panelu)
	if len(got.DA) != len(padmapRoles) {
		t.Errorf("domyślne akcje w panelu mają %d ról, chcę %d", len(got.DA), len(padmapRoles))
	}
	for _, role := range padmapRoles {
		want, has := padmapDefaultActions[role]
		v, inPanel := got.DA[role]
		if !inPanel {
			t.Errorf("panel nie zna domyślnej akcji roli %s", role)
		} else if !has && v != nil {
			t.Errorf("rola %s: panel ma domyślną akcję %v, serwer jej nie ma", role, v)
		} else if has && v != want {
			t.Errorf("rola %s: domyślna akcja panel %v != serwer %s", role, v, want)
		}
	}
	if got.ID != padmapID || got.V != padmapVersion {
		t.Errorf("ID/wersja: panel %s v%d, serwer %s v%d", got.ID, got.V, padmapID, padmapVersion)
	}
	if got.Lit != padmapExample {
		t.Errorf("literał z panelu:\n got %s\nwant %s", got.Lit, padmapExample)
	}
	if err := validatePadmap(got.Lit); err != nil {
		t.Errorf("serwer odrzuca literał z panelu: %v", err)
	}
	// TASK-26: układ valve — literał z panelu jest bajt w bajt taki, jaki serwer przyjmuje
	if got.LitV != padmapValveExample {
		t.Errorf("literał z valve z panelu:\n got %s\nwant %s", got.LitV, padmapValveExample)
	}
	if err := validatePadmap(got.LitV); err != nil {
		t.Errorf("serwer odrzuca literał z valve z panelu: %v", err)
	}
	if len(got.VDef) != len(padmapControls) {
		t.Errorf("domyślne valve w panelu ma %d kontrolek, chcę %d", len(got.VDef), len(padmapControls))
	}
	for _, c := range padmapControls {
		if got.VDef[c] != got.Id[c] || got.Id[c] == "" {
			t.Errorf("valve domyślnie ma być tożsamością (jak Xbox): %s -> %q, tożsamość %q", c, got.VDef[c], got.Id[c])
		}
	}
	// TASK-27: literały z akcjami składane przez panel są bajt w bajt tym, co serwer przyjmuje
	if got.LitA != padmapActionsExample {
		t.Errorf("literał z akcjami z panelu:\n got %s\nwant %s", got.LitA, padmapActionsExample)
	}
	if got.LitB != padmapBothExample {
		t.Errorf("literał z układem i akcjami z panelu:\n got %s\nwant %s", got.LitB, padmapBothExample)
	}
	for name, lit := range map[string]string{"akcje": got.LitA, "układ i akcje": got.LitB} {
		if err := validatePadmap(lit); err != nil {
			t.Errorf("serwer odrzuca literał z panelu (%s): %v", name, err)
		}
	}
	if got.NoneA != nil {
		t.Errorf("brak nadpisań układów i akcji → wartość ma być usuwana (null), jest %q", *got.NoneA)
	}
	if got.None != nil {
		t.Errorf("brak nadpisań w panelu → wartość ma być usuwana (null), jest %q", *got.None)
	}
}
