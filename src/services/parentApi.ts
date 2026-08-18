import { ParentJourneyEventView, ParentJourneyView } from '../types';

async function asJson<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || fallbackError);
  return data as T;
}

/** The caller's OWN authorized children only — resolved entirely server-side (spec §4/§12). No studentId is ever passed. */
export function getParentJourneys(userEmail: string): Promise<ParentJourneyView[]> {
  return fetch(`/api/parent/journeys?userEmail=${encodeURIComponent(userEmail)}`).then((res) =>
    asJson<ParentJourneyView[]>(res, 'تعذر تحميل بيانات رحلة الطالب.')
  );
}

export function getParentJourneyEvents(journeyId: string, userEmail: string): Promise<ParentJourneyEventView[]> {
  return fetch(`/api/parent/journeys/${journeyId}/events?userEmail=${encodeURIComponent(userEmail)}`).then((res) =>
    asJson<ParentJourneyEventView[]>(res, 'تعذر تحميل سجل أحداث رحلة الطالب.')
  );
}
