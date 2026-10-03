import bcrypt from 'bcryptjs';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  ilike,
  inArray,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ADMIN, DISPATCH, requireRole } from '../auth.js';
import { db } from '../db/index.js';
import {
  auditLog,
  incidents,
  type Role,
  rides,
  shifts,
  type User,
  users,
  type Vehicle,
  vehicles,
} from '../db/schema.js';
import { audit, byFields, roleSk, who } from '../log.js';
import { HttpError, num, str } from '../util.js';
import { photoUrl } from './shifts.js';

const ROLES: Role[] = ['owner', 'admin', 'dispatcher', 'driver'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// všetky stĺpce auta okrem samotnej fotky (bytea)
const { photo: _photo, ...vehiclePublicCols } = getTableColumns(vehicles);
type VehicleRow = Omit<Vehicle, 'photo'>;
function publicVehicle(v: VehicleRow) {
  const { photoMime: _m, ...rest } = v;
  return { ...rest, photoUrl: photoUrl(v) };
}

export function publicUser(u: User) {
  const { passwordHash: _omit, ...rest } = u;
  return rest;
}

type Body = Record<string, unknown>;

function dateField(b: Body, key: string): string | null {
  const v = str(b, key, false);
  if (!v) return null;
  if (!DATE_RE.test(v)) throw new HttpError(400, `Pole "${key}" musí byť dátum RRRR-MM-DD`);
  return v;
}

function intField(b: Body, key: string, min: number, max: number): number | null {
  const v = num(b, key, false);
  if (v === undefined) return null;
  if (!Number.isInteger(v) || v < min || v > max)
    throw new HttpError(400, `Pole "${key}" musí byť ${min}–${max}`);
  return v;
}

/** Spoločné spracovanie polí auta pre POST aj PATCH (pri PATCH len polia, ktoré prišli). */
function vehicleFields(b: Body, partial: boolean) {
  const out: Partial<typeof vehicles.$inferInsert> = {};
  const has = (k: string) => !partial || k in b;
  if (has('callsign')) out.callsign = str(b, 'callsign')!;
  if (has('plate')) out.plate = str(b, 'plate')!.toUpperCase().replace(/\s+/g, '');
  if (has('model')) out.model = str(b, 'model')!;
  if (has('color')) out.color = str(b, 'color', false) ?? null;
  if (has('year')) out.year = intField(b, 'year', 1980, 2100);
  if (has('seats')) out.seats = intField(b, 'seats', 1, 20) ?? 4;
  if (has('bodyType')) out.bodyType = str(b, 'bodyType', false) ?? null;
  if (has('fuel')) out.fuel = str(b, 'fuel', false) ?? null;
  if (has('vin')) out.vin = str(b, 'vin', false)?.toUpperCase() ?? null;
  if (has('stkUntil')) out.stkUntil = dateField(b, 'stkUntil');
  if (has('ekUntil')) out.ekUntil = dateField(b, 'ekUntil');
  if (has('insuranceUntil')) out.insuranceUntil = dateField(b, 'insuranceUntil');
  if (has('note')) out.note = str(b, 'note', false) ?? null;
  if ('active' in b) out.active = Boolean(b.active);
  return out;
}

async function assertUniqueUsername(username: string, exceptId?: number) {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      exceptId ? and(eq(users.username, username), ne(users.id, exceptId)) : eq(users.username, username),
    );
  if (rows.length) throw new HttpError(409, 'Používateľ s týmto loginom už existuje');
}

async function assertUniqueCallsign(callsign: string, exceptId?: number) {
  const rows = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(
      exceptId
        ? and(eq(vehicles.callsign, callsign), ne(vehicles.id, exceptId))
        : eq(vehicles.callsign, callsign),
    );
  if (rows.length) throw new HttpError(409, `Auto s číslom ${callsign} už existuje`);
}

function checkPassword(p: string) {
  if (p.length < 8) throw new HttpError(400, 'Heslo musí mať aspoň 8 znakov');
}

export async function adminRoutes(app: FastifyInstance) {
  const admin = { preHandler: requireRole(...ADMIN) };

  // ================= Používatelia (vodiči, dispečeri, admini) =================
  app.get('/api/users', admin, async () => {
    const rows = await db.select().from(users).orderBy(asc(users.role), asc(users.name));
    const counts = await db.select({ id: rides.driverId, n: count() }).from(rides).groupBy(rides.driverId);
    const byId = new Map(counts.map((c) => [c.id, Number(c.n)]));
    return rows.map((u) => ({ ...publicUser(u), rideCount: byId.get(u.id) ?? 0 }));
  });

  app.post('/api/users', admin, async (req) => {
    const b = (req.body ?? {}) as Body;
    const role = str(b, 'role') as Role;
    if (!ROLES.includes(role)) throw new HttpError(400, 'Neplatná rola');
    const password = str(b, 'password')!;
    checkPassword(password);
    const username = str(b, 'username')!.toLowerCase();
    await assertUniqueUsername(username);
    const [u] = await db
      .insert(users)
      .values({
        username,
        passwordHash: await bcrypt.hash(password, 10),
        name: str(b, 'name')!,
        phone: str(b, 'phone', false) ?? null,
        email: str(b, 'email', false) ?? null,
        note: str(b, 'note', false) ?? null,
        role,
      })
      .returning();
    audit(
      'user.created',
      `Používateľ ${u.name} (${roleSk(u.role)}, @${u.username}) vytvorený – ${who(req)}`,
      {
        userId: u.id,
        role: u.role,
        ...byFields(req),
      },
    );
    return publicUser(u);
  });

  app.patch<{ Params: { id: string } }>('/api/users/:id', admin, async (req) => {
    const b = (req.body ?? {}) as Body;
    const id = Number(req.params.id);
    const patch: Partial<typeof users.$inferInsert> = {};
    if ('name' in b) patch.name = str(b, 'name')!;
    if ('username' in b) {
      patch.username = str(b, 'username')!.toLowerCase();
      await assertUniqueUsername(patch.username, id);
    }
    if ('phone' in b) patch.phone = str(b, 'phone', false) ?? null;
    if ('email' in b) patch.email = str(b, 'email', false) ?? null;
    if ('note' in b) patch.note = str(b, 'note', false) ?? null;
    if ('active' in b) patch.active = Boolean(b.active);
    // auto sa vodičovi nepriraďuje tu – vyberá si ho sám pri začatí smeny
    if ('role' in b) {
      const role = str(b, 'role') as Role;
      if (!ROLES.includes(role)) throw new HttpError(400, 'Neplatná rola');
      patch.role = role;
    }
    if ('password' in b && b.password) {
      const p = str(b, 'password')!;
      checkPassword(p);
      patch.passwordHash = await bcrypt.hash(p, 10);
    }
    if (id === req.user.id && (patch.active === false || (patch.role && !ADMIN.includes(patch.role)))) {
      throw new HttpError(400, 'Nemôžeš deaktivovať ani degradovať sám seba');
    }
    if (patch.active === false) patch.driverStatus = 'offline';
    const [u] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
    if (!u) throw new HttpError(404, 'Používateľ neexistuje');
    const changed = Object.keys(patch)
      .filter((k) => k !== 'driverStatus')
      .map((k) => (k === 'passwordHash' ? 'password' : k));
    audit(
      'user.updated',
      `Používateľ ${u.name} upravený (${changed.join(', ')})${patch.active === false ? ' – DEAKTIVOVANÝ' : patch.active === true ? ' – aktivovaný' : ''} – ${who(req)}`,
      { userId: id, changes: changed, ...byFields(req) },
    );
    return publicUser(u);
  });

  app.delete<{ Params: { id: string } }>('/api/users/:id', admin, async (req) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw new HttpError(400, 'Nemôžeš zmazať sám seba');
    const [{ n }] = await db
      .select({ n: count() })
      .from(rides)
      .where(or(eq(rides.driverId, id), eq(rides.createdById, id)));
    const [{ m }] = await db.select({ m: count() }).from(shifts).where(eq(shifts.driverId, id));
    const [{ k }] = await db.select({ k: count() }).from(incidents).where(eq(incidents.driverId, id));
    if (Number(n) + Number(m) + Number(k) > 0) {
      throw new HttpError(409, 'Používateľ má jazdy alebo smeny v histórii – namiesto zmazania ho deaktivuj');
    }
    const del = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id, name: users.name });
    if (!del.length) throw new HttpError(404, 'Používateľ neexistuje');
    audit('user.deleted', `Používateľ ${del[0].name} (#${id}) zmazaný – ${who(req)}`, {
      userId: id,
      ...byFields(req),
    });
    return { ok: true };
  });

  // ================= Autá =================
  app.get('/api/vehicles', { preHandler: requireRole(...DISPATCH) }, async () => {
    const rows = await db.select(vehiclePublicCols).from(vehicles).orderBy(asc(vehicles.callsign));
    const counts = await db.select({ id: rides.vehicleId, n: count() }).from(rides).groupBy(rides.vehicleId);
    const byId = new Map(counts.map((c) => [c.id, Number(c.n)]));
    const sc = await db.select({ id: shifts.vehicleId, n: count() }).from(shifts).groupBy(shifts.vehicleId);
    const shiftsById = new Map(sc.map((c) => [c.id, Number(c.n)]));
    return rows.map((v) => ({
      ...publicVehicle(v),
      rideCount: byId.get(v.id) ?? 0,
      shiftCount: shiftsById.get(v.id) ?? 0,
    }));
  });

  // ---- fotka auta: prehliadač ju zmenší a pošle ako data URL (JPEG/WebP/PNG, max ~4 MB) ----
  app.put<{ Params: { id: string } }>(
    '/api/vehicles/:id/photo',
    { ...admin, bodyLimit: 6 * 1024 * 1024 },
    async (req) => {
      const dataUrl = str((req.body ?? {}) as Body, 'dataUrl')!;
      const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
      if (!m) throw new HttpError(400, 'Fotka musí byť JPEG, PNG alebo WebP');
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 4 * 1024 * 1024) throw new HttpError(400, 'Fotka je príliš veľká (max 4 MB)');
      const [v] = await db
        .update(vehicles)
        .set({ photo: buf, photoMime: m[1], photoUpdatedAt: new Date() })
        .where(eq(vehicles.id, Number(req.params.id)))
        .returning(vehiclePublicCols);
      if (!v) throw new HttpError(404, 'Auto neexistuje');
      audit(
        'vehicle.photo',
        `Auto ${v.callsign}: nová fotka (${Math.round(buf.length / 1024)} kB) – ${who(req)}`,
        {
          vehicleId: v.id,
          ...byFields(req),
        },
      );
      return publicVehicle(v);
    },
  );

  app.delete<{ Params: { id: string } }>('/api/vehicles/:id/photo', admin, async (req) => {
    const [v] = await db
      .update(vehicles)
      .set({ photo: null, photoMime: null, photoUpdatedAt: null })
      .where(eq(vehicles.id, Number(req.params.id)))
      .returning(vehiclePublicCols);
    if (!v) throw new HttpError(404, 'Auto neexistuje');
    audit('vehicle.photo_deleted', `Auto ${v.callsign}: fotka zmazaná – ${who(req)}`, {
      vehicleId: v.id,
      ...byFields(req),
    });
    return publicVehicle(v);
  });

  // fotka je verejná (načítava ju <img>, ktorý neposiela token); URL obsahuje verziu → dlhá cache
  app.get<{ Params: { id: string } }>('/api/vehicles/:id/photo', async (req, reply) => {
    const [v] = await db
      .select({ photo: vehicles.photo, mime: vehicles.photoMime })
      .from(vehicles)
      .where(eq(vehicles.id, Number(req.params.id)));
    if (!v?.photo) return reply.code(404).send({ error: 'Auto nemá fotku' });
    return reply
      .header('Content-Type', v.mime ?? 'image/jpeg')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(v.photo);
  });

  app.post('/api/vehicles', admin, async (req) => {
    const fields = vehicleFields((req.body ?? {}) as Body, false);
    await assertUniqueCallsign(fields.callsign!);
    const [v] = await db
      .insert(vehicles)
      .values(fields as typeof vehicles.$inferInsert)
      .returning(vehiclePublicCols);
    audit('vehicle.created', `Auto ${v.callsign} (${v.plate}) pridané – ${who(req)}`, {
      vehicleId: v.id,
      ...byFields(req),
    });
    return publicVehicle(v);
  });

  app.patch<{ Params: { id: string } }>('/api/vehicles/:id', admin, async (req) => {
    const id = Number(req.params.id);
    const fields = vehicleFields((req.body ?? {}) as Body, true);
    if (fields.callsign) await assertUniqueCallsign(fields.callsign, id);
    const [v] = await db.update(vehicles).set(fields).where(eq(vehicles.id, id)).returning(vehiclePublicCols);
    if (!v) throw new HttpError(404, 'Auto neexistuje');
    audit(
      'vehicle.updated',
      `Auto ${v.callsign} upravené (${Object.keys(fields).join(', ')}) – ${who(req)}`,
      {
        vehicleId: id,
        changes: Object.keys(fields),
        ...byFields(req),
      },
    );
    return publicVehicle(v);
  });

  app.delete<{ Params: { id: string } }>('/api/vehicles/:id', admin, async (req) => {
    const id = Number(req.params.id);
    const [{ n }] = await db.select({ n: count() }).from(rides).where(eq(rides.vehicleId, id));
    const [{ m }] = await db.select({ m: count() }).from(shifts).where(eq(shifts.vehicleId, id));
    if (Number(n) + Number(m) > 0)
      throw new HttpError(409, 'Auto má jazdy v histórii – namiesto zmazania ho vyraď (deaktivuj)');
    const del = await db
      .delete(vehicles)
      .where(eq(vehicles.id, id))
      .returning({ id: vehicles.id, callsign: vehicles.callsign });
    if (!del.length) throw new HttpError(404, 'Auto neexistuje');
    audit('vehicle.deleted', `Auto ${del[0].callsign} (#${id}) zmazané – ${who(req)}`, {
      vehicleId: id,
      ...byFields(req),
    });
    return { ok: true }; // vodičom s týmto autom sa vehicle_id nastaví na NULL (FK on delete set null)
  });

  // ================= Logy (audit_log) =================
  // kategória → prefixy udalostí
  const LOG_CATS: Record<string, string[]> = {
    rides: ['ride.'],
    incidents: ['incident.'],
    shifts: ['shift.', 'schedule.', 'driver.'],
    access: ['auth.', 'socket.'],
    admin: ['user.', 'vehicle.'],
    system: ['server.', 'push.', 'osrm.', 'geocoder.', 'estimate.', 'reminder.', 'http.'],
  };
  app.get<{
    Querystring: { level?: string; cat?: string; q?: string; before?: string; limit?: string; days?: string };
  }>('/api/logs', admin, async (req) => {
    const { level, cat, q, before } = req.query;
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const where: SQL[] = [];
    if (level === 'problems') where.push(inArray(auditLog.level, ['warn', 'error']));
    else if (level === 'info' || level === 'warn' || level === 'error') where.push(eq(auditLog.level, level));
    if (cat && LOG_CATS[cat]) {
      where.push(or(...LOG_CATS[cat].map((p) => ilike(auditLog.evt, `${p}%`)))!);
    }
    if (q?.trim()) {
      const like = `%${q.trim()}%`;
      where.push(or(ilike(auditLog.msg, like), ilike(auditLog.evt, like), ilike(users.name, like))!);
    }
    const days = Number(req.query.days);
    if (days > 0) where.push(gte(auditLog.at, new Date(Date.now() - days * 86400_000)));
    if (before) where.push(lt(auditLog.id, Number(before)));
    const rows = await db
      .select({
        id: auditLog.id,
        at: auditLog.at,
        level: auditLog.level,
        evt: auditLog.evt,
        msg: auditLog.msg,
        userId: auditLog.userId,
        userName: users.name,
        userRole: users.role,
        fields: auditLog.fields,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(auditLog.id))
      .limit(limit + 1);
    const [{ problems }] = await db
      .select({ problems: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(
        and(inArray(auditLog.level, ['warn', 'error']), gte(auditLog.at, new Date(Date.now() - 86400_000))),
      );
    return { rows: rows.slice(0, limit), hasMore: rows.length > limit, problems24h: problems };
  });
}
