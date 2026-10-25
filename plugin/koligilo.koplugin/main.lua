--[[--
koligilo — synchronizacja ustawień KOReadera między urządzeniami.

Warstwa KOReadera: menu, parowanie z kodem, HTTP, odczyt/zapis plików
ustawień. Cała logika scalania jest w sync.lua (testowana poza czytnikiem).

@module koplugin.koligilo
--]]--

local ConfirmBox = require("ui/widget/confirmbox")
local DataStorage = require("datastorage")
local Device = require("device")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local JSON = require("json")
local LuaSettings = require("luasettings")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local http = require("socket.http")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local ltn12 = require("ltn12")
local socket = require("socket")
local socketutil = require("socketutil")
local ffiutil = require("ffi/util")
local T = ffiutil.template
local util = require("util")
local _ = require("gettext")

local Sync = require("sync")

local DISCOVERY_PORT = 47470
-- Punkt kontaktowy do parowania kodem (działa z każdej sieci). Można nadpisać
-- kluczem "rendezvous" w settings/koligilo.lua (np. własny serwer).
local DEFAULT_RENDEZVOUS = "https://koligilo.sypian.ski"
local AUTO_SYNC_MIN_INTERVAL = 15 * 60 -- s, auto-sync po Wi-Fi nie częściej
local RESUME_SYNC_DELAY = 8 -- s, po wybudzeniu sieć bywa jeszcze niestabilna
local PLUGIN_MAX_ZIP = 25 * 1024 * 1024       -- serwer przyjmuje do 20 MB
local PLUGIN_MAX_UNPACKED = 100 * 1024 * 1024 -- jak pluginMaxUnpacked w Go
local PLUGIN_MAX_FILES = 5000
local READER = "settings.reader.lua"
local KOSYNC = "settings/kosync.lua"

local Koligilo = WidgetContainer:extend{
    name = "koligilo",
    is_doc_only = false,
}

-- Gdzie leży ten plugin i w jakiej jest wersji — ustalone RAZ, przy wczytaniu pliku.
-- Po samoaktualizacji pliki na dysku są już nowe, ale ta kopia w pamięci zostaje
-- starą wersją i tak ma o sobie myśleć do restartu KOReadera (TASK-39).
Koligilo.selfParent = Sync.selfParentDir(debug.getinfo(1, "S").source)
do
    local f = Koligilo.selfParent and io.open(Koligilo.selfParent .. "/koligilo.koplugin/_meta.lua", "rb")
    if f then
        Koligilo.selfVersion = Sync.metaField(f:read(65536) or "", "version")
        f:close()
    end
end
-- po udanej podmianie plików nic więcej nie robimy aż do restartu: mieszanie starego
-- main.lua z nowym sync.lua (require ładowany leniwie) byłoby loterią
local restart_pending = false

-- pytanie o pierwszą synchronizację zadajemy raz na uruchomienie KOReadera
-- (plugin ma osobne instancje w menedżerze plików i w czytniku)
local first_sync_asked = false
-- okno potwierdzenia wtyczek naraz tylko jedno (dwie instancje pluginu)
local plugin_dialog_open = false

function Koligilo:init()
    self.settings = LuaSettings:open(DataStorage:getSettingsDir() .. "/koligilo.lua")
    pcall(self.cleanupSelfUpdate, self)
    self.ui.menu:registerToMainMenu(self)
    -- Sparowany kablem z panelu na komputerze, ale jeszcze nigdy nie
    -- synchronizowany: pierwsza synchronizacja zawsze za zgodą użytkownika.
    if self:isPaired() and not self.settings:readSetting("last_sync") and not first_sync_asked then
        first_sync_asked = true
        UIManager:scheduleIn(2, function() self:askFirstSync() end)
    end
end

function Koligilo:askFirstSync()
    UIManager:show(ConfirmBox:new{
        text = T(_("Ten czytnik został połączony z koligilo na komputerze (%1).\n\nZsynchronizować teraz? W grupach wybranych w panelu (np. gesty, stopka, konta) wspólne ustawienia zastąpią lokalne; ustawienia, których inne urządzenia jeszcze nie mają, zostaną wysłane."),
            self.settings:readSetting("server")),
        ok_text = _("Synchronizuj"),
        cancel_text = _("Później"),
        ok_callback = function() NetworkMgr:runWhenOnline(function() self:sync(false) end) end,
    })
end

---------------------------------------------------------------- HTTP

local function request(method, url, token, body)
    local sink = {}
    local req = {
        url = url, method = method, sink = ltn12.sink.table(sink),
        headers = { ["Accept"] = "application/json" },
    }
    if token then req.headers["Authorization"] = "Bearer " .. token end
    if body then
        local b = JSON.encode(body)
        req.source = ltn12.source.string(b)
        req.headers["Content-Type"] = "application/json"
        req.headers["Content-Length"] = tostring(#b)
    end
    socketutil:set_timeout(socketutil.LARGE_BLOCK_TIMEOUT, socketutil.LARGE_TOTAL_TIMEOUT)
    local code, headers, status = socket.skip(1, http.request(req))
    socketutil:reset_timeout()
    if headers == nil then
        return nil, nil, tostring(status or code)
    end
    local ok, data = pcall(JSON.decode, table.concat(sink))
    if not ok or type(data) ~= "table" then data = nil end
    return code, data
end

local function error_text(code, data, neterr)
    if not code then return T(_("Brak połączenia z serwerem (%1)."), neterr or "?") end
    if data and data.error then return data.error end
    return T(_("Serwer odpowiedział błędem HTTP %1."), code)
end

---------------------------------------------------------------- odkrywanie w LAN

-- Rozgłasza „koligilo?” — panel koligilo na komputerze w tej samej sieci
-- odpowiada adresem serwera. Dzięki temu przy parowaniu nic nie wpisujemy.
local function discover()
    local udp = socket.udp()
    if not udp then return nil end
    udp:setoption("broadcast", true)
    udp:setsockname("*", 0)
    udp:settimeout(1.5)
    for _i = 1, 2 do
        udp:sendto("koligilo?", "255.255.255.255", DISCOVERY_PORT)
        local dgram = udp:receivefrom()
        local url = dgram and dgram:match("^koligilo;(https?://%S+)$")
        if url then
            udp:close()
            return url
        end
    end
    udp:close()
    return nil
end

local function platform_name()
    for _i, p in ipairs({ { "isAndroid", "Android" }, { "isKobo", "Kobo" }, { "isKindle", "Kindle" },
        { "isPocketBook", "PocketBook" }, { "isRemarkable", "reMarkable" },
        { "isCervantes", "Cervantes" }, { "isSDL", "Desktop" } }) do
        local fn = Device[p[1]]
        if type(fn) == "function" and fn(Device) then return p[2] end
    end
    return "?"
end

---------------------------------------------------------------- menu

function Koligilo:isPaired()
    return self.settings:readSetting("token") ~= nil
end

-- Zgody (TASK-46): wtyczki, czcionki, samoaktualizacja i scalanie baz. Każda ma dawne
-- okno z opisem ryzyka i wciąż daje się włączyć wyłącznie tutaj, nigdy z panelu (PC-004).
function Koligilo:consentItems()
    local items = {}
    -- Samoaktualizacja koligilo (TASK-39, PC-019): zgoda tylko stąd, a każdą
    -- aktualizację i tak potwierdza się osobno, z numerami wersji.
    table.insert(items, {
        text_func = function() return T(_("Pozwól aktualizować koligilo (teraz %1)"), self.selfVersion or "?") end,
        checked_func = function() return self.settings:isTrue("self_update_allowed") end,
        keep_menu_open = true,
        callback = function(touchmenu_instance)
            local function tell_server()
                if NetworkMgr:isOnline() then
                    UIManager:nextTick(function() self:sync(true) end)
                end
            end
            if self.settings:isTrue("self_update_allowed") then
                self.settings:delSetting("self_update_allowed")
                self.settings:flush()
                tell_server()
                return
            end
            UIManager:show(ConfirmBox:new{
                text = _("Pozwolić koligilo sprawdzać na serwerze, czy jest nowsza wersja koligilo, i proponować jej instalację na tym czytniku?\n\nSama aktualizacja nigdy nie rusza się bez Twojego potwierdzenia w oknie z numerami wersji. To program z pełnym dostępem do czytnika, więc zgadzaj się tylko, jeśli ufasz swojemu serwerowi koligilo."),
                ok_text = _("Pozwól"),
                ok_callback = function()
                    self.settings:makeTrue("self_update_allowed")
                    self.settings:flush()
                    if touchmenu_instance then touchmenu_instance:updateItems() end
                    tell_server()
                end,
            })
        end,
    })
    -- Zgoda na wtyczki tylko tutaj, na czytniku — nigdy z panelu (PC-004).
    table.insert(items, {
        text = _("Pozwól instalować wtyczki"),
        checked_func = function() return self.settings:isTrue("plugins_allowed") end,
        keep_menu_open = true,
        -- Zgoda przychodzi asynchronicznie z ConfirmBox, a menu
        -- przerysowuje ptaszek zaraz po powrocie z callbacku —
        -- trzeba je odświeżyć ręcznie po „Pozwól”.
        callback = function(touchmenu_instance)
            -- Serwer poznaje zgodę tylko z GET /api/v1/sync, więc
            -- bez synchronizacji panel dalej pokazywałby stary stan.
            local function tell_server()
                if NetworkMgr:isOnline() then
                    UIManager:nextTick(function() self:sync(true) end)
                end
            end
            if self.settings:isTrue("plugins_allowed") then
                self.settings:delSetting("plugins_allowed")
                self.settings:flush()
                tell_server()
                return
            end
            UIManager:show(ConfirmBox:new{
                text = _("Pozwolić koligilo instalować, aktualizować i usuwać wtyczki przypisane temu czytnikowi w panelu?\n\nWtyczki to programy z pełnym dostępem do czytnika. Każdą zmianę i tak trzeba będzie potwierdzić tutaj, a koligilo nigdy nie rusza wtyczek zainstalowanych ręcznie ani wbudowanych."),
                ok_text = _("Pozwól"),
                ok_callback = function()
                    self.settings:makeTrue("plugins_allowed")
                    self.settings:flush()
                    if touchmenu_instance then touchmenu_instance:updateItems() end
                    tell_server()
                end,
            })
        end,
    })
    -- Czcionki (TASK-36, PC-018): to dane, nie kod, więc zgoda jest jedna,
    -- a pliki instalują się bez pytania o każdy — ale też tylko stąd.
    table.insert(items, {
        text = _("Synchronizuj czcionki"),
        checked_func = function() return self.settings:isTrue("fonts_allowed") end,
        keep_menu_open = true,
        callback = function(touchmenu_instance)
            local function tell_server()
                if NetworkMgr:isOnline() then
                    UIManager:nextTick(function() self:sync(true) end)
                end
            end
            if self.settings:isTrue("fonts_allowed") then
                self.settings:delSetting("fonts_allowed")
                self.settings:flush()
                tell_server()
                return
            end
            UIManager:show(ConfirmBox:new{
                text = _("Pozwolić koligilo pobierać czcionki z serwera do katalogu fonts/koligilo i usuwać stamtąd te, które zniknęły z panelu?\n\nCzcionki instalują się bez pytania o każdą. Pliki są sprawdzane sumą sha256, a koligilo nigdy nie rusza czcionek dodanych ręcznie."),
                ok_text = _("Pozwól"),
                ok_callback = function()
                    self.settings:makeTrue("fonts_allowed")
                    self.settings:flush()
                    if touchmenu_instance then touchmenu_instance:updateItems() end
                    tell_server()
                end,
            })
        end,
    })
    -- Słowniki (TASK-55, PC-020): jak czcionki — dane, jedna zgoda, bez pytania o każdy;
    -- ale duże (do 300 MB), więc pobieranie rusza tylko poza książką, a okno zgody to mówi.
    table.insert(items, {
        text = _("Synchronizuj słowniki"),
        checked_func = function() return self.settings:isTrue("dicts_allowed") end,
        keep_menu_open = true,
        callback = function(touchmenu_instance)
            local function tell_server(silent)
                if NetworkMgr:isOnline() then
                    UIManager:nextTick(function() self:sync(silent) end)
                end
            end
            if self.settings:isTrue("dicts_allowed") then
                self.settings:delSetting("dicts_allowed")
                self.settings:flush()
                tell_server(true)
                return
            end
            UIManager:show(ConfirmBox:new{
                text = _("Pozwolić koligilo pobierać słowniki z serwera do katalogu data/dict/koligilo i usuwać stamtąd te, które zniknęły z panelu?\n\nSłowniki instalują się bez pytania o każdy, ale bywają duże (nawet kilkaset MB) — najlepiej na Wi-Fi i z wolnym miejscem. Pobieranie rusza tylko poza książką. Pliki są sprawdzane sumą sha256, nie instalujemy plików .lua, a koligilo nigdy nie rusza słowników dodanych ręcznie."),
                ok_text = _("Pozwól"),
                ok_callback = function()
                    self.settings:makeTrue("dicts_allowed")
                    self.settings:flush()
                    if touchmenu_instance then touchmenu_instance:updateItems() end
                    tell_server(false)
                end,
            })
        end,
    })
    -- Scalanie wspólnych baz (TASK-42): koligilo tylko wysyła KOReaderowi zdarzenia
    -- „synchronizuj statystyki/słowniczek”; konto i folder ustawia się w panelu, a bez
    -- nich zdarzenia nic nie robią. Zgoda stąd, bo to wysyła dane czytania do chmury.
    table.insert(items, {
        text = _("Scalaj statystyki i słowniczek po synchronizacji"),
        checked_func = function() return self.settings:isTrue("merge_after_sync") end,
        keep_menu_open = true,
        callback = function(touchmenu_instance)
            local function tell_server()
                if NetworkMgr:isOnline() then
                    UIManager:nextTick(function() self:sync(true) end)
                end
            end
            if self.settings:isTrue("merge_after_sync") then
                self.settings:delSetting("merge_after_sync")
                self.settings:flush()
                tell_server()
                return
            end
            UIManager:show(ConfirmBox:new{
                text = _("Po każdej synchronizacji koligilo scalać też statystyki czytania i słowniczek ze wspólną bazą na koncie w chmurze (Statystyki czytania → Synchronizacja w chmurze oraz Kreator słownictwa → Synchronizacja w chmurze)?\n\nDziała tylko tam, gdzie konto i folder są ustawione (w panelu koligilo albo w KOReaderze). Scalanie jest ciche i nie przerywa czytania; koligilo nic nie wysyła samo — robi to wbudowana synchronizacja KOReadera."),
                ok_text = _("Włącz"),
                ok_callback = function()
                    self.settings:makeTrue("merge_after_sync")
                    self.settings:flush()
                    if touchmenu_instance then touchmenu_instance:updateItems() end
                    tell_server()
                end,
            })
        end,
    })
    -- Pobieranie artykułów Wallabag (TASK-45): w odróżnieniu od scalania baz KOReader pokazuje
    -- przy tym okna postępu i końcowe „Sync finished”, więc to osobna zgoda i tylko poza książką.
    table.insert(items, {
        text = _("Pobieraj artykuły Wallabag po synchronizacji"),
        checked_func = function() return self.settings:isTrue("wallabag_after_sync") end,
        keep_menu_open = true,
        callback = function(touchmenu_instance)
            local function tell_server()
                if NetworkMgr:isOnline() then
                    UIManager:nextTick(function() self:sync(true) end)
                end
            end
            if self.settings:isTrue("wallabag_after_sync") then
                self.settings:delSetting("wallabag_after_sync")
                self.settings:flush()
                tell_server()
                return
            end
            UIManager:show(ConfirmBox:new{
                text = _("Po każdej synchronizacji koligilo pobierać też nowe artykuły z Wallabaga?\n\nKOReader pokaże przy tym okna postępu i na końcu okno „Sync finished”, które trzeba zamknąć; pobieranie bywa wolne i blokuje ekran do końca. Dlatego dzieje się to tylko w menedżerze plików, nigdy w trakcie czytania (wtedy artykuły nie są pobierane).\n\nZadziała tylko tam, gdzie konto Wallabag jest ustawione w KOReaderze."),
                ok_text = _("Włącz"),
                ok_callback = function()
                    self.settings:makeTrue("wallabag_after_sync")
                    self.settings:flush()
                    if touchmenu_instance then touchmenu_instance:updateItems() end
                    tell_server()
                end,
            })
        end,
    })
    return items
end

function Koligilo:addToMainMenu(menu_items)
    menu_items.koligilo = {
        text = _("koligilo — synchronizacja ustawień"),
        sorting_hint = "tools",
        sub_item_table_func = function()
            local items = {
                {
                    text_func = function()
                        if self:isPaired() then
                            local last = self.settings:readSetting("last_sync")
                            return T(_("Połączono: %1"), self.settings:readSetting("server"))
                                .. (last and T(_(" · ostatnio %1"), os.date("%d.%m %H:%M", last)) or "")
                        end
                        return _("Niepołączone z żadnym serwerem")
                    end,
                    enabled_func = function() return false end,
                    separator = true,
                },
            }
            if self:isPaired() then
                table.insert(items, {
                    text = _("Synchronizuj teraz"),
                    callback = function() NetworkMgr:runWhenOnline(function() self:sync(false) end) end,
                })
                table.insert(items, {
                    text = _("Automatycznie po połączeniu z Wi-Fi"),
                    checked_func = function() return self.settings:nilOrTrue("auto_sync") end,
                    callback = function()
                        self.settings:flipNilOrTrue("auto_sync")
                        self.settings:flush()
                    end,
                })
                -- Wszystkie zgody w jednym miejscu (TASK-46). Zgoda zawsze zostaje na czytniku (PC-004).
                table.insert(items, {
                    text = _("Zgody (co wolno koligilo na tym czytniku)"),
                    sub_item_table_func = function() return self:consentItems() end,
                })
                table.insert(items, {
                    text = _("Wyślij czcionkę na serwer…"),
                    sub_item_table_func = function() return self:sendFontMenu() end,
                })
                -- TASK-13: przeniesienie wtyczki spoza galerii z czytnika na
                -- serwer, żeby dało się ją zainstalować na innym bez kabla.
                table.insert(items, {
                    text = _("Wyślij wtyczkę na serwer…"),
                    sub_item_table_func = function() return self:sendPluginMenu() end,
                })
                table.insert(items, {
                    text = _("Odłącz to urządzenie"),
                    keep_menu_open = true,
                    callback = function() self:unpair() end,
                    separator = true,
                })
            else
                table.insert(items, {
                    text = _("Połącz z komputerem…"),
                    callback = function() NetworkMgr:runWhenOnline(function() self:pair() end) end,
                })
                table.insert(items, {
                    text = _("Połącz, podając adres serwera… (zaawansowane)"),
                    callback = function() NetworkMgr:runWhenOnline(function() self:askServerAddress() end) end,
                    separator = true,
                })
            end
            table.insert(items, {
                text = _("Jak to działa?"),
                keep_menu_open = true,
                callback = function()
                    UIManager:show(InfoMessage:new{ text = _([[koligilo przenosi wybrane ustawienia między Twoimi czytnikami: gesty, stopkę, słowniki, profile, a także konta (Wallabag, synchronizacja postępu, statystyki), żeby nie wpisywać ich na każdym urządzeniu.

Co dokładnie jest synchronizowane, wybierasz w panelu koligilo na komputerze — osobno dla każdego urządzenia.

Nigdy nie są przenoszone: rozdzielczość ekranu, podświetlenie, ścieżki folderów i Wi-Fi — bo każde urządzenie ma je inne.

Po pobraniu nowych ustawień KOReader poprosi o ponowne uruchomienie.

Wtyczki: gdy włączysz „Pozwól instalować wtyczki”, koligilo zainstaluje wtyczki przypisane w panelu — zawsze dopiero po Twoim potwierdzeniu na czytniku.

Czcionki: gdy włączysz „Synchronizuj czcionki”, koligilo pobierze czcionki z panelu do katalogu fonts/koligilo (bez pytania o każdą). Pojawią się w menu czcionek po ponownym uruchomieniu KOReadera.

Słowniki: gdy włączysz „Synchronizuj słowniki”, koligilo pobierze słowniki z panelu do katalogu data/dict/koligilo (poza książką, bez pytania o każdy). Pojawią się w KOReaderze po ponownym otwarciu książki.]]) })
                end,
            })
            return items
        end,
    }
end

---------------------------------------------------------------- parowanie

function Koligilo:pair()
    local msg = InfoMessage:new{ text = _("Szukam panelu koligilo…") }
    UIManager:show(msg)
    UIManager:forceRePaint()
    local server = discover()
    UIManager:close(msg)
    if server then
        -- komputer z panelem w tej samej sieci: prośba z kodem wprost na serwerze
        return self:startPairing(server)
    end
    -- inna sieć, eduroam, VPN…: kod przez punkt kontaktowy
    self:startRendezvous()
end

function Koligilo:saveConnection(server, token, device_id)
    self.settings:saveSetting("server", server)
    self.settings:saveSetting("token", token)
    self.settings:saveSetting("device_id", device_id)
    self.settings:saveSetting("base", {})
    self.settings:delSetting("last_sync")
    self.settings:flush()
end

-- Parowanie kodem jak w telewizorze: czytnik pokazuje kod, człowiek wpisuje
-- go w panelu na komputerze, czytnik odbiera adres serwera i klucz.
function Koligilo:startRendezvous()
    local rv = self.settings:readSetting("rendezvous") or DEFAULT_RENDEZVOUS
    local code, data, neterr = request("POST", rv .. "/api/v1/rv", nil, {
        name = Device.model, model = Device.model, platform = platform_name(),
        ko_version = require("version"):getCurrentRevision(),
    })
    if code ~= 200 or not data or not data.code then
        UIManager:show(InfoMessage:new{ text = T(_("Nie udało się połączyć z punktem kontaktowym koligilo (%1):\n%2\n\nSprawdź internet. Możesz też podłączyć czytnik kablem do komputera z panelem koligilo."),
            rv, error_text(code, data, neterr)) })
        return
    end
    local pretty = data.code:sub(1, 3) .. " " .. data.code:sub(4)
    local cancelled = false
    local waiting = InfoMessage:new{
        text = T(_("Kod parowania:\n\n%1\n\nNa komputerze otwórz panel koligilo, kliknij „Dodaj czytnik kodem” i wpisz ten kod.\n\nKod jest ważny 10 minut. Stuknij tutaj, aby anulować.\n\nKod przechodzi przez punkt kontaktowy %2%3: na czas parowania trafia tam model czytnika, a z komputera adres serwera i klucz dla tego czytnika. Ustawień ani książek ten serwer nie widzi."), pretty, rv,
            rv == DEFAULT_RENDEZVOUS and _(" (serwer autora koligilo)") or ""),
        dismiss_callback = function() cancelled = true end,
    }
    UIManager:show(waiting)
    local deadline = os.time() + (data.expires_in or 600)
    local function finish(text)
        cancelled = true
        UIManager:close(waiting)
        if text then UIManager:show(InfoMessage:new{ text = text }) end
    end
    local function poll()
        if cancelled then return end
        if os.time() > deadline then return finish(_("Kod wygasł. Wybierz „Połącz z komputerem” ponownie.")) end
        local c, d = request("GET", rv .. "/api/v1/rv/" .. data.id)
        if c == 200 and d and d.status == "ready" and d.token and d.server then
            finish()
            self:saveConnection(d.server, d.token, d.device_id)
            self:askFirstSync()
        elseif c == 404 then
            finish(_("Kod wygasł. Wybierz „Połącz z komputerem” ponownie."))
        else
            UIManager:scheduleIn(3, poll)
        end
    end
    UIManager:scheduleIn(3, poll)
end

function Koligilo:askServerAddress()
    local dialog
    dialog = InputDialog:new{
        title = _("Adres serwera koligilo"),
        description = _("Zwykle niepotrzebne — „Połącz z komputerem” pokaże kod do wpisania w panelu. Adres podaj tylko, jeśli używasz własnego serwera bez punktu kontaktowego."),
        input = self.settings:readSetting("server") or "",
        input_hint = "np. koligilo.example.com",
        buttons = { {
            { text = _("Anuluj"), id = "close", callback = function() UIManager:close(dialog) end },
            { text = _("Połącz"), is_enter_default = true, callback = function()
                local s = dialog:getInputText():gsub("%s", ""):gsub("/+$", "")
                UIManager:close(dialog)
                if s == "" then return end
                if not s:match("^https?://") then
                    -- bez protokołu: https, a gdy serwer nie odpowiada jak koligilo — http
                    local code = request("GET", "https://" .. s .. "/api/v1/ping")
                    s = (code == 200 and "https://" or "http://") .. s
                end
                self:startPairing(s)
            end },
        } },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function Koligilo:startPairing(server)
    local code, data, neterr = request("POST", server .. "/api/v1/pair", nil, {
        name = Device.model, model = Device.model, platform = platform_name(),
        ko_version = require("version"):getCurrentRevision(),
    })
    if code ~= 200 or not data or not data.code then
        UIManager:show(InfoMessage:new{ text = T(_("Nie udało się rozpocząć parowania z %1:\n%2"),
            server, error_text(code, data, neterr)) })
        return
    end
    local cancelled = false
    local waiting = InfoMessage:new{
        text = T(_("Kod parowania:\n\n%1\n\nW panelu koligilo na komputerze pojawiła się prośba o połączenie z tym samym kodem. Sprawdź, czy kody się zgadzają, i kliknij tam „Połącz”.\n\nStuknij tutaj, aby anulować."), data.code),
        dismiss_callback = function() cancelled = true end,
    }
    UIManager:show(waiting)
    local deadline = os.time() + (data.expires_in or 600)
    local function finish(text)
        cancelled = true
        UIManager:close(waiting)
        if text then UIManager:show(InfoMessage:new{ text = text }) end
    end
    local function poll()
        if cancelled then return end
        if os.time() > deadline then return finish(_("Kod wygasł. Spróbuj połączyć ponownie.")) end
        local c, d = request("GET", server .. "/api/v1/pair/" .. data.id)
        if c == 200 and d and d.status == "approved" and d.token then
            finish()
            self:saveConnection(server, d.token, d.device_id)
            self:askFirstSync()
        elseif c == 200 and d and d.status == "rejected" then
            finish(_("Połączenie odrzucono na komputerze."))
        elseif c == 404 then
            finish(_("Prośba o połączenie wygasła. Spróbuj ponownie."))
        else
            UIManager:scheduleIn(2, poll)
        end
    end
    UIManager:scheduleIn(2, poll)
end

function Koligilo:unpair()
    UIManager:show(ConfirmBox:new{
        text = _("Odłączyć to urządzenie od koligilo?\n\nUstawienia na tym urządzeniu zostaną takie, jakie są teraz — po prostu przestaną się synchronizować."),
        ok_text = _("Odłącz"),
        ok_callback = function()
            for _i, k in ipairs({ "token", "device_id", "base", "last_sync" }) do
                self.settings:delSetting(k)
            end
            self.settings:flush()
        end,
    })
end

---------------------------------------------------------------- pliki

-- Szuka ŻYWEGO obiektu LuaSettings danego pliku w załadowanych pluginach
-- (np. Gestures.settings). Modyfikacja jego tabeli w miejscu sprawia, że
-- plugin nie nadpisze naszych zmian swoją starą kopią przy flush/wyjściu.
function Koligilo:findLiveSettings(path)
    local function probe(t)
        if type(t) ~= "table" then return nil end
        for _i, v in pairs(t) do
            if type(v) == "table" and rawget(v, "file") == path and type(rawget(v, "data")) == "table" then
                return v
            end
        end
    end
    for _i, inst in pairs(self.ui) do
        if type(inst) == "table" and inst ~= self then
            local hit = probe(inst)
            if not hit then
                local mt = getmetatable(inst)
                if mt and type(mt.__index) == "table" then hit = probe(mt.__index) end
            end
            if hit then return hit end
        end
    end
end

function Koligilo:loadFiles(entries, remote)
    local names = { [READER] = true }
    for _i, e in ipairs(entries) do names[e.file] = true end
    for id in pairs(remote.values or {}) do
        local f = Sync.parseID(id)
        if f then names[f] = true end
    end
    local files = {}
    for f in pairs(names) do
        if f == READER then
            files[f] = { data = G_reader_settings.data, exists = true, obj = G_reader_settings }
        elseif not Sync.isBlocked(f .. "|x") then
            local path = DataStorage:getDataDir() .. "/" .. f
            local exists = lfs.attributes(path, "mode") == "file"
            local obj = self:findLiveSettings(path)
            -- KOReader < 2026.06 trzyma kosync w settings.reader.lua pod
            -- „kosync”, a nie w settings/kosync.lua pod „settings”. Podajemy
            -- tę samą tabelę pod nową nazwą — ID na drucie zostają jednolite,
            -- a zmiany trafiają w miejscu do tabeli, której używa KOSync.
            if f == KOSYNC and not obj and not exists and type(G_reader_settings.data.kosync) == "table" then
                files[f] = { data = { settings = G_reader_settings.data.kosync }, exists = true, obj = G_reader_settings }
            else
                local broken = false
                if not obj then
                    if exists then
                        local ok, stored = pcall(dofile, path)
                        broken = not ok or type(stored) ~= "table"
                    end
                    obj = LuaSettings:open(path)
                end
                files[f] = { data = obj.data, exists = exists, broken = broken, obj = obj }
            end
        end
    end
    return files
end

---------------------------------------------------------------- wtyczki (PC-004)
--
-- Plan liczy Sync.pluginPlan; tutaj tylko I/O. Kolejność dla każdej wtyczki:
-- pobranie → własne sha256 → sprawdzenie nazw w ZIP-ie → rozpakowanie do
-- plugins/.koligilo-new-<nazwa> → znacznik .koligilo → stara wersja do
-- plugins/.koligilo-old-<nazwa> → rename nowej na miejsce → usunięcie starej.
-- Katalogi robocze NIE kończą się na „.koplugin”: PluginLoader ładuje każdy
-- katalog *.koplugin, także zaczynający się od kropki.

local function is_dir(p) return lfs.attributes(p, "mode") == "directory" end
local function is_file(p) return lfs.attributes(p, "mode") == "file" end

local function read_file(p, limit)
    local f = io.open(p, "rb")
    if not f then return nil end
    local s = f:read(limit or "*a")
    f:close()
    return s
end

local function write_file(p, s)
    local f, err = io.open(p, "wb")
    if not f then return nil, err end
    local ok, werr = f:write(s)
    local cok, cerr = f:close()
    if not ok or not cok then return nil, werr or cerr end
    return true
end

local function purge(p)
    if is_dir(p) then ffiutil.purgeDir(p) elseif is_file(p) then os.remove(p) end
end

local function plugin_base(dir) return (dir:gsub("%.koplugin$", "")) end

-- Katalog, do którego instalujemy (i jedyny, w którym cokolwiek usuwamy):
-- <dane KOReadera>/plugins — PluginLoader zawsze go przegląda (na Kindle/Kobo
-- dane = katalog KOReadera, na Androidzie /sdcard/koreader).
function Koligilo:pluginRoot()
    return DataStorage:getDataDir() .. "/plugins"
end

--- Inwentarz: dir → { managed, sha256, name, version } ze wszystkich katalogów
-- wtyczek (wbudowane w „plugins” obok KOReadera + katalog danych).
Koligilo.BUILTIN_PLUGINS_DIR = "plugins" -- katalog wtyczek wbudowanych (obok KOReadera); w testach podmieniany
function Koligilo:pluginInventory()
    local root = self:pluginRoot()
    local root_real = ffiutil.realpath(root) or root
    local inv = {}
    local from_install, from_data = {}, {} -- gdzie znaleziono wpis (TASK-43: pochodzenie)
    local function scan(path, own)
        if not is_dir(path) then return end
        for entry in lfs.dir(path) do
            local p = path .. "/" .. entry
            if entry:sub(1, 1) ~= "." and entry:match("%.koplugin$") and is_dir(p) then
                local meta = read_file(p .. "/_meta.lua", 65536)
                local item = {
                    dir = entry, managed = false,
                    name = Sync.metaField(meta, "name") or plugin_base(entry),
                    fullname = Sync.metaField(meta, "fullname", 100), -- nazwa „po ludzku” dla panelu
                    version = Sync.metaField(meta, "version"),
                }
                if own and entry ~= Sync.SELF_PLUGIN and is_file(p .. "/" .. Sync.PLUGIN_MARKER) then
                    local m = Sync.markerDecode(read_file(p .. "/" .. Sync.PLUGIN_MARKER, 4096))
                    item.managed = true
                    item.sha256 = m.sha256
                    item.version = item.version or m.version
                end
                if own then from_data[entry] = true else from_install[entry] = true end
                local prev = inv[entry]
                -- ta sama nazwa w dwóch katalogach: jeśli choć jedna kopia nie
                -- jest nasza, całość traktujemy jak ręczną (konflikt, nie ruszamy)
                if prev and not prev.managed then item.managed, item.sha256 = false, nil end
                inv[entry] = item
            end
        end
    end
    local builtin = self.BUILTIN_PLUGINS_DIR
    local same_dir = (ffiutil.realpath(builtin) or builtin) == root_real
    if not same_dir then scan(builtin, false) end
    scan(root, true)
    for entry, item in pairs(inv) do
        item.origin = Sync.pluginOrigin(from_install[entry], from_data[entry], item.managed, same_dir)
    end
    return inv
end

local function inventory_list(inv)
    local out = {}
    for _k, v in pairs(inv) do
        out[#out + 1] = { dir = v.dir, name = v.name, fullname = v.fullname, version = v.version, managed = v.managed, sha256 = v.sha256, origin = v.origin }
    end
    table.sort(out, function(a, b) return a.dir < b.dir end)
    return out
end

-- Pobiera ZIP do pamięci (limit rozmiaru); zwraca treść albo nil, błąd.
local function download(url, token, limit, accept)
    limit = limit or PLUGIN_MAX_ZIP
    local chunks, size = {}, 0
    local sink = function(chunk)
        if chunk == nil then return 1 end
        size = size + #chunk
        if size > limit then return nil, "za duży plik" end
        chunks[#chunks + 1] = chunk
        return 1
    end
    socketutil:set_timeout(socketutil.FILE_BLOCK_TIMEOUT, socketutil.FILE_TOTAL_TIMEOUT)
    local code, headers, status = socket.skip(1, http.request{
        url = url, method = "GET", sink = sink,
        headers = { ["Authorization"] = "Bearer " .. token, ["Accept"] = accept or "application/zip" },
    })
    socketutil:reset_timeout()
    if headers == nil then return nil, T(_("brak połączenia (%1)"), tostring(status or code)) end
    if code ~= 200 then
        if code == 403 then return nil, _("serwer odmówił (brak zgody albo plik nieprzypisany)") end
        return nil, T(_("serwer odpowiedział błędem HTTP %1"), code)
    end
    return table.concat(chunks)
end

-- Rozpakowuje ZIP do dest; każda nazwa wpisu sprawdzona (Sync.pluginEntryOK),
-- tylko pliki i katalogi (bez linków), limity jak na serwerze.
-- opts (opcjonalne, słowniki): max_unpacked, max_files, entry_ok(dir, path), skip(path) —
-- wpis, dla którego skip zwraca true, jest pomijany (nie liczy się do limitów i nie jest rozpakowywany).
local function extract(Archiver, zip_path, dir, dest, opts)
    opts = opts or {}
    local max_unpacked, max_files = opts.max_unpacked or PLUGIN_MAX_UNPACKED, opts.max_files or PLUGIN_MAX_FILES
    local entry_ok = opts.entry_ok or Sync.pluginEntryOK
    local arc = Archiver.Reader:new()
    if not arc:open(zip_path) then return nil, T(_("nieczytelny ZIP (%1)"), tostring(arc.err)) end
    local entries, total = {}, 0
    for e in arc:iterate() do
        if not entry_ok(dir, e.path) then
            arc:close()
            return nil, T(_("niedozwolona ścieżka w ZIP-ie: %1"), e.path)
        end
        if e.mode ~= "file" and e.mode ~= "directory" then
            arc:close()
            return nil, T(_("niedozwolony typ wpisu w ZIP-ie (%1): %2"), e.mode, e.path)
        end
        if not (opts.skip and opts.skip(e.path)) then
            total = total + (tonumber(e.size) or 0)
            entries[#entries + 1] = { path = e.path, mode = e.mode }
            if total > max_unpacked or #entries > max_files then
                arc:close()
                return nil, _("ZIP po rozpakowaniu jest za duży")
            end
        end
    end
    if arc.err then
        arc:close()
        return nil, T(_("uszkodzony ZIP (%1)"), tostring(arc.err))
    end
    util.makePath(dest)
    for _i, e in ipairs(entries) do
        local rel = e.path:gsub("/$", ""):sub(#dir + 2)
        if rel ~= "" then
            local out = dest .. "/" .. rel
            if e.mode == "directory" then
                util.makePath(out)
            else
                util.makePath(out:match("^(.*)/[^/]*$"))
                if not arc:extractToPath(e.path, out) then
                    local err = arc.err
                    arc:close()
                    return nil, T(_("nie udało się rozpakować %1 (%2)"), e.path, tostring(err))
                end
            end
        end
    end
    arc:close()
    return true
end

-- Jedna operacja planu. Zwraca true albo nil, komunikat. Nic nie rusza
-- katalogu bez znacznika .koligilo ani koligilo.koplugin.
function Koligilo:applyPluginOp(action, p, Archiver)
    local root = self:pluginRoot()
    local dir = p.dir
    if not Sync.pluginDirOK(dir) then return nil, _("niedozwolona nazwa katalogu") end
    local target = root .. "/" .. dir
    local marker = target .. "/" .. Sync.PLUGIN_MARKER
    local base = plugin_base(dir)
    local new = root .. "/.koligilo-new-" .. base
    local old = root .. "/.koligilo-old-" .. base
    local zip = root .. "/.koligilo-dl-" .. base .. ".zip"

    -- stan na dysku sprawdzamy jeszcze raz tuż przed zmianą
    if action == "remove" or action == "update" then
        if not is_dir(target) or not is_file(marker) then
            return nil, _("katalog nie ma znacznika .koligilo — nie ruszam wtyczki zainstalowanej ręcznie")
        end
    elseif lfs.attributes(target, "mode") ~= nil then
        return nil, _("na czytniku jest już ręcznie zainstalowana wtyczka o tej nazwie — koligilo jej nie nadpisze")
    end

    if action == "remove" then
        purge(old)
        local ok, err = os.rename(target, old)
        if not ok then return nil, T(_("nie udało się usunąć (%1)"), tostring(err)) end
        purge(old)
        return true
    end

    local server, token = self.settings:readSetting("server"), self.settings:readSetting("token")
    local body, derr = download(server .. p.url, token)
    if not body then return nil, derr end
    local got = require("ffi/sha2").sha256(body):lower()
    if got ~= p.sha256 then
        -- nic nie zostało zapisane: stara wersja nietknięta
        return nil, T(_("zła suma sha256 pobranego pliku (%1…) — instalacja przerwana"), got:sub(1, 12))
    end

    util.makePath(root)
    purge(new)
    purge(zip)
    local function cleanup() purge(new); purge(zip) end
    local ok, err = write_file(zip, body)
    body = nil -- luacheck: ignore
    if not ok then cleanup(); return nil, T(_("nie udało się zapisać pliku (%1)"), tostring(err)) end
    ok, err = extract(Archiver, zip, dir, new)
    if not ok then cleanup(); return nil, err end
    if not is_file(new .. "/main.lua") or not is_file(new .. "/_meta.lua") then
        cleanup()
        return nil, _("w ZIP-ie brakuje main.lua albo _meta.lua")
    end
    local meta = read_file(new .. "/_meta.lua", 65536)
    ok, err = write_file(new .. "/" .. Sync.PLUGIN_MARKER, Sync.markerEncode{
        sha256 = p.sha256, name = Sync.metaField(meta, "name") or p.name,
        version = Sync.metaField(meta, "version") or p.version,
    })
    if not ok then cleanup(); return nil, T(_("nie udało się zapisać znacznika (%1)"), tostring(err)) end
    purge(zip)

    -- atomowa podmiana z kopią poprzedniej wersji
    purge(old)
    local had_old = is_dir(target)
    if had_old then
        ok, err = os.rename(target, old)
        if not ok then cleanup(); return nil, T(_("nie udało się odsunąć starej wersji (%1)"), tostring(err)) end
    end
    ok, err = os.rename(new, target)
    if not ok then
        if had_old then os.rename(old, target) end -- rollback
        cleanup()
        return nil, T(_("nie udało się podmienić katalogu (%1)"), tostring(err))
    end
    if had_old then purge(old) end
    return true
end

---------------------------------------------------------------- wysyłka wtyczki na serwer (TASK-13)
-- Wtyczki spoza galerii (kopad, keyreader…) trzeba skądś wziąć, gdy kod
-- zniknął z kopii w dotfiles. Czytnik pakuje katalog do ZIP-a i wysyła go
-- na serwer; tam trafia ze źródłem „urządzenie” i wymaga akceptacji admina
-- w panelu, zanim da się ją przypisać innym czytnikom (PC-004).

--- Nazwy katalogów w katalogu danych użytkownika, które wolno wysłać:
-- bez wbudowanych (nie są w tym katalogu) i bez koligilo.koplugin
-- (Sync.pluginDirOK odrzuca je obie — jedno przez brak sufiksu, drugie
-- wprost po nazwie).
function Koligilo:sendableInventory()
    local root = self:pluginRoot()
    local out = {}
    if not is_dir(root) then return out end
    for entry in lfs.dir(root) do
        if entry:sub(1, 1) ~= "." and entry:match("%.koplugin$") and Sync.pluginDirOK(entry)
            and is_dir(root .. "/" .. entry) then
            out[#out + 1] = entry
        end
    end
    table.sort(out)
    return out
end

--- Lista względnych ścieżek plików do spakowania z katalogu wtyczki `dir`
-- (rekurencyjnie), z pominięciem symlinków i znacznika .koligilo
-- (Sync.pluginPackEntryOK — czysta logika, testowana w tests/sync_test.lua).
function Koligilo:pluginPackList(dir)
    local base = self:pluginRoot() .. "/" .. dir
    local files = {}
    local function walk(rel)
        local abs = rel ~= "" and (base .. "/" .. rel) or base
        for entry in lfs.dir(abs) do
            if entry ~= "." and entry ~= ".." then
                local erel = rel ~= "" and (rel .. "/" .. entry) or entry
                local mode = lfs.attributes(abs .. "/" .. entry, "mode")
                if Sync.pluginPackEntryOK(erel, mode) then
                    if mode == "directory" then walk(erel) else files[#files + 1] = erel end
                end
            end
        end
    end
    walk("")
    table.sort(files)
    return files
end

--- Pakuje katalog wtyczki `dir` do ZIP-a w pamięci (Archiver.Writer).
-- Zwraca treść ZIP-a albo nil, komunikat.
function Koligilo:packPlugin(Archiver, dir)
    local files = self:pluginPackList(dir)
    if #files == 0 then return nil, _("pusty katalog wtyczki") end
    local base = self:pluginRoot() .. "/" .. dir
    local zip_path = self:pluginRoot() .. "/.koligilo-send-" .. plugin_base(dir) .. ".zip"
    purge(zip_path)
    local wr = Archiver.Writer:new()
    if not wr:open(zip_path, "zip") then
        return nil, T(_("nie udało się utworzyć ZIP-a (%1)"), tostring(wr.err))
    end
    local ok, ferr = true, nil
    for _i, rel in ipairs(files) do
        local content = read_file(base .. "/" .. rel)
        if not content then ok, ferr = false, rel; break end
        if not wr:addFileFromMemory(dir .. "/" .. rel, content) then ok, ferr = false, wr.err; break end
    end
    wr:close()
    if not ok then
        purge(zip_path)
        return nil, T(_("nie udało się spakować %1"), tostring(ferr))
    end
    local body = read_file(zip_path)
    purge(zip_path)
    if not body then return nil, _("nie udało się odczytać spakowanego pliku") end
    return body
end

-- Wysyła surowy ZIP w ciele żądania (nie multipart) — POST /api/v1/plugins.
local function upload_zip(url, token, body, ctype)
    local sink = {}
    socketutil:set_timeout(socketutil.FILE_BLOCK_TIMEOUT, socketutil.FILE_TOTAL_TIMEOUT)
    local code, headers, status = socket.skip(1, http.request{
        url = url, method = "POST", source = ltn12.source.string(body), sink = ltn12.sink.table(sink),
        headers = {
            ["Authorization"] = "Bearer " .. token, ["Content-Type"] = ctype or "application/zip",
            ["Content-Length"] = tostring(#body), ["Accept"] = "application/json",
        },
    })
    socketutil:reset_timeout()
    if headers == nil then return nil, nil, tostring(status or code) end
    local ok, data = pcall(JSON.decode, table.concat(sink))
    if not ok or type(data) ~= "table" then data = nil end
    return code, data
end

--- Pakuje i wysyła wtyczkę `dir` na serwer, po potwierdzeniu użytkownika.
function Koligilo:sendPluginToServer(dir)
    local has_archiver, Archiver = pcall(require, "ffi/archiver")
    if not has_archiver then
        UIManager:show(InfoMessage:new{ text = _("Ten czytnik nie potrafi pakować ZIP-ów (brak ffi/archiver).") })
        return
    end
    local msg = InfoMessage:new{ text = _("Pakuję i wysyłam…") }
    UIManager:show(msg)
    UIManager:forceRePaint()
    local packed_ok, body, perr = pcall(self.packPlugin, self, Archiver, dir)
    if not packed_ok then body, perr = nil, tostring(body) end
    if not body then
        UIManager:close(msg)
        UIManager:show(InfoMessage:new{ text = T(_("Nie udało się spakować wtyczki: %1"), perr) })
        return
    end
    local server, token = self.settings:readSetting("server"), self.settings:readSetting("token")
    local code, data, neterr = upload_zip(server .. "/api/v1/plugins", token, body)
    UIManager:close(msg)
    if code == 200 and data and data.plugin then
        UIManager:show(InfoMessage:new{ text = _("Wysłano. Zaakceptuj w panelu koligilo, zanim trafi na inne czytniki.") })
    else
        UIManager:show(InfoMessage:new{ text = T(_("Nie udało się wysłać wtyczki: %1"), error_text(code, data, neterr)) })
    end
end

function Koligilo:confirmSendPlugin(dir)
    UIManager:show(ConfirmBox:new{
        text = T(_("Wysłać wtyczkę „%1” na serwer koligilo?\n\nBędzie widoczna w panelu ze źródłem „urządzenie” i będzie wymagać akceptacji administratora, zanim będzie można zainstalować ją na innych czytnikach."), plugin_base(dir)),
        ok_text = _("Wyślij"),
        ok_callback = function() self:sendPluginToServer(dir) end,
    })
end

--- Pozycje podmenu „Wyślij wtyczkę na serwer”.
function Koligilo:sendPluginMenu()
    local dirs = self:sendableInventory()
    if #dirs == 0 then
        return { { text = _("Brak wtyczek do wysłania w katalogu danych"), enabled_func = function() return false end } }
    end
    local items = {}
    for _i, dir in ipairs(dirs) do
        items[#items + 1] = {
            text = plugin_base(dir),
            keep_menu_open = true,
            callback = function() self:confirmSendPlugin(dir) end,
        }
    end
    return items
end

local function plugin_label(p, with_old)
    local name = p.name and p.name ~= "" and p.name or plugin_base(p.dir)
    local v = p.version and p.version ~= "" and p.version or "?"
    if with_old then
        v = (p.old_version and p.old_version ~= "" and p.old_version or "?") .. " → " .. v
    end
    return T("  • %1 %2 (%3)", name, v, p.dir)
end

local function plan_text(plan)
    local lines = { _("koligilo chce zmienić wtyczki na tym czytniku:") }
    local sections = {
        { "install", _("Zainstalować:") }, { "update", _("Zaktualizować:") }, { "remove", _("Usunąć:") },
    }
    for _i, s in ipairs(sections) do
        if #plan[s[1]] > 0 then
            lines[#lines + 1] = ""
            lines[#lines + 1] = s[2]
            for _j, p in ipairs(plan[s[1]]) do lines[#lines + 1] = plugin_label(p, s[1] == "update") end
        end
    end
    lines[#lines + 1] = ""
    lines[#lines + 1] = _("Wtyczki to programy z pełnym dostępem do czytnika. Zgódź się tylko, jeśli to Ty przypisałeś je w panelu koligilo.")
    return table.concat(lines, "\n")
end

function Koligilo:addPluginResults(list)
    if #list == 0 then return end
    local pending = self.settings:readSetting("plugin_results") or {}
    for _i, r in ipairs(list) do
        if #pending >= 200 then break end
        pending[#pending + 1] = r
    end
    self.settings:saveSetting("plugin_results", pending)
    self.settings:flush()
end

--- Etap wtyczek po synchronizacji ustawień. Zwraca true, jeśli pokazał okno
-- (wtedy sam poprosi o restart, także za zmienione ustawienia).
function Koligilo:handlePlugins(target, inventory, silent, changed)
    local plan = Sync.pluginPlan(target, inventory)
    local errs = {}
    for _i, p in ipairs(plan.conflict) do
        errs[#errs + 1] = { dir = p.dir, sha256 = p.sha256, action = "install", status = "error", error = p.error }
    end
    for _i, p in ipairs(plan.invalid) do
        errs[#errs + 1] = { dir = p.dir, sha256 = p.sha256, action = "install", status = "error", error = p.error }
    end
    self:addPluginResults(errs)
    if Sync.pluginPlanEmpty(plan) or plugin_dialog_open then return false end

    local key = Sync.pluginPlanKey(plan)
    -- odrzucony plan nie wraca w tle przy każdym Wi-Fi; ręczna synchronizacja pyta znowu
    if silent and key == self.settings:readSetting("plugin_rejected_key") then return false end

    local has_archiver, Archiver = pcall(require, "ffi/archiver")
    if not has_archiver then
        logger.warn("koligilo: brak ffi/archiver", Archiver)
        self:addPluginResults(Sync.pluginResults(plan, "error", "KOReader bez modułu ffi/archiver (potrzebny v2025.08 lub nowszy)"))
        if not silent then
            UIManager:show(InfoMessage:new{ text = _("Ta wersja KOReadera nie umie rozpakować wtyczek (brak modułu ffi/archiver). Zaktualizuj KOReadera do wersji 2025.08 lub nowszej. Nic nie zostało zmienione.") })
        end
        return false
    end

    local function restart_or_done(text)
        if changed > 0 then
            text = text .. "\n\n" .. T(_("Pobrano też %1 zmienionych ustawień."), changed)
        end
        UIManager:askForRestart(text)
    end

    plugin_dialog_open = true
    UIManager:show(ConfirmBox:new{
        text = plan_text(plan),
        ok_text = _("Zmień wtyczki"),
        cancel_text = _("Nie teraz"),
        ok_callback = function()
            plugin_dialog_open = false
            self.settings:delSetting("plugin_rejected_key")
            NetworkMgr:runWhenOnline(function()
                local msg = InfoMessage:new{ text = _("Instaluję wtyczki…") }
                UIManager:show(msg)
                UIManager:forceRePaint()
                local results, n_ok, failures = {}, 0, {}
                for _i, action in ipairs({ "remove", "update", "install" }) do
                    for _j, p in ipairs(plan[action]) do
                        local okc, ok, err = pcall(self.applyPluginOp, self, action, p, Archiver)
                        if not okc then ok, err = nil, tostring(ok) end
                        local r = { dir = p.dir, sha256 = p.sha256, action = action, status = ok and "ok" or "error" }
                        if ok then
                            n_ok = n_ok + 1
                        else
                            r.error = tostring(err)
                            failures[#failures + 1] = p.dir .. ": " .. r.error
                            logger.warn("koligilo: wtyczka", action, p.dir, err)
                        end
                        results[#results + 1] = r
                    end
                end
                UIManager:close(msg)
                self:addPluginResults(results)
                local text = T(_("Zmieniono wtyczki: %1."), n_ok)
                if #failures > 0 then
                    text = text .. "\n\n" .. _("Nie udało się:") .. "\n" .. table.concat(failures, "\n")
                end
                if n_ok > 0 or changed > 0 then
                    restart_or_done(text .. "\n\n" .. _("KOReader musi się uruchomić ponownie, aby wczytać wtyczki."))
                else
                    UIManager:show(InfoMessage:new{ text = text })
                end
            end)
        end,
        cancel_callback = function()
            plugin_dialog_open = false
            self.settings:saveSetting("plugin_rejected_key", key)
            self:addPluginResults(Sync.pluginResults(plan, "rejected"))
            if changed > 0 then
                UIManager:askForRestart(T(_("koligilo pobrał %1 zmienionych ustawień z innych urządzeń. KOReader musi się uruchomić ponownie, aby je zastosować."), changed))
            end
        end,
    })
    return true
end

---------------------------------------------------------------- samoaktualizacja (TASK-39, PC-019)
-- koligilo.koplugin zastępuje samo siebie, ale tylko: (1) za zgodą z menu czytnika,
-- (2) po potwierdzeniu w oknie z numerami wersji, (3) do wersji WYŻSZEJ, (4) z zipa
-- o sumie sha256 podanej przez uwierzytelniony serwer. Instalator zwykłych wtyczek
-- (applyPluginOp) dalej NIGDY nie rusza koligilo.koplugin — to osobna, węższa ścieżka.

--- Sprzątanie po poprzedniej aktualizacji: stara wersja leżała w .koligilo-old-koligilo
-- (nazwa bez końcówki .koplugin, więc KOReader jej nie ładuje), na wypadek gdyby
-- nowa nie wystartowała. Skoro init właśnie działa, nowa wersja się wczytała.
function Koligilo:cleanupSelfUpdate()
    if restart_pending or not self.selfParent then return end
    local old = self.selfParent .. "/.koligilo-old-koligilo"
    if is_dir(old) then purge(old) end
end

--- Pobiera, sprawdza i podmienia katalog pluginu. Zwraca true albo nil, komunikat.
-- Stara wersja zostaje nietknięta, jeśli cokolwiek po drodze się nie zgadza.
function Koligilo:applySelfUpdate(info, Archiver)
    local parent, current = self.selfParent, self.selfVersion
    if not parent or not current then
        return nil, _("nie wiem, gdzie jest zainstalowane koligilo ani w jakiej wersji — zaktualizuj ręcznie")
    end
    if not Sync.versionNewer(info.version, current) then return nil, _("to nie jest nowsza wersja") end
    local dir = "koligilo.koplugin"
    local target = parent .. "/" .. dir
    local new = parent .. "/.koligilo-new-koligilo"
    local old = parent .. "/.koligilo-old-koligilo"
    local zip = parent .. "/.koligilo-dl-koligilo.zip"
    if not is_file(target .. "/main.lua") then return nil, _("nie widzę katalogu pluginu na dysku") end

    local server, token = self.settings:readSetting("server"), self.settings:readSetting("token")
    local body, derr = download(server .. info.url, token, Sync.SELF_MAX_ZIP)
    if not body then return nil, derr end
    local got = require("ffi/sha2").sha256(body):lower()
    if got ~= info.sha256 then
        return nil, T(_("zła suma sha256 pobranego pliku (%1…) — aktualizacja przerwana"), got:sub(1, 12))
    end

    local function cleanup() purge(new); purge(zip) end
    purge(new); purge(zip)
    local ok, err = write_file(zip, body)
    body = nil -- luacheck: ignore
    if not ok then cleanup(); return nil, T(_("nie udało się zapisać pliku (%1)"), tostring(err)) end
    ok, err = extract(Archiver, zip, dir, new)
    if not ok then cleanup(); return nil, err end
    for _i, f in ipairs({ "main.lua", "_meta.lua", "sync.lua" }) do
        if not is_file(new .. "/" .. f) then cleanup(); return nil, T(_("w ZIP-ie brakuje %1"), f) end
        -- loadfile tylko kompiluje plik (niczego nie uruchamia); zepsuty plugin
        -- zostawiłby czytnik bez koligilo, więc wolimy odmówić przed podmianą
        local chunk, cerr = loadfile(new .. "/" .. f)
        if not chunk then cleanup(); return nil, T(_("błąd składni w %1: %2"), f, tostring(cerr)) end
    end
    if Sync.metaField(read_file(new .. "/_meta.lua", 65536), "version") ~= info.version then
        cleanup()
        return nil, _("wersja w pobranym pluginie nie zgadza się z zapowiedzianą")
    end
    purge(zip)

    purge(old)
    ok, err = os.rename(target, old)
    if not ok then cleanup(); return nil, T(_("nie udało się odsunąć starej wersji (%1)"), tostring(err)) end
    ok, err = os.rename(new, target)
    if not ok then
        os.rename(old, target) -- rollback
        cleanup()
        return nil, T(_("nie udało się podmienić katalogu (%1)"), tostring(err))
    end
    return true
end

--- Etap samoaktualizacji po synchronizacji. Zwraca true, jeśli pokazał okno
-- (wtedy sam zadba o restart, także za zmienione ustawienia).
function Koligilo:handleSelfUpdate(raw, silent, changed)
    local info, why = Sync.selfUpdateInfo(raw, self.selfVersion)
    if not info then
        if why then logger.warn("koligilo: wskazanie aktualizacji pluginu odrzucone:", why) end
        return false
    end
    if plugin_dialog_open or restart_pending then return false end
    -- odrzuconą wersję w tle nie pytamy drugi raz; ręczna synchronizacja pyta znowu
    if silent and info.version == self.settings:readSetting("self_update_rejected") then return false end

    local has_archiver, Archiver = pcall(require, "ffi/archiver")
    if not has_archiver then
        logger.warn("koligilo: brak ffi/archiver", Archiver)
        if not silent then
            UIManager:show(InfoMessage:new{ text = _("Ta wersja KOReadera nie umie rozpakować aktualizacji (brak modułu ffi/archiver). Zaktualizuj KOReadera do wersji 2025.08 lub nowszej.") })
        end
        return false
    end

    plugin_dialog_open = true
    UIManager:show(ConfirmBox:new{
        text = T(_("Jest nowa wersja koligilo: %1 → %2.\n\nAktualizacja zastąpi program koligilo na tym czytniku plikiem pobranym z Twojego serwera (%3) i sprawdzonym sumą sha256. Ustawienia i parowanie zostają. Po instalacji KOReader musi się uruchomić ponownie.\n\nTo program z pełnym dostępem do czytnika — zgódź się tylko, jeśli sam wypuściłeś tę wersję."),
            self.selfVersion or "?", info.version, self.settings:readSetting("server") or "?"),
        ok_text = _("Aktualizuj"),
        cancel_text = _("Nie teraz"),
        ok_callback = function()
            plugin_dialog_open = false
            self.settings:delSetting("self_update_rejected")
            NetworkMgr:runWhenOnline(function()
                local msg = InfoMessage:new{ text = _("Aktualizuję koligilo…") }
                UIManager:show(msg)
                UIManager:forceRePaint()
                local okc, ok, err = pcall(self.applySelfUpdate, self, info, Archiver)
                if not okc then ok, err = nil, tostring(ok) end
                UIManager:close(msg)
                if ok then
                    restart_pending = true
                    local text = T(_("koligilo zaktualizowane do wersji %1. KOReader musi się uruchomić ponownie, aby ją wczytać."), info.version)
                    if changed > 0 then text = text .. "\n\n" .. T(_("Pobrano też %1 zmienionych ustawień."), changed) end
                    UIManager:askForRestart(text)
                else
                    logger.warn("koligilo: samoaktualizacja", err)
                    UIManager:show(InfoMessage:new{ text = T(_("Nie udało się zaktualizować koligilo — zostaje obecna wersja.\n\n%1"), tostring(err)) })
                end
            end)
        end,
        cancel_callback = function()
            plugin_dialog_open = false
            self.settings:saveSetting("self_update_rejected", info.version)
            self.settings:flush()
            if changed > 0 then
                UIManager:askForRestart(T(_("koligilo pobrał %1 zmienionych ustawień z innych urządzeń. KOReader musi się uruchomić ponownie, aby je zastosować."), changed))
            end
        end,
    })
    return true
end

---------------------------------------------------------------- czcionki (TASK-36, PC-018)
-- Katalog fonts/koligilo w danych KOReadera (KOReader skanuje fonts/ rekurencyjnie).
-- Ruszamy wyłącznie pliki z manifestu .koligilo-fonts.

function Koligilo:fontRoot() return DataStorage:getDataDir() .. "/fonts" end
function Koligilo:fontDir() return DataStorage:getDataDir() .. "/" .. Sync.FONT_DIR end

--- Manifest (plik → sha256) i to, co faktycznie leży w katalogu (plik → rozmiar).
function Koligilo:fontState()
    local dir = self:fontDir()
    local managed = Sync.fontManifestDecode(read_file(dir .. "/" .. Sync.FONT_MANIFEST, 1048576))
    local present = {}
    if is_dir(dir) then
        for entry in lfs.dir(dir) do
            if entry:sub(1, 1) ~= "." and Sync.fontNameOK(entry) and is_file(dir .. "/" .. entry) then
                present[entry] = lfs.attributes(dir .. "/" .. entry, "size")
            end
        end
    end
    return managed, present
end

--- Inwentarz dla serwera: zarządzane pliki, które naprawdę leżą na dysku.
function Koligilo:fontInventory()
    local managed, present = self:fontState()
    local list = {}
    for file, sha in pairs(managed) do
        if present[file] then list[#list + 1] = { file = file, sha256 = sha } end
    end
    table.sort(list, function(a, b) return a.file < b.file end)
    return list
end

function Koligilo:saveFontManifest(managed)
    local dir = self:fontDir()
    util.makePath(dir)
    return write_file(dir .. "/" .. Sync.FONT_MANIFEST, Sync.fontManifestEncode(managed))
end

-- Jedna operacja planu. Zwraca true albo nil, komunikat; manifest zapisuje wołający.
function Koligilo:applyFontOp(action, f, managed)
    local dir = self:fontDir()
    if not Sync.fontNameOK(f.file) then return nil, _("niedozwolona nazwa pliku") end
    local target = dir .. "/" .. f.file
    if action == "remove" then
        if managed[f.file] == nil then return nil, _("pliku nie ma w manifeście koligilo — nie ruszam czcionki dodanej ręcznie") end
        if is_file(target) then
            local ok, err = os.remove(target)
            if not ok then return nil, T(_("nie udało się usunąć (%1)"), tostring(err)) end
        end
        managed[f.file] = nil
        return true
    end
    local server, token = self.settings:readSetting("server"), self.settings:readSetting("token")
    local body, derr = download(server .. f.url, token, Sync.FONT_MAX_SIZE, "application/octet-stream")
    if not body then return nil, derr end
    local got = require("ffi/sha2").sha256(body):lower()
    if got ~= f.sha256 then
        return nil, T(_("zła suma sha256 pobranego pliku (%1…) — instalacja przerwana"), got:sub(1, 12))
    end
    if not Sync.fontMagicOK(f.file, body:sub(1, 4)) then return nil, _("to nie jest plik czcionki") end
    util.makePath(dir)
    local tmp = dir .. "/." .. f.file .. ".new"
    local ok, err = write_file(tmp, body)
    body = nil -- luacheck: ignore
    if not ok then purge(tmp); return nil, T(_("nie udało się zapisać pliku (%1)"), tostring(err)) end
    if action == "update" then os.remove(target) end -- rename na istniejący plik nie zawsze działa (FAT/Android)
    ok, err = os.rename(tmp, target)
    if not ok then purge(tmp); return nil, T(_("nie udało się zapisać czcionki (%1)"), tostring(err)) end
    managed[f.file] = f.sha256
    return true
end

--- Etap czcionek po synchronizacji ustawień. Bez pytania (zgoda jest w menu).
-- Zwraca { n = ile zmieniono, failures = { … }, deferred = ile czeka na następny raz }.
function Koligilo:handleFonts(target)
    local managed, present = self:fontState()
    local plan = Sync.fontPlan(target, managed, present)
    for _i, p in ipairs(plan.conflict) do logger.warn("koligilo: czcionka", p.file, p.error) end
    for _i, p in ipairs(plan.invalid) do logger.warn("koligilo: czcionka", p.file, p.error) end
    local res = { n = 0, failures = {}, deferred = #plan.deferred }
    if Sync.fontPlanEmpty(plan) then return res end
    for _i, action in ipairs({ "remove", "update", "install" }) do
        for _j, f in ipairs(plan[action]) do
            local okc, ok, err = pcall(self.applyFontOp, self, action, f, managed)
            if not okc then ok, err = nil, tostring(ok) end
            if ok then
                res.n = res.n + 1
            else
                res.failures[#res.failures + 1] = f.file .. ": " .. tostring(err)
                logger.warn("koligilo: czcionka", action, f.file, err)
            end
        end
    end
    local ok, err = self:saveFontManifest(managed)
    if not ok then
        res.failures[#res.failures + 1] = T(_("manifest: %1"), tostring(err))
        logger.warn("koligilo: manifest czcionek", err)
    end
    return res
end

---------------------------------------------------------------- wysyłka czcionki na serwer

--- Czcionki leżące bezpośrednio w fonts/ (nie nasze, nie z podkatalogów), które wolno wysłać.
function Koligilo:sendableFonts()
    local root = self:fontRoot()
    local out = {}
    if not is_dir(root) then return out end
    for entry in lfs.dir(root) do
        local p = root .. "/" .. entry
        local size = is_file(p) and lfs.attributes(p, "size") or 0
        if Sync.fontNameOK(entry) and size >= 12 and size <= Sync.FONT_MAX_SIZE then
            out[#out + 1] = { file = entry, size = size }
        end
    end
    table.sort(out, function(a, b) return a.file:lower() < b.file:lower() end)
    return out
end

function Koligilo:sendFontToServer(file)
    local msg = InfoMessage:new{ text = _("Wysyłam…") }
    UIManager:show(msg)
    UIManager:forceRePaint()
    local body = read_file(self:fontRoot() .. "/" .. file)
    if not body or not Sync.fontMagicOK(file, body:sub(1, 4)) then
        UIManager:close(msg)
        UIManager:show(InfoMessage:new{ text = _("To nie wygląda na plik czcionki — nie wysyłam.") })
        return
    end
    local server, token = self.settings:readSetting("server"), self.settings:readSetting("token")
    local code, data, neterr = upload_zip(server .. "/api/v1/fonts?file=" .. file:gsub("[^%w%.%-_]", function(c)
        return string.format("%%%02X", c:byte())
    end), token, body, "application/octet-stream")
    UIManager:close(msg)
    if code == 200 and data and data.font then
        UIManager:show(InfoMessage:new{ text = _("Wysłano. Zaakceptuj w panelu koligilo, zanim trafi na inne czytniki.") })
    else
        UIManager:show(InfoMessage:new{ text = T(_("Nie udało się wysłać czcionki: %1"), error_text(code, data, neterr)) })
    end
end

function Koligilo:sendFontMenu()
    local list = self:sendableFonts()
    if #list == 0 then
        return { { text = _("Brak czcionek do wysłania w katalogu fonts"), enabled_func = function() return false end } }
    end
    local items = {}
    for _i, f in ipairs(list) do
        items[#items + 1] = {
            text = T(_("%1 (%2 KB)"), f.file, math.floor(f.size / 1024)),
            keep_menu_open = true,
            callback = function()
                UIManager:show(ConfirmBox:new{
                    text = T(_("Wysłać czcionkę „%1” na serwer koligilo?\n\nBędzie widoczna w panelu i wymaga akceptacji administratora, zanim trafi na inne czytniki."), f.file),
                    ok_text = _("Wyślij"),
                    ok_callback = function() self:sendFontToServer(f.file) end,
                })
            end,
        }
    end
    return items
end

---------------------------------------------------------------- słowniki (TASK-55, PC-020)
-- Katalog data/dict/koligilo w danych KOReadera (KOReader skanuje data/dict rekurencyjnie po .ifo).
-- Ruszamy wyłącznie katalogi z manifestu .koligilo-dicts. Pobranie i rozpakowanie idą przez
-- staging POZA data/dict, bo niedokończony katalog ze słownikiem byłby tam widoczny dla KOReadera.

function Koligilo:dictDir() return DataStorage:getDataDir() .. "/" .. Sync.DICT_DIR end
function Koligilo:dictStaging() return DataStorage:getDataDir() .. "/data/.koligilo-dict-staging" end

--- Manifest (nazwa → sha256) i to, co faktycznie leży w katalogu (nazwa → true).
function Koligilo:dictState()
    local dir = self:dictDir()
    local managed = Sync.dictManifestDecode(read_file(dir .. "/" .. Sync.DICT_MANIFEST, 1048576))
    local present = {}
    if is_dir(dir) then
        for entry in lfs.dir(dir) do
            if entry:sub(1, 1) ~= "." and Sync.dictNameOK(entry) and is_dir(dir .. "/" .. entry) then
                present[entry] = true
            end
        end
    end
    return managed, present
end

--- Inwentarz dla serwera: zarządzane słowniki, które naprawdę leżą na dysku.
function Koligilo:dictInventory()
    local managed, present = self:dictState()
    local list = {}
    for name, sha in pairs(managed) do
        if present[name] then list[#list + 1] = { name = name, sha256 = sha } end
    end
    table.sort(list, function(a, b) return a.name < b.name end)
    return list
end

function Koligilo:saveDictManifest(managed)
    local dir = self:dictDir()
    util.makePath(dir)
    return write_file(dir .. "/" .. Sync.DICT_MANIFEST, Sync.dictManifestEncode(managed))
end

-- Pobiera do pliku (bez buforowania w pamięci — słownik ma do 300 MB) i liczy sha256
-- przyrostowo. Zwraca sha256 (małe litery) i rozmiar albo nil, błąd, brak_sieci.
local function download_to_file(url, token, dest, limit)
    local fh, oerr = io.open(dest, "wb")
    if not fh then return nil, T(_("nie udało się zapisać pliku (%1)"), tostring(oerr)) end
    local feed = require("ffi/sha2").sha256()
    local size, sink_err = 0, nil
    local sink = function(chunk)
        if chunk == nil or chunk == "" then return 1 end
        size = size + #chunk
        if size > limit then sink_err = _("za duży plik"); return nil, sink_err end
        local ok, werr = fh:write(chunk)
        if not ok then sink_err = T(_("nie udało się zapisać pliku (%1)"), tostring(werr)); return nil, sink_err end
        feed(chunk)
        return 1
    end
    socketutil:set_timeout(30, 1200)
    local code, headers, status = socket.skip(1, http.request{
        url = url, method = "GET", sink = sink,
        headers = { ["Authorization"] = "Bearer " .. token, ["Accept"] = "application/zip" },
    })
    socketutil:reset_timeout()
    fh:close()
    if headers == nil then
        purge(dest)
        if sink_err then return nil, sink_err end
        return nil, T(_("brak połączenia (%1)"), tostring(status or code)), true
    end
    if code ~= 200 then
        purge(dest)
        if code == 403 then return nil, _("serwer odmówił (brak zgody albo słownik niezaakceptowany)") end
        return nil, T(_("serwer odpowiedział błędem HTTP %1"), code)
    end
    return (feed() or ""):lower(), size
end

-- Czy w drzewie jest choć jeden plik .ifo (słownik StarDict) — prosta kontrola po rozpakowaniu.
local function has_ifo(dir, depth)
    if depth > 6 or not is_dir(dir) then return false end
    for entry in lfs.dir(dir) do
        if entry ~= "." and entry ~= ".." then
            local p = dir .. "/" .. entry
            if is_file(p) and entry:lower():match("%.ifo$") then return true end
            if is_dir(p) and has_ifo(p, depth + 1) then return true end
        end
    end
    return false
end

-- Jedna operacja planu. Zwraca true albo nil, komunikat, brak_sieci; manifest zapisuje wołający.
function Koligilo:applyDictOp(action, f, managed)
    local name = f.name
    if not Sync.dictNameOK(name) then return nil, _("niedozwolona nazwa słownika") end
    local dir = self:dictDir()
    local target = dir .. "/" .. name
    if action == "remove" then
        if managed[name] == nil then return nil, _("słownika nie ma w manifeście koligilo — nie ruszam słownika dodanego ręcznie") end
        if is_dir(target) then
            ffiutil.purgeDir(target)
            if is_dir(target) then return nil, _("nie udało się usunąć katalogu słownika") end
        end
        managed[name] = nil
        return true
    end
    local server, token = self.settings:readSetting("server"), self.settings:readSetting("token")
    -- miejsce: ZIP + rozpakowane (+ zapas); brak API w tym KOReaderze = nie sprawdzamy
    if type(util.diskUsage) == "function" then
        local okd, du = pcall(util.diskUsage, DataStorage:getDataDir())
        local avail = okd and type(du) == "table" and tonumber(du.available) or nil
        local need = (tonumber(f.size) or 0) + math.ceil((tonumber(f.unpacked) or 0) * 1.2)
        if avail and avail < need then
            return nil, T(_("za mało miejsca na dysku (potrzeba ok. %1 MB)"), math.ceil(need / 1048576))
        end
    end
    local staging = self:dictStaging()
    purge(staging) -- pozostałość po przerwanej operacji
    util.makePath(staging)
    local function bail(msg, netfail) purge(staging); return nil, msg, netfail end
    local zip = staging .. "/dl.zip"
    local limit = math.min((tonumber(f.size) or 0) + 65536, Sync.DICT_MAX_ZIP)
    local got, derr, netfail = download_to_file(server .. f.url, token, zip, limit)
    if not got then return bail(derr, netfail) end
    if got ~= f.sha256 then
        return bail(T(_("zła suma sha256 pobranego pliku (%1…) — instalacja przerwana"), got:sub(1, 12)))
    end
    local has_archiver, Archiver = pcall(require, "ffi/archiver")
    if not has_archiver then return bail(_("brak ffi/archiver w tym KOReaderze")) end
    local newdir = staging .. "/new"
    local ok, err = extract(Archiver, zip, name, newdir, {
        max_unpacked = Sync.DICT_MAX_UNPACKED, max_files = Sync.DICT_MAX_FILES,
        entry_ok = Sync.dictEntryOK, skip = Sync.dictEntrySkip,
    })
    if not ok then return bail(err) end
    os.remove(zip) -- zwalniamy miejsce przed podmianą
    if not has_ifo(newdir, 0) then return bail(_("to nie jest słownik StarDict (brak pliku .ifo)")) end
    util.makePath(dir)
    local old = staging .. "/old"
    if is_dir(target) then
        if managed[name] == nil then return bail(_("katalog o tej nazwie już istnieje i nie jest zarządzany przez koligilo")) end
        ok, err = os.rename(target, old)
        if not ok then return bail(T(_("nie udało się zastąpić starego słownika (%1)"), tostring(err))) end
    end
    ok, err = os.rename(newdir, target)
    if not ok then
        if is_dir(old) then
            -- rollback: stary słownik wraca na miejsce; gdyby i to się nie udało, zostawiamy go w stagingu
            local back, berr = os.rename(old, target)
            if not back then
                return nil, T(_("nie udało się zainstalować słownika (%1); stary leży w %2 (%3)"), tostring(err), old, tostring(berr))
            end
        end
        return bail(T(_("nie udało się zainstalować słownika (%1)"), tostring(err)))
    end
    purge(staging)
    managed[name] = f.sha256
    return true
end

--- Etap słowników po synchronizacji ustawień. Bez pytania (zgoda jest w menu).
-- Zwraca { n = ile zmieniono, failures = { … }, deferred = ile czeka na następny raz }.
function Koligilo:handleDicts(target, silent)
    local managed, present = self:dictState()
    local plan = Sync.dictPlan(target, managed, present)
    for _i, p in ipairs(plan.conflict) do logger.warn("koligilo: słownik", p.name, p.error) end
    for _i, p in ipairs(plan.invalid) do logger.warn("koligilo: słownik", p.name, p.error) end
    local res = { n = 0, failures = {}, deferred = #plan.deferred }
    if Sync.dictPlanEmpty(plan) then return res end
    for _i, p in ipairs(plan.forget) do managed[p.name] = nil end
    local total = #plan.remove + #plan.update + #plan.install
    local done, offline = 0, false
    for _i, action in ipairs({ "remove", "update", "install" }) do
        for _j, f in ipairs(plan[action]) do
            if offline then
                res.deferred = res.deferred + 1
            else
                done = done + 1
                local msg
                if action ~= "remove" and not silent then
                    msg = InfoMessage:new{ text = T(_("Pobieram słownik %1 (%2 z %3)…"), f.name, done, total) }
                    UIManager:show(msg)
                    UIManager:forceRePaint()
                end
                local okc, ok, err, netfail = pcall(self.applyDictOp, self, action, f, managed)
                if not okc then ok, err = nil, tostring(ok) end
                if msg then UIManager:close(msg) end
                if ok then
                    res.n = res.n + 1
                else
                    res.failures[#res.failures + 1] = f.name .. ": " .. tostring(err)
                    logger.warn("koligilo: słownik", action, f.name, err)
                    if netfail then offline = true end -- kolejne próby tylko by czekały na timeouty
                end
            end
        end
    end
    local ok, err = self:saveDictManifest(managed)
    if not ok then
        res.failures[#res.failures + 1] = T(_("manifest: %1"), tostring(err))
        logger.warn("koligilo: manifest słowników", err)
    end
    return res
end

---------------------------------------------------------------- synchronizacja

function Koligilo:sync(silent, after_move)
    -- po samoaktualizacji pliki na dysku są nowe, a w pamięci stare: nic nie robimy do restartu
    if restart_pending then
        if not silent then UIManager:askForRestart(_("koligilo zostało zaktualizowane. KOReader musi się uruchomić ponownie.")) end
        return
    end
    local server, token = self.settings:readSetting("server"), self.settings:readSetting("token")
    if not token then return end
    local function fail(text)
        logger.warn("koligilo:", text)
        if not silent then UIManager:show(InfoMessage:new{ text = text }) end
    end

    -- zgoda na wtyczki idzie wyłącznie z czytnika; bez parametru = zgoda cofnięta
    local plugins_allowed = self.settings:isTrue("plugins_allowed")
    local fonts_allowed = self.settings:isTrue("fonts_allowed") -- jak wyżej: zgoda tylko z czytnika
    local query = {}
    if plugins_allowed then query[#query + 1] = "plugins_allowed=1" end
    if fonts_allowed then query[#query + 1] = "fonts_allowed=1" end
    local dicts_allowed = self.settings:isTrue("dicts_allowed") -- jak wyżej: zgoda tylko z czytnika
    if dicts_allowed then query[#query + 1] = "dicts_allowed=1" end
    local self_update_allowed = self.settings:isTrue("self_update_allowed")
    if self_update_allowed then query[#query + 1] = "self_update=1" end
    -- zgoda na scalanie statystyk i słowniczka: panel tylko ją pokazuje (TASK-46)
    if self.settings:isTrue("merge_after_sync") then query[#query + 1] = "merge_after_sync=1" end
    if self.settings:isTrue("wallabag_after_sync") then query[#query + 1] = "wallabag_after_sync=1" end
    -- wersja wtyczki: panel pokaże czytnik ze starą wtyczką (TASK-49); tylko poprawny X.Y.Z
    if Sync.versionParse(self.selfVersion) then query[#query + 1] = "plugin_version=" .. self.selfVersion end
    -- ekran: żeby panel mógł pokazać podgląd strony także dla modelu, którego nie zna
    local ok_screen, screen = pcall(function()
        local scr = Device.screen
        return Sync.screenParam(scr:getWidth(), scr:getHeight(), scr:getDPI(),
            scr.isColorScreen and scr:isColorScreen())
    end)
    if ok_screen and screen then query[#query + 1] = "screen=" .. screen end
    -- wcześniejsze wstrzymanie, którego nie udało się zgłosić osobnym żądaniem (TASK-50)
    local blocked = Sync.blockedCount(self.settings:readSetting("sync_blocked"))
    if blocked then query[#query + 1] = "sync_blocked=" .. blocked end
    local code, remote, neterr = request("GET", server .. "/api/v1/sync"
        .. (#query > 0 and ("?" .. table.concat(query, "&")) or ""), token)
    -- TASK-15: dane przeniesiono na inny serwer — ten sam token, nowy adres.
    -- Stary serwer jest zaufany (zna nasz token), więc przyjmujemy jego
    -- wskazanie, ale tylko w bezpiecznej postaci (Sync.movedURL) i raz na sync.
    if code == 410 and remote and remote.moved_to then
        local new = not after_move and Sync.movedURL(server, remote.moved_to)
        if not new then
            return fail(T(_("Serwer koligilo wskazuje nowy adres, którego nie mogę przyjąć (%1). Połącz czytnik ponownie z menu koligilo."), tostring(remote.moved_to)))
        end
        logger.warn("koligilo: przeniesiono z", server, "na", new)
        self.settings:saveSetting("server", new)
        self.settings:flush()
        UIManager:show(InfoMessage:new{ text = T(_("koligilo przeniesiono na %1.\n\nTen czytnik synchronizuje się odtąd z nowym adresem — ponowne łączenie nie jest potrzebne."), new), timeout = 6 })
        return self:sync(silent, true)
    end
    if code == 401 then
        self.settings:delSetting("token")
        self.settings:flush()
        return fail(_("To urządzenie zostało odłączone w panelu koligilo. Połącz je ponownie z menu koligilo."))
    end
    if code ~= 200 or not remote or type(remote.entries) ~= "table" then
        return fail(T(_("Synchronizacja nie powiodła się: %1"), error_text(code, remote, neterr)))
    end

    local files = self:loadFiles(remote.entries, remote)
    local base = self.settings:readSetting("base") or {}
    local plan = Sync.plan(remote.entries, files, base, remote)

    if Sync.suspicious(plan, base) then
        -- panel ma wiedzieć, dlaczego ten czytnik milczy (TASK-50)
        self:reportBlocked(server, token, #plan.delete)
        -- pokazujemy zawsze, także w trybie cichym: to coś podejrzanego
        UIManager:show(InfoMessage:new{ text = T(_("koligilo wstrzymał synchronizację: wyglądało na to, że %1 ustawień zniknęło naraz z tego urządzenia. Nic nie zostało wysłane ani zmienione.\n\nJeśli to zamierzone, zmień ustawienia pojedynczo albo wyłącz ich grupy w panelu."), #plan.delete) })
        return
    end

    local n_apply = 0
    for _k in pairs(plan.apply) do n_apply = n_apply + 1 end
    local n_up = #plan.delete
    for _k in pairs(plan.upload) do n_up = n_up + 1 end

    -- Najpierw wysyłka: jeśli się nie uda, niczego lokalnie nie zmieniamy
    -- i baza zostaje stara — następna próba policzy to samo.
    local body = { received = n_apply, note = platform_name() }
    if next(plan.upload) then body.set = plan.upload end
    if #plan.delete > 0 then body.delete = plan.delete end
    -- Raport wtyczek: błąd tutaj nie może zepsuć synchronizacji ustawień.
    local inv_ok, inventory = pcall(self.pluginInventory, self)
    if not inv_ok then
        logger.warn("koligilo: inwentarz wtyczek", inventory)
        inventory = nil
    end
    local sent_results = self.settings:readSetting("plugin_results") or {}
    if inventory then
        local installed = inventory_list(inventory)
        -- puste tabele Lua JSON zakoduje jako {}, a Go czeka listy — nie wysyłamy pustych
        if #installed > 0 then
            body.plugins = { installed = installed }
            if #sent_results > 0 then body.plugins.results = sent_results end
        end
    end
    if fonts_allowed then
        -- `reported` zawsze: pusta lista Lua zakodowałaby się jako {} (serwer czeka listy),
        -- a bez raportu panel nie dowiedziałby się, że ostatnia czcionka zniknęła
        local fok, installed = pcall(self.fontInventory, self)
        if fok then
            body.fonts = { reported = true }
            if #installed > 0 then body.fonts.installed = installed end
        else
            logger.warn("koligilo: inwentarz czcionek", installed)
        end
    end
    if dicts_allowed then
        -- jak przy czcionkach: `reported` zawsze, bo pusta lista Lua zakodowałaby się jako {}
        local dok, installed = pcall(self.dictInventory, self)
        if dok then
            body.dicts = { reported = true }
            if #installed > 0 then body.dicts.installed = installed end
        else
            logger.warn("koligilo: inwentarz słowników", installed)
        end
    end
    local c2, resp, neterr2 = request("POST", server .. "/api/v1/sync", token, body)
    if c2 ~= 200 then
        return fail(T(_("Wysyłanie ustawień nie powiodło się: %1"), error_text(c2, resp, neterr2)))
    end
    if body.plugins and body.plugins.results then
        self.settings:delSetting("plugin_results")
    end
    self.settings:delSetting("sync_blocked") -- udana synchronizacja (serwer sam czyści zgłoszenie przy zapisie)
    for _i, id in ipairs(resp and resp.rejected or {}) do
        plan.base[id] = base[id] -- serwer nie przyjął — spróbujemy znowu
    end

    local dirty, changed = Sync.applyPlan(plan, files)
    for f in pairs(dirty) do
        local file = files[f]
        if file.obj then file.obj:flush() end
    end
    self.settings:saveSetting("base", plan.base)
    self.settings:saveSetting("last_sync", os.time())
    self.settings:flush()

    local skipped = 0
    for _k in pairs(plan.skipped) do skipped = skipped + 1 end
    if next(plan.skipped) then logger.warn("koligilo: pominięte", plan.skipped) end
    if next(plan.masked) then logger.warn("koligilo: nie wysłano kont z krótkotrwałym tokenem Dropbox", plan.masked) end

    -- Czcionki: po ustawieniach, przed wtyczkami (te mogą pokazać okno i zakończyć sync).
    local font_res
    if fonts_allowed and type(remote.fonts) == "table" then
        local okf, res = pcall(self.handleFonts, self, remote.fonts)
        if okf then
            font_res = res
        else
            logger.warn("koligilo: czcionki", res)
            font_res = { n = 0, failures = { tostring(res):sub(1, 200) }, deferred = 0 }
        end
    end

    -- Słowniki: duże pobrania nie ruszają w trakcie czytania — wtedy wszystko czeka na następny raz.
    local dict_res
    if dicts_allowed and type(remote.dicts) == "table" then
        if self:isReading() then
            local okd, managed, present = pcall(self.dictState, self)
            local plan = okd and Sync.dictPlan(remote.dicts, managed, present)
            if plan and not Sync.dictPlanEmpty(plan) then
                dict_res = { n = 0, failures = {}, deferred = #plan.install + #plan.update, reading = true }
            end
        else
            local okd, res = pcall(self.handleDicts, self, remote.dicts, silent)
            if okd then
                dict_res = res
            else
                logger.warn("koligilo: słowniki", res)
                dict_res = { n = 0, failures = { tostring(res):sub(1, 200) }, deferred = 0 }
            end
        end
    end

    -- Etap wtyczek dopiero po ustawieniach i tylko ze stanem od serwera,
    -- o który czytnik sam poprosił. Wyjątek nie psuje synchronizacji.
    if plugins_allowed and inventory and type(remote.plugins) == "table" then
        local okp, shown = pcall(self.handlePlugins, self, remote.plugins, inventory, silent, changed)
        if not okp then
            logger.warn("koligilo: wtyczki", shown)
            self:addPluginResults({ { dir = "*", action = "install", status = "error", error = tostring(shown):sub(1, 200) } })
        elseif shown then
            return
        end
    end

    -- Na końcu, żeby nie pokazać dwóch okien naraz (wtyczki mają pierwszeństwo).
    if self_update_allowed and remote.self_update ~= nil then
        local oks, shown = pcall(self.handleSelfUpdate, self, remote.self_update, silent, changed)
        if not oks then logger.warn("koligilo: samoaktualizacja", shown) elseif shown then return end
    end

    local font_text
    if font_res and (font_res.n > 0 or #font_res.failures > 0) then
        font_text = T(_("Zmieniono czcionki: %1. Pojawią się w menu czcionek po ponownym uruchomieniu KOReadera."), font_res.n)
        if font_res.deferred > 0 then font_text = font_text .. " " .. T(_("Kolejne (%1) pobiorą się przy następnej synchronizacji."), font_res.deferred) end
        if #font_res.failures > 0 then font_text = font_text .. "\n\n" .. _("Nie udało się:") .. "\n" .. table.concat(font_res.failures, "\n") end
    end
    if dict_res and not dict_res.reading and (dict_res.n > 0 or #dict_res.failures > 0) then
        local dict_text = T(_("Zmieniono słowniki: %1. Pojawią się w KOReaderze po ponownym otwarciu książki."), dict_res.n)
        if dict_res.deferred > 0 then dict_text = dict_text .. " " .. T(_("Kolejne (%1) pobiorą się przy następnej synchronizacji."), dict_res.deferred) end
        if #dict_res.failures > 0 then dict_text = dict_text .. "\n\n" .. _("Nie udało się:") .. "\n" .. table.concat(dict_res.failures, "\n") end
        font_text = font_text and (font_text .. "\n\n" .. dict_text) or dict_text
    end
    -- Wspólne bazy (statystyki, słowniczek): zdarzenia bez argumentu = ciche scalanie KOReadera.
    self:mergeSharedData(changed)
    self:wallabagAfterSync(changed)

    if changed > 0 then
        UIManager:askForRestart(T(_("koligilo pobrał %1 zmienionych ustawień z innych urządzeń. KOReader musi się uruchomić ponownie, aby je zastosować."), changed)
            .. (font_text and ("\n\n" .. font_text) or ""))
    elseif font_text and not silent then
        UIManager:show(InfoMessage:new{ text = font_text })
    elseif not silent then
        local text = n_up > 0 and T(_("Wysłano %1 ustawień do innych urządzeń. Tu wszystko jest aktualne."), n_up)
            or _("Wszystko aktualne — nic do wysłania ani pobrania.")
        if skipped > 0 then text = text .. "\n\n" .. T(_("Pominięto %1 ustawień, których nie da się przenieść (szczegóły w crash.log)."), skipped) end
        UIManager:show(InfoMessage:new{ text = text, timeout = 4 })
    end
    self:showConsentsHint(silent)
end

-- Jednorazowa informacja po pierwszej niecichej synchronizacji, gdzie są zgody (TASK-46).
-- Niczego nie włącza — tylko mówi, że wszystko jest domyślnie wyłączone i gdzie to zmienić.
function Koligilo:showConsentsHint(silent)
    if not Sync.consentsHintDue(self.settings:isTrue("consents_hint_shown"), silent) then return false end
    self.settings:makeTrue("consents_hint_shown")
    self.settings:flush()
    UIManager:show(InfoMessage:new{ text = _("Zgody koligilo: instalowanie wtyczek, czcionki, słowniki, aktualizacja koligilo, scalanie statystyk i pobieranie artykułów Wallabag są na tym czytniku domyślnie wyłączone. Nic nie zostało włączone.\n\nGdybyś chciał z nich skorzystać, włączysz je tu: Menu → Narzędzia → koligilo → Zgody. Panel koligilo ich nie włącza — zgodę zawsze daje się na czytniku.") })
    return true
end

-- Wstrzymanie przez bezpiecznik (TASK-50): najpierw zapamiętujemy je w ustawieniach (gdyby
-- zgłoszenie się nie udało, pójdzie z najbliższą synchronizacją, która dojdzie do serwera),
-- potem zgłaszamy lekkim żądaniem `report_only` — bez wartości i bez ruszania reszty stanu.
-- Zwraca true, gdy serwer przyjął zgłoszenie. Błąd sieci nie może zepsuć niczego innego.
function Koligilo:reportBlocked(server, token, count)
    local rec = Sync.blockedRecord(count, os.time())
    if not rec then return false end
    self.settings:saveSetting("sync_blocked", rec)
    self.settings:flush()
    local ok, code = pcall(request, "GET", server .. "/api/v1/sync?report_only=1&sync_blocked=" .. rec.deleted, token)
    if not ok or code ~= 200 then
        logger.warn("koligilo: zgłoszenie wstrzymanej synchronizacji", ok and code or "wyjątek")
        return false
    end
    return true
end

-- Wyjątek w cudzej wtyczce (statystyki, słowniczek) nie może zepsuć synchronizacji.
function Koligilo:mergeSharedData(changed)
    local events = Sync.mergeEvents(self.settings:isTrue("merge_after_sync"), changed)
    if #events == 0 then return end
    local Event = require("ui/event")
    for _i, name in ipairs(events) do
        local ok, err = pcall(function() UIManager:broadcastEvent(Event:new(name)) end)
        if not ok then logger.warn("koligilo: scalanie " .. name, err) end
    end
end

-- Czy czytnik jest teraz w książce (ReaderUI.instance istnieje tylko podczas czytania).
function Koligilo:isReading()
    local ok, ReaderUI = pcall(require, "apps/reader/readerui")
    return ok and ReaderUI ~= nil and ReaderUI.instance ~= nil
end

-- Pobranie artykułów Wallabag (TASK-45): nie jest ciche, więc wyłącznie w menedżerze plików.
function Koligilo:wallabagAfterSync(changed)
    local name = Sync.wallabagEvent(self.settings:isTrue("wallabag_after_sync"), changed, self:isReading())
    if not name then return false end
    local Event = require("ui/event")
    local ok, err = pcall(function() UIManager:broadcastEvent(Event:new(name)) end)
    if not ok then logger.warn("koligilo: " .. name, err) end
    return ok
end

function Koligilo:onNetworkConnected()
    if not self:isPaired() or not self.settings:nilOrTrue("auto_sync") then return end
    -- pierwsza synchronizacja tylko ręcznie (askFirstSync / menu), nie po cichu
    if not self.settings:readSetting("last_sync") then return end
    local last = self.settings:readSetting("last_sync") or 0
    if os.time() - last < AUTO_SYNC_MIN_INTERVAL then return end
    -- chwila oddechu: sieć dopiero wstała, inne pluginy też się synchronizują
    UIManager:scheduleIn(5, function() self:sync(true) end)
end

-- Cicha synchronizacja po wybudzeniu (TASK-44): tylko gdy sieć JUŻ jest — nigdy nie
-- włączamy Wi-Fi ani nie otwieramy okien (poza oknem podejrzanej synchronizacji).
function Koligilo:shouldResumeSync()
    return Sync.shouldSyncOnResume(self:isPaired(), self.settings:nilOrTrue("auto_sync"), NetworkMgr:isOnline(),
        self.settings:readSetting("last_sync"), os.time(), AUTO_SYNC_MIN_INTERVAL)
end

function Koligilo:onResume()
    if self._resume_pending or not self:shouldResumeSync() then return end
    self._resume_pending = true
    UIManager:scheduleIn(RESUME_SYNC_DELAY, function()
        self._resume_pending = false
        -- po zwłoce decyzja od nowa: sieć mogła zniknąć, a onNetworkConnected zdążyć z synchronizacją
        if self:shouldResumeSync() then self:sync(true) end
    end)
end

return Koligilo
