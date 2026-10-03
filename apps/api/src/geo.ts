const R = 6371; // km

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Filter GPS šumu: či sa má úsek medzi dvoma bodmi pripočítať do km. */
export function acceptSegment(km: number, seconds: number, accuracyM: number | null): boolean {
  if (accuracyM !== null && accuracyM > 50) return false; // nepresný bod
  if (km < 0.01) return false; // < 10 m = státie / jitter
  if (seconds <= 0) return false;
  const kmh = km / (seconds / 3600);
  return kmh < 220; // skok GPS
}
