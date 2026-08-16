import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

// All IDs are UUID strings (text) and all tables carry created_at/updated_at,
// matching a shape that transfers directly to Postgres (uuid + timestamptz)
// when this schema is ported to drizzle-orm/pg-core later.

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date());
const updatedAt = () => integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date());

export const schools = sqliteTable('schools', {
  id: id(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  address: text('address').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// role: 'admin' | 'driver' | 'school' | 'parent' (kept aligned with the existing
// AuthModal/login code — 'admin' = Transport Admin, 'school' = School Operator)
export const users = sqliteTable('users', {
  id: id(),
  schoolId: text('school_id').references(() => schools.id),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const drivers = sqliteTable('drivers', {
  id: id(),
  userId: text('user_id').references(() => users.id),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  licenseNo: text('license_no'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// status: 'idle' | 'en_route_pickup' | 'en_route_school' | 'returning' | 'maintenance'
export const buses = sqliteTable('buses', {
  id: id(),
  schoolId: text('school_id').notNull().references(() => schools.id),
  busNumber: text('bus_number').notNull(),
  plateNumber: text('plate_number').notNull(),
  driverId: text('driver_id').references(() => drivers.id),
  capacity: integer('capacity').notNull(),
  currentOccupancy: integer('current_occupancy').notNull().default(0),
  status: text('status').notNull().default('idle'),
  currentLat: real('current_lat'),
  currentLng: real('current_lng'),
  speedKmh: real('speed_kmh').notNull().default(0),
  fuelLevel: real('fuel_level').notNull().default(100),
  safetyScore: real('safety_score').notNull().default(100),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const students = sqliteTable('students', {
  id: id(),
  schoolId: text('school_id').notNull().references(() => schools.id),
  name: text('name').notNull(),
  grade: text('grade').notNull(),
  busId: text('bus_id').references(() => buses.id),
  pickupLat: real('pickup_lat').notNull(),
  pickupLng: real('pickup_lng').notNull(),
  pickupAddress: text('pickup_address').notNull(),
  seatNumber: text('seat_number'),
  parentName: text('parent_name'),
  parentPhone: text('parent_phone'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// status: 'active' | 'scheduled' | 'completed' | 'rerouted'
export const routes = sqliteTable('routes', {
  id: id(),
  schoolId: text('school_id').notNull().references(() => schools.id),
  name: text('name').notNull(),
  totalDistanceKm: real('total_distance_km').notNull().default(0),
  estimatedDurationMins: integer('estimated_duration_mins').notNull().default(0),
  status: text('status').notNull().default('scheduled'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const routeStops = sqliteTable('route_stops', {
  id: id(),
  routeId: text('route_id').notNull().references(() => routes.id),
  name: text('name').notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  orderSequence: integer('order_sequence').notNull(),
  // JSON-encoded array of student ids assigned to this stop
  studentIds: text('student_ids').notNull().default('[]'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// status: 'scheduled' | 'active' | 'completed' | 'cancelled'
export const trips = sqliteTable('trips', {
  id: id(),
  routeId: text('route_id').notNull().references(() => routes.id),
  busId: text('bus_id').notNull().references(() => buses.id),
  driverId: text('driver_id').references(() => drivers.id),
  status: text('status').notNull().default('scheduled'),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  targetArrivalAt: integer('target_arrival_at', { mode: 'timestamp' }),
  currentEtaAt: integer('current_eta_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// event_type: 'boarded' | 'dropped_off' | 'absent'
export const boardingEvents = sqliteTable('boarding_events', {
  id: id(),
  tripId: text('trip_id').notNull().references(() => trips.id),
  studentId: text('student_id').notNull().references(() => students.id),
  busId: text('bus_id').notNull().references(() => buses.id),
  eventType: text('event_type').notNull(),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  createdAt: createdAt(),
});

// type: 'TRAFFIC' | 'BREAKDOWN' | 'ACCIDENT' | 'STUDENT_DELAY' | 'ROUTE_BLOCKED' | 'VEHICLE_ISSUE' | 'OTHER'
// severity: 'low' | 'medium' | 'high'
// status: 'open' | 'resolved'
export const incidents = sqliteTable('incidents', {
  id: id(),
  tripId: text('trip_id').references(() => trips.id),
  busId: text('bus_id').references(() => buses.id),
  type: text('type').notNull(),
  severity: text('severity').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull().default('open'),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// risk_level: 'low' | 'medium' | 'high'
// Numbers here are the source of truth — always produced by PredictionEngine, never by an LLM.
export const predictions = sqliteTable('predictions', {
  id: id(),
  tripId: text('trip_id').notNull().references(() => trips.id),
  currentEtaAt: integer('current_eta_at', { mode: 'timestamp' }),
  targetArrivalAt: integer('target_arrival_at', { mode: 'timestamp' }),
  delayMinutes: real('delay_minutes').notNull(),
  delayProbability: real('delay_probability').notNull(),
  riskLevel: text('risk_level').notNull(),
  createdBy: text('created_by').notNull().default('engine'),
  createdAt: createdAt(),
});

// action (recommendedAction): 'CHANGE_ROUTE' | 'NOTIFY_SCHOOL' | 'FLAG_INCIDENT' | 'NO_ACTION'
// type (category): 'DELAY' | 'ROUTE_CHANGE' | 'SAFETY_ALERT' | 'PARENT_NOTIFICATION' | 'MONITORING'
//   (subset of the spec's suggested type list — only categories this system's
//   action set can actually produce; unused categories like STOP_CHANGE/
//   BUS_REASSIGNMENT/DRIVER_ALERT are intentionally not implemented, per
//   "do not implement unnecessary recommendation types")
// severity (== riskLevel): 'low' | 'medium' | 'high' | 'critical'
// status (state machine — see server/domain/StateMachine.ts):
//   'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled'
//   | 'executed' | 'execution_failed' | 'verified' | 'verification_failed'
export const aiRecommendations = sqliteTable(
  'ai_recommendations',
  {
    id: id(),
    tripId: text('trip_id').notNull().references(() => trips.id),
    // Denormalized snapshot of the trip's bus/route at generation time — kept
    // stable for audit/display even if the trip is later reassigned.
    busId: text('bus_id').references(() => buses.id),
    sourceRouteId: text('source_route_id').references(() => routes.id),
    agentRunId: text('agent_run_id').notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    severity: text('severity').notNull(),
    problem: text('problem').notNull(),
    predictionId: text('prediction_id').references(() => predictions.id),
    confidence: real('confidence').notNull(),
    action: text('action').notNull(),
    targetId: text('target_id'),
    reason: text('reason').notNull(),
    expectedOutcome: text('expected_outcome'),
    requiresApproval: integer('requires_approval', { mode: 'boolean' }).notNull().default(true),
    status: text('status').notNull().default('pending'),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    decidedByUserId: text('decided_by_user_id').references(() => users.id),
    decidedAt: integer('decided_at', { mode: 'timestamp' }),
    rejectionReason: text('rejection_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    tripStatusIdx: index('ai_recommendations_trip_status_idx').on(table.tripId, table.status),
    statusIdx: index('ai_recommendations_status_idx').on(table.status),
  })
);

// The only table written to as a direct consequence of an approved AI recommendation.
export const actions = sqliteTable('actions', {
  id: id(),
  recommendationId: text('recommendation_id').notNull().references(() => aiRecommendations.id),
  actionType: text('action_type').notNull(),
  payload: text('payload').notNull().default('{}'),
  executedAt: integer('executed_at', { mode: 'timestamp' }),
  executedByUserId: text('executed_by_user_id').references(() => users.id),
  createdAt: createdAt(),
});

// status: 'success' | 'failed' | 'partial'
export const actionVerifications = sqliteTable('action_verifications', {
  id: id(),
  actionId: text('action_id').notNull().references(() => actions.id),
  etaBefore: integer('eta_before', { mode: 'timestamp' }),
  etaAfter: integer('eta_after', { mode: 'timestamp' }),
  improvementMins: real('improvement_mins'),
  status: text('status').notNull(),
  checkedAt: integer('checked_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  createdAt: createdAt(),
});

// eventType: 'RECOMMENDATION_CREATED' | 'RECOMMENDATION_CANCELLED' | 'POLICY_EVALUATED'
//   | 'APPROVAL_REQUESTED' | 'REVIEW_REQUESTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED'
//   | 'ACTION_STARTED' | 'ACTION_COMPLETED' | 'ACTION_FAILED'
//   | 'VERIFICATION_STARTED' | 'VERIFICATION_COMPLETED' | 'VERIFICATION_FAILED'
// actorType: 'system' | 'agent' | 'user'
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: id(),
    // Generic event-tracing fields (Phase 2A) — immutable, append-only from
    // normal application flows (no UPDATE/DELETE route exists for this table).
    eventType: text('event_type').notNull().default('AGENT_RUN'),
    actorId: text('actor_id').references(() => users.id),
    actorType: text('actor_type').notNull().default('system'),
    entityType: text('entity_type').notNull().default('ai_recommendation'),
    entityId: text('entity_id'),
    previousState: text('previous_state'),
    newState: text('new_state'),
    metadata: text('metadata'),
    // Original Phase 1 fields — kept as-is, still populated for MASARA-specific context.
    agentRunId: text('agent_run_id'),
    inputSummary: text('input_summary').notNull(),
    detectedProblem: text('detected_problem'),
    predictionId: text('prediction_id').references(() => predictions.id),
    recommendationId: text('recommendation_id').references(() => aiRecommendations.id),
    operatorDecision: text('operator_decision'),
    actionId: text('action_id').references(() => actions.id),
    verificationId: text('verification_id').references(() => actionVerifications.id),
    createdAt: createdAt(),
  },
  (table) => ({
    recommendationIdx: index('audit_logs_recommendation_idx').on(table.recommendationId),
    entityIdx: index('audit_logs_entity_idx').on(table.entityType, table.entityId),
  })
);
