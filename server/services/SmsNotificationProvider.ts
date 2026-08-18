import type { DeliveryResult, NotificationDeliveryPayload, NotificationDeliveryProvider } from './NotificationDeliveryProvider';

// Phase 5C/5D — an honest provider BOUNDARY, not a real integration (see
// PushNotificationProvider.ts's header comment for the full rationale —
// identical here: no SMS SDK installed, no SMS credentials configured, no
// real vendor fabricated). A parent's phone number does not even exist
// anywhere in the governed schema today (only `drivers.phone` does) — a
// real SmsNotificationProvider would need that boundary resolved first,
// which is explicitly future/out-of-scope work, not invented here.
//
// Phase 5D re-confirmed this and specifically did NOT upgrade this
// provider the way EmailNotificationProvider was (real response/error
// classification logic) — with no phone number to address, there is
// nothing a real SMS call could even be attempted against. This stays at
// Phase 5C depth on purpose (spec STOP condition: missing contact
// information whose addition would require redesigning the identity
// model), not by oversight.

function isEnabled(): boolean {
  return process.env.NOTIFICATION_SMS_ENABLED === 'true';
}

function hasCredentials(): boolean {
  return !!process.env.SMS_PROVIDER_API_KEY;
}

export const SmsNotificationProvider: NotificationDeliveryProvider = {
  channel: 'SMS',
  deliver(_payload: NotificationDeliveryPayload): DeliveryResult {
    if (!isEnabled()) {
      return { outcome: 'SKIPPED', failureReason: 'قناة الرسائل النصية (SMS) غير مُفعّلة.' };
    }
    if (!hasCredentials()) {
      return { outcome: 'UNAVAILABLE', failureReason: 'بيانات اعتماد مزود SMS غير مُهيأة.' };
    }
    // No real SMS vendor SDK is integrated in this phase — fails closed
    // honestly rather than pretending a text message was sent.
    return { outcome: 'UNAVAILABLE', failureReason: 'لا يوجد تكامل فعلي مع مزود رسائل SMS بعد.' };
  },
};
