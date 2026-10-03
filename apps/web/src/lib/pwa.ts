import { api } from './api';

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

function b64ToUint8(base64: string) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export type PushState = 'unsupported' | 'disabled' | 'denied' | 'default' | 'granted';

export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  const cfg = await api<{ pushPublicKey: string | null }>('/api/config');
  if (!cfg.pushPublicKey) return 'disabled';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'granted' : 'default';
}

/** Musí sa volať z kliknutia (iOS to inak nedovolí). */
export async function enablePush() {
  const cfg = await api<{ pushPublicKey: string | null }>('/api/config');
  if (!cfg.pushPublicKey) throw new Error('Server nemá nastavené VAPID kľúče');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifikácie neboli povolené');
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToUint8(cfg.pushPublicKey),
    }));
  await api('/api/push/subscribe', { body: sub.toJSON() });
}

/** Drží displej zapnutý, kým je vodič online (inak prehliadač zastaví GPS). */
export function keepScreenOn() {
  let lock: WakeLockSentinel | null = null;
  let stopped = false;
  const acquire = async () => {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        lock = await navigator.wakeLock.request('screen');
      }
    } catch {
      /* napr. úsporný režim batérie */
    }
  };
  const onVis = () => {
    if (!stopped && document.visibilityState === 'visible') acquire();
  };
  acquire();
  document.addEventListener('visibilitychange', onVis);
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVis);
    lock?.release().catch(() => {});
  };
}
