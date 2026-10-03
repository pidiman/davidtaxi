import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { Modal } from '../components/Modal';
import {
  api,
  type Driver,
  fmtEur,
  fmtInt,
  fmtKm,
  type Schedule as ScheduleT,
  type Shift,
  type Vehicle,
} from '../lib/api';
import { useSocket } from '../lib/socket';

const DAY = 86_400_000;
const DAYS = ['Po', 'Ut', 'St', 'Št', 'Pi', 'So', 'Ne'];

function startOfWeek(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = (x.getDay() + 6) % 7; // pondelok = 0
  x.setDate(x.getDate() - wd);
  return x;
}
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const hm = (iso: string) => new Date(iso).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' });
const dm = (d: Date) => d.toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric' });
const dt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('sk-SK', {
        day: 'numeric',
        month: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
const pad = (n: number) => String(n).padStart(2, '0');
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

type Draft = Partial<ScheduleT> & { day?: Date };

export function Schedule() {
  const [week, setWeek] = useState(() => startOfWeek(new Date()));
  const [items, setItems] = useState<ScheduleT[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editShift, setEditShift] = useState<Shift | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));

  const weekTs = week.getTime();
  const load = useCallback(async () => {
    const q = `from=${new Date(weekTs).toISOString()}&to=${new Date(weekTs + 7 * DAY + 3600_000).toISOString()}`;
    const [s, sh] = await Promise.all([
      api<ScheduleT[]>(`/api/schedules?${q}`),
      api<Shift[]>(`/api/shifts?${q}`),
    ]);
    setItems(s);
    setShifts(sh);
  }, [weekTs]);

  useEffect(() => {
    load().catch((e) => setMsg({ text: e.message, error: true }));
  }, [load]);

  useEffect(() => {
    Promise.all([api<Driver[]>('/api/drivers'), api<Vehicle[]>('/api/vehicles')])
      .then(([d, v]) => {
        setDrivers(d);
        setVehicles(v.filter((x) => x.active));
      })
      .catch((e) => setMsg({ text: e.message, error: true }));
  }, []);

  useSocket({ 'shift:updated': () => load().catch(() => {}) });

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      setMsg({ text: ok });
      await load();
      return true;
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
      return false;
    }
  }

  const byDay = days.map((d) => items.filter((it) => sameDay(new Date(it.startsAt), d)));
  const today = new Date();
  const openShifts = shifts.filter((s) => !s.endedAt);
  const missingKm = shifts.filter((s) => s.endedAt && s.endKm === null);

  return (
    <div className="min-h-screen bg-ink">
      <Header />
      <main className="mx-auto flex max-w-[1500px] flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="m-0 mr-3 font-display text-3xl font-bold uppercase">Rozpis</h1>
            <button
              type="button"
              className="btn-ghost px-3"
              aria-label="Predchádzajúci týždeň"
              onClick={() => setWeek(addDays(week, -7))}
            >
              ‹
            </button>
            <span className="min-w-36 text-center font-semibold">
              {dm(week)} – {dm(addDays(week, 6))} {addDays(week, 6).getFullYear()}
            </span>
            <button
              type="button"
              className="btn-ghost px-3"
              aria-label="Ďalší týždeň"
              onClick={() => setWeek(addDays(week, 7))}
            >
              ›
            </button>
            <button
              type="button"
              className="btn-ghost px-3 text-sm"
              onClick={() => setWeek(startOfWeek(new Date()))}
            >
              Tento týždeň
            </button>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setDraft({ day: sameDay(week, startOfWeek(today)) ? today : week })}
          >
            + Pridať smenu
          </button>
        </div>

        {msg && (
          <button
            type="button"
            onClick={() => setMsg(null)}
            className={`rounded-xl px-4 py-3 text-left text-sm ${msg.error ? 'bg-red-950/70 text-red-100' : 'bg-taxi-dim text-[#f2e3b0]'}`}
          >
            {msg.text}
          </button>
        )}

        {/* ---------- týždenný rozpis ---------- */}
        <section className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {days.map((d, i) => {
            const isToday = sameDay(d, today);
            return (
              <div
                key={d.toISOString()}
                className={`flex min-h-40 flex-col gap-2 rounded-2xl bg-panel p-3 ${isToday ? 'ring-2 ring-taxi' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className={`font-display text-lg font-bold ${isToday ? 'text-taxi' : ''}`}>
                      {DAYS[i]}
                    </span>{' '}
                    <span className="text-sm text-muted">{dm(d)}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Pridať smenu ${DAYS[i]} ${dm(d)}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-xl text-muted hover:bg-raised hover:text-taxi"
                    onClick={() => setDraft({ day: d })}
                  >
                    +
                  </button>
                </div>
                {byDay[i].length === 0 && <div className="text-xs text-muted">—</div>}
                {byDay[i].map((it) => {
                  const overnight = !sameDay(new Date(it.startsAt), new Date(it.endsAt));
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => setDraft(it)}
                      className="flex flex-col gap-0.5 rounded-xl border border-line bg-ink p-2.5 text-left hover:border-taxi/60"
                    >
                      <div className="text-sm font-bold tabular-nums">
                        {hm(it.startsAt)} – {hm(it.endsAt)}
                        {overnight && <span className="font-normal text-muted"> (+1)</span>}
                      </div>
                      <div className="font-semibold leading-tight">{it.driverName}</div>
                      <div className="text-xs">
                        {it.vehicleCallsign ? (
                          <span className="rounded-full bg-taxi px-1.5 py-px font-bold text-black">
                            {it.vehicleCallsign}
                          </span>
                        ) : (
                          <span className="text-muted">auto neurčené</span>
                        )}
                      </div>
                      {it.note && <div className="text-xs text-muted">{it.note}</div>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </section>

        {/* ---------- kniha smien ---------- */}
        <section className="card flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="h2">Odjazdené smeny</h2>
            <div className="text-sm text-muted">
              teraz v smene {openShifts.length}
              {missingKm.length > 0 && (
                <span className="text-taxi"> · chýba konečný stav km: {missingKm.length}</span>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted">
                  <th className="px-2.5 py-2">Vodič</th>
                  <th className="px-2.5 py-2">Auto</th>
                  <th className="px-2.5 py-2">Začiatok</th>
                  <th className="px-2.5 py-2">Koniec</th>
                  <th className="px-2.5 py-2 text-right">Počiatočný km</th>
                  <th className="px-2.5 py-2 text-right">Konečný km</th>
                  <th className="px-2.5 py-2 text-right">Najazdené</th>
                  <th className="px-2.5 py-2 text-right" title="Súčet km jázd zo GPS">
                    Jazdy (GPS km)
                  </th>
                  <th className="px-2.5 py-2 text-right">Tržba</th>
                  <th className="px-2.5 py-2" />
                </tr>
              </thead>
              <tbody>
                {shifts.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-2.5 py-4 text-muted">
                      V tomto týždni žiadne smeny.
                    </td>
                  </tr>
                )}
                {shifts.map((s) => (
                  <tr key={s.id} className="border-t border-[#2a2a2a]">
                    <td className="px-2.5 py-2.5 font-semibold">{s.driverName}</td>
                    <td className="px-2.5 py-2.5">
                      <b>{s.vehicleCallsign}</b> <span className="text-muted">· {s.vehiclePlate}</span>
                    </td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap">{dt(s.startedAt)}</td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap">
                      {s.endedAt ? dt(s.endedAt) : <span className="font-semibold text-taxi">prebieha</span>}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums">{fmtInt(s.startKm)}</td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums">
                      {s.endKm !== null ? (
                        fmtInt(s.endKm)
                      ) : s.endedAt ? (
                        <span className="text-taxi">chýba</span>
                      ) : (
                        '–'
                      )}
                      {s.endKmSource === 'next_driver' && (
                        <div
                          className="text-[11px] text-taxi"
                          title="Vodič nezadal konečný stav – doplnilo sa z počiatočného stavu ďalšieho vodiča"
                        >
                          doplnil ďalší vodič
                        </div>
                      )}
                      {s.endKmSource === 'admin' && <div className="text-[11px] text-muted">opravené</div>}
                    </td>
                    <td className="px-2.5 py-2.5 text-right font-bold tabular-nums">
                      {s.endKm !== null ? `${fmtInt(s.endKm - s.startKm)} km` : '–'}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums">
                      {s.rideCount ?? 0} <span className="text-muted">({fmtKm(s.gpsKm ?? 0)} km)</span>
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums">{fmtEur(s.revenue ?? 0)}</td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap text-right">
                      <button
                        type="button"
                        className="mr-3 text-sm text-taxi"
                        onClick={() => setEditShift(s)}
                      >
                        Upraviť km
                      </button>
                      {!s.endedAt && (
                        <button
                          type="button"
                          className="text-sm text-muted hover:text-text"
                          onClick={() =>
                            confirm(
                              `Ukončiť smenu vodiča ${s.driverName}? Konečný stav km doplní ďalší vodič, ktorý si vezme auto ${s.vehicleCallsign}.`,
                            ) && run(() => api(`/api/shifts/${s.id}/end`, { body: {} }), 'Smena ukončená')
                          }
                        >
                          Ukončiť
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {draft && (
        <ScheduleForm
          draft={draft}
          drivers={drivers}
          vehicles={vehicles}
          onClose={() => setDraft(null)}
          onSave={async (body) => {
            const ok = await run(
              () =>
                draft.id
                  ? api(`/api/schedules/${draft.id}`, { method: 'PATCH', body })
                  : api('/api/schedules', { body }),
              draft.id ? 'Rozpis upravený' : 'Smena pridaná do rozpisu',
            );
            if (ok) setDraft(null);
          }}
          onDelete={
            draft.id
              ? async () => {
                  if (!confirm('Odstrániť túto smenu z rozpisu?')) return;
                  const ok = await run(
                    () => api(`/api/schedules/${draft.id}`, { method: 'DELETE' }),
                    'Odstránené',
                  );
                  if (ok) setDraft(null);
                }
              : undefined
          }
        />
      )}
      {editShift && (
        <ShiftKmForm
          shift={editShift}
          onClose={() => setEditShift(null)}
          onSave={async (body) => {
            const ok = await run(
              () => api(`/api/shifts/${editShift.id}`, { method: 'PATCH', body }),
              'Smena upravená',
            );
            if (ok) setEditShift(null);
          }}
        />
      )}
    </div>
  );
}

function ScheduleForm({
  draft,
  drivers,
  vehicles,
  onClose,
  onSave,
  onDelete,
}: {
  draft: Draft;
  drivers: Driver[];
  vehicles: Vehicle[];
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onDelete?: () => void;
}) {
  const start = draft.startsAt
    ? new Date(draft.startsAt)
    : new Date((draft.day ?? new Date()).setHours(6, 0, 0, 0));
  const end = draft.endsAt ? new Date(draft.endsAt) : new Date(start.getTime() + 12 * 3600_000);
  const [f, setF] = useState({
    driverId: draft.driverId ? String(draft.driverId) : '',
    vehicleId: draft.vehicleId ? String(draft.vehicleId) : '',
    date: toDateInput(start),
    from: toTimeInput(start),
    to: toTimeInput(end),
    note: draft.note ?? '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const overnight = f.to <= f.from;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const s = new Date(`${f.date}T${f.from}`);
    let en = new Date(`${f.date}T${f.to}`);
    if (en <= s) en = new Date(en.getTime() + DAY);
    await onSave({
      driverId: Number(f.driverId),
      vehicleId: f.vehicleId ? Number(f.vehicleId) : null,
      startsAt: s.toISOString(),
      endsAt: en.toISOString(),
      note: f.note || null,
    });
    setSaving(false);
  }

  return (
    <Modal title={draft.id ? 'Upraviť smenu v rozpise' : 'Nová smena v rozpise'} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="label">
          Vodič
          <select className="field" required value={f.driverId} onChange={set('driverId')}>
            <option value="">— vyber vodiča —</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          Auto (vodič ho aj tak potvrdí pri začatí smeny)
          <select className="field" value={f.vehicleId} onChange={set('vehicleId')}>
            <option value="">— neurčené —</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.callsign} · {v.model} · {v.plate}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="label">
            Dátum
            <input className="field" type="date" required value={f.date} onChange={set('date')} />
          </label>
          <label className="label">
            Od
            <input className="field" type="time" required value={f.from} onChange={set('from')} />
          </label>
          <label className="label">
            Do {overnight && <span className="text-taxi">(nasledujúci deň)</span>}
            <input className="field" type="time" required value={f.to} onChange={set('to')} />
          </label>
        </div>
        <label className="label">
          Poznámka
          <input className="field" value={f.note} onChange={set('note')} placeholder="napr. letisko o 5:00" />
        </label>
        <div className="flex items-center gap-2 pt-2">
          {onDelete && (
            <button
              type="button"
              className="mr-auto text-sm text-red-300 hover:text-red-200"
              onClick={onDelete}
            >
              Odstrániť
            </button>
          )}
          <button type="button" className="btn-ghost ml-auto" onClick={onClose}>
            Zrušiť
          </button>
          <button type="submit" className="btn-primary px-6" disabled={saving}>
            Uložiť
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ShiftKmForm({
  shift,
  onClose,
  onSave,
}: {
  shift: Shift;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [startKm, setStartKm] = useState(String(shift.startKm));
  const [endKm, setEndKm] = useState(shift.endKm !== null ? String(shift.endKm) : '');
  const [note, setNote] = useState(shift.note ?? '');
  return (
    <Modal title={`Smena: ${shift.driverName} · auto ${shift.vehicleCallsign}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            startKm: Number(startKm),
            endKm: endKm === '' ? null : Number(endKm),
            note: note || null,
          });
        }}
        className="flex flex-col gap-3"
      >
        <p className="m-0 text-sm text-muted">
          {dt(shift.startedAt)} – {shift.endedAt ? dt(shift.endedAt) : 'prebieha'}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="label">
            Počiatočný stav km
            <input
              className="field tabular-nums"
              inputMode="numeric"
              required
              value={startKm}
              onChange={(e) => setStartKm(e.target.value.replace(/\D/g, ''))}
            />
          </label>
          <label className="label">
            Konečný stav km
            <input
              className="field tabular-nums"
              inputMode="numeric"
              value={endKm}
              onChange={(e) => setEndKm(e.target.value.replace(/\D/g, ''))}
            />
          </label>
        </div>
        <label className="label">
          Poznámka
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Zrušiť
          </button>
          <button type="submit" className="btn-primary px-6">
            Uložiť
          </button>
        </div>
      </form>
    </Modal>
  );
}
