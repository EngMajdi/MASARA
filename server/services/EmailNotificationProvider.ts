import type { DeliveryResult, NotificationDeliveryPayload, NotificationDeliveryProvider } from './NotificationDeliveryProvider';

// Phase 5C — an honest provider BOUNDARY, not a real integration (see
// PushNotificationProvider.ts's header comment for the full rationale —
// identical here: no email SDK/SMTP client installed, no email provider
// credentials configured). Unlike SMS/Push, a recipient's email address
// genuinely exists already (`users.email`, via NotificationDeliveryPayload
// .recipient.email) — but having an address to send to does not make a
// real delivery mechanism appear; no vendor is fabricated just because the
// address happens to be available.

function isEnabled(): boolean {
  return process.env.NOTIFICATION_EMAIL_ENABLED === 'true';
}

function hasCredentials(): boolean {
  return !!process.env.EMAIL_PROVIDER_API_KEY;
}

export const EmailNotificationProvider: NotificationDeliveryProvider = {
  channel: 'EMAIL',
  deliver(_payload: NotificationDeliveryPayload): DeliveryResult {
    if (!isEnabled()) {
      return { outcome: 'SKIPPED', failureReason: 'قناة البريد الإلكتروني غير مُفعّلة.' };
    }
    if (!hasCredentials()) {
      return { outcome: 'UNAVAILABLE', failureReason: 'بيانات اعتماد مزود البريد الإلكتروني غير مُهيأة.' };
    }
    // No real email vendor/SMTP integration exists in this phase — fails
    // closed honestly rather than pretending an email was sent.
    return { outcome: 'UNAVAILABLE', failureReason: 'لا يوجد تكامل فعلي مع مزود بريد إلكتروني بعد.' };
  },
};
