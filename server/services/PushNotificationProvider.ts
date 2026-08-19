import type { DeliveryResult, NotificationDeliveryPayload, NotificationDeliveryProvider } from './NotificationDeliveryProvider';

// Phase 5C/5D — an honest provider BOUNDARY, not a real integration. The
// architecture audit (re-confirmed in Phase 5D) found no push SDK
// installed in this repository (no firebase-admin/web-push/OneSignal
// dependency) and no push credentials exist anywhere in .env.example — per
// spec, a real vendor is never fabricated. This provider NEVER reports
// SUCCESS; there is no real transport for it to succeed through.
//
// Phase 6B update: a push token does not exist on `users` and never will
// (no such column), but a parent can now register a verified PUSH
// user_contact (Phase 6A/6B) — the actual device-registration concept the
// header comment above used to say was out of scope. NotificationService
// resolves a verified+enabled one into `payload.recipient.pushToken`; this
// provider gates on its presence below. Even when a token IS available,
// this deployment still has no real push vendor SDK to send it through,
// so the outcome stays UNAVAILABLE either way — this provider stays at
// its Phase 5C integration depth on purpose, not by oversight. It exists
// so a future real PushNotificationProvider is a drop-in replacement for
// this exact file — same `channel`, same `deliver(payload)` signature —
// without NotificationService, NotificationDeliveryManager,
// NotificationPolicy, or ParentAccessService changing at all.

function isEnabled(): boolean {
  return process.env.NOTIFICATION_PUSH_ENABLED === 'true';
}

function hasCredentials(): boolean {
  return !!process.env.PUSH_PROVIDER_API_KEY;
}

export const PushNotificationProvider: NotificationDeliveryProvider = {
  channel: 'PUSH',
  deliver(payload: NotificationDeliveryPayload): DeliveryResult {
    if (!isEnabled()) {
      return { outcome: 'SKIPPED', failureReason: 'قناة الإشعارات الفورية (Push) غير مُفعّلة.' };
    }
    if (!hasCredentials()) {
      return { outcome: 'UNAVAILABLE', failureReason: 'بيانات اعتماد مزود Push غير مُهيأة.' };
    }
    if (!payload.recipient.pushToken) {
      return { outcome: 'UNAVAILABLE', failureReason: 'لا توجد جهة اتصال Push موثّقة ومفعّلة لهذا المستلم.' };
    }
    // Reaching here means the channel is enabled, a credential is
    // present, and a real recipient token was resolved, but this phase
    // still integrates NO real push vendor SDK (spec: never call a fake
    // HTTP endpoint, never fabricate delivery) — fails closed honestly
    // rather than pretending a push was sent.
    return { outcome: 'UNAVAILABLE', failureReason: 'لا يوجد تكامل فعلي مع مزود إشعارات Push بعد.' };
  },
};
