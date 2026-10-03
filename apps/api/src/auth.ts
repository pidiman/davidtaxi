import jwt from '@fastify/jwt';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from './db/index.js';
import { type Role, users } from './db/schema.js';
import { env } from './env.js';

export type TokenUser = { id: number; role: Role; name: string };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: TokenUser;
    user: TokenUser;
  }
}

export async function registerAuth(app: FastifyInstance) {
  await app.register(jwt, { secret: env.jwtSecret, sign: { expiresIn: '30d' } });
}

async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Neprihlásený' });
  }
  // deaktivovaný účet = okamžite bez prístupu, aj s platným tokenom
  const [u] = await db.select({ active: users.active }).from(users).where(eq(users.id, req.user.id));
  if (!u?.active) return reply.code(401).send({ error: 'Účet je deaktivovaný' });
}

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await authenticate(req, reply);
    if (reply.sent) return;
    if (!roles.includes(req.user.role)) return reply.code(403).send({ error: 'Nemáš oprávnenie' });
  };
}

export const DISPATCH: Role[] = ['admin', 'dispatcher'];
