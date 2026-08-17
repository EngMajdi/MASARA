import { AuditEvent, GovernedRouteStop, Journey, JourneyWithStudent, TripWithJourneys, TripWithJourneySummary } from '../types';

async function asJson<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && data.error) || fallbackError) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = data && data.code;
    throw err;
  }
  return data as T;
}

export function getJourneyEvents(journeyId: string, userEmail: string): Promise<AuditEvent[]> {
  return fetch(`/api/journeys/${journeyId}/events?userEmail=${encodeURIComponent(userEmail)}`).then((res) =>
    asJson<AuditEvent[]>(res, 'تعذر تحميل سجل أحداث الرحلة الطلابية.')
  );
}

// School Operations Panel — one call, backend-aggregated (spec Phase 3B §35/§36).
export function getOperationsJourneysOverview(userEmail: string): Promise<TripWithJourneySummary[]> {
  return fetch(`/api/operations/journeys?userEmail=${encodeURIComponent(userEmail)}`).then((res) =>
    asJson<TripWithJourneySummary[]>(res, 'تعذر تحميل نظرة عمليات الرحلات الطلابية.')
  );
}

// School Journey Operations Panel drill-down — full roster for one trip.
export function getTripJourneys(tripId: string, userEmail: string): Promise<JourneyWithStudent[]> {
  return fetch(`/api/trips/${tripId}/journeys?userEmail=${encodeURIComponent(userEmail)}`).then((res) =>
    asJson<JourneyWithStudent[]>(res, 'تعذر تحميل قائمة رحلات طلاب هذه الحافلة.')
  );
}

// Driver Journey Console — the caller's OWN trips, resolved server-side (spec §40).
export function getDriverTrips(userEmail: string): Promise<TripWithJourneys[]> {
  return fetch(`/api/driver/trips?userEmail=${encodeURIComponent(userEmail)}`).then((res) =>
    asJson<TripWithJourneys[]>(res, 'تعذر تحميل رحلات السائق.')
  );
}

export function getRouteStops(routeId: string): Promise<GovernedRouteStop[]> {
  return fetch(`/api/routes/${routeId}/stops`).then((res) => asJson<GovernedRouteStop[]>(res, 'تعذر تحميل محطات المسار.'));
}

type JourneyActionResponse = Promise<{ success: true; journey: Journey }>;

function postJourneyAction(journeyId: string, action: string, userEmail: string, extra?: Record<string, unknown>): JourneyActionResponse {
  return fetch(`/api/journeys/${journeyId}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail, ...extra }),
  }).then((res) => asJson(res, 'تعذر تنفيذ إجراء الرحلة الطلابية.'));
}

export const startJourney = (journeyId: string, userEmail: string) => postJourneyAction(journeyId, 'start', userEmail);
export const startBoarding = (journeyId: string, userEmail: string) => postJourneyAction(journeyId, 'start-boarding', userEmail);
export const boardStudent = (journeyId: string, userEmail: string) => postJourneyAction(journeyId, 'board', userEmail);
export const startTransit = (journeyId: string, userEmail: string) => postJourneyAction(journeyId, 'start-transit', userEmail);
export const approachStop = (journeyId: string, stopId: string, userEmail: string) =>
  postJourneyAction(journeyId, 'approach-stop', userEmail, { stopId });
export const dropOffStudent = (journeyId: string, stopId: string, userEmail: string) =>
  postJourneyAction(journeyId, 'drop-off', userEmail, { stopId });
export const completeJourney = (journeyId: string, userEmail: string) => postJourneyAction(journeyId, 'complete', userEmail);
export const markMissed = (journeyId: string, reason: string, userEmail: string) =>
  postJourneyAction(journeyId, 'missed', userEmail, { reason });
export const cancelJourney = (journeyId: string, reason: string | undefined, userEmail: string) =>
  postJourneyAction(journeyId, 'cancel', userEmail, { reason });
export const markIncident = (journeyId: string, reason: string | undefined, userEmail: string) =>
  postJourneyAction(journeyId, 'incident', userEmail, { reason });
