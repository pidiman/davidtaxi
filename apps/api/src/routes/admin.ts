import bcrypt from 'bcryptjs';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DISPATCH, requireRole } from '../auth.js';
import { db } from '../db/index.js';
import { type Role, type User, users, vehicles } from '../db/schema.js';
import { HttpError, num, str } from '../util.js';

const ROLES: Role[] = ['admin', 'dispatcher', 'driver'];

export function publicUser(u: User) {
  const { passwordHash: _omit, ...rest } = u;
  return rest;
}

export async function adminRoutes(app: FastifyInstance) {
  const admin = { preHandler: requireRole('admin') };

  // ---- Používatelia (admin vytvára dispečerov a šoférov) ----
  app.get('/api/users', admin, async () => {
    const rows = await db.select().from(users).orderBy(asc(users.role), asc(users.name));
    return rows.map(publicUser);
  });

  app.post('/api/users', admin, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const role = str(b, 'role') as Role;
    if (!ROLES.includes(role)) throw new HttpError(400, 'Neplatná rola');
    const password = str(b, 'password')!;
    if (password.length < 8) throw new HttpError(400, 'Heslo musí mať aspoň 8 znakov');
    const username = str(b, 'username')!.toLowerCase();
    const exists = await db.select({ id: users.id }).from(users).where(eq(users.username, username));
    if (exists.length) throw new HttpError(409, 'Používateľ s týmto menom už existuje');
    const [u] = await db
      .insert(users)
      .values({
        username,
        passwordHash: await bcrypt.hash(password, 10),
        name: str(b, 'name')!,
        phone: str(b, 'phone', false) ?? null,
        role,
        vehicleId: num(b, 'vehicleId', false) ?? null,
      })
      .returning();
    return publicUser(u);
  });

  app.patch<{ Params: { id: string } }>('/api/users/:id', admin, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<typeof users.$inferInsert> = {};
    if ('name' in b) patch.name = str(b, 'name')!;
    if ('phone' in b) patch.phone = str(b, 'phone', false) ?? null;
    if ('active' in b) patch.active = Boolean(b.active);
    if ('vehicleId' in b) patch.vehicleId = num(b, 'vehicleId', false) ?? null;
    if ('role' in b) {
      const role = str(b, 'role') as Role;
      if (!ROLES.includes(role)) throw new HttpError(400, 'Neplatná rola');
      patch.role = role;
    }
    if ('password' in b && b.password) {
      const p = str(b, 'password')!;
      if (p.length < 8) throw new HttpError(400, 'Heslo musí mať aspoň 8 znakov');
      patch.passwordHash = await bcrypt.hash(p, 10);
    }
    const id = Number(req.params.id);
    if (id === req.user.id && (patch.active === false || (patch.role && patch.role !== 'admin'))) {
      throw new HttpError(400, 'Nemôžeš deaktivovať ani degradovať sám seba');
    }
    const [u] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
    if (!u) throw new HttpError(404, 'Používateľ neexistuje');
    return publicUser(u);
  });

  // ---- Autá ----
  app.get('/api/vehicles', { preHandler: requireRole(...DISPATCH) }, async () =>
    db.select().from(vehicles).orderBy(asc(vehicles.callsign)),
  );

  app.post('/api/vehicles', admin, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const [v] = await db
      .insert(vehicles)
      .values({
        callsign: str(b, 'callsign')!,
        plate: str(b, 'plate')!.toUpperCase(),
        model: str(b, 'model')!,
      })
      .returning();
    return v;
  });

  app.patch<{ Params: { id: string } }>('/api/vehicles/:id', admin, async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<typeof vehicles.$inferInsert> = {};
    if ('callsign' in b) patch.callsign = str(b, 'callsign')!;
    if ('plate' in b) patch.plate = str(b, 'plate')!.toUpperCase();
    if ('model' in b) patch.model = str(b, 'model')!;
    if ('active' in b) patch.active = Boolean(b.active);
    const [v] = await db
      .update(vehicles)
      .set(patch)
      .where(eq(vehicles.id, Number(req.params.id)))
      .returning();
    if (!v) throw new HttpError(404, 'Auto neexistuje');
    return v;
  });
}
