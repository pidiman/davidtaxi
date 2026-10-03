export type Role = 'admin' | 'dispatcher' | 'driver';
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
  role: Role;
  active: boolean;
  vehicleId: number | null;
  driverStatus: DriverStatus;
};

export type Vehicle = { id: number; callsign: string; plate: string; model: string; active: boolean };

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
  customerPhone: string;
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
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Chyba ${res.status}`);
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
