import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { env } from '../env.js';
import * as schema from './schema.js';

export const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 10 });
export const db = drizzle(pool, { schema });

export async function runMigrations() {
  await migrate(db, { migrationsFolder: env.migrationsDir });
}
