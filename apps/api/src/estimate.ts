import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from './db/index.js';
import { rides } from './db/schema.js';
import { env } from './env.js';
import { haversineKm } from './geo.js';

const geocoderUrl = process.env.GEOCODER_URL ?? 'https://nominatim.openstreetmap.org/search';
const osrmUrl = (process.env.OSRM_URL ?? 'https://router.project-osrm.org').replace(/\/$/, '');
const UA = { 'User-Agent': `davidtaxi (${env.publicUrl})` };
const ROAD_FACTOR = 1.3; // vzdušná → cestná vzdialenosť, keď OSRM nie je dostupné

type Pt = { lat: number; lng: number };

async function geocodeFirst(q: string): Promise<Pt | null> {
  const url = new URL(geocoderUrl);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'sk,at,cz,hu');
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const [d] = (await res.json()) as { lat: string; lon: string }[];
  return d ? { lat: Number(d.lat), lng: Number(d.lon) } : null;
}

/** Cestná vzdialenosť A→B v km (OSRM), pri výpadku vzdušná × 1,3. */
export async function roadKm(a: Pt, b: Pt): Promise<number> {
  try {
    const res = await fetch(
      `${osrmUrl}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`,
      {
        headers: UA,
        signal: AbortSignal.timeout(8000),
      },
    );
    if (res.ok) {
      const data = (await res.json()) as { code: string; routes?: { distance: number }[] };
      const m = data.routes?.[0]?.distance;
      if (data.code === 'Ok' && typeof m === 'number') return m / 1000;
    }
  } catch {
    /* fallback nižšie */
  }
  return haversineKm(a.lat, a.lng, b.lat, b.lng) * ROAD_FACTOR;
}

/**
 * Doplní jazde približnú vzdialenosť A→B (a chýbajúce súradnice z adresy).
 * Vracia true, ak sa niečo uložilo.
 */
export async function estimateRide(id: number): Promise<boolean> {
  const [r] = await db.select().from(rides).where(eq(rides.id, id));
  if (!r || r.estimateKm !== null) return false;
  let a: Pt | null =
    r.pickupLat !== null && r.pickupLng !== null ? { lat: r.pickupLat, lng: r.pickupLng } : null;
  let b: Pt | null =
    r.dropoffLat !== null && r.dropoffLng !== null ? { lat: r.dropoffLat, lng: r.dropoffLng } : null;
  try {
    if (!a) a = await geocodeFirst(r.pickupAddress);
    if (!b) b = await geocodeFirst(r.dropoffAddress);
  } catch {
    /* adresu nevieme nájsť – vzdialenosť ostane prázdna */
  }
  if (!a || !b) return false;
  const km = Math.round((await roadKm(a, b)) * 10) / 10;
  await db
    .update(rides)
    .set({
      estimateKm: km,
      pickupLat: a.lat,
      pickupLng: a.lng,
      dropoffLat: b.lat,
      dropoffLng: b.lng,
    })
    .where(eq(rides.id, id));
  return true;
}

/** Po štarte doplní vzdialenosť starším jazdám, ktoré majú súradnice (šetrne, 1 jazda/s). */
export async function backfillEstimates(log: (msg: string) => void) {
  const rows = await db
    .select({ id: rides.id })
    .from(rides)
    .where(and(isNull(rides.estimateKm), isNotNull(rides.pickupLat), isNotNull(rides.dropoffLat)))
    .limit(500);
  let n = 0;
  for (const r of rows) {
    if (await estimateRide(r.id).catch(() => false)) n++;
    await new Promise((res) => setTimeout(res, 1100));
  }
  if (n) log(`Doplnená vzdialenosť A→B pre ${n} jázd`);
}
