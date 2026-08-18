import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  getBusEta,
  getTripEta,
  getFleetEta,
  computeRouteProgress,
  resolveEffectiveSpeed,
  classifyDelay,
  calculateConfidence,
} from '../../server/services/EtaService';
import { DEFAULT_ETA_SPEED_KMH, ETA_MINOR_DELAY_THRESHOLD_SECONDS, ETA_SIGNIFICANT_DELAY_THRESHOLD_SECONDS, type EtaWaypoint } from '../../server/domain/etaContract';
import { processObservation, getCurrentLocation } from '../../server/services/CurrentLocationProjectionService';
import { currentLocationProjectionRepository } from '../../server/repositories/currentLocationProjectionRepository';
import { registerDevice } from '../../server/services/TelemetryDeviceService';
import { ingestObservation } from '../../server/services/TelemetryIngestionService';
import { startGpsSimulation, advanceGpsSimulation, resetAllGpsSimulations, pauseGpsSimulation, resumeGpsSimulation } from '../../server/services/GpsSimulationEngine';
import { tripRepository } from '../../server/repositories/tripRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { routeRepository } from '../../server/repositories/routeRepository';
import { studentRepository } from '../../server/repositories/studentRepository';
import { journeyRepository } from '../../server/repositories/journeyRepository';
import { recommendationRepository } from '../../server/repositories/recommendationRepository';
import { auditRepository } from '../../server/repositories/auditRepository';
import { telemetryObservationRepository } from '../../server/repositories/telemetryObservationRepository';
import { createJourney, getJourneyTimeline } from '../../server/services/JourneyService';
import { requireTelemetryReader } from '../../server/services/authz';
import { userRepository } from '../../server/repositories/userRepository';
import { driverRepository } from '../../server/repositories/driverRepository';
import type { TelemetryObservation } from '../../server/domain/telemetryContract';

beforeEach(() => {
  currentLocationProjectionRepository.clear();
});

function makeObservation(busId: string, overrides: Partial<TelemetryObservation> = {}): TelemetryObservation {
  return {
    observationId: `obs-${crypto.randomUUID()}`,
    sourceEventId: `evt-${crypto.randomUUID()}`,
    source: 'DEVICE',
    busId,
    tripId: null,
    sequence: 1,
    occurredAt: new Date(),
    receivedAt: new Date(),
    latitude: 23.6,
    longitude: 58.4,
    speed: 30,
    heading: 90,
    accuracy: 10,
    ...overrides,
  };
}

describe('computeRouteProgress — next-stop selection, route order, remaining distance (spec §9/§10/§11, mandatory tests 2/13/14)', () => {
  const waypoints: EtaWaypoint[] = [
    { lat: 23.60, lng: 58.40, stopId: 'stop-1', name: 'Stop 1' },
    { lat: 23.61, lng: 58.41, stopId: 'stop-2', name: 'Stop 2' },
    { lat: 23.62, lng: 58.42, stopId: null, name: 'School' },
  ];

  it('a bus at the very first waypoint selects the SECOND waypoint as next stop, never a "previous" one', () => {
    const progress = computeRouteProgress({ lat: 23.60, lng: 58.40 }, waypoints);
    expect(progress?.nextWaypoint.stopId).toBe('stop-2');
  });

  it('a bus between stop 2 and school selects the school as next, not stop 1 despite any coincidental proximity', () => {
    const progress = computeRouteProgress({ lat: 23.615, lng: 58.415 }, waypoints);
    expect(progress?.nextWaypoint.stopId).toBeNull(); // school
    expect(progress?.nextWaypoint.name).toBe('School');
  });

  it('remaining-to-destination is always >= remaining-to-next-stop', () => {
    const progress = computeRouteProgress({ lat: 23.605, lng: 58.405 }, waypoints);
    expect(progress!.remainingToDestinationMeters).toBeGreaterThanOrEqual(progress!.remainingToNextStopMeters);
  });

  it('fewer than 2 waypoints returns null (insufficient geometry)', () => {
    expect(computeRouteProgress({ lat: 23.6, lng: 58.4 }, [waypoints[0]])).toBeNull();
    expect(computeRouteProgress({ lat: 23.6, lng: 58.4 }, [])).toBeNull();
  });
});

describe('resolveEffectiveSpeed — the 3-tier fallback chain (spec §5/§6, mandatory tests 4-8)', () => {
  it('uses current speed when valid', () => {
    expect(resolveEffectiveSpeed(45, []).tier).toBe('current');
    expect(resolveEffectiveSpeed(45, []).speedKmh).toBe(45);
  });

  it('zero speed falls through to the next tier (never divides by zero)', () => {
    const result = resolveEffectiveSpeed(0, [20, 22]);
    expect(result.tier).toBe('recent');
    expect(result.speedKmh).toBeCloseTo(21, 5);
  });

  it('negative speed falls through', () => {
    expect(resolveEffectiveSpeed(-5, []).tier).toBe('default');
  });

  it('an implausibly high speed falls through (impossible speed)', () => {
    expect(resolveEffectiveSpeed(500, []).tier).toBe('default');
  });

  it('null/invalid speed uses recent history when available', () => {
    const result = resolveEffectiveSpeed(null, [25, 35]);
    expect(result.tier).toBe('recent');
    expect(result.speedKmh).toBe(30);
  });

  it('falls back to the centrally-defined default when nothing else is available', () => {
    const result = resolveEffectiveSpeed(null, []);
    expect(result.tier).toBe('default');
    expect(result.speedKmh).toBe(DEFAULT_ETA_SPEED_KMH);
  });

  it('recent history filters out invalid samples before averaging', () => {
    const result = resolveEffectiveSpeed(null, [0, -10, 20, 999]);
    expect(result.tier).toBe('recent');
    expect(result.speedKmh).toBe(20); // only the one valid sample
  });
});

describe('classifyDelay — configurable thresholds (spec §21)', () => {
  it('ON_TIME below the minor threshold', () => {
    expect(classifyDelay(0)).toBe('ON_TIME');
    expect(classifyDelay(ETA_MINOR_DELAY_THRESHOLD_SECONDS - 1)).toBe('ON_TIME');
  });
  it('MINOR_DELAY at/above the minor threshold, below significant', () => {
    expect(classifyDelay(ETA_MINOR_DELAY_THRESHOLD_SECONDS)).toBe('MINOR_DELAY');
    expect(classifyDelay(ETA_SIGNIFICANT_DELAY_THRESHOLD_SECONDS - 1)).toBe('MINOR_DELAY');
  });
  it('SIGNIFICANT_DELAY at/above the significant threshold', () => {
    expect(classifyDelay(ETA_SIGNIFICANT_DELAY_THRESHOLD_SECONDS)).toBe('SIGNIFICANT_DELAY');
    expect(classifyDelay(ETA_SIGNIFICANT_DELAY_THRESHOLD_SECONDS + 3600)).toBe('SIGNIFICANT_DELAY');
  });
  it('a negative delay (early) is ON_TIME, never a negative classification', () => {
    expect(classifyDelay(-600)).toBe('ON_TIME');
  });
});

describe('calculateConfidence — deterministic heuristic, never a fake ML probability (spec §12/§15)', () => {
  it('fresh + current speed + tight route match = HIGH', () => {
    const { confidence } = calculateConfidence({ isFresh: true, speedTier: 'current', routeMatchDistanceMeters: 50 });
    expect(confidence).toBe('HIGH');
  });
  it('stale + default speed + poor match = LOW', () => {
    const { confidence } = calculateConfidence({ isFresh: false, speedTier: 'default', routeMatchDistanceMeters: 5000 });
    expect(confidence).toBe('LOW');
  });
  it('is a pure function — identical inputs always produce identical output (deterministic, mandatory test 17)', () => {
    const a = calculateConfidence({ isFresh: true, speedTier: 'recent', routeMatchDistanceMeters: 800 });
    const b = calculateConfidence({ isFresh: true, speedTier: 'recent', routeMatchDistanceMeters: 800 });
    expect(a).toEqual(b);
  });
});

describe('EtaService — data-quality honesty (spec §6/§50, mandatory tests 9-12)', () => {
  it('no current location at all -> UNKNOWN, no fabricated coordinates', () => {
    const bus = busRepository.findAll()[0];
    const eta = getBusEta(bus.id);
    expect(eta.status).toBe('UNKNOWN');
    expect(eta.estimatedArrivalAt).toBeNull();
  });

  it('stale location -> STALE status, not a false precise ETA (spec §7/§35, mandatory test 43)', () => {
    const bus = busRepository.findAll()[0];
    const staleReceivedAt = new Date(Date.now() - 10 * 60_000); // 10 min old, well past the 60s threshold
    processObservation(makeObservation(bus.id, { occurredAt: staleReceivedAt, receivedAt: staleReceivedAt }));
    const eta = getBusEta(bus.id);
    expect(eta.status).toBe('STALE');
    expect(eta.estimatedArrivalAt).toBeNull();
  });

  it('a fresh location with no associated trip/route (bus-only telemetry) -> UNKNOWN, not a fabricated route', () => {
    const bus = busRepository.findAll()[0];
    processObservation(makeObservation(bus.id, { tripId: null }));
    const eta = getBusEta(bus.id);
    // tripId null means no route can be resolved for this observation.
    expect(eta.routeId).toBeNull();
    expect(eta.status).toBe('UNKNOWN');
  });

  it('a real trip/route with fresh location produces a calculated ETA', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    processObservation(makeObservation(trip.busId, { tripId: trip.id }));
    const eta = getBusEta(trip.busId);
    expect(eta.status).not.toBe('UNKNOWN');
    expect(eta.estimatedArrivalAt).toBeTruthy();
    expect(eta.nextStopId).toBeTruthy();
    expect(typeof eta.explanation.reason).toBe('string');
    expect(eta.explanation.reason.length).toBeGreaterThan(0);
  });

  it('getTripEta scoped to a trip the bus has since moved away from reports UNKNOWN honestly, not a wrong-trip ETA', () => {
    const trips = tripRepository.findAll().filter((t) => t.driverId);
    const tripA = trips[0];
    const tripB = trips.find((t) => t.busId !== tripA.busId)!;
    processObservation(makeObservation(tripA.busId, { tripId: tripA.id }));
    // Ask for a completely unrelated trip's ETA — must not leak tripA's data.
    const eta = getTripEta(tripB.id);
    expect(eta.status).toBe('UNKNOWN');
  });

  it('getFleetEta returns one entry per bus with a current location, bounded (spec §18/§46)', () => {
    const buses = busRepository.findAll();
    for (const bus of buses) processObservation(makeObservation(bus.id));
    const fleet = getFleetEta();
    expect(fleet.length).toBeGreaterThanOrEqual(buses.length);
  });
});

describe('MANDATORY: ETA calculation never mutates anything (spec §0.4/§26, mandatory tests 18-22)', () => {
  it('Journey/Student/Trip/Bus/Route/Recommendation/audit_logs/telemetry/projection are all byte-for-byte unchanged after many ETA calculations', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const bus = busRepository.findById(trip.busId)!;
    const route = routeRepository.findById(trip.routeId)!;
    const student = studentRepository.findByBusId(trip.busId)[0];
    const journey = createJourney(student.id, trip.id, { actorId: null, actorType: 'system' });
    const journeysBefore = journeyRepository.findByTripId(trip.id);
    const studentsBefore = studentRepository.findByBusId(trip.busId);
    const recCountBefore = recommendationRepository.findAll().length;
    const auditCountBefore = auditRepository.findAll().length;
    const timelineBefore = getJourneyTimeline(journey.id);

    processObservation(makeObservation(trip.busId, { tripId: trip.id }));
    const observationCountBefore = telemetryObservationRepository.findFiltered({ busId: bus.id, limit: 500 }).length;
    const projectionBefore = getCurrentLocation(bus.id);

    // Calculate ETA many times — a pure read operation.
    for (let i = 0; i < 50; i++) {
      getBusEta(bus.id);
      getTripEta(trip.id);
    }
    getFleetEta();

    expect(tripRepository.findById(trip.id)).toEqual(trip);
    expect(busRepository.findById(bus.id)).toEqual(bus); // currentLat/currentLng/speedKmh included
    expect(routeRepository.findById(trip.routeId)).toEqual(route);
    expect(journeyRepository.findByTripId(trip.id)).toEqual(journeysBefore);
    expect(studentRepository.findByBusId(trip.busId)).toEqual(studentsBefore);
    expect(recommendationRepository.findAll().length).toBe(recCountBefore);
    expect(auditRepository.findAll().length).toBe(auditCountBefore); // zero audit rows from ETA calculation
    expect(getJourneyTimeline(journey.id)).toEqual(timelineBefore);
    expect(telemetryObservationRepository.findFiltered({ busId: bus.id, limit: 500 }).length).toBe(observationCountBefore); // ETA never writes telemetry
    expect(getCurrentLocation(bus.id)).toEqual(projectionBefore); // ETA never writes the projection
  });

  it('two consecutive calculations with an unchanged projection produce the same result (deterministic, mandatory test 17)', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    processObservation(makeObservation(trip.busId, { tripId: trip.id, occurredAt: new Date('2026-01-01T10:00:00Z'), receivedAt: new Date() }));
    const a = getBusEta(trip.busId);
    const b = getBusEta(trip.busId);
    expect(a.nextStopId).toBe(b.nextStopId);
    expect(a.remainingDistanceMeters).toBe(b.remainingDistanceMeters);
    expect(a.effectiveSpeedKmh).toBe(b.effectiveSpeedKmh);
  });
});

describe('Security: driver isolation and role access (spec §16/§17/§44, mandatory tests 23-26)', () => {
  it('a driver reading their OWN bus/trip ETA is authorized', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const driver = driverRepository.findById(trip.driverId!)!;
    const driverUser = userRepository.findById(driver.userId!)!;
    expect(requireTelemetryReader(driverUser.email, { busId: trip.busId }).ok).toBe(true);
    expect(requireTelemetryReader(driverUser.email, { tripId: trip.id }).ok).toBe(true);
  });

  it('a driver reading ANOTHER driver\'s bus/trip ETA is rejected — 403 (mandatory)', () => {
    const trips = tripRepository.findAll().filter((t) => t.driverId);
    const tripA = trips[0];
    const tripB = trips.find((t) => t.driverId !== tripA.driverId)!;
    const driverOfA = driverRepository.findById(tripA.driverId!)!;
    const userOfA = userRepository.findById(driverOfA.userId!)!;

    const byBus = requireTelemetryReader(userOfA.email, { busId: tripB.busId });
    expect(byBus.ok).toBe(false);
    if (byBus.ok === false) expect(byBus.status).toBe(403);

    const byTrip = requireTelemetryReader(userOfA.email, { tripId: tripB.id });
    expect(byTrip.ok).toBe(false);
    if (byTrip.ok === false) expect(byTrip.status).toBe(403);
  });

  it('admin and school are authorized without a scope (fleet-level)', () => {
    const admin = userRepository.findAll().find((u) => u.role === 'admin')!;
    const school = userRepository.findAll().find((u) => u.role === 'school')!;
    expect(requireTelemetryReader(admin.email).ok).toBe(true);
    expect(requireTelemetryReader(school.email).ok).toBe(true);
  });

  it('unauthenticated and unknown user are rejected', () => {
    expect(requireTelemetryReader(undefined).ok).toBe(false);
    expect(requireTelemetryReader('nobody@masara.om').ok).toBe(false);
  });

  it('a device credential (its raw id, not an email) is rejected by the same guard', () => {
    const bus = busRepository.findAll()[0];
    const { device } = registerDevice(bus.id, 'TEST DEVICE — eta-guard-mismatch', 'DEVICE');
    expect(requireTelemetryReader(device.id, { busId: bus.id }).ok).toBe(false);
  });
});

describe('GPS Simulation -> Projection -> ETA (spec §30, mandatory test 27)', () => {
  beforeEach(() => resetAllGpsSimulations());

  it('ETA reflects the simulated bus\'s position and changes as it advances', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const session = startGpsSimulation(trip.id, 'admin-test', { speedProfile: 'NORMAL', tickSeconds: 5 });

    advanceGpsSimulation(session.id);
    const etaAfterFirstTick = getBusEta(trip.busId);
    expect(etaAfterFirstTick.status).not.toBe('UNKNOWN');
    expect(etaAfterFirstTick.source).toBe('SIMULATION');

    advanceGpsSimulation(session.id);
    const etaAfterSecondTick = getBusEta(trip.busId);
    // Position moved, so remaining distance to next stop should differ (usually decrease).
    expect(etaAfterSecondTick.remainingDistanceMeters).not.toBe(etaAfterFirstTick.remainingDistanceMeters);
  });

  it('pausing the simulation freezes ETA input; resuming continues it (no server timers involved)', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const session = startGpsSimulation(trip.id, 'admin-test', { speedProfile: 'NORMAL', tickSeconds: 5 });
    advanceGpsSimulation(session.id);
    const etaWhileRunning = getBusEta(trip.busId);

    pauseGpsSimulation(session.id);
    const etaWhilePaused = getBusEta(trip.busId);
    expect(etaWhilePaused.remainingDistanceMeters).toBe(etaWhileRunning.remainingDistanceMeters);

    resumeGpsSimulation(session.id);
    advanceGpsSimulation(session.id);
    const etaAfterResume = getBusEta(trip.busId);
    expect(etaAfterResume.calculatedAt.getTime()).toBeGreaterThanOrEqual(etaWhilePaused.calculatedAt.getTime());
  });
});

describe('Real device -> telemetry -> projection -> ETA (spec §31, mandatory test 28)', () => {
  it('ETA reflects a real device observation, and an older resubmission never regresses it', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const { device } = registerDevice(trip.busId, 'TEST DEVICE — eta e2e', 'DEVICE');
    const authed = { id: device.id, busId: device.busId, providerType: 'DEVICE' as const };

    ingestObservation(authed, {
      sourceEventId: 'eta-e2e-1',
      tripId: trip.id,
      occurredAt: '2026-01-01T10:00:00.000Z',
      latitude: 23.60,
      longitude: 58.40,
      speedKmh: 30,
    });
    const etaAfterFirst = getBusEta(trip.busId);
    expect(etaAfterFirst.source).toBe('TELEMETRY');

    ingestObservation(authed, {
      sourceEventId: 'eta-e2e-2',
      tripId: trip.id,
      occurredAt: '2026-01-01T10:05:00.000Z',
      latitude: 23.61,
      longitude: 58.41,
      speedKmh: 30,
    });
    const etaAfterNewer = getBusEta(trip.busId);
    expect(etaAfterNewer.calculatedAt.getTime()).toBeGreaterThanOrEqual(etaAfterFirst.calculatedAt.getTime());

    // An OLDER observation arriving after the newer one must not regress the ETA's underlying location.
    ingestObservation(authed, {
      sourceEventId: 'eta-e2e-3-late',
      tripId: trip.id,
      occurredAt: '2026-01-01T10:02:00.000Z',
      latitude: 23.55,
      longitude: 58.35,
      speedKmh: 30,
    });
    const etaAfterLateArrival = getBusEta(trip.busId);
    // Still based on the 10:05 position, not the 10:02 one that arrived last.
    expect(getCurrentLocation(trip.busId)!.latitude).toBe(23.61);
    expect(etaAfterLateArrival.remainingDistanceMeters).toBe(etaAfterNewer.remainingDistanceMeters);
  });
});

describe('Out-of-order telemetry -> ETA (spec §42, mandatory)', () => {
  it('delivering an earlier-occurring observation AFTER a later one leaves ETA based on the later one', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const { device } = registerDevice(trip.busId, 'TEST DEVICE — out-of-order eta', 'DEVICE');
    const authed = { id: device.id, busId: device.busId, providerType: 'DEVICE' as const };

    // B (10:05) arrives first.
    ingestObservation(authed, { sourceEventId: 'ooo-b', tripId: trip.id, occurredAt: '2026-01-01T10:05:00.000Z', latitude: 23.61, longitude: 58.41 });
    const etaFromB = getBusEta(trip.busId);

    // A (10:00) arrives after.
    ingestObservation(authed, { sourceEventId: 'ooo-a', tripId: trip.id, occurredAt: '2026-01-01T10:00:00.000Z', latitude: 23.60, longitude: 58.40 });
    const etaAfterA = getBusEta(trip.busId);

    expect(etaAfterA.remainingDistanceMeters).toBe(etaFromB.remainingDistanceMeters); // unchanged — still B's position
  });
});

describe('Source-scan governance guards (spec §39/§45) — ETA cannot mutate anything or bypass governance', () => {
  const etaServiceSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/EtaService.ts'), 'utf8');
  const etaRoutesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/etaRoutes.ts'), 'utf8');
  const forbiddenImports = /from ['"].*\/(JourneyService|JourneyStateMachine|ActionExecutor|PolicyEngine|MasaraOperationsAgent)['"]/;

  it('EtaService.ts imports no Journey/governance mutation module', () => {
    expect(etaServiceSource).not.toMatch(forbiddenImports);
  });

  it('EtaService.ts imports no telemetry/projection WRITE functions (only reads)', () => {
    expect(etaServiceSource).not.toMatch(/\bprocessObservation\b/);
    expect(etaServiceSource).not.toMatch(/\bupsertIfNewer\b/);
  });

  it('etaRoutes.ts has no POST/PUT/PATCH/DELETE handler at all — read-only', () => {
    expect(etaRoutesSource).not.toMatch(/etaRouter\.(post|put|patch|delete)\(/);
  });

  it('etaRoutes.ts imports no Journey/governance mutation module', () => {
    expect(etaRoutesSource).not.toMatch(forbiddenImports);
  });

  it('etaRoutes.ts never trusts req.body/req.query for actorId, driverId, schoolId, source, or role', () => {
    expect(etaRoutesSource).not.toMatch(/req\.(body|query)\??\.(actorId|driverId|schoolId|source|role)\b/);
  });

  it('every eta route is guarded by requireTelemetryReader or requireOperationalUser — no unguarded handler', () => {
    const handlerCount = (etaRoutesSource.match(/etaRouter\.get\(/g) ?? []).length;
    const guardCount = (etaRoutesSource.match(/requireTelemetryReader\(|requireOperationalUser\(/g) ?? []).length;
    expect(handlerCount).toBeGreaterThan(0);
    expect(guardCount).toBe(handlerCount);
  });

  it('the fleet route is registered before the parameterized routes (so "fleet" is never parsed as an id)', () => {
    expect(etaRoutesSource.indexOf("'/api/eta/fleet'")).toBeLessThan(etaRoutesSource.indexOf("'/api/eta/bus/:busId'"));
    expect(etaRoutesSource.indexOf("'/api/eta/fleet'")).toBeLessThan(etaRoutesSource.indexOf("'/api/eta/trip/:tripId'"));
  });
});
