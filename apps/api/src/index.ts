import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import bcrypt from 'bcryptjs';
import { count } from 'drizzle-orm';
import Fastify from 'fastify';
import { registerAuth } from './auth.js';
import { db, runMigrations } from './db/index.js';
import { users } from './db/schema.js';
import { env } from './env.js';
import { attachRealtime } from './realtime.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { miscRoutes } from './routes/misc.js';
import { rideRoutes, startAssignReminders } from './routes/rides.js';
import { HttpError } from './util.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: true });

app.setErrorHandler((err, req, reply) => {
  if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
  const status = (err as { statusCode?: number }).statusCode;
  if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
  req.log.error(err);
  return reply.code(500).send({ error: 'Interná chyba servera' });
});

await registerAuth(app);
await app.register(authRoutes);
await app.register(adminRoutes);
await app.register(rideRoutes);
await app.register(miscRoutes);

// Frontend (dashboard + PWA) – rovnaký origin ako API, takže netreba CORS
if (existsSync(env.webDist)) {
  await app.register(fastifyStatic, {
    root: env.webDist,
    wildcard: false,
    setHeaders(res, path) {
      // service worker a manifest nesmú byť cachované, inak sa PWA neaktualizuje
      if (path.endsWith('sw.js') || path.endsWith('.webmanifest') || path.endsWith('index.html')) {
        res.header('Cache-Control', 'no-cache');
      } else if (path.includes('/assets/')) {
        res.header('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/socket.io')) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Nenájdené' });
  });
} else {
  app.log.warn(`Frontend build nenájdený v ${env.webDist} – beží len API`);
}

async function seedAdmin() {
  const [{ n }] = await db.select({ n: count() }).from(users);
  if (n > 0) return;
  if (!env.adminPassword || env.adminPassword.length < 8) {
    throw new Error('Databáza je prázdna: nastav ADMIN_PASSWORD (min. 8 znakov) pre prvého admina');
  }
  await db.insert(users).values({
    username: env.adminUsername.toLowerCase(),
    passwordHash: await bcrypt.hash(env.adminPassword, 10),
    name: 'Administrátor',
    role: 'admin',
  });
  app.log.info(`Vytvorený prvý admin "${env.adminUsername}"`);
}

await runMigrations();
await seedAdmin();
attachRealtime(app);
startAssignReminders();
await app.listen({ host: '0.0.0.0', port: env.port });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
