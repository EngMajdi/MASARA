import { journeyRepository } from '../repositories/journeyRepository';
import { studentRepository } from '../repositories/studentRepository';
import { tripRepository } from '../repositories/tripRepository';
import { routeRepository } from '../repositories/routeRepository';
import { boardingEventRepository } from '../repositories/boardingEventRepository';
import { auditRepository } from '../repositories/auditRepository';
import {
  assertJourneyTransition,
  JOURNEY_EVENT_TYPE_FOR_STATE,
  type JourneyState,
} from '../domain/JourneyStateMachine';

// The ONE controlled path for every Journey state change (spec Phase 3A §11/§12,
// AC-07/AC-08). No route handler and no other service writes to the `journeys`
// table directly — every mutation here validates the transition, claims it
// atomically, and logs it through the EXISTING audit infrastructure (spec §16,
// §75 — no journey_audit_logs, no second event system).
//
// Journey vs boarding_events (spec §7 integration note): `journeys` is new —
// nothing in Phase 1-2B tracks a student's *current* state within a trip,
// only discrete historical events. `boarding_events` (Phase 1) already logs
// boarded/dropped_off/absent and is read by SafetyCheck.ts; rather than
// migrate that consumer, boardStudent/dropOffStudent/markMissed continue
// writing a boarding_events row alongside the richer Journey transition, so
// existing Phase 1 behavior is untouched.

export class JourneyNotFoundError extends Error {}
export class JourneyConflictError extends Error {}
export class JourneyValidationError extends Error {}

export type JourneyActorType = 'system' | 'admin' | 'school' | 'driver';

export interface JourneyActor {
  actorId: string | null;
  actorType: JourneyActorType;
}

export const SYSTEM_ACTOR: JourneyActor = { actorId: null, actorType: 'system' };

type JourneyRow = NonNullable<ReturnType<typeof journeyRepository.findById>>;

function requireJourney(journeyId: string): JourneyRow {
  const journey = journeyRepository.findById(journeyId);
  if (!journey) throw new JourneyNotFoundError('الرحلة الطلابية (Journey) غير موجودة.');
  return journey;
}

function requireJourneyWithTrip(journeyId: string) {
  const journey = requireJourney(journeyId);
  const trip = tripRepository.findById(journey.tripId);
  if (!trip) throw new JourneyValidationError('الرحلة (Trip) المرتبطة بهذه الرحلة الطلابية غير موجودة.');
  return { journey, trip };
}

function logJourneyEvent(
  journey: JourneyRow,
  newState: JourneyState,
  actor: JourneyActor,
  reason?: string | null,
  metadata?: Record<string, unknown> | null
) {
  const eventType = JOURNEY_EVENT_TYPE_FOR_STATE[newState];
  auditRepository.create({
    eventType,
    actorId: actor.actorId,
    actorType: actor.actorType,
    entityType: 'journey',
    entityId: journey.id,
    tripId: journey.tripId,
    studentId: journey.studentId,
    previousState: journey.state,
    newState,
    metadata: metadata ? JSON.stringify(metadata) : null,
    inputSummary: `${eventType} — journey ${journey.id} (trip ${journey.tripId})`,
    operatorDecision: reason ?? null,
  });
}

/** Validates, atomically claims, and audits one transition. The single choke point every public method below funnels through. */
function performTransition(
  journey: JourneyRow,
  toState: JourneyState,
  actor: JourneyActor,
  opts: { extraChanges?: Record<string, unknown>; reason?: string | null; metadata?: Record<string, unknown> | null } = {}
): JourneyRow {
  // Throws InvalidJourneyTransitionError (422) if this edge doesn't exist in
  // the graph — this is checked BEFORE the atomic claim, so a doomed request
  // never touches the database.
  assertJourneyTransition(journey.state as JourneyState, toState);

  const claimed = journeyRepository.claimTransition(journey.id, journey.state as JourneyState, toState, opts.extraChanges ?? {});
  if (!claimed) {
    // Someone else moved this journey out of the expected state between our
    // read and this write (spec §32 concurrency guard — same pattern as
    // recommendationRepository.claimTransition in Phase 2A).
    throw new JourneyConflictError('تم تغيير حالة هذه الرحلة الطلابية بالفعل من عملية أخرى.');
  }

  logJourneyEvent(journey, toState, actor, opts.reason, opts.metadata);
  return journeyRepository.findById(journey.id)!;
}

// ---------------------------------------------------------------------------
// Creation (spec §22/§30/§31) — idempotent, validated against the existing
// student<->bus assignment (there is no separate assignment table to reuse;
// students.busId + trips.busId together already ARE that relationship).
// ---------------------------------------------------------------------------

export function createJourney(studentId: string, tripId: string, actor: JourneyActor = SYSTEM_ACTOR): JourneyRow {
  const existing = journeyRepository.findByStudentAndTrip(studentId, tripId);
  if (existing) return existing; // idempotent — never a second active journey for the same pair (spec §31)

  const student = studentRepository.findById(studentId);
  if (!student) throw new JourneyValidationError('الطالب غير موجود.');
  const trip = tripRepository.findById(tripId);
  if (!trip) throw new JourneyValidationError('الرحلة غير موجودة.');
  if (!student.busId || student.busId !== trip.busId) {
    throw new JourneyValidationError('الطالب غير مُكلّف بحافلة هذه الرحلة.');
  }

  let created: JourneyRow;
  try {
    const inserted = journeyRepository.create({
      studentId,
      tripId,
      state: 'scheduled',
      scheduledDropoffTime: trip.targetArrivalAt ?? null,
    });
    created = journeyRepository.findById(inserted.id)!;
  } catch (err) {
    // Defense in depth against the unique(studentId, tripId) constraint —
    // matters if this ever runs under real concurrency (e.g. a future
    // Postgres connection pool); harmless no-op under today's synchronous
    // single-process SQLite.
    const raced = journeyRepository.findByStudentAndTrip(studentId, tripId);
    if (raced) return raced;
    throw err;
  }

  auditRepository.create({
    eventType: 'JOURNEY_CREATED',
    actorId: actor.actorId,
    actorType: actor.actorType,
    entityType: 'journey',
    entityId: created.id,
    tripId,
    studentId,
    previousState: null,
    newState: 'scheduled',
    inputSummary: `JOURNEY_CREATED — journey ${created.id} (trip ${tripId})`,
  });

  return created;
}

/** Backfills a Journey for every student assigned to this trip's bus — idempotent, safe to call repeatedly (spec §48). */
export function ensureJourneysForTrip(tripId: string, actor: JourneyActor = SYSTEM_ACTOR): JourneyRow[] {
  const trip = tripRepository.findById(tripId);
  if (!trip) throw new JourneyNotFoundError('الرحلة غير موجودة.');
  const roster = studentRepository.findByBusId(trip.busId);
  return roster.map((s) => createJourney(s.id, tripId, actor));
}

// ---------------------------------------------------------------------------
// Reads (spec §36/§37/§38)
// ---------------------------------------------------------------------------

export function getJourney(id: string): JourneyRow | null {
  return journeyRepository.findById(id) ?? null;
}

/** Most recent journey for a student, optionally scoped to one trip. */
export function getStudentJourney(studentId: string, tripId?: string): JourneyRow | null {
  if (tripId) return journeyRepository.findByStudentAndTrip(studentId, tripId) ?? null;
  return journeyRepository.findByStudentId(studentId)[0] ?? null;
}

export function getTripJourneys(tripId: string): JourneyRow[] {
  return journeyRepository.findByTripId(tripId);
}

const EMPTY_COUNTS: Record<JourneyState, number> = {
  scheduled: 0,
  waiting: 0,
  boarding: 0,
  on_bus: 0,
  in_transit: 0,
  approaching_stop: 0,
  dropped_off: 0,
  completed: 0,
  cancelled: 0,
  missed: 0,
  incident: 0,
};

/** Trip View (spec §37) — real counts derived from Journey rows, never hard-coded. */
export function getTripJourneySummary(tripId: string) {
  const list = journeyRepository.findByTripId(tripId);
  const counts = { ...EMPTY_COUNTS };
  for (const j of list) {
    const state = j.state as JourneyState;
    counts[state] = (counts[state] ?? 0) + 1;
  }
  return { tripId, totalStudents: list.length, counts };
}

/** Journey timeline (spec §38) — real audit rows only, oldest first. */
export function getJourneyTimeline(journeyId: string) {
  requireJourney(journeyId);
  return auditRepository.findByEntity('journey', journeyId);
}

// ---------------------------------------------------------------------------
// Transitions (spec §26/§27/§28/§29)
// ---------------------------------------------------------------------------

export function startJourney(journeyId: string, actor: JourneyActor): JourneyRow {
  const journey = requireJourney(journeyId);
  return performTransition(journey, 'waiting', actor);
}

export function startBoarding(journeyId: string, actor: JourneyActor): JourneyRow {
  const journey = requireJourney(journeyId);
  return performTransition(journey, 'boarding', actor);
}

/** Server-side boardedAt only — never trusts a client-supplied timestamp (spec §26/§33). */
export function boardStudent(journeyId: string, actor: JourneyActor): JourneyRow {
  const { journey, trip } = requireJourneyWithTrip(journeyId);
  const updated = performTransition(journey, 'on_bus', actor, { extraChanges: { boardedAt: new Date() } });
  boardingEventRepository.create({
    tripId: journey.tripId,
    studentId: journey.studentId,
    busId: trip.busId,
    eventType: 'boarded',
  });
  return updated;
}

export function startTransit(journeyId: string, actor: JourneyActor): JourneyRow {
  const journey = requireJourney(journeyId);
  return performTransition(journey, 'in_transit', actor);
}

/** Validates the stop belongs to the journey's own route before recording it (spec §24). */
export function approachStop(journeyId: string, stopId: string, actor: JourneyActor): JourneyRow {
  const { journey, trip } = requireJourneyWithTrip(journeyId);
  const stop = routeRepository.findStopById(stopId);
  if (!stop) throw new JourneyValidationError('نقطة التوقف غير موجودة.');
  if (stop.routeId !== trip.routeId) {
    throw new JourneyValidationError('نقطة التوقف لا تنتمي إلى مسار هذه الرحلة.');
  }
  return performTransition(journey, 'approaching_stop', actor, { extraChanges: { currentStopId: stopId } });
}

/** Server-side droppedOffAt; requires the stop to match what approachStop already recorded (spec §25/§27/§33). */
export function dropOffStudent(journeyId: string, stopId: string, actor: JourneyActor): JourneyRow {
  const { journey, trip } = requireJourneyWithTrip(journeyId);
  if (journey.currentStopId && journey.currentStopId !== stopId) {
    throw new JourneyValidationError('نقطة التوقف المُرسلة لا تطابق نقطة التوقف الحالية لهذه الرحلة الطلابية.');
  }
  const updated = performTransition(journey, 'dropped_off', actor, { extraChanges: { droppedOffAt: new Date(), currentStopId: stopId } });
  boardingEventRepository.create({
    tripId: journey.tripId,
    studentId: journey.studentId,
    busId: trip.busId,
    eventType: 'dropped_off',
  });
  return updated;
}

export function completeJourney(journeyId: string, actor: JourneyActor): JourneyRow {
  const journey = requireJourney(journeyId);
  return performTransition(journey, 'completed', actor);
}

/** A missed journey is never a successful drop-off, and never silently reopens (spec §28/§64). */
export function markMissed(journeyId: string, reason: string, actor: JourneyActor): JourneyRow {
  if (!reason || !reason.trim()) throw new JourneyValidationError('سبب الغياب مطلوب.');
  const { journey, trip } = requireJourneyWithTrip(journeyId);
  const updated = performTransition(journey, 'missed', actor, {
    extraChanges: { missedReason: reason.trim() },
    reason: reason.trim(),
  });
  boardingEventRepository.create({
    tripId: journey.tripId,
    studentId: journey.studentId,
    busId: trip.busId,
    eventType: 'absent',
  });
  return updated;
}

export function cancelJourney(journeyId: string, reason: string | undefined, actor: JourneyActor): JourneyRow {
  const journey = requireJourney(journeyId);
  return performTransition(journey, 'cancelled', actor, {
    extraChanges: { cancelReason: reason ?? null },
    reason: reason ?? null,
  });
}

/**
 * Records that something happened — it does NOT run any risk assessment.
 * The existing AI safety escalation (open ACCIDENT/BREAKDOWN incident ->
 * CRITICAL) lives entirely in MasaraOperationsAgent/PolicyEngine and is not
 * duplicated here (spec §29/§75). A future integration could have the Agent
 * react to a JOURNEY_INCIDENT audit event; Phase 3A only emits it.
 */
export function markIncident(journeyId: string, reason: string | undefined, actor: JourneyActor): JourneyRow {
  const journey = requireJourney(journeyId);
  return performTransition(journey, 'incident', actor, {
    extraChanges: { incidentReason: reason ?? null },
    reason: reason ?? null,
  });
}
