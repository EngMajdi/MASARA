import { haversineMeters, interpolatePosition } from '../domain/geo';
import { getCurrentLocation, listFleetCurrentLocations, deriveFreshness } from './CurrentLocationProjectionService';
import { tripRepository } from '../repositories/tripRepository';
import { busRepository } from '../repositories/busRepository';
import { routeRepository } from '../repositories/routeRepository';
import { schoolRepository } from '../repositories/schoolRepository';
import { telemetryObservationRepository } from '../repositories/telemetryObservationRepository';
import {
  DEFAULT_ETA_SPEED_KMH,
  ETA_MAX_REASONABLE_SPEED_KMH,
  ETA_RECENT_SPEED_SAMPLE_SIZE,
  ETA_MINOR_DELAY_THRESHOLD_SECONDS,
  ETA_SIGNIFICANT_DELAY_THRESHOLD_SECONDS,
  type EtaEstimate,
  type EtaEstimationContext,
  type EtaEstimator,
  type EtaWaypoint,
  type EtaConfidence,
  type EtaStatus,
  type DelayClassification,
} from '../domain/etaContract';

// Phase 4D — ETA Intelligence. A pure READ/ANALYSIS layer (spec §14, §0.4):
// it consumes the Phase 4C current-location projection + existing Route/
// RouteStop/school geometry and produces an in-memory EtaEstimate. It
// imports NO mutating function from JourneyService, TelemetryIngestionService,
// CurrentLocationProjectionService (write path), ActionExecutor, PolicyEngine,
// or MasaraOperationsAgent — the governance boundary holds by simple
// absence, exactly like GpsSimulationEngine and TelemetryIngestionService
// before it.
//
// EXTENSION POINT — ETA -> existing governance (spec §21/§23/§24/§25): this
// phase deliberately does NOT wire a SIGNIFICANT_DELAY finding into
// MasaraOperationsAgent.runForTrip automatically. Two reasons, both
// architectural, not laziness:
//   1. runForTrip reads its ETA input from `trips.currentEtaAt` (a Trip
//      column), not from a value a caller passes in. The only way to make
//      the agent's prediction reflect THIS service's telemetry-derived ETA
//      would be to either (a) write to trips.currentEtaAt — an explicit
//      Trip mutation, forbidden for ETA (spec §0.4/§26) — or (b) change
//      MasaraOperationsAgent's signature to accept an external ETA override,
//      a cross-phase change to Phase 2A code the spec says to avoid without
//      a genuine blocker (spec §0.10/§56).
//   2. Section §24 explicitly permits this outcome: "If [policy/recommendation
//      rules] do not support an ETA-specific recommendation yet: implement
//      ETA analysis only and document the extension point. Do not force a
//      recommendation into the system merely to demonstrate AI."
// The real, already-existing extension point is POST /api/agent/run
// (agentRoutes.ts) — an operator who sees a SIGNIFICANT_DELAY finding in
// the ETA panel can already trigger the existing, unmodified governed
// analysis for that trip through the existing UI. EtaOperationalFinding
// (etaContract.ts) documents the exact structured shape a future phase
// could pass into a new, explicitly-reviewed integration — nothing here
// constructs or sends one automatically.

function isValidSpeedKmh(speed: number | null | undefined): speed is number {
  return typeof speed === 'number' && Number.isFinite(speed) && speed > 0 && speed <= ETA_MAX_REASONABLE_SPEED_KMH;
}

/** Resolves Route stops (ordered) + the school as the final waypoint — the exact same convention GpsSimulationEngine uses (Phase 4A), so a simulated bus and this service agree on what "the route" means. */
function resolveWaypoints(routeId: string, schoolId: string): EtaWaypoint[] | null {
  const stops = routeRepository.findStopsByRouteId(routeId).slice().sort((a, b) => a.orderSequence - b.orderSequence);
  if (stops.length === 0) return null;
  const school = schoolRepository.findById(schoolId);
  if (!school) return null;
  const waypoints: EtaWaypoint[] = stops.map((s) => ({ lat: s.lat, lng: s.lng, stopId: s.id, name: s.name }));
  waypoints.push({ lat: school.lat, lng: school.lng, stopId: null, name: school.nameAr });
  return waypoints;
}

interface RouteProgress {
  nextWaypoint: EtaWaypoint;
  remainingToNextStopMeters: number;
  remainingToDestinationMeters: number;
  /** Smallest distance from the bus to any sampled point on the route polyline — a data-quality signal, not a precise map-match (spec §6 "bus outside route corridor"). */
  routeMatchDistanceMeters: number;
}

const SEGMENT_SAMPLE_STEPS = 20;

/**
 * Determines the bus's position along the ordered route (spec §10) by
 * finding, across every segment of the polyline, the sampled point closest
 * to the bus — then "next stop" is simply the endpoint of that segment.
 * Searching ALL segments (not just nearest-waypoint) is what keeps this
 * order-respecting: a bus near the start of the route matches segment 0
 * even if a later stop happens to be geographically nearby, because the
 * sampled points along segment 0 near the bus's real position are closer.
 * Coarse (21 samples/segment) and deliberately not precision-map-matching —
 * consistent with Phase 4A's own "no geographic perfection required".
 */
export function computeRouteProgress(pos: { lat: number; lng: number }, waypoints: EtaWaypoint[]): RouteProgress | null {
  if (waypoints.length < 2) return null;

  let bestSegment = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    for (let s = 0; s <= SEGMENT_SAMPLE_STEPS; s++) {
      const t = s / SEGMENT_SAMPLE_STEPS;
      const point = interpolatePosition(a, b, t);
      const d = haversineMeters(pos, point);
      if (d < bestDistance) {
        bestDistance = d;
        bestSegment = i;
      }
    }
  }
  if (bestSegment === -1) return null;

  const nextIndex = bestSegment + 1;
  const nextWaypoint = waypoints[nextIndex];
  const remainingToNextStopMeters = haversineMeters(pos, nextWaypoint);

  let remainingToDestinationMeters = remainingToNextStopMeters;
  for (let i = nextIndex; i < waypoints.length - 1; i++) {
    remainingToDestinationMeters += haversineMeters(waypoints[i], waypoints[i + 1]);
  }

  return { nextWaypoint, remainingToNextStopMeters, remainingToDestinationMeters, routeMatchDistanceMeters: bestDistance };
}

/** Effective speed resolution (spec §5): current telemetry speed -> recent observed history -> configured default. Never divides by zero (speed=0 is treated as invalid for THIS purpose and falls through). */
export function resolveEffectiveSpeed(
  currentSpeedKmh: number | null,
  recentSamplesKmh: number[]
): { speedKmh: number; tier: 'current' | 'recent' | 'default' } {
  if (isValidSpeedKmh(currentSpeedKmh)) return { speedKmh: currentSpeedKmh, tier: 'current' };

  const validRecent = recentSamplesKmh.filter(isValidSpeedKmh);
  if (validRecent.length > 0) {
    const avg = validRecent.reduce((sum, s) => sum + s, 0) / validRecent.length;
    return { speedKmh: avg, tier: 'recent' };
  }

  return { speedKmh: DEFAULT_ETA_SPEED_KMH, tier: 'default' };
}

export function classifyDelay(delaySeconds: number): DelayClassification {
  if (delaySeconds >= ETA_SIGNIFICANT_DELAY_THRESHOLD_SECONDS) return 'SIGNIFICANT_DELAY';
  if (delaySeconds >= ETA_MINOR_DELAY_THRESHOLD_SECONDS) return 'MINOR_DELAY';
  return 'ON_TIME';
}

export function calculateConfidence(opts: {
  isFresh: boolean;
  speedTier: 'current' | 'recent' | 'default';
  routeMatchDistanceMeters: number;
}): { confidence: EtaConfidence; reasonParts: string[] } {
  const reasonParts: string[] = [];
  let score = 0;

  if (opts.isFresh) {
    score += 2;
    reasonParts.push('رصد GPS حديث');
  } else {
    reasonParts.push('رصد GPS غير حديث');
  }

  if (opts.speedTier === 'current') {
    score += 2;
    reasonParts.push('سرعة لحظية صالحة');
  } else if (opts.speedTier === 'recent') {
    score += 1;
    reasonParts.push('سرعة مبنية على رصدات سابقة قريبة');
  } else {
    reasonParts.push('سرعة افتراضية (لا تتوفر سرعة موثوقة)');
  }

  if (opts.routeMatchDistanceMeters <= 300) {
    score += 2;
    reasonParts.push('مطابقة دقيقة لمسار الحافلة');
  } else if (opts.routeMatchDistanceMeters <= 1500) {
    score += 1;
    reasonParts.push('مطابقة مقبولة لمسار الحافلة');
  } else {
    reasonParts.push('الحافلة بعيدة عن مسارها المتوقع');
  }

  const confidence: EtaConfidence = score >= 5 ? 'HIGH' : score >= 3 ? 'MEDIUM' : 'LOW';
  return { confidence, reasonParts };
}

function unknownEstimate(busId: string, tripId: string | null, routeId: string | null, reason: string, now: Date): EtaEstimate {
  return {
    busId,
    tripId,
    routeId,
    nextStopId: null,
    nextStopName: null,
    estimatedArrivalAt: null,
    finalDestinationEtaAt: null,
    remainingDistanceMeters: null,
    remainingToDestinationMeters: null,
    estimatedTravelSeconds: null,
    currentSpeedKmh: null,
    effectiveSpeedKmh: null,
    confidence: 'LOW',
    status: 'UNKNOWN',
    source: null,
    calculatedAt: now,
    explanation: { reason, freshLocation: false, validSpeed: false, routeGeometryAvailable: false },
    delay: null,
  };
}

/** DeterministicEtaEstimator — the Phase 4D EtaEstimator implementation (spec §52). A future MLBasedEtaEstimator could implement the same interface. */
export const DeterministicEtaEstimator: EtaEstimator = {
  estimate(context: EtaEstimationContext): EtaEstimate {
    const { busId, tripId, routeId, now } = context;

    if (!context.currentLocation) {
      return unknownEstimate(busId, tripId, routeId, 'لا يوجد موقع حالي معروف لهذه الحافلة بعد.', now);
    }
    const loc = context.currentLocation;

    if (!loc.isFresh) {
      return {
        ...unknownEstimate(busId, tripId, routeId, 'آخر تحديث لموقع الحافلة قديم — لا يمكن الوثوق بتقدير وصول حي.', now),
        status: 'STALE',
        currentSpeedKmh: loc.speedKmh,
        source: loc.source,
        explanation: { reason: 'آخر تحديث لموقع الحافلة قديم — لا يمكن الوثوق بتقدير وصول حي.', freshLocation: false, validSpeed: isValidSpeedKmh(loc.speedKmh), routeGeometryAvailable: false },
      };
    }

    if (context.waypoints.length < 2) {
      return {
        ...unknownEstimate(busId, tripId, routeId, 'لا تتوفر بيانات مسار كافية (نقاط توقف/مدرسة) لحساب وقت الوصول.', now),
        currentSpeedKmh: loc.speedKmh,
        source: loc.source,
      };
    }

    const progress = computeRouteProgress({ lat: loc.lat, lng: loc.lng }, context.waypoints);
    if (!progress) {
      return {
        ...unknownEstimate(busId, tripId, routeId, 'تعذّر تحديد موقع الحافلة ضمن هندسة المسار.', now),
        currentSpeedKmh: loc.speedKmh,
        source: loc.source,
      };
    }

    const effective = resolveEffectiveSpeed(loc.speedKmh, context.recentSpeedSamplesKmh);
    const travelHours = progress.remainingToNextStopMeters / 1000 / effective.speedKmh;
    const estimatedTravelSeconds = Math.round(travelHours * 3600);
    const estimatedArrivalAt = new Date(now.getTime() + estimatedTravelSeconds * 1000);

    const destinationTravelHours = progress.remainingToDestinationMeters / 1000 / effective.speedKmh;
    const finalDestinationEtaAt = new Date(now.getTime() + Math.round(destinationTravelHours * 3600) * 1000);

    const { confidence, reasonParts } = calculateConfidence({
      isFresh: loc.isFresh,
      speedTier: effective.tier,
      routeMatchDistanceMeters: progress.routeMatchDistanceMeters,
    });

    let delay: EtaEstimate['delay'] = null;
    let status: EtaStatus = 'ON_TIME';
    if (context.scheduledArrivalAt) {
      const delaySeconds = Math.round((finalDestinationEtaAt.getTime() - context.scheduledArrivalAt.getTime()) / 1000);
      const classification = classifyDelay(delaySeconds);
      delay = { scheduledArrivalAt: context.scheduledArrivalAt, delaySeconds, classification };
      status = classification === 'ON_TIME' ? 'ON_TIME' : 'DELAYED';
    }

    return {
      busId,
      tripId,
      routeId,
      nextStopId: progress.nextWaypoint.stopId,
      nextStopName: progress.nextWaypoint.name,
      estimatedArrivalAt,
      finalDestinationEtaAt,
      remainingDistanceMeters: Math.round(progress.remainingToNextStopMeters),
      remainingToDestinationMeters: Math.round(progress.remainingToDestinationMeters),
      estimatedTravelSeconds,
      currentSpeedKmh: loc.speedKmh,
      effectiveSpeedKmh: Math.round(effective.speedKmh * 10) / 10,
      confidence,
      status,
      source: loc.source,
      calculatedAt: now,
      explanation: {
        reason: reasonParts.join(' — '),
        freshLocation: loc.isFresh,
        validSpeed: effective.tier !== 'default',
        routeGeometryAvailable: true,
      },
      delay,
    };
  },
};

// ---------------------------------------------------------------------------
// Read service — resolves real repository data into an EtaEstimationContext,
// then delegates to the estimator. No mutation anywhere below this line.
// ---------------------------------------------------------------------------

function buildContext(busId: string): EtaEstimationContext {
  const now = new Date();
  const location = getCurrentLocation(busId);

  if (!location) {
    return { busId, tripId: null, routeId: null, scheduledArrivalAt: null, currentLocation: null, waypoints: [], recentSpeedSamplesKmh: [], now };
  }

  const trip = location.tripId ? tripRepository.findById(location.tripId) : null;
  const routeId = trip?.routeId ?? null;
  const bus = busRepository.findById(busId);

  let waypoints: EtaWaypoint[] = [];
  if (routeId && bus) {
    waypoints = resolveWaypoints(routeId, bus.schoolId) ?? [];
  }

  const recentSpeedSamplesKmh = telemetryObservationRepository
    .findFiltered({ busId, limit: ETA_RECENT_SPEED_SAMPLE_SIZE })
    .map((o) => o.speedKmh)
    .filter((s): s is number => s != null);

  return {
    busId,
    tripId: location.tripId,
    routeId,
    scheduledArrivalAt: trip?.targetArrivalAt ?? null,
    currentLocation: {
      lat: location.latitude,
      lng: location.longitude,
      speedKmh: location.speedKmh,
      occurredAt: location.occurredAt,
      receivedAt: location.receivedAt,
      // Phase 4D's EtaSource vocabulary is intentionally coarser than the
      // projection's own LocationSource (spec §3 — TELEMETRY | SIMULATION
      // only): ETA doesn't need to distinguish DEVICE from GPS_PROVIDER,
      // only "a real observation" from "a simulated one".
      source: location.source === 'SIMULATION' ? 'SIMULATION' : 'TELEMETRY',
      isFresh: deriveFreshness(location.receivedAt, now) === 'FRESH',
    },
    waypoints,
    recentSpeedSamplesKmh,
    now,
  };
}

export function getBusEta(busId: string): EtaEstimate {
  return DeterministicEtaEstimator.estimate(buildContext(busId));
}

/** Scoped to a specific trip — if the bus's current telemetry has since moved to a different trip, this honestly reports UNKNOWN rather than showing a wrong-trip estimate. */
export function getTripEta(tripId: string): EtaEstimate {
  const trip = tripRepository.findById(tripId);
  if (!trip) return unknownEstimate('', tripId, null, 'الرحلة غير موجودة.', new Date());

  const context = buildContext(trip.busId);
  if (context.tripId !== tripId) {
    return unknownEstimate(trip.busId, tripId, trip.routeId, 'لا توجد بيانات موقع حالية مرتبطة بهذه الرحلة تحديداً.', context.now);
  }
  return DeterministicEtaEstimator.estimate(context);
}

/** Bounded — one call to the projection's own bounded fleet query, then a small per-bus repository lookup for trip/route context (spec §18/§46, the pilot fleet is tiny; never scans telemetry history per bus beyond the small recent-speed window). */
export function getFleetEta(): EtaEstimate[] {
  return listFleetCurrentLocations().map((loc) => DeterministicEtaEstimator.estimate(buildContext(loc.busId)));
}
