# davidtaxi

Dispečing pre taxislužbu: **admin / dispečer dashboard** + **PWA pre vodičov**.

- Admin spravuje vodičov, dispečerov a autá (vytvorenie, úprava, deaktivácia, zmazanie). Pri autách eviduje farbu, rok, počet miest, karosériu, palivo, VIN a platnosť STK, EK a PZP s upozornením 30 dní pred koncom.
  - Vodiča alebo auto s jazdami v histórii nemožno zmazať, len deaktivovať, aby história ostala úplná.
- **Vzdialenosť A→B:** pri každej jazde server vypočíta približnú cestnú vzdialenosť podľa mapy (OSRM; ak adresa nemá súradnice, najprv ju geokóduje). Zobrazuje sa v Čakajúcich, Aktívnych jazdách aj v Histórii. Stĺpec *Najazdené* sú skutočné km z GPS.
- **Smeny a autá:** autá sú firemné. Pred začiatkom smeny vodič vyberie auto (s fotkou, auto podľa rozpisu je zvýraznené) a zapíše počiatočný stav tachometra. Bez toho nedostane jazdy.
  - Pri *Ukončiť smenu* zapíše konečný stav km.
  - Ak smenu zabudne ukončiť, ďalší vodič auto prevezme. Jeho počiatočný stav km sa zapíše ako konečný stav predchádzajúceho vodiča (v knihe smien so štítkom *doplnil ďalší vodič*).
  - Kým auto vezie zákazníka, prevzatie nie je možné.
- **Rozpis:** admin aj dispečer plánujú, ktorý vodič jazdí od kedy do kedy a na ktorom aute. Appka hlási kolízie vodiča aj auta a podporuje nočné smeny.
  - Pod rozpisom je kniha odjazdených smien: počiatočný a konečný stav km, najazdené km, km jázd z GPS, počet jázd a tržba.
  - Dispečer v knihe smien opraví km alebo ukončí zabudnutú smenu.
- Dispečer (aj admin) prijíma objednávky, vidí autá na mape naživo a posiela jazdy vodičom.
- **Dashboard:**
  - prepínač *Číslo auta / Iniciály vodiča* (popis áut na mape aj v zozname vodičov, appka si ho pamätá),
  - body A a B objednávky sa dajú zadať aj kliknutím na mapu: ikona špendlíka na konci poľa, potom klik do mapy, adresa sa doplní sama, Esc výber zruší,
  - nad mapou je vyhľadávanie adresy (Enter presunie mapu na nájdené miesto) a tlačidlo *Stupava*, legenda je pod mapou,
  - mapa sa sama nehýbe, dispečer s ňou môže voľne pracovať. Všetky neprijaté objednávky sú na mape ako štítky „A · meno“ (vybraná je žltá, poslaná vodičovi má prerušovaný okraj). Klik na štítok vyberie objednávku, klik v zozname Čakajúce posunie mapu na jej bod A, len ak nie je viditeľný,
  - klik na jazdu v *Aktívnych jazdách* zobrazí na mape cestnú trasu A→B, špendlíky A/B a zvýraznené auto (kým ide k zákazníkovi, aj čiaru auto→A); mapa sa raz priblíži na trasu a auto, potom sa sama nehýbe. Otvorí sa aj detail auta. Druhý klik alebo × trasu skryje,
  - zoznam *Čakajúce* je v pravom stĺpci; každá objednávka má tlačidlo **Priradiť vodiča** (resp. *Zmeniť vodiča*), ktoré otvorí popup s vodičmi zoradenými podľa stavu a vzdialenosti k A. Po uložení novej objednávky sa popup otvorí automaticky,
  - klik na auto v mape zobrazí pod zoznamom *Čakajúce* detail auta (fotka, údaje) a vodiča (telefón, smena, štart km, jazdy a tržba v smene, aktuálna jazda).
- Vodič dostane push notifikáciu, vidí trasu A → B a meno a telefón zákazníka. Jazdu prijme alebo odmietne.
- **Nová jazda sa nedá prehliadnuť:**
  - cez celú obrazovku sa zobrazí blikajúce okno (1× za sekundu) a appka zvoní a vibruje v slučke, kým vodič jazdu neprijme alebo neodmietne,
  - ak má vodič mobil zamknutý, push notifikácia sa opakuje každých 30 s (najviac 6×),
  - vodič si zvonenie vyskúša tlačidlom *Vyskúšať zvonenie* dole v appke.
- **Zákazník z ulice:** vodič v appke klikne *Zobrať zákazníka z ulice*. Bod A sa predvyplní adresou podľa GPS (dá sa prepísať), bod B zadá s našepkávaním. Jazda sa hneď spustí, dispečing dostane upozornenie a auto sa zobrazí ako obsadené (v tabuľkách so štítkom *z ulice*).
- **Navigácia priamo v appke vodiča:** mapa s trasou, ďalší manéver po slovensky, hlasové pokyny, zostávajúci čas a čas príchodu, automatický prepočet trasy pri zídení z cesty. Google Maps zostáva ako záloha.
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
- Jazda z ulice (`source = street`) vzniká rovno v stave `in_progress`.

---

## Deploy na Proxmox (Docker)

Jedným príkazom z Macu. Na hoste treba SSH kľúč. Skript vygeneruje `.env` s náhodnými heslami a VAPID kľúčmi, skopíruje projekt do `/opt/davidtaxi`, buildne, spustí a urobí health check:

```bash
cd ~/Projects/davidtaxi && ./deploy.sh root@192.168.1.121
```

Na konci vypíše URL a heslo admina. Rovnaký príkaz slúži aj na aktualizáciu. `.env` sa vytvára len raz a zostáva na Macu (`chmod 600`, je v `.gitignore`).

Ručne priamo na hoste:

```bash
git clone https://github.com/pidiman/davidtaxi.git /opt/davidtaxi && cd /opt/davidtaxi
cp .env.example .env && nano .env      # POSTGRES_PASSWORD, JWT_SECRET, ADMIN_PASSWORD, PUBLIC_URL
docker compose build app
docker compose run --rm --no-deps app node apps/api/dist/vapid.js   # výstup vlož do .env
docker compose up -d db app
docker compose logs -f app             # "Vytvorený prvý admin" + "Server listening"
curl -s localhost:8088/api/health      # {"ok":true}
```

Migrácie databázy sa spustia automaticky pri štarte. Prvý admin sa vytvorí z `ADMIN_USERNAME` / `ADMIN_PASSWORD`, iba ak je databáza prázdna. Port `8088` je zvolený tak, aby nekolidoval s kurierom (`8090`).

### Ako dlho trvá deploy

`deploy.sh` vypíše čas každého kroku. Orientačné časy:

| Situácia | Build |
|---|---|
| prvý deploy (sťahujú sa obrazy a balíčky) | 3–5 min |
| zmena kódu | 30–60 s (len TypeScript + Vite build) |
| zmena `package.json` / `pnpm-lock.yaml` | 1–2 min (balíčky z cache) |

**Pomalý build (vfs):** ak skript hlási `storage driver: vfs`, Docker v Proxmox LXC kopíruje pri každom kroku celý image a build je 5–10× pomalší. Typicky sa to stáva, keď je rootfs kontajnera na ZFS. Riešenie na Docker hoste:

```bash
docker info --format '{{.Driver}}'             # vfs = pomalé, overlay2 = OK
# Proxmox 8 so ZFS 2.2+ zvládne overlay2 aj na ZFS:
cat /etc/docker/daemon.json                   # ak obsahuje "storage-driver": "vfs", odstráň ho
echo '{ "storage-driver": "overlay2" }' > /etc/docker/daemon.json
systemctl restart docker && docker info --format '{{.Driver}}'
```

> Po zmene drivera Docker nevidí staré image ani volumes (sú uložené vo formáte vfs). **Pred zmenou si zálohuj databázy** (pozri Záloha databázy) všetkých appiek na tomto hoste, potom ich znova nasaď a obnov. Ak overlay2 nenaštartuje (staršie ZFS), daj Dockeru disk s ext4: v Proxmoxe pridaj LXC mount point z LVM-thin/dir storage na `/var/lib/docker`.

### Nginx Proxy Manager (HTTPS)

**HTTPS je povinné.** Bez neho prehliadač nepustí PWA k GPS ani k push notifikáciám.

1. DNS: pridaj `taxi.pidiman.sk` (A záznam alebo wildcard na tvoju verejnú IP).
2. V NPM nastav *Proxy Hosts → Add*:
   - Domain: `taxi.pidiman.sk`
   - Scheme `http`, Forward Hostname: `192.168.1.121` (Docker host), Port: `8088`
   - ✅ **Websockets Support** – bez neho nepôjde živá mapa ani notifikácie v appke
   - ✅ Block Common Exploits
3. V záložke SSL zvoľ Let's Encrypt, zapni Force SSL a HTTP/2.

> Nedávaj pred appku Authelia forward-auth. Rozbije to PWA a API volania z mobilov. Appka má vlastné prihlásenie s rolami.

### Prvé nastavenie

1. Otvor `https://taxi.pidiman.sk` a prihlás sa ako admin.
2. V sekcii **Používatelia a autá** pridaj autá, potom dispečerov a vodičov (vodičovi priraď auto).
3. Na mobile vodiča:
   - otvor `https://taxi.pidiman.sk` a prihlás sa
   - **Android / Chrome:** menu ⋮ → *Pridať na plochu*
   - **iPhone:** Zdieľať → *Pridať na plochu*. Push na iOS funguje len z appky na ploche (iOS 16.4+).
   - v appke klikni **Povoliť** notifikácie, povoľ polohu „Vždy pri používaní“ a daj **Začať smenu**.

### Aktualizácia

```bash
git pull && ./deploy.sh root@192.168.1.121     # z Macu
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

## Lokálny vývoj na Macu (bez deployu)

Zmeny skúšaj lokálne a na server nasadzuj až hotovú verziu. Lokálne sa nič nebuildí: API aj web sa po uložení súboru reštartujú alebo obnovia za ~1 s.

**Jednorazovo:**
- Node 22 a pnpm: `brew install node@22 && corepack enable`
- Docker pre databázu: OrbStack alebo Docker Desktop

```bash
cd ~/Projects/davidtaxi
pnpm install
pnpm dev:db        # Postgres v Dockeri na localhost:5433 (docker-compose.dev.yml)
pnpm seed          # ukážkové dáta: autá 07 a 02, vodiči, dispečer, rozpis na týždeň
```

**Každý deň:**

```bash
pnpm dev:db        # ak databáza nebeží
pnpm dev           # API :3000 + web http://localhost:5173
```

| Kto | Login | Heslo | Kde |
|---|---|---|---|
| Admin | `admin` | `admin1234` | http://localhost:5173 |
| Dispečer | `dana` | `dispecer1234` | http://localhost:5173 |
| Vodič | `peter`, `jano` | `vodic1234` | http://localhost:5173/driver |

Tipy:
- **Dispečer aj vodič naraz:** dispečera otvor v Chrome a vodiča v anonymnom okne (alebo v Safari), každé okno má vlastné prihlásenie.
- **Mobilné zobrazenie a GPS v prehliadači:** v Chrome DevTools (⌥⌘I) prepni na *Toggle device toolbar*. V ponuke ⋮ → *More tools* → *Sensors* nastavíš polohu, napr. Stupava 48.2745, 17.0318. Zmenou súradníc simuluješ jazdu a počítanie km.
- **Na reálnom mobile:** GPS a notifikácie vyžadujú HTTPS. Ak máš na Macu Tailscale, spusti `tailscale serve --bg 5173` a na mobile v Tailscale otvor `https://<nazov-macu>.<tailnet>.ts.net/driver`.
- **Konfigurácia:** lokálne nastavenia sú v `.env.dev` (bez tajomstiev, je v gite). Produkčný `.env` vytvára `deploy.sh` a lokálny vývoj ho nepoužíva.
- **Čistá databáza:** `docker compose -f docker-compose.dev.yml down -v && pnpm dev:db && pnpm seed`

```bash
pnpm check         # Biome (lint + formát)
pnpm build         # rovnaký build ako v Dockeri – keď prejde lokálne, prejde aj na serveri
pnpm db:generate   # po zmene apps/api/src/db/schema.ts vygeneruje novú migráciu
```

## Obmedzenia PWA

- **GPS na pozadí:** keď je appka na pozadí alebo je zhasnutý displej, prehliadač geolokáciu zastaví. Appka preto drží displej zapnutý (Wake Lock), kým je vodič online. Ak bude treba spoľahlivé sledovanie na pozadí, ďalší krok je zabaliť `/driver` do Capacitoru s natívnym background location.
- **Km jazdy:** súčet úsekov medzi GPS bodmi. Body s presnosťou horšou ako 50 m, posuny pod 10 m a skoky nad 220 km/h sa ignorujú.
- **Geokódovanie adries:** cez verejný OSM Nominatim (max 1 požiadavka za sekundu). Pri vyššej záťaži nastav `GEOCODER_URL` na vlastný Nominatim alebo Photon.
- **Navigácia (OSRM):** predvolene sa používa verejný demo server `router.project-osrm.org`. Je bez záruky dostupnosti a má limit približne 1 požiadavka za sekundu, na pár áut stačí. Pre ostrú prevádzku nastav `OSRM_URL` na vlastný OSRM.
  - Mapa musí pokrývať aj Rakúsko (letisko Viedeň). OSRM z kuriera má len Slovensko.
  - Navigácia nemá dopravné informácie (zápchy) ani jazdné pruhy. Na dlhé trasy (Viedeň) môže vodič otvoriť Google Maps priamo z navigácie.
- **Mapové dlaždice:** OpenStreetMap. Pri väčšej prevádzke nastav pri builde `VITE_TILE_URL` na vlastný alebo komerčný tile server.
