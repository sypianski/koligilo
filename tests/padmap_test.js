// TASK-25 (+ TASK-26: układ valve): logika edytora mapowania przycisków gamepada (web/padmap.js) —
// tożsamość i domyślne układów, różnice, zachowanie innych układów, round-trip
// literału bajt w bajt przez luaSerialize/luaParse (i Sync.serialize), dane obce.
// node tests/padmap_test.js (z katalogu repo; część round-trip wymaga `lua` w PATH).
"use strict";
const { spawnSync } = require("child_process");
const P = require("../web/padmap.js");
const { luaParse, luaSerialize } = require("../web/lua.js");

let fail = 0;
// porównanie niezależne od kolejności kluczy obiektów
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x);
const eq = (name, got, want) => {
  if (canon(got) !== canon(want)) { fail++; console.log(`FAIL ${name}:\n  got  ${canon(got)}\n  want ${canon(want)}`); }
};
const ok = (name, cond) => { if (!cond) { fail++; console.log("FAIL " + name); } };

// literał z PC-011 (styl Sync.serialize) — dokładnie to zapisuje panel
const EXAMPLE = '{["layouts"]={["nintendo"]={["east"]="b",["south"]="a"},["xbox"]={["ltrigger"]="rt",["rtrigger"]="lt"}},["version"]=1}';
const EXAMPLE_LAYOUTS = { nintendo: { south: "a", east: "b" }, xbox: { ltrigger: "rt", rtrigger: "lt" } };
// z układem valve (TASK-26): klucze posortowane, valve między nintendo a xbox
const VALVE_EXAMPLE = '{["layouts"]={["nintendo"]={["east"]="b",["south"]="a"},["valve"]={["back"]="start",["start"]="select"},["xbox"]={["ltrigger"]="rt",["rtrigger"]="lt"}},["version"]=1}';
const VALVE_LAYOUTS = { ...EXAMPLE_LAYOUTS, valve: { back: "start", start: "select" } };

// --- słownik ---
eq("10 kontrolek", P.CONTROL_IDS.length, 10);
eq("10 ról", P.ROLE_IDS.length, 10);
eq("układy w kolejności UI (valve na końcu)", P.LAYOUT_IDS, ["xbox", "playstation", "nintendo", "valve"]);
eq("etykiety zakładek układów", P.LAYOUT_IDS.map(l => P.LAYOUT_SHORT[l]), ["Xbox", "PlayStation", "Nintendo", "Valve"]);
eq("Xbox: opis bez Steam Decka (Deck ma własny układ)", P.LAYOUT_LABELS.xbox, "Xbox / ogólny");
eq("Valve: pełna nazwa w opisie", P.LAYOUT_LABELS.valve, "Valve (Steam Deck / Steam Controller)");
eq("Valve: wbudowane nadpisania puste (tożsamość)", P.DEFAULTS.valve, {});
ok("ID wartości = plik|klucz (wpis Key)", P.ID === "settings/kopad.lua|padmap");
eq("tożsamość: wszystkie kontrolki", Object.keys(P.IDENTITY).sort(), [...P.CONTROL_IDS].sort());
eq("tożsamość: role", P.IDENTITY, { south: "a", east: "b", west: "x", north: "y", back: "select", start: "start",
  lshoulder: "lb", rshoulder: "rb", ltrigger: "lt", rtrigger: "rt" });
for (const l of P.LAYOUT_IDS) {
  ok(`${l}: etykiety drukowane dla 10 kontrolek`, P.CONTROL_IDS.every(c => typeof P.PRINTED[l][c] === "string" && P.PRINTED[l][c]));
  ok(`${l}: opis układu`, !!P.LAYOUT_LABELS[l] && !!P.LAYOUT_SHORT[l]);
  ok(`${l}: domyślne tylko ze słownika`, Object.entries(P.DEFAULTS[l]).every(([c, r]) => P.CONTROL_IDS.includes(c) && P.ROLE_IDS.includes(r)));
}
ok("każda rola ma etykietę", P.ROLE_IDS.every(r => P.ROLE_LABELS[r]));
ok("każda kontrolka ma opis położenia", P.CONTROL_IDS.every(c => P.POSITIONS[c]));
// nadruk: pozycje A/B/X/Y wg układu
eq("Xbox: nadruki pozycji", ["south", "east", "west", "north"].map(c => P.printed("xbox", c)), ["A", "B", "X", "Y"]);
eq("Nintendo: A jest na wschodzie", ["south", "east", "west", "north"].map(c => P.printed("nintendo", c)), ["B", "A", "Y", "X"]);
eq("PlayStation: symbole", ["south", "east", "west", "north"].map(c => P.printed("playstation", c)), ["✕", "○", "□", "△"]);
eq("Valve: nadruki pozycji A/B/X/Y", ["south", "east", "west", "north"].map(c => P.printed("valve", c)), ["A", "B", "X", "Y"]);
eq("Valve: Widok i Menu", [P.printed("valve", "back"), P.printed("valve", "start")], ["Widok", "Menu"]);
eq("Valve: L1 R1 L2 R2", ["lshoulder", "rshoulder", "ltrigger", "rtrigger"].map(c => P.printed("valve", c)), ["L1", "R1", "L2", "R2"]);
eq("Valve: wszystkie etykiety kontrolek", P.CONTROL_IDS.map(c => P.printed("valve", c)),
  ["A", "B", "X", "Y", "Widok", "Menu", "L1", "R1", "L2", "R2"]);
eq("PlayStation: Create/Share i Options", [P.printed("playstation", "back"), P.printed("playstation", "start")], ["Create/Share", "Options"]);
eq("Nintendo: L R ZL ZR − +", ["lshoulder", "rshoulder", "ltrigger", "rtrigger", "back", "start"].map(c => P.printed("nintendo", c)), ["L", "R", "ZL", "ZR", "−", "+"]);

// --- mapowanie domyślne i efektywne ---
eq("Xbox = tożsamość", P.defaultMap("xbox"), P.IDENTITY);
eq("PlayStation = tożsamość (pozycje jak Xbox)", P.defaultMap("playstation"), P.IDENTITY);
eq("Valve = tożsamość (pozycje jak Xbox, różnią się tylko etykiety)", P.defaultMap("valve"), P.IDENTITY);
eq("Nintendo: east=a south=b north=x west=y", P.defaultMap("nintendo"),
  { ...P.IDENTITY, east: "a", south: "b", north: "x", west: "y" });
let threw = false; try { P.defaultMap("snes"); } catch { threw = true; }
ok("nieznany układ rzuca", threw);
const d = P.defaultMap("nintendo"); d.south = "zmienione";
eq("defaultMap zwraca kopię", P.defaultMap("nintendo").south, "b");

eq("efektywne bez danych == domyślne", P.effective({}, "nintendo"), P.defaultMap("nintendo"));
eq("efektywne z undefined", P.effective(undefined, "xbox"), P.IDENTITY);
eq("efektywne: nadpisanie + niewymienione zostają", P.effective(EXAMPLE_LAYOUTS, "xbox").ltrigger, "rt");
eq("efektywne: reszta xbox domyślna", P.effective(EXAMPLE_LAYOUTS, "xbox").south, "a");
eq("efektywne: Nintendo south=a z nadpisania (nie domyślne b)", P.effective(EXAMPLE_LAYOUTS, "nintendo").south, "a");
eq("efektywne: Nintendo east=b z nadpisania", P.effective(EXAMPLE_LAYOUTS, "nintendo").east, "b");
eq("efektywne: Nintendo north zostaje domyślne x", P.effective(EXAMPLE_LAYOUTS, "nintendo").north, "x");
eq("efektywne: PlayStation nietknięty przez Xbox", P.effective(EXAMPLE_LAYOUTS, "playstation"), P.IDENTITY);
eq("efektywne: Valve nietknięty przez inne układy", P.effective(EXAMPLE_LAYOUTS, "valve"), P.IDENTITY);
eq("efektywne: Valve z nadpisaniem Widok→start, Menu→select", P.effective(VALVE_LAYOUTS, "valve"),
  { ...P.IDENTITY, back: "start", start: "select" });

// --- różnice względem domyślnych ---
for (const l of P.LAYOUT_IDS) {
  eq(`${l}: mapa domyślna → brak nadpisań`, P.overrides(l, P.defaultMap(l)), {});
  eq(`${l}: brak zmienionych`, P.changed(l, P.defaultMap(l)), []);
}
{
  const m = { ...P.defaultMap("xbox"), ltrigger: "rt", rtrigger: "lt" };
  eq("Xbox: spusty zamienione → 2 nadpisania", P.overrides("xbox", m), { ltrigger: "rt", rtrigger: "lt" });
  eq("Xbox: changed w kolejności kontrolek", P.changed("xbox", m), ["ltrigger", "rtrigger"]);
}
{
  const m = { ...P.defaultMap("nintendo"), south: "a", east: "b" };
  eq("Nintendo: przywrócenie pozycji A/B → 2 nadpisania względem NINTENDO-domyślnych", P.overrides("nintendo", m), { south: "a", east: "b" });
  const same = { ...P.defaultMap("nintendo"), east: "a" }; // tyle co domyślne
  eq("Nintendo: ustawienie wartości domyślnej nie tworzy wpisu", P.overrides("nintendo", same), {});
  // ta sama mapa, która na Xboksie byłaby tożsamością, na Nintendo to 4 różnice
  eq("tożsamość na Nintendo = 4 nadpisania", Object.keys(P.overrides("nintendo", P.IDENTITY)).sort(), ["east", "north", "south", "west"]);
  eq("domyślne Nintendo na Xboksie = 4 nadpisania", Object.keys(P.overrides("xbox", P.defaultMap("nintendo"))).sort(), ["east", "north", "south", "west"]);
}
{
  // Valve: domyślne = tożsamość, więc tożsamość to 0 nadpisań (inaczej niż na Nintendo)
  eq("Valve: tożsamość → brak nadpisań", P.overrides("valve", P.IDENTITY), {});
  eq("Valve: Widok/Menu zamienione → 2 nadpisania", P.overrides("valve", { ...P.IDENTITY, back: "start", start: "select" }), { back: "start", start: "select" });
  eq("Valve: changed w kolejności kontrolek", P.changed("valve", { ...P.IDENTITY, rtrigger: "lt", ltrigger: "rt" }), ["ltrigger", "rtrigger"]);
  eq("domyślne Nintendo na Valve = 4 nadpisania", Object.keys(P.overrides("valve", P.defaultMap("nintendo"))).sort(), ["east", "north", "south", "west"]);
}
eq("przycisk z rolą spustu, spust z rolą przycisku", P.overrides("playstation", { ...P.IDENTITY, north: "lt", rtrigger: "b" }), { north: "lt", rtrigger: "b" });
eq("wiele kontrolek może dzielić rolę", P.overrides("xbox", { ...P.IDENTITY, east: "a" }), { east: "a" });
eq("kontrolka bez wartości w mapie jest pomijana", P.overrides("xbox", { south: "b" }), { south: "b" });
ok("differs: ta sama mapa", !P.differs(EXAMPLE_LAYOUTS, "xbox", P.effective(EXAMPLE_LAYOUTS, "xbox")));
ok("differs: zmiana jednej roli", P.differs(EXAMPLE_LAYOUTS, "xbox", { ...P.effective(EXAMPLE_LAYOUTS, "xbox"), south: "b" }));

// --- składanie: zachowanie innych układów ---
{
  const before = JSON.stringify(EXAMPLE_LAYOUTS);
  const next = P.withLayout(EXAMPLE_LAYOUTS, "playstation", { ...P.IDENTITY, north: "lt" });
  eq("edycja PlayStation zachowuje Xbox i Nintendo", next, { ...EXAMPLE_LAYOUTS, playstation: { north: "lt" } });
  eq("wejście niezmutowane", JSON.stringify(EXAMPLE_LAYOUTS), before);
  eq("edycja Xbox zastępuje tylko Xbox", P.withLayout(EXAMPLE_LAYOUTS, "xbox", { ...P.IDENTITY, back: "start" }),
    { nintendo: EXAMPLE_LAYOUTS.nintendo, xbox: { back: "start" } });
  eq("przywrócenie domyślnych usuwa tylko ten układ", P.withLayout(EXAMPLE_LAYOUTS, "xbox", P.defaultMap("xbox")), { nintendo: EXAMPLE_LAYOUTS.nintendo });
  eq("brak innych → pusty", P.withLayout({ xbox: { south: "b" } }, "xbox", P.defaultMap("xbox")), {});
  eq("z pustego", P.withLayout({}, "nintendo", { ...P.defaultMap("nintendo"), west: "x" }), { nintendo: { west: "x" } });
  // valve (TASK-26): edycja jednego układu nie rusza pozostałych, w tym valve
  eq("edycja Xbox zachowuje valve", P.withLayout(VALVE_LAYOUTS, "xbox", { ...P.IDENTITY, back: "start" }),
    { nintendo: VALVE_LAYOUTS.nintendo, valve: VALVE_LAYOUTS.valve, xbox: { back: "start" } });
  eq("edycja valve zachowuje pozostałe", P.withLayout(VALVE_LAYOUTS, "valve", { ...P.IDENTITY, north: "x" }),
    { nintendo: EXAMPLE_LAYOUTS.nintendo, xbox: EXAMPLE_LAYOUTS.xbox, valve: { north: "x" } });
  eq("przywrócenie domyślnych valve usuwa tylko valve", P.withLayout(VALVE_LAYOUTS, "valve", P.defaultMap("valve")), EXAMPLE_LAYOUTS);
  eq("z pustego: valve", P.withLayout({}, "valve", { ...P.IDENTITY, rtrigger: "b" }), { valve: { rtrigger: "b" } });
}

// --- literał: round-trip bajt w bajt ---
eq("toLiteral(przykład) == literał z PC-011", P.toLiteral(EXAMPLE_LAYOUTS), EXAMPLE);
eq("luaSerialize wartości == literał", luaSerialize(P.toValue(EXAMPLE_LAYOUTS)), EXAMPLE);
eq("toLiteral z valve (klucze posortowane)", P.toLiteral(VALVE_LAYOUTS), VALVE_EXAMPLE);
eq("round-trip valve: luaSerialize(luaParse(lit))", luaSerialize(luaParse(VALVE_EXAMPLE)), VALVE_EXAMPLE);
eq("round-trip valve: parse → toLiteral", P.toLiteral(P.parse(VALVE_EXAMPLE).layouts), VALVE_EXAMPLE);
eq("parse(valve) → układy", P.parse(VALVE_EXAMPLE).layouts, VALVE_LAYOUTS);
eq("version to liczba, klucze tekstowe", P.toValue(EXAMPLE_LAYOUTS).version, 1);
{
  const r = P.parse(EXAMPLE);
  eq("parse(przykład) → ok", r.state, "ok");
  eq("parse(przykład) → układy", r.layouts, EXAMPLE_LAYOUTS);
  eq("round-trip parse → toLiteral", P.toLiteral(r.layouts), EXAMPLE);
  eq("round-trip luaSerialize(luaParse(lit))", luaSerialize(luaParse(EXAMPLE)), EXAMPLE);
}
{
  // białe znaki między tokenami parser przyjmuje (jak Sync.deserialize); zapis wraca kanoniczny
  const spaced = '{ ["version"]=1, ["layouts"]={ ["nintendo"]={ ["south"]="a", ["east"]="b" },\n  ["xbox"]={ ["ltrigger"]="rt", ["rtrigger"]="lt" } } }';
  const r = P.parse(spaced);
  eq("parse(z odstępami) → ok", r.state, "ok");
  eq("z odstępami → kanoniczny literał", P.toLiteral(r.layouts), EXAMPLE);
  // `] =` ze spacją to nie format serialize (Sync.deserialize też go nie przyjmie) — „bad”, nie zgadywanie
  eq("parse(\"] =\" ze spacją) → bad", P.parse('{["version"] = 1}').state, "bad");
}
// ten sam literał przez prawdziwe Sync.serialize/deserialize (czytnik)
{
  const lua = spawnSync("lua", ["tests/luaser_ref.lua", "fix"], { input: EXAMPLE + "\n", encoding: "utf8" });
  if (lua.status !== 0) { fail++; console.log("FAIL lua: " + lua.stderr); }
  else eq("Sync.serialize(Sync.deserialize(literał)) == literał", lua.stdout.split("\n")[0], EXAMPLE);
  const lv = spawnSync("lua", ["tests/luaser_ref.lua", "fix"], { input: VALVE_EXAMPLE + "\n", encoding: "utf8" });
  if (lv.status !== 0) { fail++; console.log("FAIL lua (valve): " + lv.stderr); }
  else eq("Sync.serialize(Sync.deserialize(literał z valve)) == literał", lv.stdout.split("\n")[0], VALVE_EXAMPLE);
}
// wszystkie możliwe pojedyncze nadpisania: panel → literał → parse → te same układy
{
  let n = 0;
  for (const l of P.LAYOUT_IDS) for (const c of P.CONTROL_IDS) for (const r of P.ROLE_IDS) {
    const layouts = P.withLayout({}, l, { ...P.defaultMap(l), [c]: r });
    const lit = P.toLiteral(layouts);
    if (lit === null) { eq(`${l}.${c}=${r} to wartość domyślna`, r, P.defaultMap(l)[c]); continue; }
    n++;
    const back = P.parse(lit);
    if (back.state !== "ok" || JSON.stringify(back.layouts) !== JSON.stringify(layouts) || P.toLiteral(back.layouts) !== lit) {
      fail++; console.log(`FAIL round-trip ${l}.${c}=${r}: ${lit}`);
    }
  }
  eq("round-trip 4×10×10 pojedynczych nadpisań: 360 niedomyślnych", n, 4 * 10 * 10 - 4 * 10);
}

// --- brak nadpisań → usunięcie wartości (null), nie szkielet ---
eq("pusty obiekt → null", P.toLiteral({}), null);
eq("undefined → null", P.toLiteral(undefined), null);
eq("puste układy → null", P.toLiteral({ xbox: {}, nintendo: {} }), null);
eq("po przywróceniu jedynego nadpisania → null", P.toLiteral(P.withLayout({ xbox: { south: "b" } }, "xbox", P.IDENTITY)), null);
ok("hasOverrides", P.hasOverrides(EXAMPLE_LAYOUTS) && !P.hasOverrides({}) && !P.hasOverrides({ xbox: {} }));

// --- brak danych i dane błędne/obce ---
eq("parse(null) → brak", P.parse(null), { state: "absent", layouts: {}, actions: {} });
eq("parse(undefined) → brak", P.parse(undefined).state, "absent");
eq("sama wersja → ok, pusto", P.parse('{["version"]=1}'), { state: "ok", layouts: {}, actions: {} });
eq("pusty layouts → ok", P.parse('{["layouts"]={},["version"]=1}'), { state: "ok", layouts: {}, actions: {} });
eq("pusty układ znika", P.parse('{["layouts"]={["xbox"]={}},["version"]=1}'), { state: "ok", layouts: {}, actions: {} });
for (const [name, lit, why] of [
  ["brak wersji", '{["layouts"]={}}', /wersj/],
  ["inna wersja", '{["version"]=2}', /wersj/],
  ["wersja jako napis", '{["version"]="1"}', /wersj/],
  ["layouts nie tabela", '{["layouts"]="x",["version"]=1}', /layouts/],
  ["nieznany klucz górny", '{["extra"]=1,["version"]=1}', /extra/],
  ["nieznany układ", '{["layouts"]={["snes"]={}},["version"]=1}', /snes/],
  ["stary id układu Decka", '{["layouts"]={["steamdeck"]={}},["version"]=1}', /steamdeck/],
  ["układ wielką literą", '{["layouts"]={["Valve"]={}},["version"]=1}', /Valve/],
  ["tylny przycisk w valve", '{["layouts"]={["valve"]={["l4"]="a"}},["version"]=1}', /l4/],
  ["nieznana rola w valve", '{["layouts"]={["valve"]={["south"]="l4"}},["version"]=1}', /l4/],
  ["układ nie tabela", '{["layouts"]={["xbox"]="a"},["version"]=1}', /xbox/],
  ["klucz liczbowy kontrolki", '{["layouts"]={["xbox"]={[1]="a"}},["version"]=1}', /1/],
  ["klucz liczbowy układu", '{["layouts"]={[1]={}},["version"]=1}', /1/],
  ["krzyżak", '{["layouts"]={["xbox"]={["dpad_up"]="a"}},["version"]=1}', /dpad_up/],
  ["nieznana rola", '{["layouts"]={["xbox"]={["south"]="none"}},["version"]=1}', /none/],
  ["rola nie napis", '{["layouts"]={["xbox"]={["south"]=1}},["version"]=1}', /south/],
  ["wartość nie tabela", '"abc"', /tabel/],
  ["liczba", "42", /tabel/],
  ["lista", '{[1]="a"}', /nieznany klucz/],
  ["kod zamiast literału", "os.exit(1)", /Lua/],
  ["niedomknięty", '{["version"]=1', /Lua/],
]) {
  const r = P.parse(lit);
  ok(`bad: ${name}`, r.state === "bad" && why.test(r.reason));
}
// obce dane nie są po cichu „naprawiane”: fromValue nigdy nie zwraca częściowego wyniku
ok("bad nie niesie układów", P.parse('{["layouts"]={["xbox"]={["south"]="b"},["snes"]={}},["version"]=1}').layouts === undefined);

// --- opis dla czytnika ekranu ---
{
  const t = P.describe("nintendo", P.effective({}, "nintendo"));
  ok("describe: układ i 10 kontrolek", t.includes("Nintendo") && (t.match(/działa jak/g) || []).length === 10);
  const v = P.describe("valve", P.effective({}, "valve"));
  ok("describe: Valve — układ, 10 kontrolek, Widok i Menu", v.includes("układ Valve") && (v.match(/działa jak/g) || []).length === 10
    && v.includes("Widok (środkowy lewy) działa jak Select") && v.includes("Menu (środkowy prawy) działa jak Start"));
  ok("describe: symbole PlayStation czytane słownie", P.describe("playstation", P.IDENTITY).includes("krzyżyk"));
  ok("describe: rola z opisem", P.describe("xbox", P.IDENTITY).includes("LT (poprzednia strona)"));
}

// --- akcje roli w czytaniu (TASK-27, PC-014) ---
const ACTIONS_EXAMPLE = '{["actions"]={["rb"]="top_menu",["select"]="next_page"},["version"]=1}';
const BOTH_EXAMPLE = '{["actions"]={["rb"]="top_menu"},["layouts"]={["nintendo"]={["east"]="b",["south"]="a"}},["version"]=1}';
{
  eq("48 akcji w kolejności UI", P.ACTION_IDS, [
    "next_page", "prev_page", "pages_forward_10", "pages_back_10", "next_chapter", "prev_chapter",
    "first_page", "last_page", "back_location", "forward_location", "goto_page", "skim", "top_menu",
    "footer_menu", "config_menu", "toc", "bookmarks", "toggle_bookmark", "next_bookmark", "prev_bookmark",
    "book_map", "page_browser", "fulltext_search", "book_status", "book_info", "reading_progress", "history",
    "file_browser", "last_book", "favorites", "collections", "sentence_select", "highlights", "word_walk",
    "crosshair", "dict_lookup", "font_bigger", "font_smaller", "night_mode", "rotate", "full_refresh",
    "frontlight_toggle", "frontlight_up", "frontlight_down", "screenshot", "cheat_sheet", "x_modifier",
    "none",
  ]);
  ok("bez powtórzeń", new Set(P.ACTION_IDS).size === P.ACTION_IDS.length);
  ok("grupy: każda ma nazwę i akcje, razem dają cały słownik",
    P.ACTION_GROUPS.every(g => g.label && g.ids.length > 0) && P.ACTION_GROUPS.flatMap(g => g.ids).join() === P.ACTION_IDS.join());
  eq("etykiety i krótkie opisy tylko dla akcji ze słownika",
    [Object.keys(P.ACTION_LABELS).filter(a => !P.ACTION_IDS.includes(a)), P.ACTION_IDS.filter(a => P.roleLabel("a", { a }) === `A (${a})`)], [[], []]);
  ok("każda akcja ma etykietę i krótki opis", P.ACTION_IDS.every(a => P.ACTION_LABELS[a] && P.roleLabel("a", { a }).includes("(")));
  eq("domyślne akcje: wszystkie role, B bez akcji", Object.keys(P.DEFAULT_ACTIONS).sort(), [...P.ROLE_IDS].sort());
  ok("domyślne akcje tylko ze słownika", P.ROLE_IDS.every(r => P.DEFAULT_ACTIONS[r] === null || P.ACTION_IDS.includes(P.DEFAULT_ACTIONS[r])));
  eq("B nie ma akcji domyślnej", P.DEFAULT_ACTIONS.b, null);
  eq("domyślnie: strony i menu jak w README kopada",
    [P.DEFAULT_ACTIONS.rb, P.DEFAULT_ACTIONS.lb, P.DEFAULT_ACTIONS.rt, P.DEFAULT_ACTIONS.lt, P.DEFAULT_ACTIONS.select, P.DEFAULT_ACTIONS.start],
    ["next_page", "prev_page", "next_page", "prev_page", "top_menu", "footer_menu"]);

  // efektywne / nadpisania / różnice
  eq("efektywne bez nadpisań = domyślne", P.effectiveActions({}), P.DEFAULT_ACTIONS);
  eq("efektywne: nadpisanie jednej roli", P.effectiveActions({ rb: "top_menu" }).rb, "top_menu");
  eq("efektywne: reszta bez zmian", P.effectiveActions({ rb: "top_menu" }).lb, "prev_page");
  eq("efektywne: nieznana akcja ignorowana", P.effectiveActions({ rb: "teleport" }).rb, "next_page");
  eq("nadpisania: wartości domyślne odpadają", P.actionOverrides({ ...P.DEFAULT_ACTIONS, rb: "top_menu", a: "sentence_select" }), { rb: "top_menu" });
  eq("nadpisania: none dla B zostaje (domyślnie brak akcji)", P.actionOverrides({ ...P.DEFAULT_ACTIONS, b: "none" }), { b: "none" });
  eq("nadpisania: null (B domyślnie) nie jest nadpisaniem", P.actionOverrides(P.DEFAULT_ACTIONS), {});
  eq("zmienione role (kolejność ról)", P.changedActions({ ...P.DEFAULT_ACTIONS, rb: "toc", a: "none" }), ["a", "rb"]);
  eq("zmienione role: powrót do domyślnej", P.changedActions({ ...P.DEFAULT_ACTIONS, rb: "next_page" }), []);
  ok("actionsDiffer: ta sama wartość = brak różnicy", !P.actionsDiffer({ rb: "top_menu" }, P.effectiveActions({ rb: "top_menu" })));
  ok("actionsDiffer: zmiana", P.actionsDiffer({}, { ...P.DEFAULT_ACTIONS, rb: "toc" }));
  ok("actionsDiffer: odwrócenie nadpisania do domyślnej", P.actionsDiffer({ rb: "toc" }, P.DEFAULT_ACTIONS));
  ok("hasActions", P.hasActions({ rb: "toc" }) && !P.hasActions({}) && !P.hasActions(undefined));

  // etykieta roli wylicza się z akcji — nie kłamie po przestawieniu
  eq("etykieta domyślna", [P.roleLabel("rb"), P.roleLabel("select"), P.roleLabel("lt"), P.roleLabel("b")],
    ["RB (następna strona)", "Select (menu górne)", "LT (poprzednia strona)", "B"]);
  eq("etykieta po przestawieniu", P.roleLabel("rb", P.effectiveActions({ rb: "top_menu" })), "RB (menu górne)");
  eq("etykieta: none", P.roleLabel("rb", P.effectiveActions({ rb: "none" })), "RB (nic)");
  ok("describe uwzględnia akcje", P.describe("xbox", P.IDENTITY, P.effectiveActions({ lt: "toc" })).includes("LT (spis treści)"));

  // która kontrolka pełni rolę (podpowiedź przy roli)
  eq("controlsFor: tożsamość", P.controlsFor(P.IDENTITY, "rb"), ["rshoulder"]);
  eq("controlsFor: Nintendo, rola A leży po prawej", P.controlsFor(P.defaultMap("nintendo"), "a"), ["east"]);
  eq("controlsFor: rola bez kontrolki", P.controlsFor({ ...P.IDENTITY, south: "b" }, "a"), []);
  eq("controlsFor: dwie kontrolki jedną rolą", P.controlsFor({ ...P.IDENTITY, south: "b" }, "b"), ["south", "east"]);

  // literał: klucz actions przed layouts (posortowane), bajt w bajt jak Sync.serialize
  eq("literał: same akcje", P.toLiteral({}, { select: "next_page", rb: "top_menu" }), ACTIONS_EXAMPLE);
  eq("literał: układ i akcje", P.toLiteral({ nintendo: { south: "a", east: "b" } }, { rb: "top_menu" }), BOTH_EXAMPLE);
  eq("literał: sam układ bez zmian (drugi argument opcjonalny)", P.toLiteral(EXAMPLE_LAYOUTS), EXAMPLE);
  eq("literał: puste układy i puste akcje → null", P.toLiteral({ xbox: {} }, {}), null);
  eq("literał: null w akcjach pominięty", P.toLiteral({}, { rb: null }), null);
  eq("toValue: pusty układ nie zostawia klucza layouts", Object.keys(P.toValue({}, { rb: "toc" })).sort(), ["actions", "version"]);
  eq("toValue: pustych akcji nie ma w wartości", Object.keys(P.toValue(EXAMPLE_LAYOUTS, {})).sort(), ["layouts", "version"]);

  // odczyt
  eq("parse: akcje", P.parse(ACTIONS_EXAMPLE), { state: "ok", layouts: {}, actions: { rb: "top_menu", select: "next_page" } });
  eq("parse: układ i akcje", P.parse(BOTH_EXAMPLE), { state: "ok", layouts: { nintendo: { south: "a", east: "b" } }, actions: { rb: "top_menu" } });
  eq("parse: stary zapis bez akcji", P.parse(EXAMPLE).actions, {});
  eq("parse: pusty actions", P.parse('{["actions"]={},["version"]=1}'), { state: "ok", layouts: {}, actions: {} });
  for (const [name, lit, why] of [
    ["actions nie tabela", '{["actions"]="x",["version"]=1}', /actions/],
    ["nieznana rola w actions", '{["actions"]={["dpad"]="next_page"},["version"]=1}', /dpad/],
    ["nieznana akcja", '{["actions"]={["rb"]="teleport"},["version"]=1}', /teleport/],
    ["akcja nie napis", '{["actions"]={["rb"]=1},["version"]=1}', /rb/],
    ["akcja jako tabela", '{["actions"]={["rb"]={}},["version"]=1}', /rb/],
    ["klucz liczbowy roli", '{["actions"]={[1]="toc"},["version"]=1}', /1/],
  ]) {
    const r = P.parse(lit);
    ok(`bad: ${name}`, r.state === "bad" && why.test(r.reason));
  }

  // round-trip: każda rola × każda akcja, osobno i razem z układem
  let n = 0;
  for (const role of P.ROLE_IDS) for (const act of P.ACTION_IDS) {
    const map = { ...P.DEFAULT_ACTIONS, [role]: act };
    const ov = P.actionOverrides(map);
    const lit = P.toLiteral(EXAMPLE_LAYOUTS, ov);
    const back = P.parse(lit);
    if (back.state !== "ok" || canon(back.actions) !== canon(ov) || canon(back.layouts) !== canon(EXAMPLE_LAYOUTS) || P.toLiteral(back.layouts, back.actions) !== lit) {
      fail++; console.log(`FAIL round-trip akcji ${role}=${act}: ${lit}`);
    }
    if (Object.keys(ov).length) n++;
  }
  eq("round-trip każda rola × każda akcja: tyle niedomyślnych", n, P.ROLE_IDS.length * P.ACTION_IDS.length - 9);  // 9 ról z akcją domyślną, B jej nie ma

  // ten sam literał przez prawdziwe Sync.serialize/deserialize (czytnik)
  for (const [name, lit] of [["akcje", ACTIONS_EXAMPLE], ["układ i akcje", BOTH_EXAMPLE]]) {
    const lua = spawnSync("lua", ["tests/luaser_ref.lua", "fix"], { input: lit + "\n", encoding: "utf8" });
    if (lua.status !== 0) { fail++; console.log(`FAIL lua (${name}): ` + lua.stderr); }
    else eq(`Sync.serialize(Sync.deserialize(literał z: ${name})) == literał`, lua.stdout.split("\n")[0], lit);
  }
}

console.log(`padmap: ${fail ? fail + " błędów" : "ok"}`);
process.exit(fail ? 1 : 0);
