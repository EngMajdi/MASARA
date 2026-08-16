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
