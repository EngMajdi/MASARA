import { EtaAccuracyView } from '../types';

async function asJson<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || fallbackError);
  return data as T;
}

/** Admin/school only — fleet-wide ETA accuracy summary (no bus/trip scope needed). */
export function getEtaAccuracySummary(userEmail: string): Promise<EtaAccuracyView> {
  return fetch(`/api/eta/accuracy/summary?userEmail=${encodeURIComponent(userEmail)}`).then((res) =>
    asJson<EtaAccuracyView>(res, 'تعذر تحميل تقرير دقة تقديرات وقت الوصول.')
  );
}

/** Admin/school unscoped, driver scoped to their own trip (server-enforced). */
export function getTripEtaAccuracy(tripId: string, userEmail: string): Promise<EtaAccuracyView> {
  return fetch(`/api/eta/accuracy/trips/${tripId}?userEmail=${encodeURIComponent(userEmail)}`).then((res) =>
    asJson<EtaAccuracyView>(res, 'تعذر تحميل تقرير دقة تقدير وقت الوصول لهذه الرحلة.')
  );
}
