import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireRole } from '../auth.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { str } from '../util.js';
import { publicUser } from './admin.js';

// jednoduchá ochrana proti hádaniu hesiel: max 10 neúspešných pokusov / 15 min / IP
const failures = new Map<string, { count: number; until: number }>();
const WINDOW_MS = 15 * 60 * 1000;

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    const ip = req.ip;
    const f = failures.get(ip);
    if (f && f.until > Date.now() && f.count >= 10) {
      return reply.code(429).send({ error: 'Príliš veľa pokusov, skús o 15 minút' });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = str(body, 'username')!.toLowerCase();
    const password = str(body, 'password')!;
    const [u] = await db.select().from(users).where(eq(users.username, username));
    if (!u || !u.active || !(await bcrypt.compare(password, u.passwordHash))) {
      const cur = f && f.until > Date.now() ? f : { count: 0, until: Date.now() + WINDOW_MS };
      cur.count++;
      failures.set(ip, cur);
      return reply.code(401).send({ error: 'Nesprávne meno alebo heslo' });
    }
    failures.delete(ip);
    const token = app.jwt.sign({ id: u.id, role: u.role, name: u.name });
    return { token, user: publicUser(u) };
  });

  app.get('/api/auth/me', { preHandler: requireRole('admin', 'dispatcher', 'driver') }, async (req) => {
    const [u] = await db.select().from(users).where(eq(users.id, req.user.id));
    return publicUser(u);
  });
}
