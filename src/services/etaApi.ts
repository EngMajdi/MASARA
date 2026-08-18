import { EtaEstimateView } from '../types';

async function asJson<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || fallbackError);
  return data as T;
}

/** Admin/school only — every active bus's ETA in one call (no N+1). */
export function getFleetEta(userEmail: string): Promise<EtaEstimateView[]> {
  return fetch(`/api/eta/fleet?userEmail=${encodeURIComponent(userEmail)}`).then((res) =>
    asJson<EtaEstimateView[]>(res, 'تعذر تحميل تقديرات وقت الوصول للأسطول.')
  );
}

/** Admin/school unscoped, driver scoped to their own bus (server-enforced). */
export function getBusEta(busId: string, userEmail: string): Promise<EtaEstimateView> {
  return fetch(`/api/eta/bus/${busId}?userEmail=${encodeURIComponent(userEmail)}`).then((res) =>
    asJson<EtaEstimateView>(res, 'تعذر تحميل تقدير وقت وصول هذه الحافلة.')
  );
}

/** Admin/school unscoped, driver scoped to their own trip (server-enforced). */
export function getTripEta(tripId: string, userEmail: string): Promise<EtaEstimateView> {
  return fetch(`/api/eta/trip/${tripId}?userEmail=${encodeURIComponent(userEmail)}`).then((res) =>
    asJson<EtaEstimateView>(res, 'تعذر تحميل تقدير وقت وصول هذه الرحلة.')
  );
}
