import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DISPATCH, requireRole } from '../auth.js';
import { db } from '../db/index.js';
import { pushSubscriptions } from '../db/schema.js';
import { env } from '../env.js';
import { pushEnabled } from '../push.js';
import { HttpError, str } from '../util.js';

export async function miscRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => {
    await db.execute(sql`select 1`);
    return { ok: true };
  });

  app.get('/api/config', async () => ({
    pushPublicKey: pushEnabled ? env.vapidPublic : null,
    priceMin: env.priceMin,
    pricePerKm: env.pricePerKm,
  }));

  // Geokódovanie adries cez OSM Nominatim (dodrž usage policy: max 1 req/s, User-Agent).
  // Pre vyššiu záťaž si môžeš self-hostnúť Nominatim/Photon a zmeniť GEOCODER_URL.
  const geocoderUrl = process.env.GEOCODER_URL ?? 'https://nominatim.openstreetmap.org/search';
  app.get<{ Querystring: { q?: string } }>(
    '/api/geocode',
    { preHandler: requireRole(...DISPATCH) },
    async (req) => {
      const q = (req.query.q ?? '').trim();
      if (q.length < 3) return [];
      const url = new URL(geocoderUrl);
      url.searchParams.set('q', q);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '5');
      url.searchParams.set('countrycodes', 'sk,at,cz,hu');
      url.searchParams.set('accept-language', 'sk');
      const res = await fetch(url, { headers: { 'User-Agent': `davidtaxi (${env.publicUrl})` } });
      if (!res.ok) throw new HttpError(502, 'Geokódovanie zlyhalo');
      const data = (await res.json()) as { display_name: string; lat: string; lon: string }[];
      return data.map((d) => ({ label: d.display_name, lat: Number(d.lat), lng: Number(d.lon) }));
    },
  );

  app.post(
    '/api/push/subscribe',
    { preHandler: requireRole('admin', 'dispatcher', 'driver') },
    async (req) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const keys = (b.keys ?? {}) as Record<string, unknown>;
      const endpoint = str(b, 'endpoint')!;
      if (!endpoint.startsWith('https://')) throw new HttpError(400, 'Neplatný endpoint');
      await db
        .insert(pushSubscriptions)
        .values({ userId: req.user.id, endpoint, p256dh: str(keys, 'p256dh')!, auth: str(keys, 'auth')! })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: { userId: req.user.id, p256dh: str(keys, 'p256dh')!, auth: str(keys, 'auth')! },
        });
      return { ok: true };
    },
  );
}
