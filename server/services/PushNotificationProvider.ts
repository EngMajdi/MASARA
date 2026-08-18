import type { DeliveryResult, NotificationDeliveryPayload, NotificationDeliveryProvider } from './NotificationDeliveryProvider';

// Phase 5C — an honest provider BOUNDARY, not a real integration. The
// architecture audit confirmed no push SDK is installed in this repository
// (no firebase-admin/web-push/OneSignal dependency) and no push credentials
// exist anywhere in .env.example — per spec, a real vendor is never
// fabricated. This provider NEVER reports SUCCESS; there is no real
// transport for it to succeed through. It exists so a future real
// PushNotificationProvider is a drop-in replacement for this exact file —
// same `channel`, same `deliver(payload)` signature — without
// NotificationService, NotificationDeliveryManager, NotificationPolicy, or
// ParentAccessService changing at all.

function isEnabled(): boolean {
  return process.env.NOTIFICATION_PUSH_ENABLED === 'true';
}

function hasCredentials(): boolean {
  return !!process.env.PUSH_PROVIDER_API_KEY;
}

export const PushNotificationProvider: NotificationDeliveryProvider = {
  channel: 'PUSH',
  deliver(_payload: NotificationDeliveryPayload): DeliveryResult {
    if (!isEnabled()) {
      return { outcome: 'SKIPPED', failureReason: 'قناة الإشعارات الفورية (Push) غير مُفعّلة.' };
    }
    if (!hasCredentials()) {
      return { outcome: 'UNAVAILABLE', failureReason: 'بيانات اعتماد مزود Push غير مُهيأة.' };
    }
    // Reaching here means the channel is enabled and a credential is
    // present, but this phase still integrates NO real push vendor SDK
    // (spec: never call a fake HTTP endpoint, never fabricate delivery) —
    // fails closed honestly rather than pretending a push was sent.
    return { outcome: 'UNAVAILABLE', failureReason: 'لا يوجد تكامل فعلي مع مزود إشعارات Push بعد.' };
  },
};
