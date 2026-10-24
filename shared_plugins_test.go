package main

import (
	"reflect"
	"strings"
	"testing"
)

// PC-017: wtyczki wspólne trafiają do nowych czytników (parowanie kodem i kablem) oraz,
// przy zmianie listy, do już sparowanych; usunięcie z listy niczego nie odinstalowuje.
func TestSharedPlugins(t *testing.T) {
	e := newPluginEnv(t)
	foo := e.uploadOK(goodZip(t, "foo.koplugin"))["sha256"].(string)
	bar := e.uploadOK(goodZip(t, "bar.koplugin"))["sha256"].(string)
	old, _, _ := e.s.st.Provision("Kobo", "", "", "")

	// Walidacja jak przy przypisaniu urządzenia; błędna lista niczego nie zmienia.
	for name, body := range map[string]map[string]string{
		"nieznany sha":  {"foo.koplugin": strings.Repeat("0", 64)},
		"nie ta wersja": {"foo.koplugin": bar},
		"koligilo":      {"koligilo.koplugin": foo},
		"pusty katalog": {"": foo},
	} {
		if c, _ := e.jsonDo(e.admin, "POST", "/api/admin/shared-plugins", map[string]any{"plugins": body}); c != 400 {
			t.Errorf("wspólne %s: %d, chcę 400", name, c)
		}
	}
	dv, err := e.s.st.AddPlugin(goodZip(t, "baz.koplugin"), SrcDevice, old.ID, "")
	if err != nil || dv.Approved {
		t.Fatalf("wersja z urządzenia: %v %+v", err, dv)
	}
	if c, _ := e.jsonDo(e.admin, "POST", "/api/admin/shared-plugins", map[string]any{"plugins": map[string]string{"baz.koplugin": dv.SHA256}}); c != 400 {
		t.Errorf("niezaakceptowana wersja we wspólnych: %d", c)
	}
	if got := e.s.st.SharedPluginList(); len(got) != 0 || len(e.s.st.S.Devices[old.ID].Plugins) != 0 {
		t.Fatalf("odrzucone listy coś zmieniły: %v %v", got, e.s.st.S.Devices[old.ID].Plugins)
	}

	// Ustawienie listy trafia do już sparowanego czytnika, ale nie włącza jego zgody.
	c, out := e.jsonDo(e.admin, "POST", "/api/admin/shared-plugins", map[string]any{"plugins": map[string]string{"foo.koplugin": foo}})
	if c != 200 || !reflect.DeepEqual(out["changed"], []any{"Kobo"}) {
		t.Fatalf("ustawienie wspólnych: %d %v", c, out)
	}
	if got := e.s.st.S.Devices[old.ID].Plugins; !reflect.DeepEqual(got, map[string]string{"foo.koplugin": foo}) || e.s.st.S.Devices[old.ID].PluginsAllowed {
		t.Fatalf("stary czytnik: %v, zgoda=%v", got, e.s.st.S.Devices[old.ID].PluginsAllowed)
	}
	// Powtórzenie tej samej listy nic nie zmienia.
	if _, out = e.jsonDo(e.admin, "POST", "/api/admin/shared-plugins", map[string]any{"plugins": map[string]string{"foo.koplugin": foo}}); len(out["changed"].([]any)) != 0 {
		t.Errorf("powtórzenie zmieniło urządzenia: %v", out["changed"])
	}

	// Nowy czytnik (kablem i kodem) dostaje wspólne od razu, a własne wtyczki starego zostają.
	if err := e.s.st.SetDevicePlugins(old.ID, map[string]string{"foo.koplugin": foo, "bar.koplugin": bar}); err != nil {
		t.Fatal(err)
	}
	usb, _, _ := e.s.st.Provision("Kindle", "", "", "")
	if got := e.s.st.S.Devices[usb.ID].Plugins; !reflect.DeepEqual(got, map[string]string{"foo.koplugin": foo}) {
		t.Errorf("czytnik z kabla: %v", got)
	}
	pr, err := e.s.st.NewPairRequest("Deck", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	d, err := e.s.st.Decide(pr.ID, true)
	if err != nil || d == nil {
		t.Fatalf("parowanie kodem: %v", err)
	}
	if got := e.s.st.S.Devices[d.ID].Plugins; !reflect.DeepEqual(got, map[string]string{"foo.koplugin": foo}) {
		t.Errorf("czytnik z kodu: %v", got)
	}

	// Zmiana wersji we wspólnych (nowa wersja foo) przechodzi do wszystkich, którzy mają inną.
	foo2 := e.uploadOK(mkZip(t,
		zent{name: "foo.koplugin/_meta.lua", body: strings.Replace(testMeta, "1.2", "1.3", 1)},
		zent{name: "foo.koplugin/main.lua", body: "return {}"}))["sha256"].(string)
	if foo2 == foo {
		t.Fatal("druga wersja ma ten sam sha")
	}
	if _, out = e.jsonDo(e.admin, "POST", "/api/admin/shared-plugins", map[string]any{"plugins": map[string]string{"foo.koplugin": foo2}}); len(out["changed"].([]any)) != 3 {
		t.Errorf("zmiana wersji: %v", out["changed"])
	}
	if got := e.s.st.S.Devices[old.ID].Plugins; got["foo.koplugin"] != foo2 || got["bar.koplugin"] != bar {
		t.Errorf("stary po zmianie wersji: %v", got)
	}

	// Wersja z listy wspólnej nie da się skasować z magazynu.
	if c, out := e.jsonDo(e.admin, "DELETE", "/api/admin/plugins/"+foo2, nil); c == 200 || !strings.Contains(out["error"].(string), "wspólne") {
		t.Errorf("skasowanie wspólnej wersji: %d %v", c, out)
	}

	// Pusta lista: nowe czytniki nic nie dostają, obecne zachowują cele (to nie odinstalowanie).
	if _, out = e.jsonDo(e.admin, "POST", "/api/admin/shared-plugins", map[string]any{"plugins": map[string]string{}}); len(out["changed"].([]any)) != 0 {
		t.Errorf("pusta lista zmieniła urządzenia: %v", out["changed"])
	}
	if got := e.s.st.S.Devices[old.ID].Plugins; got["foo.koplugin"] != foo2 {
		t.Errorf("pusta lista odpięła wtyczkę: %v", got)
	}
	late, _, _ := e.s.st.Provision("Nowy", "", "", "")
	if got := e.s.st.S.Devices[late.ID].Plugins; len(got) != 0 {
		t.Errorf("po wyczyszczeniu listy nowy czytnik dostał %v", got)
	}

	// Lista przeżywa zapis i odczyt stanu.
	e.jsonDo(e.admin, "POST", "/api/admin/shared-plugins", map[string]any{"plugins": map[string]string{"bar.koplugin": bar}})
	if _, st := e.jsonDo(e.admin, "GET", "/api/admin/state", nil); !reflect.DeepEqual(st["shared_plugins"], map[string]any{"bar.koplugin": bar}) {
		t.Errorf("state.shared_plugins = %v", st["shared_plugins"])
	}
}
