import { CurrentLocation } from '../types';
import { legacyAuthHeaders } from './legacyAuthHeaders';

async function asJson<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || fallbackError);
  return data as T;
}

// Phase 11 SECURITY FIX — identity now proven via the real session token
// (see parentApi.ts's header comment) instead of a client-supplied
// `userEmail` query parameter, which the server previously trusted outright.

/** Admin/school only — every current bus location in one call (spec §16/§40, no N+1). */
export function getFleetCurrentLocations(sessionToken: string | undefined): Promise<CurrentLocation[]> {
  return fetch(`/api/telemetry/current/fleet`, { headers: legacyAuthHeaders(sessionToken) }).then((res) =>
    asJson<CurrentLocation[]>(res, 'تعذر تحميل مواقع الأسطول الحالية.')
  );
}

/** A single bus's current location — admin/school unscoped, driver scoped to their own bus (server-enforced). Null if none exists yet (never fabricated). */
export function getBusCurrentLocation(busId: string, sessionToken: string | undefined): Promise<CurrentLocation | null> {
  return fetch(`/api/telemetry/current/${busId}`, { headers: legacyAuthHeaders(sessionToken) }).then((res) => {
    if (res.status === 404) return null;
    return asJson<CurrentLocation>(res, 'تعذر تحميل الموقع الحالي لهذه الحافلة.');
  });
}
