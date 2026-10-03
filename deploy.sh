#!/usr/bin/env bash
# Nasadenie na Docker host cez SSH (spúšťaj na Macu z priečinka projektu):
#   ./deploy.sh                      # root@192.168.1.121, /opt/davidtaxi
#   ./deploy.sh user@host /cesta     # iný cieľ
set -euo pipefail
TARGET="${1:-root@192.168.1.121}"
DIR="${2:-/opt/davidtaxi}"
cd "$(dirname "$0")"

T0=$SECONDS
STEP_T=$SECONDS
say() {
  if [ "${STEP_NAME:-}" ]; then printf '\033[2m    (trvalo %ss)\033[0m\n' "$((SECONDS - STEP_T))"; fi
  STEP_NAME="$1"; STEP_T=$SECONDS
  printf '\n\033[1;32m==> %s\033[0m\n' "$*"
}
rnd() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }
envget() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }

# jedno SSH spojenie pre všetky príkazy (ušetrí ~1 s na každom ssh/rsync)
SOCK="${TMPDIR:-/tmp}/davidtaxi-ssh-$$"
SSH_OPTS=(-o ControlMaster=auto -o ControlPath="$SOCK" -o ControlPersist=60 -o ConnectTimeout=8)
trap 'ssh "${SSH_OPTS[@]}" -O exit "$TARGET" 2>/dev/null || true' EXIT
r() { ssh "${SSH_OPTS[@]}" "$TARGET" "$@"; }

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
r "hostname; command -v docker >/dev/null || { echo 'CHYBA: na tomto hoste nie je Docker'; exit 3; }
  docker compose version --short; nproc | sed 's/^/CPU jadrá: /'; free -h | awk '/Mem/{print \"RAM: \"\$2\" (voľné \"\$7\")\"}'
  drv=\$(docker info --format '{{.Driver}}' 2>/dev/null); echo \"Docker storage driver: \$drv\"
  if [ \"\$drv\" = vfs ]; then
    echo '!! POZOR: storage driver vfs – každý krok buildu kopíruje celý image, build je 5–10× pomalší.'
    echo '!! Riešenie: README → Deploy → Pomalý build (overlay2).'
  fi
  if docker ps --format '{{.Names}} {{.Ports}}' | grep -v '^davidtaxi-' | grep -q ':$PORT->'; then
    echo 'CHYBA: port $PORT už používa iný kontajner – zmeň APP_PORT v .env'; exit 4
  fi"

say "Kopírujem projekt do $TARGET:$DIR"
r "mkdir -p '$DIR'"
EXCL=(--exclude node_modules --exclude dist --exclude .git --exclude '*.tsbuildinfo' --exclude .DS_Store)
if r 'command -v rsync >/dev/null'; then
  rsync -az --delete -e "ssh ${SSH_OPTS[*]}" "${EXCL[@]}" ./ "$TARGET:$DIR/"
else
  COPYFILE_DISABLE=1 tar -czf - "${EXCL[@]}" . | r "tar -xzf - --warning=no-unknown-keyword -C '$DIR'"
fi
r "chmod 600 '$DIR/.env'"

say "Build image (prvýkrát ~3–5 min, potom pri zmene kódu ~30–60 s)"
r "cd '$DIR' && DOCKER_BUILDKIT=1 docker compose build app"

# 2) VAPID kľúče pre push notifikácie (len raz, uložia sa do lokálneho .env)
if [ -z "$(envget VAPID_PUBLIC_KEY)" ]; then
  say "Generujem VAPID kľúče pre push notifikácie"
  KEYS="$(r "cd '$DIR' && docker compose run --rm --no-deps -T app node apps/api/dist/vapid.js")"
  grep -vE '^VAPID_(PUBLIC|PRIVATE)_KEY=' .env > .env.tmp && mv .env.tmp .env
  printf '%s\n' "$KEYS" | grep -E '^VAPID_(PUBLIC|PRIVATE)_KEY=' >> .env
  chmod 600 .env
  [ -n "$(envget VAPID_PUBLIC_KEY)" ] || { echo "!! VAPID kľúče sa nepodarilo vygenerovať"; exit 1; }
  r "cat > '$DIR/.env' && chmod 600 '$DIR/.env'" < .env
fi

say "Štart (db + app)"
r "cd '$DIR' && docker compose up -d db app"

say "Health check"
ok=0
for _ in $(seq 1 40); do
  if r "curl -fs http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
r "cd '$DIR' && docker compose ps && docker compose logs --tail=10 app"
[ "$ok" = 1 ] || { echo "!! App neodpovedá — pozri logy vyššie"; exit 1; }

# uvoľní miesto po starých image (bez dotknutia sa volume s databázou)
r "docker image prune -f >/dev/null 2>&1 || true"

HOSTIP="${TARGET#*@}"
say "Hotovo za $((SECONDS - T0)) s"
echo "Dashboard:  http://$HOSTIP:$PORT/dispatch   login: $(envget ADMIN_USERNAME)   heslo: $(envget ADMIN_PASSWORD)"
echo "            (heslo platí len pre prvého admina – vytvorí sa pri prvom štarte, potom sa mení v appke)"
echo "Vodič PWA:  $(envget PUBLIC_URL)/driver"
STEP_NAME=""
