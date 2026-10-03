import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import bcrypt from 'bcryptjs';
import { count } from 'drizzle-orm';
import Fastify from 'fastify';
import { registerAuth } from './auth.js';
import { db, runMigrations } from './db/index.js';
import { users } from './db/schema.js';
import { env } from './env.js';
import { backfillEstimates } from './estimate.js';
import { initLog } from './log.js';
import { pushEnabled } from './push.js';
import { attachRealtime } from './realtime.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { miscRoutes } from './routes/misc.js';
import { rideRoutes, startAssignReminders } from './routes/rides.js';
import { shiftRoutes } from './routes/shifts.js';
import { HttpError } from './util.js';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  trustProxy: true,
  // vlastný jeden riadok na request (nižšie) namiesto dvoch defaultných
  disableRequestLogging: true,
});
initLog(app.log);

declare module 'fastify' {
  interface FastifyRequest {
    errorMsg?: string;
  }
}

app.setErrorHandler((err, req, reply) => {
  if (err instanceof HttpError) {
    req.errorMsg = err.message;
    return reply.code(err.statusCode).send({ error: err.message });
  }
  const status = (err as { statusCode?: number }).statusCode;
  if (status && status < 500) {
    req.errorMsg = (err as Error).message;
    return reply.code(status).send({ error: (err as Error).message });
  }
  req.log.error(err);
  return reply.code(500).send({ error: 'Interná chyba servera' });
});

/**
 * Log requestov:
 *  - chyby (4xx warn, 5xx error) vždy, s dôvodom,
 *  - úspešné requesty len na úrovni debug (LOG_LEVEL=debug) – zmeny pokrývajú audit udalosti,
 *  - GPS polohy, health check, statické súbory a socket.io sa nelogujú vôbec (okrem 5xx).
 */
const QUIET = ['/api/driver/location', '/api/health'];
app.addHook('onResponse', async (req, reply) => {
  // bez query (?q=adresa, ?lat=…) – adresy a súradnice zákazníkov nepatria do logov
  const url = req.url.split('?')[0];
  const status = reply.statusCode;
  const quiet = !url.startsWith('/api/') || QUIET.some((p) => url.startsWith(p));
  if (quiet && status < 500) return;
  const line = {
    method: req.method,
    url,
    status,
    ms: Math.round(reply.elapsedTime),
    ip: req.ip,
    ...(req.user ? { userId: req.user.id, role: req.user.role } : {}),
    ...(req.errorMsg ? { reason: req.errorMsg } : {}),
  };
  const msg = `${req.method} ${url} → ${status}${req.errorMsg ? ` (${req.errorMsg})` : ''}`;
  if (status >= 500) req.log.error(line, msg);
  else if (status >= 400) req.log.warn(line, msg);
  else req.log.debug(line, msg);
});

await registerAuth(app);
await app.register(authRoutes);
await app.register(adminRoutes);
await app.register(rideRoutes);
await app.register(shiftRoutes);
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
backfillEstimates((m) => app.log.info(m)).catch((e) => app.log.warn({ err: e }, 'backfill odhadov zlyhal'));
if (!pushEnabled) app.log.warn({ evt: 'push.disabled' }, 'Chýbajú VAPID kľúče – push notifikácie sú vypnuté');
app.log.info(
  { evt: 'server.start', port: env.port, logLevel: app.log.level },
  `Server beží na porte ${env.port}`,
);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    app.log.info({ evt: 'server.stop', signal: sig }, 'Server sa vypína');
    await app.close();
    process.exit(0);
  });
}
