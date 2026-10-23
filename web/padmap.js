// Mapowanie przycisków gamepada dla wtyczki KOPad (TASK-25, TASK-26, TASK-27;
// decyzje PC-010, PC-011, PC-012, PC-014). Czysta logika edytora z panelu — bez DOM,
// testowana w node (tests/padmap_test.js), w stylu preview.js.
//
// Wspólna wartość: settings/kopad.lua, klucz `padmap`
//   { version = 1,
//     layouts = { <układ> = { <kontrolka> = "<rola>" } },
//     actions = { <rola> = "<akcja>" } }
// to NADPISANIA względem wbudowanych domyślnych: `layouts` — który fizyczny
// przycisk jest którą rolą (osobno dla układu pada), `actions` — co rola robi
// w czytaniu (wspólne dla wszystkich układów, bo dotyczy roli, nie kontrolki).
// Słownik (układy, kontrolki, role, akcje) jest kontraktem z wtyczką kopad (padmap.lua)
// i z serwerem (padmap.go) — zmiana wymaga zmiany we wszystkich trzech
// miejscach; zgodność z serwerem pilnuje TestPadmapVocabularyMatchesPanel.
//
// Zapis wartości idzie przez luaSerialize (web/lua.js), więc literał jest bajt
// w bajt taki jak Sync.serialize na czytniku (klucze tekstowe, posortowane).
"use strict";

const Padmap = (() => {
  const LUA = typeof luaSerialize !== "undefined" ? { luaSerialize, luaParse }
    : (typeof require !== "undefined" ? require("./lua.js") : null);

  const ID = "settings/kopad.lua|padmap";
  const VERSION = 1;

  // Kolejność jak w interfejsie (valve na końcu — dodany w TASK-26).
  const LAYOUT_IDS = ["xbox", "playstation", "nintendo", "valve"];
  // Kontrolki fizyczne: pozycje SDL3 (te same na każdym padzie).
  const CONTROL_IDS = ["south", "east", "west", "north", "back", "start",
    "lshoulder", "rshoulder", "ltrigger", "rtrigger"];
  // Role kopad (etykiety Xbox).
  const ROLE_IDS = ["a", "b", "x", "y", "select", "start", "lb", "rb", "lt", "rt"];

  // Akcje roli w czytaniu (PC-014), pogrupowane jak w interfejsie (grupy to tylko
  // prezentacja — <optgroup> w panelu; słownikiem jest spłaszczona lista ACTION_IDS).
  // Znaczenie każdej opisuje padmap.lua (ACTION_ORDER) po stronie wtyczki.
  const ACTION_GROUPS = [
    { label: "Strony", ids: ["next_page", "prev_page", "pages_forward_10", "pages_back_10", "next_chapter", "prev_chapter", "first_page", "last_page", "back_location", "forward_location", "goto_page", "skim"] },
    { label: "Menu", ids: ["top_menu", "footer_menu", "config_menu"] },
    { label: "Książka", ids: ["toc", "bookmarks", "toggle_bookmark", "next_bookmark", "prev_bookmark", "book_map", "page_browser", "fulltext_search", "book_status", "book_info", "reading_progress"] },
    { label: "Biblioteka", ids: ["history", "file_browser", "last_book", "favorites", "collections"] },
    { label: "Zaznaczanie i słownik", ids: ["sentence_select", "highlights", "word_walk", "crosshair", "dict_lookup"] },
    { label: "Wygląd i ekran", ids: ["font_bigger", "font_smaller", "night_mode", "rotate", "full_refresh", "frontlight_toggle", "frontlight_up", "frontlight_down"] },
    { label: "Inne", ids: ["screenshot", "cheat_sheet", "x_modifier", "none"] },
  ];
  const ACTION_IDS = ACTION_GROUPS.flatMap(g => g.ids);

  // Co rola robi w czytaniu bez nadpisania (padmap.lua DEFAULT_ACTIONS). B: kopad
  // nic tam nie robi, działa Wstecz KOReadera — brak identyfikatora akcji (null).
  const DEFAULT_ACTIONS = {
    a: "sentence_select", b: null, x: "x_modifier", y: "highlights",
    select: "top_menu", start: "footer_menu",
    lb: "prev_page", rb: "next_page", lt: "prev_page", rt: "next_page",
  };

  const ACTION_LABELS = {
    next_page: "Następna strona",
    prev_page: "Poprzednia strona",
    pages_forward_10: "10 stron do przodu",
    pages_back_10: "10 stron do tyłu",
    next_chapter: "Następny rozdział",
    prev_chapter: "Poprzedni rozdział",
    first_page: "Początek książki",
    last_page: "Koniec książki",
    back_location: "Wróć do poprzedniego miejsca",
    forward_location: "Naprzód do następnego miejsca",
    goto_page: "Idź do strony…",
    skim: "Przeglądanie (skok po książce)",
    top_menu: "Menu górne (ustawienia)",
    footer_menu: "Menu dolne (stopka)",
    config_menu: "Panel wyglądu (czcionka, marginesy)",
    toc: "Spis treści",
    bookmarks: "Zakładki",
    toggle_bookmark: "Dodaj / usuń zakładkę na stronie",
    next_bookmark: "Następna zakładka",
    prev_bookmark: "Poprzednia zakładka",
    book_map: "Mapa książki",
    page_browser: "Przeglądarka stron",
    fulltext_search: "Szukaj w tekście",
    book_status: "Status książki",
    book_info: "Informacje o książce",
    reading_progress: "Postęp czytania (statystyki)",
    history: "Historia",
    file_browser: "Przeglądarka plików",
    last_book: "Poprzednia książka",
    favorites: "Ulubione",
    collections: "Kolekcje",
    sentence_select: "Wybór zdania",
    highlights: "Podświetlenia",
    word_walk: "Chodzenie po słowach",
    crosshair: "Celownik",
    dict_lookup: "Szukaj w słowniku…",
    font_bigger: "Większa czcionka",
    font_smaller: "Mniejsza czcionka",
    night_mode: "Tryb nocny",
    rotate: "Obróć ekran",
    full_refresh: "Odśwież ekran",
    frontlight_toggle: "Podświetlenie ekranu: włącz / wyłącz",
    frontlight_up: "Podświetlenie ekranu: jaśniej",
    frontlight_down: "Podświetlenie ekranu: ciemniej",
    screenshot: "Zrzut ekranu",
    cheat_sheet: "Ściągawka przycisków",
    x_modifier: "Modyfikator X (kombinacje)",
    none: "Nic (przycisk nie działa)",
  };
  // Opis domyślnego zachowania roli, której domyślnie nie przypisuje żadna akcja.
  const NO_ACTION_LABEL = "Bez akcji KOPada";

  const IDENTITY = {
    south: "a", east: "b", west: "x", north: "y", back: "select", start: "start",
    lshoulder: "lb", rshoulder: "rb", ltrigger: "lt", rtrigger: "rt",
  };

  // Wbudowane nadpisania względem tożsamości (kopad: padmap.lua, M.LAYOUTS).
  // Nintendo: drukowane A jest na wschodzie, więc rola idzie za nadrukiem.
  // Valve: pozycje jak w Xboksie (tożsamość), różnią się tylko drukowane etykiety.
  const DEFAULTS = {
    xbox: {},
    playstation: {},
    nintendo: { east: "a", south: "b", north: "x", west: "y" },
    valve: {},
  };

  const LAYOUT_LABELS = {
    xbox: "Xbox / ogólny",
    playstation: "PlayStation (DualShock / DualSense)",
    nintendo: "Nintendo (A/B i X/Y zamienione)",
    valve: "Valve (Steam Deck / Steam Controller)",
  };
  const LAYOUT_SHORT = { xbox: "Xbox", playstation: "PlayStation", nintendo: "Nintendo", valve: "Valve" };

  // Etykiety DRUKOWANE na danym padzie — dla pozycji (south = dolny przycisk itd.).
  const PRINTED = {
    xbox: { south: "A", east: "B", west: "X", north: "Y", back: "Wstecz", start: "Start",
      lshoulder: "LB", rshoulder: "RB", ltrigger: "LT", rtrigger: "RT" },
    playstation: { south: "✕", east: "○", west: "□", north: "△", back: "Create/Share", start: "Options",
      lshoulder: "L1", rshoulder: "R1", ltrigger: "L2", rtrigger: "R2" },
    nintendo: { south: "B", east: "A", west: "Y", north: "X", back: "−", start: "+",
      lshoulder: "L", rshoulder: "R", ltrigger: "ZL", rtrigger: "ZR" },
    valve: { south: "A", east: "B", west: "X", north: "Y", back: "Widok", start: "Menu",
      lshoulder: "L1", rshoulder: "R1", ltrigger: "L2", rtrigger: "R2" },
  };
  // Zapis czytany przez czytnik ekranu (symbole nie zawsze są wymawiane).
  const PRINTED_SPOKEN = {
    playstation: { south: "krzyżyk", east: "kółko", west: "kwadrat", north: "trójkąt" },
    nintendo: { back: "minus", start: "plus" },
  };

  const POSITIONS = {
    south: "dolny przycisk", east: "prawy przycisk", west: "lewy przycisk", north: "górny przycisk",
    back: "środkowy lewy", start: "środkowy prawy",
    lshoulder: "lewy bumper", rshoulder: "prawy bumper", ltrigger: "lewy spust", rtrigger: "prawy spust",
  };

  // Role: nazwy Xbox jak w dokumentacji kopad.
  const ROLE_NAMES = {
    a: "A", b: "B", x: "X", y: "Y", lb: "LB", rb: "RB",
    select: "Select", start: "Start", lt: "LT", rt: "RT",
  };
  // Krótki opis akcji do etykiety roli („RB (następna strona)”).
  const ACTION_SHORT = {
    next_page: "następna strona",
    prev_page: "poprzednia strona",
    pages_forward_10: "10 stron dalej",
    pages_back_10: "10 stron wstecz",
    next_chapter: "następny rozdział",
    prev_chapter: "poprzedni rozdział",
    first_page: "początek książki",
    last_page: "koniec książki",
    back_location: "poprzednie miejsce",
    forward_location: "następne miejsce",
    goto_page: "idź do strony",
    skim: "przeglądanie",
    top_menu: "menu górne",
    footer_menu: "menu dolne",
    config_menu: "panel wyglądu",
    toc: "spis treści",
    bookmarks: "zakładki",
    toggle_bookmark: "zakładka na stronie",
    next_bookmark: "następna zakładka",
    prev_bookmark: "poprzednia zakładka",
    book_map: "mapa książki",
    page_browser: "przeglądarka stron",
    fulltext_search: "szukanie w tekście",
    book_status: "status książki",
    book_info: "informacje o książce",
    reading_progress: "postęp czytania",
    history: "historia",
    file_browser: "pliki",
    last_book: "poprzednia książka",
    favorites: "ulubione",
    collections: "kolekcje",
    sentence_select: "wybór zdania",
    highlights: "podświetlenia",
    word_walk: "chodzenie po słowach",
    crosshair: "celownik",
    dict_lookup: "słownik",
    font_bigger: "większa czcionka",
    font_smaller: "mniejsza czcionka",
    night_mode: "tryb nocny",
    rotate: "obrót ekranu",
    full_refresh: "odświeżenie ekranu",
    frontlight_toggle: "podświetlenie ekranu",
    frontlight_up: "jaśniejszy ekran",
    frontlight_down: "ciemniejszy ekran",
    screenshot: "zrzut ekranu",
    cheat_sheet: "ściągawka",
    x_modifier: "modyfikator",
    none: "nic",
  };

  const isLayout = id => LAYOUT_IDS.includes(id);

  const actionLabel = a => a == null ? NO_ACTION_LABEL : (ACTION_LABELS[a] || String(a));

  const printed = (layout, ctl) => PRINTED[layout][ctl];
  const printedSpoken = (layout, ctl) => (PRINTED_SPOKEN[layout] || {})[ctl] || PRINTED[layout][ctl];
  // Nazwa roli z krótkim opisem tego, co robi w czytaniu: domyślnie albo według
  // `actions` (efektywne akcje z effectiveActions) — opis nie kłamie po przestawieniu.
  const roleName = role => ROLE_NAMES[role] || String(role);
  function roleLabel(role, actions) {
    const name = roleName(role);
    const a = actions ? actions[role] : DEFAULT_ACTIONS[role];
    return a == null ? name : `${name} (${ACTION_SHORT[a] || a})`;
  }
  // Etykiety domyślne (bez nadpisań akcji).
  const ROLE_LABELS = Object.fromEntries(ROLE_IDS.map(r => [r, roleLabel(r)]));

  // Domyślne mapowanie układu: tożsamość + wbudowane nadpisania.
  function defaultMap(layout) {
    if (!isLayout(layout)) throw new Error("nieznany układ " + layout);
    return { ...IDENTITY, ...DEFAULTS[layout] };
  }

  // Mapowanie efektywne układu: domyślne + nadpisania z `layouts` (kontrolki
  // niewymienione zachowują domyślne — tak samo jak w kopad).
  function effective(layouts, layout) {
    return { ...defaultMap(layout), ...((layouts && layouts[layout]) || {}) };
  }

  // --- akcje (rola → akcja w czytaniu) ---

  // Akcje efektywne: domyślne + nadpisania; wartość null = „bez akcji KOPada” (B).
  function effectiveActions(actions) {
    const out = {};
    for (const r of ROLE_IDS) {
      const v = actions && actions[r];
      out[r] = v !== undefined && ACTION_IDS.includes(v) ? v : DEFAULT_ACTIONS[r];
    }
    return out;
  }

  // Minimalne nadpisania: tylko role, których akcja różni się od domyślnej.
  function actionOverrides(map) {
    const out = {};
    for (const r of ROLE_IDS) if (map[r] != null && map[r] !== DEFAULT_ACTIONS[r]) out[r] = map[r];
    return out;
  }

  // Role zmienione względem domyślnych (w kolejności ROLE_IDS).
  const changedActions = map => ROLE_IDS.filter(r => (map[r] ?? null) !== DEFAULT_ACTIONS[r]);

  // `map` różni się od zapisanych nadpisań `actions`?
  function actionsDiffer(actions, map) {
    const a = effectiveActions(actions);
    return ROLE_IDS.some(r => (a[r] ?? null) !== (map[r] ?? null));
  }

  const hasActions = actions => !!actions && ROLE_IDS.some(r => actions[r] != null);

  // Fizyczne kontrolki, które w układzie `layout` (mapowanie `map`) pełnią daną rolę —
  // żeby przy roli „RB” pokazać, jaki przycisk jest nią na tym padzie.
  const controlsFor = (map, role) => CONTROL_IDS.filter(c => map[c] === role);

  // Minimalne nadpisania: tylko kontrolki różniące się od domyślnych układu.
  function overrides(layout, map) {
    const def = defaultMap(layout), out = {};
    for (const c of CONTROL_IDS) if (map[c] !== undefined && map[c] !== def[c]) out[c] = map[c];
    return out;
  }

  // Kontrolki zmienione względem domyślnych układu (w kolejności CONTROL_IDS).
  function changed(layout, map) {
    const def = defaultMap(layout);
    return CONTROL_IDS.filter(c => map[c] !== def[c]);
  }

  // `map` zmieniło układ względem zapisanych nadpisań `layouts`?
  function differs(layouts, layout, map) {
    const a = effective(layouts, layout);
    return CONTROL_IDS.some(c => a[c] !== map[c]);
  }

  // Nowe `layouts`: układ `layout` zastąpiony nadpisaniami z `map`, reszta układów
  // (też tych, których użytkownik nie otworzył) nietknięta. Pusty układ znika.
  function withLayout(layouts, layout, map) {
    const next = {};
    for (const id of LAYOUT_IDS) if (id !== layout && layouts && layouts[id] && Object.keys(layouts[id]).length) next[id] = { ...layouts[id] };
    const ov = overrides(layout, map);
    if (Object.keys(ov).length) next[layout] = ov;
    return next;
  }

  const hasOverrides = layouts => !!layouts && LAYOUT_IDS.some(id => layouts[id] && Object.keys(layouts[id]).length);

  // Wartość do zapisu (obiekt JS dla luaSerialize) albo null, gdy ani żaden układ,
  // ani akcje nie mają nadpisań — wtedy wartość się USUWA, a nie zostawia szkielet.
  // `actions` jest opcjonalne; tylko niepuste wchodzi do wartości.
  function toValue(layouts, actions) {
    const hasL = hasOverrides(layouts), hasA = hasActions(actions);
    if (!hasL && !hasA) return null;
    const out = { version: VERSION };
    if (hasL) {
      out.layouts = {};
      for (const id of LAYOUT_IDS) if (layouts[id] && Object.keys(layouts[id]).length) out.layouts[id] = { ...layouts[id] };
    }
    if (hasA) {
      out.actions = {};
      for (const r of ROLE_IDS) if (actions[r] != null) out.actions[r] = actions[r];
    }
    return out;
  }

  function toLiteral(layouts, actions) {
    const v = toValue(layouts, actions);
    return v === null ? null : LUA.luaSerialize(v);
  }

  // --- czytanie ---

  const tbl = v => v instanceof Map ? v : null;
  const q = x => typeof x === "string" ? JSON.stringify(x) : String(x instanceof Map ? "(tabela)" : x);

  // Wartość z luaParse (Map) → {state:"ok", layouts, actions} albo {state:"bad", reason}.
  // Ścisłość jak w serwerze (padmap.go) — to, co serwer odrzuciłby przy zapisie,
  // jest tu „bad”, więc panel nie nadpisze po cichu niezrozumiałych danych.
  function fromValue(v) {
    const top = tbl(v);
    if (!top) return { state: "bad", reason: "wartość nie jest tabelą" };
    for (const k of top.keys()) {
      if (k !== "version" && k !== "layouts" && k !== "actions") return { state: "bad", reason: `nieznany klucz ${q(k)} w padmap` };
    }
    if (top.get("version") !== VERSION) {
      return { state: "bad", reason: `wersja ${top.has("version") ? q(top.get("version")) : "(brak)"} zamiast ${VERSION} — KOPad zignoruje całość` };
    }
    const layouts = {};
    if (top.has("layouts")) {
      const L = tbl(top.get("layouts"));
      if (!L) return { state: "bad", reason: "layouts nie jest tabelą" };
      for (const [name, ov] of L) {
        if (typeof name !== "string" || !isLayout(name)) return { state: "bad", reason: `nieznany układ ${q(name)}` };
        const O = tbl(ov);
        if (!O) return { state: "bad", reason: `układ ${q(name)} nie jest tabelą` };
        const map = {};
        for (const [ctl, role] of O) {
          if (typeof ctl !== "string" || !CONTROL_IDS.includes(ctl)) return { state: "bad", reason: `nieznana kontrolka ${q(ctl)} w układzie ${q(name)}` };
          if (typeof role !== "string" || !ROLE_IDS.includes(role)) return { state: "bad", reason: `nieznana rola ${q(role)} dla ${q(ctl)} w układzie ${q(name)}` };
          map[ctl] = role;
        }
        if (Object.keys(map).length) layouts[name] = map;
      }
    }
    const actions = {};
    if (top.has("actions")) {
      const A = tbl(top.get("actions"));
      if (!A) return { state: "bad", reason: "actions nie jest tabelą" };
      for (const [role, act] of A) {
        if (typeof role !== "string" || !ROLE_IDS.includes(role)) return { state: "bad", reason: `nieznana rola ${q(role)} w actions` };
        if (typeof act !== "string" || !ACTION_IDS.includes(act)) return { state: "bad", reason: `nieznana akcja ${q(act)} dla roli ${q(role)}` };
        actions[role] = act;
      }
    }
    return { state: "ok", layouts, actions };
  }

  // Literał → to samo co fromValue; brak literału = brak wartości.
  function parse(lit) {
    if (lit === undefined || lit === null) return { state: "absent", layouts: {}, actions: {} };
    let v;
    try { v = LUA.luaParse(lit); } catch (e) { return { state: "bad", reason: "to nie jest poprawny literał Lua: " + e.message }; }
    return fromValue(v);
  }

  // Opis mapowania dla czytnika ekranu (aria-label sylwetki).
  function describe(layout, map, actions) {
    const parts = CONTROL_IDS.map(c => `${printedSpoken(layout, c)} (${POSITIONS[c]}) działa jak ${roleLabel(map[c], actions)}`);
    return `Sylwetka pada, układ ${LAYOUT_SHORT[layout]}. ${parts.join("; ")}.`;
  }

  return {
    ID, VERSION, LAYOUT_IDS, CONTROL_IDS, ROLE_IDS, ACTION_IDS, ACTION_GROUPS, IDENTITY, DEFAULTS, DEFAULT_ACTIONS,
    LAYOUT_LABELS, LAYOUT_SHORT, ACTION_LABELS, PRINTED, POSITIONS, ROLE_LABELS,
    printed, printedSpoken, roleName, roleLabel, actionLabel, defaultMap, effective, overrides, changed, differs,
    effectiveActions, actionOverrides, changedActions, actionsDiffer, hasActions, controlsFor,
    withLayout, hasOverrides, toValue, toLiteral, fromValue, parse, describe,
  };
})();

if (typeof module !== "undefined") module.exports = Padmap;
