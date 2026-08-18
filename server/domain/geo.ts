// Shared geometry primitives — plain JS, no geospatial dependency (Phase 4A
// spec §46: Haversine is acceptable, nothing heavier is needed). Originally
// implemented in server/services/GpsSimulationEngine.ts (Phase 4A); moved
// here in Phase 4D specifically so EtaService can reuse the exact same
// distance/interpolation math instead of a second implementation (Phase 4D
// spec §9: "Reuse the Haversine implementation from Phase 4A if it already
// exists. DO NOT implement a second Haversine function."). GpsSimulationEngine
// re-exports these names unchanged, so every existing import site and test
// keeps working without modification.

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Great-circle distance in meters. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass bearing A->B in degrees [0,360). Null when A and B coincide — never invent a heading. */
export function initialBearingDegrees(a: LatLng, b: LatLng): number | null {
  if (a.lat === b.lat && a.lng === b.lng) return null;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Simple linear interpolation between A and B at fraction t∈[0,1] — sufficient at this scale (no geographic perfection required). */
export function interpolatePosition(a: LatLng, b: LatLng, t: number): LatLng {
  const clamped = Math.max(0, Math.min(1, t));
  return { lat: a.lat + (b.lat - a.lat) * clamped, lng: a.lng + (b.lng - a.lng) * clamped };
}
