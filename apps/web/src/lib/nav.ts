import { haversineKm } from './api';

export type LatLng = [number, number];
export type RouteStep = {
  type: string;
  modifier: string | null;
  exit: number | null;
  name: string;
  distance: number; // m – úsek od tohto manévru po ďalší
  duration: number; // s
  location: LatLng;
};
export type Route = { distance: number; duration: number; geometry: LatLng[]; steps: RouteStep[] };

export const distM = (a: LatLng, b: LatLng) => haversineKm(a[0], a[1], b[0], b[1]) * 1000;

/** Vzdialenosť bodu od lomenej čiary trasy v metroch (lokálna rovinná aproximácia, stačí na pár km). */
export function distanceToRoute(p: LatLng, line: LatLng[]): number {
  if (line.length < 2) return line.length ? distM(p, line[0]) : Number.POSITIVE_INFINITY;
  const k = Math.cos((p[0] * Math.PI) / 180);
  const toXY = (q: LatLng) => [(q[1] - p[1]) * k * 111_320, (q[0] - p[0]) * 110_540];
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = toXY(line[i]);
    const [bx, by] = toXY(line[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const x = ax + t * dx;
    const y = ay + t * dy;
    best = Math.min(best, Math.hypot(x, y));
  }
  return best;
}

const DIR: Record<string, string> = {
  left: 'vľavo',
  right: 'vpravo',
  'slight left': 'mierne vľavo',
  'slight right': 'mierne vpravo',
  'sharp left': 'ostro vľavo',
  'sharp right': 'ostro vpravo',
  straight: 'rovno',
  uturn: 'späť',
};

const ORD = ['', 'prvým', 'druhým', 'tretím', 'štvrtým', 'piatym', 'šiestym', 'siedmym', 'ôsmym'];

/** Slovenský text pokynu z OSRM manévru. */
export function instruction(s: RouteStep): string {
  const dir = s.modifier ? (DIR[s.modifier] ?? '') : '';
  const onto = s.name ? ` – ${s.name}` : ''; // názvy ulíc sa nedajú spoľahlivo skloňovať
  switch (s.type) {
    case 'depart':
      return `Vyrazte${onto}`;
    case 'arrive':
      return 'Ste v cieli';
    case 'roundabout':
    case 'rotary':
    case 'roundabout turn': {
      const ex = s.exit && s.exit < ORD.length ? `${ORD[s.exit]} výjazdom` : 'výjazdom';
      return `Na kruhovom objazde vyjdite ${ex}${onto}`;
    }
    case 'exit roundabout':
    case 'exit rotary':
      return `Opustite kruhový objazd${onto}`;
    case 'merge':
      return `Zaraďte sa ${dir}${onto}`.replace('  ', ' ');
    case 'on ramp':
      return `Vojdite na nájazd ${dir}${onto}`.replace('  ', ' ');
    case 'off ramp':
      return `Zíďte z cesty ${dir}${onto}`.replace('  ', ' ');
    case 'fork':
      return `Na rozdvojení sa držte ${dir}${onto}`;
    case 'end of road':
      return `Na konci cesty odbočte ${dir}${onto}`;
    case 'continue':
    case 'new name':
      return s.modifier && s.modifier !== 'straight' ? `Pokračujte ${dir}${onto}` : `Pokračujte rovno${onto}`;
    default: // turn, notification…
      if (s.modifier === 'uturn') return `Otočte sa${onto}`;
      if (s.modifier === 'straight') return `Pokračujte rovno${onto}`;
      return `Odbočte ${dir}${onto}`;
  }
}

export function fmtDist(m: number): string {
  if (m >= 1000) return `${(m / 1000).toLocaleString('sk-SK', { maximumFractionDigits: 1 })} km`;
  if (m >= 100) return `${Math.round(m / 10) * 10} m`;
  return `${Math.max(0, Math.round(m / 5) * 5)} m`;
}

export function fmtDuration(s: number): string {
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** Hlasový pokyn po slovensky (Web Speech API, funguje offline na Androide aj iOS). */
export function speak(text: string) {
  try {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'sk-SK';
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('sk'));
    if (voice) u.voice = voice;
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
  } catch {
    /* bez hlasu */
  }
}

/** Uhol šípky pre ikonu manévru (0 = rovno hore). */
export function arrowAngle(s: RouteStep): number {
  if (s.type === 'arrive') return 0;
  switch (s.modifier) {
    case 'left':
      return -90;
    case 'right':
      return 90;
    case 'slight left':
      return -45;
    case 'slight right':
      return 45;
    case 'sharp left':
      return -135;
    case 'sharp right':
      return 135;
    case 'uturn':
      return 180;
    default:
      return 0;
  }
}
