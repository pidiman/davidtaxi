import { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import {
  api,
  type Driver,
  fmtEstimate,
  fmtEur,
  fmtKm,
  type Ride,
  STATUS_LABEL,
  type Vehicle,
} from '../lib/api';
import { StreetBadge } from './Dispatch';

type Period = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'lastMonth' | 'custom' | 'all';
const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Dnes' },
  { id: 'yesterday', label: 'Včera' },
  { id: '7d', label: '7 dní' },
  { id: '30d', label: '30 dní' },
  { id: 'month', label: 'Tento mesiac' },
  { id: 'lastMonth', label: 'Minulý mesiac' },
  { id: 'all', label: 'Všetko' },
  { id: 'custom', label: 'Vlastné' },
];

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const toInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromInput = (v: string) => {
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Obdobie → [od, do) v lokálnom čase */
function range(p: Period, customFrom: string, customTo: string): [Date | null, Date | null] {
  const today = dayStart(new Date());
  switch (p) {
    case 'today':
      return [today, addDays(today, 1)];
    case 'yesterday':
      return [addDays(today, -1), today];
    case '7d':
      return [addDays(today, -6), addDays(today, 1)];
    case '30d':
      return [addDays(today, -29), addDays(today, 1)];
    case 'month':
      return [new Date(today.getFullYear(), today.getMonth(), 1), addDays(today, 1)];
    case 'lastMonth':
      return [
        new Date(today.getFullYear(), today.getMonth() - 1, 1),
        new Date(today.getFullYear(), today.getMonth(), 1),
      ];
    case 'custom':
      return [customFrom ? fromInput(customFrom) : null, customTo ? addDays(fromInput(customTo), 1) : null];
    default:
      return [null, null];
  }
}

const DEFAULTS = { period: '7d' as Period, driverId: '', vehicleId: '', status: '', source: '', q: '' };

export function History() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [f, setF] = useState(DEFAULTS);
  const [customFrom, setCustomFrom] = useState(toInput(addDays(new Date(), -6)));
  const [customTo, setCustomTo] = useState(toInput(new Date()));
  const [q, setQ] = useState('');

  useEffect(() => {
    api<Driver[]>('/api/drivers')
      .then(setDrivers)
      .catch(() => {});
    api<Vehicle[]>('/api/vehicles')
      .then(setVehicles)
      .catch(() => {});
  }, []);

  // text sa posiela s oneskorením
  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.q === q.trim() ? x : { ...x, q: q.trim() })), 350);
    return () => clearTimeout(t);
  }, [q]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ scope: 'history' });
    const [from, to] = range(f.period, customFrom, customTo);
    if (from) p.set('from', from.toISOString());
    if (to) p.set('to', to.toISOString());
    for (const k of ['driverId', 'vehicleId', 'status', 'source', 'q'] as const) if (f[k]) p.set(k, f[k]);
    return p.toString();
  }, [f, customFrom, customTo]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<Ride[]>(`/api/rides?${params}`)
      .then((r) => {
        if (!alive) return;
        setRides(r);
        setErr('');
      })
      .catch((e) => alive && setErr(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [params]);

  const done = rides.filter((r) => r.status === 'completed');
  const cancelled = rides.length - done.length;
  const km = done.reduce((s, r) => s + Number(r.distanceKm), 0);
  const sum = done.reduce((s, r) => s + Number(r.price ?? 0), 0);
  const set = (k: keyof typeof DEFAULTS) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const dirty = JSON.stringify(f) !== JSON.stringify(DEFAULTS) || q !== '';

  return (
    <div className="min-h-screen bg-ink">
      <Header />
      <main className="mx-auto flex max-w-[1400px] flex-col gap-4 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="m-0 font-display text-3xl font-bold uppercase">História jázd</h1>
        </div>

        <div className="card flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setF((x) => ({ ...x, period: p.id }))}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${f.period === p.id ? 'bg-taxi text-black' : 'border border-line text-soft hover:border-[#444]'}`}
              >
                {p.label}
              </button>
            ))}
            {f.period === 'custom' && (
              <span className="flex items-center gap-2 text-sm text-muted">
                <input
                  type="date"
                  className="field w-auto py-1.5"
                  aria-label="Od"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
                –
                <input
                  type="date"
                  className="field w-auto py-1.5"
                  aria-label="Do"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
              </span>
            )}
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2.5">
            <label className="label">
              Vodič
              <select className="field" value={f.driverId} onChange={set('driverId')}>
                <option value="">Všetci</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Auto
              <select className="field" value={f.vehicleId} onChange={set('vehicleId')}>
                <option value="">Všetky</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.callsign} · {v.plate}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Stav
              <select className="field" value={f.status} onChange={set('status')}>
                <option value="">Dokončené aj zrušené</option>
                <option value="completed">Dokončené</option>
                <option value="cancelled">Zrušené</option>
              </select>
            </label>
            <label className="label">
              Zdroj
              <select className="field" value={f.source} onChange={set('source')}>
                <option value="">Všetky</option>
                <option value="dispatch">Dispečing</option>
                <option value="street">Z ulice</option>
              </select>
            </label>
            <label className="label">
              Hľadať
              <input
                className="field"
                placeholder="zákazník, telefón, adresa, #ID"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <span>
                <span className="text-muted">Jázd </span>
                <b>{rides.length}</b>
                {rides.length >= 1000 && (
                  <span className="text-taxi"> (zobrazených max 1000 – zúž filter)</span>
                )}
              </span>
              <span>
                <span className="text-muted">Dokončené </span>
                <b>{done.length}</b>
              </span>
              <span>
                <span className="text-muted">Zrušené </span>
                <b>{cancelled}</b>
              </span>
              <span>
                <span className="text-muted">Najazdené </span>
                <b>{fmtKm(km)} km</b>
              </span>
              <span>
                <span className="text-muted">Tržba </span>
                <b className="text-taxi">{fmtEur(sum)}</b>
              </span>
              {loading && <span className="text-muted">načítavam…</span>}
            </div>
            {dirty && (
              <button
                type="button"
                className="btn-ghost px-3 py-1.5 text-sm"
                onClick={() => {
                  setF(DEFAULTS);
                  setQ('');
                }}
              >
                Zrušiť filtre
              </button>
            )}
          </div>
        </div>
        {err && <div className="text-red-300">{err}</div>}
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted">
                <th className="px-2.5 py-2">Dátum</th>
                <th className="px-2.5 py-2">Zákazník</th>
                <th className="px-2.5 py-2">Trasa</th>
                <th className="px-2.5 py-2">Vodič / auto</th>
                <th className="px-2.5 py-2">Stav</th>
                <th className="px-2.5 py-2 text-right" title="Približná cestná vzdialenosť A→B podľa mapy">
                  Vzdialenosť
                </th>
                <th className="px-2.5 py-2 text-right" title="Najazdené km podľa GPS">
                  Najazdené
                </th>
                <th className="px-2.5 py-2 text-right">Cena</th>
              </tr>
            </thead>
            <tbody>
              {rides.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="px-2.5 py-4 text-muted">
                    Žiadne jazdy pre zvolený filter.
                  </td>
                </tr>
              )}
              {rides.map((r) => (
                <tr key={r.id} className="border-t border-[#2a2a2a]">
                  <td className="px-2.5 py-2.5 whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleString('sk-SK')}
                  </td>
                  <td className="px-2.5 py-2.5">
                    {r.customerName}
                    <div className="text-xs text-muted">{r.customerPhone}</div>
                  </td>
                  <td className="px-2.5 py-2.5 text-soft">
                    {r.pickupAddress} → {r.dropoffAddress || 'bez cieľa'}
                  </td>
                  <td className="px-2.5 py-2.5">
                    {r.driverName ?? '–'}{' '}
                    {r.vehicleCallsign && <span className="text-muted">· {r.vehicleCallsign}</span>}
                  </td>
                  <td className="px-2.5 py-2.5">
                    {STATUS_LABEL[r.status]}
                    {r.source === 'street' && <StreetBadge />}
                  </td>
                  <td className="px-2.5 py-2.5 text-right whitespace-nowrap tabular-nums text-soft">
                    {fmtEstimate(r.estimateKm)}
                  </td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{fmtKm(Number(r.distanceKm))}</td>
                  <td className="px-2.5 py-2.5 text-right font-bold tabular-nums">
                    {r.price !== null ? fmtEur(Number(r.price)) : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
