import { type FormEvent, useState } from 'react';
import { ApiError, api, type DriverShiftInfo, fmtInt, type Shift, type ShiftCar } from '../lib/api';
import { TaxiIcon } from './Brand';
import { Modal } from './Modal';

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'dnes';
  if (d.toDateString() === tomorrow.toDateString()) return 'zajtra';
  return d.toLocaleDateString('sk-SK', { weekday: 'short', day: 'numeric', month: 'numeric' });
};

export function CarPhoto({
  url,
  callsign,
  size = 'md',
}: {
  url: string | null;
  callsign: string;
  size?: 'sm' | 'md';
}) {
  const cls = size === 'sm' ? 'h-11 w-16 rounded-lg' : 'aspect-[16/10] w-full rounded-xl';
  return url ? (
    <img src={url} alt={`Auto ${callsign}`} className={`${cls} bg-raised object-cover`} loading="lazy" />
  ) : (
    <div className={`${cls} flex items-center justify-center bg-raised`}>
      <TaxiIcon size={size === 'sm' ? 22 : 40} color="#5a5a5a" />
    </div>
  );
}

/** Začiatok smeny: vodič vyberie auto a zapíše počiatočný stav tachometra. */
export function ShiftStart({ info, onStarted }: { info: DriverShiftInfo; onStarted: () => void }) {
  const suggested = info.vehicles.find((v) => v.scheduled && !v.inUseBy) ?? null;
  const [carId, setCarId] = useState<number | null>(suggested?.id ?? null);
  const [km, setKm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const car = info.vehicles.find((v) => v.id === carId) ?? null;
  const kmNum = Number(km.replace(/\s/g, ''));
  const kmValid = km !== '' && Number.isInteger(kmNum) && kmNum >= 0;
  const tooLow = car?.lastKm != null && kmValid && kmNum < car.lastKm;

  async function start(e: FormEvent, takeover = false) {
    e.preventDefault();
    if (!car || !kmValid) return;
    setBusy(true);
    setError('');
    try {
      await api<Shift>('/api/driver/shift/start', { body: { vehicleId: car.id, startKm: kmNum, takeover } });
      onStarted();
    } catch (err) {
      if (err instanceof ApiError && err.data.code === 'TAKEOVER') {
        if (
          confirm(`${err.message}\n\nJeho smena sa ukončí a jeho konečný stav km bude ${fmtInt(kmNum)} km.`)
        ) {
          setBusy(false);
          return start(e, true);
        }
      } else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => start(e)} className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="m-0 font-display text-3xl font-extrabold uppercase">Začiatok smeny</h1>
        <p className="m-0 text-sm text-muted">Vyber auto, do ktorého si sadáš, a zapíš stav tachometra.</p>
      </div>

      {info.schedule && (
        <div className="rounded-xl border border-taxi/60 bg-taxi-dim px-4 py-3 text-[#f2e3b0]">
          <div className="text-xs font-bold uppercase tracking-[2px] text-taxi">Podľa rozpisu</div>
          <div className="text-lg font-semibold">
            {fmtDay(info.schedule.startsAt)} {fmtTime(info.schedule.startsAt)} –{' '}
            {fmtTime(info.schedule.endsAt)}
            {info.schedule.vehicleCallsign && ` · auto ${info.schedule.vehicleCallsign}`}
          </div>
          {info.schedule.note && <div className="text-sm">{info.schedule.note}</div>}
        </div>
      )}

      <fieldset className="m-0 grid grid-cols-2 gap-3 border-0 p-0">
        <legend className="mb-2 text-xs uppercase tracking-[2px] text-muted">Auto</legend>
        {info.vehicles.length === 0 && (
          <p className="col-span-2 text-muted">Žiadne autá v prevádzke – kontaktuj admina.</p>
        )}
        {info.vehicles.map((v) => (
          <CarOption key={v.id} car={v} selected={v.id === carId} onSelect={() => setCarId(v.id)} />
        ))}
      </fieldset>

      {car && (
        <label className="label text-sm">
          Počiatočný stav km – auto {car.callsign}
          <input
            className="field py-4 text-center font-display text-3xl font-bold tracking-wider tabular-nums"
            inputMode="numeric"
            pattern="[0-9 ]*"
            autoComplete="off"
            placeholder={car.lastKm != null ? fmtInt(car.lastKm) : 'napr. 154 320'}
            value={km}
            onChange={(e) => setKm(e.target.value.replace(/[^\d ]/g, ''))}
            required
          />
          <span className={tooLow ? 'text-red-300' : 'text-muted'}>
            {car.lastKm != null
              ? `Posledný zapísaný stav: ${fmtInt(car.lastKm)} km${tooLow ? ' – zadaný stav je nižší' : ''}`
              : 'Prvá smena tohto auta v systéme'}
          </span>
        </label>
      )}

      {error && <div className="rounded-xl bg-red-950/70 p-3 text-sm text-red-100">{error}</div>}

      <button
        type="submit"
        disabled={!car || !kmValid || tooLow || busy}
        className="btn-primary mt-auto h-16 rounded-2xl text-xl font-extrabold uppercase"
      >
        {busy ? 'Začínam…' : 'Začať smenu'}
      </button>
    </form>
  );
}

function CarOption({ car, selected, onSelect }: { car: ShiftCar; selected: boolean; onSelect: () => void }) {
  return (
    <label
      className={`flex cursor-pointer flex-col gap-2 rounded-2xl bg-panel p-2.5 ${selected ? 'ring-3 ring-taxi' : 'ring-1 ring-line'}`}
    >
      <input type="radio" name="car" className="sr-only" checked={selected} onChange={onSelect} />
      <div className="relative">
        <CarPhoto url={car.photoUrl} callsign={car.callsign} />
        <span className="absolute top-1.5 left-1.5 flex h-9 w-9 items-center justify-center rounded-full border-2 border-black bg-taxi font-extrabold text-black">
          {car.callsign}
        </span>
      </div>
      <div className="px-0.5">
        <div className="font-bold leading-tight">{car.model}</div>
        <div className="text-xs text-muted">
          {car.plate}
          {car.color && ` · ${car.color}`} · {car.seats} miest
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {car.scheduled && (
            <span className="rounded-full bg-taxi px-2 py-0.5 text-[11px] font-bold text-black">
              podľa rozpisu
            </span>
          )}
          {car.inUseBy && (
            <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] text-soft">
              jazdí: {car.inUseBy}
            </span>
          )}
        </div>
      </div>
    </label>
  );
}

/** Karta auta v smene: fotka, ŠPZ, počiatočný stav km a km odjazdené na jazdách v tejto smene. */
export function ShiftBar({ shift, liveKm = 0 }: { shift: Shift; liveKm?: number }) {
  const rideKm = (shift.stats?.km ?? 0) + liveKm;
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-panel p-2.5">
      <CarPhoto url={shift.vehiclePhotoUrl} callsign={shift.vehicleCallsign} size="sm" />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="font-display text-xl font-bold tracking-wider">{shift.vehiclePlate}</div>
        <div className="mt-0.5 text-[13px] text-muted">
          Štart <span className="text-soft tabular-nums">{fmtInt(shift.startKm)} km</span>
        </div>
        <div className="text-[13px] text-muted">
          Na jazdách{' '}
          <span className="font-semibold text-taxi tabular-nums">
            {rideKm.toLocaleString('sk-SK', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km
          </span>
        </div>
      </div>
    </div>
  );
}

export function EndShiftDialog({
  shift,
  onClose,
  onEnded,
}: {
  shift: Shift;
  onClose: () => void;
  onEnded: () => void;
}) {
  const [km, setKm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const kmNum = Number(km.replace(/\s/g, ''));
  const valid = km !== '' && Number.isInteger(kmNum) && kmNum >= shift.startKm;
  // odhad tachometra: počiatočný stav + km odjazdené na jazdách v tejto smene
  const estimateKm = Math.round(shift.startKm + (shift.stats?.km ?? 0));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/driver/shift/end', { body: { endKm: kmNum } });
      onEnded();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Ukončenie smeny" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="m-0 text-soft">
          Auto <b>{shift.vehicleCallsign}</b> ({shift.vehiclePlate}) · počiatočný stav{' '}
          <b>{fmtInt(shift.startKm)} km</b>
        </p>
        <label className="label text-sm">
          Konečný stav km (tachometer)
          <input
            className="field py-4 text-center font-display text-3xl font-bold tracking-wider tabular-nums"
            inputMode="numeric"
            pattern="[0-9 ]*"
            autoComplete="off"
            placeholder={`≈ ${fmtInt(estimateKm)}`}
            value={km}
            onChange={(e) => setKm(e.target.value.replace(/[^\d ]/g, ''))}
            required
          />
          {km !== '' && Number.isInteger(kmNum) && (
            <span className={kmNum < shift.startKm ? 'text-red-300' : 'text-muted'}>
              {kmNum < shift.startKm
                ? 'Konečný stav nemôže byť nižší ako počiatočný'
                : `Za smenu najazdené: ${fmtInt(kmNum - shift.startKm)} km`}
            </span>
          )}
        </label>
        {error && <div className="rounded-xl bg-red-950/70 p-3 text-sm text-red-100">{error}</div>}
        <div className="flex gap-2.5">
          <button type="button" className="btn-ghost h-14 flex-1 rounded-2xl" onClick={onClose}>
            Späť
          </button>
          <button
            type="submit"
            disabled={!valid || busy}
            className="btn-primary h-14 flex-[2] rounded-2xl text-lg font-extrabold uppercase"
          >
            Ukončiť smenu
          </button>
        </div>
      </form>
    </Modal>
  );
}
