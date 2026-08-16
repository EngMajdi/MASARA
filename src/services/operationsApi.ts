import { FeedCategory, OperationsFeedEvent } from '../types';

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
  userEmail: string;
}

export function listOperationsEvents(query: OperationsEventsQuery): Promise<OperationsFeedEvent[]> {
  const params = new URLSearchParams();
  if (query.tripId) params.set('tripId', query.tripId);
  if (query.recommendationId) params.set('recommendationId', query.recommendationId);
  if (query.eventType) params.set('eventType', query.eventType);
  if (query.category) params.set('category', query.category);
  if (query.limit) params.set('limit', String(query.limit));
  params.set('userEmail', query.userEmail);

  return fetch(`/api/operations/events?${params.toString()}`).then((res) =>
    asJson<OperationsFeedEvent[]>(res, 'تعذر تحميل سجل العمليات.')
  );
}
