import { AuditEvent, GovernedRouteStop, Journey, JourneyWithStudent, TripWithJourneys, TripWithJourneySummary } from '../types';
import { legacyAuthHeaders } from './legacyAuthHeaders';

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

// Phase 11 SECURITY FIX — identity now proven via the real session token
// (see parentApi.ts's header comment) instead of a client-supplied
// `userEmail` query/body field, which the server previously trusted outright
// for every read AND every journey-transition write below.

export function getJourneyEvents(journeyId: string, sessionToken: string | undefined): Promise<AuditEvent[]> {
  return fetch(`/api/journeys/${journeyId}/events`, { headers: legacyAuthHeaders(sessionToken) }).then((res) =>
    asJson<AuditEvent[]>(res, 'تعذر تحميل سجل أحداث الرحلة الطلابية.')
  );
}

// School Operations Panel — one call, backend-aggregated (spec Phase 3B §35/§36).
export function getOperationsJourneysOverview(sessionToken: string | undefined): Promise<TripWithJourneySummary[]> {
  return fetch(`/api/operations/journeys`, { headers: legacyAuthHeaders(sessionToken) }).then((res) =>
    asJson<TripWithJourneySummary[]>(res, 'تعذر تحميل نظرة عمليات الرحلات الطلابية.')
  );
}

// School Journey Operations Panel drill-down — full roster for one trip.
export function getTripJourneys(tripId: string, sessionToken: string | undefined): Promise<JourneyWithStudent[]> {
  return fetch(`/api/trips/${tripId}/journeys`, { headers: legacyAuthHeaders(sessionToken) }).then((res) =>
    asJson<JourneyWithStudent[]>(res, 'تعذر تحميل قائمة رحلات طلاب هذه الحافلة.')
  );
}

// Driver Journey Console — the caller's OWN trips, resolved server-side (spec §40).
export function getDriverTrips(sessionToken: string | undefined): Promise<TripWithJourneys[]> {
  return fetch(`/api/driver/trips`, { headers: legacyAuthHeaders(sessionToken) }).then((res) =>
    asJson<TripWithJourneys[]>(res, 'تعذر تحميل رحلات السائق.')
  );
}

export function getRouteStops(routeId: string, sessionToken: string | undefined): Promise<GovernedRouteStop[]> {
  return fetch(`/api/routes/${routeId}/stops`, { headers: legacyAuthHeaders(sessionToken) }).then((res) =>
    asJson<GovernedRouteStop[]>(res, 'تعذر تحميل محطات المسار.')
  );
}

type JourneyActionResponse = Promise<{ success: true; journey: Journey }>;

function postJourneyAction(journeyId: string, action: string, sessionToken: string | undefined, extra?: Record<string, unknown>): JourneyActionResponse {
  return fetch(`/api/journeys/${journeyId}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(sessionToken) },
    body: JSON.stringify({ ...extra }),
  }).then((res) => asJson(res, 'تعذر تنفيذ إجراء الرحلة الطلابية.'));
}

export const startJourney = (journeyId: string, sessionToken: string | undefined) => postJourneyAction(journeyId, 'start', sessionToken);
export const startBoarding = (journeyId: string, sessionToken: string | undefined) => postJourneyAction(journeyId, 'start-boarding', sessionToken);
export const boardStudent = (journeyId: string, sessionToken: string | undefined) => postJourneyAction(journeyId, 'board', sessionToken);
export const startTransit = (journeyId: string, sessionToken: string | undefined) => postJourneyAction(journeyId, 'start-transit', sessionToken);
export const approachStop = (journeyId: string, stopId: string, sessionToken: string | undefined) =>
  postJourneyAction(journeyId, 'approach-stop', sessionToken, { stopId });
export const dropOffStudent = (journeyId: string, stopId: string, sessionToken: string | undefined) =>
  postJourneyAction(journeyId, 'drop-off', sessionToken, { stopId });
export const completeJourney = (journeyId: string, sessionToken: string | undefined) => postJourneyAction(journeyId, 'complete', sessionToken);
export const markMissed = (journeyId: string, reason: string, sessionToken: string | undefined) =>
  postJourneyAction(journeyId, 'missed', sessionToken, { reason });
export const cancelJourney = (journeyId: string, reason: string | undefined, sessionToken: string | undefined) =>
  postJourneyAction(journeyId, 'cancel', sessionToken, { reason });
export const markIncident = (journeyId: string, reason: string | undefined, sessionToken: string | undefined) =>
  postJourneyAction(journeyId, 'incident', sessionToken, { reason });
