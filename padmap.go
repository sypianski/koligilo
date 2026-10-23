package main

import (
	"fmt"
	"sort"
	"strings"
)

// Mapowanie przycisków gamepada dla wtyczki KOPad (TASK-25, TASK-26, TASK-27;
// decyzje PC-010, PC-011, PC-012, PC-014). Jedyna wspólna wartość pliku
// settings/kopad.lua to `padmap`:
//
//	padmap = {
//	    version = 1,
//	    layouts = { <układ> = { <kontrolka> = "<rola>" } },  -- fizyczny przycisk → rola
//	    actions = { <rola> = "<akcja>" },                    -- rola → akcja w czytaniu
//	}
//
// `actions` (PC-014) jest opcjonalne i addytywne w version 1: dotyczy roli, nie
// kontrolki, więc jest wspólne dla wszystkich układów, a stara wtyczka kopad
// po prostu je pomija.
//
// Słownik (układy, kontrolki fizyczne, role, akcje) jest kontraktem z wtyczką kopad
// (padmap.lua w ~/projekti/koreader-kopad) i z panelem (web/padmap.js) —
// zmiana wymaga zmiany we wszystkich trzech miejscach; zgodność z panelem
// pilnuje TestPadmapVocabularyMatchesPanel. Wtyczka tylko ostrzega i pomija
// to, czego nie rozumie; serwer jest ostrzejszy i takiej wartości nie przyjmie,
// żeby panel nie zapisał czegoś, co czytniki będą po cichu ignorować.

// padmapID — ID wartości (wpis Key w grupie kopad).
const padmapID = kopadFile + "|padmap"

const padmapVersion = 1

// Kolejność jak w interfejsie (valve na końcu — dodany w TASK-26).
var padmapLayouts = []string{"xbox", "playstation", "nintendo", "valve"}

// Kontrolki fizyczne: pozycje SDL3 (te same na każdym padzie).
var padmapControls = []string{
	"south", "east", "west", "north", "back", "start",
	"lshoulder", "rshoulder", "ltrigger", "rtrigger",
}

// Role kopad (etykiety Xbox).
var padmapRoles = []string{"a", "b", "x", "y", "select", "start", "lb", "rb", "lt", "rt"}

// Akcje roli w czytaniu (PC-014), w kolejności jak w interfejsie. Znaczenie każdej
// opisuje padmap.lua (ACTION_ORDER) po stronie wtyczki.
var padmapActions = []string{
	"next_page", "prev_page", "pages_forward_10", "pages_back_10", "next_chapter",
	"prev_chapter", "first_page", "last_page", "back_location", "forward_location",
	"goto_page", "skim", "top_menu", "footer_menu", "config_menu", "toc", "bookmarks",
	"toggle_bookmark", "next_bookmark", "prev_bookmark", "book_map", "page_browser",
	"fulltext_search", "book_status", "book_info", "reading_progress", "history",
	"file_browser", "last_book", "favorites", "collections", "sentence_select",
	"highlights", "word_walk", "crosshair", "dict_lookup", "font_bigger", "font_smaller",
	"night_mode", "rotate", "full_refresh", "frontlight_toggle", "frontlight_up",
	"frontlight_down", "screenshot", "cheat_sheet", "x_modifier", "none",
}

// Co każda rola robi w czytaniu bez nadpisania (padmap.lua DEFAULT_ACTIONS).
// Brak B: kopad nic tam nie robi, działa Wstecz KOReadera.
var padmapDefaultActions = map[string]string{
	"a": "sentence_select", "x": "x_modifier", "y": "highlights",
	"lb": "prev_page", "rb": "next_page", "lt": "prev_page", "rt": "next_page",
	"select": "top_menu", "start": "footer_menu",
}

func inList(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func quotedList(list []string) string {
	q := make([]string, len(list))
	for i, x := range list {
		q[i] = quoteLua(x)
	}
	return strings.Join(q, ", ")
}

func sortedKeys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// validatePadmap sprawdza literał wartości `padmap`: tabela z kluczami
// tekstowymi, version == 1 (liczba), opcjonalne layouts z wpisami wyłącznie
// dla znanych układów, a w nich kontrolka → rola ze słownika, oraz opcjonalne
// actions: rola → akcja ze słownika (PC-014). Błąd jest czytelnym komunikatem
// po polsku.
func validatePadmap(lit string) error {
	v, err := decodeLua(lit)
	if err != nil {
		return fmt.Errorf("to nie jest literał Lua: %v", err)
	}
	top, ok := v.(map[string]any)
	if !ok {
		return fmt.Errorf("padmap musi być tabelą z kluczami tekstowymi")
	}
	for _, k := range sortedKeys(top) {
		if k != "version" && k != "layouts" && k != "actions" {
			return fmt.Errorf("nieznany klucz %s (dozwolone: \"version\", \"layouts\", \"actions\")", quoteLua(k))
		}
	}
	ver, ok := top["version"].(float64)
	if !ok || ver != padmapVersion {
		return fmt.Errorf("version musi być liczbą %d (kopad ignoruje całość przy innej wersji)", padmapVersion)
	}
	if raw, has := top["layouts"]; has {
		if err := validatePadmapLayouts(raw); err != nil {
			return err
		}
	}
	if raw, has := top["actions"]; has {
		return validatePadmapActions(raw)
	}
	return nil
}

func validatePadmapLayouts(raw any) error {
	layouts, ok := raw.(map[string]any)
	if !ok {
		return fmt.Errorf("layouts musi być tabelą z kluczami tekstowymi")
	}
	for _, name := range sortedKeys(layouts) {
		if !inList(padmapLayouts, name) {
			return fmt.Errorf("nieznany układ %s (dozwolone: %s)", quoteLua(name), quotedList(padmapLayouts))
		}
		ov, ok := layouts[name].(map[string]any)
		if !ok {
			return fmt.Errorf("układ %s musi być tabelą z kluczami tekstowymi", quoteLua(name))
		}
		for _, ctl := range sortedKeys(ov) {
			if !inList(padmapControls, ctl) {
				return fmt.Errorf("nieznana kontrolka %s w układzie %s (dozwolone: %s)",
					quoteLua(ctl), quoteLua(name), quotedList(padmapControls))
			}
			role, ok := ov[ctl].(string)
			if !ok {
				return fmt.Errorf("rola dla %s w układzie %s musi być napisem (jednym z: %s)",
					quoteLua(ctl), quoteLua(name), quotedList(padmapRoles))
			}
			if !inList(padmapRoles, role) {
				return fmt.Errorf("nieznana rola %s dla %s w układzie %s (dozwolone: %s)",
					quoteLua(role), quoteLua(ctl), quoteLua(name), quotedList(padmapRoles))
			}
		}
	}
	return nil
}

// validatePadmapActions: tabela rola → akcja, obie ze słownika. Pusta tabela jest
// poprawna (panel jej nie zapisuje, ale nie ma powodu jej odrzucać).
func validatePadmapActions(raw any) error {
	actions, ok := raw.(map[string]any)
	if !ok {
		return fmt.Errorf("actions musi być tabelą z kluczami tekstowymi")
	}
	for _, role := range sortedKeys(actions) {
		if !inList(padmapRoles, role) {
			return fmt.Errorf("nieznana rola %s w actions (dozwolone: %s)", quoteLua(role), quotedList(padmapRoles))
		}
		act, ok := actions[role].(string)
		if !ok {
			return fmt.Errorf("akcja dla roli %s musi być napisem (jednym z: %s)", quoteLua(role), quotedList(padmapActions))
		}
		if !inList(padmapActions, act) {
			return fmt.Errorf("nieznana akcja %s dla roli %s (dozwolone: %s)", quoteLua(act), quoteLua(role), quotedList(padmapActions))
		}
	}
	return nil
}

// validateValue: semantyka wartości, dla których serwer zna format (na razie
// tylko padmap). Wywoływana po decodeLua, przy zapisie z panelu.
func validateValue(id, lit string) error {
	if id == padmapID {
		return validatePadmap(lit)
	}
	return nil
}
