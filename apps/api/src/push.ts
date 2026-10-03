import { eq } from 'drizzle-orm';
import webpush from 'web-push';
import { db } from './db/index.js';
import { pushSubscriptions } from './db/schema.js';
import { env } from './env.js';
import { warn } from './log.js';

export const pushEnabled = Boolean(env.vapidPublic && env.vapidPrivate);
if (pushEnabled) webpush.setVapidDetails(env.vapidSubject, env.vapidPublic, env.vapidPrivate);

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

export async function sendPush(userId: number, payload: PushPayload) {
  if (!pushEnabled) return;
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  if (!subs.length) {
    warn('push.no_subscription', `Používateľ #${userId} nemá povolené notifikácie – push neodišiel`, {
      userId,
    });
    return;
  }
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 120, urgency: 'high' },
        );
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
          warn(
            'push.expired',
            `Push odber používateľa #${userId} vypršal – zmazaný (treba znova povoliť notifikácie)`,
            {
              userId,
              status: code,
            },
          );
        } else {
          warn('push.failed', `Push používateľovi #${userId} zlyhal`, {
            userId,
            status: code,
            err: (err as Error).message,
          });
        }
      }
    }),
  );
}
