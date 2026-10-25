-- Test instalatora wtyczek z main.lua (I/O) poza czytnikiem: moduły KOReadera
-- zastąpione atrapami (lfs/archiver/sha2 przez narzędzia powłoki: unzip,
-- sha256sum, python3 tylko do ZIP-a ze złośliwą nazwą).
--   lua tests/installer_test.lua   (z katalogu repo)
package.path = "plugin/koligilo.koplugin/?.lua;" .. package.path
local Sync = require("sync")

local passed, failed = 0, 0
local function check(name, cond, extra)
    if cond then passed = passed + 1
    else failed = failed + 1; print("FAIL: " .. name .. (extra and (" — " .. tostring(extra)) or "")) end
end

local function q(s) return "'" .. tostring(s):gsub("'", "'\\''") .. "'" end
local function sh(cmd) local ok = os.execute(cmd); return ok == true or ok == 0 end
local function out(cmd) local p = io.popen(cmd); local s = p:read("a"); p:close(); return s end
local function slurp(p) local f = io.open(p, "rb"); if not f then return nil end; local s = f:read("a"); f:close(); return s end
local function spit(p, s) local f = assert(io.open(p, "wb")); f:write(s); f:close() end

local TMP = out("mktemp -d"):gsub("%s+$", "")
local DATA = TMP .. "/data"
local ROOT = DATA .. "/plugins"
sh("mkdir -p " .. q(ROOT) .. " " .. q(TMP .. "/src"))

---------------------------------------------------------------- atrapy KOReadera
local shown = {}
local function widget(kind) return { new = function(_, o) o.kind = kind; return o end } end
local served = {} -- url → treść ZIP-a
local broadcast, broadcast_fail = {}, false
local scheduled = {} -- UIManager:scheduleIn: { secs, f }
local P = package.preload
local reader_ui = {} -- .instance ustawiane z testu: książka otwarta (true) / menedżer plików (nil)
P["apps/reader/readerui"] = function() return reader_ui end
P["ui/event"] = function() return { new = function(_, name) return { name = name } end } end
P["ui/widget/confirmbox"] = function() return widget("confirm") end
P["ui/widget/infomessage"] = function() return widget("info") end
P["ui/widget/inputdialog"] = function() return widget("input") end
P["datastorage"] = function() return { getDataDir = function() return DATA end, getSettingsDir = function() return DATA end } end
P["device"] = function() return { model = "Test" } end
P["json"] = function() return { encode = function() return "{}" end, decode = function() return {} end } end
P["luasettings"] = function() return {} end
local online = true
P["ui/network/manager"] = function() return { runWhenOnline = function(_, f) f() end, isOnline = function() return online end } end
P["ui/uimanager"] = function() return {
    show = function(_, w) shown[#shown + 1] = w end, close = function() end, forceRePaint = function() end,
    broadcastEvent = function(_, e) if broadcast_fail then error("boom") end; broadcast[#broadcast + 1] = e.name end,
    nextTick = function() end,
    scheduleIn = function(_, secs, f) scheduled[#scheduled + 1] = { secs = secs, f = f } end, askForRestart = function(_, t) shown[#shown + 1] = { kind = "restart", text = t } end,
} end
P["ui/widget/container/widgetcontainer"] = function() return { extend = function(_, o) return o end } end
local requested = {} -- adresy żądań HTTP, po kolei
P["socket.http"] = function() return { request = function(req)
    requested[#requested + 1] = req.url
    local body = served[req.url]
    if not body then return 1, 404, {}, "404" end
    req.sink(body); req.sink(nil)
    return 1, 200, { ["x-koligilo-sha256"] = "?" }, "200 OK"
end } end
P["socket"] = function() return { skip = function(n, ...) return select(n + 1, ...) end } end
P["socketutil"] = function() return { set_timeout = function() end, reset_timeout = function() end } end
P["ltn12"] = function() return {
    sink = { table = function(t) return function(c) if c then t[#t + 1] = c end; return 1 end end },
    source = { string = function(str) return str end },
} end
P["logger"] = function() return { warn = function() end } end
P["gettext"] = function() return function(s) return s end end
P["libs/libkoreader-lfs"] = function() return {
    attributes = function(p, what)
        if what == "size" then
            local n = tonumber(out("stat -c %s " .. q(p) .. " 2>/dev/null"))
            return n
        end
        if sh("test -L " .. q(p)) then return "link" end
        if sh("test -d " .. q(p)) then return "directory" end
        if sh("test -f " .. q(p)) then return "file" end
        return nil
    end,
    dir = function(p) return out("ls -a " .. q(p)):gmatch("[^\n]+") end,
} end
P["ffi/util"] = function() return {
    template = function(s, ...) local a = { ... }; return (s:gsub("%%(%d)", function(i) return tostring(a[tonumber(i)]) end)) end,
    purgeDir = function(p) sh("rm -rf " .. q(p)) end,
    realpath = function(p) local r = out("realpath -m " .. q(p) .. " 2>/dev/null"):gsub("%s+$", ""); return r ~= "" and r or nil end,
} end
P["util"] = function() return { makePath = function(p) return sh("mkdir -p " .. q(p)) end } end
P["ffi/sha2"] = function() return { sha256 = function(s)
    local f = TMP .. "/sha.in"; spit(f, s)
    return out("sha256sum " .. q(f)):match("^(%x+)")
end } end
-- Archiver.Reader na unzip: typ wpisu z atrybutów (l = link)
P["ffi/archiver"] = function()
    local Reader = {}
    Reader.__index = Reader
    function Reader.new() return setmetatable({}, Reader) end
    function Reader:open(path)
        self.path, self.list = path, {}
        for line in out("unzip -Z " .. q(path) .. " 2>/dev/null"):gmatch("[^\n]+") do
            local attr, name = line:match("^(%S+)%s+%S+%s+%S+%s+%S+%s+%S+%s+%S+%s+%S+%s+%S+%s+(.+)$")
            if attr and #attr == 10 then
                local mode = attr:sub(1, 1) == "l" and "link" or (name:sub(-1) == "/" and "directory" or "file")
                self.list[#self.list + 1] = { path = name, mode = mode, size = 1 }
            end
        end
        return #self.list > 0 or nil
    end
    function Reader:iterate() local i = 0; return function() i = i + 1; return self.list[i] end end
    function Reader:extractToPath(key, dest) return sh("unzip -p " .. q(self.path) .. " " .. q(key) .. " > " .. q(dest)) end
    function Reader:close() end
    -- Writer na zip: pliki zbierane w katalogu roboczym, spakowane przy close()
    -- (TASK-13, Koligilo:packPlugin).
    local Writer = {}
    Writer.__index = Writer
    function Writer.new() return setmetatable({}, Writer) end
    function Writer:open(path)
        self.path = path
        self.stage = TMP .. "/wrstage-" .. tostring(os.time()) .. "-" .. tostring(math.random(1e6))
        sh("rm -rf " .. q(self.stage) .. " && mkdir -p " .. q(self.stage))
        return true
    end
    function Writer:addFileFromMemory(entry_path, content)
        local full = self.stage .. "/" .. entry_path
        local dir = full:match("^(.*)/[^/]*$")
        if dir then sh("mkdir -p " .. q(dir)) end
        spit(full, content)
        return true
    end
    function Writer:close()
        if self.stage then sh("cd " .. q(self.stage) .. " && zip -qry " .. q(self.path) .. " *") end
    end
    return { Reader = Reader, Writer = Writer }
end

local Koligilo = dofile("plugin/koligilo.koplugin/main.lua")
-- BEZPIECZNIK: samoaktualizacja podmienia katalog pluginu na dysku. Wczytany z repo main.lua
-- uważa, że mieszka w ./plugin/ — bez tego test nadpisałby prawdziwy plugin atrapą.
-- Sandbox ustawiamy na poziomie klasy, zanim cokolwiek zostanie wywołane.
Koligilo.selfParent, Koligilo.selfVersion = TMP .. "/selfroot", "0.8.0"
local settings_data = { server = "http://srv", token = "tok" }
local K = setmetatable({ settings = {
    readSetting = function(_, k) return settings_data[k] end,
    saveSetting = function(_, k, v) settings_data[k] = v end,
    delSetting = function(_, k) settings_data[k] = nil end,
    makeTrue = function(_, k) settings_data[k] = true end,
    flush = function() end, isTrue = function(_, k) return settings_data[k] == true end,
    nilOrTrue = function(_, k) return settings_data[k] == nil or settings_data[k] == true end,
} }, { __index = Koligilo })

---------------------------------------------------------------- ZIP-y testowe
local function make_zip(dir, version, extra)
    local src = TMP .. "/src/" .. dir .. "-" .. version
    sh("rm -rf " .. q(src) .. " && mkdir -p " .. q(src .. "/" .. dir))
    spit(src .. "/" .. dir .. "/_meta.lua", 'return { name = "' .. dir:gsub("%.koplugin", "") .. '", version = "' .. version .. '" }\n')
    spit(src .. "/" .. dir .. "/main.lua", "-- " .. version .. "\nreturn {}\n")
    if extra then extra(src) end
    local z = src .. ".zip"
    sh("cd " .. q(src) .. " && zip -qry " .. q(z) .. " " .. q(dir))
    local body = slurp(z)
    local sha = out("sha256sum " .. q(z)):match("^(%x+)")
    served["http://srv/api/v1/plugins/" .. sha .. ".zip"] = body
    return { dir = dir, sha256 = sha, name = dir:gsub("%.koplugin", ""), version = version,
        url = "/api/v1/plugins/" .. sha .. ".zip" }
end
local function main_of(dir) return slurp(ROOT .. "/" .. dir .. "/main.lua") end
local function no_leftovers() return out("ls -a " .. q(ROOT) .. " | grep '^\\.koligilo-' || true") == "" end

local Archiver = require("ffi/archiver")

-- 1) instalacja
local foo1 = make_zip("foo.koplugin", "1.0")
local ok, err = K:applyPluginOp("install", foo1, Archiver)
check("install ok", ok, err)
check("install: pliki na miejscu", (main_of("foo.koplugin") or ""):find("1.0"))
local mk = Sync.markerDecode(slurp(ROOT .. "/foo.koplugin/.koligilo"))
check("install: znacznik z sha256", mk.sha256 == foo1.sha256 and mk.version == "1.0")
check("install: brak katalogów roboczych", no_leftovers())

-- 2) zła suma sha256: stara wersja nietknięta
local foo2 = make_zip("foo.koplugin", "2.0")
local bad = {}; for k, v in pairs(foo2) do bad[k] = v end
bad.sha256 = ("0"):rep(64)
ok, err = K:applyPluginOp("update", bad, Archiver)
check("zła sha: odmowa", not ok and tostring(err):find("sha256"), err)
check("zła sha: stara wersja nietknięta", (main_of("foo.koplugin") or ""):find("1.0")
    and Sync.markerDecode(slurp(ROOT .. "/foo.koplugin/.koligilo")).sha256 == foo1.sha256)
check("zła sha: brak śmieci", no_leftovers())

-- 3) aktualizacja
ok, err = K:applyPluginOp("update", foo2, Archiver)
check("update ok", ok, err)
check("update: nowa wersja", (main_of("foo.koplugin") or ""):find("2.0"))
check("update: stara usunięta, brak śmieci", no_leftovers())

-- 4) zip-slip i link: odmowa bez zmian
local evil = make_zip("evil.koplugin", "1.0")
local ez = TMP .. "/evil.zip"
sh("python3 -c " .. q([[
import zipfile,sys
z=zipfile.ZipFile(sys.argv[1],'w')
z.writestr('evil.koplugin/_meta.lua','return {}')
z.writestr('evil.koplugin/main.lua','return {}')
z.writestr('evil.koplugin/../../pwned.lua','x')
z.close()]]) .. " " .. q(ez))
local eb = slurp(ez)
evil.sha256 = out("sha256sum " .. q(ez)):match("^(%x+)")
evil.url = "/api/v1/plugins/" .. evil.sha256 .. ".zip"
served["http://srv" .. evil.url] = eb
ok, err = K:applyPluginOp("install", evil, Archiver)
check("zip-slip: odmowa", not ok and tostring(err):find("ścieżka"), err)
check("zip-slip: nic nie powstało", not sh("test -e " .. q(ROOT .. "/evil.koplugin")) and not sh("test -e " .. q(DATA .. "/pwned.lua"))
    and not sh("test -e " .. q(TMP .. "/pwned.lua")) and no_leftovers())
local lnk = make_zip("lnk.koplugin", "1.0", function(src) sh("ln -s /etc/passwd " .. q(src .. "/lnk.koplugin/x")) end)
ok, err = K:applyPluginOp("install", lnk, Archiver)
check("link w ZIP-ie: odmowa", not ok and tostring(err):find("typ"), err)

-- 5) ręczne katalogi są nietykalne
sh("mkdir -p " .. q(ROOT .. "/reczna.koplugin") .. " && echo 'return {version=\"9\", fullname = _(\"Ręczna wtyczka\")}' > " .. q(ROOT .. "/reczna.koplugin/_meta.lua"))
ok, err = K:applyPluginOp("remove", { dir = "reczna.koplugin" }, Archiver)
check("remove bez znacznika: odmowa", not ok and sh("test -d " .. q(ROOT .. "/reczna.koplugin")), err)
local rz = make_zip("reczna.koplugin", "1.0")
ok = K:applyPluginOp("install", rz, Archiver)
check("install na ręczny katalog: odmowa", not ok and slurp(ROOT .. "/reczna.koplugin/_meta.lua"):find("9"))
ok = K:applyPluginOp("update", rz, Archiver)
check("update ręcznego: odmowa", not ok and not sh("test -e " .. q(ROOT .. "/reczna.koplugin/main.lua")))
sh("mkdir -p " .. q(ROOT .. "/koligilo.koplugin") .. " && touch " .. q(ROOT .. "/koligilo.koplugin/.koligilo"))
ok = K:applyPluginOp("remove", { dir = "koligilo.koplugin" }, Archiver)
check("koligilo.koplugin nigdy", not ok and sh("test -d " .. q(ROOT .. "/koligilo.koplugin")))

-- 6) inwentarz
local inv = K:pluginInventory()
check("inwentarz: foo zarządzana z sha", inv["foo.koplugin"] and inv["foo.koplugin"].managed and inv["foo.koplugin"].sha256 == foo2.sha256
    and inv["foo.koplugin"].version == "2.0")
check("inwentarz: ręczna niezarządzana, wersja z _meta", inv["reczna.koplugin"] and not inv["reczna.koplugin"].managed
    and inv["reczna.koplugin"].version == "9")
check("inwentarz: fullname z _meta (gettext) idzie do panelu", inv["reczna.koplugin"] and inv["reczna.koplugin"].fullname == "Ręczna wtyczka")
check("inwentarz: koligilo niezarządzany mimo znacznika", inv["koligilo.koplugin"] and not inv["koligilo.koplugin"].managed)
-- pochodzenie (TASK-43): katalog wbudowanych różny od katalogu danych
check("origin: ręczna w katalogu danych = manual", inv["reczna.koplugin"].origin == "manual")
check("origin: zarządzana = puste", inv["foo.koplugin"].origin == nil)
local BI = TMP .. "/builtin"
sh("mkdir -p " .. q(BI .. "/calibre.koplugin") .. " " .. q(BI .. "/reczna.koplugin"))
spit(BI .. "/calibre.koplugin/_meta.lua", 'return { name = "calibre", fullname = "Calibre", version = "1" }')
spit(BI .. "/reczna.koplugin/_meta.lua", 'return { name = "reczna", version = "0" }')
K.BUILTIN_PLUGINS_DIR = BI
local inv_o = K:pluginInventory()
check("origin: tylko w instalacji = builtin", inv_o["calibre.koplugin"] and inv_o["calibre.koplugin"].origin == "builtin")
check("origin: kopia w instalacji i danych = manual", inv_o["reczna.koplugin"].origin == "manual")
check("origin: zarządzana nadal puste", inv_o["foo.koplugin"].origin == nil)
K.BUILTIN_PLUGINS_DIR = ROOT -- ten sam katalog co dane (Kindle/Kobo): pochodzenia nie da się ustalić
local inv_s = K:pluginInventory()
check("origin: wspólny katalog = puste", inv_s["reczna.koplugin"].origin == nil and inv_s["foo.koplugin"].origin == nil)
K.BUILTIN_PLUGINS_DIR = nil -- wraca wartość z klasy

-- 7) handlePlugins: bez potwierdzenia nic się nie zmienia; odmowa → rejected
local bar = make_zip("bar.koplugin", "1.0")
local target = { foo2, bar } -- foo aktualna, bar do instalacji
shown = {}
local showed = K:handlePlugins(target, K:pluginInventory(), false, 0)
local box = shown[1]
check("potwierdzenie pokazane", showed and box and box.kind == "confirm" and box.text:find("bar 1.0", 1, true), box and box.text)
check("przed zgodą nic nie zainstalowano", not sh("test -e " .. q(ROOT .. "/bar.koplugin")))
box.cancel_callback()
check("odmowa: nic nie zainstalowano", not sh("test -e " .. q(ROOT .. "/bar.koplugin")))
local pend = settings_data.plugin_results or {}
check("odmowa: wynik rejected", #pend == 1 and pend[1].status == "rejected" and pend[1].dir == "bar.koplugin")
check("odmowa: w tle nie pytamy drugi raz", K:handlePlugins(target, K:pluginInventory(), true, 0) == false)
settings_data.plugin_results = nil

shown = {}
K:handlePlugins(target, K:pluginInventory(), false, 0)
shown[1].ok_callback()
check("zgoda: zainstalowano", (main_of("bar.koplugin") or ""):find("1.0"))
pend = settings_data.plugin_results or {}
check("zgoda: wynik ok", #pend == 1 and pend[1].status == "ok" and pend[1].action == "install", pend[1] and pend[1].error)
check("zgoda: prośba o restart", shown[#shown].kind == "restart")
settings_data.plugin_results = nil

-- 8) usunięcie z listy → usuwamy tylko zarządzane, po zgodzie
shown = {}
K:handlePlugins({}, K:pluginInventory(), false, 0)
check("remove: w oknie tylko zarządzane", shown[1].text:find("foo.koplugin", 1, true) and shown[1].text:find("bar.koplugin", 1, true)
    and not shown[1].text:find("reczna", 1, true) and not shown[1].text:find("koligilo.koplugin", 1, true))
shown[1].ok_callback()
check("remove: zarządzane usunięte", not sh("test -e " .. q(ROOT .. "/foo.koplugin")) and not sh("test -e " .. q(ROOT .. "/bar.koplugin")))
check("remove: ręczne i koligilo zostały", sh("test -d " .. q(ROOT .. "/reczna.koplugin")) and sh("test -d " .. q(ROOT .. "/koligilo.koplugin")))

-- 9) brak stanu od serwera: nic
shown = {}
check("target nil: bez okna", K:handlePlugins(nil, K:pluginInventory(), false, 0) == false and #shown == 0)

-- 10) TASK-13: wysyłka wtyczki na serwer — pakowanie pomija symlinki i .koligilo
sh("mkdir -p " .. q(ROOT .. "/kopad.koplugin/lib"))
spit(ROOT .. "/kopad.koplugin/_meta.lua", 'return { name = "kopad", version = "3.0" }\n')
spit(ROOT .. "/kopad.koplugin/main.lua", "return {}\n")
spit(ROOT .. "/kopad.koplugin/lib/x.lua", "return 1\n")
spit(ROOT .. "/kopad.koplugin/.koligilo", "sha256=" .. ("a"):rep(64) .. "\n") -- nie powinien trafić do ZIP-a
sh("ln -s /etc/passwd " .. q(ROOT .. "/kopad.koplugin/lib/link"))

local sendable_names = {}
for _i, d in ipairs(K:sendableInventory()) do sendable_names[d] = true end
check("sendable: widzi kopad", sendable_names["kopad.koplugin"])
check("sendable: nie widzi koligilo.koplugin", not sendable_names["koligilo.koplugin"])
local pack_list = K:pluginPackList("kopad.koplugin")
local pl = {}
for _i, p in ipairs(pack_list) do pl[p] = true end
check("packList: pliki właściwe", pl["_meta.lua"] and pl["main.lua"] and pl["lib/x.lua"])
check("packList: bez symlinku i bez .koligilo", not pl[".koligilo"] and not pl["lib/link"])

local body, perr = K:packPlugin(Archiver, "kopad.koplugin")
check("packPlugin: zwraca treść ZIP-a", body ~= nil, perr)
check("packPlugin: brak śmieci roboczych", no_leftovers())
if body then
    local zp = TMP .. "/sent.zip"
    spit(zp, body)
    local names = out("unzip -Z1 " .. q(zp) .. " 2>/dev/null")
    check("packPlugin: ZIP zawiera pliki wtyczki", names:find("kopad.koplugin/main.lua", 1, true)
        and names:find("kopad.koplugin/lib/x.lua", 1, true), names)
    check("packPlugin: ZIP nie zawiera symlinku ani znacznika", not names:find("lib/link", 1, true)
        and not names:find("kopad.koplugin/.koligilo", 1, true), names)
end

---------------------------------------------------------------- czcionki (TASK-36, PC-018)
local FDIR = DATA .. "/fonts/koligilo"
local function sha_of(body) local f = TMP .. "/fsha.in"; spit(f, body); return out("sha256sum " .. q(f)):match("^(%x+)") end
local function serve_font(file, body)
    local sha = sha_of(body)
    served["http://srv/api/v1/fonts/" .. sha] = body
    return { file = file, sha256 = sha, size = #body, url = "/api/v1/fonts/" .. sha }
end
local TTF = "\0\1\0\0" .. ("x"):rep(200)
local ftA = serve_font("Charis.ttf", TTF .. "A")
local ftB = serve_font("Gentium Book.otf", "OTTO" .. ("y"):rep(200))
sh("mkdir -p " .. q(DATA .. "/fonts"))
spit(DATA .. "/fonts/Reczna.ttf", TTF .. "R")           -- ręcznie dodana, w katalogu głównym
spit(DATA .. "/fonts/Za-mala.ttf", "short")             -- za mała, by ją wysłać
sh("mkdir -p " .. q(FDIR))
spit(FDIR .. "/Obca.ttf", TTF .. "O")                   -- w naszym katalogu, ale nie z manifestu

local r = K:handleFonts({ ftA, ftB })
check("font: instalacja dwóch", r.n == 2 and #r.failures == 0, table.concat(r.failures, "; "))
check("font: pliki na miejscu", slurp(FDIR .. "/Charis.ttf") == TTF .. "A" and slurp(FDIR .. "/Gentium Book.otf") ~= nil)
local mfont = Sync.fontManifestDecode(slurp(FDIR .. "/" .. Sync.FONT_MANIFEST))
check("font: manifest zawiera tylko zainstalowane", mfont["Charis.ttf"] == ftA.sha256 and mfont["Gentium Book.otf"] == ftB.sha256 and mfont["Obca.ttf"] == nil)
check("font: brak plików roboczych", out("ls -a " .. q(FDIR) .. " | grep '\\.new$' || true") == "")
local inv = K:fontInventory()
check("font: inwentarz", #inv == 2 and inv[1].file == "Charis.ttf" and inv[2].file == "Gentium Book.otf")

-- ponowna synchronizacja bez zmian nic nie robi
check("font: bez zmian", K:handleFonts({ ftA, ftB }).n == 0)

-- konflikt z plikiem obcym w naszym katalogu
local ftObca = serve_font("Obca.ttf", TTF .. "N")
r = K:handleFonts({ ftA, ftB, ftObca })
check("font: konflikt nie nadpisuje", r.n == 0 and slurp(FDIR .. "/Obca.ttf") == TTF .. "O")

-- zła suma: nic nie zapisane, stary plik nietknięty
local ftA2 = serve_font("Charis.ttf", TTF .. "A2")
local badf = {}; for k, v in pairs(ftA2) do badf[k] = v end
badf.sha256 = ("0"):rep(64)
r = K:handleFonts({ badf, ftB })
check("font: zła suma — błąd", r.n == 0 and #r.failures == 1 and r.failures[1]:find("sha256"), r.failures[1])
check("font: zła suma — stary plik nietknięty", slurp(FDIR .. "/Charis.ttf") == TTF .. "A")
check("font: zła suma — brak śmieci", out("ls -a " .. q(FDIR) .. " | grep '\\.new$' || true") == "")

-- poprawna suma, ale to nie czcionka (np. strona HTML z proxy)
local html = "<html>" .. ("z"):rep(200)
local ftH = serve_font("Html.ttf", html)
r = K:handleFonts({ ftA, ftB, ftH })
check("font: nie-czcionka odrzucona", r.n == 0 and #r.failures == 1 and slurp(FDIR .. "/Html.ttf") == nil)

-- aktualizacja
r = K:handleFonts({ ftA2, ftB })
check("font: update", r.n == 1 and slurp(FDIR .. "/Charis.ttf") == TTF .. "A2"
    and Sync.fontManifestDecode(slurp(FDIR .. "/" .. Sync.FONT_MANIFEST))["Charis.ttf"] == ftA2.sha256)

-- usunięcie: tylko to, co w manifeście
r = K:handleFonts({ ftB })
check("font: usunięcie zarządzanej", r.n == 1 and slurp(FDIR .. "/Charis.ttf") == nil)
r = K:handleFonts({})
check("font: pusty cel czyści manifest", r.n == 1 and slurp(FDIR .. "/Gentium Book.otf") == nil
    and next(Sync.fontManifestDecode(slurp(FDIR .. "/" .. Sync.FONT_MANIFEST))) == nil)
check("font: ręcznych nie ruszamy", slurp(FDIR .. "/Obca.ttf") == TTF .. "O" and slurp(DATA .. "/fonts/Reczna.ttf") == TTF .. "R")
check("font: pusty inwentarz", #K:fontInventory() == 0)

-- niedozwolona nazwa i wysyłka
ok, err = K:applyFontOp("install", { file = "../x.ttf", sha256 = ftA.sha256, url = ftA.url }, {})
check("font: ścieżka w nazwie odrzucona", not ok)
local sf = K:sendableFonts()
check("font: do wysłania tylko Reczna.ttf", #sf == 1 and sf[1].file == "Reczna.ttf", #sf)

-- 11) TASK-39: samoaktualizacja koligilo (osobna ścieżka; applyPluginOp dalej odmawia — test 6)
local SELF = TMP .. "/selfroot"
local SELFDIR = SELF .. "/koligilo.koplugin"
local function self_leftovers() return out("ls -a " .. q(SELF) .. " | grep '^\\.koligilo-' || true") end
local function self_install(version)
    sh("rm -rf " .. q(SELF) .. " && mkdir -p " .. q(SELFDIR))
    spit(SELFDIR .. "/_meta.lua", 'return { name = "koligilo", version = "' .. version .. '" }\n')
    spit(SELFDIR .. "/main.lua", "-- stary\nreturn {}\n")
    spit(SELFDIR .. "/sync.lua", "-- stary\nreturn {}\n")
    spit(SELFDIR .. "/ustawienie-gracza.txt", "nie powinno przeżyć podmiany katalogu\n")
end
-- zip jak serwerowy: sam katalog koligilo.koplugin; sha liczony z bajtów zipa
local function self_zip(version, tweak, meta_version)
    local src = TMP .. "/src/self-" .. version
    sh("rm -rf " .. q(src) .. " && mkdir -p " .. q(src .. "/koligilo.koplugin"))
    spit(src .. "/koligilo.koplugin/_meta.lua", 'return { name = "koligilo", version = "' .. (meta_version or version) .. '" }\n')
    spit(src .. "/koligilo.koplugin/main.lua", "-- nowy " .. version .. "\nreturn {}\n")
    spit(src .. "/koligilo.koplugin/sync.lua", "-- nowy " .. version .. "\nreturn {}\n")
    if tweak then tweak(src .. "/koligilo.koplugin") end
    local z = src .. ".zip"
    sh("rm -f " .. q(z) .. " && cd " .. q(src) .. " && zip -qry " .. q(z) .. " koligilo.koplugin")
    local body = slurp(z)
    served["http://srv/koligilo.koplugin.zip"] = body
    return { version = version, sha256 = out("sha256sum " .. q(z)):match("^(%x+)"), url = "/koligilo.koplugin.zip", size = #body }
end
check("self: test działa w sandboksie, nie na prawdziwym pluginie", K.selfParent == SELF and K.selfParent:find(TMP, 1, true) == 1)

self_install("0.8.0")
local up = self_zip("0.9.0")
ok, err = K:applySelfUpdate(up, Archiver)
check("self: aktualizacja ok", ok, err)
check("self: nowe pliki", (slurp(SELFDIR .. "/main.lua") or ""):find("nowy 0.9.0", 1, true) and (slurp(SELFDIR .. "/sync.lua") or ""):find("nowy 0.9.0", 1, true))
check("self: stara wersja czeka w .koligilo-old-koligilo", (slurp(SELF .. "/.koligilo-old-koligilo/main.lua") or ""):find("stary", 1, true))
check("self: brak plików roboczych poza kopią starej", self_leftovers() == ".koligilo-old-koligilo\n", self_leftovers())

-- sprzątanie po starcie nowej wersji (init) usuwa kopię; po aktualizacji w tym samym procesie — jeszcze nie
K:cleanupSelfUpdate()
check("self: init sprząta kopię starej wersji", self_leftovers() == "", self_leftovers())

-- zła suma: nic nie ruszone
self_install("0.8.0")
local bad_up = self_zip("0.9.0"); bad_up.sha256 = ("0"):rep(64)
ok, err = K:applySelfUpdate(bad_up, Archiver)
check("self: zła suma — odmowa", not ok and tostring(err):find("sha256"), err)
check("self: zła suma — stara wersja nietknięta, brak śmieci", (slurp(SELFDIR .. "/main.lua") or ""):find("stary", 1, true) and self_leftovers() == "")

-- błąd składni w main.lua: odmowa przed podmianą (czytnik nie zostaje bez koligilo)
local broken = self_zip("0.9.1", function(d) spit(d .. "/main.lua", "to nie jest lua ((\n") end)
ok, err = K:applySelfUpdate(broken, Archiver)
check("self: błąd składni — odmowa", not ok and tostring(err):find("składni"), err)
check("self: błąd składni — stara wersja nietknięta", (slurp(SELFDIR .. "/main.lua") or ""):find("stary", 1, true) and self_leftovers() == "")

-- brakujący plik
local missing = self_zip("0.9.2", function(d) os.remove(d .. "/sync.lua") end)
ok, err = K:applySelfUpdate(missing, Archiver)
check("self: brak sync.lua — odmowa", not ok and tostring(err):find("sync.lua"), err)

-- wersja w pliku inna niż zapowiedziana
local liar = self_zip("0.9.3", nil, "0.7.0")
ok, err = K:applySelfUpdate(liar, Archiver)
check("self: wersja w pliku ≠ zapowiedziana — odmowa", not ok and tostring(err):find("zapowiedzian"), err)
check("self: kłamca — stara wersja nietknięta", (slurp(SELFDIR .. "/main.lua") or ""):find("stary", 1, true) and self_leftovers() == "")

-- downgrade i ta sama wersja
ok, err = K:applySelfUpdate(self_zip("0.7.0"), Archiver)
check("self: downgrade — odmowa", not ok and tostring(err):find("nowsza"), err)
ok, err = K:applySelfUpdate(self_zip("0.8.0"), Archiver)
check("self: ta sama wersja — odmowa", not ok)

-- zip-slip i link w ZIP-ie przechodzą przez te same sprawdzenia co wtyczki
local slip = self_zip("0.9.4", function(d) sh("ln -s /etc/passwd " .. q(d .. "/link")) end)
ok, err = K:applySelfUpdate(slip, Archiver)
check("self: link w ZIP-ie — odmowa", not ok and tostring(err):find("typ"), err)

-- nieznany katalog / wersja (ręczna kopia): bez zgadywania
local keep_parent = K.selfParent
K.selfParent = false -- nil odsłoniłby wartość z klasy (sandbox)
ok, err = K:applySelfUpdate(self_zip("0.9.0"), Archiver)
check("self: nieznane położenie — odmowa", not ok and tostring(err):find("ręcznie"), err)
K.selfParent = keep_parent

-- okno potwierdzenia: bez zgody nic się nie dzieje, odmowa pamiętana, zgoda instaluje i prosi o restart
self_install("0.8.0")
local up2 = self_zip("0.9.0")
shown = {}
check("self: starsza/ta sama wersja — bez okna", K:handleSelfUpdate({ version = "0.8.0", sha256 = up2.sha256, url = up2.url, size = up2.size }, false, 0) == false and #shown == 0)
check("self: wadliwe wskazanie (zły url) — bez okna", K:handleSelfUpdate({ version = "0.9.0", sha256 = up2.sha256, url = "http://evil/x.zip", size = 10 }, false, 0) == false and #shown == 0)
check("self: wadliwe wskazanie (zła suma) — bez okna", K:handleSelfUpdate({ version = "0.9.0", sha256 = "zz", url = up2.url, size = 10 }, false, 0) == false and #shown == 0)
local showed2 = K:handleSelfUpdate(up2, false, 0)
local box2 = shown[1]
check("self: okno z numerami wersji", showed2 and box2 and box2.kind == "confirm" and box2.text:find("0.8.0 → 0.9.0", 1, true), box2 and box2.text)
check("self: przed zgodą nic nie zmienione", (slurp(SELFDIR .. "/main.lua") or ""):find("stary", 1, true))
box2.cancel_callback()
check("self: odmowa zapamiętana", settings_data.self_update_rejected == "0.9.0")
shown = {}
check("self: odrzuconej wersji w tle nie pytamy ponownie", K:handleSelfUpdate(up2, true, 0) == false and #shown == 0)
shown = {}
check("self: ręczna synchronizacja pyta znowu", K:handleSelfUpdate(up2, false, 0) == true)
shown[1].ok_callback()
check("self: zgoda — zainstalowano", (slurp(SELFDIR .. "/main.lua") or ""):find("nowy 0.9.0", 1, true))
check("self: zgoda — prośba o restart", shown[#shown].kind == "restart" and shown[#shown].text:find("0.9.0", 1, true), shown[#shown].text)
check("self: zgoda czyści pamięć odmowy", settings_data.self_update_rejected == nil)
-- po podmianie ten proces nie sprząta kopii starej wersji (nowa jeszcze nie wystartowała)
K:cleanupSelfUpdate()
check("self: w tym samym procesie kopia starej wersji zostaje", self_leftovers() == ".koligilo-old-koligilo\n", self_leftovers())
-- i nie pozwala już na kolejne okna ani synchronizację (stare pliki w pamięci, nowe na dysku)
shown = {}
check("self: po podmianie brak kolejnych okien", K:handleSelfUpdate(self_zip("0.9.5"), false, 0) == false and #shown == 0)

-- scalanie wspólnych baz po synchronizacji (TASK-42)
settings_data.merge_after_sync = nil
K:mergeSharedData(0)
check("merge: bez zgody żadne zdarzenie", #broadcast == 0)
settings_data.merge_after_sync = true
K:mergeSharedData(2)
check("merge: po zmianie ustawień czeka na restart", #broadcast == 0)
K:mergeSharedData(0)
check("merge: za zgodą — statystyki i słowniczek, po kolei", #broadcast == 2 and broadcast[1] == "SyncBookStats" and broadcast[2] == "SyncVocabBuilder")
broadcast_fail = true
check("merge: wyjątek w cudzej wtyczce nie wychodzi na zewnątrz", pcall(K.mergeSharedData, K, 0))
broadcast_fail = false
settings_data.merge_after_sync = nil

-- pobieranie artykułów Wallabag po synchronizacji (TASK-45): tylko poza książką
local function wb(changed) broadcast = {}; return K:wallabagAfterSync(changed), broadcast end
settings_data.wallabag_after_sync, reader_ui.instance = nil, nil
check("wallabag: bez zgody nic", wb(0) == false and #broadcast == 0)
settings_data.wallabag_after_sync = true
reader_ui.instance = {}
check("wallabag: w trakcie czytania nic (bez kolejkowania)", wb(0) == false and #broadcast == 0)
reader_ui.instance = nil
check("wallabag: po zmianie ustawień czeka", wb(2) == false and #broadcast == 0)
local sent, ev = wb(0)
check("wallabag: za zgodą w menedżerze plików — jedno zdarzenie", sent == true and #ev == 1 and ev[1] == "SynchronizeWallabag")
broadcast_fail = true
check("wallabag: wyjątek nie wychodzi na zewnątrz", pcall(K.wallabagAfterSync, K, 0) and K:wallabagAfterSync(0) == false)
broadcast_fail = false
settings_data.wallabag_after_sync = nil

-- cicha synchronizacja po wybudzeniu (TASK-44)
local synced = 0
K.sync = function(_, silent) if silent then synced = synced + 1 end end
local function resume_scheduled() local n = #scheduled; K:onResume(); return #scheduled - n end
settings_data.last_sync, settings_data.auto_sync, online = nil, nil, true
check("resume: bez last_sync nic nie planuje", resume_scheduled() == 0)
settings_data.last_sync = os.time() - 60
check("resume: przed progiem nic nie planuje", resume_scheduled() == 0)
settings_data.last_sync = os.time() - 3600
online = false
check("resume: bez sieci nic nie planuje (i nie włącza Wi-Fi)", resume_scheduled() == 0)
online = true
settings_data.auto_sync = false
check("resume: auto_sync wyłączone — nic nie planuje", resume_scheduled() == 0)
settings_data.auto_sync = nil
local tok = settings_data.token; settings_data.token = nil
check("resume: niesparowany — nic nie planuje", resume_scheduled() == 0)
settings_data.token = tok
check("resume: spełnione warunki planują jedno wywołanie z opóźnieniem", resume_scheduled() == 1 and scheduled[#scheduled].secs > 0)
check("resume: kolejne wybudzenie w oczekiwaniu nie dubluje", resume_scheduled() == 0)
online = false
scheduled[#scheduled].f()
check("resume: po zwłoce bez sieci synchronizacja nie rusza", synced == 0)
online = true
check("resume: po zwłoce znów można zaplanować", resume_scheduled() == 1)
scheduled[#scheduled].f()
check("resume: po zwłoce cicha synchronizacja", synced == 1)
K.sync = nil

-- wstrzymana synchronizacja trafia do panelu (TASK-50)
settings_data.sync_blocked = nil
requested = {}
served["http://srv/api/v1/sync?report_only=1&sync_blocked=7"] = "{}"
check("blocked: zgłoszenie przyjęte", K:reportBlocked("http://srv", "tok", 7) == true)
check("blocked: lekkie żądanie report_only", requested[1] == "http://srv/api/v1/sync?report_only=1&sync_blocked=7" and #requested == 1, requested[1])
check("blocked: zapamiętane w ustawieniach", type(settings_data.sync_blocked) == "table" and settings_data.sync_blocked.deleted == 7
    and type(settings_data.sync_blocked.at) == "number")
-- serwer nie odpowiada: zapamiętane zostaje, żeby poszło z najbliższą synchronizacją
settings_data.sync_blocked = nil
check("blocked: błąd sieci = false, wpis zostaje", K:reportBlocked("http://srv", "tok", 9) == false and settings_data.sync_blocked.deleted == 9)
check("blocked: powtórzenie odświeża wpis", K:reportBlocked("http://srv", "tok", 11) == false and settings_data.sync_blocked.deleted == 11)
check("blocked: zła liczba niczego nie zapisuje", K:reportBlocked("http://srv", "tok", 0) == false and settings_data.sync_blocked.deleted == 11)

-- zgody w jednym miejscu (TASK-46)
local menu = {}
K:addToMainMenu(menu)
local top = menu.koligilo.sub_item_table_func()
local consents, direct
for _i, it in ipairs(top) do
    if it.text == "Zgody (co wolno koligilo na tym czytniku)" then consents = it end
    if it.text and (it.text:find("Pozwól") or it.text:find("czcionki") or it.text:find("Scalaj")) and it.checked_func then direct = true end
end
check("zgody: jedna pozycja w menu głównym, bez przełączników na wierzchu", consents and consents.sub_item_table_func and not direct)
local citems = consents and consents.sub_item_table_func() or {}
local keys = {}
for _i, it in ipairs(citems) do
    local k
    for _j, name in ipairs({ "self_update_allowed", "plugins_allowed", "fonts_allowed", "merge_after_sync", "wallabag_after_sync" }) do
        settings_data[name] = true
        if it.checked_func() then k = k or name end
        settings_data[name] = nil
    end
    keys[#keys + 1] = k
end
check("zgody: pięć kluczy ustawień", table.concat(keys, ",") == "self_update_allowed,plugins_allowed,fonts_allowed,merge_after_sync,wallabag_after_sync", table.concat(keys, ","))
-- włączenie nadal wymaga potwierdzenia w ConfirmBox (nic nie włącza się samo)
shown = {}
citems[2].callback(nil)
check("zgody: wtyczki wciąż pytają o zgodę oknem", #shown == 1 and shown[1].kind == "confirm" and not settings_data.plugins_allowed
    and tostring(shown[1].text):find("pełnym dostępem"))
shown[1].ok_callback()
check("zgody: po potwierdzeniu zgoda zapisana", settings_data.plugins_allowed == true)
settings_data.plugins_allowed = nil
-- zgłoszenie w zapytaniu sync (serwer odpowiada 404 → synchronizacja kończy się cicho, ale GET widać)
-- wcześniejszy test samoaktualizacji zostawił restart_pending (upvalue main.lua): zdejmujemy go
for i = 1, 60 do
    local name = debug.getupvalue(Koligilo.sync, i)
    if name == "restart_pending" then debug.setupvalue(Koligilo.sync, i, false) break end
end
local function sync_query(setup)
    settings_data.merge_after_sync, settings_data.sync_blocked, settings_data.wallabag_after_sync = nil, nil, nil
    setup()
    requested = {}
    K:sync(true)
    return requested[1] or ""
end
local base_q = sync_query(function() end)
check("query: zapytanie w ogóle poszło", base_q:find("/api/v1/sync?", 1, true), base_q)
check("query: bez zgody brak merge_after_sync", not base_q:find("merge_after_sync", 1, true))
check("query: bez zgody brak wallabag_after_sync", not base_q:find("wallabag_after_sync", 1, true))
check("query: za zgodą wallabag_after_sync=1", sync_query(function() settings_data.wallabag_after_sync = true end):find("wallabag_after_sync=1", 1, true))
check("query: za zgodą merge_after_sync=1", sync_query(function() settings_data.merge_after_sync = true end):find("merge_after_sync=1", 1, true))
check("query: zapamiętane wstrzymanie idzie w pełnym GET", sync_query(function() settings_data.sync_blocked = { at = 1, deleted = 7 } end):find("sync_blocked=7", 1, true))
check("query: zepsuty wpis wstrzymania nie trafia do zapytania", not sync_query(function() settings_data.sync_blocked = { at = 1, deleted = "x&y" } end):find("sync_blocked", 1, true))
settings_data.merge_after_sync, settings_data.sync_blocked, settings_data.wallabag_after_sync = nil, nil, nil
-- zgoda Wallabag: ConfirmBox z ostrzeżeniem, domyślnie wyłączone, wyłączenie bez okna
shown = {}
citems[5].callback(nil)
check("wallabag menu: włączenie pyta oknem z ostrzeżeniem, nic samo się nie włącza", #shown == 1 and shown[1].kind == "confirm"
    and not settings_data.wallabag_after_sync and tostring(shown[1].text):find("Sync finished", 1, true)
    and tostring(shown[1].text):find("menedżerze plików", 1, true))
shown[1].ok_callback()
check("wallabag menu: po potwierdzeniu zapisane", settings_data.wallabag_after_sync == true)
citems[5].callback(nil)
check("wallabag menu: wyłączenie od razu, bez okna", settings_data.wallabag_after_sync == nil)
-- jednorazowa informacja, gdzie są zgody
shown = {}
check("hint: cicha synchronizacja nie pokazuje", K:showConsentsHint(true) == false and #shown == 0 and not settings_data.consents_hint_shown)
check("hint: pierwszy raz pokazuje, nic nie włącza", K:showConsentsHint(false) == true and #shown == 1 and settings_data.consents_hint_shown == true
    and not settings_data.plugins_allowed and not settings_data.fonts_allowed and not settings_data.self_update_allowed and not settings_data.merge_after_sync
    and tostring(shown[1].text):find("Zgody"))
check("hint: tylko raz", K:showConsentsHint(false) == false and #shown == 1)

sh("rm -rf " .. q(TMP))
print(string.format("%d ok, %d fail", passed, failed))
os.exit(failed == 0 and 0 or 1)
