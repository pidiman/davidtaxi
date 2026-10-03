import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['admin', 'dispatcher', 'driver']);
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
