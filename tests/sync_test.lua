-- Testy czystej logiki pluginu: lua tests/sync_test.lua (z katalogu repo)
package.path = "plugin/koligilo.koplugin/?.lua;" .. package.path
local Sync = require("sync")

local passed, failed = 0, 0
local function check(name, cond, extra)
    if cond then passed = passed + 1
    else failed = failed + 1; print("FAIL: " .. name .. (extra and (" — " .. tostring(extra)) or "")) end
end

local function deep_eq(a, b)
    if type(a) ~= type(b) then return false end
    if type(a) ~= "table" then return a == b end
    for k, v in pairs(a) do if not deep_eq(v, b[k]) then return false end end
    for k in pairs(b) do if a[k] == nil then return false end end
    return true
end

-- serializacja ----------------------------------------------------------------
local sample = {
    1, 2, "trzy", [10] = true, name = "Zażółć \"gęślą\"\n\\jaźń\t\1", neg = -3.25,
    big = 1e20, nested = { a = { b = { c = false } } }, ["klucz.z.kropką"] = 7,
}
local s = assert(Sync.serialize(sample))
local back, err = Sync.deserialize(s)
check("roundtrip", deep_eq(sample, back), err)
check("deterministyczne", s == Sync.serialize(back))
check("klucz liczbowy zostaje liczbą", back[1] == 1 and back["1"] == nil)
check("pusta tabela", deep_eq(Sync.deserialize("{}"), {}))
check("funkcja nieserializowalna", Sync.serialize({ f = print }) == nil)
check("NaN odrzucony", Sync.serialize(0 / 0) == nil)
check("inf jako klucz odrzucony", Sync.serialize({ [math.huge] = 1 }) == nil)

-- padmap kopad (TASK-25, PC-011): literał zapisywany przez panel (web/lua.js, luavalue.go)
-- == Sync.serialize bajt w bajt, klucze tekstowe, version jako liczba
do
    local pm = { version = 1, layouts = { nintendo = { south = "a", east = "b" },
        xbox = { ltrigger = "rt", rtrigger = "lt" } } }
    local want = '{["layouts"]={["nintendo"]={["east"]="b",["south"]="a"},["xbox"]={["ltrigger"]="rt",["rtrigger"]="lt"}},["version"]=1}'
    check("padmap: serialize == literał z panelu", Sync.serialize(pm) == want, Sync.serialize(pm))
    check("padmap: deserialize∘serialize", deep_eq(Sync.deserialize(want), pm))
    -- katalog: grupa kopad = jedyny klucz padmap (Key); enabled i układ urządzenia nie wchodzą
    local kopad = { { file = "settings/kopad.lua", key = "padmap" } }
    check("padmap: allowed |padmap", Sync.allowed(kopad, "settings/kopad.lua|padmap"))
    check("padmap: enabled poza katalogiem", not Sync.allowed(kopad, "settings/kopad.lua|enabled")
        and not Sync.allowed(kopad, "settings/kopad.lua#enabled"))
    check("padmap: układ urządzenia poza katalogiem", not Sync.allowed(kopad, "settings/kopad_device.lua|padmap_layout"))
end

-- parser nie wykonuje kodu
for _, evil in ipairs({ 'os.exit(1)', '("x"):rep(9)', '{[1]=print}', '"a"..os.getenv("HOME")',
    '{[1]=1', '"\\300"', '1 2', 'function() end' }) do
    check("odrzuca: " .. evil, Sync.deserialize(evil) == nil)
end

-- czarna lista ------------------------------------------------------------------
check("device_id zablokowany", Sync.isBlocked("settings.reader.lua|device_id"))
check("podklucz home_dir zablokowany", Sync.isBlocked("settings.reader.lua|home_dir.x"))
check("prefiks android_", Sync.isBlocked("settings.reader.lua|android_foo"))
check("wallabag.directory", Sync.isBlocked("settings/wallabag.lua|wallabag.directory"))
check("path traversal", Sync.isBlocked("../../etc/x.lua|a"))
check("ścieżka absolutna", Sync.isBlocked("/etc/passwd.lua|a"))
check("koligilo.lua", Sync.isBlocked("settings/koligilo.lua#token"))
check("footer dozwolony", not Sync.isBlocked("settings.reader.lua|footer"))

-- scenariusze -------------------------------------------------------------------
local R = "settings.reader.lua"
local entries = {
    { file = R, key = "footer" },
    { file = R, key = "statistics.calendar_start_day_of_week" },
    { file = R, prefix = "copt_", except = { "copt_font_size" } },
    { file = "settings/profiles.lua", prefix = "" },
    { file = R, key = "device_id" }, -- błędny katalog: czarna lista musi to zatrzymać
}

local function run(files, base, remote)
    local p = Sync.plan(entries, files, base, remote)
    Sync.applyPlan(p, files)
    return p
end

-- urządzenie A (pierwsze): wysyła wszystko, co ma
local A = {
    [R] = { exists = true, data = { footer = { time = true }, copt_line_spacing = 110,
        copt_font_size = 22, device_id = "A", statistics = { calendar_start_day_of_week = 2, sync_server = "x" } } },
    ["settings/profiles.lua"] = { exists = true, data = { ["Nocny v1.2"] = { settings = { name = "Nocny v1.2" } } } },
}
local pA = run(A, {}, { values = {}, deleted = {} })
check("A wysyła footer", pA.upload[R .. "|footer"] == "{[\"time\"]=true}", pA.upload[R .. "|footer"])
check("A wysyła copt_line_spacing", pA.upload[R .. "#copt_line_spacing"] == "110")
check("A NIE wysyła copt_font_size (except)", pA.upload[R .. "#copt_font_size"] == nil)
check("A NIE wysyła device_id (czarna lista)", pA.upload[R .. "|device_id"] == nil)
check("A wysyła profil z kropką w nazwie", pA.upload["settings/profiles.lua#Nocny v1.2"] ~= nil)
check("A wysyła zagnieżdżony klucz", pA.upload[R .. "|statistics.calendar_start_day_of_week"] == "2")

-- „serwer” = to, co wysłał A
local server = { values = {}, deleted = {} }
for id, v in pairs(pA.upload) do server.values[id] = v end

-- urządzenie B (nowe): ma swoje domyślne, przyjmuje wspólne
local footerB = { time = false, battery = true }
local B = { [R] = { exists = true, data = { footer = footerB, copt_line_spacing = 100, device_id = "B" } } }
local pB = run(B, {}, server)
check("B przyjmuje footer", B[R].data.footer.time == true and B[R].data.footer.battery == nil)
check("B: footer podmieniony W MIEJSCU (referencja modułu żyje)", B[R].data.footer == footerB)
check("B przyjmuje interlinię", B[R].data.copt_line_spacing == 110)
check("B dostaje nowy plik profili", B["settings/profiles.lua"].data["Nocny v1.2"] ~= nil)
check("B device_id nietknięty", B[R].data.device_id == "B")
check("B: konflikty policzone (miał własne wartości)", pB.conflicts == 2, pB.conflicts)
check("B nic nie wysyła", next(pB.upload) == nil)

-- B zmienia interlinię lokalnie → wysyła; A dostaje przy następnej synchronizacji
local baseB = pB.base
B[R].data.copt_line_spacing = 125
local pB2 = run(B, baseB, server)
check("B wysyła swoją zmianę", pB2.upload[R .. "#copt_line_spacing"] == "125")
server.values[R .. "#copt_line_spacing"] = "125"
local pA2 = run(A, pA.base, server)
check("A przyjmuje zmianę B", A[R].data.copt_line_spacing == 125)
check("A: to nie konflikt", pA2.conflicts == 0)

-- obie strony zmieniły to samo: wygrywa wersja wspólna, liczymy konflikt
A[R].data.copt_line_spacing = 90
server.values[R .. "#copt_line_spacing"] = "130"
local pA3 = run(A, pA2.base, server)
check("konflikt: wygrywa serwer", A[R].data.copt_line_spacing == 130 and pA3.conflicts == 1)

-- usunięcie lokalne propaguje się jako delete
A[R].data.footer = nil
local pA4 = run(A, pA3.base, server)
check("usunięcie → delete", pA4.delete[1] == R .. "|footer", pA4.delete[1])
server.values[R .. "|footer"] = nil
server.deleted = { R .. "|footer" }
local pB3 = run(B, pB2.base, server)
check("nagrobek usuwa u B", B[R].data.footer == nil)

-- brak pliku (plugin nieużywany na urządzeniu) NIE jest usunięciem
local C = { [R] = { exists = true, data = {} }, ["settings/profiles.lua"] = { exists = false, data = {} } }
local baseC = { ["settings/profiles.lua#Nocny v1.2"] = server.values["settings/profiles.lua#Nocny v1.2"] }
local pC = run(C, baseC, { values = {}, deleted = {} })
check("brak pliku nie generuje delete", #pC.delete == 0)

-- grupa wyłączona: klucz znika z wpisów → nic nie robimy i zapominamy bazę
local pOff = Sync.plan({}, A, pA3.base, server)
check("grupa wyłączona: pusty plan", next(pOff.upload) == nil and next(pOff.apply) == nil and next(pOff.base) == nil)

-- bezpiecznik masowych usunięć
local bigbase = {}
for i = 1, 10 do bigbase[R .. "#copt_k" .. i] = "1" end
local empty = { [R] = { exists = true, data = {} } }
local srv = { values = {}, deleted = {} }
for id, v in pairs(bigbase) do srv.values[id] = v end
local pS = Sync.plan(entries, empty, bigbase, srv)
check("bezpiecznik wykrywa masowe usunięcie", Sync.suspicious(pS, bigbase), #pS.delete)

-- złośliwa wartość z serwera: pomijana, baza czyszczona
local D = { [R] = { exists = true, data = {} } }
local pD = run(D, {}, { values = { [R .. "|footer"] = "os.exit(1)" }, deleted = {} })
check("zła wartość pominięta", D[R].data.footer == nil and pD.skipped[R .. "|footer"] ~= nil)

-- uszkodzony plik: zero usunięć, zero nadpisań, baza zachowana
local E = { [R] = { exists = true, broken = true, data = {} } }
local baseE = { [R .. "|footer"] = "{}" }
local pE = run(E, baseE, { values = { [R .. "|footer"] = "{[\"x\"]=1}" }, deleted = {} })
check("broken: brak delete/apply", #pE.delete == 0 and next(pE.apply) == nil)
check("broken: baza zachowana", pE.base[R .. "|footer"] == "{}")

-- token sesji Dropbox (KOReader nadpisuje konto w miejscu) ------------------------
local SS = R .. "|statistics.sync_server"
local ssEntries = { { file = R, key = "statistics.sync_server" } }
local good = '{["address"]="K:S",["name"]="Dropbox",["password"]="REFRESH",["type"]="dropbox",["url"]="/koreader"}'
local function session() return { statistics = { sync_server = {
    address = "K:S", name = "Dropbox", password = "krotki", type = "dropbox", url = "/koreader", username = true } } } end
check("hasSessionToken: flaga", Sync.hasSessionToken(session().statistics))
check("hasSessionToken: czyste konto", not Sync.hasSessionToken(Sync.deserialize(good)))

-- 1) serwer nie zna wartości: zepsutej NIE wysyłamy
local F1 = { [R] = { exists = true, data = session() } }
local p1 = Sync.plan(ssEntries, F1, {}, { values = {}, deleted = {} })
check("sesja: brak wysyłki", p1.upload[SS] == nil and p1.masked[SS])
-- 2) serwer ma to samo co baza: nic nie robimy (bez pętli restartów)
local p2 = Sync.plan(ssEntries, { [R] = { exists = true, data = session() } }, { [SS] = good }, { values = { [SS] = good }, deleted = {} })
check("sesja: R == B → nic", next(p2.apply) == nil and next(p2.upload) == nil and p2.base[SS] == good)
-- 3) konto zmienione w panelu: przyjmujemy wersję z serwera
local newer = good:gsub("REFRESH", "NOWY")
local F3 = { [R] = { exists = true, data = session() } }
local p3 = Sync.plan(ssEntries, F3, { [SS] = good }, { values = { [SS] = newer }, deleted = {} })
Sync.applyPlan(p3, F3)
check("sesja: zmiana zdalna przyjęta", p3.apply[SS] == newer and F3[R].data.statistics.sync_server.password == "NOWY"
    and F3[R].data.statistics.sync_server.username == nil, p3.apply[SS])

-- wtyczki: plan instalatora (PC-004) -------------------------------------------
local SHA_A, SHA_B, SHA_C = ("a"):rep(64), ("b"):rep(64), ("c"):rep(64)
local function tp(dir, sha, ver)
    return { dir = dir, sha256 = sha, name = dir:gsub("%.koplugin$", ""), version = ver or "1.0",
        size = 10, url = "/api/v1/plugins/" .. sha .. ".zip" }
end
local function dirs(list) local o = {}; for i, p in ipairs(list) do o[i] = p.dir end; return table.concat(o, ",") end

-- bez stanu docelowego (brak zgody / stary serwer) nic się nie dzieje, nawet przy zarządzanych
local inv0 = { ["foo.koplugin"] = { managed = true, sha256 = SHA_A } }
local pn = Sync.pluginPlan(nil, inv0)
check("wtyczki: brak target → pusty plan (bez usunięć)", Sync.pluginPlanEmpty(pn) and #pn.remove == 0)

local target = { tp("foo.koplugin", SHA_A), tp("bar.koplugin", SHA_B, "2.0"), tp("new.koplugin", SHA_C),
    tp("reczna.koplugin", SHA_C) }
local inv = {
    ["foo.koplugin"] = { managed = true, sha256 = SHA_A },            -- aktualna
    ["bar.koplugin"] = { managed = true, sha256 = SHA_A, version = "1.0" }, -- inna wersja
    ["reczna.koplugin"] = { managed = false },                          -- ręczna, ta sama nazwa
    ["stara.koplugin"] = { managed = true, sha256 = SHA_B },            -- zarządzana, zniknęła z listy
    ["obca.koplugin"] = { managed = false },                            -- ręczna, nie ma jej na liście
    ["koligilo.koplugin"] = { managed = true, sha256 = SHA_A },         -- nigdy
    ["statistics.koplugin"] = { managed = false },                      -- wbudowana
}
local pp = Sync.pluginPlan(target, inv)
check("wtyczki: install tylko brakujące", dirs(pp.install) == "new.koplugin", dirs(pp.install))
check("wtyczki: update przy innym sha", dirs(pp.update) == "bar.koplugin" and pp.update[1].old_sha256 == SHA_A
    and pp.update[1].old_version == "1.0" and pp.update[1].version == "2.0", dirs(pp.update))
check("wtyczki: ta sama sha → nic", not dirs(pp.update):find("foo") and not dirs(pp.install):find("foo"))
check("wtyczki: remove tylko ze znacznikiem", dirs(pp.remove) == "stara.koplugin", dirs(pp.remove))
check("wtyczki: ręczna o tej samej nazwie → konflikt, nie nadpisujemy", dirs(pp.conflict) == "reczna.koplugin"
    and pp.conflict[1].error ~= nil)
check("wtyczki: klucz planu", Sync.pluginPlanKey(pp) ==
    "install:new.koplugin@" .. SHA_C .. ",update:bar.koplugin@" .. SHA_C:gsub("c", "b") .. ",remove:stara.koplugin@" .. SHA_B)

-- pusta lista od serwera = usuń wszystkie zarządzane (ale tylko je)
local pe = Sync.pluginPlan({}, inv)
check("wtyczki: pusty target → remove tylko zarządzanych, bez koligilo", dirs(pe.remove) == "stara.koplugin,bar.koplugin,foo.koplugin"
    or dirs(pe.remove) == "bar.koplugin,foo.koplugin,stara.koplugin", dirs(pe.remove))

-- złe wpisy z serwera są odrzucane
local bad = Sync.pluginPlan({
    tp("../x.koplugin", SHA_A), tp("koligilo.koplugin", SHA_A), tp("KOLIGILO.koplugin", SHA_A),
    { dir = "ok.koplugin", sha256 = "XYZ", url = "/api/v1/plugins/x.zip" },
    { dir = "ok2.koplugin", sha256 = SHA_A, url = "//evil.example/x.zip" },
    { dir = "ok3.koplugin", sha256 = SHA_A, url = "https://evil.example/x.zip" },
    { dir = "ok4.koplugin", sha256 = SHA_A, url = "/api/../x.zip" },
    tp("bez_sufiksu", SHA_A), "nie-tabela",
    tp("dup.koplugin", SHA_A), tp("dup.koplugin", SHA_B),
}, {})
check("wtyczki: złe wpisy → invalid", #bad.invalid == 10 and dirs(bad.install) == "dup.koplugin", #bad.invalid)

-- wyniki (np. odmowa użytkownika)
local rr = Sync.pluginResults(pp, "rejected")
check("wtyczki: results rejected", #rr == 3 and rr[1].action == "install" and rr[1].status == "rejected"
    and rr[3].action == "remove")

-- nazwy wpisów ZIP-a
for _, good in ipairs({ "foo.koplugin/", "foo.koplugin/main.lua", "foo.koplugin/lib/x.so", "foo.koplugin" }) do
    check("zip ok: " .. good, Sync.pluginEntryOK("foo.koplugin", good))
end
for _, evil in ipairs({ "../foo.koplugin/main.lua", "foo.koplugin/../x", "/foo.koplugin/main.lua",
    "bar.koplugin/main.lua", "foo.koplugin2/main.lua", "foo.koplugin//x", "foo.koplugin/./x",
    "foo.koplugin\\..\\x", "foo.koplugin/a\0b", "", "foo.koplugin/C:x" }) do
    check("zip odrzuca: " .. evil:gsub("%z", "\\0"), not Sync.pluginEntryOK("foo.koplugin", evil))
end

-- pakowanie wtyczki na serwer (TASK-13): bez symlinków, bez znacznika .koligilo
for _, ok_case in ipairs({ { "main.lua", "file" }, { "lib/x.lua", "file" }, { "lib", "directory" } }) do
    check("pack ok: " .. ok_case[1], Sync.pluginPackEntryOK(ok_case[1], ok_case[2]))
end
check("pack odrzuca symlink", not Sync.pluginPackEntryOK("main.lua", "link"))
check("pack odrzuca znacznik .koligilo", not Sync.pluginPackEntryOK(".koligilo", "file"))
check("pack odrzuca znacznik .koligilo w podkatalogu", not Sync.pluginPackEntryOK("lib/.koligilo", "file"))
check("pack odrzuca inny typ wpisu", not Sync.pluginPackEntryOK("main.lua", "socket"))
check("pack odrzuca pustą ścieżkę", not Sync.pluginPackEntryOK("", "file"))

-- _meta.lua tylko wyrażeniem regularnym
local meta = [[local _ = require("gettext")
return {
    name = "foo",
    fullname = _("Foo — coś"),
    version = '1.2.3',
    description = _([[Opis]] .. "]]" .. [[),
}]]
check("meta: name (nie fullname)", Sync.metaField(meta, "name") == "foo")
check("meta: version w apostrofach", Sync.metaField(meta, "version") == "1.2.3")
check("meta: brak pola", Sync.metaField(meta, "author") == nil)
check("meta: wyrażenie zamiast literału → nil", Sync.metaField('version = os.date()', "version") == nil)
-- fullname w opakowaniu gettextu (panel pokazuje go zamiast nazwy katalogu)
check("meta: fullname = _(\"…\")", Sync.metaField(meta, "fullname", 100) == "Foo — coś")
check("meta: fullname = _('…')", Sync.metaField("fullname = _('Calibre')", "fullname") == "Calibre")
check("meta: fullname = _ \"…\" bez nawiasów", Sync.metaField('fullname = _ "Z-library"', "fullname") == "Z-library")
check("meta: fullname bez gettextu", Sync.metaField('fullname = "Gołe"', "fullname") == "Gołe")
check("meta: _(wywołanie) zamiast literału → nil", Sync.metaField('fullname = _(os.date())', "fullname") == nil)
check("meta: konkatenacja nie jest literałem → nil", Sync.metaField('fullname = prefix .. _("X")', "fullname") == nil)
check("meta: description to nie fullname", Sync.metaField('description = _("Opis")', "fullname") == nil)
check("meta: obcięcie nie rozcina znaku UTF-8",
    Sync.metaField('fullname = _("ab—cd")', "fullname", 3) == "ab" and Sync.metaField('fullname = _("ab—cd")', "fullname", 5) == "ab—")

-- znacznik .koligilo
local mk = Sync.markerEncode({ sha256 = SHA_A, name = "foo", version = "1.0\nsha256=" .. SHA_B })
local md = Sync.markerDecode(mk)
check("znacznik: roundtrip", md.sha256 == SHA_A and md.name == "foo", mk)
check("znacznik: wstrzyknięta linia nie podmienia sha", md.sha256 == SHA_A)
check("znacznik: zła sha ignorowana", Sync.markerDecode("sha256=zzz\n").sha256 == nil)
check("znacznik: pusty plik", next(Sync.markerDecode("")) == nil)

-- czcionki (TASK-36, PC-018) ----------------------------------------------------
local SHA1, SHA2 = string.rep("a", 64), string.rep("b", 64)
local function font(file, sha, size) return { file = file, sha256 = sha, size = size or 1000, url = "/api/v1/fonts/" .. sha } end
check("font: nazwy ok", Sync.fontNameOK("Charis SIL-Regular.ttf") and Sync.fontNameOK("A (1).OTF") and Sync.fontNameOK("x.ttc"))
for _, bad in ipairs({ "../a.ttf", "a/b.ttf", "a\\b.ttf", ".a.ttf", "a.exe", "a..ttf", "a.ttf.txt", "", "a\n.ttf", string.rep("x", 100) .. ".ttf" }) do
    check("font: zła nazwa " .. bad:gsub("%c", "?"), not Sync.fontNameOK(bad))
end
check("font: nie-napis", not Sync.fontNameOK(nil) and not Sync.fontNameOK(5))
check("font: magic ttf/otf", Sync.fontMagicOK("a.ttf", "\0\1\0\0xxxx") and Sync.fontMagicOK("a.otf", "OTTOxxxx") and Sync.fontMagicOK("a.ttf", "truexxxx"))
check("font: magic kolekcja tylko jako ttc/otc", Sync.fontMagicOK("a.ttc", "ttcfxxxx") and not Sync.fontMagicOK("a.ttf", "ttcfxxxx") and not Sync.fontMagicOK("a.ttc", "OTTOxxxx"))
check("font: magic śmieci", not Sync.fontMagicOK("a.ttf", "<html>") and not Sync.fontMagicOK("a.ttf", "") and not Sync.fontMagicOK("a.ttf", nil))
local man = Sync.fontManifestDecode(Sync.fontManifestEncode({ ["A B.ttf"] = SHA1, ["c.otf"] = SHA2 }))
check("font: manifest roundtrip", deep_eq(man, { ["A B.ttf"] = SHA1, ["c.otf"] = SHA2 }))
check("font: manifest odrzuca śmieci", next(Sync.fontManifestDecode("../x.ttf=" .. SHA1 .. "\na.ttf=zly\n# kom\nb.ttf=" .. SHA1)) == "b.ttf")
check("font: plan bez stanu serwera nic nie robi", Sync.fontPlanEmpty(Sync.fontPlan(nil, { ["a.ttf"] = SHA1 }, { ["a.ttf"] = 1000 })))

local p = Sync.fontPlan({ font("N.ttf", SHA1), font("U.ttf", SHA2), font("Same.ttf", SHA1), font("Gone.ttf", SHA1), font("Man.ttf", SHA1) },
    { ["U.ttf"] = SHA1, ["Same.ttf"] = SHA1, ["Gone.ttf"] = SHA1, ["Old.ttf"] = SHA2 },
    { ["U.ttf"] = 1000, ["Same.ttf"] = 1000, ["Man.ttf"] = 5, ["Old.ttf"] = 9 })
check("font plan: install nowej i zniknietej z dysku", #p.install == 2 and p.install[1].file == "N.ttf" and p.install[2].file == "Gone.ttf")
check("font plan: update zmienionego sha", #p.update == 1 and p.update[1].file == "U.ttf" and p.update[1].old_sha256 == SHA1)
check("font plan: ten sam sha i rozmiar bez zmian", #p.install + #p.update == 3)
check("font plan: plik obcy w naszym katalogu to konflikt", #p.conflict == 1 and p.conflict[1].file == "Man.ttf")
check("font plan: usunięcie tylko z manifestu", #p.remove == 1 and p.remove[1].file == "Old.ttf")
local ps = Sync.fontPlan({ font("S.ttf", SHA1, 999) }, { ["S.ttf"] = SHA1 }, { ["S.ttf"] = 1 })
check("font plan: zły rozmiar na dysku = update", #ps.update == 1)
check("font plan: pusty cel usuwa wszystko z manifestu", #Sync.fontPlan({}, { ["a.ttf"] = SHA1, ["b.ttf"] = SHA2 }, {}).remove == 2)
local pi = Sync.fontPlan({ font("../x.ttf", SHA1), font("a.ttf", "zly"), { file = "b.ttf", sha256 = SHA1, size = 10, url = "http://evil/x" },
    font("c.ttf", SHA1, Sync.FONT_MAX_SIZE + 1), font("d.ttf", SHA1), font("d.ttf", SHA2), "x" }, {}, {})
check("font plan: wpisy nieprawidłowe", #pi.invalid == 6 and #pi.install == 1, #pi.invalid)
local batch = Sync.FONT_MAX_BATCH
Sync.FONT_MAX_BATCH = 1500
local big = 800
local pb = Sync.fontPlan({ font("a.ttf", SHA1, big), font("b.ttf", SHA2, big), font("c.ttf", SHA1, 20) }, {}, {})
Sync.FONT_MAX_BATCH = batch
check("font plan: budżet na synchronizację", #pb.install == 2 and #pb.deferred == 1 and pb.deferred[1].file == "b.ttf")

-- przenosiny serwera (TASK-15) ------------------------------------------------
local M = Sync.movedURL
check("moved: https → https", M("https://a.example", "https://b.example") == "https://b.example")
check("moved: z portem i ścieżką, bez końcowego /", M("https://a", "https://b.example:8443/koligilo/") == "https://b.example:8443/koligilo")
check("moved: https → http w LAN", M("https://koligilo.sypian.ski", "http://192.168.1.5:7210") == "http://192.168.1.5:7210")
check("moved: https → http Tailscale", M("https://a", "http://100.84.1.2:7210") == "http://100.84.1.2:7210")
check("moved: https → http w internecie odrzucone", M("https://a", "http://evil.example:7210") == nil)
check("moved: http → http dowolny", M("http://192.168.1.5:7210", "http://koligilo.example") == "http://koligilo.example")
check("moved: login w adresie odrzucony", M("https://a", "https://user:pw@b.example") == nil)
check("moved: zapytanie odrzucone", M("https://a", "https://b.example/?x=1") == nil)
check("moved: inny schemat odrzucony", M("https://a", "file:///etc/passwd") == nil)
check("moved: nie-napis", M("https://a", { "x" }) == nil and M("https://a", nil) == nil)
check("moved: ten sam adres to nie przenosiny", M("https://a.example", "https://a.example/") == nil)
check("moved: zły port", M("https://a", "https://b:99999") == nil)
check("moved: spacje", M("https://a", "https://b.example/ x") == nil)

-- samoaktualizacja (TASK-39) ----------------------------------------------------
check("wersja: parsowanie", deep_eq(Sync.versionParse("0.8.1"), { 0, 8, 1 }) and deep_eq(Sync.versionParse("12.0.345"), { 12, 0, 345 }))
check("wersja: śmieci odrzucone", Sync.versionParse("v0.8.1") == nil and Sync.versionParse("0.8") == nil and Sync.versionParse("0.8.1-beta") == nil
    and Sync.versionParse(" 0.8.1") == nil and Sync.versionParse(nil) == nil and Sync.versionParse(81) == nil and Sync.versionParse("0.8.1.2") == nil)
check("wersja: nowsza liczbowo, nie tekstowo", Sync.versionNewer("0.10.0", "0.9.9") and Sync.versionNewer("1.0.0", "0.99.99") and Sync.versionNewer("0.8.1", "0.8.0"))
check("wersja: równa i starsza to nie nowsza", not Sync.versionNewer("0.8.0", "0.8.0") and not Sync.versionNewer("0.7.9", "0.8.0"))
check("wersja: nierozpoznana to nie nowsza", not Sync.versionNewer("x", "0.8.0") and not Sync.versionNewer("0.9.0", nil))
local SHA = ("a"):rep(64)
local function SU(t, cur) return Sync.selfUpdateInfo(t, cur or "0.8.0") end
local good = { version = "0.9.0", sha256 = SHA, url = "/koligilo.koplugin.zip", size = 200000 }
check("self_update: poprawne wskazanie", SU(good) and SU(good).version == "0.9.0" and SU(good).size == 200000)
local v, why = SU({ version = "0.8.0", sha256 = SHA, url = "/koligilo.koplugin.zip", size = 1 })
check("self_update: ta sama wersja — cisza, bez powodu", v == nil and why == nil)
check("self_update: nie-tabela — cisza", SU(nil) == nil and SU("x") == nil and select(2, SU("x")) == nil)
check("self_update: zły numer — powód", select(2, SU({ version = "juz", sha256 = SHA, url = good.url, size = 1 })) ~= nil)
check("self_update: zła suma — powód", select(2, SU({ version = "0.9.0", sha256 = "ABC", url = good.url, size = 1 })) ~= nil)
check("self_update: obcy adres — powód", select(2, SU({ version = "0.9.0", sha256 = SHA, url = "http://evil.example/x.zip", size = 1 })) ~= nil
    and select(2, SU({ version = "0.9.0", sha256 = SHA, url = "/inny.zip", size = 1 })) ~= nil)
check("self_update: rozmiar spoza zakresu — powód", select(2, SU({ version = "0.9.0", sha256 = SHA, url = good.url, size = 0 })) ~= nil
    and select(2, SU({ version = "0.9.0", sha256 = SHA, url = good.url, size = 99 * 1024 * 1024 })) ~= nil
    and select(2, SU({ version = "0.9.0", sha256 = SHA, url = good.url })) ~= nil)
check("self_update: nieznana własna wersja — nie aktualizujemy", Sync.selfUpdateInfo(good, nil) == nil)
check("katalog własny: z ścieżki main.lua", Sync.selfParentDir("@/sdcard/koreader/plugins/koligilo.koplugin/main.lua") == "/sdcard/koreader/plugins"
    and Sync.selfParentDir("@/opt/koreader-shared/plugins/koligilo.koplugin/main.lua") == "/opt/koreader-shared/plugins")
check("katalog własny: inna nazwa katalogu odrzucona", Sync.selfParentDir("@/x/plugins/moje-koligilo.koplugin/main.lua") == nil
    and Sync.selfParentDir("@/x/plugins/koligilo.koplugin/inny.lua") == nil and Sync.selfParentDir(nil) == nil and Sync.selfParentDir("=stdin") == nil)

-- parametr screen --------------------------------------------------------------
check("screen: e-ink", Sync.screenParam(1404, 1872, 227, false) == "1404x1872@227")
check("screen: kolorowy", Sync.screenParam(1404, 1872, 227, true) == "1404x1872@227,c")
check("screen: liczby ułamkowe się zaokrąglają", Sync.screenParam(823.6, 1648, 299.9, nil) == "824x1648@300")
check("screen: brak danych", Sync.screenParam(nil, 1872, 227) == nil and Sync.screenParam("x", 1, 1) == nil)
check("screen: poza zakresem", Sync.screenParam(100, 1872, 227) == nil and Sync.screenParam(1404, 1872, 5) == nil
    and Sync.screenParam(1404, 99999, 227) == nil)

-- scalanie wspólnych baz po synchronizacji (TASK-42) ----------------------------
check("merge: bez zgody nic", #Sync.mergeEvents(false, 0) == 0 and #Sync.mergeEvents(nil, 0) == 0)
check("merge: za zgodą i bez zmian — statystyki i słowniczek",
    deep_eq(Sync.mergeEvents(true, 0), { "SyncBookStats", "SyncVocabBuilder" }) and #Sync.mergeEvents(true, nil) == 2)
check("merge: po zmianie ustawień czeka na restart", #Sync.mergeEvents(true, 3) == 0)

-- cicha synchronizacja po wybudzeniu (TASK-44) -----------------------------------
local R = Sync.shouldSyncOnResume
check("resume: wszystko gra, próg dokładnie osiągnięty", R(true, true, true, 1000, 1900, 900) == true)
check("resume: o sekundę przed progiem", R(true, true, true, 1000, 1899, 900) == false)
check("resume: brak last_sync (pierwsza synchronizacja tylko ręcznie)", R(true, true, true, nil, 5000, 900) == false)
check("resume: brak sieci", R(true, true, false, 1000, 9000, 900) == false)
check("resume: auto_sync wyłączone", R(true, false, true, 1000, 9000, 900) == false)
check("resume: niesparowany", R(false, true, true, 1000, 9000, 900) == false)

-- wstrzymana synchronizacja zgłaszana do panelu (TASK-50) -------------------------
check("blocked: poprawny wpis", Sync.blockedCount({ at = 100, deleted = 7 }) == 7 and Sync.blockedCount({ deleted = 1000000 }) == 1000000)
check("blocked: brak wpisu", Sync.blockedCount(nil) == nil and Sync.blockedCount("7") == nil and Sync.blockedCount({}) == nil)
check("blocked: liczba poza zakresem albo nie całkowita", Sync.blockedCount({ deleted = 0 }) == nil and Sync.blockedCount({ deleted = -2 }) == nil
    and Sync.blockedCount({ deleted = 1000001 }) == nil and Sync.blockedCount({ deleted = 2.5 }) == nil and Sync.blockedCount({ deleted = "7" }) == nil)
local br = Sync.blockedRecord(5, 1234)
check("blocked: nowy wpis", br and br.at == 1234 and br.deleted == 5 and Sync.blockedCount(br) == 5)
check("blocked: zła liczba nie daje wpisu", Sync.blockedRecord(0, 1) == nil and Sync.blockedRecord(nil, 1) == nil and Sync.blockedRecord(1.5, 1) == nil)

-- jednorazowa informacja o zgodach (TASK-46) ---------------------------------------
check("hint zgód: pierwszy raz, nie cicho", Sync.consentsHintDue(false, false) == true and Sync.consentsHintDue(nil, nil) == true)
check("hint zgód: nie w cichej synchronizacji", Sync.consentsHintDue(false, true) == false)
check("hint zgód: tylko raz", Sync.consentsHintDue(true, false) == false)

print(string.format("%d ok, %d fail", passed, failed))
os.exit(failed == 0 and 0 or 1)
