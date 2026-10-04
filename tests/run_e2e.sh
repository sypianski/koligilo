#!/bin/bash
# E2E: świeży serwer koligilo na losowym porcie + dwa symulowane czytniki,
# potem przenosiny na drugi serwer (410 moved_to) i tryb komputera
# (jeden proces `koligilo`: panel na 127.0.0.1 + API czytników osobno).
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
PIDS=()
trap 'kill "${PIDS[@]}" 2>/dev/null || true; rm -rf "$TMP"' EXIT
go build -o "$TMP/koligilo" .

serve() { # serve NAZWA → uruchamia serwer, ustawia PORT_x i TOKEN_x
  local port=$((20000 + RANDOM % 20000))
  "$TMP/koligilo" serve --listen 127.0.0.1:$port --data "$TMP/$1" --public-url "http://127.0.0.1:$port" > "$TMP/$1.out" 2>&1 &
  PIDS+=($!)
  for _ in $(seq 50); do grep -q "kol-" "$TMP/$1.out" 2>/dev/null && break; sleep 0.1; done
  eval "PORT_$1=$port; TOKEN_$1=$(grep -o 'kol-[0-9a-f]*' "$TMP/$1.out")"
}

serve a
lua tests/e2e_test.lua "http://127.0.0.1:$PORT_a" "$TOKEN_a"

serve b
lua tests/e2e_move.lua "http://127.0.0.1:$PORT_a" "$TOKEN_a" "http://127.0.0.1:$PORT_b" "$TOKEN_b"

# --- tryb komputera: `koligilo` bez argumentów (AC1/AC4) ---
echo "koligilo e2e: tryb komputera"
PP=$((20000 + RANDOM % 20000)); DP=$((PP + 1))
XDG_CONFIG_HOME="$TMP/cfg" HOME="$TMP/home" "$TMP/koligilo" --no-browser --port $PP --listen 127.0.0.1:$DP > "$TMP/desk.out" 2>&1 &
PIDS+=($!)
for _ in $(seq 50); do curl -sf "http://127.0.0.1:$DP/api/v1/ping" >/dev/null && break; sleep 0.1; done
H=(-H "X-Koligilo: 1" -H "Origin: http://127.0.0.1:$PP" -H "Content-Type: application/json")
fail=0
ok() { if eval "$2"; then echo "  ok   $1"; else echo "  FAIL $1"; fail=1; fi; }
CFG=$(curl -s "${H[@]}" "http://127.0.0.1:$PP/api/local/config")
ok "pierwsze uruchomienie: tryb komputera, API czytników działa" '[[ $CFG == *"\"mode\":\"local\""* && $CFG == *"\"device_up\":true"* ]]'
ok "dane w katalogu konfiguracji użytkownika" '[ -f "$TMP/cfg/koligilo/dane/state.json" ] || [ -f "$TMP/home/Library/Application Support/koligilo/dane/state.json" ]'
ok "API czytników: /api/admin/state → 404" '[ "$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$DP/api/admin/state")" = 404 ]'
ok "API czytników: panel (/) → 404" '[ "$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$DP/")" = 404 ]'
ok "panel z obcym Host → 403" '[ "$(curl -s -o /dev/null -w "%{http_code}" -H "Host: evil.example:$PP" "${H[@]}" "http://127.0.0.1:$PP/api/admin/state")" = 403 ]'
PAIR=$(curl -s -X POST -H "Content-Type: application/json" --data '{"name":"Kobo","model":"Kobo"}' "http://127.0.0.1:$DP/api/v1/pair")
PID_=$(echo "$PAIR" | grep -o '"id":"[0-9a-f]*"' | cut -d'"' -f4)
ok "czytnik prosi o parowanie przez API czytników" '[ -n "$PID_" ]'
ok "panel widzi prośbę bez tokenu admina" '[[ $(curl -s "${H[@]}" "http://127.0.0.1:$PP/api/admin/state") == *"$PID_"* ]]'
curl -s -X POST "${H[@]}" --data '{"approve":true}' "http://127.0.0.1:$PP/api/admin/pair/$PID_" >/dev/null
DTOK=$(curl -s "http://127.0.0.1:$DP/api/v1/pair/$PID_" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
ok "czytnik dostaje token i synchronizuje się z komputerem" '[ "$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $DTOK" "http://127.0.0.1:$DP/api/v1/sync")" = 200 ]'
exit $fail
