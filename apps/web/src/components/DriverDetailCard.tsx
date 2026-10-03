import { useEffect, useState } from 'react';
import {
  api,
  DRIVER_LABEL,
  type Driver,
  type DriverDetail,
  fmtEur,
  fmtInt,
  fmtKm,
  STATUS_LABEL,
  telHref,
} from '../lib/api';
import { CarPhoto } from './ShiftControls';

const ago = (iso: string | null, now: number) => {
  if (!iso) return 'nikdy';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `pred ${s} s`;
  if (s < 3600) return `pred ${Math.round(s / 60)} min`;
  return `pred ${Math.round(s / 3600)} h`;
};
const hm = (iso: string) => new Date(iso).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' });
const expiresSoon = (d: string | null) =>
  d ? new Date(`${d}T23:59:59`).getTime() - Date.now() < 30 * 86_400_000 : false;

/**
 * Detail vozidla a vodiča po kliknutí na auto v mape. `live` je aktuálny záznam zo
 * zoznamu vodičov (poloha, stav) – detail sa znova načíta pri zmene stavu alebo jazdy.
 */
export function DriverDetailCard({
  driverId,
  live,
  refreshKey,
  onClose,
}: {
  driverId: number;
  live: Driver | undefined;
  refreshKey: number;
  onClose: () => void;
}) {
  const [d, setD] = useState<DriverDetail | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey vynúti nové načítanie
  useEffect(() => {
    let alive = true;
    setError('');
    api<DriverDetail>(`/api/drivers/${driverId}/detail`)
      .then((r) => alive && setD(r))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [driverId, refreshKey, live?.status]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const driver = live ?? d?.driver;
  const v = d?.vehicle;

  return (
    <section className="card flex flex-col gap-3" aria-live="polite">
      <div className="flex items-center justify-between">
        <h2 className="h2">Detail vozidla</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Zavrieť detail"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-xl text-muted hover:bg-raised hover:text-text"
        >
          ×
        </button>
      </div>

      {error && <div className="text-sm text-red-300">{error}</div>}
      {!d && !error && <div className="text-sm text-muted">Načítavam…</div>}

      {d && driver && (
        <>
          {v ? (
            <>
              <div className="relative">
                <CarPhoto url={v.photoUrl} callsign={v.callsign} />
                <span className="absolute top-2 left-2 flex h-11 w-11 items-center justify-center rounded-full border-2 border-black bg-taxi text-lg font-extrabold text-black">
                  {v.callsign}
                </span>
              </div>
              <div>
                <div className="font-display text-xl font-bold leading-tight">{v.model}</div>
                <div className="text-sm text-soft">
                  {v.plate}
                  {v.color && ` · ${v.color}`}
                  {v.year && ` · ${v.year}`} · {v.seats} miest{v.fuel && ` · ${v.fuel}`}
                </div>
                {(expiresSoon(v.stkUntil) || expiresSoon(v.insuranceUntil)) && (
                  <div className="mt-1 text-xs text-taxi">
                    {expiresSoon(v.stkUntil) && 'STK končí/prepadlo · '}
                    {expiresSoon(v.insuranceUntil) && 'PZP končí/prepadlo'}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="text-sm text-muted">Vodič nemá v smene auto.</div>
          )}

          <div className="flex items-center gap-3 rounded-xl bg-ink p-3">
            <div className="min-w-0 flex-1">
              <div className="font-bold">{driver.name}</div>
              <div className="text-sm text-soft">{driver.phone ?? 'bez telefónu'}</div>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${driver.status === 'available' ? 'bg-taxi font-bold text-black' : 'bg-raised text-soft'}`}
            >
              {DRIVER_LABEL[driver.status]}
            </span>
            {driver.phone && (
              <a
                href={telHref(driver.phone)}
                aria-label={`Zavolať ${driver.name}`}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-taxi"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#000"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
                </svg>
              </a>
            )}
          </div>

          <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted">Poloha</dt>
            <dd className="m-0 text-right">
              {ago(driver.lastSeenAt, now)}
              {driver.accuracy ? ` · ±${Math.round(driver.accuracy)} m` : ''}
            </dd>
            {d.shift && (
              <>
                <dt className="text-muted">V smene od</dt>
                <dd className="m-0 text-right">{hm(d.shift.startedAt)}</dd>
                <dt className="text-muted">Štart km</dt>
                <dd className="m-0 text-right tabular-nums">{fmtInt(d.shift.startKm)}</dd>
                <dt className="text-muted">Jazdy v smene</dt>
                <dd className="m-0 text-right tabular-nums">
                  {d.stats.rides} · {fmtKm(d.stats.km)} km · {fmtEur(d.stats.revenue)}
                </dd>
              </>
            )}
          </dl>

          {d.ride ? (
            <div className="rounded-xl border border-taxi/50 bg-taxi-dim p-3 text-sm">
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-taxi">
                <span>{STATUS_LABEL[d.ride.status]}</span>
                {d.ride.status === 'in_progress' && (
                  <span className="tabular-nums">{fmtKm(Number(d.ride.distanceKm))} km</span>
                )}
              </div>
              <div className="mt-1 font-semibold text-text">
                {d.ride.customerName}
                {d.ride.customerPhone && (
                  <a className="ml-2 font-normal" href={telHref(d.ride.customerPhone)}>
                    {d.ride.customerPhone}
                  </a>
                )}
              </div>
              <div className="text-[#f2e3b0]">
                {d.ride.pickupAddress} → {d.ride.dropoffAddress || 'bez cieľa'}
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted">Momentálne bez jazdy.</div>
          )}
        </>
      )}
    </section>
  );
}
