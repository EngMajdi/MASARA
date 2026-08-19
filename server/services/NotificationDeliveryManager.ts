import { InAppNotificationProvider } from './NotificationDeliveryProvider';
import { PushNotificationProvider } from './PushNotificationProvider';
import { SmsNotificationProvider } from './SmsNotificationProvider';
import { EmailNotificationProvider } from './EmailNotificationProvider';
import type { DeliveryResult, NotificationChannel, NotificationDeliveryPayload, NotificationDeliveryProvider } from './NotificationDeliveryProvider';

// Phase 5C — the single orchestration point between NotificationService and
// every provider (spec "Delivery Orchestration": prefer NotificationService
// -> NotificationDeliveryManager -> Provider rather than scattering provider
// calls throughout routes or domain services). Resolves ALL known channels
// for every notification — IN_APP always attempted (and always the one
// that matters: it is the only surface a parent can currently read from),
// PUSH/SMS/EMAIL attempted too but structurally incapable of ever
// succeeding in this phase (see each provider's own header comment).
//
// PERSISTENCE DECISION (no migration, spec "Database" section): the
// `notifications` table's existing status/sentAt/failedAt/failureReason
// columns (Phase 5B) continue to represent the IN_APP channel specifically
// — that has been their meaning since Phase 5B and nothing here changes
// it. PUSH/SMS/EMAIL results are NOT persisted per-channel: since every
// external channel deterministically returns SKIPPED/UNAVAILABLE (never
// SUCCESS) until a real vendor is integrated, persisting that non-outcome
// on every single notification row forever would be pure noise, not a
// historical fact worth a schema change for. The results ARE still
// returned to the caller (in-memory only) so tests/observability code can
// inspect them without a migration.
const PROVIDERS: NotificationDeliveryProvider[] = [InAppNotificationProvider, PushNotificationProvider, SmsNotificationProvider, EmailNotificationProvider];

export interface ChannelDeliveryResult extends DeliveryResult {
  channel: NotificationChannel;
}

/**
 * Calls every registered provider for one notification, IN PARALLEL. A
 * provider that throws synchronously OR rejects its promise is caught and
 * reported as FAILED for that channel only — one misbehaving channel must
 * never prevent the others (especially IN_APP) from being attempted, and
 * must never propagate into the caller (NotificationService) or crash
 * notification processing (spec "fail safely" / "Provider failure must be
 * isolated"). Each provider call is wrapped in its own try/catch inside an
 * `async` mapper function specifically so a synchronous throw (before a
 * provider even returns a promise) and an asynchronous rejection (a real
 * `await fetch(...)` failing) are caught identically — never two different
 * failure paths to keep in sync.
 *
 * Phase 6C: async top to bottom (see NotificationDeliveryProvider.ts's
 * header comment for why) — the caller (NotificationService) now awaits
 * this.
 *
 * `providers` defaults to the real 4-provider list and is never overridden
 * in production code anywhere in this repository — the parameter exists
 * solely so tests can exercise the try/catch resilience path with a
 * test-local fake provider (spec: "tests may use a controlled fake
 * provider, but production code must distinguish FAKE_TEST_PROVIDER from
 * REAL_PROVIDER" — the fake never lives in this file or any other
 * production module, only inline in the test that needs it).
 */
export async function deliverToAllChannels(
  payload: NotificationDeliveryPayload,
  providers: NotificationDeliveryProvider[] = PROVIDERS
): Promise<ChannelDeliveryResult[]> {
  return Promise.all(
    providers.map(async (provider): Promise<ChannelDeliveryResult> => {
      try {
        const result = await provider.deliver(payload);
        return { channel: provider.channel, ...result };
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'حدث خطأ غير متوقع أثناء محاولة التسليم.';
        return { channel: provider.channel, outcome: 'FAILED' as const, failureReason: reason };
      }
    })
  );
}
