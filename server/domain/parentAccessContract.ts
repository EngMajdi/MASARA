import type { JourneyState } from './JourneyStateMachine';

// Phase 5A — Parent Trust Read Model. This is a READ MODEL over Journey
// Core, Current Location Projection, and ETA Intelligence — it duplicates
// none of their logic (spec §5/§9/§10).
//
// PARENT IDENTITY (spec §2/§3, architecture audit finding): the governed
// `users` table (server/repositories/userRepository.ts) has NO parent row
// at all — only the legacy in-memory login store in server.ts has one
// (parent@masara.om). `students.parentName`/`parentPhone` are free text,
// confirmed unchanged from the Phase 3A/3B documented baseline, and are NOT
// a foreign key to any user (spec §23 explicitly forbids adding one).
//
// There is therefore no real parent<->student relation anywhere in this
// schema to build authorization on top of. Per spec §3, this phase does NOT
// invent a production identity system (no passwords, OTP, or real accounts
// beyond what already exists) and does NOT add a migration (spec §23:
// "prefer no migration... if unavoidable, STOP and explain why" — a full
// parent-student relation table is exactly the kind of change that should
// wait for a real identity/productization phase, not be smuggled in here).
//
// The resolution: a single, explicitly-labeled DEMO-ONLY constant. Exactly
// one seeded governed `users` row (role='parent', database/seed/seed.ts)
// shares its email with the legacy login's parent@masara.om — the same
// "coincide by design" alignment seed.ts's own comments already document
// for admin/school/driver1, just extended to the one role that was missing
// it. A small number of seeded students carry this exact phone number in
// their existing free-text `parentPhone` column — not a new column, not a
// constraint, just a plain value equality checked at query time.
// ParentAccessService.resolveAuthorizedStudents is the ONLY place this
// constant is read; every route/service is written against that function's
// signature, so a future real identity provider (a genuine parent-student
// relation, or claims from an external auth system) replaces only the body
// of that one function — nothing else in this phase changes.
export const DEMO_PARENT_PHONE_BY_EMAIL: Record<string, string> = {
  'parent@masara.om': '+968 9111 0000',
};

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
  child: { id: string; name: string };
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
