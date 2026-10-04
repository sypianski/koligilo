--[[--
Generator web/koreader_opts.js — mapa ustawień KOReadera dla widoku
„Wspólne ustawienia” (TASK-22). Uruchamiaj przez scripts/koreader-opts.sh,
który przypina źródła KOReadera do tagu.

    lua scripts/koreader-opts.lua <koreader-src> <koreader.po> <tag> <commit-l10n> <epub.css> <commit-crengine> > web/koreader_opts.js

Czyta prosto ze źródeł KOReadera:
  • frontend/ui/data/creoptions.lua — opcje dolnego menu (nazwy, values,
    toggle/labels, domyślne, zakresy z more_options_param, help_text),
  • frontend/ui/data/css_tweaks.lua — poprawki stylu (id, tytuł, opis, kategorie),
  • defaults.lua — wartości G_defaults (presety marginesów, interlinii…),
  • l10n/pl/koreader.po — polskie teksty (msgctxt+msgid → msgstr),
  • dane do podglądu strony (TASK-23): CSS poprawek stylu, domyślny arkusz
    crengine epub.css (plik z repo crengine przypiętego w submodule base),
    ReaderFooter.default_settings, czcionki z credocument.lua.
Stopka, listy i czcionki mają małą ręczną mapę (klucz → msgid) na dole.

Pliki KOReadera wykonujemy (dofile/require) z atrapami modułów — to lokalne,
przypięte do tagu źródła, nie dane z serwera. Wynik jest deterministyczny
(posortowane klucze), żeby diff przy odświeżeniu pokazywał tylko zmiany.
--]]--

local SRC, PO, TAG, L10N, EPUB_CSS, CRENGINE = arg[1], arg[2], arg[3], arg[4], arg[5], arg[6]
assert(SRC and PO and TAG and L10N and EPUB_CSS and CRENGINE,
    "użycie: lua koreader-opts.lua <src> <po> <tag> <commit-l10n> <epub.css> <commit-crengine>")

---------------------------------------------------------------- .po

local function po_unescape(s)
    return (s:gsub("\\(.)", { n = "\n", t = "\t", ['"'] = '"', ["\\"] = "\\" }))
end

-- KOReader (gettext.lua) pomija wpisy fuzzy i puste — robimy tak samo.
local TR = {}
do
    local f = assert(io.open(PO, "rb"))
    local cur, field, fuzzy = {}, nil, false
    local function flush()
        if cur.msgid and cur.msgstr and cur.msgstr ~= "" and not fuzzy then
            TR[(cur.msgctxt and (cur.msgctxt .. "\4") or "") .. cur.msgid] = cur.msgstr
        end
        cur, field, fuzzy = {}, nil, false
    end
    for line in f:lines() do
        if line:match("^#,.*fuzzy") then fuzzy = true
        elseif line:match("^%s*$") then flush()
        elseif line:match("^#") then -- komentarz
        else
            local kw, str = line:match('^(msg%a+)%s+"(.*)"%s*$')
            if kw then
                field = (kw == "msgctxt" or kw == "msgid" or kw == "msgstr") and kw or nil
                if field then cur[field] = po_unescape(str) end
            else
                str = line:match('^%s*"(.*)"%s*$')
                if str and field then cur[field] = cur[field] .. po_unescape(str) end
            end
        end
    end
    flush()
    f:close()
end

local missing, EN = {}, {} -- EN: tekst PL → angielski msgid (rozpoznawanie „off/on”)
-- pl: własny tekst, gdy KOReader nie ma takiego napisu (np. nazwy kart dolnego menu to ikony)
local function tr(msgid, ctx, pl)
    local s = TR[(ctx and (ctx .. "\4") or "") .. msgid]
    if not s and pl then s = pl end
    if not s then missing[#missing + 1] = (ctx and (ctx .. "|") or "") .. msgid; s = msgid end
    EN[s] = EN[s] or msgid
    return s
end

---------------------------------------------------------------- atrapy KOReadera

local function template(s, ...)
    local args = { ... }
    return (s:gsub("%%(%d)", function(i) return tostring(args[tonumber(i)] or "") end))
end

local gettext = setmetatable({ pgettext = function(ctx, s) return tr(s, ctx) end,
    ngettext = function(s) return tr(s) end }, { __call = function(_, s) return tr(s) end })

local defaults = dofile(SRC .. "/defaults.lua")
G_defaults = { readSetting = function(_, k) return defaults[k] end }

local Screen = { DEVICE_ROTATED_UPRIGHT = 0, DEVICE_ROTATED_CLOCKWISE = 1,
    DEVICE_ROTATED_UPSIDE_DOWN = 2, DEVICE_ROTATED_COUNTER_CLOCKWISE = 3,
    getRotationMode = function() return 0 end, scaleByDPI = function(_, v) return v end }
local Device = setmetatable({ screen = Screen }, { __index = function() return function() return true end end })
local dummy = setmetatable({}, { __index = function() return function() end end })

package.loaded["device"] = Device
package.loaded["gettext"] = gettext
package.loaded["ffi/util"] = { template = template, orderedPairs = pairs }
package.loaded["util"] = dummy
package.loaded["ui/data/optionsutil"] = setmetatable({ rotation_labels = {}, rotation_modes = {} },
    { __index = function() return function() end end })

local CreOptions = dofile(SRC .. "/frontend/ui/data/creoptions.lua")
local CssTweaks = dofile(SRC .. "/frontend/ui/data/css_tweaks.lua")

---------------------------------------------------------------- sekcje (jak menu czytnika)

local R = "settings.reader.lua"
local SECTIONS = {
    { id = "font", label = tr("Font") },
    { id = "layout", label = tr("Page layout", nil, "Układ strony") },
    { id = "doc", label = tr("Document settings") },
    { id = "tweaks", label = tr("Style tweaks") },
    { id = "footer", label = tr("Status bar") },
    { id = "lists", label = tr("File browser") },
    { id = "stats", label = tr("Reading statistics") },
}
local SECTION_OF = {
    font_size = "font", font_base_weight = "font", font_gamma = "font",
    font_hinting = "font", font_kerning = "font",
    h_page_margins = "layout", sync_t_b_page_margins = "layout", t_page_margin = "layout",
    b_page_margin = "layout", line_spacing = "layout", word_spacing = "layout",
    word_expansion = "layout", cjk_width_scaling = "layout", visible_pages = "layout",
    view_mode = "doc", block_rendering_mode = "doc", render_dpi = "doc", status_line = "doc",
    embedded_css = "doc", embedded_fonts = "doc", smooth_scaling = "doc", nightmode_images = "doc",
}

---------------------------------------------------------------- creoptions → opcje

local function is_pair(v) return type(v) == "table" and #v == 2 end

local function number_label(v, unit)
    if is_pair(v) then
        return v[1] == v[2] and tostring(v[1]) or (v[1] .. " / " .. v[2])
    end
    local s = tostring(v)
    return unit and (s .. "\u{202F}" .. unit) or s
end

local opts = {}
for _, tab in ipairs(CreOptions) do
    for _, o in ipairs(tab.options) do
        local sec = SECTION_OF[o.name]
        if sec and o.values then
            local mp = o.more_options_param or {}
            local unit = mp.unit
            if (o.name:match("margin")) then unit = "px" end
            if o.name == "font_size" then unit = "pt" end
            local opt = {
                file = R, key = "copt_" .. o.name, section = sec,
                label = o.name_text or o.alt_name_text or (mp.name_text) or o.name,
                help = o.help_text or mp.info_text,
                default = o.default_value, unit = unit,
            }
            local vals = o.values
            if #vals == 0 and o.name == "word_spacing" then
                vals = { defaults.DCREREADER_CONFIG_WORD_SPACING_SMALL,
                    defaults.DCREREADER_CONFIG_WORD_SPACING_MEDIUM, defaults.DCREREADER_CONFIG_WORD_SPACING_LARGE }
                opt.default = defaults.DCREREADER_CONFIG_WORD_SPACING_MEDIUM
            elseif #vals == 0 and o.name == "word_expansion" then
                vals = { defaults.DCREREADER_CONFIG_WORD_EXPANSION_NONE,
                    defaults.DCREREADER_CONFIG_WORD_EXPANSION_SOME, defaults.DCREREADER_CONFIG_WORD_EXPANSION_MORE }
                opt.default = defaults.DCREREADER_CONFIG_WORD_EXPANSION_NONE
            end
            if o.show == false then vals = {} end -- ukryte w menu: tylko pole liczbowe
            local labels = {}
            for i, v in ipairs(vals) do
                local l = (o.toggle and o.toggle[i]) or (o.labels and o.labels[i]) or (o.item_text and o.item_text[i])
                labels[i] = l and tostring(l) or number_label(v, unit)
            end
            opt.kind = "choice"
            opt.values, opt.labels = vals, labels
            -- przełącznik: dwie wartości opisane w KOReaderze jako „off/on” (po angielskim msgid)
            if #vals == 2 and o.toggle and EN[o.toggle[1]] == "off" and EN[o.toggle[2]] == "on" then
                opt.kind, opt.off, opt.on = "switch", vals[1], vals[2]
            end
            if mp.left_min and type(opt.default) ~= "table" then
                -- górny/dolny margines osobno: KOReader edytuje je parą, my każdy z osobna
                opt.custom = { min = mp.left_min, max = mp.left_max, step = mp.left_step, unit = unit }
            elseif mp.left_min then
                opt.custom = { pair = true, unit = mp.unit or unit,
                    left = { label = mp.left_text, min = mp.left_min, max = mp.left_max, step = mp.left_step },
                    right = { label = mp.right_text, min = mp.right_min, max = mp.right_max, step = mp.right_step } }
            elseif mp.value_min then
                opt.custom = { min = mp.value_min, max = mp.value_max, step = mp.value_step, unit = mp.unit or unit }
            end
            opts[#opts + 1] = opt
            -- rozmiar czcionki: presety z font_size, zakres z font_fine_tune
            if o.name == "font_size" then opt.custom = { min = 12, max = 255, step = 0.5, unit = "pt" } end
        end
    end
end

---------------------------------------------------------------- mapa ręczna (klucz → msgid)

local function strip_tpl(s) return (s:gsub("%s*%(%%1%)", ""):gsub("%s*%%1", "")) end

local function add(t) opts[#opts + 1] = t end

add({ file = R, key = "cre_font", section = "font", kind = "font", label = tr("Font") })
add({ file = R, key = "fallback_font", section = "font", kind = "font", label = tr("Fallback", "Font") })
add({ file = R, key = "style_tweaks", section = "tweaks", kind = "tweaks", label = tr("Style tweaks") })

local FOOTER_FLAGS = {
    { "disable_progress_bar", "Show progress bar", invert = true },
    { "chapter_progress_bar", "Show chapter-progress bar instead" },
    { "toc_markers", "Show chapter markers" },
    { "initial_marker", "Show initial-position marker" },
    { "all_at_once", "Show all selected items at once" },
    { "reclaim_height", "Overlap status bar" },
    { "page_progress", "Current page (%1)" },
    { "pages_left_book", "Pages left in book (%1)" },
    { "pages_left", "Pages left in chapter (%1)" },
    { "chapter_progress", "Current page in chapter (%1)" },
    { "percentage", "Progress percentage" },
    { "book_time_to_read", "Time left to finish book" },
    { "chapter_time_to_read", "Time left to finish chapter (%1)" },
    { "time", "Current time" },
    { "battery", "Battery percentage (%1)" },
    { "frontlight", "Brightness level (%1)" },
    { "wifi_status", "Wi-Fi status (%1)" },
    { "mem_usage", "KOReader memory usage (%1)" },
    { "bookmark_count", "Bookmark count (%1)" },
    { "book_author", "Book author" },
    { "book_title", "Book title" },
    { "book_chapter", "Chapter title" },
    { "auto_refresh_time", "Auto refresh items" },
    { "bottom_horizontal_separator", "Show status bar separator" },
    { "lock_tap", "Lock status bar" },
}
local flags = {}
for _, f in ipairs(FOOTER_FLAGS) do
    flags[#flags + 1] = { k = f[1], label = strip_tpl(tr(f[2])), invert = f.invert or nil }
end
add({ file = R, key = "footer", section = "footer", kind = "flags", label = tr("Status bar"),
    flags = flags, nums = { { k = "text_font_size", label = tr("Item font size"), min = 8, max = 36, step = 1, unit = "pt" } } })

add({ file = R, key = "reverse_collate", section = "lists", kind = "bool", label = tr("Reverse sorting") })
add({ file = R, key = "collate_mixed", section = "lists", kind = "bool", label = tr("Folders and files mixed") })
add({ file = R, key = "statistics.freeze_finished_books", section = "stats", kind = "bool",
    label = tr("Freeze statistics of finished books") })
add({ file = R, key = "statistics.calendar_show_histogram", section = "stats", kind = "bool",
    label = tr("Show hourly histogram in calendar days") })

---------------------------------------------------------------- poprawki stylu

local tweaks = {}
local function walk(node, path)
    for _, item in ipairs(node) do
        if type(item) == "table" then
            if item.id then
                local css = type(item.css) == "string" and item.css:gsub("^%s+", ""):gsub("%s+$", "") or nil
                tweaks[#tweaks + 1] = { id = item.id, title = item.title, desc = item.description, cat = path, css = css }
            elseif item.title then
                walk(item, path and (path .. " › " .. item.title) or item.title)
            end
        end
    end
end
walk(CssTweaks, nil)

---------------------------------------------------------------- podgląd strony (TASK-23)

local function readfile(path)
    local f = assert(io.open(path, "rb")); local t = f:read("a"); f:close(); return t
end

-- ReaderFooter.default_settings: sam literał tabeli, wykonany w piaskownicy
-- z atrapami Device/Screen (readerfooter.lua ciągnie za sobą pół UI).
local function footer_defaults()
    local src = readfile(SRC .. "/frontend/apps/reader/modules/readerfooter.lua")
    local body = assert(src:match("\nReaderFooter%.default_settings = (%b{})"), "brak ReaderFooter.default_settings")
    local env = {
        Device = { hasBattery = function() return true end, hasAuxBattery = function() return false end,
            isAndroid = function() return false end },
        Screen = { scaleByDPI = function(_, v) return v end },
        G_defaults = G_defaults,
    }
    return assert(load("return " .. body, "footer", "t", env))()
end

local cred = readfile(SRC .. "/frontend/document/credocument.lua")
local fallback_fonts = {}
for name in assert(cred:match("fallback_fonts = (%b{})"), "brak fallback_fonts"):gmatch('"([^"]+)"') do
    fallback_fonts[#fallback_fonts + 1] = name
end
local PREVIEW = {
    crengine = CRENGINE,
    epub_css = readfile(EPUB_CSS),
    default_font = assert(cred:match('default_font = "([^"]+)"')),
    header_font = assert(cred:match('header_font = "([^"]+)"')),
    fallback_fonts = fallback_fonts,
    footer = footer_defaults(),
    minibar_height = defaults.DMINIBAR_CONTAINER_HEIGHT,
    cre_header_size = tonumber(readfile(SRC .. "/frontend/apps/reader/modules/readercoptlistener.lua")
        :match("CRE_HEADER_DEFAULT_SIZE = (%d+)")),
}

---------------------------------------------------------------- wyjście

local function json(v)
    local t = type(v)
    if t == "string" then
        return '"' .. v:gsub('[%c"\\]', function(c)
            return ({ ['"'] = '\\"', ["\\"] = "\\\\", ["\n"] = "\\n", ["\t"] = "\\t" })[c]
                or string.format("\\u%04x", c:byte())
        end) .. '"'
    elseif t == "number" then
        if v == math.floor(v) and math.abs(v) < 2 ^ 53 then return string.format("%d", v) end
        return string.format("%.17g", v)
    elseif t == "boolean" then return tostring(v)
    elseif t == "table" then
        if next(v) == nil then return "[]" end
        if #v > 0 then
            local p = {}
            for i = 1, #v do p[i] = json(v[i]) end
            return "[" .. table.concat(p, ",") .. "]"
        end
        local ks = {}
        for k in pairs(v) do ks[#ks + 1] = k end
        table.sort(ks)
        local p = {}
        for _, k in ipairs(ks) do p[#p + 1] = json(k) .. ":" .. json(v[k]) end
        return "{" .. table.concat(p, ",") .. "}"
    end
    error("typ " .. t)
end

io.write("// WYGENEROWANE przez scripts/koreader-opts.sh — nie edytuj ręcznie.\n")
io.write("// Źródło: KOReader " .. TAG .. ", tłumaczenia koreader-translations@" .. L10N:sub(1, 12) .. " (pl).\n")
io.write('"use strict";\n')
io.write("const KO = {\n")
io.write("  version: " .. json(TAG) .. ",\n")
io.write("  l10n: " .. json(L10N) .. ",\n")
io.write("  generated: " .. json(os.date("!%Y-%m-%d")) .. ",\n")
io.write("  sections: " .. json(SECTIONS) .. ",\n")
-- Opis → bloki: napis = akapit, tablica = lista punktów. Znaczniki „- ”/„• ”
-- z formatowania KOReadera zdejmujemy tutaj, UI rysuje listę po swojemu.
local function help_blocks(text)
    if not text then return nil end
    local blocks, list = {}, nil
    for line in (text .. "\n"):gmatch("(.-)\n") do
        line = line:gsub("^%s+", ""):gsub("%s+$", "")
        local item = line:match("^[-•▶▸*]%s+(.+)$")
        if item then
            if not list then list = {}; blocks[#blocks + 1] = list end
            list[#list + 1] = item
        elseif line ~= "" then
            list = nil
            blocks[#blocks + 1] = line
        else
            list = nil
        end
    end
    return #blocks > 0 and blocks or nil
end

for _, o in ipairs(opts) do
    -- każda opcja musi mieć nazwę do pokazania — pusta etykieta rozjeżdża wiersz
    assert(type(o.label) == "string" and o.label ~= "" and o.label ~= o.key, "brak etykiety: " .. o.key)
    o.help = help_blocks(o.help)
    for _, f in ipairs(o.flags or {}) do assert(f.label ~= "", "brak etykiety: " .. o.key .. "." .. f.k) end
end

io.write("  opts: [\n")
for _, o in ipairs(opts) do io.write("    " .. json(o) .. ",\n") end
io.write("  ],\n  tweaks: [\n")
for _, tw in ipairs(tweaks) do io.write("    " .. json(tw) .. ",\n") end
io.write("  ],\n  preview: " .. json(PREVIEW) .. ",\n};\n")
io.write('if (typeof module !== "undefined") module.exports = KO;\n')

if #missing > 0 then
    io.stderr:write("brak tłumaczenia PL (" .. #missing .. "):\n")
    local seen = {}
    for _, m in ipairs(missing) do
        if not seen[m] then seen[m] = true; io.stderr:write("  " .. m:gsub("\n", "\\n"):sub(1, 90) .. "\n") end
    end
end
io.stderr:write(string.format("opcji: %d, poprawek stylu: %d\n", #opts, #tweaks))
