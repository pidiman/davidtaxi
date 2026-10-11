import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import { useParams } from 'react-router';
import { TaxiIcon, Wordmark } from '../components/Brand';

const TILE_URL = import.meta.env.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const POLL_MS = 10_000;

type Phase = 'coming' | 'arrived' | 'riding' | 'done' | 'cancelled';
type TrackData = {
  phase: Phase;
  pickup: { address: string; lat?: number; lng?: number };
  driverFirstName: string | null;
  vehicle: { callsign: string | null; plate: string | null; model: string | null; color: string | null };
  car: { lat: number; lng: number; at: string | null } | null;
  etaMin: number | null;
  distanceKm: number | null;
};

const carIcon = L.divIcon({
  className: '',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  html: '<div class="car-marker car-available" style="width:40px;height:40px;font-size:18px">🚕</div>',
});
const pickupIcon = L.divIcon({
  className: '',
  iconSize: [30, 30],
  iconAnchor: [15, 30],
  html: '<div class="draft-pin draft-A"><span>A</span></div>',
});

/** Prispôsobí výrez mapy autu a miestu vyzdvihnutia – len pri prvom načítaní, potom nechá zákazníka posúvať. */
function Fit({ pts }: { pts: [number, number][] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !pts.length) return;
    done.current = true;
    if (pts.length === 1) map.setView(pts[0], 15);
    else map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 16 });
  }, [pts, map]);
  return null;
}

/** Verejná stránka pre zákazníka: kde je jeho taxík a kedy príde. Bez prihlásenia, len cez token v URL. */
export function Track() {
  const { token } = useParams();
  const [data, setData] = useState<TrackData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/track/${token}`, { cache: 'no-store' });
        const j = await res.json();
        if (!alive) return;
        if (!res.ok) setError(j.error ?? 'Odkaz neexistuje');
        else {
          setData(j);
          setError('');
        }
      } catch {
        /* výpadok siete – skúsi znova */
      }
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [token]);

  useEffect(() => {
    document.title = 'Kde je moje taxi · Rýchle Taxi';
  }, []);

  const pickup: [number, number] | null =
    data?.pickup.lat !== undefined && data?.pickup.lng !== undefined
      ? [data.pickup.lat, data.pickup.lng]
      : null;
  const car: [number, number] | null = data?.car ? [data.car.lat, data.car.lng] : null;
  const pts = [car, pickup].filter(Boolean) as [number, number][];
  const v = data?.vehicle;

  const headline: Record<Phase, string> = {
    coming: data?.etaMin ? `Príde o ~${data.etaMin} min` : 'Taxi je na ceste',
    arrived: 'Taxi na vás čaká',
    riding: 'Jazda prebieha',
    done: 'Jazda skončila',
    cancelled: 'Jazda bola zrušená',
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-ink text-text">
      <header className="flex items-center gap-3 border-b-[3px] border-taxi bg-black px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-taxi">
          <TaxiIcon size={22} />
        </div>
        <Wordmark size={22} />
      </header>

      {error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <div className="text-xl font-bold">{error}</div>
          <div className="text-muted">Ak potrebujete taxi, zavolajte dispečing.</div>
        </div>
      ) : !data ? (
        <div className="flex flex-1 items-center justify-center text-muted">Načítavam…</div>
      ) : (
        <>
          <section className="flex flex-col gap-1 px-4 pt-4 pb-3">
            <div className="text-xs font-bold uppercase tracking-[2px] text-taxi">Vaše taxi</div>
            <h1 className="m-0 font-display text-4xl font-extrabold uppercase leading-tight">
              {headline[data.phase]}
            </h1>
            {data.phase === 'coming' && data.distanceKm !== null && (
              <div className="text-soft">{data.distanceKm.toLocaleString('sk-SK')} km od vás</div>
            )}
          </section>

          {(data.phase === 'coming' || data.phase === 'arrived') && (
            <div className="relative min-h-[300px] flex-1">
              <MapContainer
                center={pts[0] ?? [48.2745, 17.0318]}
                zoom={14}
                className="map-dark absolute inset-0 h-full w-full"
                zoomControl={false}
              >
                <TileLayer url={TILE_URL} attribution="&copy; OpenStreetMap" maxZoom={19} />
                {pickup && <Marker position={pickup} icon={pickupIcon} interactive={false} />}
                {car && <Marker position={car} icon={carIcon} interactive={false} />}
                <Fit pts={pts} />
              </MapContainer>
            </div>
          )}

          <section className="flex flex-col gap-3 bg-panel px-4 pt-4 pb-[max(16px,env(safe-area-inset-bottom))]">
            {v && (v.plate || v.model) && (
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-taxi font-display text-xl font-extrabold text-black">
                  {v.callsign ?? '🚕'}
                </div>
                <div className="leading-tight">
                  <div className="font-display text-2xl font-bold tracking-wider">{v.plate}</div>
                  <div className="text-sm text-soft">
                    {[v.color, v.model].filter(Boolean).join(' ')}
                    {data.driverFirstName ? ` · vodič ${data.driverFirstName}` : ''}
                  </div>
                </div>
              </div>
            )}
            <div className="text-sm">
              <span className="text-muted">Vyzdvihnutie: </span>
              {data.pickup.address}
            </div>
            {(data.phase === 'coming' || data.phase === 'arrived') && (
              <div className="text-xs text-muted">Poloha sa obnovuje automaticky každých 10 s.</div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
