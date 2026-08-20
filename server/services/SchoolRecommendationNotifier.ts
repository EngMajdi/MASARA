import { userRepository } from '../repositories/userRepository';
import { busRepository } from '../repositories/busRepository';
import { resolveEmailAddress, resolveSmsAddress, resolvePushToken } from './ContactDeliveryResolution';
import { deliverToAllChannels, type ChannelDeliveryResult } from './NotificationDeliveryManager';
import { EmailNotificationProvider } from './EmailNotificationProvider';
import { SmsNotificationProvider } from './SmsNotificationProvider';
import { PushNotificationProvider } from './PushNotificationProvider';
import type { NotificationPriority } from '../domain/notificationContract';
import type { GovernedUser } from './authz';

// Phase 7D — resolves and notifies the SCHOOL operational recipient for an
// approved NOTIFY_SCHOOL recommendation. Deliberately NOT NotificationService.ts
// (Phase 5B): that pipeline is PARENT/Journey-event specific end to end —
// its `notifications` table requires a NOT NULL studentId/journeyId (this
// is a bus/trip-level operational notification, not a per-student Journey
// communication), its eligibility map (NotificationPolicy's closed 6-event
// Journey allow-list) has no entry for a delay recommendation, and its
// recipient resolution (ParentAccessService.resolveAuthorizedStudents) is
// parent-specific by design. Reusing that pipeline unchanged would mean
// fabricating a studentId/journeyId that does not exist for this kind of
// event — not a legitimate reuse, so this file exists instead. Parent
// authorization and school operational authorization are different
// domains (spec Phase 7D) — ParentAccessService is never imported here.
//
// What IS reused, unchanged: ContactDeliveryResolution (already
// role-agnostic — resolves any GovernedUser's contacts, not parent-only),
// deliverToAllChannels's exact resilience wrapper, and the exact same
// provider abstraction/classification logic (EmailNotificationProvider/
// SmsNotificationProvider/PushNotificationProvider, NotificationDeliveryPayload,
// DeliveryResult) Phase 5C/5D/6C already built and tested. No new provider,
// no new outcome vocabulary, no new "notification created" concept.
//
// InAppNotificationProvider is deliberately NOT invoked here: it works by
// updating an EXISTING `notifications` row (notificationRepository.markSent
// by id), and no such row is ever created for a school recipient — there is
// no school-facing "notifications inbox" surface in this codebase, and
// calling it with a fabricated id would silently no-op while still
// reporting SUCCESS (a fabricated result, exactly what this phase forbids).
// This is an honest architectural finding: in the CURRENT deployment, no
// channel can achieve genuine SUCCESS for a school recipient either — no
// vendor credentials are configured for EMAIL/SMS/PUSH, unchanged since
// Phase 5C/5D/6C's own audits. That absence is reported honestly by each
// provider's own UNAVAILABLE/SKIPPED outcome, never overridden here.

export interface SchoolNotificationOutcome {
  attempted: boolean;
  recipientUserId: string | null;
  channelResults: ChannelDeliveryResult[];
}

/** Deterministic: the earliest-created 'school'-role user for this school wins — never random, mirroring the "deterministic tiebreak" discipline Phase 6B established for contact selection. */
function resolveSchoolRecipient(schoolId: string): GovernedUser | null {
  const candidates = userRepository.findAll().filter((u) => u.role === 'school' && u.schoolId === schoolId);
  if (candidates.length === 0) return null;
  return candidates.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))[0];
}

/**
 * `notificationId` in the resulting payload is the recommendation's own id
 * — not a `notifications` table row (none exists for this kind of event).
 * It is passed through only because `deriveDeliveryIdempotencyKey` and a
 * future real vendor call use it as the idempotency-key value; today no
 * provider in this deployment makes a real call, so it has no other
 * effect. This is the "existing recommendation identity as the stable
 * execution identity" the spec calls for — nothing new is generated.
 */
export async function notifySchoolOfSignificantDelay(params: {
  busId: string | null;
  recommendationId: string;
  title: string;
  body: string;
  priority: NotificationPriority;
}): Promise<SchoolNotificationOutcome> {
  const bus = params.busId ? busRepository.findById(params.busId) : null;
  if (!bus) {
    return { attempted: false, recipientUserId: null, channelResults: [] };
  }

  const recipient = resolveSchoolRecipient(bus.schoolId);
  if (!recipient) {
    return { attempted: false, recipientUserId: null, channelResults: [] };
  }

  const emailResolution = resolveEmailAddress(recipient);
  const channelResults = await deliverToAllChannels(
    {
      notificationId: params.recommendationId,
      title: params.title,
      body: params.body,
      priority: params.priority,
      recipient: {
        userId: recipient.id,
        email: emailResolution.address,
        name: recipient.name,
        smsAddress: resolveSmsAddress(recipient.id) ?? undefined,
        pushToken: resolvePushToken(recipient.id) ?? undefined,
      },
    },
    // Deliberately excludes InAppNotificationProvider — see header comment.
    [EmailNotificationProvider, SmsNotificationProvider, PushNotificationProvider]
  );

  return { attempted: true, recipientUserId: recipient.id, channelResults };
}
