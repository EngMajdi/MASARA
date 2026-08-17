import { CurrentLocation } from '../types';

async function asJson<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || fallbackError);
  return data as T;
}

/** Admin/school only — every current bus location in one call (spec §16/§40, no N+1). */
export function getFleetCurrentLocations(userEmail: string): Promise<CurrentLocation[]> {
  return fetch(`/api/telemetry/current/fleet?userEmail=${encodeURIComponent(userEmail)}`).then((res) =>
    asJson<CurrentLocation[]>(res, 'تعذر تحميل مواقع الأسطول الحالية.')
  );
}

/** A single bus's current location — admin/school unscoped, driver scoped to their own bus (server-enforced). Null if none exists yet (never fabricated). */
export function getBusCurrentLocation(busId: string, userEmail: string): Promise<CurrentLocation | null> {
  return fetch(`/api/telemetry/current/${busId}?userEmail=${encodeURIComponent(userEmail)}`).then((res) => {
    if (res.status === 404) return null;
    return asJson<CurrentLocation>(res, 'تعذر تحميل الموقع الحالي لهذه الحافلة.');
  });
}
