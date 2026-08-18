export type UserRole = 'parent' | 'driver' | 'school' | 'admin';

export type StudentStatus = 'at_home' | 'waiting' | 'boarded' | 'at_school' | 'absent';

export interface Student {
  id: string;
  name: string;
  grade: string;
  avatar: string;
  schoolId: string;
  schoolName: string;
  parentId: string;
  parentName: string;
  parentPhone: string;
  busId: string;
  busNumber: string;
  pickupPoint: {
    lat: number;
    lng: number;
    address: string;
    nameAr: string;
  };
  status: StudentStatus;
  pickupTimePlanned: string;
  pickupTimeActual?: string;
  seatNumber: string;
}

export interface School {
  id: string;
  nameAr: string;
  location: {
    lat: number;
    lng: number;
    address: string;
  };
  startTime: string;
  endTime: string;
  totalStudents: number;
  activeBusesCount: number;
}

export interface Bus {
  id: string;
  busNumber: string;
  plateNumber: string;
  driverName: string;
  driverPhone: string;
  driverAvatar: string;
  capacity: number;
  currentOccupancy: number;
  currentLocation: {
    lat: number;
    lng: number;
  };
  speedKmH: number;
  status: 'idle' | 'en_route_pickup' | 'en_route_school' | 'returning' | 'maintenance';
  fuelLevel: number; // percentage
  safetyScore: number; // 0-100
  assignedRouteId: string;
  nextStopName: string;
  nextStopEtaMins: number;
}

export interface PickupStop {
  id: string;
  nameAr: string;
  lat: number;
  lng: number;
  studentIds: string[];
  estimatedTime: string;
  completed: boolean;
  orderSequence: number;
}

export interface Route {
  id: string;
  routeNameAr: string;
  schoolId: string;
  busId: string;
  waypoints: {
    lat: number;
    lng: number;
    type: 'start' | 'pickup' | 'school';
    label: string;
  }[];
  stops: PickupStop[];
  totalDistanceKm: number;
  estimatedDurationMins: number;
  status: 'active' | 'scheduled' | 'completed' | 'rerouted';
  aiEfficiencyScore: number;
  carbonSavedKg: number;
  aiRationaleAr?: string;
}

export interface SystemNotification {
  id: string;
  timestamp: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'alert';
  targetRole: UserRole | 'all';
  read: boolean;
}

export interface AIAgentWorkflowStep {
  stepNumber: number;
  titleAr: string;
  descriptionAr: string;
  subTasks: string[];
  status: 'completed' | 'processing' | 'idle';
  timestamp?: string;
}

export interface AIOptimizationResult {
  routes: Route[];
  summaryAr: string;
  aiEfficiencyGainPercentage: number;
  timeSavedMins: number;
  fuelSavedLiters: number;
  safetyAlerts: string[];
}

// --- Phase 2A: Approval Center (governed AI recommendations, DB-backed) ---
// Mirrors database/schema.ts `ai_recommendations` — dates arrive as ISO strings over JSON.

export type RecommendationStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'executed'
  | 'execution_failed'
  | 'verified'
  | 'verification_failed';

export type RecommendationSeverity = 'low' | 'medium' | 'high' | 'critical';

export type RecommendationType = 'DELAY' | 'ROUTE_CHANGE' | 'SAFETY_ALERT' | 'PARENT_NOTIFICATION' | 'MONITORING';

export type RecommendationActionType = 'CHANGE_ROUTE' | 'NOTIFY_SCHOOL' | 'FLAG_INCIDENT' | 'NO_ACTION';

export interface AIRecommendation {
  id: string;
  tripId: string;
  busId: string | null;
  sourceRouteId: string | null;
  agentRunId: string;
  type: RecommendationType;
  title: string;
  severity: RecommendationSeverity;
  problem: string;
  predictionId: string | null;
  confidence: number;
  action: RecommendationActionType;
  targetId: string | null;
  reason: string;
  expectedOutcome: string | null;
  requiresApproval: boolean;
  status: RecommendationStatus;
  expiresAt: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GovernedTrip {
  id: string;
  routeId: string;
  busId: string;
  driverId: string | null;
  status: string;
  startedAt: string | null;
  targetArrivalAt: string | null;
  currentEtaAt: string | null;
  completedAt: string | null;
}

export interface GovernedBus {
  id: string;
  busNumber: string;
  plateNumber: string;
  status: string;
  currentLat: number | null;
  currentLng: number | null;
  speedKmh: number;
}

export interface GovernedRoute {
  id: string;
  name: string;
  totalDistanceKm: number;
  estimatedDurationMins: number;
  status: string;
}

export interface GovernedPrediction {
  id: string;
  tripId: string;
  currentEtaAt: string | null;
  targetArrivalAt: string | null;
  delayMinutes: number;
  delayProbability: number;
  riskLevel: string;
}

// --- Phase 2B: Simulation Engine + AI Operations Feed ---

export type SimulationStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type ScenarioId = 'TRAFFIC_DELAY' | 'MINOR_DELAY' | 'NORMAL_TRIP' | 'SAFETY_INCIDENT';

export interface SimulationStepResult {
  stepIndex: number;
  eventType: string;
  label: string;
  simulatedTime: string;
  payload: Record<string, unknown>;
  waitingForApproval: boolean;
}

export interface SimulationSession {
  id: string;
  scenario: ScenarioId;
  status: SimulationStatus;
  tripId: string;
  busId: string;
  createdBy: string;
  startedAt: string;
  completedAt: string | null;
  currentStep: number;
  totalSteps: number;
  simulatedTime: string;
  recommendationId: string | null;
  lastResult: SimulationStepResult | null;
  errorMessage: string | null;
}

export type FeedCategory = 'all' | 'ai' | 'trips' | 'students' | 'approvals' | 'actions' | 'verification' | 'safety';

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

export interface AuditEvent {
  id: string;
  eventType: string;
  actorId: string | null;
  actorType: string;
  entityType: string;
  entityId: string | null;
  previousState: string | null;
  newState: string | null;
  metadata: string | null;
  operatorDecision: string | null;
  createdAt: string;
}

export interface ActionVerification {
  id: string;
  actionId: string;
  etaBefore: string | null;
  etaAfter: string | null;
  improvementMins: number | null;
  status: 'success' | 'partial_success' | 'failed';
  checkedAt: string;
}

// --- Phase 3A/3B: Journey Core + Operations Experience ---
// Mirrors database/schema.ts `journeys` — dates arrive as ISO strings over JSON.

export type JourneyState =
  | 'scheduled'
  | 'waiting'
  | 'boarding'
  | 'on_bus'
  | 'in_transit'
  | 'approaching_stop'
  | 'dropped_off'
  | 'completed'
  | 'cancelled'
  | 'missed'
  | 'incident';

export interface Journey {
  id: string;
  studentId: string;
  tripId: string;
  state: JourneyState;
  currentStopId: string | null;
  scheduledPickupTime: string | null;
  scheduledDropoffTime: string | null;
  boardedAt: string | null;
  droppedOffAt: string | null;
  missedReason: string | null;
  cancelReason: string | null;
  incidentReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export type JourneyStateCounts = Record<JourneyState, number>;

export interface TripJourneySummary {
  tripId: string;
  totalStudents: number;
  counts: JourneyStateCounts;
}

/** A Journey enriched server-side with the governed student's name/grade for display (spec §36 — never fabricated, always backend-derived). */
export interface JourneyWithStudent extends Journey {
  studentName: string | null;
  studentGrade: string | null;
}

export interface TripWithJourneys {
  trip: GovernedTrip;
  busNumber: string | null;
  routeName: string | null;
  journeys: JourneyWithStudent[];
}

export interface TripWithJourneySummary {
  trip: GovernedTrip;
  busNumber: string | null;
  routeName: string | null;
  driverName: string | null;
  summary: TripJourneySummary;
}

export interface GovernedRouteStop {
  id: string;
  routeId: string;
  name: string;
  lat: number;
  lng: number;
  orderSequence: number;
}

// --- Phase 4A: GPS Simulation Engine ---
// Mirrors server/services/GpsSimulationEngine.ts + server/domain/telemetryContract.ts
// — a SEPARATE session/status vocabulary from Phase 2B's SimulationSession
// (spec §19 — must stay clearly distinct, never merged).

export type GpsSimulationStatus = 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type SpeedProfile = 'STOPPED' | 'SLOW' | 'NORMAL' | 'FAST';

export interface TelemetryObservation {
  observationId: string;
  sourceEventId: string;
  source: 'SIMULATION' | 'DEVICE' | 'GPS_PROVIDER';
  busId: string;
  tripId: string | null;
  sequence: number;
  occurredAt: string;
  receivedAt: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
}

export interface GpsSimulationSession {
  id: string;
  tripId: string;
  busId: string;
  routeId: string;
  status: GpsSimulationStatus;
  speedProfile: SpeedProfile;
  tickSeconds: number;
  speedMultiplier: number;
  createdBy: string;
  startedAt: string;
  simulatedTime: string;
  currentLat: number;
  currentLng: number;
  currentHeading: number | null;
  sequence: number;
  observations: TelemetryObservation[];
  lastObservation: TelemetryObservation | null;
  errorMessage: string | null;
}

// --- Phase 4C: Current Location Projection ---
// Mirrors the public shape returned by GET /api/telemetry/current/:busId
// and /api/telemetry/current/fleet — a derived read model, not raw telemetry
// history (that remains GET /api/telemetry/observations, a separate endpoint).

export type LocationFreshness = 'FRESH' | 'STALE';

export interface CurrentLocation {
  busId: string;
  tripId: string | null;
  observationId: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  occurredAt: string;
  receivedAt: string;
  source: 'DEVICE' | 'GPS_PROVIDER' | 'SIMULATION';
  freshness: LocationFreshness;
}

// --- Phase 4D: ETA Intelligence ---
// Mirrors the public shape returned by GET /api/eta/bus/:busId,
// GET /api/eta/trip/:tripId, and GET /api/eta/fleet — deterministic,
// explainable estimates only. Never an LLM output, never fabricated traffic.

export type EtaStatus = 'ON_TIME' | 'DELAYED' | 'STALE' | 'UNKNOWN';
export type EtaConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type EtaSourceKind = 'TELEMETRY' | 'SIMULATION';
export type DelayClassification = 'ON_TIME' | 'MINOR_DELAY' | 'SIGNIFICANT_DELAY';

export interface EtaExplanation {
  reason: string;
  freshLocation: boolean;
  validSpeed: boolean;
  routeGeometryAvailable: boolean;
}

export interface EtaEstimateView {
  busId: string;
  tripId: string | null;
  routeId: string | null;
  nextStopId: string | null;
  nextStopName: string | null;
  estimatedArrivalAt: string | null;
  finalDestinationEtaAt: string | null;
  remainingDistanceMeters: number | null;
  remainingToDestinationMeters: number | null;
  estimatedTravelSeconds: number | null;
  currentSpeedKmh: number | null;
  effectiveSpeedKmh: number | null;
  confidence: EtaConfidence;
  status: EtaStatus;
  source: EtaSourceKind | null;
  calculatedAt: string;
  explanation: EtaExplanation;
  delay: {
    scheduledArrivalAt: string;
    delaySeconds: number;
    classification: DelayClassification;
  } | null;
}

// --- Phase 4E: ETA Accuracy Validation ---
// Mirrors the public shape returned by GET /api/eta/accuracy/summary and
// GET /api/eta/accuracy/trips/:tripId. Every metric here is measured against
// a real Journey drop-off fact — never a fabricated or simulated "actual".

export type AccuracySourceMix = 'TELEMETRY' | 'SIMULATION' | 'MIXED' | 'NONE';

export interface AccuracyBand {
  withinSeconds: number;
  sampleCount: number;
  percentage: number | null;
}

export interface AccuracyBreakdownGroup {
  group: string;
  sampleCount: number;
  maeSeconds: number | null;
  biasSeconds: number | null;
}

export interface EtaAccuracyView {
  sourceMix: AccuracySourceMix;
  totalCandidates: number;
  measurableSamples: number;
  coverage: number | null;
  maeSeconds: number | null;
  biasSeconds: number | null;
  bands: AccuracyBand[];
  byConfidence: AccuracyBreakdownGroup[];
  bySource: AccuracyBreakdownGroup[];
  byHorizon: AccuracyBreakdownGroup[];
}
