import { randomBytes } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DISPATCH, requireRole } from '../auth.js';
import { db } from '../db/index.js';
import { incidentPhotos, incidents, rides, shifts, users, vehicles } from '../db/schema.js';
import { audit, byFields, who } from '../log.js';
import { emitDispatch } from '../realtime.js';
import { HttpError, num, str } from '../util.js';

const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
type Body = Record<string, unknown>;

/** Smena, ku ktorej sa incident viaže: otvorená, inak posledná (incident sa dá nahlásiť aj neskôr). */
async function contextShift(driverId: number) {
  const [s] = await db
    .select({
      id: shifts.id,
      vehicleId: shifts.vehicleId,
      vehicleCallsign: vehicles.callsign,
      startedAt: shifts.startedAt,
      endedAt: shifts.endedAt,
    })
    .from(shifts)
    .leftJoin(vehicles, eq(vehicles.id, shifts.vehicleId))
    .where(eq(shifts.driverId, driverId))
    .orderBy(desc(shifts.startedAt)) // otvorená smena je vždy tá posledná
    .limit(1);
  return s ?? null;
}

async function shiftRides(driverId: number, shift: { startedAt: Date; endedAt: Date | null }) {
  const where: SQL[] = [
    eq(rides.driverId, driverId),
    isNotNull(rides.assignedAt),
    gte(rides.assignedAt, shift.startedAt),
  ];
  if (shift.endedAt) where.push(lte(rides.assignedAt, shift.endedAt));
  return db
    .select({
      id: rides.id,
      status: rides.status,
      source: rides.source,
      customerName: rides.customerName,
      pickupAddress: rides.pickupAddress,
      dropoffAddress: rides.dropoffAddress,
      assignedAt: rides.assignedAt,
      startedAt: rides.startedAt,
      finishedAt: rides.finishedAt,
      price: rides.price,
    })
    .from(rides)
    .where(and(...where))
    .orderBy(desc(rides.assignedAt));
}

const incidentSelect = {
  id: incidents.id,
  description: incidents.description,
  createdAt: incidents.createdAt,
  resolvedAt: incidents.resolvedAt,
  resolutionNote: incidents.resolutionNote,
  driverId: incidents.driverId,
  driverName: users.name,
  vehicleId: incidents.vehicleId,
  vehicleCallsign: vehicles.callsign,
  vehiclePlate: vehicles.plate,
  shiftId: incidents.shiftId,
  rideId: incidents.rideId,
  rideCustomer: rides.customerName,
  ridePickup: rides.pickupAddress,
  rideDropoff: rides.dropoffAddress,
  rideAt: rides.assignedAt,
};

async function withPhotos<T extends { id: number }>(rows: T[]) {
  if (!rows.length) return rows.map((r) => ({ ...r, photos: [] as string[] }));
  const ph = await db
    .select({ incidentId: incidentPhotos.incidentId, key: incidentPhotos.key })
    .from(incidentPhotos)
    .where(
      inArray(
        incidentPhotos.incidentId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(incidentPhotos.id);
  return rows.map((r) => ({
    ...r,
    photos: ph.filter((p) => p.incidentId === r.id).map((p) => `/api/incident-photos/${p.key}`),
  }));
}

function incidentQuery() {
  return db
    .select(incidentSelect)
    .from(incidents)
    .innerJoin(users, eq(users.id, incidents.driverId))
    .leftJoin(vehicles, eq(vehicles.id, incidents.vehicleId))
    .leftJoin(rides, eq(rides.id, incidents.rideId));
}

export async function incidentRoutes(app: FastifyInstance) {
  const driver = { preHandler: requireRole('driver') };
  const dispatch = { preHandler: requireRole(...DISPATCH) };

  // ================= Vodič =================
  /** Podklady pre formulár: smena a jej jazdy + incidenty, ktoré už k nej nahlásil. */
  app.get('/api/driver/incidents/context', driver, async (req) => {
    const shift = await contextShift(req.user.id);
    if (!shift) return { shift: null, rides: [], incidents: [] };
    const [rideRows, mine] = await Promise.all([
      shiftRides(req.user.id, shift),
      incidentQuery()
        .where(and(eq(incidents.driverId, req.user.id), eq(incidents.shiftId, shift.id)))
        .orderBy(desc(incidents.createdAt)),
    ]);
    return { shift, rides: rideRows, incidents: await withPhotos(mine) };
  });

  app.post('/api/driver/incidents', { ...driver, bodyLimit: 32 * 1024 * 1024 }, async (req) => {
    const b = (req.body ?? {}) as Body;
    const description = str(b, 'description')!;
    if (description.length > 4000) throw new HttpError(400, 'Popis je príliš dlhý (max 4000 znakov)');
    const rideId = num(b, 'rideId', false) ?? null;
    const rawPhotos = Array.isArray(b.photos) ? (b.photos as unknown[]) : [];
    if (rawPhotos.length > MAX_PHOTOS) throw new HttpError(400, `Najviac ${MAX_PHOTOS} fotiek`);
    const photos = rawPhotos.map((p) => {
      const m = typeof p === 'string' ? /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(p) : null;
      if (!m) throw new HttpError(400, 'Fotka musí byť JPEG, PNG alebo WebP');
      const data = Buffer.from(m[2], 'base64');
      if (data.length > MAX_PHOTO_BYTES) throw new HttpError(400, 'Fotka je príliš veľká (max 4 MB)');
      return { mime: m[1], data };
    });

    const shift = await contextShift(req.user.id);
    let vehicleId = shift?.vehicleId ?? null;
    if (rideId !== null) {
      const [r] = await db.select().from(rides).where(eq(rides.id, rideId));
      if (!r || r.driverId !== req.user.id) throw new HttpError(400, 'Jazda nepatrí tebe');
      vehicleId = r.vehicleId ?? vehicleId;
    }

    const id = await db.transaction(async (tx) => {
      const [inc] = await tx
        .insert(incidents)
        .values({ driverId: req.user.id, vehicleId, shiftId: shift?.id ?? null, rideId, description })
        .returning({ id: incidents.id });
      if (photos.length) {
        await tx.insert(incidentPhotos).values(
          photos.map((p) => ({
            incidentId: inc.id,
            key: randomBytes(16).toString('hex'),
            mime: p.mime,
            data: p.data,
          })),
        );
      }
      return inc.id;
    });

    audit(
      'incident.reported',
      `Incident #${id} – ${req.user.name}${shift?.vehicleCallsign ? `, auto ${shift.vehicleCallsign}` : ''}${rideId ? `, jazda #${rideId}` : ''}${photos.length ? `, ${photos.length} foto` : ''}`,
      {
        incidentId: id,
        driverId: req.user.id,
        rideId: rideId ?? undefined,
        vehicleId,
        photos: photos.length,
      },
    );
    const [view] = await withPhotos(await incidentQuery().where(eq(incidents.id, id)));
    emitDispatch('incident:new', view);
    return view;
  });

  // ================= Dispečing =================
  app.get<{ Querystring: { status?: string } }>('/api/incidents', dispatch, async (req) => {
    const st = req.query.status;
    const where =
      st === 'open'
        ? isNull(incidents.resolvedAt)
        : st === 'resolved'
          ? isNotNull(incidents.resolvedAt)
          : undefined;
    const rows = await incidentQuery().where(where).orderBy(desc(incidents.createdAt)).limit(300);
    return withPhotos(rows);
  });

  app.get('/api/incidents/open-count', dispatch, async () => {
    const rows = await db.select({ id: incidents.id }).from(incidents).where(isNull(incidents.resolvedAt));
    return { open: rows.length };
  });

  app.patch<{ Params: { id: string } }>('/api/incidents/:id', dispatch, async (req) => {
    const b = (req.body ?? {}) as Body;
    const id = Number(req.params.id);
    const resolved = b.resolved === true;
    const [upd] = await db
      .update(incidents)
      .set(
        resolved
          ? {
              resolvedAt: new Date(),
              resolvedById: req.user.id,
              resolutionNote: str(b, 'note', false) ?? null,
            }
          : { resolvedAt: null, resolvedById: null, resolutionNote: null },
      )
      .where(eq(incidents.id, id))
      .returning({ id: incidents.id });
    if (!upd) throw new HttpError(404, 'Incident neexistuje');
    audit(
      resolved ? 'incident.resolved' : 'incident.reopened',
      `Incident #${id} ${resolved ? 'vyriešený' : 'znovu otvorený'} – ${who(req)}`,
      { incidentId: id, ...byFields(req) },
    );
    const [view] = await withPhotos(await incidentQuery().where(eq(incidents.id, id)));
    emitDispatch('incident:updated', view);
    return view;
  });

  // fotka – náhodný 128-bit kľúč v URL, takže sa nedá uhádnuť; img tag neposiela token
  app.get<{ Params: { key: string } }>('/api/incident-photos/:key', async (req, reply) => {
    if (!/^[0-9a-f]{32}$/.test(req.params.key)) return reply.code(404).send({ error: 'Nenájdené' });
    const [p] = await db
      .select({ data: incidentPhotos.data, mime: incidentPhotos.mime })
      .from(incidentPhotos)
      .where(eq(incidentPhotos.key, req.params.key));
    if (!p) return reply.code(404).send({ error: 'Nenájdené' });
    return reply
      .header('Content-Type', p.mime)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(p.data);
  });
}
