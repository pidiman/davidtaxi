import { and, asc, desc, eq, getTableColumns, gte, ilike, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DISPATCH, requireRole } from '../auth.js';
import { db } from '../db/index.js';
import { type Ride, ridePoints, rides, users, vehicles } from '../db/schema.js';
import { env } from '../env.js';
import { estimateRide, reverseLabel } from '../estimate.js';
import { acceptSegment, haversineKm } from '../geo.js';
import { audit, byFields, warn, who } from '../log.js';
import { sendPush } from '../push.js';
import { emitDispatch, emitDriver } from '../realtime.js';
import { HttpError, num, str } from '../util.js';
import { openShiftOf } from './shifts.js';

type RideStatus = Ride['status'];
const ACTIVE: RideStatus[] = ['assigned', 'accepted', 'arrived', 'in_progress'];
const OPEN: RideStatus[] = ['new', ...ACTIVE];

const rideSelect = {
  ...getTableColumns(rides),
  driverName: users.name,
  driverPhone: users.phone,
  vehicleCallsign: vehicles.callsign,
  vehiclePlate: vehicles.plate,
};

function rideQuery() {
  return db
    .select(rideSelect)
    .from(rides)
    .leftJoin(users, eq(users.id, rides.driverId))
    .leftJoin(vehicles, eq(vehicles.id, rides.vehicleId));
}

export async function rideView(id: number) {
  const [r] = await rideQuery().where(eq(rides.id, id));
  return r;
}

async function broadcastRide(id: number, prevDriverId?: number | null) {
  const r = await rideView(id);
  if (!r) return;
  emitDispatch('ride:updated', r);
  if (r.driverId) emitDriver(r.driverId, 'ride:updated', r);
  if (prevDriverId && prevDriverId !== r.driverId) emitDriver(prevDriverId, 'ride:removed', { id });
  return r;
}

async function driverView(id: number) {
  const [d] = await db
    .select({
      id: users.id,
      name: users.name,
      phone: users.phone,
      status: users.driverStatus,
      lat: users.lastLat,
      lng: users.lastLng,
      accuracy: users.lastAccuracy,
      lastSeenAt: users.lastSeenAt,
      vehicleId: users.vehicleId,
      vehicleCallsign: vehicles.callsign,
      vehiclePlate: vehicles.plate,
      vehicleModel: vehicles.model,
    })
    .from(users)
    .leftJoin(vehicles, eq(vehicles.id, users.vehicleId))
    .where(eq(users.id, id));
  return d;
}

async function setDriverStatus(driverId: number, status: 'offline' | 'available' | 'busy' | 'break') {
  await db.update(users).set({ driverStatus: status }).where(eq(users.id, driverId));
  const d = await driverView(driverId);
  emitDispatch('driver:updated', d);
}

/** Pre vodiča: načíta jeho jazdu a overí povolený prechod stavu. */
async function ownRide(rideId: number, driverId: number, from: RideStatus[]) {
  const [r] = await db.select().from(rides).where(eq(rides.id, rideId));
  if (!r || r.driverId !== driverId) throw new HttpError(404, 'Jazda neexistuje');
  if (!from.includes(r.status)) throw new HttpError(409, `Jazdu v stave "${r.status}" nemožno takto zmeniť`);
  return r;
}

export async function rideRoutes(app: FastifyInstance) {
  const dispatch = { preHandler: requireRole(...DISPATCH) };
  const driver = { preHandler: requireRole('driver') };

  // ================= Dispečing =================
  type HistoryQuery = {
    scope?: string;
    from?: string;
    to?: string;
    driverId?: string;
    vehicleId?: string;
    status?: string;
    source?: string;
    q?: string;
  };
  app.get<{ Querystring: HistoryQuery }>('/api/rides', dispatch, async (req) => {
    const qs = req.query;
    if (qs.scope === 'history') {
      // filtre histórie: obdobie (podľa vytvorenia), vodič, auto, stav, zdroj, text
      const w: SQL[] = [
        qs.status === 'completed' || qs.status === 'cancelled'
          ? eq(rides.status, qs.status)
          : inArray(rides.status, ['completed', 'cancelled']),
      ];
      const from = qs.from ? new Date(qs.from) : null;
      const to = qs.to ? new Date(qs.to) : null;
      if (from && !Number.isNaN(from.getTime())) w.push(gte(rides.createdAt, from));
      if (to && !Number.isNaN(to.getTime())) w.push(lt(rides.createdAt, to));
      if (Number(qs.driverId)) w.push(eq(rides.driverId, Number(qs.driverId)));
      if (Number(qs.vehicleId)) w.push(eq(rides.vehicleId, Number(qs.vehicleId)));
      if (qs.source === 'dispatch' || qs.source === 'street') w.push(eq(rides.source, qs.source));
      const q = qs.q?.trim();
      if (q) {
        const like = `%${q}%`;
        w.push(
          or(
            ilike(rides.customerName, like),
            ilike(rides.customerPhone, like),
            ilike(rides.pickupAddress, like),
            ilike(rides.dropoffAddress, like),
            ...(/^#?\d+$/.test(q) ? [eq(rides.id, Number(q.replace('#', '')))] : []),
          )!,
        );
      }
      return rideQuery()
        .where(and(...w))
        .orderBy(desc(rides.createdAt))
        .limit(1000);
    }
    return rideQuery().where(inArray(rides.status, OPEN)).orderBy(asc(rides.createdAt));
  });

  app.post('/api/rides', dispatch, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const scheduled = str(b, 'scheduledAt', false);
    const [r] = await db
      .insert(rides)
      .values({
        customerName: str(b, 'customerName')!,
        customerPhone: str(b, 'customerPhone')!,
        pickupAddress: str(b, 'pickupAddress')!,
        pickupLat: num(b, 'pickupLat', false) ?? null,
        pickupLng: num(b, 'pickupLng', false) ?? null,
        dropoffAddress: str(b, 'dropoffAddress')!,
        dropoffLat: num(b, 'dropoffLat', false) ?? null,
        dropoffLng: num(b, 'dropoffLng', false) ?? null,
        passengers: num(b, 'passengers', false) ?? 1,
        note: str(b, 'note', false) ?? null,
        scheduledAt: scheduled ? new Date(scheduled) : null,
        createdById: req.user.id,
      })
      .returning();
    audit('ride.created', `Jazda #${r.id} vytvorená – ${who(req)}`, { rideId: r.id, ...byFields(req) });
    scheduleEstimate(r.id);
    return broadcastRide(r.id);
  });

  app.post<{ Params: { id: string } }>('/api/rides/:id/assign', dispatch, async (req) => {
    const id = Number(req.params.id);
    const driverId = num((req.body ?? {}) as Record<string, unknown>, 'driverId')!;
    const [r] = await db.select().from(rides).where(eq(rides.id, id));
    if (!r) throw new HttpError(404, 'Jazda neexistuje');
    if (!['new', 'assigned'].includes(r.status)) throw new HttpError(409, 'Jazdu už vodič prijal');
    const [d] = await db.select().from(users).where(eq(users.id, driverId));
    if (!d || d.role !== 'driver' || !d.active) throw new HttpError(400, 'Neplatný vodič');
    if (d.driverStatus === 'offline' || !d.vehicleId) throw new HttpError(409, `${d.name} nie je v smene`);

    await db
      .update(rides)
      .set({ status: 'assigned', driverId, vehicleId: d.vehicleId, assignedAt: new Date() })
      .where(eq(rides.id, id));
    const view = await broadcastRide(id, r.driverId);
    audit(
      'ride.assigned',
      r.driverId && r.driverId !== driverId
        ? `Jazda #${id} preradená na ${d.name} (auto ${view?.vehicleCallsign ?? '?'}) – ${who(req)}`
        : `Jazda #${id} poslaná vodičovi ${d.name} (auto ${view?.vehicleCallsign ?? '?'}) – ${who(req)}`,
      {
        rideId: id,
        driverId,
        prevDriverId: r.driverId ?? undefined,
        vehicleId: d.vehicleId,
        ...byFields(req),
      },
    );
    await sendPush(driverId, {
      title: '🚕 NOVÁ JAZDA – otvor appku',
      body: `${r.pickupAddress} → ${r.dropoffAddress}`,
      url: '/driver',
      tag: `ride-${id}`,
    });
    return view;
  });

  app.post<{ Params: { id: string } }>('/api/rides/:id/cancel', dispatch, async (req) => {
    const id = Number(req.params.id);
    const [r] = await db.select().from(rides).where(eq(rides.id, id));
    if (!r) throw new HttpError(404, 'Jazda neexistuje');
    if (!OPEN.includes(r.status)) throw new HttpError(409, 'Jazda je už uzavretá');
    await db.update(rides).set({ status: 'cancelled', finishedAt: new Date() }).where(eq(rides.id, id));
    audit('ride.cancelled', `Jazda #${id} zrušená (bola v stave ${r.status}) – ${who(req)}`, {
      rideId: id,
      prevStatus: r.status,
      driverId: r.driverId ?? undefined,
      ...byFields(req),
    });
    if (r.driverId && r.status !== 'new') {
      await sendPush(r.driverId, { title: 'Jazda zrušená', body: r.pickupAddress, url: '/driver' });
      await refreshDriverAvailability(r.driverId);
    }
    return broadcastRide(id);
  });

  app.get('/api/drivers', dispatch, async () => {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'driver'), eq(users.active, true)))
      .orderBy(asc(users.name));
    return Promise.all(rows.map((r) => driverView(r.id)));
  });

  // ================= Vodič =================
  app.get('/api/driver/rides', driver, async (req) =>
    rideQuery()
      .where(and(eq(rides.driverId, req.user.id), inArray(rides.status, ACTIVE)))
      .orderBy(asc(rides.assignedAt)),
  );

  app.get('/api/driver/me', driver, async (req) => driverView(req.user.id));

  app.post('/api/driver/status', driver, async (req) => {
    const s = str((req.body ?? {}) as Record<string, unknown>, 'status') as 'available' | 'break';
    if (!['available', 'break'].includes(s)) {
      throw new HttpError(400, 'Smenu ukonči tlačidlom Ukončiť smenu (so stavom km)');
    }
    if (!(await openShiftOf(req.user.id))) throw new HttpError(409, 'Najprv začni smenu a vyber auto');
    const [cur] = await db.select({ s: users.driverStatus }).from(users).where(eq(users.id, req.user.id));
    if (cur?.s === 'busy') throw new HttpError(409, 'Počas jazdy nemôžeš zmeniť stav');
    await setDriverStatus(req.user.id, s);
    if (cur?.s !== s)
      audit('driver.status', `${req.user.name}: ${s === 'break' ? 'pauza' : 'voľný'}`, {
        driverId: req.user.id,
        status: s,
        prev: cur?.s,
      });
    return driverView(req.user.id);
  });

  // Vodič zobral zákazníka priamo na ulici: jazda sa hneď spustí (in_progress), auto je obsadené.
  app.post('/api/driver/rides/street', driver, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const busy = await db
      .select({ id: rides.id })
      .from(rides)
      .where(and(eq(rides.driverId, req.user.id), eq(rides.status, 'in_progress')));
    if (busy.length) throw new HttpError(409, 'Najprv ukonči prebiehajúcu jazdu');
    const [me] = await db.select().from(users).where(eq(users.id, req.user.id));
    if (!me.vehicleId || !(await openShiftOf(req.user.id)))
      throw new HttpError(409, 'Najprv začni smenu a vyber auto');
    const now = new Date();
    const [r] = await db
      .insert(rides)
      .values({
        source: 'street',
        status: 'in_progress',
        customerName: str(b, 'customerName', false) ?? 'Zákazník z ulice',
        customerPhone: str(b, 'customerPhone', false) ?? null,
        pickupAddress: str(b, 'pickupAddress')!,
        pickupLat: num(b, 'pickupLat', false) ?? null,
        pickupLng: num(b, 'pickupLng', false) ?? null,
        // cieľ je pri jazde z ulice nepovinný – doplní sa podľa GPS pri ukončení
        dropoffAddress: str(b, 'dropoffAddress', false) ?? '',
        dropoffLat: num(b, 'dropoffLat', false) ?? null,
        dropoffLng: num(b, 'dropoffLng', false) ?? null,
        passengers: num(b, 'passengers', false) ?? 1,
        note: str(b, 'note', false) ?? null,
        driverId: req.user.id,
        vehicleId: me.vehicleId,
        createdById: req.user.id,
        assignedAt: now,
        acceptedAt: now,
        startedAt: now,
      })
      .returning();
    await setDriverStatus(req.user.id, 'busy');
    audit('ride.street', `Jazda #${r.id} z ulice – ${req.user.name}`, {
      rideId: r.id,
      driverId: req.user.id,
      vehicleId: me.vehicleId,
    });
    scheduleEstimate(r.id);
    const view = await broadcastRide(r.id);
    emitDispatch('ride:street', {
      id: r.id,
      driverName: req.user.name,
      callsign: view?.vehicleCallsign ?? null,
    });
    return view;
  });

  app.post<{ Params: { id: string } }>('/api/driver/rides/:id/accept', driver, async (req) => {
    const r = await ownRide(Number(req.params.id), req.user.id, ['assigned']);
    await db.update(rides).set({ status: 'accepted', acceptedAt: new Date() }).where(eq(rides.id, r.id));
    await setDriverStatus(req.user.id, 'busy');
    const waitS = r.assignedAt ? Math.round((Date.now() - r.assignedAt.getTime()) / 1000) : undefined;
    audit(
      'ride.accepted',
      `Jazda #${r.id} prijatá – ${req.user.name}${waitS !== undefined ? ` po ${waitS} s` : ''}`,
      {
        rideId: r.id,
        driverId: req.user.id,
        reactionS: waitS,
      },
    );
    return broadcastRide(r.id);
  });

  app.post<{ Params: { id: string } }>('/api/driver/rides/:id/reject', driver, async (req) => {
    const r = await ownRide(Number(req.params.id), req.user.id, ['assigned']);
    await db
      .update(rides)
      .set({ status: 'new', driverId: null, vehicleId: null, assignedAt: null })
      .where(eq(rides.id, r.id));
    audit('ride.rejected', `Jazda #${r.id} odmietnutá – ${req.user.name}, vracia sa medzi čakajúce`, {
      rideId: r.id,
      driverId: req.user.id,
    });
    emitDispatch('ride:rejected', { id: r.id, driverName: req.user.name });
    await broadcastRide(r.id, req.user.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/driver/rides/:id/arrived', driver, async (req) => {
    const r = await ownRide(Number(req.params.id), req.user.id, ['accepted']);
    await db.update(rides).set({ status: 'arrived' }).where(eq(rides.id, r.id));
    audit('ride.arrived', `Jazda #${r.id}: ${req.user.name} je na mieste A`, {
      rideId: r.id,
      driverId: req.user.id,
    });
    return broadcastRide(r.id);
  });

  app.post<{ Params: { id: string } }>('/api/driver/rides/:id/start', driver, async (req) => {
    const r = await ownRide(Number(req.params.id), req.user.id, ['accepted', 'arrived']);
    const busy = await db
      .select({ id: rides.id })
      .from(rides)
      .where(and(eq(rides.driverId, req.user.id), eq(rides.status, 'in_progress')));
    if (busy.length) throw new HttpError(409, 'Najprv ukonči prebiehajúcu jazdu');
    await db
      .update(rides)
      .set({ status: 'in_progress', startedAt: new Date(), distanceKm: 0 })
      .where(eq(rides.id, r.id));
    audit('ride.started', `Jazda #${r.id} začala – ${req.user.name}`, {
      rideId: r.id,
      driverId: req.user.id,
    });
    return broadcastRide(r.id);
  });

  app.post<{ Params: { id: string } }>('/api/driver/rides/:id/finish', driver, async (req) => {
    const r = await ownRide(Number(req.params.id), req.user.id, ['in_progress']);
    const km = Number(r.distanceKm);
    const price = Math.max(env.priceMin, Math.round(km * env.pricePerKm * 100) / 100);
    // jazda bez cieľa → B = miesto ukončenia (poloha z appky, inak posledná známa)
    let dest: Partial<Pick<Ride, 'dropoffAddress' | 'dropoffLat' | 'dropoffLng'>> = {};
    if (!r.dropoffAddress) {
      const b = (req.body ?? {}) as Record<string, unknown>;
      let lat = num(b, 'lat', false) ?? null;
      let lng = num(b, 'lng', false) ?? null;
      if (lat === null || lng === null) {
        const [me] = await db
          .select({ lat: users.lastLat, lng: users.lastLng })
          .from(users)
          .where(eq(users.id, req.user.id));
        lat = me?.lat ?? null;
        lng = me?.lng ?? null;
      }
      if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        dest = { dropoffAddress: await reverseLabel(lat, lng), dropoffLat: lat, dropoffLng: lng };
      } else {
        dest = { dropoffAddress: 'neznámy cieľ' };
      }
    }
    await db
      .update(rides)
      .set({ status: 'completed', finishedAt: new Date(), price, ...dest })
      .where(eq(rides.id, r.id));
    if ('dropoffAddress' in dest) {
      audit('ride.destination_set', `Jazda #${r.id}: cieľ doplnený pri ukončení podľa GPS`, {
        rideId: r.id,
        driverId: req.user.id,
      });
      scheduleEstimate(r.id);
    }
    const mins = r.startedAt ? Math.round((Date.now() - r.startedAt.getTime()) / 60000) : undefined;
    audit(
      'ride.completed',
      `Jazda #${r.id} dokončená – ${req.user.name}, ${km.toFixed(1)} km, ${price.toFixed(2)} €${mins !== undefined ? `, ${mins} min` : ''}`,
      { rideId: r.id, driverId: req.user.id, km: Math.round(km * 10) / 10, price, minutes: mins },
    );
    await refreshDriverAvailability(req.user.id);
    return broadcastRide(r.id);
  });

  // Poloha z PWA (cca každých 10 s). Počas jazdy in_progress sa zapisujú body a pripočítavajú km.
  app.post('/api/driver/location', driver, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const lat = num(b, 'lat')!;
    const lng = num(b, 'lng')!;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, 'Neplatné súradnice');
    const accuracy = num(b, 'accuracy', false) ?? null;
    const ts = num(b, 'timestamp', false);
    const recordedAt = ts ? new Date(ts) : new Date();

    await db
      .update(users)
      .set({ lastLat: lat, lastLng: lng, lastAccuracy: accuracy, lastSeenAt: new Date() })
      .where(eq(users.id, req.user.id));

    const [ride] = await db
      .select()
      .from(rides)
      .where(and(eq(rides.driverId, req.user.id), eq(rides.status, 'in_progress')));

    let distanceKm: number | null = null;
    if (ride) {
      const [last] = await db
        .select()
        .from(ridePoints)
        .where(eq(ridePoints.rideId, ride.id))
        .orderBy(desc(ridePoints.recordedAt))
        .limit(1);
      distanceKm = Number(ride.distanceKm);
      // ride_points drží len prijaté body → referenčný bod nikdy nie je GPS skok ani šum
      if (!last) {
        if (accuracy === null || accuracy <= 50) {
          await db.insert(ridePoints).values({ rideId: ride.id, lat, lng, accuracy, recordedAt });
        }
      } else {
        const seg = haversineKm(last.lat, last.lng, lat, lng);
        const secs = (recordedAt.getTime() - last.recordedAt.getTime()) / 1000;
        if (acceptSegment(seg, secs, accuracy)) {
          await db.insert(ridePoints).values({ rideId: ride.id, lat, lng, accuracy, recordedAt });
          const [upd] = await db
            .update(rides)
            .set({ distanceKm: sql`${rides.distanceKm} + ${seg}` })
            .where(eq(rides.id, ride.id))
            .returning({ distanceKm: rides.distanceKm });
          distanceKm = Number(upd.distanceKm);
          emitDispatch('ride:distance', { id: ride.id, distanceKm });
        }
      }
    }

    emitDispatch('driver:location', { id: req.user.id, lat, lng, accuracy, at: new Date().toISOString() });
    return { ok: true, distanceKm };
  });
}

/** Po skončení/zrušení jazdy: ak vodič nemá inú aktívnu jazdu, je opäť voľný. */
async function refreshDriverAvailability(driverId: number) {
  const other = await db
    .select({ id: rides.id })
    .from(rides)
    .where(and(eq(rides.driverId, driverId), inArray(rides.status, ['accepted', 'arrived', 'in_progress'])));
  const [d] = await db.select({ s: users.driverStatus }).from(users).where(eq(users.id, driverId));
  if (!other.length && d?.s === 'busy') await setDriverStatus(driverId, 'available');
}

/**
 * Pripomienky: kým vodič jazdu neprijme ani neodmietne, každých 30 s mu príde ďalšia push
 * notifikácia (max 6×). Pomôže, keď má mobil zamknutý vo vrecku.
 */
const reminded = new Map<string, number>();
export function startAssignReminders() {
  const timer = setInterval(async () => {
    try {
      const rows = await db
        .select({
          id: rides.id,
          driverId: rides.driverId,
          assignedAt: rides.assignedAt,
          pickupAddress: rides.pickupAddress,
          dropoffAddress: rides.dropoffAddress,
        })
        .from(rides)
        .where(and(eq(rides.status, 'assigned'), lt(rides.assignedAt, new Date(Date.now() - 25_000))));
      const live = new Set(rows.map((r) => `${r.id}-${r.assignedAt?.getTime()}`));
      for (const k of reminded.keys()) if (!live.has(k)) reminded.delete(k);
      for (const r of rows) {
        const key = `${r.id}-${r.assignedAt?.getTime()}`;
        const n = reminded.get(key) ?? 0;
        if (!r.driverId || n >= 6) continue;
        reminded.set(key, n + 1);
        audit('ride.reminder', `Jazda #${r.id}: pripomienka ${n + 1}/6 vodičovi #${r.driverId} (neprijatá)`, {
          rideId: r.id,
          driverId: r.driverId,
          attempt: n + 1,
        });
        const mins = r.assignedAt ? Math.round((Date.now() - r.assignedAt.getTime()) / 60000) : 0;
        await sendPush(r.driverId, {
          title: `Nová jazda stále čaká${mins ? ` (${mins} min)` : ''}`,
          body: `${r.pickupAddress} → ${r.dropoffAddress}`,
          url: '/driver',
          tag: `ride-${r.id}`,
        });
      }
    } catch (err) {
      warn('reminder.error', 'Pripomienky jázd zlyhali, ďalší pokus o 30 s', { err: String(err) });
    }
  }, 30_000);
  timer.unref();
}

/** Vzdialenosť A→B sa počíta na pozadí (geokódovanie + OSRM), potom sa jazda rozpošle znova. */
function scheduleEstimate(id: number) {
  estimateRide(id)
    .then(async (changed) => {
      if (changed) await broadcastRide(id);
    })
    .catch((err) =>
      warn('estimate.error', `Odhad vzdialenosti pre jazdu #${id} zlyhal`, { rideId: id, err: String(err) }),
    );
}
