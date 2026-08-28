import { FeedCategory, OperationsFeedEvent } from '../types';
import { legacyAuthHeaders } from './legacyAuthHeaders';

async function asJson<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || fallbackError);
  return data as T;
}

export interface OperationsEventsQuery {
  tripId?: string;
  recommendationId?: string;
  eventType?: string;
  category?: FeedCategory;
  limit?: number;
  sessionToken: string | undefined;
}

// Phase 11 SECURITY FIX — identity now proven via the real session token
// (see parentApi.ts's header comment) instead of a client-supplied
// `userEmail` query parameter, which the server previously trusted outright.
export function listOperationsEvents(query: OperationsEventsQuery): Promise<OperationsFeedEvent[]> {
  const params = new URLSearchParams();
  if (query.tripId) params.set('tripId', query.tripId);
  if (query.recommendationId) params.set('recommendationId', query.recommendationId);
  if (query.eventType) params.set('eventType', query.eventType);
  if (query.category) params.set('category', query.category);
  if (query.limit) params.set('limit', String(query.limit));

  return fetch(`/api/operations/events?${params.toString()}`, { headers: legacyAuthHeaders(query.sessionToken) }).then((res) =>
    asJson<OperationsFeedEvent[]>(res, 'تعذر تحميل سجل العمليات.')
  );
}
