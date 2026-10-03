import bcrypt from 'bcryptjs';
import { and, asc, count, eq, ne, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DISPATCH, requireRole } from '../auth.js';
import { db } from '../db/index.js';
import { type Role, rides, type User, users, vehicles } from '../db/schema.js';
import { HttpError, num, str } from '../util.js';

const ROLES: Role[] = ['admin', 'dispatcher', 'driver'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  const admin = { preHandler: requireRole('admin') };

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
        vehicleId: role === 'driver' ? (num(b, 'vehicleId', false) ?? null) : null,
      })
      .returning();
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
    if ('vehicleId' in b) patch.vehicleId = num(b, 'vehicleId', false) ?? null;
    if ('role' in b) {
      const role = str(b, 'role') as Role;
      if (!ROLES.includes(role)) throw new HttpError(400, 'Neplatná rola');
      patch.role = role;
      if (role !== 'driver') patch.vehicleId = null;
    }
    if ('password' in b && b.password) {
      const p = str(b, 'password')!;
      checkPassword(p);
      patch.passwordHash = await bcrypt.hash(p, 10);
    }
    if (id === req.user.id && (patch.active === false || (patch.role && patch.role !== 'admin'))) {
      throw new HttpError(400, 'Nemôžeš deaktivovať ani degradovať sám seba');
    }
    if (patch.active === false) patch.driverStatus = 'offline';
    const [u] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
    if (!u) throw new HttpError(404, 'Používateľ neexistuje');
    return publicUser(u);
  });

  app.delete<{ Params: { id: string } }>('/api/users/:id', admin, async (req) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw new HttpError(400, 'Nemôžeš zmazať sám seba');
    const [{ n }] = await db
      .select({ n: count() })
      .from(rides)
      .where(or(eq(rides.driverId, id), eq(rides.createdById, id)));
    if (Number(n) > 0) {
      throw new HttpError(409, 'Používateľ má jazdy v histórii – namiesto zmazania ho deaktivuj');
    }
    const del = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
    if (!del.length) throw new HttpError(404, 'Používateľ neexistuje');
    return { ok: true };
  });

  // ================= Autá =================
  app.get('/api/vehicles', { preHandler: requireRole(...DISPATCH) }, async () => {
    const rows = await db.select().from(vehicles).orderBy(asc(vehicles.callsign));
    const counts = await db.select({ id: rides.vehicleId, n: count() }).from(rides).groupBy(rides.vehicleId);
    const byId = new Map(counts.map((c) => [c.id, Number(c.n)]));
    return rows.map((v) => ({ ...v, rideCount: byId.get(v.id) ?? 0 }));
  });

  app.post('/api/vehicles', admin, async (req) => {
    const fields = vehicleFields((req.body ?? {}) as Body, false);
    await assertUniqueCallsign(fields.callsign!);
    const [v] = await db
      .insert(vehicles)
      .values(fields as typeof vehicles.$inferInsert)
      .returning();
    return v;
  });

  app.patch<{ Params: { id: string } }>('/api/vehicles/:id', admin, async (req) => {
    const id = Number(req.params.id);
    const fields = vehicleFields((req.body ?? {}) as Body, true);
    if (fields.callsign) await assertUniqueCallsign(fields.callsign, id);
    const [v] = await db.update(vehicles).set(fields).where(eq(vehicles.id, id)).returning();
    if (!v) throw new HttpError(404, 'Auto neexistuje');
    return v;
  });

  app.delete<{ Params: { id: string } }>('/api/vehicles/:id', admin, async (req) => {
    const id = Number(req.params.id);
    const [{ n }] = await db.select({ n: count() }).from(rides).where(eq(rides.vehicleId, id));
    if (Number(n) > 0)
      throw new HttpError(409, 'Auto má jazdy v histórii – namiesto zmazania ho vyraď (deaktivuj)');
    const del = await db.delete(vehicles).where(eq(vehicles.id, id)).returning({ id: vehicles.id });
    if (!del.length) throw new HttpError(404, 'Auto neexistuje');
    return { ok: true }; // vodičom s týmto autom sa vehicle_id nastaví na NULL (FK on delete set null)
  });
}
