-- Wzorzec dla tests/luaser_test.js: czyta ze stdin wartości w prostym zapisie
-- tokenów (n <liczba> | s <hex UTF-8> | b 0/1 | t <ile> <klucz> <wartość>…),
-- jedna wartość na linię, i wypisuje Sync.serialize każdej z nich.
-- Tryb "fix": linie to literały z JS — wypisuje serialize(deserialize(linia)).
package.path = "plugin/koligilo.koplugin/?.lua;" .. package.path
local Sync = require("sync")

local mode = arg[1] or "values"
for line in io.lines() do
    if mode == "fix" then
        local v, err = Sync.deserialize(line)
        io.write(v == nil and ("BŁĄD " .. tostring(err)) or assert(Sync.serialize(v)), "\n")
    else
        local toks, i = {}, 0
        for t in line:gmatch("%S+") do toks[#toks + 1] = t end
        local function nxt() i = i + 1; return toks[i] end
        local function val()
            local tag = nxt()
            if tag == "n" then return assert(tonumber(nxt()))
            elseif tag == "s" then
                return (nxt():sub(2):gsub("%x%x", function(h) return string.char(tonumber(h, 16)) end))
            elseif tag == "b" then return nxt() == "1"
            elseif tag == "t" then
                local t = {}
                for _ = 1, tonumber(nxt()) do local k = val(); t[k] = val() end
                return t
            end
            error("zły token " .. tostring(tag))
        end
        io.write(assert(Sync.serialize(val())), "\n")
    end
end
