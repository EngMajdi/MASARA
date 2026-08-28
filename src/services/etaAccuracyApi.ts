import { EtaAccuracyView } from '../types';
import { legacyAuthHeaders } from './legacyAuthHeaders';

async function asJson<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || fallbackError);
  return data as T;
}

// Phase 11 SECURITY FIX — identity now proven via the real session token
// (see parentApi.ts's header comment) instead of a client-supplied
// `userEmail` query parameter, which the server previously trusted outright.

/** Admin/school only — fleet-wide ETA accuracy summary (no bus/trip scope needed). */
export function getEtaAccuracySummary(sessionToken: string | undefined): Promise<EtaAccuracyView> {
  return fetch(`/api/eta/accuracy/summary`, { headers: legacyAuthHeaders(sessionToken) }).then((res) =>
    asJson<EtaAccuracyView>(res, 'تعذر تحميل تقرير دقة تقديرات وقت الوصول.')
  );
}

/** Admin/school unscoped, driver scoped to their own trip (server-enforced). */
export function getTripEtaAccuracy(tripId: string, sessionToken: string | undefined): Promise<EtaAccuracyView> {
  return fetch(`/api/eta/accuracy/trips/${tripId}`, { headers: legacyAuthHeaders(sessionToken) }).then((res) =>
    asJson<EtaAccuracyView>(res, 'تعذر تحميل تقرير دقة تقدير وقت الوصول لهذه الرحلة.')
  );
}
