import L from 'leaflet';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { api, type GeoResult, navHref } from '../lib/api';
import {
  arrowAngle,
  distanceToRoute,
  distM,
  fmtDist,
  fmtDuration,
  instruction,
  type LatLng,
  type Route,
  speak,
} from '../lib/nav';

const TILE_URL = import.meta.env.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OFF_ROUTE_M = 60; // ďalej od trasy → prepočítať
const REROUTE_COOLDOWN_MS = 12_000;
const STEP_REACHED_M = 25;
const ARRIVED_M = 40;
const VOICE_BANDS = [800, 250, 40]; // hlásenia pred manévrom

export type NavTarget = { label: string; address: string; lat: number | null; lng: number | null };
export type NavPos = { lat: number; lng: number; accuracy: number; heading: number | null };

const carIcon = (heading: number | null) =>
  L.divIcon({
    className: '',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    html: `<div style="width:36px;height:36px;border-radius:50%;background:#FFC400;border:3px solid #000;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 8px rgba(255,196,0,.25);transform:rotate(${heading ?? 0}deg)"><svg width="16" height="16" viewBox="0 0 24 24" fill="#000"><path d="M12 2l7 19-7-4-7 4z"/></svg></div>`,
  });

const destIcon = L.divIcon({
  className: '',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
  html: '<div style="width:26px;height:26px;border-radius:7px;background:#F2F2F2;color:#000;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;border:2px solid #000">B</div>',
});

/** Mapa ide za autom, kým ju vodič neposunie prstom; potom tlačidlo Vycentrovať. */
function Follow({
  pos,
  follow,
  onUserMove,
}: {
  pos: LatLng | null;
  follow: boolean;
  onUserMove: () => void;
}) {
  const map = useMap();
  useMapEvents({ dragstart: onUserMove });
  useEffect(() => {
    if (follow && pos) map.setView(pos, Math.max(map.getZoom(), 16), { animate: true });
  }, [pos, follow, map]);
  return null;
}

export function DriverNav({
  target,
  pos,
  onClose,
}: {
  target: NavTarget;
  pos: NavPos | null;
  onClose: () => void;
}) {
  const [dest, setDest] = useState<LatLng | null>(
    target.lat !== null && target.lng !== null ? [target.lat, target.lng] : null,
  );
  const [route, setRoute] = useState<Route | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [follow, setFollow] = useState(true);
  const [muted, setMuted] = useState(false);
  const lastReroute = useRef(0);
  const announced = useRef(new Set<string>());
  const here: LatLng | null = pos ? [pos.lat, pos.lng] : null;

  // cieľ bez súradníc → geokódovanie adresy
  useEffect(() => {
    if (dest) return;
    api<GeoResult[]>(`/api/geocode?q=${encodeURIComponent(target.address)}`)
      .then((r) => (r[0] ? setDest([r[0].lat, r[0].lng]) : setError('Adresu sa nepodarilo nájsť na mape')))
      .catch(() => setError('Adresu sa nepodarilo nájsť na mape'));
  }, [dest, target.address]);

  const fetchRoute = useCallback(
    async (from: LatLng, to: LatLng) => {
      lastReroute.current = Date.now();
      setLoading(true);
      try {
        const r = await api<Route>(`/api/route?from=${from[0]},${from[1]}&to=${to[0]},${to[1]}`);
        setRoute(r);
        setStepIdx(0);
        announced.current.clear();
        setError('');
        if (!muted && r.steps[1]) speak(`${instruction(r.steps[1])}, o ${fmtDist(r.steps[0].distance)}`);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [muted],
  );

  // prvá trasa, keď poznáme polohu aj cieľ
  // biome-ignore lint/correctness/useExhaustiveDependencies: trasu počítame raz; ďalšie len pri zídení z trasy
  useEffect(() => {
    if (here && dest && !route && !loading) fetchRoute(here, dest);
  }, [Boolean(here), dest]);

  // sledovanie polohy: posun krokov, zídenie z trasy, hlasové pokyny
  // biome-ignore lint/correctness/useExhaustiveDependencies: reaguje len na novú polohu
  useEffect(() => {
    if (!here || !route || !dest) return;
    let idx = stepIdx;
    while (idx + 1 < route.steps.length && distM(here, route.steps[idx + 1].location) < STEP_REACHED_M) idx++;
    if (idx !== stepIdx) setStepIdx(idx);

    const off = distanceToRoute(here, route.geometry);
    const accurate = (pos?.accuracy ?? 999) < 40;
    if (accurate && off > OFF_ROUTE_M && Date.now() - lastReroute.current > REROUTE_COOLDOWN_MS) {
      if (!muted) speak('Prepočítavam trasu');
      fetchRoute(here, dest);
      return;
    }

    const next = route.steps[idx + 1];
    if (next && !muted) {
      const d = distM(here, next.location);
      for (const band of VOICE_BANDS) {
        const key = `${idx + 1}-${band}`;
        if (d <= band && !announced.current.has(key)) {
          for (const b of VOICE_BANDS) if (b >= band) announced.current.add(`${idx + 1}-${b}`);
          speak(band <= 40 ? instruction(next) : `O ${fmtDist(d)} ${instruction(next).toLowerCase()}`);
          break;
        }
      }
    }
  }, [pos]);

  const next = route?.steps[stepIdx + 1] ?? null;
  const toNext = here && next ? distM(here, next.location) : null;
  const remaining = useMemo(() => {
    if (!route || !here) return null;
    const after = route.steps.slice(stepIdx + 1);
    const dist = (toNext ?? 0) + after.reduce((s, x) => s + x.distance, 0);
    const ratio = route.distance ? dist / route.distance : 0;
    return { dist, dur: route.duration * ratio };
  }, [route, stepIdx, toNext, here]);
  const arrived = here && dest ? distM(here, dest) < ARRIVED_M : false;
  const eta = remaining
    ? new Date(Date.now() + remaining.dur * 1000).toLocaleTimeString('sk-SK', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div className="fixed inset-0 z-[3000] flex flex-col bg-ink">
      {/* horný panel: ďalší manéver */}
      <div className="flex items-center gap-3 bg-black px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-taxi">
          {arrived ? (
            <span className="font-display text-3xl font-extrabold text-black">B</span>
          ) : (
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#000"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: `rotate(${next ? arrowAngle(next) : 0}deg)` }}
              aria-hidden="true"
            >
              <path d="M12 20V5" />
              <path d="M6 11l6-6 6 6" />
            </svg>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {arrived ? (
            <div className="font-display text-3xl font-extrabold">Ste v cieli</div>
          ) : (
            <>
              <div className="font-display text-4xl font-extrabold leading-none text-taxi tabular-nums">
                {toNext !== null ? fmtDist(toNext) : loading ? '…' : '–'}
              </div>
              <div className="mt-1 line-clamp-2 text-lg font-semibold leading-tight">
                {next ? instruction(next) : here ? 'Počítam trasu…' : 'Čakám na GPS…'}
              </div>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-950/90 px-4 py-2.5 text-sm text-red-100">
          {error} –{' '}
          <a className="font-semibold text-taxi" href={navHref(target.address, dest?.[0], dest?.[1])}>
            otvoriť v Google Maps
          </a>
        </div>
      )}

      <div className="relative flex-1">
        <MapContainer
          center={here ?? dest ?? [48.2745, 17.0318]}
          zoom={16}
          zoomControl={false}
          className="map-dark h-full w-full"
        >
          <TileLayer url={TILE_URL} attribution="&copy; OpenStreetMap" maxZoom={19} />
          {route && (
            <Polyline
              positions={route.geometry}
              pathOptions={{ color: '#FFC400', weight: 7, opacity: 0.9 }}
            />
          )}
          {dest && <Marker position={dest} icon={destIcon} />}
          {here && <Marker position={here} icon={carIcon(pos?.heading ?? null)} />}
          <Follow pos={here} follow={follow} onUserMove={() => setFollow(false)} />
        </MapContainer>
        <div className="absolute right-3 bottom-3 z-[1000] flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Zapnúť hlas' : 'Vypnúť hlas'}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-black text-xl text-text shadow-lg"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              {muted ? (
                <path d="M23 9l-6 6M17 9l6 6" />
              ) : (
                <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
              )}
            </svg>
          </button>
          {!follow && (
            <button
              type="button"
              onClick={() => setFollow(true)}
              className="h-12 rounded-full bg-taxi px-4 font-bold text-black shadow-lg"
            >
              Vycentrovať
            </button>
          )}
        </div>
      </div>

      {/* spodný panel: zostáva, príchod, ukončenie */}
      <div className="flex items-center gap-3 bg-black px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="min-w-0 flex-1">
          <div className="text-lg font-bold tabular-nums">
            {remaining ? `${fmtDuration(remaining.dur)} · ${fmtDist(remaining.dist)}` : '–'}
          </div>
          <div className="truncate text-sm text-muted">
            {eta && `príchod ${eta} · `}
            {target.label}: {target.address}
          </div>
        </div>
        <a
          href={navHref(target.address, dest?.[0], dest?.[1])}
          target="_blank"
          rel="noreferrer"
          className="rounded-xl border border-[#444] px-3 py-3 text-sm text-soft"
        >
          Google
        </a>
        <button
          type="button"
          onClick={onClose}
          className="btn-primary h-12 rounded-xl px-5 font-bold uppercase"
        >
          Späť
        </button>
      </div>
    </div>
  );
}
