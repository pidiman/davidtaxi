import { useCallback, useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { api, fmtTime, type Incident } from '../lib/api';
import { useSocket } from '../lib/socket';

type Filter = 'open' | 'resolved' | 'all';
type Kind = 'incident' | 'comment';

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('sk-SK', {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function Incidents() {
  const [kind, setKind] = useState<Kind>('incident');
  const [filter, setFilter] = useState<Filter>('open');
  const [list, setList] = useState<Incident[]>([]);
  const [err, setErr] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ kind });
    if (kind === 'incident' && filter !== 'all') p.set('status', filter);
    setList(await api<Incident[]>(`/api/incidents?${p}`));
  }, [filter, kind]);

  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, [load]);

  const upsert = (i: Incident) =>
    setList((l) => {
      const keep =
        i.kind === kind &&
        (kind === 'comment' ||
          filter === 'all' ||
          (filter === 'open' ? !i.resolvedAt : Boolean(i.resolvedAt)));
      const rest = l.filter((x) => x.id !== i.id);
      return keep ? [i, ...rest].sort((a, b) => b.id - a.id) : rest;
    });

  const connected = useSocket({
    'incident:new': (i: Incident) => upsert(i),
    'incident:updated': (i: Incident) => upsert(i),
  });

  async function setResolved(i: Incident, resolved: boolean) {
    try {
      upsert(await api<Incident>(`/api/incidents/${i.id}`, { method: 'PATCH', body: { resolved } }));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const tab = (f: Filter, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={filter === f}
      onClick={() => setFilter(f)}
      className={`rounded-lg px-4 py-2.5 font-semibold ${filter === f ? 'bg-taxi text-black' : 'text-soft hover:bg-raised'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-ink">
      <Header connected={connected} />
      <main className="mx-auto flex max-w-[1100px] flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-3">
            <div role="tablist" className="flex gap-1.5 rounded-xl bg-panel p-1.5">
              {(['incident', 'comment'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={kind === k}
                  onClick={() => setKind(k)}
                  className={`rounded-lg px-4 py-2.5 font-semibold ${kind === k ? 'bg-taxi text-black' : 'text-soft hover:bg-raised'}`}
                >
                  {k === 'incident' ? 'Incidenty' : 'Komentáre'}
                </button>
              ))}
            </div>
            {kind === 'incident' && (
              <div role="tablist" className="flex gap-1.5 rounded-xl bg-panel p-1.5">
                {tab('open', 'Otvorené')}
                {tab('resolved', 'Vyriešené')}
                {tab('all', 'Všetky')}
              </div>
            )}
          </div>
          <span className="text-sm text-muted">
            {kind === 'incident'
              ? 'Incidenty nahlasujú vodiči z mobilnej appky (menu ☰ → Incident).'
              : 'Komentáre píšu vodiči po dokončení jazdy – sú len na informáciu.'}
          </span>
        </div>

        {err && (
          <button
            type="button"
            onClick={() => setErr('')}
            className="rounded-xl bg-red-950/70 px-4 py-3 text-left text-sm text-red-100"
          >
            {err}
          </button>
        )}

        {list.length === 0 && (
          <div className="card text-muted">
            {kind === 'comment'
              ? 'Žiadne komentáre.'
              : filter === 'open'
                ? 'Žiadne otvorené incidenty.'
                : 'Žiadne incidenty.'}
          </div>
        )}

        {list.map((i) => (
          <article
            key={i.id}
            className={`card flex flex-col gap-3 ${i.kind === 'comment' ? '' : i.resolvedAt ? 'opacity-70' : 'border-l-4 border-taxi'}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-[13px] text-muted">
                  #{i.id} · {fmtWhen(i.createdAt)}
                </div>
                <div className="text-lg font-bold">
                  {i.driverName}
                  {i.vehicleCallsign && (
                    <span className="font-normal text-soft">
                      {' '}
                      · auto {i.vehicleCallsign}
                      {i.vehiclePlate ? ` (${i.vehiclePlate})` : ''}
                    </span>
                  )}
                </div>
              </div>
              {i.kind === 'comment' ? (
                <span className="rounded-full border border-line px-2.5 py-1 text-xs text-soft">
                  komentár k jazde
                </span>
              ) : i.resolvedAt ? (
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-raised px-2.5 py-1 text-xs text-soft">
                    vyriešené {fmtWhen(i.resolvedAt)}
                  </span>
                  <button type="button" className="text-sm text-muted" onClick={() => setResolved(i, false)}>
                    Znovu otvoriť
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn-primary py-2 text-sm"
                  onClick={() => setResolved(i, true)}
                >
                  Označiť ako vyriešené
                </button>
              )}
            </div>

            <p className="m-0 whitespace-pre-wrap text-[15px]">{i.description}</p>

            {i.rideId ? (
              <div className="rounded-[10px] bg-ink p-3 text-sm">
                <span className="text-muted">Jazda #{i.rideId}</span>
                {i.rideAt && <span className="text-muted"> · {fmtTime(i.rideAt)}</span>}
                <span className="font-semibold"> · {i.rideCustomer}</span>
                <div className="text-soft">
                  {i.ridePickup} → {i.rideDropoff}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted">Bez väzby na jazdu</div>
            )}

            {i.photos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {i.photos.map((p, n) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPhoto(p)}
                    className="h-28 w-28 overflow-hidden rounded-xl border border-line"
                  >
                    <img
                      src={p}
                      alt={`Fotka ${n + 1}`}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </article>
        ))}
      </main>

      {photo && (
        <button
          type="button"
          aria-label="Zavrieť fotku"
          onClick={() => setPhoto(null)}
          className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/90 p-4"
        >
          <img
            src={photo}
            alt="Fotka incidentu"
            className="max-h-full max-w-full rounded-xl object-contain"
          />
        </button>
      )}
    </div>
  );
}
