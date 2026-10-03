# davidtaxi

Dispečing pre taxislužbu: **admin / dispečer dashboard** + **PWA pre vodičov**.

- Admin vytvára dispečerov, vodičov a autá.
- Dispečer (aj admin) prijíma objednávky, vidí autá na mape naživo a posiela jazdy vodičom.
- Vodič dostane push notifikáciu, vidí trasu A → B a meno a telefón zákazníka. Jazdu prijme alebo odmietne.
- PWA posiela polohu každých 10 s (počas jazdy každých 5 s) a počíta km jazdy z GPS. Cena = max(minimálne jazdné, km × sadzba).

| Vrstva | Technológia |
|---|---|
| API | Node 22, Fastify 5, Drizzle ORM, PostgreSQL 17, Socket.IO, Web Push (VAPID) |
| Web | React 19, Vite, TypeScript, Tailwind v4, Leaflet (OSM) |
| Deploy | 1 Docker image (API servíruje aj frontend) + Postgres, HTTPS cez Nginx Proxy Manager |

```
apps/api   Fastify API + realtime + migrácie (apps/api/drizzle)
apps/web   /dispatch, /history, /admin (dashboard)  ·  /driver (PWA)
```

## Stavy jazdy

`new` → `assigned` (poslaná vodičovi) → `accepted` → `arrived` → `in_progress` (počítajú sa km) → `completed`

- Ak vodič jazdu odmietne, vráti sa do stavu `new`.
- Dispečer môže jazdu kedykoľvek zrušiť (`cancelled`).

---

## Deploy na Proxmox

### 1. Docker host (ak ešte nemáš)

V Proxmoxe vytvor LXC kontajner Debian 12 s 2 vCPU, 2 GB RAM a 16 GB disku. V *Options → Features* zapni `nesting=1` a `keyctl=1`. Potom:

```bash
apt update && apt install -y curl git
curl -fsSL https://get.docker.com | sh
```

> Ak už máš Docker LXC (napr. `docker-webdeveloper`), použi ten.

### 2. Stiahni repo a nastav `.env`

```bash
cd /opt
git clone https://github.com/pidiman/davidtaxi.git
cd davidtaxi
cp .env.example .env

# vygeneruj tajné hodnoty (bez špeciálnych znakov, sú súčasťou DATABASE_URL)
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
nano .env   # nastav ADMIN_PASSWORD (min. 8 znakov), PUBLIC_URL, APP_PORT
```

### 3. Build a VAPID kľúče pre push notifikácie

```bash
docker compose build
docker compose run --rm --no-deps app node dist/vapid.js
# skopíruj vypísané VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY do .env
```

### 4. Spusti

```bash
docker compose up -d
docker compose ps                 # app aj db majú byť "healthy"
docker compose logs -f app        # "Vytvorený prvý admin" + "Server listening"
curl -s localhost:8088/api/health # {"ok":true}
```

Migrácie databázy sa spustia automaticky pri štarte. Prvý admin sa vytvorí z `ADMIN_USERNAME` / `ADMIN_PASSWORD`, iba ak je databáza prázdna.

### 5. Nginx Proxy Manager (HTTPS)

**HTTPS je povinné.** Bez neho prehliadač nepustí PWA k GPS ani k push notifikáciám.

1. DNS: pridaj `taxi.pidiman.sk` (A záznam alebo wildcard na tvoju verejnú IP).
2. V NPM nastav *Proxy Hosts → Add*:
   - Domain: `taxi.pidiman.sk`
   - Scheme `http`, Forward Hostname: IP Docker LXC, Port: `8088` (alebo IP z Tailscale)
   - ✅ **Websockets Support** – bez neho nepôjde živá mapa ani notifikácie v appke
   - ✅ Block Common Exploits
3. V záložke SSL zvoľ Let's Encrypt, zapni Force SSL a HTTP/2.

> Nedávaj pred appku Authelia forward-auth. Rozbije to PWA a API volania z mobilov. Appka má vlastné prihlásenie s rolami.

### 6. Prvé nastavenie

1. Otvor `https://taxi.pidiman.sk` a prihlás sa ako admin.
2. V sekcii **Používatelia a autá** pridaj autá, potom dispečerov a vodičov (vodičovi priraď auto).
3. Na mobile vodiča:
   - otvor `https://taxi.pidiman.sk` a prihlás sa
   - **Android / Chrome:** menu ⋮ → *Pridať na plochu*
   - **iPhone:** Zdieľať → *Pridať na plochu*. Push na iOS funguje len z appky na ploche (iOS 16.4+).
   - v appke klikni **Povoliť** notifikácie, povoľ polohu „Vždy pri používaní“ a daj **Začať smenu**.

### Aktualizácia

```bash
cd /opt/davidtaxi
git pull
docker compose up -d --build
```

### Záloha databázy

```bash
# /etc/cron.d/davidtaxi-backup — každú noc o 3:15, 14 dní spätne
15 3 * * * root cd /opt/davidtaxi && docker compose exec -T db pg_dump -U davidtaxi davidtaxi | gzip > /var/backups/davidtaxi-$(date +\%F).sql.gz && find /var/backups -name 'davidtaxi-*.sql.gz' -mtime +14 -delete
```

Obnova zo zálohy:

```bash
gunzip -c davidtaxi-2026-10-03.sql.gz | docker compose exec -T db psql -U davidtaxi davidtaxi
```

### Alternatíva: Portainer stack

V Portaineri: *Stacks → Add stack → Repository*
- URL: `https://github.com/pidiman/davidtaxi`
- Compose path: `docker-compose.yml`
- premenné z `.env.example` zadaj v sekcii *Environment variables*

Portainer potom stack sám buildne zo zdrojákov.

---

## Lokálny vývoj

```bash
pnpm install
cp .env.example .env   # DATABASE_URL=postgres://davidtaxi:heslo@localhost:5432/davidtaxi
pnpm dev               # API :3000, web :5173 (proxy na /api a /socket.io)
pnpm check             # Biome
pnpm db:generate       # po zmene apps/api/src/db/schema.ts vygeneruje novú migráciu
```

## Obmedzenia PWA

- **GPS na pozadí:** keď je appka na pozadí alebo je zhasnutý displej, prehliadač geolokáciu zastaví. Appka preto drží displej zapnutý (Wake Lock), kým je vodič online. Ak bude treba spoľahlivé sledovanie na pozadí, ďalší krok je zabaliť `/driver` do Capacitoru s natívnym background location.
- **Km jazdy:** súčet úsekov medzi GPS bodmi. Body s presnosťou horšou ako 50 m, posuny pod 10 m a skoky nad 220 km/h sa ignorujú.
- **Geokódovanie adries:** cez verejný OSM Nominatim (max 1 požiadavka za sekundu). Pri vyššej záťaži nastav `GEOCODER_URL` na vlastný Nominatim alebo Photon.
- **Mapové dlaždice:** OpenStreetMap. Pri väčšej prevádzke nastav pri builde `VITE_TILE_URL` na vlastný alebo komerčný tile server.
