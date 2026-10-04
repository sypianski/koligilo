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
local P = package.preload
P["ui/widget/confirmbox"] = function() return widget("confirm") end
P["ui/widget/infomessage"] = function() return widget("info") end
P["ui/widget/inputdialog"] = function() return widget("input") end
P["datastorage"] = function() return { getDataDir = function() return DATA end, getSettingsDir = function() return DATA end } end
P["device"] = function() return { model = "Test" } end
P["json"] = function() return { encode = function() return "{}" end, decode = function() return {} end } end
P["luasettings"] = function() return {} end
P["ui/network/manager"] = function() return { runWhenOnline = function(_, f) f() end } end
P["ui/uimanager"] = function() return {
    show = function(_, w) shown[#shown + 1] = w end, close = function() end, forceRePaint = function() end,
    scheduleIn = function() end, askForRestart = function(_, t) shown[#shown + 1] = { kind = "restart", text = t } end,
} end
P["ui/widget/container/widgetcontainer"] = function() return { extend = function(_, o) return o end } end
P["socket.http"] = function() return { request = function(req)
    local body = served[req.url]
    if not body then return 1, 404, {}, "404" end
    req.sink(body); req.sink(nil)
    return 1, 200, { ["x-koligilo-sha256"] = "?" }, "200 OK"
end } end
P["socket"] = function() return { skip = function(n, ...) return select(n + 1, ...) end } end
P["socketutil"] = function() return { set_timeout = function() end, reset_timeout = function() end } end
P["ltn12"] = function() return {} end
P["logger"] = function() return { warn = function() end } end
P["gettext"] = function() return function(s) return s end end
P["libs/libkoreader-lfs"] = function() return {
    attributes = function(p, what)
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
local settings_data = { server = "http://srv", token = "tok" }
local K = setmetatable({ settings = {
    readSetting = function(_, k) return settings_data[k] end,
    saveSetting = function(_, k, v) settings_data[k] = v end,
    delSetting = function(_, k) settings_data[k] = nil end,
    flush = function() end, isTrue = function(_, k) return settings_data[k] == true end,
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
sh("mkdir -p " .. q(ROOT .. "/reczna.koplugin") .. " && echo 'return {version=\"9\"}' > " .. q(ROOT .. "/reczna.koplugin/_meta.lua"))
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
check("inwentarz: koligilo niezarządzany mimo znacznika", inv["koligilo.koplugin"] and not inv["koligilo.koplugin"].managed)

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

sh("rm -rf " .. q(TMP))
print(string.format("%d ok, %d fail", passed, failed))
os.exit(failed == 0 and 0 or 1)
