import { and, eq, gte, isNotNull, lte, type SQL, sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { rides } from './db/schema.js';

type ShiftSpan = { startedAt: Date; endedAt: Date | null };

/** Jazdy vodiča patriace do smeny = pridelené (alebo z ulice) medzi začiatkom a koncom smeny. */
export function shiftRideWhere(driverId: number, shift: ShiftSpan): SQL {
  const w: SQL[] = [
    eq(rides.driverId, driverId),
    isNotNull(rides.assignedAt),
    gte(rides.assignedAt, shift.startedAt),
  ];
  if (shift.endedAt) w.push(lte(rides.assignedAt, shift.endedAt));
  return and(...w)!;
}

/** Súhrn smeny: dokončené jazdy, km odjazdené s zákazníkmi (GPS) a tržba. */
export async function shiftRideStats(driverId: number, shift: ShiftSpan) {
  const [agg] = await db
    .select({
      rides: sql<number>`count(*) filter (where ${rides.status} = 'completed')::int`,
      cancelled: sql<number>`count(*) filter (where ${rides.status} = 'cancelled')::int`,
      km: sql<number>`coalesce(sum(${rides.distanceKm}) filter (where ${rides.status} = 'completed'), 0)::float`,
      revenue: sql<number>`coalesce(sum(${rides.price}) filter (where ${rides.status} = 'completed'), 0)::float`,
    })
    .from(rides)
    .where(shiftRideWhere(driverId, shift));
  return agg;
}

export const shiftRideCols = {
  id: rides.id,
  status: rides.status,
  source: rides.source,
  customerName: rides.customerName,
  customerPhone: rides.customerPhone,
  pickupAddress: rides.pickupAddress,
  dropoffAddress: rides.dropoffAddress,
  passengers: rides.passengers,
  note: rides.note,
  assignedAt: rides.assignedAt,
  startedAt: rides.startedAt,
  finishedAt: rides.finishedAt,
  distanceKm: rides.distanceKm,
  estimateKm: rides.estimateKm,
  price: rides.price,
};
