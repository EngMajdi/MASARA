// Phase 5B — Governed Notifications. A notification COMMUNICATES an
// already-established Journey fact; it never creates one. Nothing here
// mutates Journey/Trip/Bus/Student/ETA/Location/Telemetry, and nothing here
// is an LLM output — every title/body is produced by a deterministic
// template over already-trusted context (see NotificationPolicy.ts).

export type NotificationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

/** Delivery status — distinct from read state (readAt). SENT + readAt=null means "delivered, not yet opened". */
export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED';

export type NotificationCategory = 'BOARDING' | 'ARRIVAL' | 'DROPPED_OFF' | 'STATUS' | 'INCIDENT';

// ---------------------------------------------------------------------------
// The parent-visible event allow-list — the single source of truth for
// notification eligibility (spec §8). An event type absent from this map is
// SUPPRESSED by construction: NotificationPolicy.isEligibleForNotification
// does a map lookup, never a "default true" branch, so a newly-added
// internal event type (AI/governance/telemetry, or a future Journey event
// nobody has reviewed yet) is invisible to parents until someone
// deliberately adds it here. This is the actual security boundary, not a
// convention to remember to follow elsewhere.
//
// Audited against server/domain/eventTaxonomy.ts's OPERATIONAL_EVENT_TYPES
// and JourneyStateMachine.ts's JOURNEY_EVENT_TYPE_FOR_STATE — the complete,
// closed, 11-value real Journey event vocabulary. Every one of the 11 was
// considered; 6 are eligible, 5 are deliberately suppressed. See
// NotificationPolicy.ts's header comment for the full per-event rationale
// (this file states the decision; that file explains it).
// ---------------------------------------------------------------------------
export const PARENT_NOTIFICATION_EVENT_TYPES: Record<string, { category: NotificationCategory; priority: NotificationPriority }> = {
  STUDENT_BOARDED: { category: 'BOARDING', priority: 'NORMAL' },
  STOP_APPROACHING: { category: 'ARRIVAL', priority: 'NORMAL' },
  STUDENT_DROPPED_OFF: { category: 'DROPPED_OFF', priority: 'NORMAL' },
  STUDENT_MISSED: { category: 'STATUS', priority: 'HIGH' },
  JOURNEY_CANCELLED: { category: 'STATUS', priority: 'HIGH' },
  JOURNEY_INCIDENT: { category: 'INCIDENT', priority: 'CRITICAL' },
};

export interface NotificationContent {
  title: string;
  body: string;
}

/**
 * The public, parent-safe read-model DTO. No eventType, no sourceEventId,
 * no journeyId/tripId, no failureReason — a parent sees a safe
 * communication record, never the internal correlation machinery behind it
 * (spec §14/§23/§30). No separate studentName field either: the child's
 * name is already deterministically embedded in `body` by
 * NotificationPolicy's templates, so a second lookup to duplicate the same
 * fact in structured form would be pure N+1 risk for zero new information.
 */
export interface NotificationView {
  id: string;
  studentId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  priority: NotificationPriority;
  status: NotificationStatus;
  createdAt: string;
  sentAt: string | null;
  readAt: string | null;
}
