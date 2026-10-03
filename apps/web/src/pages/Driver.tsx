import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AddressInput } from '../components/AddressInput';
import { TaxiIcon, Wordmark } from '../components/Brand';
import { DriverNav, type NavPos, type NavTarget } from '../components/DriverNav';
import { IncidentReport } from '../components/IncidentReport';
import { IncomingRideAlert } from '../components/IncomingRideAlert';
import { Modal } from '../components/Modal';
import { ShiftBar, ShiftStart } from '../components/ShiftControls';
import { testRing, unlockAudio } from '../lib/alarm';
import {
  api,
  type DriverShiftInfo,
  type DriverStatus,
  type Driver as DriverT,
  fmtEur,
  fmtKm,
  type Ride,
  STATUS_LABEL,
  telHref,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { enablePush, keepScreenOn, type PushState, pushState, registerSW } from '../lib/pwa';
import { useSocket } from '../lib/socket';

type Pos = { lat: number; lng: number; accuracy: number };

const PRIORITY: Record<string, number> = { in_progress: 0, arrived: 1, accepted: 2, assigned: 3 };
const SEND_EVERY_MS = 10_000;
const SEND_EVERY_RIDE_MS = 5_000;

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
  const [street, setStreet] = useState(false);
  const [pos, setPos] = useState<NavPos | null>(null);
  const [nav, setNav] = useState<NavTarget | null>(null);
  const [incident, setIncident] = useState(false);
  const [toast, setToast] = useState('');
  const lastSent = useRef(0);
  const lastPos = useRef<Pos | null>(null);

  const [shiftInfo, setShiftInfo] = useState<DriverShiftInfo | null>(null);

  const load = useCallback(async () => {
    const [m, r, sh] = await Promise.all([
      api<DriverT>('/api/driver/me'),
      api<Ride[]>('/api/driver/rides'),
      api<DriverShiftInfo>('/api/driver/shift'),
    ]);
    setMe(m);
    setRides(r);
    setShiftInfo(sh);
  }, []);

  // prehliadač pustí zvuk až po dotyku – odomkneme ho pri každom ťuknutí do appky
  useEffect(() => {
    const unlock = () => unlockAudio();
    document.addEventListener('pointerdown', unlock);
    return () => document.removeEventListener('pointerdown', unlock);
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
        const rest = list.filter((x) => x.id !== r.id);
        return PRIORITY[r.status] !== undefined ? [...rest, r] : rest;
      });
      if (r.status === 'cancelled') setErr(`Dispečing zrušil jazdu: ${r.pickupAddress}`);
    },
    'ride:removed': ({ id }: { id: number }) => setRides((list) => list.filter((x) => x.id !== id)),
    'shift:ended': ({ reason, by }: { reason: string; by: string }) => {
      setErr(
        reason === 'takeover'
          ? `Tvoju smenu ukončil prevzatím auta vodič ${by}. Konečný stav km sa doplnil z jeho počiatočného stavu.`
          : `Dispečer (${by}) ukončil tvoju smenu.`,
      );
      load().catch(() => {});
    },
    'schedule:updated': () => load().catch(() => {}),
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
        lastPos.current = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        setPos({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
        });
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

  const incoming = rides
    .filter((r) => r.status === 'assigned')
    .sort((a, b) => (a.assignedAt ?? '').localeCompare(b.assignedAt ?? ''));

  const sorted = [...rides].sort((a, b) => PRIORITY[a.status] - PRIORITY[b.status]);
  const current = sorted[0];
  const queued = sorted.slice(1);
  const shift = shiftInfo?.shift ?? null;

  // bez smeny: najprv výber auta a počiatočný stav km
  if (shiftInfo && !shift) {
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col gap-4 bg-ink px-4 pt-[max(16px,env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between">
          <Wordmark size={24} />
          <span className="text-sm text-muted">{me?.name}</span>
        </div>
        {err && (
          <button
            type="button"
            onClick={() => setErr('')}
            className="rounded-xl bg-red-950/70 p-3 text-left text-sm text-red-100"
          >
            {err}
          </button>
        )}
        <ShiftStart
          info={shiftInfo}
          onStarted={() => {
            setErr('');
            load().catch((e) => setErr(e.message));
          }}
        />
        <div className="flex flex-wrap items-center justify-center gap-x-6">
          <button type="button" onClick={() => setIncident(true)} className="py-2 text-sm text-taxi">
            Nahlásiť incident
          </button>
          <button type="button" onClick={testRing} className="py-2 text-sm text-muted">
            Vyskúšať zvonenie
          </button>
          <button type="button" onClick={logout} className="py-2 text-sm text-muted">
            Odhlásiť sa
          </button>
        </div>
        {incident && (
          <IncidentReport
            onClose={() => setIncident(false)}
            onSent={() => {
              setIncident(false);
              setErr('');
              alert('Incident odoslaný dispečingu');
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col gap-3.5 bg-ink px-4 pt-[max(16px,env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between">
        <Wordmark size={24} />
        <div className="flex items-center gap-2">
          <StatusButton status={me?.status ?? 'offline'} onChange={setStatus} />
          <DriverMenu onIncident={() => setIncident(true)} onTestRing={testRing} onLogout={logout} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
        <span>{me?.name}</span>
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

      {shift && (
        <ShiftBar
          shift={shift}
          canEnd={!rides.some((r) => ['accepted', 'arrived', 'in_progress'].includes(r.status))}
          onEnded={() => {
            setFinished(null);
            load().catch((e) => setErr(e.message));
          }}
        />
      )}

      {online && !inProgress && !street && (
        <button
          type="button"
          onClick={() => {
            setFinished(null);
            setStreet(true);
          }}
          className="btn-outline h-14 rounded-2xl text-base font-bold uppercase tracking-wide"
        >
          + Zobrať zákazníka z ulice
        </button>
      )}

      {street && (
        <StreetRideForm
          lastPos={lastPos.current}
          onCancel={() => setStreet(false)}
          onCreated={(r) => {
            setRides((l) => [...l.filter((x) => x.id !== r.id), r]);
            setMe((m) => (m ? { ...m, status: 'busy' } : m));
            setStreet(false);
          }}
        />
      )}

      {finished && !current && !street && (
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

      {street ? null : current ? (
        <RideCard ride={current} now={now} busy={busy} onAct={act} onNavigate={setNav} />
      ) : (
        !finished && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center text-muted">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-panel">
              <TaxiIcon size={44} color="#FFC400" />
            </div>
            {me?.status === 'break' ? (
              <p className="m-0">Máš pauzu – dispečing ti neposiela jazdy. Prepni sa na Online.</p>
            ) : (
              <p className="m-0">Si online. Čakám na jazdu od dispečingu…</p>
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

      {nav && !incoming.length && <DriverNav target={nav} pos={pos} onClose={() => setNav(null)} />}

      {incoming[0] && (
        <IncomingRideAlert
          key={incoming[0].id}
          ride={incoming[0]}
          waiting={incoming.length - 1}
          pos={pos}
          busy={busy}
          onAccept={() => act(incoming[0], 'accept')}
          onReject={() => confirm('Naozaj odmietnuť jazdu?') && act(incoming[0], 'reject')}
        />
      )}

      {incident && (
        <IncidentReport
          onClose={() => setIncident(false)}
          onSent={() => {
            setIncident(false);
            setToast('Incident odoslaný dispečingu');
            setTimeout(() => setToast(''), 3500);
          }}
        />
      )}

      {toast && (
        <div className="fixed inset-x-4 bottom-[max(16px,env(safe-area-inset-bottom))] z-[3100] mx-auto max-w-md rounded-xl bg-taxi px-4 py-3 text-center font-semibold text-black shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}

const STATUS_OPTS: { s: 'available' | 'break'; label: string; hint: string }[] = [
  { s: 'available', label: 'Online', hint: 'Dispečing ti posiela jazdy' },
  { s: 'break', label: 'Pauza', hint: 'Nedostávaš nové jazdy' },
];

/** Tlačidlo so stavom – klik otvorí popup s výberom (Online / Pauza). */
function StatusButton({ status, onChange }: { status: DriverStatus; onChange: (s: DriverStatus) => void }) {
  const [open, setOpen] = useState(false);
  if (status === 'busy') {
    return <span className="rounded-full bg-text px-3.5 py-2 text-sm font-bold text-black">Na jazde</span>;
  }
  const label = status === 'break' ? 'Pauza' : status === 'available' ? 'Online' : 'Offline';
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={`flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-bold ${status === 'available' ? 'bg-taxi text-black' : 'bg-raised text-text'}`}
      >
        <span
          className={`h-2.5 w-2.5 rounded-full ${status === 'available' ? 'bg-black' : 'bg-muted'}`}
          aria-hidden="true"
        />
        {label}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <Modal title="Môj stav" onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-2.5">
            {STATUS_OPTS.map((o) => {
              const active = status === o.s;
              return (
                <button
                  key={o.s}
                  type="button"
                  onClick={() => {
                    if (!active) onChange(o.s);
                    setOpen(false);
                  }}
                  className={`flex items-center gap-3 rounded-2xl p-4 text-left ${active ? 'border-2 border-taxi bg-taxi-dim' : 'border border-line'}`}
                >
                  <span
                    className={`h-4 w-4 shrink-0 rounded-full ${o.s === 'available' ? 'bg-taxi' : 'bg-[#5a5a5a]'}`}
                    aria-hidden="true"
                  />
                  <span className="flex-1">
                    <span className="block text-lg font-bold">{o.label}</span>
                    <span className="block text-sm text-muted">{o.hint}</span>
                  </span>
                  {active && <span className="text-sm font-semibold text-taxi">aktuálne</span>}
                </button>
              );
            })}
          </div>
        </Modal>
      )}
    </>
  );
}

/** Hamburger menu vodiča. */
function DriverMenu({
  onIncident,
  onTestRing,
  onLogout,
}: {
  onIncident: () => void;
  onTestRing: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const item = 'flex w-full items-center gap-3 px-4 py-3.5 text-left text-base hover:bg-raised';
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Menu"
        aria-expanded={open}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-panel text-text"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Zavrieť menu"
            className="fixed inset-0 z-[1500] cursor-default bg-black/50"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute top-12 right-0 z-[1600] w-64 overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl"
          >
            <button
              type="button"
              role="menuitem"
              className={`${item} font-semibold text-taxi`}
              onClick={pick(onIncident)}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                <path d="M12 9v4M12 17h.01" />
              </svg>
              Incident
            </button>
            <button
              type="button"
              role="menuitem"
              className={`${item} border-t border-line text-soft`}
              onClick={pick(onTestRing)}
            >
              Vyskúšať zvonenie
            </button>
            <button
              type="button"
              role="menuitem"
              className={`${item} border-t border-line text-soft`}
              onClick={pick(onLogout)}
            >
              Odhlásiť sa
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function RideCard({
  ride,
  now,
  busy,
  onAct,
  onNavigate,
}: {
  ride: Ride;
  now: number;
  busy: boolean;
  onAct: (r: Ride, a: 'accept' | 'reject' | 'arrived' | 'start' | 'finish') => void;
  onNavigate: (t: NavTarget) => void;
}) {
  const navA = () =>
    onNavigate({
      label: 'Nástup (A)',
      address: ride.pickupAddress,
      lat: ride.pickupLat,
      lng: ride.pickupLng,
    });
  const navB = () =>
    onNavigate({
      label: 'Cieľ (B)',
      address: ride.dropoffAddress,
      lat: ride.dropoffLat,
      lng: ride.dropoffLng,
    });
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
            dim={toB}
            onNav={!toB && s !== 'assigned' ? navA : undefined}
          />
          <AddressRow address={ride.dropoffAddress} dim={false} onNav={toB ? navB : undefined} />
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-[14px] bg-ink p-3.5">
        <div className="min-w-0 flex-1">
          <div className="font-bold">{ride.customerName}</div>
          <div className="text-sm text-soft">
            {ride.customerPhone ?? (ride.source === 'street' ? 'zákazník z ulice' : '')}
          </div>
        </div>
        {ride.customerPhone && (
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
        )}
      </div>

      {ride.note && (
        <div className="rounded-xl bg-taxi-dim px-3.5 py-3 text-sm text-[#f2e3b0]">{ride.note}</div>
      )}

      {(s === 'accepted' || s === 'in_progress') && (
        <button
          type="button"
          onClick={s === 'accepted' ? navA : navB}
          className="btn-outline h-14 rounded-2xl text-base font-bold uppercase"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 11l18-8-8 18-2-8z" />
          </svg>
          {s === 'accepted' ? 'Navigovať k zákazníkovi' : 'Navigovať do cieľa'}
        </button>
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

function AddressRow({ address, dim, onNav }: { address: string; dim: boolean; onNav?: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`min-w-0 flex-1 text-lg font-bold ${dim ? 'text-muted' : ''}`}>{address}</div>
      {onNav && (
        <button
          type="button"
          onClick={onNav}
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
        </button>
      )}
    </div>
  );
}

function currentPosition(): Promise<Pos> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? 'Povoľ prístup k polohe' : 'Polohu sa nepodarilo zistiť')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    ),
  );
}

type Place = { address: string; lat: number | null; lng: number | null };

/** Jazda z ulice: bod A = aktuálna poloha (dá sa prepísať), bod B zadá vodič. Po štarte sa hneď počítajú km. */
function StreetRideForm({
  lastPos,
  onCancel,
  onCreated,
}: {
  lastPos: Pos | null;
  onCancel: () => void;
  onCreated: (r: Ride) => void;
}) {
  const [pickup, setPickup] = useState<Place>({ address: '', lat: null, lng: null });
  const [dropoff, setDropoff] = useState<Place>({ address: '', lat: null, lng: null });
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [passengers, setPassengers] = useState(1);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const fillFromGps = useCallback(async (known: Pos | null) => {
    setLocating(true);
    setError('');
    try {
      const pos = known && known.accuracy <= 100 ? known : await currentPosition();
      setPickup({ address: `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`, lat: pos.lat, lng: pos.lng });
      const r = await api<{ label: string }>(`/api/geocode/reverse?lat=${pos.lat}&lng=${pos.lng}`);
      setPickup({ address: r.label, lat: pos.lat, lng: pos.lng });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLocating(false);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: poloha sa načíta len pri otvorení formulára
  useEffect(() => {
    fillFromGps(lastPos);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const ride = await api<Ride>('/api/driver/rides/street', {
        body: {
          pickupAddress: pickup.address,
          pickupLat: pickup.lat ?? undefined,
          pickupLng: pickup.lng ?? undefined,
          dropoffAddress: dropoff.address,
          dropoffLat: dropoff.lat ?? undefined,
          dropoffLng: dropoff.lng ?? undefined,
          customerName: name || undefined,
          customerPhone: phone || undefined,
          passengers,
        },
      });
      onCreated(ride);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-1 flex-col gap-3.5 rounded-[22px] border-2 border-taxi bg-panel p-5"
    >
      <div className="text-[13px] font-bold uppercase tracking-[2px] text-taxi">Zákazník z ulice</div>

      <div className="flex flex-col gap-1.5">
        <AddressInput
          label="A · Nástup"
          value={locating && !pickup.address ? 'Zisťujem polohu…' : pickup.address}
          onChange={setPickup}
        />
        <button
          type="button"
          className="self-start text-sm text-taxi"
          disabled={locating}
          onClick={() => fillFromGps(null)}
        >
          {locating ? 'Zisťujem polohu…' : '⌖ Použiť aktuálnu polohu'}
        </button>
      </div>

      <AddressInput label="B · Cieľ" value={dropoff.address} onChange={setDropoff} />

      <div className="flex gap-2.5">
        <label className="label flex-[2]">
          Meno (nepovinné)
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="label flex-1">
          Osoby
          <input
            className="field"
            type="number"
            min={1}
            max={8}
            value={passengers}
            onChange={(e) => setPassengers(Number(e.target.value))}
          />
        </label>
      </div>
      <label className="label">
        Telefón (nepovinné)
        <input className="field" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>

      {error && <div className="rounded-lg bg-red-950/70 px-3 py-2 text-sm text-red-100">{error}</div>}

      <div className="mt-auto flex gap-2.5 pt-1">
        <button type="button" onClick={onCancel} className="btn-ghost h-[60px] flex-1 rounded-2xl text-base">
          Zrušiť
        </button>
        <button
          type="submit"
          disabled={busy || locating || !pickup.address || !dropoff.address}
          className="btn-primary h-[60px] flex-[2] rounded-2xl text-lg font-extrabold uppercase"
        >
          Štart jazdy
        </button>
      </div>
      <p className="m-0 text-center text-xs text-muted">
        Dispečing uvidí jazdu a auto bude označené ako obsadené.
      </p>
    </form>
  );
}
