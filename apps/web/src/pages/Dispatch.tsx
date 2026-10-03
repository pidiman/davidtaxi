import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AddressInput } from '../components/AddressInput';
import { FleetMap } from '../components/FleetMap';
import { Header } from '../components/Header';
import {
  api,
  DRIVER_LABEL,
  type Driver,
  type DriverStatus,
  fmtEur,
  fmtKm,
  fmtTime,
  haversineKm,
  type Ride,
  STATUS_LABEL,
  telHref,
} from '../lib/api';
import { useSocket } from '../lib/socket';

const OPEN = ['new', 'assigned', 'accepted', 'arrived', 'in_progress'];
const ACTIVE = ['accepted', 'arrived', 'in_progress'];
const STATUS_ORDER: Record<DriverStatus, number> = { available: 0, busy: 1, break: 2, offline: 3 };

type Config = { priceMin: number; pricePerKm: number };

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
  const [form, setForm] = useState(emptyForm);
  const [cfg, setCfg] = useState<Config>({ priceMin: 3.5, pricePerKm: 1 });
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);

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
    'ride:updated': (r: Ride) =>
      setRides((list) => {
        const rest = list.filter((x) => x.id !== r.id);
        return OPEN.includes(r.status) ? [...rest, r].sort((a, b) => a.id - b.id) : rest;
      }),
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
  });

  // reconnect = načítaj znova, nech nič neušlo
  useEffect(() => {
    if (connected) load().catch(() => {});
  }, [connected, load]);

  const pending = rides.filter((r) => r.status === 'new' || r.status === 'assigned');
  const active = rides.filter((r) => ACTIVE.includes(r.status));
  const selected = rides.find((r) => r.id === selectedId) ?? null;
  const online = drivers.filter((d) => d.status !== 'offline');

  const candidates = useMemo(() => {
    return drivers
      .map((d) => {
        const dist =
          selected?.pickupLat && selected.pickupLng && d.lat && d.lng
            ? haversineKm(d.lat, d.lng, selected.pickupLat, selected.pickupLng)
            : null;
        return { ...d, dist };
      })
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.dist ?? 1e9) - (b.dist ?? 1e9));
  }, [drivers, selected]);

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
      setForm(emptyForm);
    } catch (err) {
      flash((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function assign(rideId: number, driverId: number) {
    try {
      await api(`/api/rides/${rideId}/assign`, { body: { driverId } });
    } catch (err) {
      flash((err as Error).message);
    }
  }

  async function cancel(ride: Ride) {
    if (!confirm(`Zrušiť jazdu pre ${ride.customerName}?`)) return;
    try {
      await api(`/api/rides/${ride.id}/cancel`, { method: 'POST' });
      if (selectedId === ride.id) setSelectedId(null);
    } catch (err) {
      flash((err as Error).message);
    }
  }

  return (
    <div className="min-h-screen bg-ink text-[15px]">
      <Header connected={connected} />

      <section className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3 px-6 pt-4">
        <Kpi label="Čakajúce objednávky" value={pending.length} accent />
        <Kpi label="Aktívne jazdy" value={active.length} />
        <Kpi label="Vodiči online" value={`${online.length} / ${drivers.length}`} />
        <Kpi label="Voľní vodiči" value={drivers.filter((d) => d.status === 'available').length} />
      </section>

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
              value={form.pickupAddress}
              onChange={(v) =>
                setForm((f) => ({ ...f, pickupAddress: v.address, pickupLat: v.lat, pickupLng: v.lng }))
              }
            />
            <AddressInput
              label="B · Cieľ"
              value={form.dropoffAddress}
              onChange={(v) =>
                setForm((f) => ({ ...f, dropoffAddress: v.address, dropoffLat: v.lat, dropoffLng: v.lng }))
              }
            />
            <div className="flex gap-2.5">
              <label className="label flex-[2]">
                Čas (prázdne = hneď)
                <input
                  className="field"
                  type="datetime-local"
                  value={form.scheduledAt}
                  onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
                />
              </label>
              <label className="label flex-1">
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

          <div className="card flex flex-col gap-2.5">
            <h2 className="h2">
              Čakajúce <span className="text-taxi">{pending.length}</span>
            </h2>
            {pending.length === 0 && <p className="m-0 text-sm text-muted">Žiadne čakajúce objednávky.</p>}
            {pending.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedId(r.id)}
                className={`rounded-[10px] p-3 text-left ${
                  r.id === selectedId
                    ? 'border-2 border-taxi bg-taxi-dim'
                    : 'border border-line hover:border-[#444]'
                }`}
              >
                <div className="flex justify-between text-[13px] text-muted">
                  <span>
                    {fmtTime(r.createdAt)} · {r.scheduledAt ? `na ${fmtTime(r.scheduledAt)}` : 'hneď'}
                  </span>
                  <span className={r.status === 'assigned' ? 'font-semibold text-taxi' : ''}>
                    {r.status === 'assigned' ? `čaká na ${r.driverName}` : STATUS_LABEL[r.status]}
                  </span>
                </div>
                <div className="my-1 font-bold">{r.customerName}</div>
                <div className="text-sm text-soft">
                  {r.pickupAddress} → {r.dropoffAddress}
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* ---------- stred: mapa + aktívne jazdy ---------- */}
        <section className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          <div className="overflow-hidden rounded-2xl bg-panel">
            <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-3.5">
              <h2 className="h2">Mapa vozidiel</h2>
              <div className="flex flex-wrap gap-3.5 text-[13px] text-muted">
                <Legend color="#FFC400" label="voľný" />
                <Legend color="#F2F2F2" label="na jazde" />
                <Legend color="#5A5A5A" label="pauza" />
                <span>priehľadné = poloha staršia ako 2 min</span>
              </div>
            </div>
            <FleetMap drivers={drivers} selected={selected} highlightDriverId={hoverDriver} />
          </div>

          <div className="card">
            <h2 className="h2 mb-3">Aktívne jazdy</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted">
                    <th className="px-2.5 py-2 font-semibold">Auto</th>
                    <th className="px-2.5 py-2 font-semibold">Vodič</th>
                    <th className="px-2.5 py-2 font-semibold">Zákazník</th>
                    <th className="px-2.5 py-2 font-semibold">Trasa</th>
                    <th className="px-2.5 py-2 font-semibold">Stav</th>
                    <th className="px-2.5 py-2 text-right font-semibold">Km</th>
                    <th className="px-2.5 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {active.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-2.5 py-4 text-muted">
                        Momentálne nikto nejazdí.
                      </td>
                    </tr>
                  )}
                  {active.map((r) => (
                    <tr key={r.id} className="border-t border-[#2a2a2a]">
                      <td className="px-2.5 py-2.5 font-bold">{r.vehicleCallsign ?? '–'}</td>
                      <td className="px-2.5 py-2.5">{r.driverName}</td>
                      <td className="px-2.5 py-2.5">
                        {r.customerName}
                        <a className="ml-2 text-xs" href={telHref(r.customerPhone)}>
                          {r.customerPhone}
                        </a>
                      </td>
                      <td className="px-2.5 py-2.5 text-soft">
                        {r.pickupAddress} → {r.dropoffAddress}
                      </td>
                      <td className="px-2.5 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${r.status === 'arrived' ? 'bg-[#3a3115] text-taxi-hover' : 'bg-raised'}`}
                        >
                          {STATUS_LABEL[r.status]}
                        </span>
                      </td>
                      <td className="px-2.5 py-2.5 text-right font-bold tabular-nums">
                        {fmtKm(Number(r.distanceKm))}
                      </td>
                      <td className="px-2.5 py-2.5 text-right">
                        <button
                          type="button"
                          className="text-xs text-muted hover:text-text"
                          onClick={() => cancel(r)}
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

        {/* ---------- pravý stĺpec: priradenie vodiča ---------- */}
        <aside className="card flex min-w-0 max-w-[380px] flex-[1_1_300px] flex-col gap-2.5">
          <div>
            <h2 className="h2">Priradiť vodiča</h2>
            <div className="mt-0.5 text-[13px] text-muted">
              {selected
                ? `Pre: ${selected.customerName}${selected.pickupLat ? ' · zoradené podľa vzdialenosti k A' : ''}`
                : 'Vyber objednávku zo zoznamu čakajúcich.'}
            </div>
          </div>

          {selected && (selected.status === 'new' || selected.status === 'assigned') && (
            <>
              {candidates
                .filter((d) => d.status !== 'offline')
                .map((d, i) => {
                  const isCurrent = selected.driverId === d.id;
                  const top = i === 0 && d.status === 'available';
                  return (
                    // biome-ignore lint/a11y/noStaticElementInteractions: hover len zvýrazní trasu na mape
                    <div
                      key={d.id}
                      onMouseEnter={() => setHoverDriver(d.id)}
                      onMouseLeave={() => setHoverDriver(null)}
                      className={`flex flex-col gap-2.5 rounded-xl p-3 ${top || isCurrent ? 'border-2 border-taxi' : 'border border-line'} ${d.status === 'break' ? 'opacity-75' : ''}`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-full font-extrabold ${
                            d.status === 'available'
                              ? 'bg-taxi text-black'
                              : d.status === 'busy'
                                ? 'bg-text text-black'
                                : 'bg-[#5a5a5a]'
                          }`}
                        >
                          {d.vehicleCallsign ?? '?'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-bold">{d.name}</div>
                          <div className="truncate text-[13px] text-muted">
                            {d.vehicleModel ? `${d.vehicleModel} · ${d.vehiclePlate}` : 'bez auta'}
                          </div>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${d.status === 'available' ? 'bg-taxi font-bold text-black' : 'bg-raised text-soft'}`}
                        >
                          {DRIVER_LABEL[d.status]}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2.5">
                        <span className="text-sm text-soft">
                          {d.dist !== null ? `${fmtKm(d.dist)} km vzdušne` : 'poloha neznáma'}
                        </span>
                        {isCurrent ? (
                          <span className="text-sm font-semibold text-taxi">poslané, čaká…</span>
                        ) : (
                          <button
                            type="button"
                            className={top ? 'btn-primary' : 'btn-outline'}
                            onClick={() => assign(selected.id, d.id)}
                          >
                            {d.status === 'available' ? 'Poslať jazdu' : 'Poslať aj tak'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              {candidates.every((d) => d.status === 'offline') && (
                <p className="m-0 text-sm text-muted">Žiadny vodič nie je online.</p>
              )}
              <button type="button" className="btn-ghost mt-1 text-sm" onClick={() => cancel(selected)}>
                Zrušiť objednávku
              </button>
            </>
          )}
          <div className="mt-1 rounded-[10px] bg-ink p-3 text-[13px] leading-snug text-muted">
            Po odoslaní dostane vodič push notifikáciu. Ak jazdu odmietne, vráti sa medzi čakajúce.
          </div>
        </aside>
      </main>

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
