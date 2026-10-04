--[[--
Czysta logika synchronizacji koligilo — bez zależności od KOReadera
(testowana poza czytnikiem: tests/sync_test.lua, Lua 5.1–5.4 / LuaJIT).

Model: każda synchronizowana wartość ma ID
    "<plik>|<ścieżka.z.kropkami>"   (wpis Key)
    "<plik>#<klucz top-level>"      (wpis Prefix — bez dzielenia po kropkach)
a jej treść to deterministyczny literał Lua (serialize). Scalanie trójstronne:
L (lokalnie) / B (baza z ostatniej synchronizacji) / R (serwer).
--]]--

local Sync = {}

-- Twarda czarna lista: tych kluczy NIGDY nie czytamy ani nie zapisujemy,
-- nawet gdyby serwer (albo błędny katalog) ich zażądał. Klucz = plik,
-- wartość = zbiór ścieżek (dopasowanie po pierwszym segmencie LUB całej ścieżce).
Sync.DEVICE_KEYS = {
    ["settings.reader.lua"] = {
        device_id = true, last_migration_date = true,
        home_dir = true, lastdir = true, lastfile = true, inbox_dir = true,
        download_dir = true, screenshot_dir = true, screensaver_dir = true,
        screensaver_image = true, wikipedia_save_dir = true, extra_plugin_paths = true,
        cover_image_path = true, cover_image_cache_path = true, cover_image_fallback_path = true,
        screen_dpi = true, custom_screen_dpi = true, dev_no_hw_dither = true,
        dev_no_sw_dither = true, closed_rotation_mode = true, fm_rotation_mode = true,
        lock_rotation = true, copt_rotation_mode = true,
        frontlight_intensity = true, frontlight_warmth = true, is_frontlight_on = true,
        night_mode = true,
        wifi_enable_action = true, wifi_disable_action = true, wifi_was_on = true,
        auto_restore_wifi = true, auto_disable_wifi = true,
        kindle_hall_effect_sensor_enabled = true, system_fonts = true,
        screensaver_cycle_index = true, httpinspector = true, SSH_port = true,
    },
    ["settings/wallabag.lua"] = { ["wallabag.directory"] = true, ["wallabag.access_token"] = true,
        ["wallabag.token_expiry"] = true },
    ["settings/koligilo.lua"] = { ["*"] = true },
}
-- prefiksy kluczy top-level zależnych od platformy
Sync.DEVICE_PREFIXES = { "android_", "autowarmth_", "external_keyboard_" }

---------------------------------------------------------------- serializacja

local function sorted_keys(t)
    local nums, strs = {}, {}
    for k in pairs(t) do
        local tk = type(k)
        if tk == "number" then nums[#nums + 1] = k
        elseif tk == "string" then strs[#strs + 1] = k
        else return nil, "klucz typu " .. tk end
    end
    table.sort(nums)
    table.sort(strs)
    for _, s in ipairs(strs) do nums[#nums + 1] = s end
    return nums
end

local function quote(s)
    return '"' .. s:gsub('[%c"\\\127]', function(c)
        if c == '"' then return '\\"'
        elseif c == "\\" then return "\\\\"
        elseif c == "\n" then return "\\n"
        elseif c == "\r" then return "\\r"
        elseif c == "\t" then return "\\t"
        else return string.format("\\%03d", c:byte()) end
    end) .. '"'
end

local function num(n)
    if n ~= n or n == math.huge or n == -math.huge then return nil, "liczba nieskończona/NaN" end
    if n == math.floor(n) and math.abs(n) < 2^53 then return string.format("%d", n) end
    return string.format("%.17g", n)
end

--- Deterministyczny literał Lua (posortowane klucze). nil, err dla typów nieprzenośnych.
function Sync.serialize(v, depth)
    depth = depth or 0
    if depth > 32 then return nil, "za głęboko zagnieżdżone" end
    local t = type(v)
    if t == "string" then return quote(v)
    elseif t == "number" then return num(v)
    elseif t == "boolean" then return tostring(v)
    elseif t == "table" then
        local ks, err = sorted_keys(v)
        if not ks then return nil, err end
        local parts = {}
        for _, k in ipairs(ks) do
            local kk, ke
            if type(k) == "number" then kk, ke = num(k) else kk = quote(k) end
            if not kk then return nil, ke end
            local vv, ve = Sync.serialize(v[k], depth + 1)
            if not vv then return nil, ve end
            parts[#parts + 1] = "[" .. kk .. "]=" .. vv
        end
        return "{" .. table.concat(parts, ",") .. "}"
    end
    return nil, "typ " .. t
end

--- Parser DOKŁADNIE formatu serialize — bez load(): dane z serwera nigdy nie są kodem.
function Sync.deserialize(s)
    if type(s) ~= "string" then return nil, "nie napis" end
    local pos = 1
    local function ws() pos = s:find("[^ \t\r\n]", pos) or (#s + 1) end
    local value
    local function str()
        pos = pos + 1
        local buf = {}
        while true do
            local c = s:sub(pos, pos)
            if c == "" then error("niedomknięty napis") end
            if c == '"' then pos = pos + 1; break end
            if c == "\\" then
                local e = s:sub(pos + 1, pos + 1)
                if e == "n" then buf[#buf + 1] = "\n"; pos = pos + 2
                elseif e == "r" then buf[#buf + 1] = "\r"; pos = pos + 2
                elseif e == "t" then buf[#buf + 1] = "\t"; pos = pos + 2
                elseif e == '"' or e == "\\" then buf[#buf + 1] = e; pos = pos + 2
                elseif e:match("%d") then
                    local d = s:match("^%d%d?%d?", pos + 1)
                    local b = tonumber(d)
                    if b > 255 then error("zły kod znaku") end
                    buf[#buf + 1] = string.char(b); pos = pos + 1 + #d
                else error("nieznana sekwencja \\" .. e) end
            else
                local j = s:find('["\\]', pos) or (#s + 1)
                buf[#buf + 1] = s:sub(pos, j - 1); pos = j
            end
        end
        return table.concat(buf)
    end
    function value(depth)
        if depth > 32 then error("za głęboko") end
        ws()
        local c = s:sub(pos, pos)
        if c == '"' then return str()
        elseif c == "{" then
            pos = pos + 1
            local t = {}
            ws()
            if s:sub(pos, pos) == "}" then pos = pos + 1; return t end
            while true do
                ws()
                if s:sub(pos, pos) ~= "[" then error("oczekiwano [ na " .. pos) end
                pos = pos + 1
                local k = value(depth + 1)
                if type(k) ~= "string" and type(k) ~= "number" then error("zły klucz") end
                ws()
                if s:sub(pos, pos + 1) ~= "]=" then error("oczekiwano ]= na " .. pos) end
                pos = pos + 2
                t[k] = value(depth + 1)
                ws()
                local d = s:sub(pos, pos)
                pos = pos + 1
                if d == "}" then return t end
                if d ~= "," then error("oczekiwano , lub } na " .. (pos - 1)) end
            end
        elseif s:sub(pos, pos + 3) == "true" then pos = pos + 4; return true
        elseif s:sub(pos, pos + 4) == "false" then pos = pos + 5; return false
        else
            local n = s:match("^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
            if not n or n == "" or n == "-" then error("nieoczekiwany znak na " .. pos) end
            pos = pos + #n
            local v = tonumber(n)
            if not v then error("zła liczba " .. n) end
            return v
        end
    end
    local ok, res = pcall(function()
        local v = value(0)
        ws()
        if pos <= #s then error("śmieci po wartości na " .. pos) end
        return v
    end)
    if not ok then return nil, tostring(res) end
    return res
end

---------------------------------------------------------------- ścieżki

local function split(path)
    local out = {}
    for seg in path:gmatch("[^.]+") do out[#out + 1] = seg end
    return out
end

--- Rozbija ID na (plik, ścieżka-segmenty) — nil dla śmieci.
function Sync.parseID(id)
    local f, k = id:match("^(.-)|(.+)$")
    if f then return f, split(k), k end
    f, k = id:match("^(.-)#(.+)$")
    if f then return f, { k }, k end
end

function Sync.isBlocked(id)
    local f, segs, raw = Sync.parseID(id)
    if not f then return true end
    local deny = Sync.DEVICE_KEYS[f]
    if deny and (deny["*"] or deny[segs[1]] or deny[raw]) then return true end
    if f == "settings.reader.lua" then
        for _, p in ipairs(Sync.DEVICE_PREFIXES) do
            if segs[1]:sub(1, #p) == p then return true end
        end
    end
    -- tylko pliki w katalogu danych KOReadera, żadnych ../
    if f:find("%.%.") or f:sub(1, 1) == "/" or not f:match("%.lua$") then return true end
    return false
end

function Sync.get(data, segs)
    local cur = data
    for _, s in ipairs(segs) do
        if type(cur) ~= "table" then return nil end
        cur = cur[s]
    end
    return cur
end

-- Podmiana zawartości tabeli w miejscu: moduły KOReadera trzymają referencje
-- do swoich tabel ustawień (np. stopka) — nowa tabela byłaby dla nich niewidoczna.
local function replace_in_place(old, new)
    for k in pairs(old) do if new[k] == nil then old[k] = nil end end
    for k, v in pairs(new) do old[k] = v end
end

function Sync.set(data, segs, v)
    local cur = data
    for i = 1, #segs - 1 do
        local s = segs[i]
        if type(cur[s]) ~= "table" then
            if v == nil then return end
            cur[s] = {}
        end
        cur = cur[s]
    end
    local last = segs[#segs]
    if type(v) == "table" and type(cur[last]) == "table" then
        replace_in_place(cur[last], v)
    else
        cur[last] = v
    end
end

---------------------------------------------------------------- tokeny sesji

--- KOReader w trakcie sesji nadpisuje W MIEJSCU zapisane konto Dropbox
-- (np. statistics.sync_server) krótkotrwałym tokenem w `password` i flagą
-- `username = true`. Taka wartość jest ważna parę godzin i tylko na tym
-- urządzeniu — nie wolno jej wysłać innym ani uznać za zmianę użytkownika.
function Sync.hasSessionToken(v, depth)
    depth = depth or 0
    if type(v) ~= "table" or depth > 8 then return false end
    if v.type == "dropbox" and v.username == true then return true end
    for _, x in pairs(v) do
        if type(x) == "table" and Sync.hasSessionToken(x, depth + 1) then return true end
    end
    return false
end

---------------------------------------------------------------- plan

local function entry_matches(e, id)
    if e.prefix then
        local f, k = id:match("^(.-)#(.+)$")
        if not f or f ~= e.file or k:sub(1, #e.prefix) ~= e.prefix then return false end
        for _, x in ipairs(e.except or {}) do if x == k then return false end end
        return true
    end
    return id == e.file .. "|" .. e.key
end

function Sync.allowed(entries, id)
    if Sync.isBlocked(id) then return false end
    for _, e in ipairs(entries) do
        if entry_matches(e, id) then return true end
    end
    return false
end

--[[--
Wylicza plan synchronizacji.

@param entries  wpisy włączonych grup (z serwera)
@param files    { [plik] = { data = tabela, exists = bool, broken = bool } } — lokalne pliki
@param base     { [id] = literał } — stan z ostatniej udanej synchronizacji
@param remote   { values = {[id]=literał}, deleted = {id,...} }
@return plan = { upload = {[id]=literał}, delete = {id...}, apply = {[id]=literał|false},
                 base = nowa baza, conflicts = n, skipped = {id=powód},
                 masked = {id=true} — wartości z tokenem sesji Dropbox, nie wysyłane }
--]]--
function Sync.plan(entries, files, base, remote)
    local R = {}
    for id, v in pairs(remote.values or {}) do if type(v) == "string" then R[id] = v end end
    local tomb = {}
    for _, id in ipairs(remote.deleted or {}) do tomb[id] = true end

    -- zbiór ID do rozważenia: klucze z katalogu + dopasowania prefiksów lokalnie/zdalnie/w bazie
    local ids = {}
    for _, e in ipairs(entries) do
        if e.key then ids[e.file .. "|" .. e.key] = true
        elseif e.prefix and files[e.file] then
            for k in pairs(files[e.file].data) do
                if type(k) == "string" then ids[e.file .. "#" .. k] = true end
            end
        end
    end
    for id in pairs(R) do ids[id] = true end
    for id in pairs(tomb) do ids[id] = true end
    for id in pairs(base) do ids[id] = true end

    local plan = { upload = {}, delete = {}, apply = {}, base = {}, conflicts = 0, skipped = {}, masked = {} }
    for id in pairs(ids) do
        if not Sync.allowed(entries, id) then
            -- grupa wyłączona albo klucz urządzenia: zapominamy bazę,
            -- po ponownym włączeniu grupy urządzenie przyjmie wersję wspólną
            goto continue
        end
        local f, segs = Sync.parseID(id)
        local file = files[f]
        if file and file.broken then
            -- plik istnieje, ale się nie parsuje: NIE traktujemy tego jak
            -- usunięcia wszystkich kluczy — nic nie ruszamy, baza zostaje
            plan.base[id] = base[id]
            plan.skipped[id] = "plik nieczytelny"
            goto continue
        end
        local B = base[id]
        local L
        if file then
            local lv = Sync.get(file.data, segs)
            if Sync.hasSessionToken(lv) then
                -- wartość zepsuta przez sesję KOReadera: udajemy, że lokalnie
                -- nic się nie zmieniło — nie wysyłamy jej, a prawdziwa zmiana
                -- z serwera (np. konto wpisane w panelu) i tak zostanie przyjęta
                plan.masked[id] = true
                L = B
            elseif lv ~= nil then
                local s, err = Sync.serialize(lv)
                if not s then plan.skipped[id] = err; goto continue end
                L = s
            end
        end
        local has_remote = R[id] ~= nil or tomb[id]
        local Rv = R[id]

        if not has_remote then
            -- serwer nie zna tego klucza: dosyłamy, jeśli mamy
            if L ~= nil then plan.upload[id] = L end
            plan.base[id] = L
        elseif Rv == L then
            plan.base[id] = L
        else
            local localChanged = L ~= B
            local remoteChanged = Rv ~= B
            if localChanged and not remoteChanged then
                if L ~= nil then
                    plan.upload[id] = L
                elseif file and file.exists then
                    -- usunięcie propagujemy tylko, gdy plik istnieje: brak pliku
                    -- (np. plugin nieużywany) to nie decyzja użytkownika
                    plan.delete[#plan.delete + 1] = id
                end
                plan.base[id] = L
            else
                -- zmiana zdalna (albo obustronna — wygrywa wspólna wersja)
                if localChanged then plan.conflicts = plan.conflicts + 1 end
                plan.apply[id] = Rv or false
                plan.base[id] = Rv
            end
        end
        ::continue::
    end
    table.sort(plan.delete)
    return plan
end

--- Bezpiecznik: zbyt wiele usunięć naraz = coś się zepsuło (np. nieczytelny plik).
function Sync.suspicious(plan, base)
    local nbase = 0
    for _ in pairs(base) do nbase = nbase + 1 end
    return nbase >= 6 and #plan.delete > nbase / 2
end

--- Nanosi plan.apply na lokalne pliki; zwraca zbiór zmienionych plików i liczbę zmian.
function Sync.applyPlan(plan, files)
    local dirty, n = {}, 0
    for id, v in pairs(plan.apply) do
        local f, segs = Sync.parseID(id)
        local val = nil
        if v then
            local err
            val, err = Sync.deserialize(v)
            if val == nil then
                plan.skipped[id] = "nieczytelna wartość z serwera: " .. tostring(err)
                plan.base[id] = nil
                goto continue
            end
        end
        files[f] = files[f] or { data = {}, exists = false }
        Sync.set(files[f].data, segs, val)
        dirty[f] = true
        n = n + 1
        ::continue::
    end
    return dirty, n
end

---------------------------------------------------------------- wtyczki (PC-004)
--
-- Instalator wtyczek: czysta logika. Wtyczka to kod z pełnymi uprawnieniami,
-- więc tu tylko liczymy, CO trzeba zrobić; main.lua pyta człowieka o zgodę
-- i dopiero wtedy pobiera, sprawdza sha256 i podmienia katalogi.
-- Znacznik ".koligilo" w katalogu wtyczki = wtyczka zarządzana przez koligilo.
-- Katalogów bez znacznika (ręczne, wbudowane) i koligilo.koplugin nie ruszamy.

Sync.PLUGIN_MARKER = ".koligilo"
Sync.SELF_PLUGIN = "koligilo.koplugin"

--- Czy nazwa katalogu wtyczki jest dopuszczalna (tak jak pluginDirRe w Go).
function Sync.pluginDirOK(dir)
    return type(dir) == "string" and #dir <= 72
        and dir:match("^[%w][%w%._%-]*%.koplugin$") ~= nil
        and dir:lower() ~= Sync.SELF_PLUGIN
end

local function sha_ok(s) return type(s) == "string" and #s == 64 and s:match("^[0-9a-f]+$") ~= nil end

-- URL względny wobec serwera, bez sztuczek (//host, .., \, znaki sterujące).
local function rel_url_ok(u)
    return type(u) == "string" and u:match("^/[%w%._%-/]+$") ~= nil
        and not u:find("//", 1, true) and not u:find("..", 1, true)
end

--- Plan instalatora.
-- target: lista z GET /api/v1/sync (pole "plugins") — PEŁNY stan docelowy;
--   nil = serwer nie podał stanu (brak zgody / stary serwer) → nic nie robimy.
-- inventory: dir → { managed = bool, sha256 = "..."? } — stan na czytniku.
-- Zwraca { install, update, remove, conflict, invalid }; elementy install/update
-- to wpisy z target (+ old_sha256 przy update), remove/conflict/invalid mają co najmniej dir.
function Sync.pluginPlan(target, inventory)
    local plan = { install = {}, update = {}, remove = {}, conflict = {}, invalid = {} }
    if type(target) ~= "table" then return plan end
    inventory = inventory or {}
    local wanted = {}
    for _, t in ipairs(target) do
        local dir = type(t) == "table" and t.dir or nil
        if type(t) ~= "table" or not Sync.pluginDirOK(dir) or not sha_ok(t.sha256) or not rel_url_ok(t.url) then
            plan.invalid[#plan.invalid + 1] = { dir = tostring(dir), sha256 = type(t) == "table" and t.sha256 or nil,
                error = "nieprawidłowy wpis wtyczki od serwera" }
        elseif wanted[dir] then
            plan.invalid[#plan.invalid + 1] = { dir = dir, sha256 = t.sha256, error = "wtyczka podana dwa razy" }
        else
            wanted[dir] = true
            local inv = inventory[dir]
            if inv == nil then
                plan.install[#plan.install + 1] = t
            elseif not inv.managed then
                -- katalog o tej nazwie istnieje, ale nie jest nasz (ręczny/wbudowany)
                plan.conflict[#plan.conflict + 1] = { dir = dir, sha256 = t.sha256, name = t.name, version = t.version,
                    error = "na czytniku jest już ręcznie zainstalowana wtyczka o tej nazwie — koligilo jej nie nadpisze" }
            elseif inv.sha256 ~= t.sha256 then
                local u = {}
                for k, v in pairs(t) do u[k] = v end
                u.old_sha256, u.old_version = inv.sha256, inv.version
                plan.update[#plan.update + 1] = u
            end
        end
    end
    local dirs = {}
    for dir in pairs(inventory) do dirs[#dirs + 1] = dir end
    table.sort(dirs)
    for _, dir in ipairs(dirs) do
        local inv = inventory[dir]
        if inv.managed and not wanted[dir] and Sync.pluginDirOK(dir) then
            plan.remove[#plan.remove + 1] = { dir = dir, sha256 = inv.sha256, name = inv.name, version = inv.version }
        end
    end
    return plan
end

--- Czy plan wymaga jakiejkolwiek zmiany na czytniku.
function Sync.pluginPlanEmpty(plan)
    return #plan.install == 0 and #plan.update == 0 and #plan.remove == 0
end

--- Podpis planu (do zapamiętania odmowy: tego samego nie pytamy w tle drugi raz).
function Sync.pluginPlanKey(plan)
    local parts = {}
    for _, k in ipairs({ "install", "update", "remove" }) do
        for _, p in ipairs(plan[k]) do parts[#parts + 1] = k .. ":" .. p.dir .. "@" .. tostring(p.sha256) end
    end
    return table.concat(parts, ",")
end

--- Wyniki dla serwera: status dla każdej operacji planu (np. "rejected").
function Sync.pluginResults(plan, status, err)
    local out = {}
    for _, k in ipairs({ "install", "update", "remove" }) do
        for _, p in ipairs(plan[k]) do
            out[#out + 1] = { dir = p.dir, sha256 = p.sha256, action = k, status = status, error = err }
        end
    end
    return out
end

--- Czy wpis ZIP-a jest bezpieczny: wyłącznie <dir> lub <dir>/…, bez ..,
-- bez ścieżek absolutnych, backslashy, pustych segmentów i znaków sterujących.
function Sync.pluginEntryOK(dir, path)
    if type(path) ~= "string" or path == "" or #path > 512 then return false end
    if path:find("[%c\\:]") then return false end
    local p = path:gsub("/$", "")
    if p == dir then return true end
    if p:sub(1, #dir + 1) ~= dir .. "/" then return false end
    for seg in (p .. "/"):gmatch("([^/]*)/") do
        if seg == "" or seg == "." or seg == ".." then return false end
    end
    return true
end

--- Czy wpis katalogu wtyczki wolno spakować do ZIP-a wysyłanego na serwer
-- (TASK-13, „Wyślij wtyczkę na serwer”): bez symlinków i bez plików
-- roboczych koligilo (znacznik .koligilo — gdyby ktoś wysyłał zarządzaną
-- kopię, nie ma sensu przenosić cudzego znacznika razem z nią).
-- rel: ścieżka wewnątrz katalogu wtyczki (bez nazwy katalogu, np. "lib/x.lua").
-- mode: "file" | "directory" | "link" | inne (z lfs.attributes).
function Sync.pluginPackEntryOK(rel, mode)
    if type(rel) ~= "string" or rel == "" then return false end
    if mode ~= "file" and mode ~= "directory" then return false end
    local base = rel:match("([^/]+)$") or rel
    if base == Sync.PLUGIN_MARKER then return false end
    return true
end

--- Pole z _meta.lua wtyczki czytane WYŁĄCZNIE wyrażeniem regularnym
-- (to kod obcej wtyczki — nigdy dofile/load). Tylko prosty literał "…"/'…'.
function Sync.metaField(src, key)
    if type(src) ~= "string" then return nil end
    for _, q in ipairs({ '"', "'" }) do
        local v = src:match("%f[%w_]" .. key .. "%s*=%s*" .. q .. "([^" .. q .. "\n\\]*)" .. q)
        if v then return v:sub(1, 60) end
    end
    return nil
end

--- Znacznik .koligilo: proste linie klucz=wartość (bez load).
function Sync.markerEncode(t)
    local lines = { "# koligilo: ten katalog jest zarządzany przez koligilo (PC-004)" }
    for _, k in ipairs({ "sha256", "name", "version" }) do
        if t[k] then lines[#lines + 1] = k .. "=" .. tostring(t[k]):gsub("[%c]", " ") end
    end
    return table.concat(lines, "\n") .. "\n"
end

function Sync.markerDecode(s)
    local t = {}
    for line in (s or ""):gmatch("[^\n]+") do
        local k, v = line:match("^(%w+)=(.*)$")
        if k == "sha256" then
            if sha_ok(v) then t.sha256 = v end
        elseif k == "name" or k == "version" then
            t[k] = v:sub(1, 60)
        end
    end
    return t
end

---------------------------------------------------------------- przenosiny serwera

-- Host w sieci prywatnej / Tailscale / mDNS — tam http jest dopuszczalne
-- (komputer w domu), bo token nie wychodzi otwartym tekstem do internetu.
local function private_host(host)
    if host == "localhost" or host:match("%.local$") or host:match("%.ts%.net$") then return true end
    local a, b = host:match("^(%d+)%.(%d+)%.%d+%.%d+$")
    a, b = tonumber(a), tonumber(b)
    if not a then return false end
    return a == 10 or a == 127 or (a == 192 and b == 168) or (a == 172 and b >= 16 and b <= 31)
        or (a == 100 and b >= 64 and b <= 127)
end

-- Stary serwer odpowiada 410 {moved_to} po przenosinach danych (TASK-15).
-- Zwraca nowy adres albo nil, gdy jest niedopuszczalny: tylko
-- http(s)://host[:port][/ścieżka], bez loginu, zapytań i fragmentów; http
-- wyłącznie gdy stary adres też był http albo nowy host jest prywatny
-- (serwer https nie może przerzucić tokenu otwartym tekstem do internetu).
function Sync.movedURL(old, new)
    if type(new) ~= "string" or #new > 300 then return nil end
    new = new:gsub("/+$", "")
    local scheme, host, rest = new:match("^(https?)://([%w%.%-]+)(.*)$")
    if not scheme then return nil end
    local port, path = rest:match("^:(%d+)(.*)$")
    if port then
        port = tonumber(port)
        if port < 1 or port > 65535 then return nil end
    else
        path = rest
    end
    if path ~= "" and not path:match("^/[%w%-%._~/]*$") then return nil end
    if new == old then return nil end
    if scheme == "http" then
        local old_scheme = type(old) == "string" and old:match("^(https?)://")
        if old_scheme ~= "http" and not private_host(host) then return nil end
    end
    return new
end

return Sync
