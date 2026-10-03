import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddressInput } from '../components/AddressInput';
import { DriverDetailCard } from '../components/DriverDetailCard';
import { DriversPanel } from '../components/DriversPanel';
import {
  FleetMap,
  type LabelMode,
  type MapFocus,
  type PickTarget,
  type RideFocus,
  STUPAVA,
  type TrackedRide,
} from '../components/FleetMap';
import { Header } from '../components/Header';
import { Modal } from '../components/Modal';
import {
  api,
  DRIVER_LABEL,
  type Driver,
  type DriverStatus,
  fmtEstimate,
  fmtEur,
  fmtKm,
  fmtTime,
  type GeoResult,
  haversineKm,
  initials,
  type Ride,
  STATUS_LABEL,
  telHref,
} from '../lib/api';
import { useSocket } from '../lib/socket';

const OPEN = ['new', 'assigned', 'accepted', 'arrived', 'in_progress'];
const ACTIVE = ['accepted', 'arrived', 'in_progress'];
const STATUS_ORDER: Record<DriverStatus, number> = { available: 0, busy: 1, break: 2, offline: 3 };

type Config = { priceMin: number; pricePerKm: number };

// Súhrnné dlaždice (čakajúce, aktívne, vodiči online, voľní) – dočasne skryté, pripravené na neskoršie použitie
const SHOW_KPI = false;

const LABEL_KEY = 'dt_map_label';
function readLabelMode(): LabelMode {
  try {
    return localStorage.getItem(LABEL_KEY) === 'initials' ? 'initials' : 'car';
  } catch {
    return 'car';
  }
}

const emptyForm = {
  customerName: '',
  customerPhone: '',
  pickupAddress: '',
  pickupLat: null as number | null,
  pickupLng: null as number | null,
  dropoffAddress: '',
  dropoffLat: null as number | null,
  dropoffLng: null as number | null,
  passengers: 1,
  scheduledAt: '',
  note: '',
};

export function Dispatch() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoverDriver, setHoverDriver] = useState<number | null>(null);
  const [assignId, setAssignId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [cfg, setCfg] = useState<Config>({ priceMin: 3.5, pricePerKm: 1 });
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [labelMode, setLabelMode] = useState<LabelMode>(readLabelMode);
  const [pickTarget, setPickTarget] = useState<PickTarget | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailRefresh, setDetailRefresh] = useState(0);
  const mapRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [rideFocus, setRideFocus] = useState<RideFocus | null>(null);
  const [trackedId, setTrackedId] = useState<number | null>(null);
  const [trackedRoute, setTrackedRoute] = useState<[number, number][] | null>(null);
  const [trackSeq, setTrackSeq] = useState(0);

  /** Výber objednávky zo zoznamu: mapa sa posunie na bod A len ak nie je viditeľný. */
  function selectRideFromList(r: Ride) {
    setSelectedId(r.id);
    if (r.pickupLat !== null && r.pickupLng !== null) {
      setRideFocus((f) => ({ lat: r.pickupLat!, lng: r.pickupLng!, seq: (f?.seq ?? 0) + 1 }));
    }
  }
  const [mapQuery, setMapQuery] = useState('');
  const [mapSearching, setMapSearching] = useState(false);
  const [mapSearchErr, setMapSearchErr] = useState('');

  async function searchOnMap(e: FormEvent) {
    e.preventDefault();
    const q = mapQuery.trim();
    if (q.length < 3) return;
    setMapSearching(true);
    setMapSearchErr('');
    try {
      const [hit] = await api<GeoResult[]>(`/api/geocode?q=${encodeURIComponent(q)}`);
      if (!hit) setMapSearchErr('Adresu sa nepodarilo nájsť');
      else
        setFocus((f) => ({
          lat: hit.lat,
          lng: hit.lng,
          zoom: 16,
          label: hit.label.split(',').slice(0, 2).join(','),
          seq: (f?.seq ?? 0) + 1,
        }));
    } catch (err) {
      setMapSearchErr((err as Error).message);
    } finally {
      setMapSearching(false);
    }
  }

  function changeLabelMode(m: LabelMode) {
    setLabelMode(m);
    try {
      localStorage.setItem(LABEL_KEY, m);
    } catch {
      /* súkromné okno */
    }
  }

  // Esc zruší výber bodu na mape
  useEffect(() => {
    if (!pickTarget) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPickTarget(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickTarget]);

  function startPick(t: PickTarget) {
    if (pickTarget === t) return setPickTarget(null);
    setPickTarget(t);
    // na úzkej obrazovke je mapa pod formulárom → posuň ju do zorného poľa
    const r = mapRef.current?.getBoundingClientRect();
    if (r && (r.top < 0 || r.bottom > window.innerHeight))
      mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function pickPoint(lat: number, lng: number) {
    const t = pickTarget;
    if (!t) return;
    setPickTarget(null);
    const coords = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const apply = (address: string) =>
      setForm((f) =>
        t === 'A'
          ? { ...f, pickupAddress: address, pickupLat: lat, pickupLng: lng }
          : { ...f, dropoffAddress: address, dropoffLat: lat, dropoffLng: lng },
      );
    apply(coords);
    try {
      const r = await api<{ label: string }>(`/api/geocode/reverse?lat=${lat}&lng=${lng}`);
      // prepíš len ak medzitým dispečer nezmenil bod
      setForm((f) => {
        const same =
          t === 'A'
            ? f.pickupLat === lat && f.pickupLng === lng
            : f.dropoffLat === lat && f.dropoffLng === lng;
        if (!same) return f;
        return t === 'A' ? { ...f, pickupAddress: r.label } : { ...f, dropoffAddress: r.label };
      });
    } catch {
      flash('Adresu sa nepodarilo zistiť – ostali súradnice, môžeš ich prepísať');
    }
  }

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 5000);
  }, []);

  const load = useCallback(async () => {
    const [r, d] = await Promise.all([api<Ride[]>('/api/rides'), api<Driver[]>('/api/drivers')]);
    setRides(r);
    setDrivers(d);
  }, []);

  useEffect(() => {
    load().catch((e) => flash(e.message));
    api<Config>('/api/config')
      .then(setCfg)
      .catch(() => {});
  }, [load, flash]);

  const connected = useSocket({
    'ride:updated': (r: Ride) => {
      setRides((list) => {
        const rest = list.filter((x) => x.id !== r.id);
        return OPEN.includes(r.status) ? [...rest, r].sort((a, b) => a.id - b.id) : rest;
      });
      if (r.driverId && r.driverId === detailId) setDetailRefresh((n) => n + 1);
    },
    'ride:distance': ({ id, distanceKm }: { id: number; distanceKm: number }) =>
      setRides((list) => list.map((r) => (r.id === id ? { ...r, distanceKm } : r))),
    'driver:location': (p: { id: number; lat: number; lng: number; accuracy: number | null; at: string }) =>
      setDrivers((list) =>
        list.map((d) =>
          d.id === p.id ? { ...d, lat: p.lat, lng: p.lng, accuracy: p.accuracy, lastSeenAt: p.at } : d,
        ),
      ),
    'driver:updated': (d: Driver) =>
      setDrivers((list) =>
        list.some((x) => x.id === d.id) ? list.map((x) => (x.id === d.id ? d : x)) : [...list, d],
      ),
    'ride:rejected': ({ driverName }: { driverName: string }) =>
      flash(`${driverName} odmietol jazdu – vyber iného vodiča`),
    'incident:new': (i: { id: number; driverName: string; vehicleCallsign: string | null }) =>
      flash(
        `⚠ Incident #${i.id} – ${i.driverName}${i.vehicleCallsign ? `, auto ${i.vehicleCallsign}` : ''} (menu Incidenty)`,
      ),
    'ride:street': ({ driverName, callsign }: { driverName: string; callsign: string | null }) =>
      flash(
        `${callsign ? `Auto ${callsign} · ` : ''}${driverName} zobral zákazníka z ulice – auto je obsadené`,
      ),
  });

  // reconnect = načítaj znova, nech nič neušlo
  useEffect(() => {
    if (connected) load().catch(() => {});
  }, [connected, load]);

  const pending = rides.filter((r) => r.status === 'new' || r.status === 'assigned');
  const active = rides.filter((r) => ACTIVE.includes(r.status));
  const trackedRide = active.find((r) => r.id === trackedId) ?? null;

  // jazda skončila / bola zrušená → prestaň ju sledovať
  useEffect(() => {
    if (trackedId !== null && !trackedRide) {
      setTrackedId(null);
      setTrackedRoute(null);
    }
  }, [trackedId, trackedRide]);

  // cestná trasa A→B (OSRM); načíta sa znova, keď jazda dostane súradnice (geokódovanie na pozadí)
  const tA =
    trackedRide && trackedRide.pickupLat !== null
      ? `${trackedRide.pickupLat},${trackedRide.pickupLng}`
      : null;
  const tB =
    trackedRide && trackedRide.dropoffLat !== null
      ? `${trackedRide.dropoffLat},${trackedRide.dropoffLng}`
      : null;
  useEffect(() => {
    setTrackedRoute(null);
    if (!tA || !tB) return;
    let alive = true;
    api<{ geometry: [number, number][] }>(`/api/route?from=${tA}&to=${tB}`)
      .then((r) => alive && setTrackedRoute(r.geometry))
      .catch(() => alive && setTrackedRoute(null));
    return () => {
      alive = false;
    };
  }, [tA, tB]);

  const tracked: TrackedRide | null = useMemo(
    () =>
      trackedRide
        ? {
            id: trackedRide.id,
            a: trackedRide.pickupLat !== null ? [trackedRide.pickupLat, trackedRide.pickupLng!] : null,
            b: trackedRide.dropoffLat !== null ? [trackedRide.dropoffLat, trackedRide.dropoffLng!] : null,
            route: trackedRoute,
            driverId: trackedRide.driverId,
            toPickup: trackedRide.status === 'accepted' || trackedRide.status === 'arrived',
            label: trackedRide.customerName,
            seq: trackSeq,
          }
        : null,
    [trackedRide, trackedRoute, trackSeq],
  );

  function trackRide(r: Ride) {
    if (trackedId === r.id) {
      setTrackedId(null);
      return;
    }
    setTrackedId(r.id);
    setTrackSeq((n) => n + 1);
    if (r.driverId) {
      setDetailId(r.driverId);
      setDetailRefresh((n) => n + 1);
    }
  }
  const selected = rides.find((r) => r.id === selectedId) ?? null;
  const online = drivers.filter((d) => d.status !== 'offline');

  const assignRide =
    rides.find((r) => r.id === assignId && (r.status === 'new' || r.status === 'assigned')) ?? null;

  function openAssign(r: Ride) {
    selectRideFromList(r);
    setAssignId(r.id);
  }
  function closeAssign() {
    setAssignId(null);
    setHoverDriver(null);
  }

  const candidates = useMemo(() => {
    const ride = assignRide;
    return drivers
      .map((d) => {
        const dist =
          ride?.pickupLat && ride.pickupLng && d.lat && d.lng
            ? haversineKm(d.lat, d.lng, ride.pickupLat, ride.pickupLng)
            : null;
        return { ...d, dist };
      })
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.dist ?? 1e9) - (b.dist ?? 1e9));
  }, [drivers, assignRide]);

  const estimateKm =
    form.pickupLat && form.pickupLng && form.dropoffLat && form.dropoffLng
      ? haversineKm(form.pickupLat, form.pickupLng, form.dropoffLat, form.dropoffLng) * 1.25 // vzdušná → cestná
      : null;

  async function createRide(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<Ride>('/api/rides', {
        body: {
          ...form,
          scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : undefined,
        },
      });
      setRides((list) => (list.some((x) => x.id === r.id) ? list : [...list, r]));
      setSelectedId(r.id);
      setAssignId(r.id); // rovno ponúkni výber vodiča
      setForm(emptyForm);
    } catch (err) {
      flash((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function assign(rideId: number, driverId: number, name: string) {
    try {
      await api(`/api/rides/${rideId}/assign`, { body: { driverId } });
      closeAssign();
      flash(`Jazda poslaná: ${name}`);
    } catch (err) {
      flash((err as Error).message);
    }
  }

  async function cancel(ride: Ride) {
    if (!confirm(`Zrušiť jazdu pre ${ride.customerName}?`)) return;
    try {
      await api(`/api/rides/${ride.id}/cancel`, { method: 'POST' });
      if (selectedId === ride.id) setSelectedId(null);
      if (assignId === ride.id) closeAssign();
    } catch (err) {
      flash((err as Error).message);
    }
  }

  return (
    <div className="min-h-screen bg-ink text-[15px]">
      <Header connected={connected} />

      {SHOW_KPI && (
        <section className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3 px-6 pt-4">
          <Kpi label="Čakajúce objednávky" value={pending.length} accent />
          <Kpi label="Aktívne jazdy" value={active.length} />
          <Kpi label="Vodiči online" value={`${online.length} / ${drivers.length}`} />
          <Kpi label="Voľní vodiči" value={drivers.filter((d) => d.status === 'available').length} />
        </section>
      )}

      <main className="flex flex-wrap items-start gap-4 px-6 pt-4 pb-6">
        {/* ---------- ľavý stĺpec: nová objednávka + čakajúce ---------- */}
        <aside className="flex min-w-0 max-w-[400px] flex-[1_1_320px] flex-col gap-4">
          <form onSubmit={createRide} className="card flex flex-col gap-3">
            <h2 className="h2">Nová objednávka</h2>
            <div className="flex gap-2.5">
              <label className="label flex-1">
                Meno zákazníka
                <input
                  className="field"
                  required
                  value={form.customerName}
                  onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                />
              </label>
              <label className="label flex-1">
                Telefón
                <input
                  className="field"
                  type="tel"
                  required
                  placeholder="+421 9xx xxx xxx"
                  value={form.customerPhone}
                  onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
                />
              </label>
            </div>
            <AddressInput
              label="A · Vyzdvihnutie"
              pinLabel="Bod A"
              onPickMap={() => startPick('A')}
              picking={pickTarget === 'A'}
              value={form.pickupAddress}
              onChange={(v) =>
                setForm((f) => ({ ...f, pickupAddress: v.address, pickupLat: v.lat, pickupLng: v.lng }))
              }
            />
            <AddressInput
              label="B · Cieľ"
              pinLabel="Bod B"
              onPickMap={() => startPick('B')}
              picking={pickTarget === 'B'}
              value={form.dropoffAddress}
              onChange={(v) =>
                setForm((f) => ({ ...f, dropoffAddress: v.address, dropoffLat: v.lat, dropoffLng: v.lng }))
              }
            />
            <div className="flex gap-2.5">
              <label className="label min-w-0 flex-1">
                Čas (prázdne = hneď)
                <input
                  className="field"
                  type="datetime-local"
                  value={form.scheduledAt}
                  onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
                />
              </label>
              <label className="label w-20 shrink-0">
                Osoby
                <input
                  className="field"
                  type="number"
                  min={1}
                  max={8}
                  value={form.passengers}
                  onChange={(e) => setForm({ ...form, passengers: Number(e.target.value) })}
                />
              </label>
            </div>
            <label className="label">
              Poznámka pre vodiča
              <textarea
                className="field resize-y"
                rows={2}
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </label>
            {estimateKm !== null && (
              <div className="flex items-center justify-between rounded-lg bg-ink px-3 py-2.5 text-[13px] text-muted">
                Odhad: ~{fmtKm(estimateKm)} km
                <span className="text-base font-bold text-text">
                  {fmtEur(Math.max(cfg.priceMin, estimateKm * cfg.pricePerKm))}
                </span>
              </div>
            )}
            <button
              type="submit"
              className="btn-primary py-3.5 text-base uppercase tracking-wide"
              disabled={busy}
            >
              Uložiť a vybrať vodiča
            </button>
          </form>

          <DriversPanel
            drivers={drivers}
            rides={rides}
            labelMode={labelMode}
            selectedId={detailId}
            onSelect={(d, ride) => {
              setDetailId(d.id);
              setDetailRefresh((n) => n + 1);
              if (ride && ACTIVE.includes(ride.status)) {
                if (trackedId !== ride.id) trackRide(ride);
              } else if (d.lat !== null && d.lng !== null) {
                setFocus((f) => ({ lat: d.lat!, lng: d.lng!, zoom: 15, seq: (f?.seq ?? 0) + 1 }));
              }
            }}
          />
        </aside>

        {/* ---------- stred: mapa + aktívne jazdy ---------- */}
        <section className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          <div ref={mapRef} className="overflow-hidden rounded-2xl bg-panel">
            <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-3.5">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="h2">Mapa vozidiel</h2>
                <fieldset className="m-0 flex rounded-lg border-0 bg-ink p-0.5 text-sm">
                  <legend className="sr-only">Popis áut na mape</legend>
                  {(
                    [
                      ['car', 'Číslo auta'],
                      ['initials', 'Iniciály vodiča'],
                    ] as const
                  ).map(([m, label]) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={labelMode === m}
                      onClick={() => changeLabelMode(m)}
                      className={`rounded-md px-3 py-1.5 font-semibold ${labelMode === m ? 'bg-taxi text-black' : 'text-soft hover:text-text'}`}
                    >
                      {label}
                    </button>
                  ))}
                </fieldset>
              </div>
              <form onSubmit={searchOnMap} className="flex min-w-0 flex-[1_1_320px] items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <input
                    className="field py-2 pr-9"
                    type="search"
                    aria-label="Hľadať adresu na mape"
                    placeholder="Hľadať adresu na mape…"
                    value={mapQuery}
                    onChange={(e) => {
                      setMapQuery(e.target.value);
                      setMapSearchErr('');
                    }}
                  />
                  <button
                    type="submit"
                    aria-label="Hľadať"
                    disabled={mapSearching}
                    className="absolute top-1/2 right-1 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:text-taxi"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <circle cx="11" cy="11" r="7" />
                      <path d="M20 20l-3.5-3.5" />
                    </svg>
                  </button>
                </div>
                <button
                  type="button"
                  className="btn-outline shrink-0 px-3 py-2 text-sm"
                  onClick={() => {
                    setMapSearchErr('');
                    setFocus((f) => ({ lat: STUPAVA[0], lng: STUPAVA[1], zoom: 14, seq: (f?.seq ?? 0) + 1 }));
                  }}
                >
                  Stupava
                </button>
              </form>
            </div>
            {mapSearchErr && <div className="px-4 pb-2 text-sm text-red-300">{mapSearchErr}</div>}
            {trackedRide && (
              <div className="mx-4 mb-3 flex items-center gap-3 rounded-xl border border-taxi/60 bg-taxi-dim px-3 py-2 text-sm text-[#f2e3b0]">
                <span className="font-bold text-taxi">Trasa</span>
                <span className="min-w-0 flex-1 truncate">
                  {trackedRide.customerName} · auto {trackedRide.vehicleCallsign ?? '?'} ·{' '}
                  {trackedRide.pickupAddress} → {trackedRide.dropoffAddress || 'bez cieľa'}
                  {trackedRide.estimateKm !== null && ` · ~${fmtEstimate(trackedRide.estimateKm)}`}
                  {!tA || !tB ? ' · body A/B ešte nemajú súradnice' : ''}
                </span>
                <button
                  type="button"
                  className="text-sm font-semibold text-taxi hover:text-taxi-hover"
                  onClick={() => setTrackSeq((n) => n + 1)}
                >
                  Vycentrovať
                </button>
                <button
                  type="button"
                  aria-label="Skryť trasu"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-lg text-muted hover:bg-raised hover:text-text"
                  onClick={() => setTrackedId(null)}
                >
                  ×
                </button>
              </div>
            )}
            <FleetMap
              drivers={drivers}
              selected={selected}
              highlightDriverId={hoverDriver}
              labelMode={labelMode}
              pickTarget={pickTarget}
              onPick={pickPoint}
              draftA={
                form.pickupLat !== null && form.pickupLng !== null ? [form.pickupLat, form.pickupLng] : null
              }
              draftB={
                form.dropoffLat !== null && form.dropoffLng !== null
                  ? [form.dropoffLat, form.dropoffLng]
                  : null
              }
              selectedDriverId={detailId}
              onSelectDriver={(id) => {
                setDetailId(id);
                setDetailRefresh((n) => n + 1);
              }}
              focus={focus}
              pending={pending}
              onSelectRide={setSelectedId}
              rideFocus={rideFocus}
              tracked={tracked}
            />
            <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-3 text-[13px] text-muted">
              <Legend color="#FFC400" label="voľný" />
              <Legend color="#F2F2F2" label="na jazde" />
              <Legend color="#5A5A5A" label="pauza" />
              <span>priehľadné = poloha staršia ako 2 min · klik na auto = detail</span>
            </div>
          </div>

          <div className="card">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="h2">Aktívne jazdy</h2>
              <span className="text-xs text-muted">klik na jazdu = trasa a auto na mape</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted">
                    <th className="px-2.5 py-2 font-semibold">Auto</th>
                    <th className="px-2.5 py-2 font-semibold">Vodič</th>
                    <th className="px-2.5 py-2 font-semibold">Zákazník</th>
                    <th className="px-2.5 py-2 font-semibold">Trasa</th>
                    <th className="px-2.5 py-2 font-semibold">Stav</th>
                    <th
                      className="px-2.5 py-2 text-right font-semibold"
                      title="Približná cestná vzdialenosť A→B podľa mapy"
                    >
                      Vzdialenosť
                    </th>
                    <th className="px-2.5 py-2 text-right font-semibold" title="Najazdené km podľa GPS">
                      Najazdené
                    </th>
                    <th className="px-2.5 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {active.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-2.5 py-4 text-muted">
                        Momentálne nikto nejazdí.
                      </td>
                    </tr>
                  )}
                  {active.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => trackRide(r)}
                      className={`cursor-pointer border-t border-[#2a2a2a] ${r.id === trackedId ? 'bg-taxi-dim' : 'hover:bg-raised'}`}
                    >
                      <td className="px-2.5 py-2.5 font-bold">
                        <button
                          type="button"
                          aria-pressed={r.id === trackedId}
                          aria-label={`Zobraziť trasu jazdy ${r.customerName} na mape`}
                          title="Zobraziť trasu a auto na mape"
                          className={`flex items-center gap-1.5 ${r.id === trackedId ? 'text-taxi' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            trackRide(r);
                          }}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <circle cx="6" cy="19" r="2.5" />
                            <circle cx="18" cy="5" r="2.5" />
                            <path d="M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5" />
                          </svg>
                          {r.vehicleCallsign ?? '–'}
                        </button>
                      </td>
                      <td className="px-2.5 py-2.5">{r.driverName}</td>
                      <td className="px-2.5 py-2.5">
                        {r.customerName}
                        {r.customerPhone && (
                          <a
                            className="ml-2 text-xs"
                            href={telHref(r.customerPhone)}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {r.customerPhone}
                          </a>
                        )}
                      </td>
                      <td className="px-2.5 py-2.5 text-soft">
                        {r.pickupAddress} → {r.dropoffAddress || 'bez cieľa'}
                      </td>
                      <td className="px-2.5 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${r.status === 'arrived' ? 'bg-[#3a3115] text-taxi-hover' : 'bg-raised'}`}
                        >
                          {STATUS_LABEL[r.status]}
                        </span>
                        {r.source === 'street' && <StreetBadge />}
                      </td>
                      <td className="px-2.5 py-2.5 text-right whitespace-nowrap tabular-nums text-soft">
                        {fmtEstimate(r.estimateKm)}
                      </td>
                      <td className="px-2.5 py-2.5 text-right font-bold tabular-nums">
                        {fmtKm(Number(r.distanceKm))}
                      </td>
                      <td className="px-2.5 py-2.5 text-right">
                        <button
                          type="button"
                          className="text-xs text-muted hover:text-text"
                          onClick={(e) => {
                            e.stopPropagation();
                            cancel(r);
                          }}
                        >
                          Zrušiť
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ---------- pravý stĺpec: čakajúce objednávky + detail vozidla ---------- */}
        <div className="flex min-w-0 max-w-[380px] flex-[1_1_300px] flex-col gap-4">
          <div className="card flex flex-col gap-2.5">
            <h2 className="h2">
              Čakajúce <span className="text-taxi">{pending.length}</span>
            </h2>
            {pending.length === 0 && <p className="m-0 text-sm text-muted">Žiadne čakajúce objednávky.</p>}
            {pending.map((r) => (
              <article
                key={r.id}
                className={`flex flex-col gap-2.5 rounded-[10px] p-3 ${
                  r.id === selectedId
                    ? 'border-2 border-taxi bg-taxi-dim'
                    : 'border border-line hover:border-[#444]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectRideFromList(r)}
                  className="text-left"
                  title="Ukázať na mape"
                >
                  <div className="flex justify-between gap-2 text-[13px] text-muted">
                    <span>
                      {fmtTime(r.createdAt)} · {r.scheduledAt ? `na ${fmtTime(r.scheduledAt)}` : 'hneď'}
                    </span>
                    <span className={r.status === 'assigned' ? 'font-semibold text-taxi' : ''}>
                      {r.status === 'assigned' ? `čaká na ${r.driverName}` : STATUS_LABEL[r.status]}
                    </span>
                  </div>
                  <div className="my-1 font-bold">{r.customerName}</div>
                  <div className="text-sm text-soft">
                    {r.pickupAddress} → {r.dropoffAddress || 'bez cieľa'}
                    {r.estimateKm !== null && (
                      <span className="text-muted"> · ~{fmtEstimate(r.estimateKm)}</span>
                    )}
                  </div>
                </button>
                <button
                  type="button"
                  className={r.status === 'new' ? 'btn-primary py-2 text-sm' : 'btn-outline py-2 text-sm'}
                  onClick={() => openAssign(r)}
                >
                  {r.status === 'new' ? 'Priradiť vodiča' : 'Zmeniť vodiča'}
                </button>
              </article>
            ))}
          </div>
          {detailId !== null && (
            <DriverDetailCard
              driverId={detailId}
              live={drivers.find((x) => x.id === detailId)}
              refreshKey={detailRefresh}
              onClose={() => setDetailId(null)}
            />
          )}
        </div>
      </main>

      {assignRide && (
        <Modal title={`Priradiť vodiča · ${assignRide.customerName}`} onClose={closeAssign}>
          <div className="flex flex-col gap-2.5">
            <div className="rounded-[10px] bg-ink p-3 text-sm">
              <div className="text-soft">
                {assignRide.pickupAddress} → {assignRide.dropoffAddress || 'bez cieľa'}
                {assignRide.estimateKm !== null && (
                  <span className="text-muted"> · ~{fmtEstimate(assignRide.estimateKm)}</span>
                )}
              </div>
              <div className="mt-1 text-[13px] text-muted">
                {assignRide.scheduledAt ? `na ${fmtTime(assignRide.scheduledAt)}` : 'hneď'} ·{' '}
                {assignRide.passengers} os.
                {assignRide.pickupLat ? ' · vodiči zoradení podľa vzdialenosti k A' : ''}
              </div>
            </div>
            {candidates
              .filter((d) => d.status !== 'offline')
              .map((d, i) => {
                const isCurrent = assignRide.driverId === d.id;
                const top = i === 0 && d.status === 'available';
                return (
                  // biome-ignore lint/a11y/noStaticElementInteractions: hover len zvýrazní trasu na mape
                  <div
                    key={d.id}
                    onMouseEnter={() => setHoverDriver(d.id)}
                    onMouseLeave={() => setHoverDriver(null)}
                    className={`flex flex-wrap items-center gap-2.5 rounded-xl p-3 ${top || isCurrent ? 'border-2 border-taxi' : 'border border-line'} ${d.status === 'break' ? 'opacity-75' : ''}`}
                  >
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-extrabold ${
                        d.status === 'available'
                          ? 'bg-taxi text-black'
                          : d.status === 'busy'
                            ? 'bg-text text-black'
                            : 'bg-[#5a5a5a]'
                      }`}
                    >
                      {labelMode === 'initials' ? initials(d.name) : (d.vehicleCallsign ?? '?')}
                    </div>
                    <div className="min-w-[140px] flex-1">
                      <div className="flex items-center gap-2 font-bold">
                        {d.name}
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-normal ${d.status === 'available' ? 'bg-taxi font-bold text-black' : 'bg-raised text-soft'}`}
                        >
                          {DRIVER_LABEL[d.status]}
                        </span>
                      </div>
                      <div className="truncate text-[13px] text-muted">
                        {d.vehicleModel ? `${d.vehicleModel} · ${d.vehiclePlate}` : 'bez auta'} ·{' '}
                        {d.dist !== null ? `${fmtKm(d.dist)} km vzdušne` : 'poloha neznáma'}
                      </div>
                    </div>
                    {isCurrent ? (
                      <span className="text-sm font-semibold text-taxi">poslané, čaká…</span>
                    ) : (
                      <button
                        type="button"
                        className={top ? 'btn-primary' : 'btn-outline'}
                        onClick={() => assign(assignRide.id, d.id, d.name)}
                      >
                        {d.status === 'available' ? 'Poslať jazdu' : 'Poslať aj tak'}
                      </button>
                    )}
                  </div>
                );
              })}
            {candidates.every((d) => d.status === 'offline') && (
              <p className="m-0 text-sm text-muted">Žiadny vodič nie je online.</p>
            )}
            <div className="rounded-[10px] bg-ink p-3 text-[13px] leading-snug text-muted">
              Po odoslaní dostane vodič push notifikáciu. Ak jazdu odmietne, vráti sa medzi čakajúce.
            </div>
            <button type="button" className="btn-ghost text-sm" onClick={() => cancel(assignRide)}>
              Zrušiť objednávku
            </button>
          </div>
        </Modal>
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-[2000] -translate-x-1/2 rounded-xl bg-taxi px-5 py-3 font-semibold text-black shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-panel px-4 py-3.5">
      <div className="text-xs uppercase tracking-[1.5px] text-muted">{label}</div>
      <div className={`font-display text-[34px] font-bold ${accent ? 'text-taxi' : ''}`}>{value}</div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

export function StreetBadge() {
  return (
    <span
      title="Vodič zobral zákazníka priamo na ulici"
      className="ml-1.5 rounded-full border border-taxi/60 px-2 py-0.5 text-xs whitespace-nowrap text-taxi"
    >
      z ulice
    </span>
  );
}
