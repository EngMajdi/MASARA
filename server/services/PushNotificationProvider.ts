import type { DeliveryResult, NotificationDeliveryPayload, NotificationDeliveryProvider } from './NotificationDeliveryProvider';
import { sanitizeProviderErrorMessage } from './NotificationDeliveryProvider';

// Phase 5C/5D/6C — an honest provider BOUNDARY, not a real integration. The
// architecture audit (re-confirmed again in Phase 6C) found no push SDK
// installed in this repository (no firebase-admin/web-push/OneSignal
// dependency) and no push credentials exist anywhere in .env.example — per
// spec, a real vendor is never fabricated. This provider NEVER reports
// SUCCESS; there is no real transport for it to succeed through.
//
// Phase 6B: a push token does not exist on `users` and never will (no such
// column), but a parent can now register a verified PUSH user_contact
// (Phase 6A/6B). NotificationService resolves a verified+enabled one into
// `payload.recipient.pushToken`; this provider gates on its presence below.
//
// Phase 6C: `deliver` is now async (see NotificationDeliveryProvider.ts's
// header comment), and the same generic 2xx/4xx/5xx/timeout/exception
// mapping Phase 5D built for EMAIL is mirrored here as pure, directly
// tested functions. Even when a token IS available, this deployment still
// has no real push vendor SDK to send it through, so the outcome stays
// UNAVAILABLE either way — this provider stays at its Phase 5C integration
// depth on purpose, not by oversight. It exists so a future real
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

/** The shape a real vendor's HTTP response would take — never the raw response object itself. */
export interface PushProviderResponse {
  httpStatus: number;
  providerMessageId?: string;
}

/** Pure, deterministic — never converts a timeout, 4xx, 5xx, or missing-credential into SUCCESS. */
export function classifyPushProviderResponse(response: PushProviderResponse): DeliveryResult {
  if (response.httpStatus >= 200 && response.httpStatus < 300) {
    return { outcome: 'SUCCESS', providerMessageId: response.providerMessageId };
  }
  if (response.httpStatus >= 400 && response.httpStatus < 500) {
    return { outcome: 'FAILED', failureReason: `مزود Push رفض الطلب (HTTP ${response.httpStatus}) — خطأ دائم لا داعي لإعادة المحاولة.` };
  }
  return { outcome: 'FAILED', failureReason: `مزود Push أعاد خطأ خادم (HTTP ${response.httpStatus}).` };
}

/** True only for outcomes a real retry policy would ever consider (5xx / timeout) — never for a 4xx. */
export function isPushFailureRetryable(outcome: { httpStatus?: number; timedOut?: boolean }): boolean {
  if (outcome.timedOut) return true;
  return typeof outcome.httpStatus === 'number' && outcome.httpStatus >= 500;
}

/** Always FAILED, message always sanitized before it becomes a DeliveryResult, a log line, or anything an API response could carry. */
export function classifyPushProviderError(err: unknown, timedOut = false): DeliveryResult {
  if (timedOut) {
    return { outcome: 'FAILED', failureReason: 'انتهت مهلة الاتصال بمزود Push.' };
  }
  const raw = err instanceof Error ? err.message : 'خطأ غير متوقع أثناء الاتصال بمزود Push.';
  return { outcome: 'FAILED', failureReason: sanitizeProviderErrorMessage(raw) };
}

export const PushNotificationProvider: NotificationDeliveryProvider = {
  channel: 'PUSH',
  async deliver(payload: NotificationDeliveryPayload): Promise<DeliveryResult> {
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
    // rather than pretending a push was sent. A real vendor call would
    // `await fetch(...)` here and feed the response through
    // classifyPushProviderResponse/classifyPushProviderError above.
    return { outcome: 'UNAVAILABLE', failureReason: 'لا يوجد تكامل فعلي مع مزود إشعارات Push بعد.' };
  },
};
