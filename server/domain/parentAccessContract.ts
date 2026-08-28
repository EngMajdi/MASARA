import type { JourneyState } from './JourneyStateMachine';

// Phase 5A — Parent Trust Read Model. This is a READ MODEL over Journey
// Core, Current Location Projection, and ETA Intelligence — it duplicates
// none of their logic (spec §5/§9/§10).
//
// PARENT IDENTITY — Phase 5A originally found no real parent<->student
// relation anywhere in the governed schema and resolved it with a single,
// explicitly-labeled DEMO-ONLY phone-number constant
// (`DEMO_PARENT_PHONE_BY_EMAIL`), read by ParentAccessService.
// resolveAuthorizedStudents. Phase 13 replaced that mechanism entirely: the
// governed `students` table now carries a real `legacyStudentId` foreign
// key (database/schema.ts) into the legacy store's already-real, already-
// tested `parentId` ownership FK (Phase 7K) — a genuine, stable,
// non-name/non-phone identity bridge. See ParentAccessService.ts for the
// current resolution chain and
// docs/PHASE_13_STUDENT_IDENTITY_AND_PARENT_LIVE_JOURNEY_REPORT.md for the
// full architecture decision. The DEMO-ONLY constant this comment used to
// document has been removed — nothing in the codebase reads it anymore.

/** "Currently under way" states (spec §13 tier 1 — active journey wins over today's/most-recent). */
export const JOURNEY_ACTIVE_STATES: readonly JourneyState[] = ['waiting', 'boarding', 'on_bus', 'in_transit', 'approaching_stop'];

// Defensive allow-list (spec §11/§20): a parent must never see an internal
// AI/governance audit event. In practice getJourneyTimeline/auditRepository
// .findByEntity('journey', journeyId) already scopes to Journey-transition
// rows only (JourneyService is the only writer of entityType:'journey'
// audit rows, and JOURNEY_EVENT_TYPE_FOR_STATE — JourneyStateMachine.ts —
// is a closed, exhaustive 11-value map), so this set can never be
// bypassed by a differently-typed row appearing under the same entity.
// Kept explicit anyway: never rely on "it happens to be scoped correctly"
// alone when a human safety/privacy guarantee is on the line.
export const PARENT_SAFE_EVENT_TYPES = new Set<string>([
  'JOURNEY_CREATED',
  'JOURNEY_STARTED',
  'BOARDING_STARTED',
  'STUDENT_BOARDED',
  'TRANSIT_STARTED',
  'STOP_APPROACHING',
  'STUDENT_DROPPED_OFF',
  'JOURNEY_COMPLETED',
  'JOURNEY_CANCELLED',
  'STUDENT_MISSED',
  'JOURNEY_INCIDENT',
]);

export interface ParentJourneyEventView {
  id: string;
  eventType: string;
  occurredAt: string;
  actorType: string;
}

/**
 * The public read-model DTO (spec §6). Deliberately NOT every database
 * column: only `boardedAt`/`droppedOffAt` are real Journey timestamp
 * columns (no `startedAt`/`boardingStartedAt`/`transitStartedAt`/
 * `approachingAt`/`completedAt` columns exist in the schema — those
 * per-transition moments are exactly what the event timeline already
 * carries; spec §6 forbids fabricating fields that aren't real, so this
 * type never invents them). `journey` (and everything that depends on it)
 * is null when the student has no relevant journey at all — spec §16's
 * NO_ACTIVE_JOURNEY state, never a fabricated placeholder.
 */
export interface ParentJourneyView {
  // legacyStudentId (Phase 13): the real, stable bridge back to the legacy
  // student record the parent-facing frontend already holds (its own
  // `Student.id`). Never a name — see ParentAccessService.ts's resolution
  // chain. Null only for a governed student with no legacy counterpart at
  // all (should not occur for an authorized parent's own child once every
  // real household is linked, but never fabricated if it did).
  child: { id: string; name: string; legacyStudentId: string | null };
  journey: {
    id: string;
    state: JourneyState;
    currentStopId: string | null;
    scheduledPickupTime: string | null;
    scheduledDropoffTime: string | null;
    boardedAt: string | null;
    droppedOffAt: string | null;
  } | null;
  bus: { id: string; label: string } | null;
  route: { id: string; name: string } | null;
  driver: { displayName: string } | null;
  location: {
    latitude: number;
    longitude: number;
    speedKmh: number | null;
    heading: number | null;
    source: string;
    freshness: 'FRESH' | 'STALE';
    occurredAt: string;
    receivedAt: string;
  } | null;
  eta: {
    status: string;
    estimatedArrivalAt: string | null;
    nextStopId: string | null;
    confidence: string;
    delaySeconds: number | null;
    source: string | null;
    calculatedAt: string;
  } | null;
  lastEvent: ParentJourneyEventView | null;
}
