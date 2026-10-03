import { useEffect, useId, useState } from 'react';
import { startAlarm, stopAlarm } from '../lib/alarm';
import { haversineKm, type Ride } from '../lib/api';

/**
 * Celoobrazovkové okno novej jazdy. Pulzuje (1× za sekundu – pod hranicou 3 Hz, bezpečné
 * pre fotosenzitívnych ľudí) a zvoní, kým vodič jazdu neprijme alebo neodmietne.
 */
export function IncomingRideAlert({
  ride,
  waiting,
  pos,
  busy,
  onAccept,
  onReject,
}: {
  ride: Ride;
  waiting: number; // koľko ďalších nových jázd čaká
  pos: { lat: number; lng: number } | null;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const titleId = useId();

  useEffect(() => {
    startAlarm();
    return () => stopAlarm();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const since = ride.assignedAt
    ? Math.max(0, Math.floor((now - new Date(ride.assignedAt).getTime()) / 1000))
    : 0;
  const distKm =
    pos && ride.pickupLat !== null && ride.pickupLng !== null
      ? haversineKm(pos.lat, pos.lng, ride.pickupLat, ride.pickupLng)
      : null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="incoming-alert fixed inset-0 z-[4000] flex flex-col p-3 pt-[max(12px,env(safe-area-inset-top))] pb-[max(12px,env(safe-area-inset-bottom))]"
    >
      <div className="flex flex-1 flex-col gap-4 rounded-[28px] bg-ink p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <div id={titleId} className="incoming-label font-display text-[42px] font-extrabold leading-none">
            NOVÁ JAZDA
          </div>
          <div className="text-right">
            <div className="font-display text-2xl font-bold tabular-nums">
              {Math.floor(since / 60)}:{String(since % 60).padStart(2, '0')}
            </div>
            <div className="text-xs text-muted">čaká</div>
          </div>
        </div>
        {waiting > 0 && (
          <div className="rounded-xl bg-taxi-dim px-3 py-2 text-sm font-semibold text-taxi">
            + ďalšie nové jazdy: {waiting}
          </div>
        )}

        <div className="flex gap-3.5">
          <div className="flex flex-col items-center pt-1.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-taxi text-sm font-extrabold text-black">
              A
            </div>
            <div className="my-1 w-0.5 flex-1 bg-[#3a3a3a]" />
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-text text-sm font-extrabold text-black">
              B
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-5">
            <div>
              <div className="text-2xl font-bold leading-tight">{ride.pickupAddress}</div>
              {distKm !== null && (
                <div className="mt-0.5 text-base text-taxi">
                  {distKm.toLocaleString('sk-SK', { maximumFractionDigits: 1 })} km od teba
                </div>
              )}
            </div>
            <div className="text-2xl font-bold leading-tight">{ride.dropoffAddress}</div>
          </div>
        </div>

        <div className="rounded-2xl bg-panel p-4 text-lg">
          <div className="font-bold">{ride.customerName}</div>
          <div className="text-soft">
            {ride.passengers} {ride.passengers === 1 ? 'osoba' : ride.passengers < 5 ? 'osoby' : 'osôb'}
            {ride.scheduledAt &&
              ` · na ${new Date(ride.scheduledAt).toLocaleString('sk-SK', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' })}`}
          </div>
          {ride.note && <div className="mt-2 text-base text-[#f2e3b0]">{ride.note}</div>}
        </div>

        <div className="mt-auto flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onReject}
            className="btn-ghost h-[76px] flex-1 rounded-2xl text-lg font-bold"
          >
            Odmietnuť
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onAccept}
            className="btn-primary h-[76px] flex-[2] rounded-2xl text-2xl font-extrabold uppercase"
          >
            Prijať
          </button>
        </div>
      </div>
    </div>
  );
}
