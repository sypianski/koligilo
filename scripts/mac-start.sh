#!/bin/bash
# koligilo na Macu (TASK-15): jeden proces — serwer dla czytników + panel.
#   bash ~/build/koligilo/start.sh
# Dane z dawnego `koligilo serve --data ~/build/koligilo/dane` są używane dalej
# (ten sam format), więc sparowane czytniki synchronizują się bez zmian.
set -e
B=~/build/koligilo
CFG="$HOME/Library/Application Support/koligilo/config.json"
pkill -f "$B/koligilo" 2>/dev/null || true
sleep 0.5
# Stary skrypt wpisywał do config.json lokalny serwer (http://IP:7210) jako
# „zewnętrzny”. Teraz ten serwer jest wbudowany — przełączamy na tryb komputera.
# Konfiguracji wskazującej prawdziwy własny serwer (np. https://…) nie ruszamy.
if [ -f "$CFG" ] && grep -Eq '"server": *"http://[^"/]*:7210"' "$CFG"; then
  (umask 077; echo '{"mode":"local","chosen":true,"server":"","admin_token":""}' > "$CFG")
fi
nohup $B/koligilo --data $B/dane > $B/koligilo.log 2>&1 &
for _ in $(seq 60); do curl -sf -H 'X-Koligilo: 1' http://127.0.0.1:47471/api/local/config && break; sleep 0.5; done
echo
