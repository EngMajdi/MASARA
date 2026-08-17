// Phase 3C — Event & Telemetry Architecture. This module defines the
// CONCEPTUAL boundary between the four event domains MASARA now recognizes.
// It does NOT introduce a new event store, a new table, or a new API — it is
// a pure classification layer over the event-type strings every existing
// producer (JourneyService, MasaraOperationsAgent, ActionExecutor,
// SimulationEngine) already writes into `audit_logs`.
//
// Why this exists: Phase 4 (real-time GPS/telemetry) needs a place to declare
// "this new event type is TELEMETRY, not OPERATIONAL" without touching
// JourneyStateMachine, JourneyService, or OperationsFeed's existing category
// model (`FeedCategory` in OperationsFeed.ts — a UI-tab grouping, a DIFFERENT
// and orthogonal axis to the domain categorization here). This module is
// intentionally NOT wired into OperationsFeed/JourneyTimeline/any route in
// Phase 3C — it is a standalone, tested contract that Phase 4 producers can
// import once they exist. Wiring it into the Operations Feed response shape
// is a Phase 4 decision (it would touch the frontend type contract).
//
// EventCategory answers "what kind of fact is this?":
//   OPERATIONAL   — a real transportation-workflow action/state fact
//                    (Journey lifecycle, Trip/Bus lifecycle, reported incidents)
//   TELEMETRY     — a raw observation from a physical system (Phase 4 only —
//                    nothing in the current codebase produces these yet)
//   INTELLIGENCE  — an analytical output (prediction, detection, AI proposal)
//                    that is NOT itself an operational command
//   GOVERNANCE    — a controlled decision/action on an AI recommendation
//                    (approve/reject/execute/verify)
//
// EventSource answers "who/where did this come from?" — a SEPARATE axis.
// A SIMULATION_STARTED event and a real TRIP_STARTED event can both be
// OPERATIONAL category; what tells them apart is source. This is how
// spec Phase 3C §33/§34 is satisfied: simulation events must never be
// confused with real device telemetry, and category alone cannot express
// that distinction — source does.

export type EventCategory = 'OPERATIONAL' | 'TELEMETRY' | 'INTELLIGENCE' | 'GOVERNANCE' | 'UNKNOWN';

// SYSTEM/DRIVER/SCHOOL/ADMIN/SIMULATION/AI_AGENT/APPROVAL_CENTER are real,
// derivable today from existing audit_logs rows (see deriveEventSource
// below). DEVICE and GPS_PROVIDER are Phase 4 reserved values — no producer
// in this codebase emits them yet, and deriveEventSource never returns them.
// They exist here only so Phase 4's telemetry ingestion contract has a
// stable type to target instead of inventing its own enum later.
export type EventSource =
  | 'SYSTEM'
  | 'DRIVER'
  | 'SCHOOL'
  | 'ADMIN'
  | 'SIMULATION'
  | 'AI_AGENT'
  | 'APPROVAL_CENTER'
  | 'DEVICE' // reserved — Phase 4
  | 'GPS_PROVIDER'; // reserved — Phase 4

// ---------------------------------------------------------------------------
// Real event-type registries — every string below is copied verbatim from an
// actual `auditRepository.create({ eventType: ... })` call site (audited
// 2026, Phase 3C). Nothing here is renamed or invented; compatibility with
// existing audit_logs rows matters more than taxonomy purity (spec §35).
// ---------------------------------------------------------------------------

/** server/domain/JourneyStateMachine.ts (JOURNEY_EVENT_TYPE_FOR_STATE) + server/services/SimulationEngine.ts's trip/bus-level steps. */
export const OPERATIONAL_EVENT_TYPES = [
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
  // Trip/bus-level operational facts (SimulationEngine's stepTripStarted/
  // stepBusMoving write REAL trip/bus rows — not simulated data structures).
  'TRIP_STARTED',
  'BUS_MOVING',
  'TRIP_COMPLETED',
  // A reported real-world incident record (incidents table) — a fact, not
  // an analysis. Distinguish from TRAFFIC_DETECTED (INTELLIGENCE, below).
  'SAFETY_INCIDENT',
  // Simulation SESSION lifecycle bookends. These describe an operational
  // test run, not a new category — what marks them as non-real is `source`
  // (SIMULATION, via entityType === 'simulation'), never eventType.
  'SIMULATION_STARTED',
  'SIMULATION_COMPLETED',
  'SIMULATION_FAILED',
  'SIMULATION_CANCELLED',
] as const;

/** server/agents/MasaraOperationsAgent.ts + SimulationEngine's traffic-detection step — analytical output, not a command. */
export const INTELLIGENCE_EVENT_TYPES = [
  'AI_OUTPUT_REJECTED',
  'RECOMMENDATION_CREATED',
  'POLICY_EVALUATED',
  'TRAFFIC_DETECTED',
] as const;

/** server/services/ActionExecutor.ts + MasaraOperationsAgent's auto-rejection path — the controlled decision/action/verification chain (spec §5D). */
export const GOVERNANCE_EVENT_TYPES = [
  'APPROVAL_REQUESTED',
  'REVIEW_REQUESTED',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'RECOMMENDATION_CANCELLED',
  'ACTION_STARTED',
  'ACTION_COMPLETED',
  'ACTION_FAILED',
  'VERIFICATION_STARTED',
  'VERIFICATION_COMPLETED',
  'VERIFICATION_FAILED',
] as const;

/**
 * RESERVED — Phase 4 only. No producer in this codebase emits any of these
 * today; nothing calls auditRepository.create with these event types. They
 * exist so deriveEventCategory can classify them correctly the moment a
 * real telemetry producer is introduced, without this file changing.
 */
export const TELEMETRY_EVENT_TYPES = [
  'GPS_LOCATION_RECEIVED',
  'BUS_LOCATION_UPDATED',
  'STOP_PROXIMITY_DETECTED',
  'BUS_STOPPED',
  'BUS_MOVED',
] as const;

export type OperationalEventType = (typeof OPERATIONAL_EVENT_TYPES)[number];
export type IntelligenceEventType = (typeof INTELLIGENCE_EVENT_TYPES)[number];
export type GovernanceEventType = (typeof GOVERNANCE_EVENT_TYPES)[number];
export type TelemetryEventType = (typeof TELEMETRY_EVENT_TYPES)[number];

const CATEGORY_BY_EVENT_TYPE = new Map<string, EventCategory>();
for (const t of OPERATIONAL_EVENT_TYPES) CATEGORY_BY_EVENT_TYPE.set(t, 'OPERATIONAL');
for (const t of INTELLIGENCE_EVENT_TYPES) CATEGORY_BY_EVENT_TYPE.set(t, 'INTELLIGENCE');
for (const t of GOVERNANCE_EVENT_TYPES) CATEGORY_BY_EVENT_TYPE.set(t, 'GOVERNANCE');
for (const t of TELEMETRY_EVENT_TYPES) CATEGORY_BY_EVENT_TYPE.set(t, 'TELEMETRY');

/**
 * Deterministic eventType -> EventCategory mapping (same pattern as
 * OperationsFeed.deriveCategory, spec §7). An unrecognized event type is
 * classified 'UNKNOWN' explicitly — it is NEVER guessed as TELEMETRY or
 * silently absorbed into OPERATIONAL, per spec §7/§36's explicit warning.
 */
export function deriveEventCategory(eventType: string): EventCategory {
  return CATEGORY_BY_EVENT_TYPE.get(eventType) ?? 'UNKNOWN';
}

/**
 * Deterministic source derivation from the EXISTING audit_logs actor/entity
 * fields — no new column, no new input. Reuses the actor vocabulary already
 * in place (spec §9): JourneyService's actorType ('system'|'admin'|'school'
 * |'driver') and ActionExecutor/MasaraOperationsAgent's actorType
 * ('system'|'agent'|'user', where 'user' means "a human decided via the
 * Approval Center" and 'agent' means "the AI agent itself produced this").
 * Simulation-originated rows are identified via entityType === 'simulation'
 * (SimulationEngine.logSimulationEvent's existing convention) — this is
 * checked BEFORE actorType so a simulation's system-actor events aren't
 * misread as generic SYSTEM (spec §33/§34, AC-13).
 */
export function deriveEventSource(row: { actorType: string; entityType?: string | null }): EventSource {
  if (row.entityType === 'simulation') return 'SIMULATION';
  switch (row.actorType) {
    case 'driver':
      return 'DRIVER';
    case 'school':
      return 'SCHOOL';
    case 'admin':
      return 'ADMIN';
    case 'agent':
      return 'AI_AGENT';
    case 'user':
      return 'APPROVAL_CENTER';
    case 'system':
    default:
      return 'SYSTEM';
  }
}

// ---------------------------------------------------------------------------
// Event envelope — a CONCEPTUAL internal contract (spec §6), not a new
// database table or class. Every field below already exists on an
// `audit_logs` row today except `eventCategory`/`source` (both derived, never
// stored — spec §7) and `receivedAt` (audit_logs has only one timestamp,
// `createdAt`; see server/domain/telemetryContract.ts for why Phase 4
// telemetry needs a second one and this table currently does not).
// ---------------------------------------------------------------------------
export interface EventEnvelope {
  eventId: string; // audit_logs.id
  eventType: string; // audit_logs.eventType
  eventCategory: EventCategory; // derived via deriveEventCategory, never persisted
  occurredAt: Date; // audit_logs.createdAt (see telemetryContract.ts — Phase 3A/3B events are recorded synchronously, so occurredAt === receivedAt today; this is NOT true for future telemetry)
  actor: { actorId: string | null; actorType: string }; // audit_logs.actorId/actorType
  source: EventSource; // derived via deriveEventSource, never persisted
  entity: { entityType: string; entityId: string | null }; // audit_logs.entityType/entityId
  correlation: { tripId: string | null; studentId: string | null; recommendationId: string | null }; // audit_logs.tripId/studentId/recommendationId
  payload: Record<string, unknown> | null; // audit_logs.metadata (JSON-parsed)
}
