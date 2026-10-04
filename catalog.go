package main

import "strings"

// Katalog grup ustawień — jedyne źródło prawdy o tym, CO wolno synchronizować.
// Plugin dostaje z serwera tylko wpisy grup włączonych dla danego urządzenia,
// a serwer odrzuca zapisy spoza nich. Niezależnie od tego plugin ma własną,
// twardą czarną listę kluczy urządzenia (DEVICE_KEYS w sync.lua).
//
// Identyfikator wartości (ID):
//   "<plik>|<ścieżka.z.kropkami>" — wpis Key (zagnieżdżony klucz),
//   "<plik>#<klucz>"              — klucz najwyższego poziomu dopasowany Prefix
//                                    (bez dzielenia po kropkach: nazwy profili
//                                    mogą zawierać kropki).

type Entry struct {
	File   string   `json:"file"`
	Key    string   `json:"key,omitempty"`    // dokładna ścieżka, np. "wallabag.server_url"
	Prefix *string  `json:"prefix,omitempty"` // klucze top-level z tym prefiksem ("" = wszystkie)
	Except []string `json:"except,omitempty"` // wyjątki dla Prefix
}

type Group struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Warning     string  `json:"warning,omitempty"` // dlaczego domyślnie wyłączone / na co uważać
	Secret      bool    `json:"secret,omitempty"`  // zawiera hasła/tokeny
	Default     bool    `json:"default"`
	Entries     []Entry `json:"entries"`
}

const readerFile = "settings.reader.lua"

func pfx(s string) *string { return &s }

// Klucze układu strony zależne od fizycznego ekranu — osobna grupa, domyślnie off.
var layoutKeys = []string{
	"copt_font_size", "copt_h_page_margins", "copt_t_page_margin",
	"copt_b_page_margin", "copt_page_margins",
}

var Catalog = []Group{
	{
		ID: "wyglad", Name: "Wygląd tekstu",
		Description: "Domyślne opcje dokumentu: interlinia, odstępy między słowami, dzielenie wyrazów, tryb renderowania, pogrubienie. To, jak wygląda tekst po otwarciu nowej książki.",
		Default:     true,
		Entries: []Entry{{File: readerFile, Prefix: pfx("copt_"),
			Except: append([]string{"copt_rotation_mode"}, layoutKeys...)}},
	},
	{
		ID: "uklad", Name: "Rozmiar czcionki i marginesy",
		Description: "Domyślny rozmiar czcionki i marginesy strony.",
		Warning:     "Zależą od wielkości i rozdzielczości ekranu — 20 pt na 6-calowym czytniku to co innego niż na telefonie. Włącz tylko między urządzeniami o podobnym ekranie.",
		Entries:     keys(readerFile, layoutKeys...),
	},
	{
		ID: "style", Name: "Poprawki stylu (style tweaks)",
		Description: "Włączone poprawki CSS: np. wdowy i sieroty, wyświetlanie przypisów, justowanie.",
		Default:     true,
		Entries:     keys(readerFile, "style_tweaks", "style_tweaks_in_dispatcher"),
	},
	{
		ID: "fonty", Name: "Wybór czcionek",
		Description: "Domyślna czcionka, czcionki rodzin i czcionka zapasowa.",
		Warning:     "Działa tylko, jeśli te same pliki czcionek są zainstalowane na urządzeniu docelowym — inaczej KOReader wróci do czcionki domyślnej.",
		Entries:     keys(readerFile, "cre_font", "cre_font_family_fonts", "fallback_font"),
	},
	{
		ID: "stopka", Name: "Stopka i pasek postępu",
		Description: "Co pokazuje stopka (godzina, bateria, strony, rozdział), znaczniki spisu treści, separatory.",
		Default:     true,
		Entries:     keys(readerFile, "footer", "reader_footer_mode"),
	},
	{
		ID: "slowniki", Name: "Słowniki",
		Description: "Kolejność słowników, wyłączone słowniki i zestawy (presety). Same pliki słowników przenieś osobno.",
		Default:     true,
		Entries:     keys(readerFile, "dicts_order", "dicts_disabled", "dict_presets"),
	},
	{
		ID: "gesty", Name: "Gesty",
		Description: "Co robi stuknięcie w róg, przeciągnięcie, uszczypnięcie — w czytniku i w menedżerze plików.",
		Default:     true,
		Entries:     keys("settings/gestures.lua", "gesture_fm", "gesture_reader"),
	},
	{
		ID: "skroty", Name: "Skróty klawiszowe",
		Description: "Przypisania klawiszy fizycznych (hotkeys).",
		Warning:     "Urządzenia mają różne klawiatury i przyciski — przypisanie z Kindle'a może nie mieć sensu na telefonie.",
		Entries:     []Entry{{File: "settings/hotkeys.lua", Prefix: pfx("")}},
	},
	{
		ID: "profile", Name: "Profile",
		Description: "Zapisane profile (zestawy akcji uruchamiane jednym gestem) i ich autostart.",
		Default:     true,
		Entries: []Entry{
			{File: "settings/profiles.lua", Prefix: pfx("")},
			{File: readerFile, Key: "profiles_autoexec"},
		},
	},
	{
		ID: "listy", Name: "Menedżer plików i listy",
		Description: "Sortowanie, filtr historii, ekran startowy, liczba pozycji na stronie w zakładkach i spisie treści.",
		Default:     true,
		Entries: keys(readerFile, "collate", "reverse_collate", "collate_mixed", "start_with",
			"history_filter", "bookmarks_items_per_page", "bookmarks_items_text_type",
			"toc_items_per_page", "inertial_scroll", "auto_save_settings_interval_minutes"),
	},
	{
		ID: "statystyki", Name: "Opcje statystyk",
		Description: "Jak wygląda kalendarz i statystyki czytania (bez samego serwera synchronizacji — ten jest w grupie „Serwer statystyk”).",
		Default:     true,
		Entries: keys(readerFile, "statistics.freeze_finished_books", "statistics.calendar_browse_future_months",
			"statistics.calendar_nb_book_spans", "statistics.calendar_show_histogram",
			"statistics.calendar_start_day_of_week"),
	},
	{
		ID: "konto_kosync", Name: "Konto synchronizacji postępu (kosync)",
		Description: "Adres serwera postępu czytania, login i klucz. Dzięki temu nowe urządzenie od razu wie, na której stronie przerwano lekturę — bez wpisywania czegokolwiek.",
		Secret:      true, Default: true,
		Entries: keys("settings/kosync.lua", "settings.custom_server", "settings.username",
			"settings.userkey", "settings.auto_sync", "settings.sync_forward",
			"settings.sync_backward", "settings.checksum_method"),
	},
	{
		ID: "konto_wallabag", Name: "Konto Wallabag",
		Description: "Adres serwera Wallabag, login, hasło i klucze API. Folder pobierania zostaje lokalny, bo na każdym urządzeniu jest inny.",
		Secret:      true, Default: true,
		Entries: keys("settings/wallabag.lua", "wallabag.server_url", "wallabag.client_id",
			"wallabag.client_secret", "wallabag.username", "wallabag.password",
			"wallabag.filter_tag", "wallabag.ignore_tags", "wallabag.auto_tags",
			"wallabag.articles_per_sync", "wallabag.is_delete_finished",
			"wallabag.is_delete_read", "wallabag.is_auto_delete", "wallabag.send_review_as_tags"),
	},
	{
		ID: "konta_chmura", Name: "Konta w chmurze (Dropbox, WebDAV, FTP)",
		Description: "Lista kont z Menu → Chmura: adresy, loginy i tokeny. Z tych kont korzystają m.in. synchronizacja statystyk i słowniczka.",
		Secret:      true, Default: true,
		Entries: keys("settings/cloudstorage.lua", "cs_servers"),
	},
	{
		ID: "konto_statystyki", Name: "Synchronizacja statystyk i słowniczka",
		Description: "Na którym koncie w chmurze i w jakim folderze statystyki czytania i słowniczek (vocabulary builder) trzymają wspólną bazę.",
		Secret:      true, Default: true,
		Entries: keys(readerFile, "statistics.sync_server", "vocabulary_builder.server"),
	},
	{
		ID: "kopad", Name: "KOPad",
		Description: "Ustawienia wtyczki KOPad (plik settings/kopad.lua). Na dziś plik jest pusty (`return {}`) — grupa łapie cokolwiek się tam pojawi w przyszłości.",
		Entries:     []Entry{{File: "settings/kopad.lua", Prefix: pfx("")}},
	},
	{
		ID: "klawiatura", Name: "Klawiatura ekranowa",
		Description: "Układ i styl etykiet klawiatury programowej (np. Colemak, litery/symbole).",
		Warning:     "Ma sens tylko między urządzeniami, na których i tak używasz tej samej klawiatury programowej.",
		Entries:     []Entry{{File: "settings/kokeyboard.lua", Prefix: pfx("")}},
	},
	{
		ID: "asystent", Name: "Asystent AI (assistant)",
		Description: "Preferencje wtyczki Assistant: dostawca i model AI, język pytań/odpowiedzi, czy dołączać słownik/Wikipedię, tryb strumieniowy.",
		Entries: keys("settings/assistant.lua", "auto_copy_asked_question", "dict_language",
			"dict_popup_show_dictionary", "dict_popup_show_wikipedia", "large_stream_dialog",
			"previous_config_ai_provider", "provider", "response_language",
			"stream_mode_auto_scroll", "use_stream_mode"),
	},
	{
		ID: "rosetta_ustawienia", Name: "Rosetta — ustawienia tłumaczenia",
		Description: "Preferencje wtyczki Rosetta (tłumaczenie na żywo): język źródłowy/docelowy, tryb formatowania, czcionka i rozmiar panelu tłumaczenia.",
		Entries: keys("settings/rosetta.lua", "auto_translate", "backend", "clear_cache_on_start",
			"font_override", "font_size", "font_size_percent", "formatting_mode",
			"line_spacing_override", "panel_height_ratio", "paragraph_indent_chars",
			"source_lang", "target_lang", "anchor_min_confidence"),
	},
	{
		ID: "rosetta_klucze", Name: "Rosetta — klucze API",
		Description: "Dostęp do backendu AI używanego przez Rosettę: adres API, model i klucz.",
		Warning:     "Klucz API to sekret — włączaj tylko między urządzeniami, którym ufasz.",
		Secret:      true,
		Entries: keys("settings/rosetta.lua", "ai_api_key", "ai_base_url", "ai_max_tokens",
			"ai_model", "ai_temperature", "api_key"),
	},
}

// NeverSynced — pokazywane w UI jako „zostaje na urządzeniu”, z uzasadnieniem.
// Faktyczne egzekwowanie: DEVICE_KEYS w pluginie + brak tych kluczy w Catalog.
var NeverSynced = []struct {
	Name   string `json:"name"`
	Reason string `json:"reason"`
}{
	{"Rozdzielczość i obrót ekranu", "zależą od fizycznego ekranu urządzenia"},
	{"Podświetlenie i ciepło światła", "każdy czytnik ma inny panel, a nocny tryb ustawiasz pod miejsce, w którym czytasz"},
	{"Ścieżki (folder domowy, ostatni plik, folder pobierania)", "każdy system ma inny układ katalogów — przeniesiona ścieżka wskazywałaby w próżnię"},
	{"Wi-Fi i akcje sieciowe", "dotyczą sprzętu i sieci konkretnego urządzenia"},
	{"Identyfikator urządzenia", "musi być unikalny — dzięki niemu serwer postępu odróżnia Twoje czytniki"},
	{"Postęp czytania, zakreślenia, statystyki", "mają własne, wbudowane mechanizmy (kosync, statystyki) — koligilo tylko je konfiguruje"},
}

func keys(file string, ks ...string) []Entry {
	out := make([]Entry, len(ks))
	for i, k := range ks {
		out[i] = Entry{File: file, Key: k}
	}
	return out
}

func groupByID(id string) *Group {
	for i := range Catalog {
		if Catalog[i].ID == id {
			return &Catalog[i]
		}
	}
	return nil
}

// Matches mówi, czy ID wartości należy do wpisu.
func (e Entry) Matches(id string) bool {
	if e.Prefix != nil {
		f, k, ok := strings.Cut(id, "#")
		if !ok || f != e.File || !strings.HasPrefix(k, *e.Prefix) {
			return false
		}
		for _, x := range e.Except {
			if k == x {
				return false
			}
		}
		return true
	}
	return id == e.File+"|"+e.Key
}

// GroupOf zwraca grupę, do której należy ID (albo nil).
func GroupOf(id string) *Group {
	for i := range Catalog {
		for _, e := range Catalog[i].Entries {
			if e.Matches(id) {
				return &Catalog[i]
			}
		}
	}
	return nil
}
