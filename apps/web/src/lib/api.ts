export type Role = 'owner' | 'admin' | 'dispatcher' | 'driver';
export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Majiteľ',
  admin: 'Admin',
  dispatcher: 'Dispečer',
  driver: 'Vodič',
};
/** Majiteľ má rovnaké práva ako admin. */
export const ADMIN_ROLES: Role[] = ['owner', 'admin'];
export const DISPATCH_ROLES: Role[] = [...ADMIN_ROLES, 'dispatcher'];
export const isAdmin = (r: Role | undefined) => !!r && ADMIN_ROLES.includes(r);
export type DriverStatus = 'offline' | 'available' | 'busy' | 'break';
export type RideStatus =
  | 'new'
  | 'assigned'
  | 'accepted'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type User = {
  id: number;
  username: string;
  name: string;
  phone: string | null;
  email: string | null;
  note: string | null;
  role: Role;
  active: boolean;
  vehicleId: number | null;
  driverStatus: DriverStatus;
  lastSeenAt?: string | null;
  rideCount?: number;
};

export type Vehicle = {
  id: number;
  callsign: string;
  plate: string;
  model: string;
  color: string | null;
  year: number | null;
  seats: number;
  bodyType: string | null;
  fuel: string | null;
  vin: string | null;
  stkUntil: string | null;
  ekUntil: string | null;
  insuranceUntil: string | null;
  note: string | null;
  active: boolean;
  photoUrl: string | null;
  rideCount?: number;
  shiftCount?: number;
};

export type KmSource = 'driver' | 'next_driver' | 'admin';

export type Shift = {
  id: number;
  driverId: number;
  driverName: string;
  vehicleId: number;
  vehicleCallsign: string;
  vehiclePlate: string;
  vehicleModel: string;
  vehiclePhotoUrl: string | null;
  scheduleId: number | null;
  startedAt: string;
  endedAt: string | null;
  startKm: number;
  endKm: number | null;
  endKmSource: KmSource | null;
  note: string | null;
  rideCount?: number;
  gpsKm?: number;
  revenue?: number;
  /** len pre vodiča (/api/driver/shift): súhrn jázd v smene */
  stats?: ShiftRideStats | null;
};
export type ShiftRideStats = { rides: number; cancelled: number; km: number; revenue: number };

export type Schedule = {
  id: number;
  driverId: number;
  driverName: string;
  vehicleId: number | null;
  vehicleCallsign: string | null;
  vehiclePlate: string | null;
  startsAt: string;
  endsAt: string;
  note: string | null;
};

export type ShiftCar = {
  id: number;
  callsign: string;
  plate: string;
  model: string;
  color: string | null;
  seats: number;
  photoUrl: string | null;
  lastKm: number | null;
  inUseBy: string | null;
  scheduled: boolean;
};

export type DriverShiftInfo = {
  shift: Shift | null;
  schedule: {
    id: number;
    startsAt: string;
    endsAt: string;
    vehicleId: number | null;
    vehicleCallsign: string | null;
    note: string | null;
  } | null;
  vehicles: ShiftCar[];
};

export const fmtInt = (n: number) => n.toLocaleString('sk-SK');

export type Driver = {
  id: number;
  name: string;
  phone: string | null;
  status: DriverStatus;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  lastSeenAt: string | null;
  vehicleId: number | null;
  vehicleCallsign: string | null;
  vehiclePlate: string | null;
  vehicleModel: string | null;
};

export type Ride = {
  id: number;
  status: RideStatus;
  customerName: string;
  customerPhone: string | null;
  source: 'dispatch' | 'street';
  pickupAddress: string;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffAddress: string;
  dropoffLat: number | null;
  dropoffLng: number | null;
  passengers: number;
  note: string | null;
  scheduledAt: string | null;
  driverId: number | null;
  driverName: string | null;
  driverPhone: string | null;
  vehicleCallsign: string | null;
  vehiclePlate: string | null;
  distanceKm: number;
  estimateKm: number | null;
  price: number | null;
  createdAt: string;
  assignedAt: string | null;
  acceptedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type GeoResult = { label: string; lat: number; lng: number };

const TOKEN_KEY = 'dt_token';
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) {
    tokenStore.clear();
    window.location.href = '/login';
  }
  if (!res.ok) {
    throw new ApiError(
      res.status,
      (data as { error?: string }).error ?? `Chyba ${res.status}`,
      data as Record<string, unknown>,
    );
  }
  return data as T;
}

export const STATUS_LABEL: Record<RideStatus, string> = {
  new: 'čaká',
  assigned: 'poslaná vodičovi',
  accepted: 'na ceste k A',
  arrived: 'čaká na zákazníka',
  in_progress: 'jazda',
  completed: 'dokončená',
  cancelled: 'zrušená',
};

export const DRIVER_LABEL: Record<DriverStatus, string> = {
  offline: 'offline',
  available: 'voľný',
  busy: 'na jazde',
  break: 'pauza',
};

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(toRad(bLat - aLat) / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(toRad(bLng - aLng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export const fmtKm = (km: number) =>
  km.toLocaleString('sk-SK', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
export const fmtEur = (v: number) => v.toLocaleString('sk-SK', { style: 'currency', currency: 'EUR' });
export const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' }) : '';
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
export const navHref = (address: string, lat?: number | null, lng?: number | null) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(lat && lng ? `${lat},${lng}` : address)}`;

/** "Peter Novák" → "PN" */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export type DriverDetail = {
  driver: Driver;
  vehicle: {
    id: number;
    callsign: string;
    plate: string;
    model: string;
    color: string | null;
    year: number | null;
    seats: number;
    fuel: string | null;
    stkUntil: string | null;
    insuranceUntil: string | null;
    photoUrl: string | null;
  } | null;
  shift: { id: number; startedAt: string; startKm: number } | null;
  ride: {
    id: number;
    status: RideStatus;
    source: 'dispatch' | 'street';
    customerName: string;
    customerPhone: string | null;
    pickupAddress: string;
    dropoffAddress: string;
    distanceKm: number;
    startedAt: string | null;
  } | null;
  stats: { rides: number; km: number; revenue: number };
};

/** Približná vzdialenosť A→B (cestná podľa mapy) – "12,4 km" alebo "–", kým sa počíta. */
export const fmtEstimate = (km: number | null) =>
  km === null || km === undefined
    ? '–'
    : `${Number(km).toLocaleString('sk-SK', { maximumFractionDigits: 1 })} km`;

// ---------------- Incidenty ----------------
export type Incident = {
  id: number;
  description: string;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  driverId: number;
  driverName: string;
  vehicleId: number | null;
  vehicleCallsign: string | null;
  vehiclePlate: string | null;
  shiftId: number | null;
  rideId: number | null;
  rideCustomer: string | null;
  ridePickup: string | null;
  rideDropoff: string | null;
  rideAt: string | null;
  photos: string[];
};
export type IncidentRide = {
  id: number;
  status: RideStatus;
  source: 'dispatch' | 'street';
  customerName: string;
  pickupAddress: string;
  dropoffAddress: string;
  assignedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  price: string | null;
};
export type IncidentContext = {
  shift: {
    id: number;
    vehicleId: number;
    vehicleCallsign: string | null;
    startedAt: string;
    endedAt: string | null;
  } | null;
  rides: IncidentRide[];
  incidents: Incident[];
};
