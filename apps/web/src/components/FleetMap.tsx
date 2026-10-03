import L from 'leaflet';
import { useEffect } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { DRIVER_LABEL, type Driver, type Ride } from '../lib/api';

const TILE_URL = import.meta.env.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const CENTER: [number, number] = [48.2745, 17.0318]; // Stupava
const STALE_MS = 2 * 60 * 1000;

function carIcon(d: Driver) {
  const stale = !d.lastSeenAt || Date.now() - new Date(d.lastSeenAt).getTime() > STALE_MS;
  return L.divIcon({
    className: '',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div class="car-marker car-${d.status}${stale ? ' car-stale' : ''}">${d.vehicleCallsign ?? '?'}</div>`,
  });
}

const pickupIcon = (label: string) =>
  L.divIcon({
    className: '',
    iconSize: [0, 0],
    html: `<span class="pin-label">A · ${label.replace(/[<>&"]/g, '')}</span>`,
  });

function FlyTo({ pos }: { pos: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (pos) map.flyTo(pos, Math.max(map.getZoom(), 13), { duration: 0.6 });
  }, [pos, map]);
  return null;
}

export function FleetMap({
  drivers,
  selected,
  highlightDriverId,
}: {
  drivers: Driver[];
  selected: Ride | null;
  highlightDriverId: number | null;
}) {
  const pickup: [number, number] | null =
    selected?.pickupLat && selected.pickupLng ? [selected.pickupLat, selected.pickupLng] : null;
  const hl = drivers.find((d) => d.id === highlightDriverId && d.lat && d.lng);

  return (
    <MapContainer center={CENTER} zoom={12} className="map-dark h-[420px] w-full" scrollWheelZoom>
      <TileLayer url={TILE_URL} attribution="&copy; OpenStreetMap" maxZoom={19} />
      {drivers
        .filter((d) => d.lat !== null && d.lng !== null && d.status !== 'offline')
        .map((d) => (
          <Marker key={d.id} position={[d.lat!, d.lng!]} icon={carIcon(d)}>
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
      <FlyTo pos={pickup} />
    </MapContainer>
  );
}
