import L from 'leaflet';
import { useEffect } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { DRIVER_LABEL, type Driver, initials, type Ride } from '../lib/api';

const TILE_URL = import.meta.env.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const STALE_MS = 2 * 60 * 1000;

export type LabelMode = 'car' | 'initials';
export type MapFocus = { lat: number; lng: number; zoom: number; label?: string; seq: number };
export const STUPAVA: [number, number] = [48.2745, 17.0318];
export type PickTarget = 'A' | 'B';
type Pt = [number, number];

const esc = (s: string) => s.replace(/[<>&"']/g, '');

function carIcon(d: Driver, mode: LabelMode, selected: boolean) {
  const stale = !d.lastSeenAt || Date.now() - new Date(d.lastSeenAt).getTime() > STALE_MS;
  const text = mode === 'initials' ? initials(d.name) : (d.vehicleCallsign ?? '?');
  return L.divIcon({
    className: '',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div class="car-marker car-${d.status}${stale ? ' car-stale' : ''}${selected ? ' car-selected' : ''}">${esc(text)}</div>`,
  });
}

const pickupIcon = (label: string) =>
  L.divIcon({
    className: '',
    iconSize: [0, 0],
    html: `<span class="pin-label">A · ${esc(label)}</span>`,
  });

const draftIcon = (letter: PickTarget) =>
  L.divIcon({
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    html: `<div class="draft-pin draft-${letter}"><span>${letter}</span></div>`,
  });

function FlyTo({ pos }: { pos: Pt | null }) {
  const map = useMap();
  useEffect(() => {
    if (pos) map.flyTo(pos, Math.max(map.getZoom(), 13), { duration: 0.6 });
  }, [pos, map]);
  return null;
}

/** Presun mapy z vyhľadávania / tlačidla Stupava (seq zabezpečí presun aj na to isté miesto). */
function FocusOn({ focus }: { focus: MapFocus | null }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lng], focus.zoom, { duration: 0.8 });
  }, [focus, map]);
  return null;
}

const searchIcon = L.divIcon({
  className: '',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  html: '<div class="search-dot"></div>',
});

function PickHandler({ active, onPick }: { active: boolean; onPick: (lat: number, lng: number) => void }) {
  const map = useMapEvents({
    click(e) {
      if (active) onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  useEffect(() => {
    const el = map.getContainer();
    el.classList.toggle('map-picking', active);
  }, [active, map]);
  return null;
}

export function FleetMap({
  drivers,
  selected,
  highlightDriverId,
  labelMode,
  pickTarget,
  onPick,
  draftA,
  draftB,
  selectedDriverId,
  onSelectDriver,
  focus,
}: {
  drivers: Driver[];
  selected: Ride | null;
  highlightDriverId: number | null;
  labelMode: LabelMode;
  pickTarget: PickTarget | null;
  onPick: (lat: number, lng: number) => void;
  draftA: Pt | null;
  draftB: Pt | null;
  selectedDriverId: number | null;
  onSelectDriver: (id: number) => void;
  focus: MapFocus | null;
}) {
  const pickup: Pt | null =
    selected?.pickupLat && selected.pickupLng ? [selected.pickupLat, selected.pickupLng] : null;
  const hl = drivers.find((d) => d.id === (highlightDriverId ?? selectedDriverId) && d.lat && d.lng);

  return (
    <div className="relative">
      <MapContainer center={STUPAVA} zoom={12} className="map-dark h-[420px] w-full" scrollWheelZoom>
        <TileLayer url={TILE_URL} attribution="&copy; OpenStreetMap" maxZoom={19} />
        {drivers
          .filter((d) => d.lat !== null && d.lng !== null && d.status !== 'offline')
          .map((d) => (
            <Marker
              key={d.id}
              position={[d.lat!, d.lng!]}
              icon={carIcon(d, labelMode, d.id === selectedDriverId)}
              zIndexOffset={d.id === selectedDriverId ? 1000 : 0}
              eventHandlers={{ click: () => !pickTarget && onSelectDriver(d.id) }}
              keyboard
              title={`${d.vehicleCallsign ?? '?'} · ${d.name}`}
            >
              <Tooltip direction="top" offset={[0, -16]}>
                {d.vehicleCallsign} · {d.name} · {DRIVER_LABEL[d.status]}
              </Tooltip>
            </Marker>
          ))}
        {pickup && selected && <Marker position={pickup} icon={pickupIcon(selected.customerName)} />}
        {pickup && hl && (
          <Polyline
            positions={[[hl.lat!, hl.lng!], pickup]}
            pathOptions={{ color: '#FFC400', weight: 3, dashArray: '8 6' }}
          />
        )}
        {draftA && <Marker position={draftA} icon={draftIcon('A')} interactive={false} />}
        {draftB && <Marker position={draftB} icon={draftIcon('B')} interactive={false} />}
        {draftA && draftB && (
          <Polyline
            positions={[draftA, draftB]}
            pathOptions={{ color: '#F2F2F2', weight: 2, dashArray: '4 6' }}
          />
        )}
        {focus?.label && (
          <Marker position={[focus.lat, focus.lng]} icon={searchIcon} interactive={false}>
            <Tooltip permanent direction="top" offset={[0, -10]}>
              {focus.label}
            </Tooltip>
          </Marker>
        )}
        <FlyTo pos={pickup} />
        <FocusOn focus={focus} />
        <PickHandler active={pickTarget !== null} onPick={onPick} />
      </MapContainer>
      {pickTarget && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-[1000] flex justify-center">
          <div className="rounded-full bg-taxi px-4 py-2 text-sm font-bold text-black shadow-xl">
            Klikni na mapu – bod {pickTarget === 'A' ? 'A (vyzdvihnutie)' : 'B (cieľ)'} · Esc zruší
          </div>
        </div>
      )}
    </div>
  );
}
