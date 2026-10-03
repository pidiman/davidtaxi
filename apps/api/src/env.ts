function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Chýba premenná prostredia ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: req('DATABASE_URL'),
  jwtSecret: req('JWT_SECRET'),
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:3000',
  adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  priceMin: Number(process.env.PRICE_MIN ?? 3.5),
  pricePerKm: Number(process.env.PRICE_PER_KM ?? 1),
  vapidPublic: process.env.VAPID_PUBLIC_KEY ?? '',
  vapidPrivate: process.env.VAPID_PRIVATE_KEY ?? '',
  vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
  webDist: process.env.WEB_DIST ?? new URL('../../web/dist', import.meta.url).pathname,
  migrationsDir: process.env.MIGRATIONS_DIR ?? new URL('../drizzle', import.meta.url).pathname,
};
