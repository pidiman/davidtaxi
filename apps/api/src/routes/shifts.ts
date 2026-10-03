import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DISPATCH, requireRole } from '../auth.js';
import { db } from '../db/index.js';
import { rides, schedules, shifts, users, vehicles } from '../db/schema.js';
import { audit, byFields, who } from '../log.js';
import { emitDispatch, emitDriver } from '../realtime.js';
import { shiftRideCols, shiftRideStats, shiftRideWhere } from '../shiftRides.js';
import { HttpError, num, str } from '../util.js';

type Body = Record<string, unknown>;
const ACTIVE_RIDE = ['accepted', 'arrived', 'in_progress'] as const;
const MAX_SHIFT_H = 24;

export const photoUrl = (v: { id: number; photoUpdatedAt: Date | null }) =>
  v.photoUpdatedAt ? `/api/vehicles/${v.id}/photo?v=${v.photoUpdatedAt.getTime()}` : null;

const vehicleCols = {
  id: vehicles.id,
  callsign: vehicles.callsign,
  plate: vehicles.plate,
  model: vehicles.model,
  color: vehicles.color,
  seats: vehicles.seats,
  active: vehicles.active,
  photoUpdatedAt: vehicles.photoUpdatedAt,
};

/** Posledný známy stav tachometra auta (koniec poslednej smeny, inak jej začiatok). */
async function lastKmOf(vehicleId: number): Promise<number | null> {
  const [s] = await db
    .select({ startKm: shifts.startKm, endKm: shifts.endKm })
    .from(shifts)
    .where(eq(shifts.vehicleId, vehicleId))
    .orderBy(desc(shifts.startedAt))
    .limit(1);
  return s ? (s.endKm ?? s.startKm) : null;
}

async function openShiftOf(driverId: number) {
  const [s] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.driverId, driverId), isNull(shifts.endedAt)));
  return s;
}

/** Vodičova najbližšia/aktuálna položka rozpisu (od 3 h dozadu po 18 h dopredu). */
async function scheduleFor(driverId: number) {
  const now = Date.now();
  const [s] = await db
    .select({
      id: schedules.id,
      startsAt: schedules.startsAt,
      endsAt: schedules.endsAt,
      vehicleId: schedules.vehicleId,
      note: schedules.note,
      vehicleCallsign: vehicles.callsign,
    })
    .from(schedules)
    .leftJoin(vehicles, eq(vehicles.id, schedules.vehicleId))
    .where(
      and(
        eq(schedules.driverId, driverId),
        gt(schedules.endsAt, new Date(now)),
        lt(schedules.startsAt, new Date(now + 18 * 3600_000)),
      ),
    )
    .orderBy(asc(schedules.startsAt))
    .limit(1);
  return s ?? null;
}

async function shiftView(id: number) {
  const [s] = await db
    .select({
      id: shifts.id,
      driverId: shifts.driverId,
      driverName: users.name,
      vehicleId: shifts.vehicleId,
      vehicleCallsign: vehicles.callsign,
      vehiclePlate: vehicles.plate,
      vehicleModel: vehicles.model,
      vehiclePhotoUpdatedAt: vehicles.photoUpdatedAt,
      scheduleId: shifts.scheduleId,
      startedAt: shifts.startedAt,
      endedAt: shifts.endedAt,
      startKm: shifts.startKm,
      endKm: shifts.endKm,
      endKmSource: shifts.endKmSource,
      note: shifts.note,
    })
    .from(shifts)
    .innerJoin(users, eq(users.id, shifts.driverId))
    .innerJoin(vehicles, eq(vehicles.id, shifts.vehicleId))
    .where(eq(shifts.id, id));
  if (!s) return null;
  const { vehiclePhotoUpdatedAt, ...rest } = s;
  return { ...rest, vehiclePhotoUrl: photoUrl({ id: s.vehicleId, photoUpdatedAt: vehiclePhotoUpdatedAt }) };
}

async function setDriverOffShift(driverId: number) {
  await db.update(users).set({ driverStatus: 'offline', vehicleId: null }).where(eq(users.id, driverId));
  emitDispatch('driver:updated', await driverBrief(driverId));
}

async function driverBrief(id: number) {
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

function parseKm(b: Body, key: string): number {
  const v = num(b, key)!;
  if (!Number.isInteger(v) || v < 0 || v > 5_000_000) throw new HttpError(400, 'Stav km musí byť celé číslo');
  return v;
}

function parseTime(b: Body, key: string): Date {
  const v = str(b, key)!;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `Neplatný čas "${key}"`);
  return d;
}

export async function shiftRoutes(app: FastifyInstance) {
  const driver = { preHandler: requireRole('driver') };
  const dispatch = { preHandler: requireRole(...DISPATCH) };

  // ================= Vodič: smena =================
  app.get('/api/driver/shift', driver, async (req) => {
    const open = await openShiftOf(req.user.id);
    const schedule = await scheduleFor(req.user.id);
    const list = await db
      .select(vehicleCols)
      .from(vehicles)
      .where(eq(vehicles.active, true))
      .orderBy(asc(vehicles.callsign));
    const openShifts = await db
      .select({ vehicleId: shifts.vehicleId, driverId: shifts.driverId, driverName: users.name })
      .from(shifts)
      .innerJoin(users, eq(users.id, shifts.driverId))
      .where(isNull(shifts.endedAt));
    const holder = new Map(openShifts.map((s) => [s.vehicleId, s]));
    const cars = await Promise.all(
      list.map(async (v) => ({
        id: v.id,
        callsign: v.callsign,
        plate: v.plate,
        model: v.model,
        color: v.color,
        seats: v.seats,
        photoUrl: photoUrl(v),
        lastKm: await lastKmOf(v.id),
        inUseBy:
          holder.get(v.id) && holder.get(v.id)?.driverId !== req.user.id
            ? holder.get(v.id)?.driverName
            : null,
        scheduled: schedule?.vehicleId === v.id,
      })),
    );
    const view = open ? await shiftView(open.id) : null;
    const stats = open ? await shiftRideStats(req.user.id, open) : null;
    return { shift: view ? { ...view, stats } : null, schedule, vehicles: cars };
  });

  // ================= Vodič: Moje jazdy =================
  /** Zoznam mojich smien (na výber v „Moje jazdy“), najnovšie prvé. */
  app.get('/api/driver/my-shifts', driver, async (req) => {
    const rows = await db
      .select({
        id: shifts.id,
        startedAt: shifts.startedAt,
        endedAt: shifts.endedAt,
        vehicleCallsign: vehicles.callsign,
        vehiclePlate: vehicles.plate,
        startKm: shifts.startKm,
        endKm: shifts.endKm,
      })
      .from(shifts)
      .innerJoin(vehicles, eq(vehicles.id, shifts.vehicleId))
      .where(eq(shifts.driverId, req.user.id))
      .orderBy(desc(shifts.startedAt))
      .limit(60);
    return rows;
  });

  /** Jazdy jednej smeny (predvolene aktuálna, inak posledná) + súhrn. */
  app.get<{ Querystring: { shiftId?: string } }>('/api/driver/my-rides', driver, async (req) => {
    const sid = Number(req.query.shiftId);
    const [s] = await db
      .select({
        id: shifts.id,
        startedAt: shifts.startedAt,
        endedAt: shifts.endedAt,
        vehicleCallsign: vehicles.callsign,
        vehiclePlate: vehicles.plate,
        startKm: shifts.startKm,
        endKm: shifts.endKm,
      })
      .from(shifts)
      .innerJoin(vehicles, eq(vehicles.id, shifts.vehicleId))
      .where(
        sid ? and(eq(shifts.id, sid), eq(shifts.driverId, req.user.id)) : eq(shifts.driverId, req.user.id),
      )
      .orderBy(desc(shifts.startedAt))
      .limit(1);
    if (!s) {
      if (sid) throw new HttpError(404, 'Smena neexistuje');
      return { shift: null, rides: [], stats: null };
    }
    const [list, stats] = await Promise.all([
      db
        .select(shiftRideCols)
        .from(rides)
        .where(shiftRideWhere(req.user.id, s))
        .orderBy(desc(rides.assignedAt)),
      shiftRideStats(req.user.id, s),
    ]);
    return { shift: s, rides: list, stats };
  });

  app.post('/api/driver/shift/start', driver, async (req, reply) => {
    const b = (req.body ?? {}) as Body;
    const vehicleId = num(b, 'vehicleId')!;
    const startKm = parseKm(b, 'startKm');
    const takeover = b.takeover === true;

    if (await openShiftOf(req.user.id)) throw new HttpError(409, 'Smenu už máš začatú');
    const [v] = await db.select(vehicleCols).from(vehicles).where(eq(vehicles.id, vehicleId));
    if (!v || !v.active) throw new HttpError(400, 'Auto neexistuje alebo je vyradené');

    const [holder] = await db
      .select({ id: shifts.id, driverId: shifts.driverId, startKm: shifts.startKm, driverName: users.name })
      .from(shifts)
      .innerJoin(users, eq(users.id, shifts.driverId))
      .where(and(eq(shifts.vehicleId, vehicleId), isNull(shifts.endedAt)));
    if (holder) {
      const busy = await db
        .select({ id: rides.id })
        .from(rides)
        .where(and(eq(rides.driverId, holder.driverId), inArray(rides.status, [...ACTIVE_RIDE])));
      if (busy.length)
        throw new HttpError(409, `Auto ${v.callsign} práve vezie zákazníka (${holder.driverName})`);
      if (!takeover) {
        return reply.code(409).send({
          error: `Auto ${v.callsign} má ešte otvorenú smenu vodiča ${holder.driverName}. Prevziať auto?`,
          code: 'TAKEOVER',
          holderName: holder.driverName,
        });
      }
    }

    const lastKm = await lastKmOf(vehicleId);
    if (lastKm !== null && startKm < lastKm) {
      throw new HttpError(
        400,
        `Stav km nemôže byť nižší ako posledný zapísaný (${lastKm.toLocaleString('sk-SK')} km)`,
      );
    }

    const schedule = await scheduleFor(req.user.id);
    const now = new Date();
    const shiftId = await db.transaction(async (tx) => {
      if (holder) {
        // predchádzajúci vodič zabudol ukončiť smenu → konečný stav = náš počiatočný
        await tx
          .update(shifts)
          .set({ endedAt: now, endKm: startKm, endKmSource: 'next_driver' })
          .where(eq(shifts.id, holder.id));
        await tx
          .update(users)
          .set({ driverStatus: 'offline', vehicleId: null })
          .where(eq(users.id, holder.driverId));
      } else {
        // smena ukončená bez km (napr. dispečer ju zavrel) → doplníme
        const [last] = await tx
          .select({ id: shifts.id, endKm: shifts.endKm })
          .from(shifts)
          .where(eq(shifts.vehicleId, vehicleId))
          .orderBy(desc(shifts.startedAt))
          .limit(1);
        if (last && last.endKm === null) {
          audit(
            'shift.km_backfill',
            `Smena #${last.id}: konečný stav km doplnený z ďalšej smeny (${startKm})`,
            {
              shiftId: last.id,
              endKm: startKm,
              vehicleId,
            },
          );
          await tx
            .update(shifts)
            .set({ endKm: startKm, endKmSource: 'next_driver' })
            .where(eq(shifts.id, last.id));
        }
      }
      const [s] = await tx
        .insert(shifts)
        .values({
          driverId: req.user.id,
          vehicleId,
          startKm,
          startedAt: now,
          scheduleId: schedule?.id ?? null,
        })
        .returning({ id: shifts.id });
      await tx.update(users).set({ vehicleId, driverStatus: 'available' }).where(eq(users.id, req.user.id));
      return s.id;
    });

    if (holder) {
      audit(
        'shift.takeover',
        `Auto ${v.callsign} prevzal ${req.user.name} od ${holder.driverName} – jeho smena #${holder.id} uzavretá, konečné km ${startKm}`,
        {
          vehicleId,
          prevShiftId: holder.id,
          prevDriverId: holder.driverId,
          driverId: req.user.id,
          endKm: startKm,
        },
      );
      emitDriver(holder.driverId, 'shift:ended', { reason: 'takeover', by: req.user.name });
      emitDispatch('driver:updated', await driverBrief(holder.driverId));
    }
    emitDispatch('driver:updated', await driverBrief(req.user.id));
    audit('shift.started', `Smena #${shiftId} začala – ${req.user.name}, auto ${v.callsign}, ${startKm} km`, {
      shiftId,
      driverId: req.user.id,
      vehicleId,
      startKm,
      scheduleId: schedule?.id,
    });
    const view = await shiftView(shiftId);
    emitDispatch('shift:updated', view);
    return view;
  });

  app.post('/api/driver/shift/end', driver, async (req) => {
    const b = (req.body ?? {}) as Body;
    const endKm = parseKm(b, 'endKm');
    const open = await openShiftOf(req.user.id);
    if (!open) throw new HttpError(409, 'Nemáš začatú smenu');
    if (endKm < open.startKm) {
      throw new HttpError(
        400,
        `Konečný stav nemôže byť nižší ako počiatočný (${open.startKm.toLocaleString('sk-SK')} km)`,
      );
    }
    const active = await db
      .select({ id: rides.id })
      .from(rides)
      .where(and(eq(rides.driverId, req.user.id), inArray(rides.status, [...ACTIVE_RIDE])));
    if (active.length) throw new HttpError(409, 'Najprv dokonči rozbehnuté jazdy');

    // jazdy poslané vodičovi, ktoré ešte neprijal → späť dispečingu
    const pending = await db
      .update(rides)
      .set({ status: 'new', driverId: null, vehicleId: null, assignedAt: null })
      .where(and(eq(rides.driverId, req.user.id), eq(rides.status, 'assigned')))
      .returning({ id: rides.id });
    for (const p of pending) {
      emitDispatch('ride:returned', { id: p.id });
      audit('ride.returned', `Jazda #${p.id} vrátená medzi čakajúce (vodič ukončil smenu)`, {
        rideId: p.id,
        driverId: req.user.id,
      });
    }

    await db
      .update(shifts)
      .set({ endedAt: new Date(), endKm, endKmSource: 'driver' })
      .where(eq(shifts.id, open.id));
    audit(
      'shift.ended',
      `Smena #${open.id} ukončená – ${req.user.name}, ${endKm} km (najazdené ${endKm - open.startKm} km)`,
      { shiftId: open.id, driverId: req.user.id, vehicleId: open.vehicleId, startKm: open.startKm, endKm },
    );
    await setDriverOffShift(req.user.id);
    const view = await shiftView(open.id);
    emitDispatch('shift:updated', view);
    return view;
  });

  // ================= Dispečing: detail vodiča a auta (klik na auto v mape) =================
  app.get<{ Params: { id: string } }>('/api/drivers/:id/detail', dispatch, async (req) => {
    const id = Number(req.params.id);
    const driver = await driverBrief(id);
    if (!driver) throw new HttpError(404, 'Vodič neexistuje');
    const open = await openShiftOf(id);
    const vehicleId = open?.vehicleId ?? driver.vehicleId;
    const [v] = vehicleId
      ? await db
          .select({
            id: vehicles.id,
            callsign: vehicles.callsign,
            plate: vehicles.plate,
            model: vehicles.model,
            color: vehicles.color,
            year: vehicles.year,
            seats: vehicles.seats,
            fuel: vehicles.fuel,
            stkUntil: vehicles.stkUntil,
            insuranceUntil: vehicles.insuranceUntil,
            photoUpdatedAt: vehicles.photoUpdatedAt,
          })
          .from(vehicles)
          .where(eq(vehicles.id, vehicleId))
      : [];
    const [ride] = await db
      .select({
        id: rides.id,
        status: rides.status,
        source: rides.source,
        customerName: rides.customerName,
        customerPhone: rides.customerPhone,
        pickupAddress: rides.pickupAddress,
        dropoffAddress: rides.dropoffAddress,
        distanceKm: rides.distanceKm,
        startedAt: rides.startedAt,
      })
      .from(rides)
      .where(and(eq(rides.driverId, id), inArray(rides.status, ['assigned', ...ACTIVE_RIDE])))
      .orderBy(desc(rides.assignedAt))
      .limit(1);
    let stats = { rides: 0, km: 0, revenue: 0 };
    if (open) {
      const [agg] = await db
        .select({
          n: sql<number>`count(*)::int`,
          km: sql<number>`coalesce(sum(${rides.distanceKm}), 0)::float`,
          revenue: sql<number>`coalesce(sum(${rides.price}), 0)::float`,
        })
        .from(rides)
        .where(
          and(eq(rides.driverId, id), eq(rides.status, 'completed'), gte(rides.startedAt, open.startedAt)),
        );
      stats = { rides: agg.n, km: agg.km, revenue: agg.revenue };
    }
    const { photoUpdatedAt, ...vehicle } = v ?? ({} as Record<string, never>);
    return {
      driver,
      vehicle: v ? { ...vehicle, photoUrl: photoUrl({ id: v.id, photoUpdatedAt }) } : null,
      shift: open ? { id: open.id, startedAt: open.startedAt, startKm: open.startKm } : null,
      ride: ride ?? null,
      stats,
    };
  });

  // ================= Dispečing: kniha smien =================
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/shifts', dispatch, async (req) => {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 7 * 86400_000);
    const to = req.query.to ? new Date(req.query.to) : new Date(Date.now() + 86400_000);
    const rows = await db
      .select({ id: shifts.id })
      .from(shifts)
      .where(and(gte(shifts.startedAt, from), lte(shifts.startedAt, to)))
      .orderBy(desc(shifts.startedAt))
      .limit(500);
    const views = await Promise.all(rows.map((r) => shiftView(r.id)));
    // km z GPS a počet jázd počas smeny (porovnanie s tachometrom)
    return Promise.all(
      views.filter(Boolean).map(async (s) => {
        const [agg] = await db
          .select({
            n: sql<number>`count(*)::int`,
            km: sql<number>`coalesce(sum(${rides.distanceKm}), 0)::float`,
            revenue: sql<number>`coalesce(sum(${rides.price}), 0)::float`,
          })
          .from(rides)
          .where(
            and(
              eq(rides.driverId, s!.driverId),
              eq(rides.status, 'completed'),
              gte(rides.startedAt, s!.startedAt),
              s!.endedAt ? lte(rides.startedAt, s!.endedAt) : sql`true`,
            ),
          );
        return { ...s!, rideCount: agg.n, gpsKm: agg.km, revenue: agg.revenue };
      }),
    );
  });

  app.patch<{ Params: { id: string } }>('/api/shifts/:id', dispatch, async (req) => {
    const b = (req.body ?? {}) as Body;
    const id = Number(req.params.id);
    const [s] = await db.select().from(shifts).where(eq(shifts.id, id));
    if (!s) throw new HttpError(404, 'Smena neexistuje');
    const patch: Partial<typeof shifts.$inferInsert> = {};
    if ('startKm' in b) patch.startKm = parseKm(b, 'startKm');
    if ('endKm' in b) {
      if (b.endKm === null || b.endKm === '') {
        patch.endKm = null;
        patch.endKmSource = null;
      } else {
        patch.endKm = parseKm(b, 'endKm');
        patch.endKmSource = 'admin';
      }
    }
    if ('note' in b) patch.note = str(b, 'note', false) ?? null;
    const start = patch.startKm ?? s.startKm;
    const end = patch.endKm === undefined ? s.endKm : patch.endKm;
    if (end !== null && end < start) throw new HttpError(400, 'Konečný stav km je nižší ako počiatočný');
    await db.update(shifts).set(patch).where(eq(shifts.id, id));
    audit('shift.edited', `Smena #${id} upravená – ${who(req)}`, {
      shiftId: id,
      changes: Object.keys(patch),
      startKm: patch.startKm,
      endKm: patch.endKm,
      ...byFields(req),
    });
    const view = await shiftView(id);
    emitDispatch('shift:updated', view);
    return view;
  });

  // dispečer ukončí zabudnutú smenu (km môže ostať prázdne – doplní ho ďalší vodič)
  app.post<{ Params: { id: string } }>('/api/shifts/:id/end', dispatch, async (req) => {
    const b = (req.body ?? {}) as Body;
    const id = Number(req.params.id);
    const [s] = await db.select().from(shifts).where(eq(shifts.id, id));
    if (!s) throw new HttpError(404, 'Smena neexistuje');
    if (s.endedAt) throw new HttpError(409, 'Smena je už ukončená');
    const active = await db
      .select({ id: rides.id })
      .from(rides)
      .where(and(eq(rides.driverId, s.driverId), inArray(rides.status, [...ACTIVE_RIDE])));
    if (active.length) throw new HttpError(409, 'Vodič má rozbehnutú jazdu');
    const endKm = b.endKm === undefined || b.endKm === null || b.endKm === '' ? null : parseKm(b, 'endKm');
    if (endKm !== null && endKm < s.startKm)
      throw new HttpError(400, 'Konečný stav km je nižší ako počiatočný');
    await db
      .update(shifts)
      .set({ endedAt: new Date(), endKm, endKmSource: endKm === null ? null : 'admin' })
      .where(eq(shifts.id, id));
    audit(
      'shift.ended_by_dispatch',
      `Smena #${id} vodiča #${s.driverId} ukončená dispečingom${endKm === null ? ' bez km' : `, ${endKm} km`} – ${who(req)}`,
      { shiftId: id, driverId: s.driverId, endKm, ...byFields(req) },
    );
    await setDriverOffShift(s.driverId);
    emitDriver(s.driverId, 'shift:ended', { reason: 'dispatch', by: req.user.name });
    const view = await shiftView(id);
    emitDispatch('shift:updated', view);
    return view;
  });

  // ================= Rozpis =================
  const scheduleSelect = {
    id: schedules.id,
    driverId: schedules.driverId,
    driverName: users.name,
    vehicleId: schedules.vehicleId,
    vehicleCallsign: vehicles.callsign,
    vehiclePlate: vehicles.plate,
    startsAt: schedules.startsAt,
    endsAt: schedules.endsAt,
    note: schedules.note,
  };

  app.get<{ Querystring: { from?: string; to?: string } }>('/api/schedules', dispatch, async (req) => {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 86400_000);
    const to = req.query.to ? new Date(req.query.to) : new Date(Date.now() + 7 * 86400_000);
    return db
      .select(scheduleSelect)
      .from(schedules)
      .innerJoin(users, eq(users.id, schedules.driverId))
      .leftJoin(vehicles, eq(vehicles.id, schedules.vehicleId))
      .where(and(lt(schedules.startsAt, to), gt(schedules.endsAt, from)))
      .orderBy(asc(schedules.startsAt));
  });

  async function validateSchedule(
    v: { driverId: number; vehicleId: number | null; startsAt: Date; endsAt: Date },
    exceptId?: number,
  ) {
    if (v.endsAt <= v.startsAt) throw new HttpError(400, 'Koniec smeny musí byť po jej začiatku');
    if (v.endsAt.getTime() - v.startsAt.getTime() > MAX_SHIFT_H * 3600_000) {
      throw new HttpError(400, `Smena môže mať najviac ${MAX_SHIFT_H} hodín`);
    }
    const [d] = await db.select().from(users).where(eq(users.id, v.driverId));
    if (!d || d.role !== 'driver' || !d.active) throw new HttpError(400, 'Neplatný vodič');
    const overlap = and(
      lt(schedules.startsAt, v.endsAt),
      gt(schedules.endsAt, v.startsAt),
      exceptId ? ne(schedules.id, exceptId) : sql`true`,
    );
    const [dc] = await db
      .select({ id: schedules.id })
      .from(schedules)
      .where(and(overlap, eq(schedules.driverId, v.driverId)));
    if (dc) throw new HttpError(409, `${d.name} má v tomto čase už inú smenu`);
    if (v.vehicleId) {
      const [vc] = await db
        .select({ name: users.name, callsign: vehicles.callsign })
        .from(schedules)
        .innerJoin(users, eq(users.id, schedules.driverId))
        .innerJoin(vehicles, eq(vehicles.id, schedules.vehicleId))
        .where(and(overlap, eq(schedules.vehicleId, v.vehicleId)));
      if (vc) throw new HttpError(409, `Auto ${vc.callsign} má v tomto čase už ${vc.name}`);
    }
  }

  async function scheduleView(id: number) {
    const [s] = await db
      .select(scheduleSelect)
      .from(schedules)
      .innerJoin(users, eq(users.id, schedules.driverId))
      .leftJoin(vehicles, eq(vehicles.id, schedules.vehicleId))
      .where(eq(schedules.id, id));
    return s;
  }

  app.post('/api/schedules', dispatch, async (req) => {
    const b = (req.body ?? {}) as Body;
    const v = {
      driverId: num(b, 'driverId')!,
      vehicleId: num(b, 'vehicleId', false) ?? null,
      startsAt: parseTime(b, 'startsAt'),
      endsAt: parseTime(b, 'endsAt'),
    };
    await validateSchedule(v);
    const [s] = await db
      .insert(schedules)
      .values({ ...v, note: str(b, 'note', false) ?? null, createdById: req.user.id })
      .returning({ id: schedules.id });
    const view = await scheduleView(s.id);
    audit(
      'schedule.created',
      `Rozpis #${s.id}: ${view?.driverName} ${fmtRange(v.startsAt, v.endsAt)} – ${who(req)}`,
      {
        scheduleId: s.id,
        driverId: v.driverId,
        vehicleId: v.vehicleId,
        ...byFields(req),
      },
    );
    emitDriver(v.driverId, 'schedule:updated', view);
    return view;
  });

  app.patch<{ Params: { id: string } }>('/api/schedules/:id', dispatch, async (req) => {
    const b = (req.body ?? {}) as Body;
    const id = Number(req.params.id);
    const [cur] = await db.select().from(schedules).where(eq(schedules.id, id));
    if (!cur) throw new HttpError(404, 'Položka rozpisu neexistuje');
    const v = {
      driverId: 'driverId' in b ? num(b, 'driverId')! : cur.driverId,
      vehicleId: 'vehicleId' in b ? (num(b, 'vehicleId', false) ?? null) : cur.vehicleId,
      startsAt: 'startsAt' in b ? parseTime(b, 'startsAt') : cur.startsAt,
      endsAt: 'endsAt' in b ? parseTime(b, 'endsAt') : cur.endsAt,
    };
    await validateSchedule(v, id);
    await db
      .update(schedules)
      .set({ ...v, note: 'note' in b ? (str(b, 'note', false) ?? null) : cur.note })
      .where(eq(schedules.id, id));
    const view = await scheduleView(id);
    audit(
      'schedule.updated',
      `Rozpis #${id}: ${view?.driverName} ${fmtRange(v.startsAt, v.endsAt)} – ${who(req)}`,
      {
        scheduleId: id,
        driverId: v.driverId,
        vehicleId: v.vehicleId,
        ...byFields(req),
      },
    );
    emitDriver(v.driverId, 'schedule:updated', view);
    if (cur.driverId !== v.driverId) emitDriver(cur.driverId, 'schedule:updated', null);
    return view;
  });

  app.delete<{ Params: { id: string } }>('/api/schedules/:id', dispatch, async (req) => {
    const del = await db
      .delete(schedules)
      .where(eq(schedules.id, Number(req.params.id)))
      .returning({ driverId: schedules.driverId });
    if (!del.length) throw new HttpError(404, 'Položka rozpisu neexistuje');
    audit('schedule.deleted', `Rozpis #${req.params.id} zmazaný – ${who(req)}`, {
      scheduleId: Number(req.params.id),
      driverId: del[0].driverId,
      ...byFields(req),
    });
    emitDriver(del[0].driverId, 'schedule:updated', null);
    return { ok: true };
  });
}

const fmtRange = (a: Date, b: Date) => {
  const f = (d: Date) =>
    d.toLocaleString('sk-SK', {
      timeZone: 'Europe/Bratislava',
      day: 'numeric',
      month: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  return `${f(a)} – ${f(b)}`;
};

export { openShiftOf };
