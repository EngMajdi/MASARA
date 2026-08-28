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

export const students = sqliteTable('students',
  {
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
    // Phase 13 — the real, stable, non-name-based cross-system student
    // identity bridge. This governed student record represents the SAME
    // real student as the referenced legacy_students row, when (and only
    // when) this is set — a genuine foreign key, not a value-equality
    // guess. Nullable: most governed students (auto-generated Journey Core
    // test data from earlier phases) have no legacy counterpart at all,
    // and that is honestly represented as null, never a fabricated link.
    // This is the ONLY thing that determines "this governed student IS
    // that legacy student" anywhere in the codebase — see
    // server/services/ParentAccessService.ts, which resolves parent
    // ownership through this column, never through name or phone matching.
    legacyStudentId: text('legacy_student_id').references(() => legacyStudents.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    // At most one governed record per legacy student (SQLite unique indexes
    // permit multiple NULLs, so the 40+ unlinked governed rows are unaffected).
    legacyStudentUnique: uniqueIndex('students_legacy_student_unique').on(table.legacyStudentId),
  })
);

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

// Phase 4E — ETA accuracy validation. Stores a PREDICTION SNAPSHOT (never an
// after-the-fact guess) captured at the moment a live ETA was computed for a
// bus's next stop, so it can later be compared against the one authoritative
// "actual arrival" fact this domain has: journeys.droppedOffAt (see
// EtaAccuracyService's header comment for the full ground-truth reasoning).
// predictionTimestamp/predictedArrivalAt/confidence/predictionSource are an
// immutable copy of that moment's EtaEstimate — never recomputed or
// overwritten later. actualArrivalAt/actualSource/signedErrorSeconds/
// absoluteErrorSeconds start NULL and are filled exactly once, by a
// deterministic reconciliation pass that reads journeys.droppedOffAt
// directly (never audit_logs, never GPS proximity, never ETA-reaching-zero,
// never simulation-completion). stopId is always a real route_stops row: a
// next-stop prediction toward the school itself (no stopId — see
// EtaWaypoint) has no comparable ground truth in the current schema (no
// "trip completed" timestamp is ever written — trips.completedAt exists in
// the schema but no code path sets it) and is therefore never snapshotted;
// this is a documented, honest scope limitation, not an oversight.
export const etaAccuracyObservations = sqliteTable(
  'eta_accuracy_observations',
  {
    id: id(),
    tripId: text('trip_id').notNull().references(() => trips.id),
    busId: text('bus_id').notNull().references(() => buses.id),
    stopId: text('stop_id').notNull().references(() => routeStops.id),
    predictionTimestamp: integer('prediction_timestamp', { mode: 'timestamp' }).notNull(),
    // predictionTimestamp floored to the nearest 60 seconds — the real
    // duplicate-prevention key, enforced by the unique index below, not
    // just application-level dedup logic.
    predictionBucketAt: integer('prediction_bucket_at', { mode: 'timestamp' }).notNull(),
    predictedArrivalAt: integer('predicted_arrival_at', { mode: 'timestamp' }).notNull(),
    confidence: text('confidence').notNull(), // 'HIGH' | 'MEDIUM' | 'LOW' — copied verbatim from EtaConfidence (etaContract.ts)
    predictionSource: text('prediction_source').notNull(), // 'TELEMETRY' | 'SIMULATION' — copied verbatim from EtaSource (etaContract.ts)
    actualArrivalAt: integer('actual_arrival_at', { mode: 'timestamp' }), // NULL until reconciled; server-derived only, never client-supplied
    actualSource: text('actual_source'), // 'JOURNEY_DROPOFF' once reconciled — the only actual-arrival source this phase implements
    signedErrorSeconds: real('signed_error_seconds'), // predicted - actual, in seconds; positive = ETA predicted later than actual arrival
    absoluteErrorSeconds: real('absolute_error_seconds'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    tripStopBucketUnique: uniqueIndex('eta_accuracy_trip_stop_bucket_unique').on(table.tripId, table.stopId, table.predictionBucketAt),
    tripIdx: index('eta_accuracy_trip_idx').on(table.tripId),
    busIdx: index('eta_accuracy_bus_idx').on(table.busId),
    pendingIdx: index('eta_accuracy_pending_idx').on(table.tripId, table.actualArrivalAt),
  })
);

// Phase 5B — Governed Notifications. A COMMUNICATION record, never a second
// audit/event store (spec §6/§12/§20) — audit_logs remains the sole
// operational-history source of truth this table is derived from. Exactly
// one row per (recipientUserId, sourceEventId): sourceEventId is the id of
// the audit_logs row the notification communicates, and the unique index
// below is the real, database-enforced deduplication boundary (never
// app-level dedup alone, spec §10) — reprocessing the same trusted event is
// always a safe no-op. category/priority/title/body are resolved once, at
// creation time, by NotificationPolicy — deterministic, never an LLM output,
// never re-derived later (a notification's wording is a stable historical
// record, like an SMS once sent). status is DELIVERY state (PENDING/SENT/
// FAILED); readAt is a SEPARATE concept — a parent-owned read receipt, not
// a delivery outcome (spec §17).
export const notifications = sqliteTable(
  'notifications',
  {
    id: id(),
    recipientUserId: text('recipient_user_id').notNull().references(() => users.id),
    studentId: text('student_id').notNull().references(() => students.id),
    journeyId: text('journey_id').notNull().references(() => journeys.id),
    tripId: text('trip_id').notNull().references(() => trips.id),
    eventType: text('event_type').notNull(), // the real Journey event type this notification communicates — never client-supplied (spec §22)
    sourceEventId: text('source_event_id').notNull(), // audit_logs.id — the trusted fact this notification is derived from; the dedup anchor
    category: text('category').notNull(), // NotificationCategory
    title: text('title').notNull(),
    body: text('body').notNull(),
    priority: text('priority').notNull(), // NotificationPriority — always server-derived (spec §15/§22)
    status: text('status').notNull().default('PENDING'), // NotificationStatus — delivery state, distinct from readAt
    failureReason: text('failure_reason'), // observability only — never returned in the parent-facing view (spec §30)
    sentAt: integer('sent_at', { mode: 'timestamp' }),
    readAt: integer('read_at', { mode: 'timestamp' }),
    failedAt: integer('failed_at', { mode: 'timestamp' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    recipientSourceEventUnique: uniqueIndex('notifications_recipient_source_event_unique').on(table.recipientUserId, table.sourceEventId),
    recipientCreatedIdx: index('notifications_recipient_created_idx').on(table.recipientUserId, table.createdAt),
    recipientUnreadIdx: index('notifications_recipient_unread_idx').on(table.recipientUserId, table.readAt),
    studentIdx: index('notifications_student_idx').on(table.studentId),
  })
);

// Phase 6A — Identity & Contact Foundation. The governed `users` row remains
// the ONE authoritative identity (spec §3) — this table adds ONLY
// channel-scoped contact ADDRESSES a user owns, never a second account/
// identity/login concept. No phone/push-token column exists on `users`
// itself (confirmed by this phase's own architecture audit) and none is
// added here — a separate table is the additive, non-destructive choice.
// `value` is the raw address as the user entered it; `normalizedValue` is
// the deterministic, channel-specific normalized form
// (ContactNormalization.ts) used for the uniqueness constraint below and
// for any future lookup — never re-derived ad hoc elsewhere.
// `verifiedAt`/`enabled` are STATE fields: no client-controlled write path
// ever sets verifiedAt directly (spec Phase 6A §8) — every write to it is
// either NULL (default), a deliberate documented seed-data exception, or
// (Phase 6B) ContactVerificationService.confirmVerification succeeding
// against a real, unexpired, previously-requested challenge.
// `verificationCodeHash`/`verificationExpiresAt` (Phase 6B) are that
// challenge's server-only state: a scrypt+salt hash of a real random code
// (same convention as deviceCredentials.ts), never the plaintext, never
// returned by any API. Both are cleared the moment verification succeeds,
// and both are reset to NULL whenever `value` changes (UserContactService
// .updateContact) — a verification only ever attests to the exact value it
// was issued for.
export const userContacts = sqliteTable(
  'user_contacts',
  {
    id: id(),
    userId: text('user_id').notNull().references(() => users.id),
    channel: text('channel').notNull(), // 'EMAIL' | 'SMS' | 'PUSH' — a closed set validated server-side (ContactContract.ts), never an arbitrary client string
    value: text('value').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    verifiedAt: integer('verified_at', { mode: 'timestamp' }),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    verificationCodeHash: text('verification_code_hash'),
    verificationExpiresAt: integer('verification_expires_at', { mode: 'timestamp' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    // The real, database-enforced duplicate-prevention boundary (spec §12):
    // one (user, channel, normalized address) identity can exist as at most
    // one row, ever — disabling a contact toggles `enabled`, it never
    // frees up the identity for a second insert.
    userChannelValueUnique: uniqueIndex('user_contacts_user_channel_value_unique').on(table.userId, table.channel, table.normalizedValue),
    userIdx: index('user_contacts_user_idx').on(table.userId),
    userChannelIdx: index('user_contacts_user_channel_idx').on(table.userId, table.channel),
  })
);

// ---------------------------------------------------------------------------
// Phase 7G — production infrastructure hardening. Two small, additive
// tables giving the legacy session/rate-limit boundary (server/services/
// legacySessionService.ts, loginRateLimiter.ts — Phase 7A) the same
// persistence multi-instance deployment requires, replacing their
// in-memory Maps without changing either file's exported function
// signatures or server.ts's call sites at all.
//
// NO FOREIGN KEY on legacySessions.userId (deliberate, audited — see the
// table's own comment below): this database runs with foreign_keys=ON
// (database/client.ts), and the legacy identity these sessions belong to
// is NOT the governed `users` table above. server.ts's own in-memory
// `users` array is a separate, never-persisted Phase-1 identity store
// (join key: email, the same cross-store correlation every governed route
// has used since Phase 3A); a freshly `/api/auth/register`-ed legacy user
// exists ONLY in that in-memory array, with no governed-table counterpart
// at all. An enforced FK here would throw the moment such a user's
// session is persisted. This is the same "do not fabricate a relationship
// the schema cannot honestly support" discipline Phase 7A's own audit
// already applied to legacy resource ownership — applied here to session
// ownership specifically, and documented rather than worked around.
export const legacySessions = sqliteTable(
  'legacy_sessions',
  {
    id: id(),
    userId: text('user_id').notNull(),
    email: text('email').notNull(),
    role: text('role').notNull(),
    // SHA-256, deliberately NOT the scrypt+salt convention used elsewhere
    // in this codebase for PASSWORDS/device secrets. A session token is
    // already a 256-bit cryptographically random value (randomBytes(32)) —
    // unlike a password, it needs no memory/CPU-hard KDF stretching to
    // resist guessing. It DOES need a deterministic hash: every request
    // must look up its session by an exact `WHERE token_hash = ?` match,
    // which a per-call-random-salted KDF (scrypt/bcrypt) cannot support at
    // all without re-hashing against every stored row. The raw token
    // itself is never persisted — only this deterministic hash, so a
    // database read (backup, replica, breach) can never recover a usable
    // token.
    tokenHash: text('token_hash').notNull(),
    createdAt: createdAt(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex('legacy_sessions_token_hash_unique').on(table.tokenHash),
    userIdx: index('legacy_sessions_user_id_idx').on(table.userId),
    expiresAtIdx: index('legacy_sessions_expires_at_idx').on(table.expiresAt),
  })
);

// Phase 7G — persistent login-attempt/lockout state (was an in-memory Map
// in loginRateLimiter.ts). One row per email actively being tracked; a row
// is deleted entirely on a successful login (not zeroed and kept), so
// storage stays bounded to "emails with a currently-relevant attempt
// history" — the same bound the in-memory Map already had.
export const legacyLoginAttempts = sqliteTable(
  'legacy_login_attempts',
  {
    id: id(),
    email: text('email').notNull(), // already normalized (trim + lowercase) before storage — the same keyFor() convention loginRateLimiter.ts already used
    failures: integer('failures').notNull().default(0),
    lockedUntil: integer('locked_until', { mode: 'timestamp' }),
    updatedAt: updatedAt(),
  },
  (table) => ({
    emailUnique: uniqueIndex('legacy_login_attempts_email_unique').on(table.email),
  })
);

// Phase 7H — production security audit finding (discovered via this
// phase's own mandated live multi-instance test, spec Step 9): the legacy
// credential store (server.ts's `let users = [...]`) was still a plain
// in-memory array, never persisted — unlike legacySessions/
// legacyLoginAttempts (Phase 7G), which were. A password change made via
// one server process was therefore invisible to every other process: the
// old password kept working and the new one didn't, on any instance that
// didn't happen to handle the change-password request. That is a real
// production-correctness defect directly caused by this phase's own new
// mutation path (password change), not a hypothetical — live-verified
// with two independent processes before this table was added, then fixed
// by the same treatment already proven for sessions/rate-limits: persist
// it, keep every exported service-layer function's shape identical.
//
// This is NOT the governed `users` table above and does not touch it or
// its FK graph — it is the same Phase-1 legacy identity store server.ts
// has always had (join key: email, same cross-store correlation every
// governed route already uses), now durable instead of in-memory. No FK
// is added FROM legacySessions/legacyLoginAttempts TO this table: those
// were deliberately left unconstrained in Phase 7G for the same reason
// this table's own existence was only just discovered to be necessary —
// retrofitting a firm FK relationship after the fact is exactly the kind
// of invented-relationship risk this project avoids; the existing
// email-based correlation remains the honest, already-proven mechanism.
// Phase 8B — status/mustChangePassword/createdByUserId support employee
// provisioning (server.ts's /api/admin/employees/*): status gates login
// (a disabled employee cannot authenticate); mustChangePassword forces a
// real password change before an admin-issued temporary credential can be
// used for anything else; createdByUserId is an audit-trail-only field
// (never an FK — self-registered parents and the four seeded demo
// accounts have no creator), matching the same "do not fabricate a
// relationship the schema cannot honestly support" discipline already
// applied to legacySessions.userId and legacy_students.busId.
export const legacyUsers = sqliteTable(
  'legacy_users',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
    createdByUserId: text('created_by_user_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    emailUnique: uniqueIndex('legacy_users_email_unique').on(table.email),
  })
);

// Phase 7K — server.ts's `let buses = [...INITIAL_BUSES]` was, like the
// legacy identity store before Phase 7H, a plain in-memory array: never
// persisted, so a bus update made via one server process was invisible to
// every other process (same defect class as Phase 7H's password bug, this
// time for /api/buses and its dependents). Persisted here with exactly the
// field set the existing API contract (src/types.ts's `Bus` interface,
// confirmed by a full source audit of every server.ts read/write) actually
// requires — nothing invented beyond it. `currentLocation: {lat,lng}` is
// flattened to currentLat/currentLng, the same convention the GOVERNED
// `buses` table above already uses for the same kind of value.
//
// driverId IS a real, enforced FK to legacy_users.id (nullable — see the
// seed comment for exactly which buses get a real value and why: only
// where an already-disclosed, pre-existing name correspondence between
// mockData's driverName and a real legacy_users row exists; every other
// bus is left unassigned rather than fabricating one). This is a
// deliberate, different decision from legacySessions/legacyLoginAttempts
// above (which stayed unconstrained) — those had no candidate table to
// reference honestly; this one now does, because this migration is the
// one creating it.
export const legacyBuses = sqliteTable('legacy_buses', {
  id: id(),
  busNumber: text('bus_number').notNull(),
  plateNumber: text('plate_number').notNull(),
  driverId: text('driver_id').references(() => legacyUsers.id),
  driverName: text('driver_name').notNull(),
  driverPhone: text('driver_phone').notNull(),
  driverAvatar: text('driver_avatar').notNull(),
  capacity: integer('capacity').notNull(),
  currentOccupancy: integer('current_occupancy').notNull().default(0),
  currentLat: real('current_lat').notNull(),
  currentLng: real('current_lng').notNull(),
  speedKmH: real('speed_kmh').notNull().default(0),
  status: text('status').notNull().default('idle'),
  fuelLevel: real('fuel_level').notNull().default(100),
  safetyScore: real('safety_score').notNull().default(100),
  // Opaque reference only — the legacy `routes` array (server.ts) stays
  // in-memory in this phase (source audit found no route requiring it to
  // become persistent), so this cannot be a real FK without persisting
  // routes too, which is out of this phase's scope.
  assignedRouteId: text('assigned_route_id'),
  nextStopName: text('next_stop_name').notNull(),
  nextStopEtaMins: integer('next_stop_eta_mins').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Phase 7K — same treatment as legacyBuses above, for server.ts's
// `let students = [...INITIAL_STUDENTS]`. `pickupPoint: {lat,lng,address,
// nameAr}` is flattened to pickupLat/pickupLng/pickupAddress/pickupNameAr.
//
// parentId IS a real, enforced FK to legacy_users.id (nullable) — same
// seeding discipline as legacyBuses.driverId: only students whose
// mockData parentName already, disclosedly matches a real legacy_users
// row get a real value; everyone else stays unassigned. The legacy
// `POST /api/students` create form has always sent a placeholder
// `parentId: 'par-new'` string that was never a real identity reference
// (confirmed by source audit of DataManagementModal.tsx) — that placeholder
// is not carried into this FK; new students are created unassigned.
export const legacyStudents = sqliteTable('legacy_students', {
  id: id(),
  name: text('name').notNull(),
  grade: text('grade').notNull(),
  avatar: text('avatar').notNull(),
  schoolId: text('school_id').notNull(),
  schoolName: text('school_name').notNull(),
  parentId: text('parent_id').references(() => legacyUsers.id),
  parentName: text('parent_name').notNull(),
  parentPhone: text('parent_phone').notNull(),
  // Plain opaque reference, NOT a FK: the existing delete-bus endpoint has
  // never cascaded or blocked on referencing students (in-memory today,
  // confirmed by source audit), and out-of-scope for this phase's
  // driver/parent ownership model — adding a FK here would silently
  // change delete semantics the phase's own instructions say to preserve.
  busId: text('bus_id').notNull(),
  busNumber: text('bus_number').notNull(),
  pickupLat: real('pickup_lat').notNull(),
  pickupLng: real('pickup_lng').notNull(),
  pickupAddress: text('pickup_address').notNull(),
  pickupNameAr: text('pickup_name_ar').notNull(),
  status: text('status').notNull().default('at_home'),
  pickupTimePlanned: text('pickup_time_planned').notNull(),
  pickupTimeActual: text('pickup_time_actual'),
  seatNumber: text('seat_number').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
