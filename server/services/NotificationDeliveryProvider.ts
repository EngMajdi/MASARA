import { notificationRepository } from '../repositories/notificationRepository';
import type { NotificationPriority } from '../domain/notificationContract';

// Phase 5B/5C — provider-neutral delivery abstraction. Nothing in
// NotificationService/NotificationDeliveryManager depends on HOW a
// notification reaches a parent, only on this interface. A future real
// PushNotificationProvider/SmsNotificationProvider/EmailNotificationProvider
// implements the same shape without NotificationService's, NotificationPolicy's,
// or ParentAccessService's domain logic changing at all.

export type NotificationChannel = 'IN_APP' | 'PUSH' | 'SMS' | 'EMAIL';

/**
 * Four distinct outcomes (Phase 5C), never collapsed into a boolean:
 *   SUCCESS     — the channel actually delivered (or, for IN_APP, made the
 *                 notification visible in the parent's own read API).
 *   FAILED      — a real delivery attempt was made and it threw/errored.
 *   UNAVAILABLE — the channel is enabled but cannot actually deliver right
 *                 now (missing credentials, or — in this phase — no real
 *                 vendor integration exists at all). Never reported as
 *                 SUCCESS; this is the honest default for PUSH/SMS/EMAIL
 *                 today, since no external provider is connected.
 *   SKIPPED     — the channel is disabled by configuration; no attempt was
 *                 made at all.
 */
export type DeliveryOutcome = 'SUCCESS' | 'FAILED' | 'UNAVAILABLE' | 'SKIPPED';

export interface DeliveryResult {
  outcome: DeliveryOutcome;
  failureReason?: string;
  /** Phase 5D — a real vendor's own message/request id, when it returns one on SUCCESS. Never a raw provider response, never a credential. Not persisted anywhere today (see NotificationDeliveryManager's header comment) — returned in-memory only. */
  providerMessageId?: string;
}

// Phase 5D — shared credential-redaction for provider error messages (spec
// "External Provider Security": never let a provider error leak an
// Authorization header, API key, or bearer token). Every provider's
// exception-classification path runs its message through this before it
// ever becomes a DeliveryResult.failureReason, a log line, or (in principle)
// anything that could reach an API response.
const SECRET_LIKE_PATTERNS: RegExp[] = [
  /bearer\s+[a-z0-9._-]+/gi,
  /api[_-]?key["']?\s*[:=]\s*["']?[a-z0-9._-]{8,}/gi,
  /authorization["']?\s*[:=]\s*["']?[a-z0-9._-]{8,}/gi,
  /sk_[a-z0-9]{8,}/gi,
];

export function sanitizeProviderErrorMessage(raw: string): string {
  let sanitized = raw;
  for (const pattern of SECRET_LIKE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return sanitized;
}

/**
 * Exactly the already-deterministic content NotificationPolicy produced —
 * a provider receives this payload verbatim and can never alter it, never
 * regenerate it, never call an LLM. `recipient` carries only what the
 * governed `users` table already has (id/email/name) — no phone number or
 * push token exists anywhere in this schema, so a provider that needed one
 * would have nothing to send to; that is itself part of why PUSH/SMS remain
 * honest UNAVAILABLE boundaries in this phase rather than real integrations.
 */
export interface NotificationDeliveryPayload {
  notificationId: string;
  title: string;
  body: string;
  priority: NotificationPriority;
  recipient: { userId: string; email: string; name: string };
}

export interface NotificationDeliveryProvider {
  readonly channel: NotificationChannel;
  deliver(payload: NotificationDeliveryPayload): DeliveryResult;
}

/**
 * The one REAL implementation (unchanged from Phase 5B in behavior): for an
 * in-app notification, "delivery" IS the row existing in a table the
 * parent's own read API already serves, so there is no separate
 * transmission step to simulate. This is also the only provider whose
 * result is persisted onto the `notifications` row itself
 * (status/sentAt/failedAt) — those columns have represented the IN_APP
 * channel specifically since Phase 5B, and continue to (see
 * NotificationDeliveryManager's header comment for why Phase 5C adds no
 * migration for the new external channels).
 */
export const InAppNotificationProvider: NotificationDeliveryProvider = {
  channel: 'IN_APP',
  deliver(payload: NotificationDeliveryPayload): DeliveryResult {
    try {
      notificationRepository.markSent(payload.notificationId);
      return { outcome: 'SUCCESS' };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'حدث خطأ غير متوقع أثناء تسليم الإشعار.';
      notificationRepository.markFailed(payload.notificationId, reason);
      return { outcome: 'FAILED', failureReason: reason };
    }
  },
};
