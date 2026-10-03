import {
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

// owner = majiteľ: rovnaké práva ako admin + dostáva prevádzkové info (napr. e-maily)
export const roleEnum = pgEnum('role', ['admin', 'dispatcher', 'driver', 'owner']);
export const driverStatusEnum = pgEnum('driver_status', ['offline', 'available', 'busy', 'break']);
export const rideStatusEnum = pgEnum('ride_status', [
  'new', // čaká na priradenie
  'assigned', // poslaná vodičovi, čaká na prijatie
  'accepted', // vodič ide k zákazníkovi
  'arrived', // vodič čaká na mieste A
  'in_progress', // jazda prebieha, počítajú sa km
  'completed',
  'cancelled',
]);

// odkiaľ jazda prišla: dispečing (telefonát) alebo vodič zobral zákazníka priamo na ulici
export const rideSourceEnum = pgEnum('ride_source', ['dispatch', 'street']);

export const vehicles = pgTable('vehicles', {
  id: serial('id').primaryKey(),
  callsign: text('callsign').notNull().unique(), // číslo auta, napr. "07"
  plate: text('plate').notNull(),
  model: text('model').notNull(), // značka a model, napr. "Škoda Superb"
  color: text('color'),
  year: integer('year'),
  seats: integer('seats').notNull().default(4), // miesta pre cestujúcich
  bodyType: text('body_type'), // sedan / kombi / MPV / van
  fuel: text('fuel'), // benzín / nafta / LPG / hybrid / elektro
  vin: text('vin'),
  stkUntil: date('stk_until', { mode: 'string' }), // technická kontrola platná do
  ekUntil: date('ek_until', { mode: 'string' }), // emisná kontrola platná do
  insuranceUntil: date('insurance_until', { mode: 'string' }), // PZP platné do
  note: text('note'),
  // fotka (zmenšená v prehliadači na ~1280 px JPEG) – v DB, aby bola v zálohe spolu s dátami
  photo: bytea('photo'),
  photoMime: text('photo_mime'),
  photoUpdatedAt: timestamp('photo_updated_at', { withTimezone: true }),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  note: text('note'),
  role: roleEnum('role').notNull(),
  active: boolean('active').notNull().default(true),
  vehicleId: integer('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
  driverStatus: driverStatusEnum('driver_status').notNull().default('offline'),
  lastLat: doublePrecision('last_lat'),
  lastLng: doublePrecision('last_lng'),
  lastAccuracy: doublePrecision('last_accuracy'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rides = pgTable(
  'rides',
  {
    id: serial('id').primaryKey(),
    status: rideStatusEnum('status').notNull().default('new'),
    source: rideSourceEnum('source').notNull().default('dispatch'),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone'), // pri jazde z ulice nemusí byť
    pickupAddress: text('pickup_address').notNull(),
    pickupLat: doublePrecision('pickup_lat'),
    pickupLng: doublePrecision('pickup_lng'),
    dropoffAddress: text('dropoff_address').notNull(),
    dropoffLat: doublePrecision('dropoff_lat'),
    dropoffLng: doublePrecision('dropoff_lng'),
    passengers: integer('passengers').notNull().default(1),
    note: text('note'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    driverId: integer('driver_id').references(() => users.id, { onDelete: 'set null' }),
    vehicleId: integer('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    createdById: integer('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    distanceKm: numeric('distance_km', { precision: 8, scale: 3, mode: 'number' }).notNull().default(0),
    // približná cestná vzdialenosť A→B podľa mapy (OSRM), dopĺňa sa po vytvorení jazdy
    estimateKm: numeric('estimate_km', { precision: 7, scale: 1, mode: 'number' }),
    price: numeric('price', { precision: 8, scale: 2, mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('rides_status_idx').on(t.status), index('rides_driver_idx').on(t.driverId)],
);

// GPS body počas jazdy (status in_progress) – z nich sa počítajú km
export const ridePoints = pgTable(
  'ride_points',
  {
    id: serial('id').primaryKey(),
    rideId: integer('ride_id')
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    accuracy: doublePrecision('accuracy'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('ride_points_ride_idx').on(t.rideId, t.recordedAt)],
);

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type Ride = typeof rides.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];

// ---------------- Rozpis (plán smien) ----------------
export const schedules = pgTable(
  'schedules',
  {
    id: serial('id').primaryKey(),
    driverId: integer('driver_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vehicleId: integer('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    note: text('note'),
    createdById: integer('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('schedules_time_idx').on(t.startsAt, t.endsAt)],
);

// ---------------- Odjazdené smeny (kniha jázd so stavom km) ----------------
// endKmSource: driver = zadal vodič pri ukončení · next_driver = doplnené z počiatočného stavu
// ďalšieho vodiča (zabudol ukončiť) · admin = opravil admin/dispečer
export const kmSourceEnum = pgEnum('km_source', ['driver', 'next_driver', 'admin']);

export const shifts = pgTable(
  'shifts',
  {
    id: serial('id').primaryKey(),
    driverId: integer('driver_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    vehicleId: integer('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    scheduleId: integer('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    startKm: integer('start_km').notNull(),
    endKm: integer('end_km'),
    endKmSource: kmSourceEnum('end_km_source'),
    note: text('note'),
  },
  (t) => [
    index('shifts_vehicle_idx').on(t.vehicleId, t.startedAt),
    index('shifts_driver_idx').on(t.driverId),
  ],
);

export type Shift = typeof shifts.$inferSelect;

// ---------------- Log udalostí (zobrazuje sa v Admin → Logy) ----------------
export const logLevelEnum = pgEnum('log_level', ['info', 'warn', 'error']);

export const auditLog = pgTable(
  'audit_log',
  {
    id: serial('id').primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    level: logLevelEnum('level').notNull(),
    evt: text('evt').notNull(),
    msg: text('msg').notNull(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    fields: jsonb('fields').$type<Record<string, unknown>>(),
  },
  (t) => [index('audit_log_at_idx').on(t.at), index('audit_log_evt_idx').on(t.evt, t.at)],
);

// incident = problém na riešenie · comment = komentár k jazde (rovno vyriešený, len na info)
export const incidentKindEnum = pgEnum('incident_kind', ['incident', 'comment']);

// ---------------- Incidenty nahlásené vodičom (napr. zašpinené auto, škoda, konflikt) ----------------
export const incidents = pgTable(
  'incidents',
  {
    id: serial('id').primaryKey(),
    driverId: integer('driver_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    vehicleId: integer('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    shiftId: integer('shift_id').references(() => shifts.id, { onDelete: 'set null' }),
    rideId: integer('ride_id').references(() => rides.id, { onDelete: 'set null' }),
    kind: incidentKindEnum('kind').notNull().default('incident'),
    description: text('description').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedById: integer('resolved_by_id').references(() => users.id, { onDelete: 'set null' }),
    resolutionNote: text('resolution_note'),
  },
  (t) => [index('incidents_created_idx').on(t.createdAt), index('incidents_driver_idx').on(t.driverId)],
);

// fotky sa servírujú cez náhodný kľúč (img tag neposiela token), nie cez poradové ID
export const incidentPhotos = pgTable(
  'incident_photos',
  {
    id: serial('id').primaryKey(),
    incidentId: integer('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    key: text('key').notNull().unique(),
    mime: text('mime').notNull(),
    data: bytea('data').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('incident_photos_incident_idx').on(t.incidentId)],
);
