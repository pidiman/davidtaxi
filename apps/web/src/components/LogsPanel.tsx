import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { api, ROLE_LABEL, type Role } from '../lib/api';

type LogRow = {
  id: number;
  at: string;
  level: 'info' | 'warn' | 'error';
  evt: string;
  msg: string;
  userId: number | null;
  userName: string | null;
  userRole: Role | null;
  fields: Record<string, unknown> | null;
};
type LogPage = { rows: LogRow[]; hasMore: boolean; problems24h: number };

const CATS = [
  { id: '', label: 'Všetko' },
  { id: 'rides', label: 'Jazdy' },
  { id: 'incidents', label: 'Incidenty' },
  { id: 'shifts', label: 'Smeny a rozpis' },
  { id: 'access', label: 'Prihlásenia a spojenie' },
  { id: 'admin', label: 'Zmeny v admine' },
  { id: 'system', label: 'Systém a chyby' },
] as const;

const PERIODS = [
  { days: 1, label: '24 h' },
  { days: 7, label: '7 dní' },
  { days: 30, label: '30 dní' },
  { days: 0, label: 'všetko' },
];

/** Čitateľný názov udalosti (evt) */
const EVT_LABEL: Record<string, string> = {
  'ride.created': 'Nová objednávka',
  'ride.assigned': 'Poslaná vodičovi',
  'ride.accepted': 'Prijatá',
  'ride.rejected': 'Odmietnutá',
  'ride.arrived': 'Na mieste A',
  'ride.started': 'Jazda začala',
  'ride.completed': 'Dokončená',
  'ride.cancelled': 'Zrušená',
  'ride.street': 'Z ulice',
  'ride.returned': 'Vrátená',
  'ride.reminder': 'Pripomienka',
  'incident.reported': 'Nahlásený incident',
  'incident.resolved': 'Incident vyriešený',
  'incident.reopened': 'Incident znovu otvorený',
  'shift.started': 'Začiatok smeny',
  'shift.ended': 'Koniec smeny',
  'shift.takeover': 'Prevzatie auta',
  'shift.km_backfill': 'Doplnené km',
  'shift.edited': 'Úprava smeny',
  'shift.ended_by_dispatch': 'Smenu ukončil dispečing',
  'schedule.created': 'Rozpis – nový',
  'schedule.updated': 'Rozpis – zmena',
  'schedule.deleted': 'Rozpis – zmazaný',
  'auth.login': 'Prihlásenie',
  'auth.failed': 'Zlé prihlásenie',
  'auth.blocked': 'Blokované prihlásenie',
  'socket.connected': 'Pripojený',
  'socket.disconnected': 'Odpojený',
  'driver.status': 'Stav vodiča',
  'user.created': 'Nový používateľ',
  'user.updated': 'Úprava používateľa',
  'user.deleted': 'Zmazaný používateľ',
  'vehicle.created': 'Nové auto',
  'vehicle.updated': 'Úprava auta',
  'vehicle.deleted': 'Zmazané auto',
  'vehicle.photo': 'Fotka auta',
  'vehicle.photo_deleted': 'Fotka zmazaná',
  'http.rejected': 'Zamietnutá akcia',
  'http.error': 'Chyba servera',
  'push.no_subscription': 'Push neodišiel',
  'push.expired': 'Push vypršal',
  'push.failed': 'Push zlyhal',
  'push.disabled': 'Push vypnutý',
  'osrm.failed': 'Mapy (trasa) nedostupné',
  'osrm.no_route': 'Trasa nenájdená',
  'geocoder.failed': 'Geokódovanie zlyhalo',
  'estimate.error': 'Odhad km zlyhal',
  'reminder.error': 'Pripomienky zlyhali',
  'server.start': 'Štart servera',
  'server.stop': 'Vypnutie servera',
};

const LEVEL_CLS = {
  info: 'bg-raised text-soft',
  warn: 'bg-taxi-dim text-taxi border border-taxi/50',
  error: 'bg-red-950/70 text-red-200 border border-red-400/60',
};
const LEVEL_LABEL = { info: 'info', warn: 'varovanie', error: 'chyba' };

const fmtAt = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return today ? time : `${d.toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric' })} ${time}`;
};

export function LogsPanel() {
  const [cat, setCat] = useState('');
  const [problems, setProblems] = useState(false);
  const [days, setDays] = useState(7);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<LogRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [problems24h, setProblems24h] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [auto, setAuto] = useState(false);
  const reqSeq = useRef(0);

  const fetchPage = useCallback(
    async (before?: number) => {
      const p = new URLSearchParams({ limit: '100' });
      if (cat) p.set('cat', cat);
      if (problems) p.set('level', 'problems');
      if (days) p.set('days', String(days));
      if (query) p.set('q', query);
      if (before) p.set('before', String(before));
      return api<LogPage>(`/api/logs?${p}`);
    },
    [cat, problems, days, query],
  );

  const reload = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoading(true);
    try {
      const page = await fetchPage();
      if (seq !== reqSeq.current) return;
      setRows(page.rows);
      setHasMore(page.hasMore);
      setProblems24h(page.problems24h);
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    reload();
  }, [reload]);

  // vyhľadávanie s oneskorením, nech sa nepýta pri každom písmene
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(reload, 10_000);
    return () => clearInterval(t);
  }, [auto, reload]);

  async function more() {
    const last = rows[rows.length - 1];
    if (!last) return;
    setLoading(true);
    try {
      const page = await fetchPage(last.id);
      setRows((r) => [...r, ...page.rows]);
      setHasMore(page.hasMore);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-sm font-semibold ${active ? 'bg-taxi text-black' : 'border border-line text-soft hover:border-[#444]'}`;

  return (
    <section className="card flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {CATS.map((c) => (
            <button key={c.id} type="button" className={chip(cat === c.id)} onClick={() => setCat(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={chip(problems)}
            onClick={() => setProblems((p) => !p)}
            title="Len varovania a chyby"
          >
            Len problémy
            {problems24h > 0 && (
              <span
                className={`ml-1.5 rounded-full px-1.5 text-xs ${problems ? 'bg-black/20' : 'bg-taxi text-black'}`}
              >
                {problems24h}
              </span>
            )}
          </button>
          <select
            className="field w-auto py-1.5"
            aria-label="Obdobie"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {PERIODS.map((p) => (
              <option key={p.days} value={p.days}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            className="field w-52 py-1.5"
            placeholder="Hľadať (jazda #12, meno…)"
            aria-label="Hľadať v logoch"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            type="button"
            className={chip(auto)}
            onClick={() => setAuto((a) => !a)}
            title="Obnovovať každých 10 s"
          >
            {auto ? '● Živo' : 'Živo'}
          </button>
          <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={reload} disabled={loading}>
            Obnoviť
          </button>
        </div>
      </div>

      {err && <div className="rounded-xl bg-red-950/70 px-4 py-3 text-sm text-red-100">{err}</div>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted">
              <th className="w-[110px] px-2.5 py-2">Čas</th>
              <th className="w-[96px] px-2.5 py-2">Úroveň</th>
              <th className="w-[190px] px-2.5 py-2">Udalosť</th>
              <th className="px-2.5 py-2">Popis</th>
              <th className="w-[180px] px-2.5 py-2">Kto</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-2.5 py-4 text-muted">
                  Žiadne záznamy pre zvolený filter.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr
                  className={`cursor-pointer border-t border-[#2a2a2a] hover:bg-raised/60 ${open === r.id ? 'bg-raised/60' : ''}`}
                  onClick={() => setOpen(open === r.id ? null : r.id)}
                >
                  <td className="px-2.5 py-2 whitespace-nowrap text-soft tabular-nums">{fmtAt(r.at)}</td>
                  <td className="px-2.5 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${LEVEL_CLS[r.level]}`}
                    >
                      {LEVEL_LABEL[r.level]}
                    </span>
                  </td>
                  <td className="px-2.5 py-2">
                    <div className="font-semibold">{EVT_LABEL[r.evt] ?? r.evt}</div>
                    <div className="text-[11px] text-muted">{r.evt}</div>
                  </td>
                  <td className="px-2.5 py-2">{r.msg}</td>
                  <td className="px-2.5 py-2 text-soft">
                    {r.userName ? (
                      <>
                        {r.userName}
                        {r.userRole && (
                          <span className="text-xs text-muted"> · {ROLE_LABEL[r.userRole]}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted">–</span>
                    )}
                  </td>
                </tr>
                {open === r.id && (
                  <tr className="bg-raised/60">
                    <td colSpan={5} className="px-2.5 pb-3">
                      <pre className="m-0 overflow-x-auto rounded-lg bg-ink p-3 text-xs leading-relaxed text-soft">
                        {JSON.stringify(
                          { id: r.id, at: new Date(r.at).toLocaleString('sk-SK'), ...(r.fields ?? {}) },
                          null,
                          2,
                        )}
                      </pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-[13px] text-muted">
        <span>
          {rows.length} záznamov{loading ? ' · načítavam…' : ''} · klik na riadok = detail · uchováva sa 90
          dní
        </span>
        {hasMore && (
          <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={more} disabled={loading}>
            Načítať staršie
          </button>
        )}
      </div>
    </section>
  );
}
