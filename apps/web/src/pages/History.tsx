import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { api, fmtEur, fmtKm, type Ride, STATUS_LABEL } from '../lib/api';
import { StreetBadge } from './Dispatch';

export function History() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    api<Ride[]>('/api/rides?scope=history')
      .then(setRides)
      .catch((e) => setErr(e.message));
  }, []);

  const done = rides.filter((r) => r.status === 'completed');
  const km = done.reduce((s, r) => s + Number(r.distanceKm), 0);
  const sum = done.reduce((s, r) => s + Number(r.price ?? 0), 0);

  return (
    <div className="min-h-screen bg-ink">
      <Header />
      <main className="mx-auto flex max-w-[1400px] flex-col gap-4 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="m-0 font-display text-3xl font-bold uppercase">História jázd</h1>
          <div className="text-sm text-muted">
            posledných {rides.length} · dokončené {done.length} · {fmtKm(km)} km · {fmtEur(sum)}
          </div>
        </div>
        {err && <div className="text-red-300">{err}</div>}
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted">
                <th className="px-2.5 py-2">Dátum</th>
                <th className="px-2.5 py-2">Zákazník</th>
                <th className="px-2.5 py-2">Trasa</th>
                <th className="px-2.5 py-2">Vodič / auto</th>
                <th className="px-2.5 py-2">Stav</th>
                <th className="px-2.5 py-2 text-right">Km</th>
                <th className="px-2.5 py-2 text-right">Cena</th>
              </tr>
            </thead>
            <tbody>
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
                    {r.pickupAddress} → {r.dropoffAddress}
                  </td>
                  <td className="px-2.5 py-2.5">
                    {r.driverName ?? '–'}{' '}
                    {r.vehicleCallsign && <span className="text-muted">· {r.vehicleCallsign}</span>}
                  </td>
                  <td className="px-2.5 py-2.5">
                    {STATUS_LABEL[r.status]}
                    {r.source === 'street' && <StreetBadge />}
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
