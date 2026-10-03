import { useCallback, useEffect, useRef, useState } from 'react';
import { TaxiIcon, Wordmark } from '../components/Brand';
import {
  api,
  type DriverStatus,
  type Driver as DriverT,
  fmtEur,
  fmtKm,
  navHref,
  type Ride,
  STATUS_LABEL,
  telHref,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { enablePush, keepScreenOn, type PushState, pushState, registerSW } from '../lib/pwa';
import { useSocket } from '../lib/socket';

const PRIORITY: Record<string, number> = { in_progress: 0, arrived: 1, accepted: 2, assigned: 3 };
const SEND_EVERY_MS = 10_000;
const SEND_EVERY_RIDE_MS = 5_000;

function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.2;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.2);
    });
    navigator.vibrate?.([300, 150, 300, 150, 300]);
  } catch {}
}

export function Driver() {
  const { logout } = useAuth();
  const [me, setMe] = useState<DriverT | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [finished, setFinished] = useState<Ride | null>(null);
  const [gps, setGps] = useState<{ accuracy: number; sentAt: number | null; error?: string } | null>(null);
  const [push, setPush] = useState<PushState>('default');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const lastSent = useRef(0);

  const load = useCallback(async () => {
    const [m, r] = await Promise.all([api<DriverT>('/api/driver/me'), api<Ride[]>('/api/driver/rides')]);
    setMe(m);
    setRides(r);
  }, []);

  useEffect(() => {
    load().catch((e) => setErr(e.message));
    registerSW()
      .then(() => pushState())
      .then(setPush)
      .catch(() => setPush('unsupported'));
  }, [load]);

  const connected = useSocket({
    'ride:updated': (r: Ride) => {
      setRides((list) => {
        const isNew = r.status === 'assigned' && !list.some((x) => x.id === r.id);
        if (isNew) beep();
        const rest = list.filter((x) => x.id !== r.id);
        return PRIORITY[r.status] !== undefined ? [...rest, r] : rest;
      });
      if (r.status === 'cancelled') setErr(`Dispečing zrušil jazdu: ${r.pickupAddress}`);
    },
    'ride:removed': ({ id }: { id: number }) => setRides((list) => list.filter((x) => x.id !== id)),
  });

  useEffect(() => {
    if (connected) load().catch(() => {});
  }, [connected, load]);

  const online = me ? me.status !== 'offline' : false;
  const inProgress = rides.some((r) => r.status === 'in_progress');

  // ---- GPS: posiela polohu, kým je vodič online ----
  useEffect(() => {
    if (!online) return;
    if (!('geolocation' in navigator)) {
      setGps({ accuracy: 0, sentAt: null, error: 'Zariadenie nepodporuje GPS' });
      return;
    }
    const release = keepScreenOn();
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        const interval = inProgress ? SEND_EVERY_RIDE_MS : SEND_EVERY_MS;
        setGps((g) => ({ accuracy: pos.coords.accuracy, sentAt: g?.sentAt ?? null }));
        if (Date.now() - lastSent.current < interval) return;
        lastSent.current = Date.now();
        api<{ distanceKm: number | null }>('/api/driver/location', {
          body: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp,
          },
        })
          .then((res) => {
            setGps({ accuracy: pos.coords.accuracy, sentAt: Date.now() });
            if (res.distanceKm !== null) {
              setRides((list) =>
                list.map((r) => (r.status === 'in_progress' ? { ...r, distanceKm: res.distanceKm! } : r)),
              );
            }
          })
          .catch(() => {});
      },
      (e) =>
        setGps({ accuracy: 0, sentAt: null, error: e.code === 1 ? 'Povoľ prístup k polohe' : e.message }),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    return () => {
      navigator.geolocation.clearWatch(watch);
      release();
    };
  }, [online, inProgress]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function setStatus(status: DriverStatus) {
    try {
      setMe(await api<DriverT>('/api/driver/status', { body: { status } }));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function act(ride: Ride, action: 'accept' | 'reject' | 'arrived' | 'start' | 'finish') {
    setBusy(true);
    setErr('');
    try {
      const res = await api<Ride | { ok: true }>(`/api/driver/rides/${ride.id}/${action}`, {
        method: 'POST',
      });
      if (action === 'reject') setRides((l) => l.filter((x) => x.id !== ride.id));
      else if ('id' in res) {
        if (res.status === 'completed') {
          setFinished(res);
          setRides((l) => l.filter((x) => x.id !== res.id));
        } else setRides((l) => l.map((x) => (x.id === res.id ? res : x)));
      }
      if (action === 'accept' || action === 'finish') setMe(await api<DriverT>('/api/driver/me'));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onEnablePush() {
    try {
      await enablePush();
      setPush('granted');
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const sorted = [...rides].sort((a, b) => PRIORITY[a.status] - PRIORITY[b.status]);
  const current = sorted[0];
  const queued = sorted.slice(1);

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col gap-3.5 bg-ink px-4 pt-[max(16px,env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between">
        <Wordmark size={24} />
        <StatusSwitch status={me?.status ?? 'offline'} onChange={setStatus} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
        <span>{me?.name}</span>
        {me?.vehicleCallsign && <span>· Auto {me.vehicleCallsign}</span>}
        {online && (
          <span className={gps?.error ? 'text-red-300' : 'text-soft'}>
            ·{' '}
            {gps?.error ??
              (gps?.sentAt
                ? `GPS ±${Math.round(gps.accuracy)} m · odoslané pred ${Math.round((now - gps.sentAt) / 1000)} s`
                : 'hľadám GPS…')}
          </span>
        )}
        {!connected && <span className="text-red-300">· bez spojenia</span>}
      </div>

      {push !== 'granted' && push !== 'disabled' && (
        <div className="rounded-xl bg-taxi-dim p-3 text-sm text-[#f2e3b0]">
          {push === 'unsupported' ? (
            'Notifikácie nie sú dostupné. Na iPhone pridaj appku na plochu (Zdieľať → Pridať na plochu) a otvor ju odtiaľ.'
          ) : push === 'denied' ? (
            'Notifikácie sú zablokované v nastaveniach prehliadača – povoľ ich pre túto stránku.'
          ) : (
            <div className="flex items-center justify-between gap-3">
              <span>Zapni notifikácie, aby ti nová jazda nezapadla.</span>
              <button type="button" className="btn-primary shrink-0 py-2 text-sm" onClick={onEnablePush}>
                Povoliť
              </button>
            </div>
          )}
        </div>
      )}

      {err && (
        <button
          type="button"
          onClick={() => setErr('')}
          className="rounded-xl bg-red-950/70 p-3 text-left text-sm text-red-100"
        >
          {err}
        </button>
      )}

      {finished && !current && (
        <div className="card flex flex-col gap-2 border-2 border-taxi text-center">
          <div className="text-sm uppercase tracking-[2px] text-taxi">Jazda dokončená</div>
          <div className="font-display text-5xl font-extrabold">{fmtEur(Number(finished.price ?? 0))}</div>
          <div className="text-muted">
            {fmtKm(Number(finished.distanceKm))} km · {finished.customerName}
          </div>
          <button type="button" className="btn-ghost mt-2" onClick={() => setFinished(null)}>
            OK
          </button>
        </div>
      )}

      {current ? (
        <RideCard ride={current} now={now} busy={busy} onAct={act} />
      ) : (
        !finished && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center text-muted">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-panel">
              <TaxiIcon size={44} color="#FFC400" />
            </div>
            {online ? (
              <p className="m-0">Si online. Čakám na jazdu od dispečingu…</p>
            ) : (
              <>
                <p className="m-0">Si offline – dispečing ti neposiela jazdy.</p>
                <button
                  type="button"
                  className="btn-primary px-8 py-4 text-lg uppercase"
                  onClick={() => setStatus('available')}
                >
                  Začať smenu
                </button>
              </>
            )}
          </div>
        )
      )}

      {queued.length > 0 && (
        <div className="card flex flex-col gap-2">
          <div className="text-xs uppercase tracking-[2px] text-muted">Ďalšie jazdy ({queued.length})</div>
          {queued.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-2 border-t border-line pt-2 text-sm"
            >
              <span className="min-w-0 truncate">
                {r.pickupAddress} → {r.dropoffAddress}
              </span>
              {r.status === 'assigned' ? (
                <button
                  type="button"
                  className="btn-outline shrink-0 py-1.5 text-sm"
                  disabled={busy}
                  onClick={() => act(r, 'accept')}
                >
                  Prijať
                </button>
              ) : (
                <span className="shrink-0 text-muted">{STATUS_LABEL[r.status]}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <button type="button" onClick={logout} className="mt-auto self-center py-2 text-sm text-muted">
        Odhlásiť sa
      </button>
    </div>
  );
}

function StatusSwitch({ status, onChange }: { status: DriverStatus; onChange: (s: DriverStatus) => void }) {
  if (status === 'busy') {
    return <span className="rounded-full bg-text px-3.5 py-2 text-sm font-bold text-black">Na jazde</span>;
  }
  const opts: { s: DriverStatus; label: string }[] = [
    { s: 'available', label: 'Online' },
    { s: 'break', label: 'Pauza' },
    { s: 'offline', label: 'Off' },
  ];
  return (
    <div className="flex rounded-full bg-panel p-1">
      {opts.map((o) => (
        <button
          key={o.s}
          type="button"
          onClick={() => onChange(o.s)}
          aria-pressed={status === o.s}
          className={`rounded-full px-3 py-1.5 text-sm font-bold ${status === o.s ? (o.s === 'available' ? 'bg-taxi text-black' : 'bg-raised text-text') : 'text-muted'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function RideCard({
  ride,
  now,
  busy,
  onAct,
}: {
  ride: Ride;
  now: number;
  busy: boolean;
  onAct: (r: Ride, a: 'accept' | 'reject' | 'arrived' | 'start' | 'finish') => void;
}) {
  const s = ride.status;
  const duration = ride.startedAt
    ? Math.max(0, Math.floor((now - new Date(ride.startedAt).getTime()) / 1000))
    : 0;
  const mmss = `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`;
  const toB = s === 'in_progress';

  return (
    <div
      className={`flex flex-1 flex-col gap-4 rounded-[22px] bg-panel p-5 ${s === 'assigned' ? 'border-2 border-taxi' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-bold uppercase tracking-[2px] text-taxi">
            {s === 'assigned' ? 'Nová jazda' : STATUS_LABEL[s]}
          </div>
          {toB ? (
            <div className="font-display text-[64px] font-extrabold leading-[0.95] tabular-nums">
              {fmtKm(Number(ride.distanceKm))} <span className="text-[26px] text-taxi">km</span>
            </div>
          ) : (
            <div className="font-display text-[30px] font-bold leading-tight">{ride.customerName}</div>
          )}
          <div className="text-[13px] text-muted">
            {toB ? `trvanie ${mmss}` : `${ride.passengers} ${ride.passengers === 1 ? 'osoba' : 'osoby'}`}
            {ride.scheduledAt &&
              !toB &&
              ` · na ${new Date(ride.scheduledAt).toLocaleString('sk-SK', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' })}`}
          </div>
        </div>
      </div>

      <div className="flex gap-3.5">
        <div className="flex flex-col items-center pt-1">
          <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-taxi text-xs font-extrabold text-black">
            A
          </div>
          <div className="my-1 w-0.5 flex-1 bg-[#3a3a3a]" />
          <div className="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-text text-xs font-extrabold text-black">
            B
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-4">
          <AddressRow
            address={ride.pickupAddress}
            lat={ride.pickupLat}
            lng={ride.pickupLng}
            dim={toB}
            showNav={!toB && s !== 'assigned'}
          />
          <AddressRow
            address={ride.dropoffAddress}
            lat={ride.dropoffLat}
            lng={ride.dropoffLng}
            dim={false}
            showNav={toB}
          />
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-[14px] bg-ink p-3.5">
        <div className="min-w-0 flex-1">
          <div className="font-bold">{ride.customerName}</div>
          <div className="text-sm text-soft">{ride.customerPhone}</div>
        </div>
        <a
          href={telHref(ride.customerPhone)}
          aria-label="Zavolať zákazníkovi"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-taxi"
        >
          <svg
            width="22"
            height="22"
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
      </div>

      {ride.note && (
        <div className="rounded-xl bg-taxi-dim px-3.5 py-3 text-sm text-[#f2e3b0]">{ride.note}</div>
      )}

      <div className="mt-auto flex gap-2.5">
        {s === 'assigned' && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAct(ride, 'reject')}
              className="btn-ghost h-[60px] flex-1 rounded-2xl text-base"
            >
              Odmietnuť
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAct(ride, 'accept')}
              className="btn-primary h-[60px] flex-[2] rounded-2xl text-lg font-extrabold uppercase"
            >
              Prijať jazdu
            </button>
          </>
        )}
        {s === 'accepted' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAct(ride, 'arrived')}
            className="btn-primary h-[60px] flex-1 rounded-2xl text-lg font-extrabold uppercase"
          >
            Som na mieste
          </button>
        )}
        {s === 'arrived' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAct(ride, 'start')}
            className="btn-primary h-[60px] flex-1 rounded-2xl text-lg font-extrabold uppercase"
          >
            Zákazník nastúpil · štart
          </button>
        )}
        {s === 'in_progress' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => confirm('Ukončiť jazdu?') && onAct(ride, 'finish')}
            className="btn-primary h-[62px] flex-1 rounded-2xl text-lg font-extrabold uppercase"
          >
            Ukončiť jazdu
          </button>
        )}
      </div>
    </div>
  );
}

function AddressRow({
  address,
  lat,
  lng,
  dim,
  showNav,
}: {
  address: string;
  lat: number | null;
  lng: number | null;
  dim: boolean;
  showNav: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className={`min-w-0 flex-1 text-lg font-bold ${dim ? 'text-muted' : ''}`}>{address}</div>
      {showNav && (
        <a
          href={navHref(address, lat, lng)}
          target="_blank"
          rel="noreferrer"
          aria-label="Navigovať"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-raised"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#FFC400"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 11l18-8-8 18-2-8z" />
          </svg>
        </a>
      )}
    </div>
  );
}
