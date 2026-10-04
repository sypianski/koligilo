-- E2E przenosin (TASK-15): czytnik sparowany z serwerem A, eksport A → import
-- na B, A odpowiada 410 {moved_to}, czytnik (logika jak w Koligilo:sync)
-- przepina się i synchronizuje z B tym samym tokenem.
--   lua tests/e2e_move.lua http://A adminA http://B adminB
package.path = "plugin/koligilo.koplugin/?.lua;tests/?.lua;" .. package.path
local Sync = require("sync")
local J = require("json_mini")

local A, ADMIN_A, B, ADMIN_B = arg[1], arg[2], arg[3], arg[4]
local passed, failed = 0, 0
local function check(name, cond, extra)
    if cond then passed = passed + 1; print("  ok   " .. name)
    else failed = failed + 1; print("  FAIL " .. name .. (extra and (" — " .. tostring(extra)) or "")) end
end
local function q(s) return "'" .. s:gsub("'", "'\\''") .. "'" end
local function http(method, url, token, body, extra)
    local cmd = "curl -s -w '\\n%{http_code}' -X " .. method
    if token then cmd = cmd .. " -H " .. q("Authorization: Bearer " .. token) end
    if body then cmd = cmd .. " -H 'Content-Type: application/json' --data-binary " .. q(J.encode(body)) end
    local p = io.popen(cmd .. " " .. (extra or "") .. " " .. q(url))
    local out = p:read("a"); p:close()
    local text, code = out:match("^(.*)\n(%d+)$")
    return tonumber(code), text ~= "" and J.decode(text) or nil
end

print("koligilo e2e przenosin: " .. A .. " → " .. B)
-- czytnik na A
local _, pr = http("POST", A .. "/api/v1/pair", nil, { name = "Kobo", model = "Kobo", platform = "Test" })
http("POST", A .. "/api/admin/pair/" .. pr.id, ADMIN_A, { approve = true })
local _, got = http("GET", A .. "/api/v1/pair/" .. pr.id)
local token = got.token
check("czytnik sparowany z A", token ~= nil)
local c = http("POST", A .. "/api/v1/sync", token, { set = { ["settings.reader.lua#copt_line_spacing"] = "115" }, received = 0 })
check("czytnik wysłał ustawienie na A", c == 200)

-- eksport z A, import na B
local tmp = os.tmpname()
local p = io.popen("curl -s -o " .. q(tmp) .. " -w '%{http_code}' -H " .. q("Authorization: Bearer " .. ADMIN_A) .. " " .. q(A .. "/api/admin/export"))
check("eksport z A", p:read("a") == "200"); p:close()
local ci, imp = http("POST", B .. "/api/admin/import", ADMIN_B, nil, "-H 'Content-Type: application/gzip' --data-binary @" .. q(tmp))
check("import na B", ci == 200 and imp.imported.devices >= 1, imp and (imp.error or J.encode(imp)))
os.remove(tmp)
check("A: przekierowanie ustawione", (http("POST", A .. "/api/admin/moved", ADMIN_A, { moved_to = B })) == 200)

-- czytnik: sync na starym adresie → 410 → nowy adres → sync z B
local server = A
local c1, r1 = http("GET", server .. "/api/v1/sync", token)
check("A odpowiada 410 z moved_to", c1 == 410 and r1.moved_to == B, J.encode(r1 or {}))
local new = Sync.movedURL(server, r1.moved_to)
check("plugin przyjmuje nowy adres", new == B)
server = new
local c2, r2 = http("GET", server .. "/api/v1/sync", token)
check("B: sync starym tokenem", c2 == 200 and r2.values["settings.reader.lua#copt_line_spacing"] == "115", J.encode(r2 or {}))
check("A: obcy token dalej 401", (http("GET", A .. "/api/v1/sync", "dev-obcy")) == 401)
check("B: import nie zmienił tokenu admina B", (http("GET", B .. "/api/admin/state", ADMIN_B)) == 200)

print(string.format("%d ok, %d fail", passed, failed))
os.exit(failed == 0 and 0 or 1)
