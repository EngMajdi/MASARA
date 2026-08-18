import { notificationRepository } from '../repositories/notificationRepository';

// Phase 5B — provider-neutral delivery abstraction (spec §16). Nothing in
// NotificationService depends on HOW a notification reaches a parent, only
// on this interface. A future PushNotificationProvider/SmsNotificationProvider
// /EmailNotificationProvider implements the same shape without
// NotificationService's domain logic changing at all. No external provider
// is connected in this phase (spec §4) — InAppNotificationProvider below is
// the only implementation, and it is a REAL one, not a stub: for an in-app
// notification, "delivery" IS the row existing in a table the parent's own
// read API already serves, so there is no separate transmission step to
// simulate.

export interface DeliveryResult {
  ok: boolean;
  failureReason?: string;
}

export interface NotificationDeliveryProvider {
  deliver(notificationId: string): DeliveryResult;
}

export const InAppNotificationProvider: NotificationDeliveryProvider = {
  deliver(notificationId: string): DeliveryResult {
    try {
      notificationRepository.markSent(notificationId);
      return { ok: true };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'حدث خطأ غير متوقع أثناء تسليم الإشعار.';
      notificationRepository.markFailed(notificationId, reason);
      return { ok: false, failureReason: reason };
    }
  },
};
