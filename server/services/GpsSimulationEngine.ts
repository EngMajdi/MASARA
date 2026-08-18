import { tripRepository } from '../repositories/tripRepository';
import { busRepository } from '../repositories/busRepository';
import { routeRepository } from '../repositories/routeRepository';
import { schoolRepository } from '../repositories/schoolRepository';
import { processObservation } from './CurrentLocationProjectionService';
import { captureEtaAccuracySnapshot } from './EtaAccuracyService';
import type { TelemetryObservation } from '../domain/telemetryContract';

// GPS Simulation Engine (Phase 4A) — the FIRST real-time mobility producer.
// This is a deliberately SEPARATE responsibility from Phase 2B's
// SimulationEngine.ts (spec §5/§19): that engine simulates the AI
// governance workflow (traffic delay -> recommendation -> approval); this
// one simulates a bus physically moving and produces normalized
// TelemetryObservation records. They share vocabulary (RUNNING/PAUSED/
// COMPLETED/...) by convention, not by type — merging them would violate
// spec §19's explicit "must be clearly distinct" requirement, and a real
// GPS provider integration in Phase 4B must never be confused with the AI
// scenario simulator.
//
// THE CENTRAL RULE (spec §3/§14/§42): a telemetry observation is a fact
// about where the bus physically is. It is NEVER allowed to call
// JourneyService, mutate `journeys`/`trips`/`buses` rows, or write to
// audit_logs. This file makes that true by simple absence — it imports no
// mutating repository method and no JourneyService function at all. The bus
// "moving" here exists only inside this module's own in-memory session.

export type GpsSimulationStatus = 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type SpeedProfile = 'STOPPED' | 'SLOW' | 'NORMAL' | 'FAST';

// Configurable, not hard-coded throughout the engine (spec §10/§11).
export const SPEED_PROFILE_KMH: Record<SpeedProfile, number> = {
  STOPPED: 0,
  SLOW: 15,
  NORMAL: 30,
  FAST: 50,
};

export class GpsSimulationNotFoundError extends Error {}
export class GpsSimulationStateError extends Error {}
export class GpsRouteValidationError extends Error {}
export class GpsObservationValidationError extends Error {}

interface Waypoint {
  lat: number;
  lng: number;
  /** null for the final leg into the school itself — every other point is a real routeStops row. */
  stopId: string | null;
  label: string;
}

export interface GpsSimulationSession {
  id: string;
  tripId: string;
  busId: string;
  routeId: string;
  status: GpsSimulationStatus;
  speedProfile: SpeedProfile;
  // Simulated seconds advanced per tick = tickSeconds * speedMultiplier
  // (spec §17 — the demo-acceleration clock multiplier is a SEPARATE knob
  // from physical vehicle speed/speedProfile; never conflate the two).
  tickSeconds: number;
  speedMultiplier: number;
  createdBy: string;
  startedAt: Date; // real wall-clock session-creation bookkeeping only
  simulatedTime: Date; // the occurredAt clock — deterministic, ticks only on advance()
  waypoints: Waypoint[];
  legIndex: number;
  distanceIntoLegMeters: number;
  currentLat: number;
  currentLng: number;
  currentHeading: number | null;
  sequence: number;
  observations: TelemetryObservation[]; // in-memory only (spec §31/§68 — no telemetry table, lost on server restart, intentional)
  lastObservation: TelemetryObservation | null;
  errorMessage: string | null;
  /** Synchronous re-entrancy guard, same pattern as SimulationEngine's busyExecuting (spec §71, AC — no duplicate observation generation). */
  busyExecuting: boolean;
}

export interface GpsSimulationConfig {
  tickSeconds?: number; // default 5 simulated seconds per advance() call
  speedMultiplier?: number; // default 1 — demo acceleration only
  speedProfile?: SpeedProfile; // default NORMAL
  startTime?: Date; // default: real "now" at session creation, used only as the simulated clock's starting value
}

const sessions = new Map<string, GpsSimulationSession>();

// ---------------------------------------------------------------------------
// Geometry — moved to server/domain/geo.ts in Phase 4D so EtaService can
// reuse the exact same implementation (spec Phase 4D §9 — no second
// Haversine function). Re-exported here unchanged so every existing import
// of these names from GpsSimulationEngine keeps working.
// ---------------------------------------------------------------------------
export { haversineMeters, initialBearingDegrees, interpolatePosition } from '../domain/geo';
import { haversineMeters, interpolatePosition, initialBearingDegrees } from '../domain/geo';

// ---------------------------------------------------------------------------
// Route resolution
// ---------------------------------------------------------------------------

/**
 * Waypoint sequence = every real RouteStop (ordered by orderSequence, real
 * seeded coordinates) followed by the school itself as the final
 * destination (spec §7 — use existing coordinates, never fabricate real-
 * looking ones; a route's implicit endpoint is the school every bus
 * converges on). Throws GpsRouteValidationError with the exact missing
 * piece if geometry is insufficient — this codebase's seeded routes all
 * have >=1 real stop, so this is a genuine safety net, not dead code.
 */
function resolveWaypoints(routeId: string, schoolId: string): Waypoint[] {
  const stops = routeRepository.findStopsByRouteId(routeId).slice().sort((a, b) => a.orderSequence - b.orderSequence);
  if (stops.length === 0) {
    throw new GpsRouteValidationError(`لا توجد نقاط توقف (RouteStop) لهذا المسار (${routeId}) — تعذّر بناء مسار المحاكاة.`);
  }
  for (const s of stops) {
    if (!isValidLatLng(s.lat, s.lng)) {
      throw new GpsRouteValidationError(`إحداثيات نقطة التوقف "${s.name}" غير صالحة.`);
    }
  }
  const school = schoolRepository.findById(schoolId);
  if (!school || !isValidLatLng(school.lat, school.lng)) {
    throw new GpsRouteValidationError('إحداثيات المدرسة غير صالحة أو غير موجودة — تعذّر تحديد نهاية المسار.');
  }

  const waypoints: Waypoint[] = stops.map((s) => ({ lat: s.lat, lng: s.lng, stopId: s.id, label: s.name }));
  waypoints.push({ lat: school.lat, lng: school.lng, stopId: null, label: school.nameAr });
  return waypoints;
}

function isValidLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// ---------------------------------------------------------------------------
// Validation boundary (spec §24) — every observation, simulated or future-
// real, passes through the same checks. Never a "simulation-only" bypass.
// ---------------------------------------------------------------------------

export function validateObservation(obs: TelemetryObservation): void {
  if (!obs.busId) throw new GpsObservationValidationError('busId مطلوب لكل رصد GPS.');
  if (!obs.sourceEventId) throw new GpsObservationValidationError('sourceEventId مطلوب لكل رصد GPS.');
  if (!obs.observationId) throw new GpsObservationValidationError('observationId مطلوب لكل رصد GPS.');
  if (!isValidLatLng(obs.latitude, obs.longitude)) {
    throw new GpsObservationValidationError(`إحداثيات غير صالحة: (${obs.latitude}, ${obs.longitude}).`);
  }
  if (!(obs.occurredAt instanceof Date) || Number.isNaN(obs.occurredAt.getTime())) {
    throw new GpsObservationValidationError('occurredAt غير صالح.');
  }
  if (obs.source !== 'SIMULATION' && obs.source !== 'DEVICE' && obs.source !== 'GPS_PROVIDER') {
    throw new GpsObservationValidationError(`مصدر رصد غير معروف: "${obs.source}".`);
  }
  if (obs.speed != null && obs.speed < 0) throw new GpsObservationValidationError('السرعة لا يمكن أن تكون سالبة.');
  if (obs.sequence < 1) throw new GpsObservationValidationError('sequence يجب أن يكون رقماً تسلسلياً موجباً.');
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/**
 * Starts a GPS simulation against a real, existing trip. Validates trip,
 * bus, route, and route geometry before creating any session (spec §44 —
 * never a partially-invalid start). Never touches `trips`/`buses`/`journeys`
 * — this is purely an in-memory producer (spec §30 option B).
 */
export function startGpsSimulation(tripId: string, createdBy: string, config: GpsSimulationConfig = {}): GpsSimulationSession {
  const trip = tripRepository.findById(tripId);
  if (!trip) throw new GpsRouteValidationError('الرحلة المحددة لمحاكاة GPS غير موجودة.');
  const bus = busRepository.findById(trip.busId);
  if (!bus) throw new GpsRouteValidationError('الحافلة المرتبطة بهذه الرحلة غير موجودة.');
  const route = routeRepository.findById(trip.routeId);
  if (!route) throw new GpsRouteValidationError('المسار المرتبط بهذه الرحلة غير موجود.');

  const conflicting = Array.from(sessions.values()).find(
    (s) => s.tripId === tripId && (s.status === 'RUNNING' || s.status === 'PAUSED')
  );
  if (conflicting) {
    throw new GpsSimulationStateError('توجد بالفعل محاكاة GPS نشطة على هذه الرحلة — أوقفها أولاً.');
  }

  const waypoints = resolveWaypoints(trip.routeId, bus.schoolId);
  const startTime = config.startTime ?? new Date();

  const session: GpsSimulationSession = {
    id: crypto.randomUUID(),
    tripId,
    busId: trip.busId,
    routeId: trip.routeId,
    status: 'RUNNING',
    speedProfile: config.speedProfile ?? 'NORMAL',
    tickSeconds: config.tickSeconds ?? 5,
    speedMultiplier: config.speedMultiplier ?? 1,
    createdBy,
    startedAt: new Date(),
    simulatedTime: startTime,
    waypoints,
    legIndex: 0,
    distanceIntoLegMeters: 0,
    currentLat: waypoints[0].lat,
    currentLng: waypoints[0].lng,
    currentHeading: null,
    sequence: 0,
    observations: [],
    lastObservation: null,
    errorMessage: null,
    busyExecuting: false,
  };
  sessions.set(session.id, session);
  return session;
}

export function getGpsSession(id: string): GpsSimulationSession {
  const session = sessions.get(id);
  if (!session) throw new GpsSimulationNotFoundError('جلسة محاكاة GPS غير موجودة.');
  return session;
}

export function listGpsSessions(): GpsSimulationSession[] {
  return Array.from(sessions.values()).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

/**
 * Advances the simulation by exactly one deterministic tick (spec §15 —
 * deterministic simulation time, not wall-clock-driven; no server-side
 * timer exists, so there is nothing to leak or double-fire — spec §71/§72).
 * Produces exactly one new TelemetryObservation, walking forward across as
 * many waypoint legs as the tick's distance covers (spec §47 — distance,
 * speed, and simulated time stay internally consistent; the multiplier only
 * scales how much simulated time one tick represents, never the physics).
 */
export function advanceGpsSimulation(id: string): TelemetryObservation {
  const session = getGpsSession(id);
  if (session.status !== 'RUNNING') {
    throw new GpsSimulationStateError(`لا يمكن متابعة محاكاة GPS بحالة "${session.status}".`);
  }
  if (session.busyExecuting) {
    throw new GpsSimulationStateError('خطوة أخرى قيد التنفيذ بالفعل لهذه الجلسة — انتظر انتهاءها.');
  }
  session.busyExecuting = true;

  try {
    const speedKmh = SPEED_PROFILE_KMH[session.speedProfile];
    const simulatedSecondsThisTick = session.tickSeconds * session.speedMultiplier;
    let remainingMeters = (speedKmh * 1000) / 3600 * simulatedSecondsThisTick;

    const prevPos = { lat: session.currentLat, lng: session.currentLng };
    let reachedEnd = false;

    while (remainingMeters > 0 && !reachedEnd) {
      const legStart = session.waypoints[session.legIndex];
      const legEnd = session.waypoints[session.legIndex + 1];
      if (!legEnd) {
        reachedEnd = true;
        break;
      }
      const legLengthMeters = haversineMeters(legStart, legEnd);
      const remainingInLeg = legLengthMeters - session.distanceIntoLegMeters;

      if (legLengthMeters === 0 || remainingMeters >= remainingInLeg) {
        // Finish this leg (or skip a zero-length one) and carry the rest forward.
        remainingMeters -= Math.max(0, remainingInLeg);
        session.legIndex += 1;
        session.distanceIntoLegMeters = 0;
        if (session.legIndex >= session.waypoints.length - 1) {
          reachedEnd = true;
        }
      } else {
        session.distanceIntoLegMeters += remainingMeters;
        remainingMeters = 0;
      }
    }

    let newPos: { lat: number; lng: number };
    if (reachedEnd) {
      const last = session.waypoints[session.waypoints.length - 1];
      newPos = { lat: last.lat, lng: last.lng };
      session.legIndex = session.waypoints.length - 1;
      session.distanceIntoLegMeters = 0;
    } else {
      const legStart = session.waypoints[session.legIndex];
      const legEnd = session.waypoints[session.legIndex + 1];
      const legLengthMeters = haversineMeters(legStart, legEnd);
      const t = legLengthMeters === 0 ? 1 : session.distanceIntoLegMeters / legLengthMeters;
      newPos = interpolatePosition(legStart, legEnd, t);
    }

    session.currentHeading = speedKmh === 0 ? null : initialBearingDegrees(prevPos, newPos);
    session.currentLat = newPos.lat;
    session.currentLng = newPos.lng;
    session.simulatedTime = new Date(session.simulatedTime.getTime() + simulatedSecondsThisTick * 1000);
    session.sequence += 1;

    const observation: TelemetryObservation = {
      observationId: crypto.randomUUID(),
      // Deterministic per (session, sequence) pair (spec §21) — the same
      // logical tick always produces the same sourceEventId, which is
      // exactly the property Phase 4B deduplication will rely on.
      sourceEventId: `SIM-${session.id}-${session.sequence}`,
      source: 'SIMULATION',
      busId: session.busId,
      tripId: session.tripId,
      sequence: session.sequence,
      occurredAt: new Date(session.simulatedTime),
      // Real wall-clock time is used here deliberately: this producer runs
      // in-process, so "when MASARA received it" and "now" genuinely are
      // the same instant for a simulated source (spec §14's documentation
      // requirement — this is NOT true for occurredAt, which is the
      // simulated clock, nor will it be true for a real Phase 4B device).
      receivedAt: new Date(),
      latitude: session.currentLat,
      longitude: session.currentLng,
      speed: speedKmh,
      heading: session.currentHeading ?? undefined,
      accuracy: 10, // simulated value only — never hardware-grade (spec §13)
    };

    validateObservation(observation);
    session.observations.push(observation);
    session.lastObservation = observation;
    // Phase 4C — feeds the same current-location projection real device
    // telemetry does, WITHOUT ever writing a telemetry_observations row
    // (the simulator is never a registered device — see
    // CurrentLocationProjectionService's header comment for the full
    // rationale). Best-effort, never throws, never blocks the tick.
    processObservation(observation);
    // Phase 4E — best-effort ETA accuracy snapshot, same non-blocking
    // contract as processObservation above (never throws, never delays a tick).
    captureEtaAccuracySnapshot(observation.busId);

    if (reachedEnd) {
      session.status = 'COMPLETED';
    }

    return observation;
  } catch (err) {
    session.status = 'FAILED';
    session.errorMessage = (err as Error).message;
    throw err;
  } finally {
    session.busyExecuting = false;
  }
}

export function pauseGpsSimulation(id: string): GpsSimulationSession {
  const session = getGpsSession(id);
  if (session.status !== 'RUNNING') {
    throw new GpsSimulationStateError(`لا يمكن إيقاف محاكاة GPS مؤقتاً بحالة "${session.status}".`);
  }
  session.status = 'PAUSED';
  return session;
}

/** Resumes from the exact simulated position/time — never restarts the route (spec §40). */
export function resumeGpsSimulation(id: string): GpsSimulationSession {
  const session = getGpsSession(id);
  if (session.status !== 'PAUSED') {
    throw new GpsSimulationStateError(`لا يمكن استئناف محاكاة GPS بحالة "${session.status}".`);
  }
  session.status = 'RUNNING';
  return session;
}

/** Stops generating new observations but preserves already-generated ones for inspection (spec §41). */
export function cancelGpsSimulation(id: string): GpsSimulationSession {
  const session = getGpsSession(id);
  if (session.status === 'COMPLETED' || session.status === 'FAILED' || session.status === 'CANCELLED') {
    throw new GpsSimulationStateError(`لا يمكن إلغاء محاكاة GPS بحالة "${session.status}" (منتهية بالفعل).`);
  }
  session.status = 'CANCELLED';
  return session;
}

/** In-memory bookkeeping only — never touches any database table (spec §31/§68, mirrors SimulationEngine.resetAllSimulations). */
export function resetAllGpsSimulations(): void {
  sessions.clear();
}
