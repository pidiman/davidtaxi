/**
 * Ukážkové dáta na lokálne skúšanie (pnpm seed). Spúšťa sa opakovane bez duplikátov.
 *   admin / admin1234 · dispečer dana / dispecer1234 · vodiči peter, jano / vodic1234
 */
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db, pool, runMigrations } from './db/index.js';
import { type Role, schedules, users, vehicles } from './db/schema.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Seed je len na lokálny vývoj.');
  process.exit(1);
}

await runMigrations();

async function user(username: string, name: string, role: Role, password: string, phone?: string) {
  const [u] = await db.select().from(users).where(eq(users.username, username));
  if (u) return u;
  const [n] = await db
    .insert(users)
    .values({ username, name, role, phone, passwordHash: await bcrypt.hash(password, 10) })
    .returning();
  console.log(`+ ${role} ${username} / ${password}`);
  return n;
}

async function car(callsign: string, plate: string, model: string, color: string, year: number) {
  const [v] = await db.select().from(vehicles).where(eq(vehicles.callsign, callsign));
  if (v) return v;
  const [n] = await db
    .insert(vehicles)
    .values({ callsign, plate, model, color, year, seats: 4, fuel: 'nafta', bodyType: 'liftback' })
    .returning();
  console.log(`+ auto ${callsign} ${plate}`);
  return n;
}

await user('admin', 'Administrátor', 'admin', 'admin1234');
await user('dana', 'Dana Dispečerka', 'dispatcher', 'dispecer1234');
const peter = await user('peter', 'Peter Novák', 'driver', 'vodic1234', '+421 900 111 222');
const jano = await user('jano', 'Ján Kováč', 'driver', 'vodic1234', '+421 900 333 444');
const c07 = await car('07', 'BA123XY', 'Škoda Superb', 'čierna', 2021);
const c02 = await car('02', 'MA456AB', 'Škoda Octavia Combi', 'biela', 2019);

const existing = await db.select({ id: schedules.id }).from(schedules).limit(1);
if (!existing.length) {
  const day = new Date();
  day.setHours(6, 0, 0, 0);
  const at = (d: number, h: number) => new Date(day.getTime() + d * 86_400_000 + (h - 6) * 3_600_000);
  for (let d = 0; d < 7; d++) {
    await db.insert(schedules).values([
      { driverId: (d % 2 ? jano : peter).id, vehicleId: c07.id, startsAt: at(d, 6), endsAt: at(d, 18) },
      { driverId: (d % 2 ? peter : jano).id, vehicleId: c02.id, startsAt: at(d, 18), endsAt: at(d, 30) },
    ]);
  }
  console.log('+ rozpis na 7 dní');
}

await pool.end();
console.log('Hotovo.');
