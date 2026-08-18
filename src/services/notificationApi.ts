import { NotificationView } from '../types';

async function asJson<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || fallbackError);
  return data as T;
}

/** The caller's OWN notifications only — resolved entirely server-side (spec §13). Bounded (server default 20, max 50). */
export function getParentNotifications(userEmail: string, limit?: number): Promise<NotificationView[]> {
  const q = limit ? `&limit=${limit}` : '';
  return fetch(`/api/parent/notifications?userEmail=${encodeURIComponent(userEmail)}${q}`).then((res) =>
    asJson<NotificationView[]>(res, 'تعذر تحميل الإشعارات.')
  );
}

export function getUnreadNotificationCount(userEmail: string): Promise<{ count: number }> {
  return fetch(`/api/parent/notifications/unread-count?userEmail=${encodeURIComponent(userEmail)}`).then((res) =>
    asJson<{ count: number }>(res, 'تعذر تحميل عدد الإشعارات غير المقروءة.')
  );
}

/** Ownership is re-verified server-side from the notification row itself — never trusts the id alone. */
export function markNotificationRead(notificationId: string, userEmail: string): Promise<NotificationView> {
  return fetch(`/api/parent/notifications/${notificationId}/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail }),
  }).then((res) => asJson<NotificationView>(res, 'تعذر تحديث حالة الإشعار.'));
}
