import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import {
  api,
  fmtTime,
  type Incident,
  type IncidentContext,
  type IncidentRide,
  STATUS_LABEL,
} from '../lib/api';
import { resizeImage } from '../lib/image';
import { Modal } from './Modal';

const MAX_PHOTOS = 6;

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleString('sk-SK', {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Celoobrazovkový formulár „Incident“: popis, fotky z fotoaparátu a voliteľne jazda zo smeny.
 * Smena = aktuálna, alebo posledná ukončená (incident sa dá nahlásiť aj dodatočne).
 */
export function IncidentReport({
  onClose,
  onSent,
  kind = 'incident',
  defaultRideId = null,
}: {
  onClose: () => void;
  onSent: (i: Incident) => void;
  /** comment = komentár k jazde (dispečing ho dostane rovno ako vyriešený) */
  kind?: 'incident' | 'comment';
  defaultRideId?: number | null;
}) {
  const isComment = kind === 'comment';
  const [ctx, setCtx] = useState<IncidentContext | null>(null);
  const [text, setText] = useState('');
  const [rideId, setRideId] = useState<number | null>(defaultRideId);
  const [photos, setPhotos] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const selected = ctx?.rides.find((r) => r.id === rideId) ?? null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: načíta sa raz pri otvorení
  useEffect(() => {
    api<IncidentContext>('/api/driver/incidents/context')
      .then((c) => {
        setCtx(c);
        // komentár: predvolene posledná jazda
        if (isComment) setRideId((cur) => cur ?? c.rides[0]?.id ?? null);
      })
      .catch((e) => setErr(e.message));
  }, []);

  // zamkni scroll stránky pod overlayom
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setProcessing(true);
    setErr('');
    try {
      const room = MAX_PHOTOS - photos.length;
      const picked = Array.from(files).slice(0, room);
      const out: string[] = [];
      for (const f of picked) out.push(await resizeImage(f, 1600, 0.8));
      setPhotos((p) => [...p, ...out]);
      if (files.length > room) setErr(`Najviac ${MAX_PHOTOS} fotiek`);
    } catch {
      setErr('Fotku sa nepodarilo načítať');
    } finally {
      setProcessing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return setErr(isComment ? 'Napíš komentár' : 'Napíš, čo sa stalo');
    if (isComment && rideId === null) return setErr('Vyber jazdu');
    setSending(true);
    setErr('');
    try {
      const inc = await api<Incident>('/api/driver/incidents', {
        body: { description: text.trim(), rideId, photos, kind },
      });
      onSent(inc);
    } catch (e2) {
      setErr((e2 as Error).message);
      setSending(false);
    }
  }

  const shift = ctx?.shift;

  return (
    <div className="fixed inset-0 z-[3000] overflow-y-auto bg-ink">
      <form
        onSubmit={submit}
        className="mx-auto flex min-h-[100dvh] max-w-md flex-col gap-4 px-4 pt-[max(16px,env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))]"
      >
        <div className="flex items-center justify-between">
          <h1 className="m-0 font-display text-3xl font-bold uppercase tracking-wide">
            {isComment ? 'Komentár k jazde' : 'Incident'}
          </h1>
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
          {isComment ? 'Komentár' : 'Čo sa stalo?'}
          <textarea
            className="field min-h-32 resize-y text-base"
            placeholder={
              isComment
                ? 'napr. zákazník platil kartou, čakal som 10 min, zákazník chce faktúru'
                : 'napr. zákazník ogrcal zadné sedadlo, treba čistenie'
            }
            value={text}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
          />
        </label>

        {/* ---------- fotky ---------- */}
        <div className="flex flex-col gap-2">
          <div className="text-sm text-muted">
            Fotky ({photos.length}/{MAX_PHOTOS})
          </div>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <div
                key={p.slice(-32) + String(i)}
                className="relative aspect-square overflow-hidden rounded-xl"
              >
                <img src={p} alt={`Fotka ${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label="Odstrániť fotku"
                  onClick={() => setPhotos((l) => l.filter((_, j) => j !== i))}
                  className="absolute top-1 right-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/75 text-lg text-white"
                >
                  ×
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={processing}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-[#444] text-muted"
              >
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <span className="text-xs">{processing ? 'spracúvam…' : 'Odfotiť'}</span>
              </button>
            )}
          </div>
          {/* capture → na mobile rovno fotoaparát; bez capture by sa dalo vybrať aj z galérie */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
          {photos.length < MAX_PHOTOS && (
            <button
              type="button"
              className="self-start text-sm text-taxi"
              onClick={() => {
                const el = fileRef.current;
                if (!el) return;
                el.removeAttribute('capture');
                el.click();
                setTimeout(() => el.setAttribute('capture', 'environment'), 0);
              }}
            >
              alebo vybrať z galérie
            </button>
          )}
        </div>

        {/* ---------- jazda zo smeny ---------- */}
        <div className="flex flex-col gap-2">
          <div className="text-sm text-muted">
            {isComment ? 'Jazda' : 'Týka sa jazdy?'}{' '}
            {shift && (
              <span className="text-soft">
                · smena {fmtDay(shift.startedAt)}
                {shift.endedAt ? ` – ${fmtTime(shift.endedAt)}` : ' (prebieha)'}
                {shift.vehicleCallsign ? ` · auto ${shift.vehicleCallsign}` : ''}
              </span>
            )}
          </div>
          {!ctx && !err && <div className="text-sm text-muted">Načítavam jazdy…</div>}
          {ctx && (
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="flex items-center gap-3 rounded-xl border border-line p-3 text-left"
              aria-label="Zmeniť jazdu"
            >
              <span className="min-w-0 flex-1">
                {selected ? (
                  <RideSummary r={selected} />
                ) : (
                  <>
                    <span className="font-semibold">Bez jazdy</span>
                    <span className="block text-[13px] text-muted">
                      {ctx.rides.length ? 'napr. škoda na aute, nehoda bez zákazníka' : 'v smene nemáš jazdy'}
                    </span>
                  </>
                )}
              </span>
              {(ctx.rides.length > 1 || (!isComment && ctx.rides.length > 0)) && (
                <span className="shrink-0 text-sm font-semibold text-taxi">Zmeniť</span>
              )}
            </button>
          )}
        </div>

        {picking && ctx && (
          <Modal title="Vyber jazdu" onClose={() => setPicking(false)}>
            <div className="flex flex-col gap-1.5">
              {!isComment && (
                <RideOption
                  checked={rideId === null}
                  onSelect={() => {
                    setRideId(null);
                    setPicking(false);
                  }}
                >
                  <span className="font-semibold">Bez jazdy</span>
                  <span className="block text-[13px] text-muted">
                    napr. škoda na aute, nehoda bez zákazníka
                  </span>
                </RideOption>
              )}
              {ctx.rides.map((r) => (
                <RideOption
                  key={r.id}
                  checked={rideId === r.id}
                  onSelect={() => {
                    setRideId(r.id);
                    setPicking(false);
                  }}
                >
                  <RideSummary r={r} />
                </RideOption>
              ))}
            </div>
          </Modal>
        )}

        {err && <div className="rounded-xl bg-red-950/70 p-3 text-sm text-red-100">{err}</div>}

        <button
          type="submit"
          className="btn-primary mt-auto h-14 rounded-2xl text-lg uppercase tracking-wide"
          disabled={sending || processing || !text.trim()}
        >
          {sending ? 'Odosielam…' : isComment ? 'Odoslať komentár' : 'Odoslať dispečingu'}
        </button>

        {ctx && ctx.incidents.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <div className="text-xs uppercase tracking-[2px] text-muted">Už odoslané v tejto smene</div>
            {ctx.incidents.map((i) => (
              <div key={i.id} className="rounded-xl bg-panel p-3 text-sm">
                <div className="flex justify-between text-[13px] text-muted">
                  <span>
                    {fmtTime(i.createdAt)}
                    {i.rideId ? ` · jazda #${i.rideId}` : ''}
                    {i.photos.length ? ` · ${i.photos.length} foto` : ''}
                  </span>
                  <span className={i.resolvedAt ? 'text-taxi' : ''}>
                    {i.kind === 'comment' ? 'komentár' : i.resolvedAt ? 'vyriešené' : 'otvorené'}
                  </span>
                </div>
                <div className="mt-1 whitespace-pre-wrap">{i.description}</div>
              </div>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}

function RideOption({
  checked,
  onSelect,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onSelect}
      className={`rounded-xl p-3 text-left ${checked ? 'border-2 border-taxi bg-taxi-dim' : 'border border-line'}`}
    >
      {children}
    </button>
  );
}

function RideSummary({ r }: { r: IncidentRide }) {
  return (
    <>
      <span className="flex justify-between gap-2 text-[13px] text-muted">
        <span>
          #{r.id} · {fmtTime(r.startedAt ?? r.assignedAt)}
          {r.finishedAt ? `–${fmtTime(r.finishedAt)}` : ''}
          {r.source === 'street' ? ' · z ulice' : ''}
        </span>
        <span>{STATUS_LABEL[r.status]}</span>
      </span>
      <span className="block font-semibold">{r.customerName}</span>
      <span className="block truncate text-sm text-soft">
        {r.pickupAddress} → {r.dropoffAddress || 'bez cieľa'}
      </span>
    </>
  );
}
