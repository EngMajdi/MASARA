import type { DeliveryResult, NotificationDeliveryPayload, NotificationDeliveryProvider } from './NotificationDeliveryProvider';

// Phase 5C/5D — an honest provider BOUNDARY, not a real integration (see
// PushNotificationProvider.ts's header comment for the full rationale —
// identical here: no SMS SDK installed, no SMS credentials configured, no
// real vendor fabricated).
//
// Phase 6B update: `users` still has no phone column of its own, but a
// parent can now register a verified SMS user_contact (Phase 6A/6B).
// NotificationService resolves that into `payload.recipient.smsAddress`
// when a verified+enabled one exists — this provider gates on its
// presence below, but even when an address IS available, this deployment
// still has no real SMS vendor SDK to send it through, so the outcome
// stays UNAVAILABLE either way. This stays at Phase 5C integration depth
// on purpose (no vendor call is ever attempted), not by oversight.

function isEnabled(): boolean {
  return process.env.NOTIFICATION_SMS_ENABLED === 'true';
}

function hasCredentials(): boolean {
  return !!process.env.SMS_PROVIDER_API_KEY;
}

export const SmsNotificationProvider: NotificationDeliveryProvider = {
  channel: 'SMS',
  deliver(payload: NotificationDeliveryPayload): DeliveryResult {
    if (!isEnabled()) {
      return { outcome: 'SKIPPED', failureReason: 'قناة الرسائل النصية (SMS) غير مُفعّلة.' };
    }
    if (!hasCredentials()) {
      return { outcome: 'UNAVAILABLE', failureReason: 'بيانات اعتماد مزود SMS غير مُهيأة.' };
    }
    if (!payload.recipient.smsAddress) {
      return { outcome: 'UNAVAILABLE', failureReason: 'لا توجد جهة اتصال SMS موثّقة ومفعّلة لهذا المستلم.' };
    }
    // No real SMS vendor SDK is integrated in this phase — fails closed
    // honestly rather than pretending a text message was sent.
    return { outcome: 'UNAVAILABLE', failureReason: 'لا يوجد تكامل فعلي مع مزود رسائل SMS بعد.' };
  },
};
