import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

// Phase 3A — Journey Core. A Trip is the shared vehicle run; a Journey is one
// student's individual participation/state within that Trip (spec §7). Kept
// deliberately lean: bus/route/driver are NOT denormalized here — they're
// always derived through trips.routeId/busId/driverId, since tripId already
// determines them (spec §8/AC-03). This is a genuinely new entity: nothing
// in the Phase 1-2B schema tracks *current per-student state* — boarding_events
// is an append-only log of discrete events, not a stateful entity, and
// JourneyService continues writing to it too for backward compatibility with
// SafetyCheck.ts (see server/services/JourneyService.ts for the full note).
//
// state (see server/domain/JourneyStateMachine.ts for the transition graph):
//   'scheduled' | 'waiting' | 'boarding' | 'on_bus' | 'in_transit'
//   | 'approaching_stop' | 'dropped_off' | 'completed'
//   | 'cancelled' | 'missed' | 'incident'
export const journeys = sqliteTable(
  'journeys',
  {
    id: id(),
    studentId: text('student_id').notNull().references(() => students.id),
    tripId: text('trip_id').notNull().references(() => trips.id),
    state: text('state').notNull().default('scheduled'),
    currentStopId: text('current_stop_id').references(() => routeStops.id),
    scheduledPickupTime: integer('scheduled_pickup_time', { mode: 'timestamp' }),
    scheduledDropoffTime: integer('scheduled_dropoff_time', { mode: 'timestamp' }),
    boardedAt: integer('boarded_at', { mode: 'timestamp' }),
    droppedOffAt: integer('dropped_off_at', { mode: 'timestamp' }),
    missedReason: text('missed_reason'),
    cancelReason: text('cancel_reason'),
    incidentReason: text('incident_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    // At most one journey per student per trip (spec §31) — the idempotency
    // guarantee is a real database constraint, not just application logic.
    studentTripUnique: uniqueIndex('journeys_student_trip_unique').on(table.studentId, table.tripId),
    studentIdx: index('journeys_student_idx').on(table.studentId),
    tripIdx: index('journeys_trip_idx').on(table.tripId),
    stateIdx: index('journeys_state_idx').on(table.state),
    tripStateIdx: index('journeys_trip_state_idx').on(table.tripId, table.state),
  })
);

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
    // Phase 2B: denormalized trip reference so the Operations Feed can filter
    // by trip with a plain indexed query instead of joining through
    // recommendationId -> ai_recommendations.tripId for every row (spec §54,
    // "avoid N+1 API requests").
    tripId: text('trip_id').references(() => trips.id),
    // Phase 3A: same rationale, one level deeper — Journey events need to be
    // queryable by student without joining through journeys.studentId.
    studentId: text('student_id').references(() => students.id),
    createdAt: createdAt(),
  },
  (table) => ({
    recommendationIdx: index('audit_logs_recommendation_idx').on(table.recommendationId),
    entityIdx: index('audit_logs_entity_idx').on(table.entityType, table.entityId),
    tripIdx: index('audit_logs_trip_idx').on(table.tripId, table.createdAt),
    studentIdx: index('audit_logs_student_idx').on(table.studentId, table.createdAt),
  })
);

// Phase 4B — Telemetry Ingestion Boundary. A device is NOT a school user
// (spec §12) — it authenticates with its own hashed secret (see
// server/services/deviceCredentials.ts, same scrypt+salt convention as
// seed.ts's hashPassword), never with a user email/password. providerType
// is the ONLY source a device may claim (server-derived at ingestion,
// spec §15/§41) — real values: 'DEVICE' | 'GPS_PROVIDER'. Never 'SIMULATION'
// — the GPS simulator (Phase 4A) is never registered here (spec §42).
// status: 'active' | 'disabled' | 'revoked'
export const telemetryDevices = sqliteTable('telemetry_devices', {
  id: id(),
  busId: text('bus_id').notNull().references(() => buses.id),
  providerType: text('provider_type').notNull().default('DEVICE'),
  status: text('status').notNull().default('active'),
  secretHash: text('secret_hash').notNull(), // scrypt(salt):hash — never plaintext, never returned by any API (spec §46)
  label: text('label').notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Append-only telemetry history (spec §28/§29 — no UPDATE/DELETE route
// exists for this table, mirroring audit_logs/boarding_events). Distinct
// from audit_logs on purpose (spec §30/§123): this answers "what did the
// physical system observe", not "what did MASARA/an actor do". busId is
// persisted directly (the device's authoritative bus AT INGESTION TIME,
// spec §94) rather than re-derived later from the device's current
// association, so historical correlation survives a future device
// reassignment. tripId is nullable — bus-only telemetry (no active trip
// yet) is a valid, accepted observation (spec §51).
export const telemetryObservations = sqliteTable(
  'telemetry_observations',
  {
    id: id(),
    sourceEventId: text('source_event_id').notNull(),
    deviceId: text('device_id').notNull().references(() => telemetryDevices.id),
    busId: text('bus_id').notNull().references(() => buses.id),
    tripId: text('trip_id').references(() => trips.id),
    source: text('source').notNull(), // 'DEVICE' | 'GPS_PROVIDER' — copied from telemetryDevices.providerType at ingestion time, never client-controlled
    eventType: text('event_type').notNull().default('GPS_LOCATION_RECEIVED'), // Phase 3C's reserved telemetry event type — server-determined, never req.body.eventType
    occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(), // device-reported, validated (spec §18/§19), untrusted until checked
    receivedAt: integer('received_at', { mode: 'timestamp' }).notNull(), // server-set only — never accepted from the client (spec §4/§67)
    latitude: real('latitude').notNull(),
    longitude: real('longitude').notNull(),
    speedKmh: real('speed_kmh'),
    heading: real('heading'),
    accuracyMeters: real('accuracy_meters'),
    sequence: integer('sequence'),
    createdAt: createdAt(),
  },
  (table) => ({
    // Database-level idempotency (spec §26) — the real defense against a
    // concurrent double-submit, not an app-level SELECT-then-INSERT check.
    deviceSourceEventUnique: uniqueIndex('telemetry_observations_device_source_event_unique').on(table.deviceId, table.sourceEventId),
    deviceOccurredIdx: index('telemetry_observations_device_occurred_idx').on(table.deviceId, table.occurredAt),
    busOccurredIdx: index('telemetry_observations_bus_occurred_idx').on(table.busId, table.occurredAt),
    tripOccurredIdx: index('telemetry_observations_trip_occurred_idx').on(table.tripId, table.occurredAt),
  })
);

// Phase 4C — derived read model ONLY. `telemetry_observations` remains the
// immutable historical source of truth; this table always holds exactly
// ONE row per bus — "the latest accepted observation currently considered
// this bus's current location" (spec §3/§9). It is fully rebuildable from
// telemetry_observations (see CurrentLocationProjectionService.rebuild) and
// is never itself a source of truth for anything. `observationId` is
// intentionally NOT a foreign key into telemetry_observations: a
// SIMULATION-sourced observation (Phase 4A) never gets a
// telemetry_observations row at all (the simulator is explicitly never a
// registrable device — Phase 4B spec §42) and still needs to reach this
// projection directly, so this column just carries whichever id the
// producer's own TelemetryObservation object had.
//
// This is a completely separate concept from the pre-existing
// buses.currentLat/currentLng/speedKmh convenience fields (Phase 1) — those
// remain untouched by telemetry (Phase 4A/4B/4C all deliberately avoid
// writing to them; see server/services/CurrentLocationProjectionService.ts).
export const currentLocationProjection = sqliteTable(
  'current_location_projection',
  {
    busId: text('bus_id').primaryKey().references(() => buses.id),
    tripId: text('trip_id').references(() => trips.id),
    observationId: text('observation_id').notNull(),
    sourceEventId: text('source_event_id').notNull(),
    source: text('source').notNull(), // 'DEVICE' | 'GPS_PROVIDER' | 'SIMULATION' — preserved exactly from the producer, never client-supplied
    sequence: integer('sequence'),
    latitude: real('latitude').notNull(),
    longitude: real('longitude').notNull(),
    speedKmh: real('speed_kmh'),
    heading: real('heading'),
    accuracyMeters: real('accuracy_meters'),
    occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
    receivedAt: integer('received_at', { mode: 'timestamp' }).notNull(),
    updatedAt: updatedAt(), // when this PROJECTION row was last (re)written — distinct from occurredAt/receivedAt, which describe the observation itself
  },
  (table) => ({
    tripIdx: index('current_location_projection_trip_idx').on(table.tripId),
  })
);
