-- Test end-to-end: prawdziwy serwer koligilo + prawdziwy sync.lua, dwa
-- symulowane czytniki rozmawiające przez HTTP (curl).
--   lua tests/e2e_test.lua http://127.0.0.1:PORT <admin-token>
package.path = "plugin/koligilo.koplugin/?.lua;tests/?.lua;" .. package.path
local Sync = require("sync")
local J = require("json_mini")

local SERVER, ADMIN = arg[1], arg[2]
local passed, failed = 0, 0
local function check(name, cond, extra)
    if cond then passed = passed + 1; print("  ok   " .. name)
    else failed = failed + 1; print("  FAIL " .. name .. (extra and (" — " .. tostring(extra)) or "")) end
end

local function sh_quote(s) return "'" .. s:gsub("'", "'\\''") .. "'" end

local function http(method, path, token, body)
    local cmd = "curl -s -o /dev/stdout -w '\\n%{http_code}' -X " .. method
    if token then cmd = cmd .. " -H " .. sh_quote("Authorization: Bearer " .. token) end
    if body then cmd = cmd .. " -H 'Content-Type: application/json' --data-binary " .. sh_quote(J.encode(body)) end
    local p = io.popen(cmd .. " " .. sh_quote(SERVER .. path))
    local out = p:read("a"); p:close()
    local text, code = out:match("^(.*)\n(%d+)$")
    return tonumber(code), text ~= "" and J.decode(text) or nil
end

-- symulowany czytnik: pliki w pamięci + baza + token
local function Device(name, files)
    return { name = name, files = files, base = {} }
end

local function pair(dev)
    local c, d = http("POST", "/api/v1/pair", nil, { name = dev.name, model = dev.name, platform = "Test", ko_version = "v2026.07" })
    assert(c == 200 and d.code, "pair start")
    local _, st = http("GET", "/api/admin/state", ADMIN)
    local found
    for _, p in ipairs(st.pending) do if p.id == d.id then found = p end end
    check(dev.name .. ": prośba widoczna w panelu z tym samym kodem", found and found.code == d.code)
    local c2 = http("POST", "/api/admin/pair/" .. d.id, ADMIN, { approve = true })
    check(dev.name .. ": zatwierdzenie w panelu", c2 == 200)
    local c3, r = http("GET", "/api/v1/pair/" .. d.id)
    check(dev.name .. ": czytnik odbiera token", c3 == 200 and r.status == "approved" and r.token)
    dev.token, dev.id = r.token, r.device_id
    local c4 = http("GET", "/api/v1/pair/" .. d.id)
    check(dev.name .. ": token wydany tylko raz", c4 == 404)
end

-- dokładnie ta sama kolejność co Koligilo:sync w main.lua
local function sync(dev)
    local c, remote = http("GET", "/api/v1/sync", dev.token)
    assert(c == 200, "sync GET " .. tostring(c))
    local plan = Sync.plan(remote.entries, dev.files, dev.base, remote)
    assert(not Sync.suspicious(plan, dev.base), "suspicious")
    local body = { received = 0, note = "e2e" }
    if next(plan.upload) then body.set = plan.upload end
    if #plan.delete > 0 then body.delete = plan.delete end
    local c2, resp = http("POST", "/api/v1/sync", dev.token, body)
    assert(c2 == 200, "sync POST " .. tostring(c2))
    for _, id in ipairs(resp.rejected or {}) do plan.base[id] = dev.base[id] end
    local _, n = Sync.applyPlan(plan, dev.files)
    dev.base = plan.base
    return plan, n, resp
end

local R = "settings.reader.lua"
print("koligilo e2e @ " .. SERVER)

local kobo = Device("Kobo Libra", {
    [R] = { exists = true, data = {
        footer = { time = true, battery = true, toc_markers = true },
        copt_line_spacing = 110, copt_font_size = 24, device_id = "kobo-1", home_dir = "/mnt/onboard",
        dicts_order = { "Kazimirski", "PWN", "Wiktionary" },
        statistics = { calendar_start_day_of_week = 2, sync_server = { type = "webdav" } },
    } },
    ["settings/wallabag.lua"] = { exists = true, data = { wallabag = {
        server_url = "https://wb.example", username = "jakub", password = "sekret", directory = "/mnt/onboard/wallabag" } } },
    ["settings/gestures.lua"] = { exists = true, data = { gesture_reader = { tap_top_left_corner = { toggle_frontlight = true } } } },
})
local pixel = Device("Pixel 8a", {
    [R] = { exists = true, data = { footer = { time = false }, copt_line_spacing = 100, copt_font_size = 18,
        device_id = "pixel-1", home_dir = "/sdcard/Books" } },
    ["settings/wallabag.lua"] = { exists = false, data = {} },
    ["settings/gestures.lua"] = { exists = false, data = {} },
})

print("[parowanie]")
pair(kobo)
pair(pixel)

print("[1. synchronizacja Kobo — pierwsze urządzenie wysyła]")
local p1 = sync(kobo)
local nup = 0; for _ in pairs(p1.upload) do nup = nup + 1 end
check("Kobo wysłał ustawienia (" .. nup .. ")", nup >= 6, nup)
check("Kobo nie wysłał copt_font_size (grupa „układ” domyślnie off)", p1.upload[R .. "#copt_font_size"] == nil)
check("Kobo nie wysłał wallabag.directory", p1.upload["settings/wallabag.lua|wallabag.directory"] == nil)

print("[2. Pixel przyjmuje wspólne]")
local _, n2 = sync(pixel)
local P = pixel.files[R].data
check("Pixel: stopka z Kobo", P.footer.time == true and P.footer.toc_markers == true)
check("Pixel: interlinia z Kobo", P.copt_line_spacing == 110)
check("Pixel: kolejność słowników (tablica zostaje tablicą)", P.dicts_order and P.dicts_order[1] == "Kazimirski" and #P.dicts_order == 3)
check("Pixel: konto Wallabag bez wpisywania", pixel.files["settings/wallabag.lua"].data.wallabag.password == "sekret")
check("Pixel: folder Wallabag NIE przeniesiony", pixel.files["settings/wallabag.lua"].data.wallabag.directory == nil)
check("Pixel: własny rozmiar czcionki zostaje", P.copt_font_size == 18)
check("Pixel: device_id i home_dir nietknięte", P.device_id == "pixel-1" and P.home_dir == "/sdcard/Books")
check("Pixel: gesty z Kobo", pixel.files["settings/gestures.lua"].data.gesture_reader.tap_top_left_corner.toggle_frontlight == true)
check("Pixel: liczba zmian > 0 (prośba o restart)", n2 > 0, n2)

print("[3. panel wyłącza gesty na Pixelu, Pixel zmienia interlinię]")
local c = http("POST", "/api/admin/devices/" .. pixel.id .. "/groups", ADMIN, { group = "gesty", on = false })
check("wyłączenie grupy w panelu", c == 200)
P.copt_line_spacing = 125
pixel.files["settings/gestures.lua"].data.gesture_reader.tap_top_left_corner = { show_menu = true }
local p3 = sync(pixel)
check("Pixel wysłał interlinię", p3.upload[R .. "#copt_line_spacing"] == "125")
check("Pixel NIE wysłał gestów (grupa off)", p3.upload["settings/gestures.lua|gesture_reader"] == nil)
local _, n4 = sync(kobo)
check("Kobo przyjął interlinię z Pixela", kobo.files[R].data.copt_line_spacing == 125)
check("Kobo zachował swoje gesty", kobo.files["settings/gestures.lua"].data.gesture_reader.tap_top_left_corner.toggle_frontlight == true)

print("[4. usunięcie propaguje się]")
kobo.files[R].data.dicts_order = nil
local p5 = sync(kobo)
check("Kobo wysłał usunięcie", p5.delete[1] == R .. "|dicts_order", p5.delete[1])
sync(pixel)
check("Pixel usunął dicts_order", pixel.files[R].data.dicts_order == nil)

print("[5. serwer odrzuca zapis spoza włączonych grup i klucze urządzenia]")
local _, resp = http("POST", "/api/v1/sync", pixel.token, { set = {
    ["settings/gestures.lua|gesture_reader"] = "{}", [R .. "|device_id"] = '"hack"' } })
local rej = {}; for _, id in ipairs(resp.rejected or {}) do rej[id] = true end
check("odrzucone: gesty (grupa off)", rej["settings/gestures.lua|gesture_reader"])
check("odrzucone: device_id (spoza katalogu)", rej[R .. "|device_id"])

print("[6. panel: sekrety ukryte, zapomnienie unieważnia token]")
local _, st = http("GET", "/api/admin/state", ADMIN)
local leaked = false
for _, v in ipairs(st.values) do if v.preview and v.preview:find("sekret") then leaked = true end end
check("hasło Wallabag nie wycieka do panelu", not leaked)
check("bez tokenu admina: 401", (http("GET", "/api/admin/state", "zly")) == 401)
http("DELETE", "/api/admin/devices/" .. pixel.id, ADMIN)
check("zapomniane urządzenie dostaje 401", (http("GET", "/api/v1/sync", pixel.token)) == 401)

print("[7. parowanie kodem przez punkt kontaktowy]")
local c1, rvs = http("POST", "/api/v1/rv", nil, { name = "Bigme HiBreak", model = "HiBreak", platform = "Android", ko_version = "v2026.07.1" })
check("czytnik dostaje 6-cyfrowy kod", c1 == 200 and rvs.code and #rvs.code == 6, rvs and rvs.code)
local c2, w1 = http("GET", "/api/v1/rv/" .. rvs.id)
check("przed wpisaniem kodu: czeka", c2 == 200 and w1.status == "waiting")
local c3, info = http("GET", "/api/admin/rv/" .. rvs.code:sub(1, 3) .. "%20" .. rvs.code:sub(4), ADMIN)
check("panel widzi czytnik pod kodem (ze spacją)", c3 == 200 and info.name == "Bigme HiBreak", c3)
check("lookup bez tokenu admina: 401", (http("GET", "/api/admin/rv/" .. rvs.code)) == 401)
local c4 = http("POST", "/api/admin/rv/" .. rvs.code .. "/claim", ADMIN)
check("panel przejmuje kod", c4 == 200, c4)
local c5, ready = http("GET", "/api/v1/rv/" .. rvs.id)
check("czytnik odbiera adres i klucz", c5 == 200 and ready.status == "ready" and ready.token and ready.server:match("^http"), c5)
check("klucz wydany tylko raz", (http("GET", "/api/v1/rv/" .. rvs.id)) == 404)
local bigme = Device("Bigme", { [R] = { exists = true, data = { footer = { time = true } } } })
bigme.token, bigme.id = ready.token, ready.device_id
local pb = sync(bigme)
check("czytnik z kodu synchronizuje się kluczem", pb ~= nil)
check("kod po użyciu nie działa", (http("GET", "/api/admin/rv/" .. rvs.code, ADMIN)) == 404)
local blocked = false
for i = 1, 12 do
    local cc = http("GET", "/api/admin/rv/00000" .. (i % 10), ADMIN)
    if cc == 429 then blocked = true break end
end
check("seria złych kodów → blokada 429", blocked)

print("[8. konta wpisane w panelu]")
-- Bigme ma stary KOReader: kosync w settings.reader.lua pod „kosync”. main.lua
-- podaje tę tabelę jako settings/kosync.lua → settings (ta sama referencja).
local oldKosync = { sync_forward = 1, auto_sync = false }
bigme.files[R].data.kosync = oldKosync
bigme.files["settings/kosync.lua"] = { exists = true, data = { settings = oldKosync } }
-- …i konto Dropbox zepsute przez sesję KOReadera (krótkotrwały token)
bigme.files[R].data.statistics = { sync_server = { type = "dropbox", name = "Dropbox", address = "K:S",
    password = "krotki", url = "/", username = true } }
sync(bigme)
local _, stAfter = http("GET", "/api/admin/state", ADMIN)
local leaked = false
for _, v in ipairs(stAfter.values) do
    if v.id == R .. "|statistics.sync_server" and (v.from or ""):find("Bigme", 1, true) then leaked = true end
end
check("token sesji Dropbox nie trafia na serwer", not leaked)

check("panel: kosync", (http("PUT", "/api/admin/accounts/kosync", ADMIN,
    { server = "https://sync.example.com", username = "jakub", password = "tajne" })) == 200)
check("panel: konto WebDAV", (http("POST", "/api/admin/accounts/cloud", ADMIN, { index = -1, type = "webdav",
    name = "Koofr", address = "https://app.koofr.net/dav/Koofr", username = "a@b.pl", password = "p1", folder = "/" })) == 200)
check("panel: statystyki na Koofr", (http("PUT", "/api/admin/accounts/target/statystyki", ADMIN,
    { account = 0, folder = "/koreader" })) == 200)
local _, acc = http("GET", "/api/admin/accounts", ADMIN)
check("GET kont bez haseł", acc.kosync.has_password and not J.encode(acc):find("p1", 1, true))

sync(bigme)
check("stary KOReader: kosync w settings.reader.lua (w miejscu)",
    bigme.files[R].data.kosync == oldKosync and oldKosync.username == "jakub"
    and oldKosync.userkey == "77f869401de682f60e0e749493ab793d" and oldKosync.sync_forward == 1, J.encode(oldKosync))
local ss = bigme.files[R].data.statistics.sync_server
check("statystyki: konto z panelu zastępuje token sesji",
    ss.type == "webdav" and ss.password == "p1" and ss.url == "/koreader" and ss.username == "a@b.pl", J.encode(ss))
check("konta w chmurze: lista na czytniku",
    bigme.files["settings/cloudstorage.lua"].data.cs_servers[1].name == "Koofr")

print("[9. panel: zmiana z panelu trafia na czytnik, usunięcie nie wraca]")
local ID9 = R .. "|toc_items_per_page"
check("panel: zapis wartości przez /api/admin/values", (http("POST", "/api/admin/values", ADMIN, { set = { [ID9] = "42" } })) == 200)
sync(kobo)
check("Kobo pobrał wartość z panelu", kobo.files[R].data.toc_items_per_page == 42, kobo.files[R].data.toc_items_per_page)
sync(bigme)
check("Bigme pobrał wartość z panelu", bigme.files[R].data.toc_items_per_page == 42, bigme.files[R].data.toc_items_per_page)

check("panel: usunięcie wartości przez /api/admin/values", (http("POST", "/api/admin/values", ADMIN, { delete = { ID9 } })) == 200)
sync(kobo)
check("Kobo usunął wartość po delete z panelu", kobo.files[R].data.toc_items_per_page == nil)

-- Bigme ma wciąż starą wartość lokalnie (nie synchronizował się od usunięcia) —
-- nagrobek z panelu musi wygrać, a nie zostać nadpisany „zmianą” odczytaną
-- jako identyczna z jego własną (nieaktualną) bazą.
local c9, resp9 = http("GET", "/api/v1/sync", bigme.token)
local found9 = false
for _, d in ipairs(resp9.deleted or {}) do if d == ID9 then found9 = true end end
check("serwer zgłasza usunięcie drugiemu czytnikowi", c9 == 200 and found9)
sync(bigme)
check("Bigme usunął wartość, nie wskrzesił jej", bigme.files[R].data.toc_items_per_page == nil, bigme.files[R].data.toc_items_per_page)

-- wtyczki (TASK-8): zgoda z czytnika, plan, pobranie i własne sha256 --------------
local function run(cmd) local p = io.popen(cmd); local s = p:read("a"); p:close(); return s end
local ptmp = run("mktemp -d"):gsub("%s+$", "")
os.execute("mkdir -p " .. sh_quote(ptmp .. "/e2e.koplugin"))
local mf = io.open(ptmp .. "/e2e.koplugin/_meta.lua", "w"); mf:write('return { name = "e2e", version = "0.1" }\n'); mf:close()
mf = io.open(ptmp .. "/e2e.koplugin/main.lua", "w"); mf:write("return {}\n"); mf:close()
os.execute("cd " .. sh_quote(ptmp) .. " && zip -qr e2e.zip e2e.koplugin")
local up = J.decode(run("curl -s -H " .. sh_quote("Authorization: Bearer " .. ADMIN) .. " -F file=@"
    .. sh_quote(ptmp .. "/e2e.zip") .. " " .. sh_quote(SERVER .. "/api/admin/plugins")))
local psha = up and up.plugin and up.plugin.sha256
check("wtyczki: upload do magazynu", psha and #psha == 64, up and up.error)
check("wtyczki: przypisanie do Kobo", (http("POST", "/api/admin/devices/" .. kobo.id .. "/plugins", ADMIN,
    { plugins = { ["e2e.koplugin"] = psha } })) == 200)
local _, noconsent = http("GET", "/api/v1/sync", kobo.token)
check("wtyczki: bez zgody czytnika brak pola plugins", noconsent.plugins == nil)
local function dl(token, url)
    local o = run("curl -s -D " .. sh_quote(ptmp .. "/h") .. " -o " .. sh_quote(ptmp .. "/dl.zip") .. " -w '%{http_code}' -H "
        .. sh_quote("Authorization: Bearer " .. token) .. " " .. sh_quote(SERVER .. url))
    return tonumber(o)
end
check("wtyczki: bez zgody pobranie 403", dl(kobo.token, "/api/v1/plugins/" .. psha .. ".zip") == 403)
local _, consent = http("GET", "/api/v1/sync?plugins_allowed=1", kobo.token)
local pplan = Sync.pluginPlan(consent.plugins, { ["koligilo.koplugin"] = { managed = false } })
check("wtyczki: plan install z odpowiedzi serwera", #pplan.install == 1 and pplan.install[1].dir == "e2e.koplugin"
    and pplan.install[1].version == "0.1" and #pplan.invalid == 0)
check("wtyczki: pobranie 200", dl(kobo.token, pplan.install[1].url) == 200)
local got = run("sha256sum " .. sh_quote(ptmp .. "/dl.zip")):match("^(%x+)")
check("wtyczki: sha256 pobranych bajtów == sha z sync", got == pplan.install[1].sha256)
check("wtyczki: Bigme (nieprzypisany) dostaje 403", dl(bigme.token, pplan.install[1].url) == 403)
local crep = http("POST", "/api/v1/sync", kobo.token, { received = 0, note = "e2e", plugins = {
    installed = { { dir = "e2e.koplugin", name = "e2e", version = "0.1", managed = true, sha256 = psha },
        { dir = "koligilo.koplugin", name = "koligilo", managed = false } },
    results = { { dir = "e2e.koplugin", sha256 = psha, action = "install", status = "ok" } } } })
check("wtyczki: raport inwentarza przyjęty", crep == 200)
local pempty = Sync.pluginPlan({}, { ["e2e.koplugin"] = { managed = true, sha256 = psha }, ["koligilo.koplugin"] = { managed = false } })
check("wtyczki: pusty stan docelowy → usuń tylko zarządzaną", #pempty.remove == 1 and pempty.remove[1].dir == "e2e.koplugin")

-- TASK-13: czytnik wysyła ręcznie zainstalowaną wtyczkę na serwer; nie
-- trafia nigdzie bez akceptacji admina w panelu.
os.execute("mkdir -p " .. sh_quote(ptmp .. "/kopad.koplugin"))
mf = io.open(ptmp .. "/kopad.koplugin/_meta.lua", "w"); mf:write('return { name = "kopad", version = "9.9" }\n'); mf:close()
mf = io.open(ptmp .. "/kopad.koplugin/main.lua", "w"); mf:write("return {}\n"); mf:close()
os.execute("cd " .. sh_quote(ptmp) .. " && zip -qr kopad.zip kopad.koplugin")
local devup = J.decode(run("curl -s -H " .. sh_quote("Authorization: Bearer " .. kobo.token)
    .. " -H 'Content-Type: application/zip' --data-binary @" .. sh_quote(ptmp .. "/kopad.zip")
    .. " " .. sh_quote(SERVER .. "/api/v1/plugins")))
local dsha = devup and devup.plugin and devup.plugin.sha256
check("wtyczki z urządzenia: upload przyjęty, approved=false", dsha and #dsha == 64
    and devup.plugin.source == "urządzenie" and devup.plugin.approved == false, devup and devup.error)
check("wtyczki z urządzenia: przypisanie przed akceptacją odrzucone", (http("POST", "/api/admin/devices/" .. bigme.id .. "/plugins",
    ADMIN, { plugins = { ["kopad.koplugin"] = dsha } })) == 400)
check("wtyczki z urządzenia: zły token przy uploadzie → 401", tonumber(run("curl -s -o /dev/null -w '%{http_code}' -H "
    .. sh_quote("Authorization: Bearer zly-token") .. " -H 'Content-Type: application/zip' --data-binary @"
    .. sh_quote(ptmp .. "/kopad.zip") .. " " .. sh_quote(SERVER .. "/api/v1/plugins"))) == 401)
check("wtyczki z urządzenia: akceptacja w panelu", (http("POST", "/api/admin/plugins/" .. dsha .. "/approve", ADMIN)) == 200)
check("wtyczki z urządzenia: przypisanie po akceptacji działa", (http("POST", "/api/admin/devices/" .. bigme.id .. "/plugins",
    ADMIN, { plugins = { ["kopad.koplugin"] = dsha } })) == 200)
local _, bplan = http("GET", "/api/v1/sync?plugins_allowed=1", bigme.token)
local bfound = false
for _i, p in ipairs(bplan.plugins or {}) do if p.dir == "kopad.koplugin" and p.sha256 == dsha then bfound = true end end
check("wtyczki z urządzenia: drugi czytnik ją widzi w sync po akceptacji", bfound, bplan and J.encode(bplan))

os.execute("rm -rf " .. sh_quote(ptmp))

print(string.format("%d ok, %d fail", passed, failed))
os.exit(failed == 0 and 0 or 1)
