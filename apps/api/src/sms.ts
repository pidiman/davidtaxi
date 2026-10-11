import { env } from './env.js';
import { audit, warn } from './log.js';

export const smsEnabled = env.smsProvider === 'webhook' && Boolean(env.smsWebhookUrl);

/** Slovenské číslo do tvaru +421…; iné medzinárodné nechá, inak null. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let p = raw.replace(/[^\d+]/g, '');
  if (p.startsWith('00')) p = `+${p.slice(2)}`;
  if (/^0\d{9}$/.test(p)) p = `+421${p.slice(1)}`;
  return /^\+\d{9,15}$/.test(p) ? p : null;
}

/**
 * Odošle SMS cez webhook: POST JSON {to, text}. Na druhej strane môže byť n8n (→ ľubovoľná SMS brána)
 * alebo Android appka „SMS Gateway“. Telefónne číslo sa do logov nezapisuje.
 */
export async function sendSms(to: string, text: string, meta: Record<string, unknown> = {}) {
  if (!smsEnabled) return false;
  try {
    const res = await fetch(env.smsWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.smsWebhookToken ? { Authorization: `Bearer ${env.smsWebhookToken}` } : {}),
      },
      body: JSON.stringify({ to, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      warn('sms.failed', `SMS sa nepodarilo odoslať (HTTP ${res.status})`, { ...meta, status: res.status });
      return false;
    }
    audit('sms.sent', 'SMS s odkazom na sledovanie odoslaná', meta);
    return true;
  } catch (err) {
    warn('sms.failed', 'SMS brána nedostupná', { ...meta, err: (err as Error).message });
    return false;
  }
}
