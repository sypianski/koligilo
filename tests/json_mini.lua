-- Minimalny JSON tylko na potrzeby testu e2e (na czytniku plugin używa json z KOReadera).
local J = {}

local function enc_str(s)
    return '"' .. s:gsub('[%c"\\]', function(c)
        local m = { ['"'] = '\\"', ["\\"] = "\\\\", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" }
        return m[c] or string.format("\\u%04x", c:byte())
    end) .. '"'
end

function J.encode(v)
    local t = type(v)
    if t == "string" then return enc_str(v)
    elseif t == "number" or t == "boolean" then return tostring(v)
    elseif t == "nil" then return "null"
    elseif t == "table" then
        if #v > 0 or next(v) == nil and getmetatable(v) == J.array then
            local p = {}
            for i = 1, #v do p[i] = J.encode(v[i]) end
            return "[" .. table.concat(p, ",") .. "]"
        end
        local p = {}
        for k, x in pairs(v) do p[#p + 1] = enc_str(tostring(k)) .. ":" .. J.encode(x) end
        return "{" .. table.concat(p, ",") .. "}"
    end
    error("json: typ " .. t)
end
J.array = {}

function J.decode(s)
    local pos = 1
    local function ws() pos = s:find("[^ \t\r\n]", pos) or #s + 1 end
    local val
    local function str()
        pos = pos + 1
        local buf = {}
        while true do
            local c = s:sub(pos, pos)
            if c == '"' then pos = pos + 1; return table.concat(buf) end
            if c == "\\" then
                local e = s:sub(pos + 1, pos + 1)
                if e == "u" then
                    local cp = tonumber(s:sub(pos + 2, pos + 5), 16)
                    buf[#buf + 1] = utf8.char(cp); pos = pos + 6
                else
                    buf[#buf + 1] = ({ n = "\n", r = "\r", t = "\t", b = "\b", f = "\f" })[e] or e
                    pos = pos + 2
                end
            else
                local j = s:find('["\\]', pos)
                buf[#buf + 1] = s:sub(pos, j - 1); pos = j
            end
        end
    end
    function val()
        ws()
        local c = s:sub(pos, pos)
        if c == "{" then
            pos = pos + 1; local t = {}; ws()
            if s:sub(pos, pos) == "}" then pos = pos + 1; return t end
            while true do
                ws(); local k = str(); ws(); pos = pos + 1 -- ':'
                t[k] = val(); ws()
                local d = s:sub(pos, pos); pos = pos + 1
                if d == "}" then return t end
            end
        elseif c == "[" then
            pos = pos + 1; local t = {}; ws()
            if s:sub(pos, pos) == "]" then pos = pos + 1; return t end
            while true do
                t[#t + 1] = val(); ws()
                local d = s:sub(pos, pos); pos = pos + 1
                if d == "]" then return t end
            end
        elseif c == '"' then return str()
        elseif s:sub(pos, pos + 3) == "true" then pos = pos + 4; return true
        elseif s:sub(pos, pos + 4) == "false" then pos = pos + 5; return false
        elseif s:sub(pos, pos + 3) == "null" then pos = pos + 4; return nil
        else
            local n = s:match("^-?[%d.eE+-]+", pos); pos = pos + #n; return tonumber(n)
        end
    end
    return val()
end

return J
