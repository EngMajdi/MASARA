import { auditRepository, type AuditLogFilter } from '../repositories/auditRepository';

// A read-model projection over audit_logs (spec Phase 2B §22/§24) — no
// separate `ai_operations_feed` table, no duplicate event storage. Every row
// the feed shows is a real audit_logs entry produced by the real domain
// services (Agent, PolicyEngine, ActionExecutor, SimulationEngine).

export type FeedCategory = 'all' | 'ai' | 'trips' | 'students' | 'approvals' | 'actions' | 'verification' | 'safety';

const CATEGORY_EVENT_TYPES: Record<Exclude<FeedCategory, 'all'>, string[]> = {
  ai: ['AI_OUTPUT_REJECTED', 'RECOMMENDATION_CREATED', 'POLICY_EVALUATED'],
  trips: [
    'TRIP_STARTED',
    'BUS_MOVING',
    'TRIP_COMPLETED',
    'SIMULATION_STARTED',
    'SIMULATION_COMPLETED',
    'SIMULATION_FAILED',
    'SIMULATION_CANCELLED',
    // Journey Core (Phase 3A) trip-level lifecycle bookends — the bus-trip
    // itself starting/finishing, as opposed to one student's progress within it.
    'JOURNEY_CREATED',
    'JOURNEY_STARTED',
    'JOURNEY_COMPLETED',
    'JOURNEY_CANCELLED',
  ],
  // Journey Core (Phase 3A) — one specific student's progress through a trip.
  // Distinct from 'trips' because these are genuinely student-scoped, not
  // vehicle-scoped (spec §39 suggests a STUDENT category; the existing
  // category model didn't have an equivalent bucket to reuse for these).
  students: ['BOARDING_STARTED', 'STUDENT_BOARDED', 'TRANSIT_STARTED', 'STOP_APPROACHING', 'STUDENT_DROPPED_OFF', 'STUDENT_MISSED'],
  approvals: ['APPROVAL_REQUESTED', 'APPROVED', 'REJECTED', 'REVIEW_REQUESTED', 'RECOMMENDATION_CANCELLED', 'EXPIRED'],
  actions: ['ACTION_STARTED', 'ACTION_COMPLETED', 'ACTION_FAILED'],
  verification: ['VERIFICATION_STARTED', 'VERIFICATION_COMPLETED', 'VERIFICATION_FAILED'],
  safety: ['SAFETY_INCIDENT', 'JOURNEY_INCIDENT'],
};

const EVENT_TYPE_TO_CATEGORY = new Map<string, FeedCategory>();
for (const [category, eventTypes] of Object.entries(CATEGORY_EVENT_TYPES) as [FeedCategory, string[]][]) {
  for (const eventType of eventTypes) {
    // TRAFFIC_DETECTED is trip-flavored but safety-relevant when it escalates;
    // keep it under 'trips' primarily, it still shows in 'all'.
    if (!EVENT_TYPE_TO_CATEGORY.has(eventType)) EVENT_TYPE_TO_CATEGORY.set(eventType, category);
  }
}
EVENT_TYPE_TO_CATEGORY.set('TRAFFIC_DETECTED', 'trips');

export function deriveCategory(eventType: string): FeedCategory {
  return EVENT_TYPE_TO_CATEGORY.get(eventType) ?? 'ai';
}

export interface OperationsEventsFilter {
  tripId?: string;
  studentId?: string;
  recommendationId?: string;
  eventType?: string;
  category?: FeedCategory;
  since?: Date;
  limit?: number;
}

export interface OperationsFeedEvent {
  id: string;
  eventType: string;
  category: FeedCategory;
  label: string;
  actorId: string | null;
  actorType: string;
  entityType: string;
  entityId: string | null;
  tripId: string | null;
  studentId: string | null;
  recommendationId: string | null;
  previousState: string | null;
  newState: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export function listOperationsEvents(filter: OperationsEventsFilter = {}): OperationsFeedEvent[] {
  const repoFilter: AuditLogFilter = {
    tripId: filter.tripId,
    studentId: filter.studentId,
    recommendationId: filter.recommendationId,
    since: filter.since,
    limit: filter.limit ?? 100,
  };

  if (filter.eventType) {
    repoFilter.eventTypes = [filter.eventType];
  } else if (filter.category && filter.category !== 'all') {
    repoFilter.eventTypes = CATEGORY_EVENT_TYPES[filter.category];
  }

  return auditRepository.findFiltered(repoFilter).map((row) => ({
    id: row.id,
    eventType: row.eventType,
    category: deriveCategory(row.eventType),
    label: row.inputSummary,
    actorId: row.actorId,
    actorType: row.actorType,
    entityType: row.entityType,
    entityId: row.entityId,
    tripId: row.tripId,
    studentId: row.studentId,
    recommendationId: row.recommendationId,
    previousState: row.previousState,
    newState: row.newState,
    metadata: row.metadata ? safeParseJson(row.metadata) : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

function safeParseJson(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
