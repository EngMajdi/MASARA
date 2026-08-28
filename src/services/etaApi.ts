import { EtaEstimateView } from '../types';
import { legacyAuthHeaders } from './legacyAuthHeaders';

async function asJson<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || fallbackError);
  return data as T;
}

// Phase 11 SECURITY FIX — identity now proven via the real session token
// (see parentApi.ts's header comment) instead of a client-supplied
// `userEmail` query parameter, which the server previously trusted outright.

/** Admin/school only — every active bus's ETA in one call (no N+1). */
export function getFleetEta(sessionToken: string | undefined): Promise<EtaEstimateView[]> {
  return fetch(`/api/eta/fleet`, { headers: legacyAuthHeaders(sessionToken) }).then((res) =>
    asJson<EtaEstimateView[]>(res, 'تعذر تحميل تقديرات وقت الوصول للأسطول.')
  );
}

/** Admin/school unscoped, driver scoped to their own bus (server-enforced). */
export function getBusEta(busId: string, sessionToken: string | undefined): Promise<EtaEstimateView> {
  return fetch(`/api/eta/bus/${busId}`, { headers: legacyAuthHeaders(sessionToken) }).then((res) =>
    asJson<EtaEstimateView>(res, 'تعذر تحميل تقدير وقت وصول هذه الحافلة.')
  );
}

/** Admin/school unscoped, driver scoped to their own trip (server-enforced). */
export function getTripEta(tripId: string, sessionToken: string | undefined): Promise<EtaEstimateView> {
  return fetch(`/api/eta/trip/${tripId}`, { headers: legacyAuthHeaders(sessionToken) }).then((res) =>
    asJson<EtaEstimateView>(res, 'تعذر تحميل تقدير وقت وصول هذه الرحلة.')
  );
}
