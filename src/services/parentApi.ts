import { ParentJourneyEventView, ParentJourneyView } from '../types';
import { legacyAuthHeaders } from './legacyAuthHeaders';

async function asJson<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || fallbackError);
  return data as T;
}

// Phase 11 SECURITY FIX — these calls used to send `?userEmail=...` as the
// caller's identity, which the server then trusted completely with no
// verification at all (a full authentication bypass, confirmed live in the
// Phase 10 UAT). Identity is now proven with the same real session token
// every legacy-surface call already sends; the server derives the caller's
// email from that verified session, never from a client-supplied parameter.

/** The caller's OWN authorized children only — resolved entirely server-side (spec §4/§12). No studentId is ever passed. */
export function getParentJourneys(sessionToken: string | undefined): Promise<ParentJourneyView[]> {
  return fetch(`/api/parent/journeys`, { headers: legacyAuthHeaders(sessionToken) }).then((res) =>
    asJson<ParentJourneyView[]>(res, 'تعذر تحميل بيانات رحلة الطالب.')
  );
}

export function getParentJourneyEvents(journeyId: string, sessionToken: string | undefined): Promise<ParentJourneyEventView[]> {
  return fetch(`/api/parent/journeys/${journeyId}/events`, { headers: legacyAuthHeaders(sessionToken) }).then((res) =>
    asJson<ParentJourneyEventView[]>(res, 'تعذر تحميل سجل أحداث رحلة الطالب.')
  );
}
