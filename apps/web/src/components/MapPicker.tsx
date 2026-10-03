import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMapEvents } from 'react-leaflet';
import { api } from '../lib/api';
import { STUPAVA } from './FleetMap';

const TILE_URL = import.meta.env.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

type Pt = { lat: number; lng: number };
export type PickedPlace = { address: string; lat: number; lng: number };

const pinIcon = (letter: string) =>
  L.divIcon({
    className: '',
    iconSize: [34, 34],
    iconAnchor: [17, 34],
    html: `<div class="draft-pin draft-${letter === 'A' ? 'A' : 'B'}" style="width:34px;height:34px"><span>${letter}</span></div>`,
  });

const meIcon = L.divIcon({
  className: '',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  html: '<div class="search-dot"></div>',
});

function TapHandler({ onTap }: { onTap: (p: Pt) => void }) {
  useMapEvents({ click: (e) => onTap({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

/**
 * Celoobrazovkový výber bodu na mape pre mobil: ťuk na mapu → špendlík → adresa (reverse geocode)
 * → Potvrdiť. Mapa štartuje na už zadanom bode, inak na polohe vodiča, inak na Stupave.
 */
export function MapPicker({
  title,
  letter,
  initial,
  me,
  onPick,
  onClose,
}: {
  title: string;
  letter: 'A' | 'B';
  initial: Pt | null;
  me: Pt | null;
  onPick: (p: PickedPlace) => void;
  onClose: () => void;
}) {
  const [pt, setPt] = useState<Pt | null>(initial);
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const center = initial ?? me ?? { lat: STUPAVA[0], lng: STUPAVA[1] };

  useEffect(() => {
    if (!pt) return;
    const my = ++seq.current;
    setLoading(true);
    setLabel(`${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}`);
    api<{ label: string }>(`/api/geocode/reverse?lat=${pt.lat}&lng=${pt.lng}`)
      .then((r) => my === seq.current && setLabel(r.label))
      .catch(() => {})
      .finally(() => my === seq.current && setLoading(false));
  }, [pt]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[3200] flex flex-col bg-ink">
      <div className="flex items-center justify-between gap-3 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3">
        <div>
          <div className="font-display text-2xl font-bold uppercase tracking-wide">{title}</div>
          <div className="text-[13px] text-muted">Ťukni na mapu na miesto cieľa</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Zavrieť mapu"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-panel text-2xl text-muted"
        >
          ×
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <MapContainer
          center={[center.lat, center.lng]}
          zoom={initial ? 16 : 14}
          className="map-dark h-full w-full"
          zoomControl={false}
        >
          <TileLayer url={TILE_URL} attribution="&copy; OpenStreetMap" maxZoom={19} />
          {me && <Marker position={[me.lat, me.lng]} icon={meIcon} interactive={false} />}
          {pt && <Marker position={[pt.lat, pt.lng]} icon={pinIcon(letter)} interactive={false} />}
          <TapHandler onTap={setPt} />
        </MapContainer>
      </div>

      <div className="flex flex-col gap-3 border-t border-line bg-panel px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">
        <div className="min-h-[44px] text-[15px]">
          {pt ? (
            <>
              <div className="text-xs uppercase tracking-[2px] text-muted">{letter} · vybrané miesto</div>
              <div className="font-semibold">{loading ? `${label} …` : label}</div>
            </>
          ) : (
            <div className="text-muted">Zatiaľ nič nevybraté.</div>
          )}
        </div>
        <div className="flex gap-2.5">
          <button type="button" className="btn-ghost h-14 flex-1 rounded-2xl" onClick={onClose}>
            Späť
          </button>
          <button
            type="button"
            disabled={!pt || loading}
            onClick={() => pt && onPick({ address: label, lat: pt.lat, lng: pt.lng })}
            className="btn-primary h-14 flex-[2] rounded-2xl text-lg font-extrabold uppercase"
          >
            Potvrdiť {letter === 'B' ? 'cieľ' : 'miesto'}
          </button>
        </div>
      </div>
    </div>
  );
}
