import type { FastifyBaseLogger, FastifyRequest } from 'fastify';

/**
 * Spoločný logger pre moduly mimo requestu (push, OSRM, socket…).
 * Nastaví sa pri štarte z app.log, dovtedy ide na konzolu.
 */
let base: FastifyBaseLogger | null = null;
export function initLog(l: FastifyBaseLogger) {
  base = l;
}

type Fields = Record<string, unknown>;

/**
 * Biznis udalosť – jeden riadok s poľom `evt` (napr. ride.assigned), čitateľnou správou
 * a ID-čkami. Mená/adresy zákazníkov sa NElogujú (osobné údaje sú len v DB).
 */
export function audit(evt: string, msg: string, fields: Fields = {}) {
  if (base) base.info({ evt, ...fields }, msg);
  else console.log(JSON.stringify({ evt, ...fields, msg }));
}

/** Problém s externou službou / doručením – appka beží ďalej, ale treba o ňom vedieť. */
export function warn(evt: string, msg: string, fields: Fields = {}) {
  if (base) base.warn({ evt, ...fields }, msg);
  else console.warn(JSON.stringify({ evt, ...fields, msg }));
}

/** Kto akciu urobil – meno a rola z JWT. */
export function who(req: FastifyRequest) {
  const u = req.user;
  return u ? `${u.name} (${u.role})` : 'anonym';
}
export function byFields(req: FastifyRequest) {
  return req.user ? { byId: req.user.id, byRole: req.user.role } : {};
}
