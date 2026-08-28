import { NotificationView } from '../types';
import { legacyAuthHeaders } from './legacyAuthHeaders';

async function asJson<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || fallbackError);
  return data as T;
}

// Phase 11 SECURITY FIX — identity now proven via the real session token
// (see parentApi.ts's header comment) instead of a client-supplied
// `userEmail` query/body field, which the server previously trusted outright.

/** The caller's OWN notifications only — resolved entirely server-side (spec §13). Bounded (server default 20, max 50). */
export function getParentNotifications(sessionToken: string | undefined, limit?: number): Promise<NotificationView[]> {
  const q = limit ? `?limit=${limit}` : '';
  return fetch(`/api/parent/notifications${q}`, { headers: legacyAuthHeaders(sessionToken) }).then((res) =>
    asJson<NotificationView[]>(res, 'تعذر تحميل الإشعارات.')
  );
}

export function getUnreadNotificationCount(sessionToken: string | undefined): Promise<{ count: number }> {
  return fetch(`/api/parent/notifications/unread-count`, { headers: legacyAuthHeaders(sessionToken) }).then((res) =>
    asJson<{ count: number }>(res, 'تعذر تحميل عدد الإشعارات غير المقروءة.')
  );
}

/** Ownership is re-verified server-side from the notification row itself — never trusts the id alone. */
export function markNotificationRead(notificationId: string, sessionToken: string | undefined): Promise<NotificationView> {
  return fetch(`/api/parent/notifications/${notificationId}/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(sessionToken) },
  }).then((res) => asJson<NotificationView>(res, 'تعذر تحديث حالة الإشعار.'));
}
