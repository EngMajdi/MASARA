import { auditRepository } from '../repositories/auditRepository';
import { journeyRepository } from '../repositories/journeyRepository';
import { tripRepository } from '../repositories/tripRepository';
import { busRepository } from '../repositories/busRepository';
import { routeRepository } from '../repositories/routeRepository';
import { notificationRepository } from '../repositories/notificationRepository';
import { resolveAuthorizedStudents } from './ParentAccessService';
import { isEligibleForNotification, resolveCategory, resolvePriority, formatNotificationContent } from './NotificationPolicy';
import { deliverToAllChannels } from './NotificationDeliveryManager';
import { resolveEmailAddress, resolveSmsAddress, resolvePushToken } from './ContactDeliveryResolution';
import type { NotificationCategory, NotificationPriority, NotificationStatus, NotificationView } from '../domain/notificationContract';
import type { GovernedUser } from './authz';

// Phase 5B/5C — the notification domain service. This file imports NO
// mutating function from JourneyService, JourneyStateMachine,
// TelemetryIngestionService, CurrentLocationProjectionService (write path),
// ActionExecutor, PolicyEngine, or MasaraOperationsAgent — the governance
// boundary holds by simple absence, exactly like every prior read-only
// phase. It never writes audit_logs (notifications are a communication
// projection, never a second audit trail, spec §12/§20).
//
// TRUSTED FACT -> ELIGIBILITY -> RECIPIENT -> DEDUPLICATION -> NOTIFICATION
// -> DELIVERY -> PARENT (spec §2/§35), never CLIENT -> EVENT -> NOTIFICATION:
// every notification created here traces back to a real audit_logs row
// this service only ever READS, filtered through NotificationPolicy's
// closed allow-list, for a recipient resolved exclusively via
// ParentAccessService.resolveAuthorizedStudents — never from client input.
//
// Phase 5C adds pluggable, provider-neutral DELIVERY on top of this
// unchanged creation pipeline (deliverToAllChannels/NotificationDeliveryManager)
// — creation and delivery remain two separate concepts: a notification
// exists and is readable by the parent in-app the moment insertIfAbsent
// creates its row, regardless of whether PUSH/SMS/EMAIL are configured,
// reachable, or even attempted.
//
// Phase 6B adds one more read-only step between creation and delivery:
// ContactDeliveryResolution resolves the actual address each external
// channel is attempted against (a verified+enabled user_contact, or the
// legacy users.email fallback for EMAIL specifically). This file still
// creates and reads only notifications/audit_logs rows — contact
// resolution never creates, verifies, or mutates a contact.

export class NotificationNotFoundError extends Error {}
export class NotificationAccessDeniedError extends Error {}

/**
 * Scans one parent's authorized students' Journey audit history for
 * eligible events not yet notified, and creates + delivers a notification
 * for each. Lazy, on-demand — triggered only from the read endpoints below,
 * never a background job or timer (this codebase's established "no server
 * timers" discipline, and the exact same reconciliation-on-read shape
 * Phase 4E already used for ETA accuracy). Reads
 * auditRepository.findByStudentId per authorized student — at this pilot's
 * scale that is a handful of journeys' worth of rows, not a fleet-wide
 * scan; a bounded/cursor-based version is a documented future
 * optimization, not a demonstrated need today (see final report).
 */
export function processPendingNotificationsForParent(parentUser: GovernedUser): void {
  const students = resolveAuthorizedStudents(parentUser);
  for (const student of students) {
    const events = auditRepository.findByStudentId(student.id);
    for (const event of events) {
      // Defensive allow-list (spec §8/§20): never trust "this table happens
      // to only contain Journey rows" alone. entityType must be 'journey'
      // AND the eventType must be in the closed parent-visible map.
      if (event.entityType !== 'journey') continue;
      if (!isEligibleForNotification(event.eventType)) continue;
      if (!event.entityId) continue;

      const journey = journeyRepository.findById(event.entityId);
      if (!journey) continue;
      const trip = tripRepository.findById(journey.tripId);
      if (!trip) continue;
      const bus = busRepository.findById(trip.busId);
      const stop = journey.currentStopId ? routeRepository.findStopById(journey.currentStopId) : null;

      const content = formatNotificationContent(event.eventType, {
        studentName: student.name,
        busLabel: bus?.busNumber ?? 'الحافلة',
        stopName: stop?.name ?? null,
      });
      const category = resolveCategory(event.eventType);
      const priority = resolvePriority(event.eventType);
      if (!content || !category || !priority) continue; // unreachable given isEligibleForNotification, kept defensive

      const createdId = notificationRepository.insertIfAbsent({
        recipientUserId: parentUser.id,
        studentId: student.id,
        journeyId: journey.id,
        tripId: trip.id,
        eventType: event.eventType,
        sourceEventId: event.id,
        category,
        title: content.title,
        body: content.body,
        priority,
      });
      // insertIfAbsent returns null when the (recipient, sourceEventId)
      // pair already exists (spec §10) — reprocessing is then a genuine
      // no-op, including skipping re-delivery of an already-delivered row.
      // Delivery never creates another notification row and never repeats
      // for an existing one — it only ever runs once, immediately after
      // insertIfAbsent actually creates a NEW row (spec "Retry /
      // Idempotency": delivery must operate on the same notification,
      // never trigger a second creation).
      if (createdId) {
        // Phase 6B — recipient resolution now prefers the governed
        // user_contacts model over raw users.email (see
        // ContactDeliveryResolution.ts for the full precedence policy).
        // This is a pure read: no contact row is created, mutated, or
        // verified here — only an existing verified+enabled row (if any)
        // is looked up.
        const emailResolution = resolveEmailAddress(parentUser);
        deliverToAllChannels({
          notificationId: createdId,
          title: content.title,
          body: content.body,
          priority,
          recipient: {
            userId: parentUser.id,
            email: emailResolution.address,
            name: parentUser.name,
            smsAddress: resolveSmsAddress(parentUser.id) ?? undefined,
            pushToken: resolvePushToken(parentUser.id) ?? undefined,
          },
        });
      }
    }
  }
}

function toView(row: NonNullable<ReturnType<typeof notificationRepository.findById>>): NotificationView {
  return {
    id: row.id,
    studentId: row.studentId,
    category: row.category as NotificationCategory,
    title: row.title,
    body: row.body,
    priority: row.priority as NotificationPriority,
    status: row.status as NotificationStatus,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    readAt: row.readAt ? row.readAt.toISOString() : null,
  };
}

/** Reconciles (bounded to this parent's own authorized students, on-demand), then returns a bounded, newest-first page. */
export function getNotificationsForParent(parentUser: GovernedUser, limit?: number): NotificationView[] {
  processPendingNotificationsForParent(parentUser);
  return notificationRepository.findByRecipient(parentUser.id, limit).map(toView);
}

export function getUnreadCountForParent(parentUser: GovernedUser): number {
  processPendingNotificationsForParent(parentUser);
  return notificationRepository.countUnreadByRecipient(parentUser.id);
}

/** Ownership is re-derived from the row itself, never from client-supplied context (spec §18/§21) — a parent can only ever mark their OWN notification read. */
export function markNotificationRead(parentUser: GovernedUser, notificationId: string): NotificationView {
  const row = notificationRepository.findById(notificationId);
  if (!row) throw new NotificationNotFoundError('الإشعار غير موجود.');
  if (row.recipientUserId !== parentUser.id) {
    throw new NotificationAccessDeniedError('هذا الإشعار لا يخص هذا الحساب.');
  }
  notificationRepository.markRead(notificationId);
  return toView(notificationRepository.findById(notificationId)!);
}
