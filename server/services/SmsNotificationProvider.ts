import type { DeliveryResult, NotificationDeliveryPayload, NotificationDeliveryProvider } from './NotificationDeliveryProvider';
import { sanitizeProviderErrorMessage } from './NotificationDeliveryProvider';

// Phase 5C/5D/6C — an honest provider BOUNDARY, not a real integration (see
// PushNotificationProvider.ts's header comment for the full rationale —
// identical here: no SMS SDK installed, no SMS credentials configured, no
// real vendor fabricated).
//
// Phase 6B: `users` still has no phone column of its own, but a parent can
// now register a verified SMS user_contact (Phase 6A/6B). NotificationService
// resolves that into `payload.recipient.smsAddress` when a verified+enabled
// one exists — this provider gates on its presence below.
//
// Phase 6C: `deliver` is now async (see NotificationDeliveryProvider.ts's
// header comment), and the same generic 2xx/4xx/5xx/timeout/exception
// mapping Phase 5D built for EMAIL is mirrored here as pure, directly
// tested functions — vendor-agnostic HTTP status classification, not a
// specific vendor's SDK. Even with a resolved address, this deployment
// still has no real SMS vendor SDK to send it through, so the outcome
// stays UNAVAILABLE either way — no vendor call is ever attempted, not by
// oversight.

function isEnabled(): boolean {
  return process.env.NOTIFICATION_SMS_ENABLED === 'true';
}

function hasCredentials(): boolean {
  return !!process.env.SMS_PROVIDER_API_KEY;
}

/** The shape a real vendor's HTTP response would take — never the raw response object itself. */
export interface SmsProviderResponse {
  httpStatus: number;
  providerMessageId?: string;
}

/** Pure, deterministic — never converts a timeout, 4xx, 5xx, or missing-credential into SUCCESS. */
export function classifySmsProviderResponse(response: SmsProviderResponse): DeliveryResult {
  if (response.httpStatus >= 200 && response.httpStatus < 300) {
    return { outcome: 'SUCCESS', providerMessageId: response.providerMessageId };
  }
  if (response.httpStatus >= 400 && response.httpStatus < 500) {
    return { outcome: 'FAILED', failureReason: `مزود SMS رفض الطلب (HTTP ${response.httpStatus}) — خطأ دائم لا داعي لإعادة المحاولة.` };
  }
  return { outcome: 'FAILED', failureReason: `مزود SMS أعاد خطأ خادم (HTTP ${response.httpStatus}).` };
}

/** True only for outcomes a real retry policy would ever consider (5xx / timeout) — never for a 4xx. */
export function isSmsFailureRetryable(outcome: { httpStatus?: number; timedOut?: boolean }): boolean {
  if (outcome.timedOut) return true;
  return typeof outcome.httpStatus === 'number' && outcome.httpStatus >= 500;
}

/** Always FAILED, message always sanitized before it becomes a DeliveryResult, a log line, or anything an API response could carry. */
export function classifySmsProviderError(err: unknown, timedOut = false): DeliveryResult {
  if (timedOut) {
    return { outcome: 'FAILED', failureReason: 'انتهت مهلة الاتصال بمزود SMS.' };
  }
  const raw = err instanceof Error ? err.message : 'خطأ غير متوقع أثناء الاتصال بمزود SMS.';
  return { outcome: 'FAILED', failureReason: sanitizeProviderErrorMessage(raw) };
}

export const SmsNotificationProvider: NotificationDeliveryProvider = {
  channel: 'SMS',
  async deliver(payload: NotificationDeliveryPayload): Promise<DeliveryResult> {
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
    // honestly rather than pretending a text message was sent. A real
    // vendor call would `await fetch(...)` here and feed the response
    // through classifySmsProviderResponse/classifySmsProviderError above.
    return { outcome: 'UNAVAILABLE', failureReason: 'لا يوجد تكامل فعلي مع مزود رسائل SMS بعد.' };
  },
};
