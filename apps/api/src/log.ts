import { lt } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import { db } from './db/index.js';
import { auditLog } from './db/schema.js';

/**
 * Udalosti idú na dve miesta:
 *  - stdout (Docker logy) cez pino,
 *  - tabuľka audit_log → Admin → Logy (uchováva sa LOG_RETENTION_DAYS, predvolene 90 dní).
 */
let base: FastifyBaseLogger | null = null;
export function initLog(l: FastifyBaseLogger) {
  base = l;
}

type Level = 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

function persist(level: Level, evt: string, msg: string, fields: Fields) {
  // kto akciu urobil: dispečer/admin (byId), inak vodič alebo prihlásený používateľ
  const actor = fields.byId ?? fields.driverId ?? fields.userId;
  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  db.insert(auditLog)
    .values({
      level,
      evt,
      msg,
      userId: typeof actor === 'number' ? actor : null,
      fields: Object.keys(clean).length ? clean : null,
    })
    .catch((err) => base?.error({ err }, 'zápis do audit_log zlyhal'));
}

export function record(level: Level, evt: string, msg: string, fields: Fields = {}) {
  if (base) base[level]({ evt, ...fields }, msg);
  else console.log(JSON.stringify({ level, evt, ...fields, msg }));
  persist(level, evt, msg, fields);
}

/** Biznis udalosť (napr. ride.assigned). Mená/adresy zákazníkov sa NElogujú – len ID. */
export const audit = (evt: string, msg: string, fields: Fields = {}) => record('info', evt, msg, fields);

/** Problém s externou službou / doručením – appka beží ďalej, ale treba o ňom vedieť. */
export const warn = (evt: string, msg: string, fields: Fields = {}) => record('warn', evt, msg, fields);

export const ROLE_SK: Record<string, string> = {
  owner: 'majiteľ',
  admin: 'admin',
  dispatcher: 'dispečer',
  driver: 'vodič',
};
export const roleSk = (r: string) => ROLE_SK[r] ?? r;

/** Kto akciu urobil – meno a rola z JWT. */
export function who(req: FastifyRequest) {
  const u = req.user;
  return u ? `${u.name} (${roleSk(u.role)})` : 'anonym';
}
export function byFields(req: FastifyRequest) {
  return req.user ? { byId: req.user.id, byRole: req.user.role } : {};
}

/** Raz denne zmaže staré záznamy z audit_log. */
export function startLogRetention() {
  const days = Number(process.env.LOG_RETENTION_DAYS ?? 90);
  const run = () =>
    db
      .delete(auditLog)
      .where(lt(auditLog.at, new Date(Date.now() - days * 86400_000)))
      .catch((err) => base?.error({ err }, 'čistenie audit_log zlyhalo'));
  run();
  setInterval(run, 86400_000).unref();
}
