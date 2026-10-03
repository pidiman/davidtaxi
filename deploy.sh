#!/usr/bin/env bash
# Nasadenie na Docker host cez SSH (spúšťaj na Macu z priečinka projektu):
#   ./deploy.sh                      # root@192.168.1.121, /opt/davidtaxi
#   ./deploy.sh user@host /cesta     # iný cieľ
set -euo pipefail
TARGET="${1:-root@192.168.1.121}"
DIR="${2:-/opt/davidtaxi}"
cd "$(dirname "$0")"

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
rnd() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }
envget() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }

# 1) .env s náhodnými heslami (len ak ešte neexistuje)
if [ ! -f .env ]; then
  say "Generujem .env"
  sed -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(rnd 32)|" \
      -e "s|^JWT_SECRET=.*|JWT_SECRET=$(rnd 48)|" \
      -e "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$(rnd 14)|" \
      .env.example > .env
  chmod 600 .env
fi
PORT="$(envget APP_PORT)"; PORT="${PORT:-8088}"

say "Kontrolujem $TARGET"
ssh -o ConnectTimeout=8 "$TARGET" "hostname; command -v docker >/dev/null || { echo 'CHYBA: na tomto hoste nie je Docker'; exit 3; }; docker compose version; free -g | head -2; df -h / | tail -1
  if docker ps --format '{{.Names}} {{.Ports}}' | grep -v '^davidtaxi-' | grep -q ':$PORT->'; then
    echo 'CHYBA: port $PORT už používa iný kontajner – zmeň APP_PORT v .env'; exit 4
  fi"

copy() {
  ssh "$TARGET" "mkdir -p '$DIR'"
  if ssh "$TARGET" 'command -v rsync >/dev/null'; then
    rsync -az --delete --exclude node_modules --exclude dist --exclude .git --exclude '*.tsbuildinfo' \
      ./ "$TARGET:$DIR/"
  else
    # bez rsync na hoste: tar cez SSH
    COPYFILE_DISABLE=1 tar -czf - --exclude node_modules --exclude dist --exclude .git --exclude '*.tsbuildinfo' . \
      | ssh "$TARGET" "tar -xzf - --warning=no-unknown-keyword -C '$DIR'"
  fi
  ssh "$TARGET" "chmod 600 '$DIR/.env'"
}

say "Kopírujem projekt do $TARGET:$DIR"
copy

say "Build image (prvýkrát ~3–5 min)"
ssh "$TARGET" "cd '$DIR' && docker compose build app"

# 2) VAPID kľúče pre push notifikácie (len raz, uložia sa do lokálneho .env)
if [ -z "$(envget VAPID_PUBLIC_KEY)" ]; then
  say "Generujem VAPID kľúče pre push notifikácie"
  KEYS="$(ssh "$TARGET" "cd '$DIR' && docker compose run --rm --no-deps -T app node dist/vapid.js")"
  grep -vE '^VAPID_(PUBLIC|PRIVATE)_KEY=' .env > .env.tmp && mv .env.tmp .env
  printf '%s\n' "$KEYS" | grep -E '^VAPID_(PUBLIC|PRIVATE)_KEY=' >> .env
  chmod 600 .env
  [ -n "$(envget VAPID_PUBLIC_KEY)" ] || { echo "!! VAPID kľúče sa nepodarilo vygenerovať"; exit 1; }
  copy
fi

say "Štart (db + app)"
ssh "$TARGET" "cd '$DIR' && docker compose up -d db app"

say "Health check"
ok=0
for _ in $(seq 1 30); do
  if ssh "$TARGET" "curl -fs http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    ok=1; break
  fi
  sleep 3
done
ssh "$TARGET" "cd '$DIR' && docker compose ps && docker compose logs --tail=15 app"
[ "$ok" = 1 ] || { echo "!! App neodpovedá — pozri logy vyššie"; exit 1; }

HOSTIP="${TARGET#*@}"
say "Hotovo"
echo "Dashboard:  http://$HOSTIP:$PORT/dispatch   login: $(envget ADMIN_USERNAME)   heslo: $(envget ADMIN_PASSWORD)"
echo "            (heslo platí len pre prvého admina – vytvorí sa pri prvom štarte, potom sa mení v appke)"
echo "Vodič PWA:  $(envget PUBLIC_URL)/driver"
echo "Pre PWA, GPS a notifikácie na mobile treba HTTPS → NPM proxy host na http://$HOSTIP:$PORT (Websockets ON)"
