import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DISPATCH, requireRole } from '../auth.js';
import { db } from '../db/index.js';
import { rides, users, vehicles } from '../db/schema.js';
import { env } from '../env.js';
import { haversineKm } from '../geo.js';
import { audit, byFields } from '../log.js';
import { normalizePhone, sendSms, smsEnabled } from '../sms.js';
import { HttpError } from '../util.js';

const osrmUrl = (process.env.OSRM_URL ?? 'https://router.project-osrm.org').replace(/\/$/, '');
const ENDED_VISIBLE_MS = 2 * 60 * 60 * 1000; // po skončení ešte 2 h ukáže „jazda skončila“, potom 404

export const trackUrl = (token: string) => `${env.publicUrl.replace(/\/$/, '')}/t/${token}`;

/** Vytvorí (ak treba) token na sledovanie a vráti odkaz. */
async function ensureToken(rideId: number) {
  const [r] = await db.select({ t: rides.trackToken }).from(rides).where(eq(rides.id, rideId));
  if (r?.t) return r.t;
  const token = randomBytes(12).toString('base64url');
  await db.update(rides).set({ trackToken: token }).where(eq(rides.id, rideId));
  return token;
}

async function smsText(rideId: number, url: string) {
  const [r] = await db
    .select({
      callsign: vehicles.callsign,
      plate: vehicles.plate,
      model: vehicles.model,
      color: vehicles.color,
    })
    .from(rides)
    .leftJoin(vehicles, eq(vehicles.id, rides.vehicleId))
    .where(eq(rides.id, rideId));
  const car = [r?.color, r?.model, r?.plate].filter(Boolean).join(' ');
  return `Rýchle Taxi: vaše taxi${car ? ` (${car})` : ''} je na ceste. Sledujte jeho príchod: ${url}`;
}

/**
 * Po prijatí jazdy vodičom: vytvorí odkaz a ak je zapnutá SMS brána a zákazník má telefón, pošle mu ho.
 * Beží na pozadí – nikdy nezdrží odpoveď vodičovi.
 */
export async function issueTrackLink(rideId: number) {
  const token = await ensureToken(rideId);
  const url = trackUrl(token);
  const [r] = await db
    .select({ phone: rides.customerPhone, source: rides.source, sent: rides.trackSentAt })
    .from(rides)
    .where(eq(rides.id, rideId));
  const to = normalizePhone(r?.phone);
  if (r && !r.sent && to && r.source === 'dispatch' && smsEnabled) {
    if (await sendSms(to, await smsText(rideId, url), { rideId })) {
      await db.update(rides).set({ trackSentAt: new Date() }).where(eq(rides.id, rideId));
    }
  }
  return url;
}

// ETA cache: OSRM sa nepýtame pri každom obnovení stránky zákazníkom
const etaCache = new Map<string, { at: number; key: string; sec: number; km: number }>();

async function eta(token: string, from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const key = `${from.lat.toFixed(4)},${from.lng.toFixed(4)}`;
  const c = etaCache.get(token);
  if (c && c.key === key && Date.now() - c.at < 60_000) return c;
  let sec: number;
  let km: number;
  try {
    const res = await fetch(
      `${osrmUrl}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`,
      { signal: AbortSignal.timeout(5000) },
    );
    const d = (await res.json()) as { routes?: { duration: number; distance: number }[] };
    if (!d.routes?.[0]) throw new Error('no route');
    sec = d.routes[0].duration;
    km = d.routes[0].distance / 1000;
  } catch {
    km = haversineKm(from.lat, from.lng, to.lat, to.lng) * 1.3;
    sec = (km / 35) * 3600; // ~35 km/h v obci
  }
  const v = { at: Date.now(), key, sec, km };
  etaCache.set(token, v);
  return v;
}

export async function trackRoutes(app: FastifyInstance) {
  // ---- dispečing: odkaz na sledovanie (skopírovať / poslať SMS znova) ----
  app.post<{ Params: { id: string } }>(
    '/api/rides/:id/track-link',
    { preHandler: requireRole(...DISPATCH) },
    async (req) => {
      const id = Number(req.params.id);
      const [r] = await db.select().from(rides).where(eq(rides.id, id));
      if (!r) throw new HttpError(404, 'Jazda neexistuje');
      if (!['accepted', 'arrived', 'in_progress'].includes(r.status))
        throw new HttpError(409, 'Odkaz je dostupný až keď vodič jazdu prijme');
      const url = trackUrl(await ensureToken(id));
      let sent = false;
      if ((req.body as { send?: boolean } | undefined)?.send) {
        const to = normalizePhone(r.customerPhone);
        if (!smsEnabled) throw new HttpError(409, 'SMS brána nie je nastavená (SMS_PROVIDER)');
        if (!to) throw new HttpError(400, 'Zákazník nemá platné telefónne číslo');
        sent = await sendSms(to, await smsText(id, url), { rideId: id, ...byFields(req) });
        if (!sent) throw new HttpError(502, 'SMS sa nepodarilo odoslať');
        await db.update(rides).set({ trackSentAt: new Date() }).where(eq(rides.id, id));
      } else {
        audit('track.link_copied', `Jazda #${id}: odkaz na sledovanie vyžiadaný`, {
          rideId: id,
          ...byFields(req),
        });
      }
      return { url, sent, smsEnabled };
    },
  );

  // ---- verejné: stav pre zákazníka (bez prihlásenia, len cez náhodný token) ----
  app.get<{ Params: { token: string } }>('/api/track/:token', async (req, reply) => {
    const token = req.params.token;
    if (!/^[A-Za-z0-9_-]{10,40}$/.test(token)) return reply.code(404).send({ error: 'Odkaz neexistuje' });
    const [r] = await db
      .select({
        status: rides.status,
        pickupAddress: rides.pickupAddress,
        pickupLat: rides.pickupLat,
        pickupLng: rides.pickupLng,
        finishedAt: rides.finishedAt,
        driverName: users.name,
        lat: users.lastLat,
        lng: users.lastLng,
        seenAt: users.lastSeenAt,
        callsign: vehicles.callsign,
        plate: vehicles.plate,
        model: vehicles.model,
        color: vehicles.color,
      })
      .from(rides)
      .leftJoin(users, eq(users.id, rides.driverId))
      .leftJoin(vehicles, eq(vehicles.id, rides.vehicleId))
      .where(eq(rides.trackToken, token));
    if (!r) return reply.code(404).send({ error: 'Odkaz neexistuje' });
    if (r.finishedAt && Date.now() - r.finishedAt.getTime() > ENDED_VISIBLE_MS)
      return reply.code(404).send({ error: 'Odkaz už vypršal' });
    reply.header('Cache-Control', 'no-store');

    const phase =
      r.status === 'accepted'
        ? 'coming'
        : r.status === 'arrived'
          ? 'arrived'
          : r.status === 'in_progress'
            ? 'riding'
            : r.status === 'completed'
              ? 'done'
              : 'cancelled';
    // polohu auta ukazujeme len kým ide k zákazníkovi alebo čaká na mieste
    const showCar = (phase === 'coming' || phase === 'arrived') && r.lat !== null && r.lng !== null;
    const pickup =
      r.pickupLat !== null && r.pickupLng !== null ? { lat: r.pickupLat, lng: r.pickupLng } : null;
    const e =
      phase === 'coming' && showCar && pickup ? await eta(token, { lat: r.lat!, lng: r.lng! }, pickup) : null;

    return {
      phase,
      pickup: { address: r.pickupAddress, ...(pickup ?? {}) },
      driverFirstName: r.driverName?.split(' ')[0] ?? null,
      vehicle: { callsign: r.callsign, plate: r.plate, model: r.model, color: r.color },
      car: showCar ? { lat: r.lat, lng: r.lng, at: r.seenAt } : null,
      etaMin: e ? Math.max(1, Math.round(e.sec / 60)) : null,
      distanceKm: e ? Math.round(e.km * 10) / 10 : null,
    };
  });
}
