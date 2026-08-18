import type { DeliveryResult, NotificationDeliveryPayload, NotificationDeliveryProvider } from './NotificationDeliveryProvider';
import { sanitizeProviderErrorMessage } from './NotificationDeliveryProvider';

// Phase 5D — a genuine, testable PROVIDER ADAPTER boundary for email, not
// just a config check (contrast with Push/Sms, which remain Phase-5C-level
// — see their own header comments for exactly why). `users.email` is real,
// already-existing contact information (used for login today), so unlike
// SMS/Push — no phone number or push token column exists ANYWHERE in this
// schema, confirmed by this phase's own architecture audit — email has a
// genuine recipient address to address, not a hypothetical one.
//
// STILL NO REAL VENDOR IS INTEGRATED (architecture audit, unchanged since
// Phase 5C: no email SDK/SMTP client is installed in package.json, no
// EMAIL_PROVIDER_API_KEY is ever configured in this deployment's .env).
// What Phase 5D adds is the REAL response/error CLASSIFICATION logic a
// genuine vendor call would need — exported as pure functions and directly
// unit-tested — so that the day real credentials and a real transport call
// are added, the outcome mapping (2xx -> SUCCESS with providerMessageId,
// 4xx -> FAILED and explicitly non-retryable, 5xx/timeout -> FAILED and
// retryable-in-principle, any other exception -> FAILED with the message
// sanitized) is already correct and already tested, not invented under
// pressure later.
//
// SYNCHRONOUS BY DESIGN: NotificationDeliveryProvider.deliver is, and
// remains, synchronous — a deliberate choice, not an oversight. A real
// HTTP call to an email vendor is inherently asynchronous; making `deliver`
// return `Promise<DeliveryResult>` would cascade into
// NotificationDeliveryManager, NotificationService, and the parent read
// routes all becoming async — a genuine architectural change this phase
// does not make absent real credentials to justify it ("do not redesign
// the architecture"). This is documented here as the concrete Phase 6
// dependency, not smuggled in as a side effect of "just adding a provider."
// Consequently `deliver()` below can never actually reach a real vendor
// call in this codebase today — it is gated at the same isEnabled/
// hasCredentials boundary Phase 5C already established, and even in a
// hypothetical enabled+credentialed state it still returns UNAVAILABLE,
// honestly, rather than pretending a synchronous call happened.
//
// RETRY POLICY (documented, not implemented as an automatic loop — spec:
// "If the current prototype does not have durable retry infrastructure,
// document the limitation instead of inventing a queue system"): this
// prototype has no queue/worker/background job runner anywhere (an
// established discipline carried through every prior phase). A 5xx or
// timeout is classified as retryable-in-principle (isRetryableFailure
// below), but no automatic retry is ever scheduled or executed — a future
// real integration with durable retry infrastructure is exactly the kind
// of Phase 6 decision this boundary is designed to accept without
// NotificationService/NotificationPolicy/ParentAccessService changing.

function isEnabled(): boolean {
  return process.env.NOTIFICATION_EMAIL_ENABLED === 'true';
}

function hasCredentials(): boolean {
  return !!process.env.EMAIL_PROVIDER_API_KEY;
}

/** The shape a real vendor's HTTP response would take — never the raw response object itself (never logged, never returned to any API caller). */
export interface EmailProviderResponse {
  httpStatus: number;
  providerMessageId?: string;
}

/**
 * Pure, deterministic, directly unit-tested. Never guesses an unknown or
 * error status into SUCCESS (spec: never convert a timeout, 4xx, 5xx, or
 * missing-credential into SUCCESS) — only a genuine 2xx does.
 */
export function classifyEmailProviderResponse(response: EmailProviderResponse): DeliveryResult {
  if (response.httpStatus >= 200 && response.httpStatus < 300) {
    return { outcome: 'SUCCESS', providerMessageId: response.providerMessageId };
  }
  if (response.httpStatus >= 400 && response.httpStatus < 500) {
    return { outcome: 'FAILED', failureReason: `مزود البريد الإلكتروني رفض الطلب (HTTP ${response.httpStatus}) — خطأ دائم لا داعي لإعادة المحاولة.` };
  }
  return { outcome: 'FAILED', failureReason: `مزود البريد الإلكتروني أعاد خطأ خادم (HTTP ${response.httpStatus}).` };
}

/** True only for outcomes a real retry policy would ever consider (5xx / timeout) — never for a 4xx (permanent client error, e.g. bad request or rejected sender). */
export function isRetryableFailure(outcome: { httpStatus?: number; timedOut?: boolean }): boolean {
  if (outcome.timedOut) return true;
  return typeof outcome.httpStatus === 'number' && outcome.httpStatus >= 500;
}

/** Handles a thrown exception or a timeout from a (hypothetical) real call — always FAILED, message always sanitized before it becomes a DeliveryResult, a log line, or anything an API response could carry. */
export function classifyEmailProviderError(err: unknown, timedOut = false): DeliveryResult {
  if (timedOut) {
    return { outcome: 'FAILED', failureReason: 'انتهت مهلة الاتصال بمزود البريد الإلكتروني.' };
  }
  const raw = err instanceof Error ? err.message : 'خطأ غير متوقع أثناء الاتصال بمزود البريد الإلكتروني.';
  return { outcome: 'FAILED', failureReason: sanitizeProviderErrorMessage(raw) };
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
    // Reachable only if EMAIL_PROVIDER_API_KEY is ever configured — never
    // true in this deployment. Even then: no real transport call is made
    // here, since deliver() is synchronous and a real vendor call is not
    // (see header comment). Fails closed honestly rather than fabricating
    // a synchronous "success".
    return { outcome: 'UNAVAILABLE', failureReason: 'لا يوجد تكامل غير متزامن فعلي مع مزود بريد إلكتروني بعد.' };
  },
};
