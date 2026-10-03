import { useEffect, useState } from 'react';
import {
  DRIVER_LABEL,
  type Driver,
  type DriverStatus,
  fmtTime,
  initials,
  type Ride,
  telHref,
} from '../lib/api';
import type { LabelMode } from './FleetMap';

const ORDER: Record<DriverStatus, number> = { busy: 0, available: 1, break: 2, offline: 3 };
const STALE_MS = 2 * 60 * 1000;

/** Čo vodič práve robí – podľa jeho otvorenej jazdy, inak podľa stavu. */
function activity(d: Driver, ride: Ride | undefined): { text: string; detail?: string; tone: string } {
  if (ride) {
    const who = ride.customerName;
    switch (ride.status) {
      case 'assigned':
        return {
          text: 'Ponuka jazdy – čaká na prijatie',
          detail: `${who} · ${ride.pickupAddress}`,
          tone: 'text-taxi',
        };
      case 'accepted':
        return { text: 'Ide po zákazníka', detail: `${who} · A: ${ride.pickupAddress}`, tone: 'text-text' };
      case 'arrived':
        return { text: 'Čaká na zákazníka', detail: `${who} · ${ride.pickupAddress}`, tone: 'text-text' };
      case 'in_progress':
        return {
          text: ride.source === 'street' ? 'Vezie zákazníka (z ulice)' : 'Vezie zákazníka',
          detail: `${who} · B: ${ride.dropoffAddress}`,
          tone: 'text-text',
        };
    }
  }
  if (d.status === 'available') return { text: 'Voľný, čaká na jazdu', tone: 'text-taxi' };
  if (d.status === 'break') return { text: 'Pauza', tone: 'text-muted' };
  if (d.status === 'busy') return { text: 'Obsadený', tone: 'text-text' };
  return { text: 'Offline', tone: 'text-muted' };
}

function ago(iso: string | null, now: number) {
  if (!iso) return 'poloha neznáma';
  const min = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'poloha teraz';
  if (min < 60) return `poloha pred ${min} min`;
  return `poloha o ${fmtTime(iso)}`;
}

export function DriversPanel({
  drivers,
  rides,
  labelMode,
  selectedId,
  onSelect,
}: {
  drivers: Driver[];
  rides: Ride[];
  labelMode: LabelMode;
  selectedId: number | null;
  onSelect: (d: Driver, ride: Ride | undefined) => void;
}) {
  // prepočet „pred X min“ aj bez novej udalosti zo socketu
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const online = drivers
    .filter((d) => d.status !== 'offline')
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name, 'sk'));
  const free = online.filter((d) => d.status === 'available').length;

  return (
    <div className="card flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="h2">
          Vodiči <span className="text-taxi">{online.length}</span>
        </h2>
        <span className="text-[13px] text-muted">
          {free} voľn{free === 1 ? 'ý' : free >= 2 && free <= 4 ? 'í' : 'ých'}
        </span>
      </div>
      {online.length === 0 && <p className="m-0 text-sm text-muted">Žiadny vodič nie je v smene.</p>}
      {online.map((d) => {
        const ride = rides.find(
          (r) => r.driverId === d.id && ['assigned', 'accepted', 'arrived', 'in_progress'].includes(r.status),
        );
        const a = activity(d, ride);
        const stale = !d.lastSeenAt || now - new Date(d.lastSeenAt).getTime() > STALE_MS;
        return (
          <article
            key={d.id}
            className={`flex items-start gap-2.5 rounded-[10px] p-2.5 ${
              d.id === selectedId
                ? 'border-2 border-taxi bg-taxi-dim'
                : 'border border-line hover:border-[#444]'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(d, ride)}
              title="Ukázať na mape a detail"
              className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
                  d.status === 'available'
                    ? 'bg-taxi text-black'
                    : d.status === 'busy'
                      ? 'bg-text text-black'
                      : 'bg-[#5a5a5a]'
                }`}
              >
                {labelMode === 'initials' ? initials(d.name) : (d.vehicleCallsign ?? '?')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 font-bold leading-tight">{d.name}</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${d.status === 'available' ? 'bg-taxi font-bold text-black' : 'bg-raised text-soft'}`}
                  >
                    {DRIVER_LABEL[d.status]}
                  </span>
                </span>
                <span className={`block text-sm font-semibold ${a.tone}`}>{a.text}</span>
                {a.detail && <span className="block truncate text-[13px] text-soft">{a.detail}</span>}
                <span className={`block text-xs ${stale ? 'text-[#e0a030]' : 'text-muted'}`}>
                  {d.vehicleCallsign ? `auto ${d.vehicleCallsign}` : 'bez auta'} · {ago(d.lastSeenAt, now)}
                </span>
              </span>
            </button>
            {d.phone && (
              <a
                href={telHref(d.phone)}
                aria-label={`Zavolať ${d.name}`}
                title={d.phone}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#444] text-soft hover:border-taxi hover:text-taxi"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
                </svg>
              </a>
            )}
          </article>
        );
      })}
    </div>
  );
}
