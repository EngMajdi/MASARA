import { PARENT_NOTIFICATION_EVENT_TYPES, type NotificationCategory, type NotificationContent, type NotificationPriority } from '../domain/notificationContract';

// Phase 5B — deterministic notification policy. Pure functions only: no DB
// access, no side effects, no AI. "Should this trusted event produce a
// parent notification, and if so with what priority/wording?" — nothing
// more. Never mutates Journey/Trip/Bus/ETA/Location (spec §9).
//
// PER-EVENT DECISIONS (every one of JourneyStateMachine's 11 real event
// types was considered — see server/domain/eventTaxonomy.ts's
// OPERATIONAL_EVENT_TYPES for the closed vocabulary this is audited
// against):
//
//   JOURNEY_CREATED      -> SUPPRESSED. Fires the moment a Journey row is
//                           lazily backfilled (ensureJourneysForTrip — often
//                           just because an operator opened a dashboard).
//                           Nothing has actually happened to the child yet;
//                           there is nothing true to tell the parent.
//   JOURNEY_STARTED       -> SUPPRESSED. An intermediate scheduling-state
//                           transition (trip moving from scheduled->waiting),
//                           not yet a concrete physical fact about the
//                           child. Notifying here would be the first step
//                           toward alert fatigue for no real information.
//   BOARDING_STARTED      -> SUPPRESSED. "Boarding has begun" is almost
//                           immediately followed by STUDENT_BOARDED, which
//                           is the actionable, unambiguous fact parents
//                           actually want ("my child is on the bus",
//                           spec §9's own example). Notifying both would be
//                           the exact double-notification spam spec §10
//                           warns against for two facts a few seconds apart.
//   STUDENT_BOARDED        -> NOTIFY, NORMAL. The clearest positive fact:
//                           the child is physically on the bus.
//   TRANSIT_STARTED        -> SUPPRESSED. "The bus is now moving" duplicates
//                           what the existing live ETA/location panel
//                           (Phase 4C/4D, ParentJourneyPanel) already shows
//                           continuously — a notification adds no new fact,
//                           only noise.
//   STOP_APPROACHING       -> NOTIFY, NORMAL. Actionable: "be ready".
//   STUDENT_DROPPED_OFF    -> NOTIFY, NORMAL. The other clear positive fact
//                           parents want confirmed.
//   JOURNEY_COMPLETED      -> SUPPRESSED. Fires immediately after
//                           STUDENT_DROPPED_OFF with no new fact for the
//                           parent — it is Journey Core's own bookkeeping
//                           closure (dropped_off -> completed), not
//                           something that happened to the child. Notifying
//                           here would be a near-duplicate of the drop-off
//                           notification the parent already received
//                           seconds earlier (spec §9's own explicit warning
//                           against this exact case).
//   STUDENT_MISSED          -> NOTIFY, HIGH. The child did not board —
//                           parents need to know promptly.
//   JOURNEY_CANCELLED       -> NOTIFY, HIGH. The trip itself was cancelled.
//   JOURNEY_INCIDENT        -> NOTIFY, CRITICAL. The most severe category
//                           available. JourneyService.markIncident carries
//                           no independent severity field to grade against
//                           (unlike the separate `incidents` table's own
//                           low/medium/high, a different domain object not
//                           tied 1:1 to this Journey event), so this policy
//                           deliberately always treats a Journey-affecting
//                           incident as CRITICAL — under-alerting on a
//                           safety-adjacent event is worse than
//                           over-alerting.
//
// Net result: 6 of 11 real event types are eligible, 5 are suppressed —
// every decision made once, here, and nowhere else (spec §8's single
// source of truth requirement).

export function isEligibleForNotification(eventType: string): boolean {
  return Object.prototype.hasOwnProperty.call(PARENT_NOTIFICATION_EVENT_TYPES, eventType);
}

export function resolveCategory(eventType: string): NotificationCategory | null {
  return PARENT_NOTIFICATION_EVENT_TYPES[eventType]?.category ?? null;
}

export function resolvePriority(eventType: string): NotificationPriority | null {
  return PARENT_NOTIFICATION_EVENT_TYPES[eventType]?.priority ?? null;
}

export interface NotificationContext {
  studentName: string;
  busLabel: string;
  /** The stop the event concerns, when resolvable from journeys.currentStopId (spec §14 — safe context only, never coordinates). */
  stopName: string | null;
}

/**
 * Deterministic, template-based content — never an LLM, never dynamically
 * generated (spec §14). Deliberately omits: driver private info, device
 * identifiers, GPS coordinates, internal recommendation/prediction ids,
 * policy decisions, AI confidence, audit metadata, and — for
 * JOURNEY_INCIDENT specifically — the operator-entered `incidentReason`
 * free text, since its parent-appropriateness has never been reviewed; the
 * incident notification stays a safe, generic prompt to contact the school,
 * which remains the right channel for the actual detail.
 */
export function formatNotificationContent(eventType: string, ctx: NotificationContext): NotificationContent | null {
  switch (eventType) {
    case 'STUDENT_BOARDED':
      return { title: 'تم صعود الطالب إلى الحافلة', body: `صعد/ت ${ctx.studentName} إلى ${ctx.busLabel} بأمان.` };
    case 'STOP_APPROACHING':
      return {
        title: 'الحافلة تقترب',
        body: ctx.stopName
          ? `الحافلة ${ctx.busLabel} تقترب من ${ctx.stopName} لاستقبال ${ctx.studentName}.`
          : `الحافلة ${ctx.busLabel} تقترب من نقطة توقف ${ctx.studentName}.`,
      };
    case 'STUDENT_DROPPED_OFF':
      return {
        title: 'تم إيصال الطالب',
        body: ctx.stopName ? `تم إنزال ${ctx.studentName} عند ${ctx.stopName} بأمان.` : `تم إنزال ${ctx.studentName} بأمان.`,
      };
    case 'STUDENT_MISSED':
      return { title: 'تحديث بشأن الرحلة', body: `لم يصعد ${ctx.studentName} إلى ${ctx.busLabel} في هذه الرحلة.` };
    case 'JOURNEY_CANCELLED':
      return { title: 'تحديث بشأن الرحلة', body: `تم إلغاء رحلة ${ctx.studentName} على ${ctx.busLabel}.` };
    case 'JOURNEY_INCIDENT':
      return { title: 'تنبيه مهم بشأن الرحلة', body: `حدثت حادثة تتعلق برحلة ${ctx.studentName}. يرجى التواصل مع إدارة المدرسة لمزيد من التفاصيل.` };
    default:
      return null;
  }
}
