import { useEffect, useState } from 'react';
import { api, fmtEur, fmtKm, fmtTime, type RideStatus, type ShiftRideStats, STATUS_LABEL } from '../lib/api';
import { type Destination, DestinationChooser } from './DestinationChooser';

type MyShift = {
  id: number;
  startedAt: string;
  endedAt: string | null;
  vehicleCallsign: string;
  vehiclePlate: string;
  startKm: number;
  endKm: number | null;
};
type MyRide = {
  id: number;
  status: RideStatus;
  source: 'dispatch' | 'street';
  customerName: string;
  customerPhone: string | null;
  pickupAddress: string;
  dropoffAddress: string;
  passengers: number;
  note: string | null;
  assignedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  distanceKm: string;
  estimateKm: string | null;
  price: string | null;
};
type MyRidesResp = { shift: MyShift | null; rides: MyRide[]; stats: ShiftRideStats | null };

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'dnes';
  if (d.toDateString() === yesterday.toDateString()) return 'včera';
  return d.toLocaleDateString('sk-SK', { weekday: 'short', day: 'numeric', month: 'numeric' });
};
const shiftLabel = (s: MyShift) =>
  `${s.endedAt ? '' : '● '}${fmtDate(s.startedAt)} ${fmtTime(s.startedAt)}–${s.endedAt ? fmtTime(s.endedAt) : 'teraz'} · auto ${s.vehicleCallsign}`;

/** Celoobrazovkový prehľad jázd vodiča – aktuálna smena, s výberom starších smien. */
export function MyRides({ onClose, pos }: { onClose: () => void; pos: { lat: number; lng: number } | null }) {
  const [shifts, setShifts] = useState<MyShift[]>([]);
  const [shiftId, setShiftId] = useState<number | null>(null);
  const [data, setData] = useState<MyRidesResp | null>(null);
  const [err, setErr] = useState('');
  const [fillFor, setFillFor] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  async function saveDestination(id: number, d: Destination) {
    setSaving(true);
    try {
      await api(`/api/driver/rides/${id}/destination`, { body: d });
      setFillFor(null);
      setReload((n) => n + 1);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    api<MyShift[]>('/api/driver/my-shifts')
      .then(setShifts)
      .catch((e) => setErr(e.message));
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload = znova načítať po doplnení cieľa
  useEffect(() => {
    setData(null);
    api<MyRidesResp>(`/api/driver/my-rides${shiftId ? `?shiftId=${shiftId}` : ''}`)
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [shiftId, reload]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const current = data?.shift ?? null;
  const st = data?.stats;

  return (
    <div className="fixed inset-0 z-[3000] overflow-y-auto bg-ink">
      <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col gap-4 px-4 pt-[max(16px,env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between">
          <h1 className="m-0 font-display text-3xl font-bold uppercase tracking-wide">Moje jazdy</h1>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zavrieť"
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-panel text-2xl text-muted"
          >
            ×
          </button>
        </div>

        <label className="label text-sm">
          Smena
          <select
            className="field text-base"
            value={shiftId ?? current?.id ?? ''}
            onChange={(e) => setShiftId(Number(e.target.value) || null)}
            disabled={!shifts.length}
          >
            {!shifts.length && <option value="">žiadne smeny</option>}
            {shifts.map((s) => (
              <option key={s.id} value={s.id}>
                {shiftLabel(s)}
              </option>
            ))}
          </select>
        </label>

        {err && <div className="rounded-xl bg-red-950/70 p-3 text-sm text-red-100">{err}</div>}

        {st && (
          <div className="grid grid-cols-3 gap-2">
            <Tile
              label="Jazdy"
              value={String(st.rides)}
              sub={st.cancelled ? `+${st.cancelled} zrušené` : undefined}
            />
            <Tile label="Na jazdách" value={`${fmtKm(st.km)} km`} />
            <Tile label="Tržba" value={fmtEur(st.revenue)} accent />
          </div>
        )}
        {current && (
          <div className="text-[13px] text-muted">
            Auto {current.vehicleCallsign} · {current.vehiclePlate} · tachometer{' '}
            {current.startKm.toLocaleString('sk-SK')}
            {current.endKm !== null
              ? ` → ${current.endKm.toLocaleString('sk-SK')} km (${(current.endKm - current.startKm).toLocaleString('sk-SK')} km)`
              : ' km'}
          </div>
        )}

        {!data && !err && <div className="text-muted">Načítavam…</div>}
        {data && data.rides.length === 0 && (
          <div className="rounded-2xl bg-panel p-4 text-center text-muted">
            V tejto smene nemáš žiadne jazdy.
          </div>
        )}

        <div className="flex flex-col gap-2">
          {data?.rides.map((r) => (
            <div
              key={r.id}
              className={`rounded-2xl bg-panel p-3.5 ${r.status === 'cancelled' ? 'opacity-55' : ''}`}
            >
              <div className="flex justify-between gap-2 text-[13px] text-muted">
                <span>
                  {fmtTime(r.startedAt ?? r.assignedAt)}
                  {r.finishedAt ? `–${fmtTime(r.finishedAt)}` : ''} · #{r.id}
                  {r.source === 'street' && <span className="text-taxi"> · z ulice</span>}
                </span>
                <span className={r.status === 'completed' ? '' : 'text-soft'}>{STATUS_LABEL[r.status]}</span>
              </div>
              <div className="mt-1 font-bold">{r.customerName}</div>
              <div className="text-sm text-soft">
                {r.pickupAddress} → {r.dropoffAddress || 'bez cieľa'}
              </div>
              {r.status === 'completed' && !r.dropoffAddress && (
                <button
                  type="button"
                  className="btn-primary mt-2 w-full py-2 text-sm"
                  onClick={() => setFillFor(r.id)}
                >
                  Doplniť cieľ
                </button>
              )}
              {r.status === 'completed' && (
                <div className="mt-1.5 flex justify-between text-sm">
                  <span className="text-muted">{fmtKm(Number(r.distanceKm))} km</span>
                  <span className="font-bold text-taxi">
                    {r.price !== null ? fmtEur(Number(r.price)) : '–'}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {fillFor !== null && (
        <DestinationChooser
          mode="fill"
          pos={pos}
          busy={saving}
          onConfirm={(d) => saveDestination(fillFor, d)}
          onClose={() => setFillFor(null)}
        />
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-panel p-3">
      <div className="text-[11px] uppercase tracking-[1.5px] text-muted">{label}</div>
      <div className={`font-display text-2xl font-bold tabular-nums ${accent ? 'text-taxi' : ''}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
