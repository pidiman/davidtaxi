import { useEffect, useState } from 'react';
import { api, type Ride } from '../lib/api';
import { Modal } from './Modal';

type LinkResp = { url: string; sent: boolean; smsEnabled: boolean };

/** Odkaz pre zákazníka na sledovanie taxíka: kopírovať, otvoriť, poslať SMS (brána alebo vlastný mobil). */
export function TrackLinkModal({ ride, onClose }: { ride: Ride; onClose: () => void }) {
  const [data, setData] = useState<LinkResp | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<LinkResp>(`/api/rides/${ride.id}/track-link`, { method: 'POST', body: {} })
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [ride.id]);

  async function copy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.url);
      setMsg('Odkaz skopírovaný');
    } catch {
      setMsg('Označ odkaz a skopíruj ho ručne');
    }
  }

  async function sendSms() {
    setBusy(true);
    setErr('');
    try {
      await api(`/api/rides/${ride.id}/track-link`, { body: { send: true } });
      setMsg('SMS odoslaná');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const text = data ? `Rýchle Taxi: vaše taxi je na ceste. Sledujte jeho príchod: ${data.url}` : '';
  const phone = ride.customerPhone?.replace(/[^\d+]/g, '');

  return (
    <Modal title={`Sledovanie · ${ride.customerName}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-sm text-muted">
          Zákazník na tomto odkaze vidí, kde je auto a o koľko minút príde. Odkaz platí do 2 h po skončení
          jazdy.
        </p>
        {ride.trackSentAt && (
          <div className="rounded-[10px] bg-taxi-dim px-3 py-2 text-sm text-[#f2e3b0]">
            SMS s odkazom bola zákazníkovi odoslaná automaticky po prijatí jazdy.
          </div>
        )}
        {err && <div className="rounded-[10px] bg-red-950/70 px-3 py-2 text-sm text-red-100">{err}</div>}
        {data && (
          <>
            <input
              className="field font-mono text-sm"
              readOnly
              value={data.url}
              onFocus={(e) => e.target.select()}
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={copy}>
                Kopírovať odkaz
              </button>
              <a className="btn-ghost no-underline" href={data.url} target="_blank" rel="noreferrer">
                Otvoriť
              </a>
              {data.smsEnabled && phone && (
                <button type="button" className="btn-outline" disabled={busy} onClick={sendSms}>
                  {ride.trackSentAt ? 'Poslať SMS znova' : 'Poslať SMS'}
                </button>
              )}
              {!data.smsEnabled && phone && (
                <a
                  className="btn-outline no-underline"
                  href={`sms:${phone}?body=${encodeURIComponent(text)}`}
                  title="Otvorí SMS appku na tomto zariadení (mobil dispečera)"
                >
                  SMS z môjho mobilu
                </a>
              )}
            </div>
            {!data.smsEnabled && (
              <p className="m-0 text-xs text-muted">
                Automatické SMS sú vypnuté – zapneš ich v .env (SMS_PROVIDER=webhook, SMS_WEBHOOK_URL).
              </p>
            )}
          </>
        )}
        {msg && <div className="text-sm font-semibold text-taxi">{msg}</div>}
      </div>
    </Modal>
  );
}
