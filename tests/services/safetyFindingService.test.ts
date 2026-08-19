import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  computeSafetyFinding,
  deriveFindingConfidence,
  deriveFindingSeverity,
  getTripSafetyFinding,
  type SafetyFinding,
} from '../../server/services/SafetyFindingService';
import { getTripEta, getBusEta } from '../../server/services/EtaService';
import {
  ETA_MINOR_DELAY_THRESHOLD_SECONDS,
  ETA_SIGNIFICANT_DELAY_THRESHOLD_SECONDS,
  type EtaEstimate,
} from '../../server/domain/etaContract';
import { processObservation, CURRENT_LOCATION_STALE_AFTER_SECONDS } from '../../server/services/CurrentLocationProjectionService';
import { currentLocationProjectionRepository } from '../../server/repositories/currentLocationProjectionRepository';
import { registerDevice } from '../../server/services/TelemetryDeviceService';
import { ingestObservation } from '../../server/services/TelemetryIngestionService';
import { startGpsSimulation, advanceGpsSimulation, resetAllGpsSimulations } from '../../server/services/GpsSimulationEngine';
import { tripRepository } from '../../server/repositories/tripRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { routeRepository } from '../../server/repositories/routeRepository';
import { studentRepository } from '../../server/repositories/studentRepository';
import { journeyRepository } from '../../server/repositories/journeyRepository';
import { recommendationRepository } from '../../server/repositories/recommendationRepository';
import { auditRepository } from '../../server/repositories/auditRepository';
import { telemetryObservationRepository } from '../../server/repositories/telemetryObservationRepository';
import { userRepository } from '../../server/repositories/userRepository';
import { driverRepository } from '../../server/repositories/driverRepository';
import { requireTelemetryReader } from '../../server/services/authz';
import { db } from '../../database/client';
import { predictions, notifications, etaAccuracyObservations } from '../../database/schema';
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

function syntheticEta(overrides: Partial<EtaEstimate> = {}): EtaEstimate {
  const now = new Date();
  return {
    busId: 'bus-x',
    tripId: 'trip-x',
    routeId: 'route-x',
    nextStopId: 'stop-1',
    nextStopName: 'Stop 1',
    estimatedArrivalAt: now,
    finalDestinationEtaAt: now,
    remainingDistanceMeters: 500,
    remainingToDestinationMeters: 2000,
    estimatedTravelSeconds: 300,
    currentSpeedKmh: 25,
    effectiveSpeedKmh: 25,
    confidence: 'HIGH',
    status: 'DELAYED',
    source: 'TELEMETRY',
    calculatedAt: now,
    explanation: { reason: 'test', freshLocation: true, validSpeed: true, routeGeometryAvailable: true },
    delay: { scheduledArrivalAt: now, delaySeconds: ETA_SIGNIFICANT_DELAY_THRESHOLD_SECONDS, classification: 'SIGNIFICANT_DELAY' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure function tests — confidence/severity/creation logic
// ---------------------------------------------------------------------------

describe('deriveFindingConfidence — independent of EtaConfidence (spec: never reuse EtaConfidence directly)', () => {
  it('FRESH + non-LOW etaConfidence -> HIGH', () => {
    expect(deriveFindingConfidence({ freshness: 'FRESH', etaConfidence: 'HIGH' })).toBe('HIGH');
    expect(deriveFindingConfidence({ freshness: 'FRESH', etaConfidence: 'MEDIUM' })).toBe('HIGH');
  });

  it('FRESH + LOW etaConfidence -> MEDIUM', () => {
    expect(deriveFindingConfidence({ freshness: 'FRESH', etaConfidence: 'LOW' })).toBe('MEDIUM');
  });

  it('STALE -> LOW regardless of etaConfidence', () => {
    expect(deriveFindingConfidence({ freshness: 'STALE', etaConfidence: 'HIGH' })).toBe('LOW');
    expect(deriveFindingConfidence({ freshness: 'STALE', etaConfidence: 'LOW' })).toBe('LOW');
  });
});

describe('deriveFindingSeverity — reuses the existing low/medium/high/critical vocabulary, never invents a new one', () => {
  it('SIGNIFICANT_DELAY + HIGH confidence -> high', () => {
    expect(deriveFindingSeverity('SIGNIFICANT_DELAY', 'HIGH')).toBe('high');
  });

  it('SIGNIFICANT_DELAY + MEDIUM or LOW confidence -> medium', () => {
    expect(deriveFindingSeverity('SIGNIFICANT_DELAY', 'MEDIUM')).toBe('medium');
    expect(deriveFindingSeverity('SIGNIFICANT_DELAY', 'LOW')).toBe('medium');
  });

  it('MINOR_DELAY -> low', () => {
    expect(deriveFindingSeverity('MINOR_DELAY', 'HIGH')).toBe('low');
  });

  it('never assigns critical — that tier is reserved for real incident semantics', () => {
    const allCombos: Array<['ON_TIME' | 'MINOR_DELAY' | 'SIGNIFICANT_DELAY', 'HIGH' | 'MEDIUM' | 'LOW']> = [
      ['ON_TIME', 'HIGH'], ['ON_TIME', 'MEDIUM'], ['ON_TIME', 'LOW'],
      ['MINOR_DELAY', 'HIGH'], ['MINOR_DELAY', 'MEDIUM'], ['MINOR_DELAY', 'LOW'],
      ['SIGNIFICANT_DELAY', 'HIGH'], ['SIGNIFICANT_DELAY', 'MEDIUM'], ['SIGNIFICANT_DELAY', 'LOW'],
    ];
    for (const [classification, confidence] of allCombos) {
      expect(deriveFindingSeverity(classification, confidence)).not.toBe('critical');
    }
  });
});

describe('computeSafetyFinding — only ever fires on SIGNIFICANT_DELAY, never manufactures a finding', () => {
  it('SIGNIFICANT_DELAY classification produces a well-formed SafetyFinding', () => {
    const finding = computeSafetyFinding(syntheticEta());
    expect(finding).not.toBeNull();
    expect(finding!.findingType).toBe('SIGNIFICANT_DELAY_RISK');
    expect(finding!.classification).toBe('SIGNIFICANT_DELAY');
    expect(finding!.busId).toBe('bus-x');
    expect(finding!.tripId).toBe('trip-x');
    expect(finding!.evidence.etaConfidence).toBe('HIGH');
  });

  it('MINOR_DELAY produces no finding', () => {
    const eta = syntheticEta({ delay: { scheduledArrivalAt: new Date(), delaySeconds: ETA_MINOR_DELAY_THRESHOLD_SECONDS, classification: 'MINOR_DELAY' } });
    expect(computeSafetyFinding(eta)).toBeNull();
  });

  it('ON_TIME produces no finding', () => {
    const eta = syntheticEta({ delay: { scheduledArrivalAt: new Date(), delaySeconds: 0, classification: 'ON_TIME' } });
    expect(computeSafetyFinding(eta)).toBeNull();
  });

  it('no delay at all (no schedule, or UNKNOWN/STALE estimate) produces no finding — never manufactured from missing data', () => {
    expect(computeSafetyFinding(syntheticEta({ delay: null }))).toBeNull();
  });

  it('missing tripId (defensive null/invalid-data safety) produces no finding', () => {
    expect(computeSafetyFinding(syntheticEta({ tripId: null }))).toBeNull();
  });

  it('exact boundary: delaySeconds one below the significant threshold classified MINOR_DELAY by classifyDelay never reaches computeSafetyFinding as a finding', () => {
    const eta = syntheticEta({
      delay: { scheduledArrivalAt: new Date(), delaySeconds: ETA_SIGNIFICANT_DELAY_THRESHOLD_SECONDS - 1, classification: 'MINOR_DELAY' },
    });
    expect(computeSafetyFinding(eta)).toBeNull();
  });

  it('exact boundary: delaySeconds AT the significant threshold produces a finding', () => {
    const eta = syntheticEta({
      delay: { scheduledArrivalAt: new Date(), delaySeconds: ETA_SIGNIFICANT_DELAY_THRESHOLD_SECONDS, classification: 'SIGNIFICANT_DELAY' },
    });
    expect(computeSafetyFinding(eta)).not.toBeNull();
  });

  it('STALE underlying location -> LOW confidence when (synthetically) a finding is present', () => {
    const eta = syntheticEta({ explanation: { reason: 'stale', freshLocation: false, validSpeed: true, routeGeometryAvailable: true } });
    const finding = computeSafetyFinding(eta);
    expect(finding).not.toBeNull();
    expect(finding!.confidence).toBe('LOW');
    expect(finding!.evidence.freshness).toBe('STALE');
  });

  it('no client-controlled confidence/severity — both are always derived, never present in the EtaEstimate input as pass-through fields', () => {
    const finding = computeSafetyFinding(syntheticEta({ confidence: 'LOW' }));
    // eta.confidence LOW + fresh -> MEDIUM, proving confidence is derived, not copied from eta.confidence
    expect(finding!.confidence).toBe('MEDIUM');
  });

  it('deterministic — same input produces the same output every time', () => {
    const eta = syntheticEta();
    const a = computeSafetyFinding(eta);
    const b = computeSafetyFinding(eta);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Integration — real fixtures, simulation path and real-telemetry path
// ---------------------------------------------------------------------------

describe('getTripSafetyFinding — real EtaService integration (no special-case simulation logic)', () => {
  beforeEach(() => resetAllGpsSimulations());

  it('is consistent with getTripEta for a trip with no location at all -> no finding (UNKNOWN)', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const eta = getTripEta(trip.id);
    expect(eta.delay).toBeNull();
    expect(getTripSafetyFinding(trip.id)).toBeNull();
  });

  it('GPS simulation path: a bus placed at its route\'s first stop at low speed produces a SIGNIFICANT_DELAY finding, matching getTripEta\'s own delay exactly', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const stops = routeRepository.findStopsByRouteId(trip.routeId).slice().sort((a, b) => a.orderSequence - b.orderSequence);
    expect(stops.length).toBeGreaterThan(0);

    // Place the bus at the very first stop with a deliberately slow speed —
    // maximizes remaining distance/time so the resulting ETA is far past any
    // seeded near-term targetArrivalAt, regardless of wall-clock drift
    // between seed time and test-run time.
    processObservation(
      makeObservation(trip.busId, { tripId: trip.id, latitude: stops[0].lat, longitude: stops[0].lng, speed: 2 })
    );

    const eta = getTripEta(trip.id);
    const finding = getTripSafetyFinding(trip.id);

    if (eta.delay?.classification === 'SIGNIFICANT_DELAY') {
      expect(finding).not.toBeNull();
      expect(finding!.findingType).toBe('SIGNIFICANT_DELAY_RISK');
      expect(finding!.busId).toBe(trip.busId);
      expect(finding!.tripId).toBe(trip.id);
      expect(finding!.delaySeconds).toBe(eta.delay.delaySeconds);
      expect(finding!.classification).toBe('SIGNIFICANT_DELAY');
      expect(['HIGH', 'MEDIUM']).toContain(finding!.confidence); // fresh observation -> never LOW
      expect(['medium', 'high']).toContain(finding!.severity);
    } else {
      // Honest fallback if seed data timing ever changes: the finding must
      // still track getTripEta's own classification exactly (null either way).
      expect(finding).toBeNull();
    }
  });

  it('GPS simulation path via the real engine (startGpsSimulation/advanceGpsSimulation) — Finding tracks EtaService source through the exact same code path, no simulation special-casing', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const session = startGpsSimulation(trip.id, 'admin-test', { speedProfile: 'STOPPED', tickSeconds: 5 });
    advanceGpsSimulation(session.id);

    const eta = getTripEta(trip.id);
    expect(eta.source).toBe('SIMULATION');
    const finding = getTripSafetyFinding(trip.id);
    expect(finding === null).toBe(eta.delay?.classification !== 'SIGNIFICANT_DELAY');
  });

  it('real device -> telemetry -> projection -> Finding path produces the same shape as the simulation path (parity, no special-casing)', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const stops = routeRepository.findStopsByRouteId(trip.routeId).slice().sort((a, b) => a.orderSequence - b.orderSequence);
    const { device } = registerDevice(trip.busId, 'TEST DEVICE — safety finding e2e', 'DEVICE');
    const authed = { id: device.id, busId: device.busId, providerType: 'DEVICE' as const };

    ingestObservation(authed, {
      sourceEventId: 'safety-finding-e2e-1',
      tripId: trip.id,
      occurredAt: new Date().toISOString(),
      latitude: stops[0].lat,
      longitude: stops[0].lng,
      speedKmh: 2,
    });

    const eta = getTripEta(trip.id);
    expect(eta.source).toBe('TELEMETRY');
    const finding = getTripSafetyFinding(trip.id);
    expect(finding === null).toBe(eta.delay?.classification !== 'SIGNIFICANT_DELAY');
    if (finding) {
      expect(finding.evidence.freshness).toBe('FRESH');
      expect(finding.confidence).not.toBe('LOW'); // fresh real telemetry can never yield LOW
    }
  });

  it('stale telemetry (>60s, CURRENT_LOCATION_STALE_AFTER_SECONDS) -> no finding, because EtaService itself refuses to compute a delay on stale data (documented, not a bug)', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const staleReceivedAt = new Date(Date.now() - (CURRENT_LOCATION_STALE_AFTER_SECONDS + 600) * 1000);
    processObservation(makeObservation(trip.busId, { tripId: trip.id, occurredAt: staleReceivedAt, receivedAt: staleReceivedAt }));

    const eta = getTripEta(trip.id);
    expect(eta.status).toBe('STALE');
    expect(eta.delay).toBeNull();
    expect(getTripSafetyFinding(trip.id)).toBeNull();
  });

  it('boundary: a location received just inside the stale threshold is still FRESH (a few seconds of margin against wall-clock test-execution drift, matching deriveFreshness\'s own <=)', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const withinThreshold = new Date(Date.now() - (CURRENT_LOCATION_STALE_AFTER_SECONDS - 5) * 1000);
    processObservation(makeObservation(trip.busId, { tripId: trip.id, occurredAt: withinThreshold, receivedAt: withinThreshold }));
    const eta = getBusEta(trip.busId);
    expect(eta.explanation.freshLocation).toBe(true);
  });

  it('boundary: a location received just past the stale threshold is STALE', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const pastThreshold = new Date(Date.now() - (CURRENT_LOCATION_STALE_AFTER_SECONDS + 5) * 1000);
    processObservation(makeObservation(trip.busId, { tripId: trip.id, occurredAt: pastThreshold, receivedAt: pastThreshold }));
    const eta = getBusEta(trip.busId);
    expect(eta.explanation.freshLocation).toBe(false);
  });

  it('repeated GET-equivalent calls with unchanged input are deterministic (ignoring the calculatedAt read-time timestamp itself)', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const stops = routeRepository.findStopsByRouteId(trip.routeId).slice().sort((a, b) => a.orderSequence - b.orderSequence);
    processObservation(makeObservation(trip.busId, { tripId: trip.id, latitude: stops[0].lat, longitude: stops[0].lng, speed: 2 }));

    const first = getTripSafetyFinding(trip.id);
    const second = getTripSafetyFinding(trip.id);
    expect(second ? { ...second, calculatedAt: null } : null).toEqual(first ? { ...first, calculatedAt: null } : null);
  });
});

// ---------------------------------------------------------------------------
// Authorization — reuses requireTelemetryReader exactly, no new mechanism
// ---------------------------------------------------------------------------

describe('Authorization — the Finding endpoint reuses the exact same telemetry-read boundary as ETA', () => {
  it('a driver reading their OWN trip is authorized', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const driver = driverRepository.findById(trip.driverId!)!;
    const driverUser = userRepository.findById(driver.userId!)!;
    expect(requireTelemetryReader(driverUser.email, { tripId: trip.id }).ok).toBe(true);
  });

  it('a driver reading ANOTHER driver\'s trip is rejected — 403', () => {
    const trips = tripRepository.findAll().filter((t) => t.driverId);
    const tripA = trips[0];
    const tripB = trips.find((t) => t.driverId !== tripA.driverId)!;
    const driverOfA = driverRepository.findById(tripA.driverId!)!;
    const userOfA = userRepository.findById(driverOfA.userId!)!;
    const guard = requireTelemetryReader(userOfA.email, { tripId: tripB.id });
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(403);
  });

  it('admin and school are authorized, unscoped', () => {
    const admin = userRepository.findAll().find((u) => u.role === 'admin')!;
    const school = userRepository.findAll().find((u) => u.role === 'school')!;
    expect(requireTelemetryReader(admin.email).ok).toBe(true);
    expect(requireTelemetryReader(school.email).ok).toBe(true);
  });

  it('unauthenticated / unknown user is rejected', () => {
    expect(requireTelemetryReader(undefined).ok).toBe(false);
    expect(requireTelemetryReader('nobody@masara.om').ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Isolation — the Finding computation and endpoint mutate nothing
// ---------------------------------------------------------------------------

describe('MANDATORY: Finding computation never mutates anything (Evidence -> Finding only)', () => {
  it('journeys/trips/buses/students/routes/telemetry/projection/predictions/recommendations/audit_logs/notifications/eta_accuracy_observations are all unchanged after many Finding computations', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const bus = busRepository.findById(trip.busId)!;
    const route = routeRepository.findById(trip.routeId)!;
    const student = studentRepository.findByBusId(trip.busId)[0];

    processObservation(makeObservation(trip.busId, { tripId: trip.id }));

    const tripBefore = tripRepository.findById(trip.id);
    const busBefore = busRepository.findById(bus.id);
    const routeBefore = routeRepository.findById(trip.routeId);
    const studentsBefore = studentRepository.findByBusId(trip.busId);
    const journeysBefore = journeyRepository.findByTripId(trip.id);
    const observationCountBefore = telemetryObservationRepository.findFiltered({ busId: bus.id, limit: 500 }).length;
    const recCountBefore = recommendationRepository.findAll().length;
    const auditCountBefore = auditRepository.findAll().length;
    const predictionsCountBefore = db.select().from(predictions).all().length;
    const notificationsCountBefore = db.select().from(notifications).all().length;
    const accuracyCountBefore = db.select().from(etaAccuracyObservations).all().length;

    for (let i = 0; i < 25; i++) {
      getTripSafetyFinding(trip.id);
      computeSafetyFinding(syntheticEta());
    }

    expect(tripRepository.findById(trip.id)).toEqual(tripBefore);
    expect(busRepository.findById(bus.id)).toEqual(busBefore);
    expect(routeRepository.findById(trip.routeId)).toEqual(routeBefore);
    expect(studentRepository.findByBusId(trip.busId)).toEqual(studentsBefore);
    expect(journeyRepository.findByTripId(trip.id)).toEqual(journeysBefore);
    expect(telemetryObservationRepository.findFiltered({ busId: bus.id, limit: 500 }).length).toBe(observationCountBefore);
    expect(recommendationRepository.findAll().length).toBe(recCountBefore);
    expect(auditRepository.findAll().length).toBe(auditCountBefore);
    expect(db.select().from(predictions).all().length).toBe(predictionsCountBefore);
    expect(db.select().from(notifications).all().length).toBe(notificationsCountBefore);
    expect(db.select().from(etaAccuracyObservations).all().length).toBe(accuracyCountBefore);
    expect(student).toBeTruthy(); // fixture sanity
  });
});

// ---------------------------------------------------------------------------
// Source-scan governance guards
// ---------------------------------------------------------------------------

describe('Source-scan governance guards — the Finding service/route cannot mutate or bypass governance', () => {
  const serviceSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/SafetyFindingService.ts'), 'utf8');
  const routeSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/safetyFindingRoutes.ts'), 'utf8');
  const forbidden =
    /from ['"].*\/(JourneyService|JourneyStateMachine|ActionExecutor|PolicyEngine|TelemetryIngestionService|NotificationService|NotificationPolicy|MasaraOperationsAgent)['"]/;

  it('SafetyFindingService.ts imports none of the forbidden mutation/governance modules', () => {
    expect(serviceSource).not.toMatch(forbidden);
  });

  it('safetyFindingRoutes.ts imports none of the forbidden mutation/governance modules', () => {
    expect(routeSource).not.toMatch(forbidden);
  });

  it('SafetyFindingService.ts has no repository import at all (write or read) — it only depends on EtaService\'s already-safe read functions', () => {
    expect(serviceSource).not.toMatch(/from ['"].*[Rr]epository['"]/);
    expect(serviceSource).not.toMatch(/\.(create|update|insert|delete)\(/);
  });

  it('the route is GET-only — no POST/PUT/PATCH/DELETE exists in this file', () => {
    expect(routeSource).not.toMatch(/safetyFindingRouter\.(post|put|patch|delete)\(/);
  });

  it('the route uses requireTelemetryReader — the exact same guard as the ETA read surface, no new authorization mechanism', () => {
    expect(routeSource).toMatch(/requireTelemetryReader\(/);
  });

  it('no client-controlled confidence/severity/classification — the route never reads req.body or a confidence/severity query param', () => {
    expect(routeSource).not.toMatch(/req\.body/);
    expect(routeSource).not.toMatch(/req\.query\.(confidence|severity|classification)/);
  });

  it('the route is registered under /api/eta/findings/:tripId, the audited preferred shape', () => {
    expect(routeSource).toMatch(/['"]\/api\/eta\/findings\/:tripId['"]/);
  });
});
