import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../../database/client';
import { users } from '../../database/schema';
import {
  computeAccuracyMetrics,
  captureEtaAccuracySnapshot,
  reconcileTripAccuracy,
  reconcileAllPendingAccuracy,
  getTripEtaAccuracy,
  getSummaryEtaAccuracy,
} from '../../server/services/EtaAccuracyService';
import { etaAccuracyRepository } from '../../server/repositories/etaAccuracyRepository';
import type { AccuracySample } from '../../server/domain/etaAccuracyContract';
import { processObservation, getCurrentLocation } from '../../server/services/CurrentLocationProjectionService';
import { currentLocationProjectionRepository } from '../../server/repositories/currentLocationProjectionRepository';
import { startGpsSimulation, advanceGpsSimulation, resetAllGpsSimulations } from '../../server/services/GpsSimulationEngine';
import { registerDevice } from '../../server/services/TelemetryDeviceService';
import { ingestObservation } from '../../server/services/TelemetryIngestionService';
import { createJourney, startJourney, startBoarding, boardStudent, startTransit, approachStop, dropOffStudent, type JourneyActor } from '../../server/services/JourneyService';
import { tripRepository } from '../../server/repositories/tripRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { routeRepository } from '../../server/repositories/routeRepository';
import { studentRepository } from '../../server/repositories/studentRepository';
import { journeyRepository } from '../../server/repositories/journeyRepository';
import { driverRepository } from '../../server/repositories/driverRepository';
import { userRepository } from '../../server/repositories/userRepository';
import { auditRepository } from '../../server/repositories/auditRepository';
import { recommendationRepository } from '../../server/repositories/recommendationRepository';
import { telemetryObservationRepository } from '../../server/repositories/telemetryObservationRepository';
import { requireOperationalUser, requireTelemetryReader } from '../../server/services/authz';
import type { TelemetryObservation } from '../../server/domain/telemetryContract';

const SYSTEM: JourneyActor = { actorId: null, actorType: 'system' };

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

beforeEach(() => {
  etaAccuracyRepository.clear();
  currentLocationProjectionRepository.clear();
  resetAllGpsSimulations();
});

// ---------------------------------------------------------------------------
// Pure metric computation — no DB, hand-computable sample sets (spec:
// "MAE/bias on a known manually-computable sample set").
// ---------------------------------------------------------------------------

describe('computeAccuracyMetrics — pure, deterministic (spec §22-§28 mandatory)', () => {
  it('empty dataset never divides by zero — every average/percentage is null, not a fabricated 0', () => {
    const metrics = computeAccuracyMetrics([]);
    expect(metrics.totalCandidates).toBe(0);
    expect(metrics.measurableSamples).toBe(0);
    expect(metrics.coverage).toBeNull();
    expect(metrics.maeSeconds).toBeNull();
    expect(metrics.biasSeconds).toBeNull();
    for (const band of metrics.bands) {
      expect(band.sampleCount).toBe(0);
      expect(band.percentage).toBeNull();
    }
    expect(metrics.byConfidence).toEqual([]);
    expect(metrics.bySource).toEqual([]);
    expect(metrics.byHorizon).toEqual([]);
  });

  it('an all-pending dataset (no reconciled samples) has coverage 0 but never a fabricated MAE', () => {
    const t0 = new Date('2026-01-01T10:00:00Z');
    const pending: AccuracySample = {
      confidence: 'HIGH',
      predictionSource: 'TELEMETRY',
      predictionTimestamp: t0,
      predictedArrivalAt: new Date(t0.getTime() + 60_000),
      actualArrivalAt: null,
      signedErrorSeconds: null,
      absoluteErrorSeconds: null,
    };
    const metrics = computeAccuracyMetrics([pending]);
    expect(metrics.totalCandidates).toBe(1);
    expect(metrics.measurableSamples).toBe(0);
    expect(metrics.coverage).toBe(0);
    expect(metrics.maeSeconds).toBeNull();
    expect(metrics.biasSeconds).toBeNull();
  });

  it('computes exact MAE, bias, coverage, and accuracy-band counts on a known hand-computed sample set', () => {
    const t0 = new Date('2026-01-01T10:00:00Z');
    // Three measurable samples: absolute errors 30s, 90s, 700s; signed +30, -90, +700.
    const measurable: AccuracySample[] = [
      {
        confidence: 'HIGH',
        predictionSource: 'TELEMETRY',
        predictionTimestamp: t0,
        predictedArrivalAt: new Date(t0.getTime() + 60_000), // 1 min horizon
        actualArrivalAt: new Date(t0.getTime() + 60_000 - 30_000),
        signedErrorSeconds: 30,
        absoluteErrorSeconds: 30,
      },
      {
        confidence: 'HIGH',
        predictionSource: 'TELEMETRY',
        predictionTimestamp: t0,
        predictedArrivalAt: new Date(t0.getTime() + 3 * 60_000), // 3 min horizon
        actualArrivalAt: new Date(t0.getTime() + 3 * 60_000 + 90_000),
        signedErrorSeconds: -90,
        absoluteErrorSeconds: 90,
      },
      {
        confidence: 'LOW',
        predictionSource: 'SIMULATION',
        predictionTimestamp: t0,
        predictedArrivalAt: new Date(t0.getTime() + 25 * 60_000), // 25 min horizon
        actualArrivalAt: new Date(t0.getTime() + 25 * 60_000 - 700_000),
        signedErrorSeconds: 700,
        absoluteErrorSeconds: 700,
      },
    ];
    // A fourth, still-pending candidate — counts toward totalCandidates/coverage only.
    const pending: AccuracySample = { ...measurable[0], actualArrivalAt: null, signedErrorSeconds: null, absoluteErrorSeconds: null };

    const metrics = computeAccuracyMetrics([...measurable, pending]);

    expect(metrics.totalCandidates).toBe(4);
    expect(metrics.measurableSamples).toBe(3);
    expect(metrics.coverage).toBeCloseTo(3 / 4, 10);
    expect(metrics.maeSeconds).toBeCloseTo((30 + 90 + 700) / 3, 10);
    expect(metrics.biasSeconds).toBeCloseTo((30 - 90 + 700) / 3, 10);

    // Bands: within60 -> [30]; within180 -> [30,90]; within300 -> [30,90]; within600 -> [30,90].
    const [w1, w3, w5, w10] = metrics.bands;
    expect(w1).toEqual({ withinSeconds: 60, sampleCount: 1, percentage: expect.closeTo(100 / 3, 5) });
    expect(w3).toEqual({ withinSeconds: 180, sampleCount: 2, percentage: expect.closeTo(200 / 3, 5) });
    expect(w5).toEqual({ withinSeconds: 300, sampleCount: 2, percentage: expect.closeTo(200 / 3, 5) });
    expect(w10).toEqual({ withinSeconds: 600, sampleCount: 2, percentage: expect.closeTo(200 / 3, 5) });

    // Confidence breakdown, fixed HIGH/MEDIUM/LOW order, groups with 0 samples omitted.
    expect(metrics.byConfidence.map((g) => g.group)).toEqual(['HIGH', 'LOW']);
    const high = metrics.byConfidence.find((g) => g.group === 'HIGH')!;
    expect(high.sampleCount).toBe(2);
    expect(high.maeSeconds).toBeCloseTo((30 + 90) / 2, 10);
    expect(high.biasSeconds).toBeCloseTo((30 - 90) / 2, 10);

    // Source breakdown, fixed TELEMETRY/SIMULATION order.
    expect(metrics.bySource.map((g) => g.group)).toEqual(['TELEMETRY', 'SIMULATION']);
    expect(metrics.bySource.find((g) => g.group === 'SIMULATION')!.sampleCount).toBe(1);

    // Horizon breakdown: 1min -> '0-2', 3min -> '2-5', 25min -> '20+'.
    expect(metrics.byHorizon.map((g) => g.group)).toEqual(['0-2', '2-5', '20+']);
  });

  it('accuracy-band boundaries are inclusive (<=), not strict (<)', () => {
    const t0 = new Date('2026-01-01T10:00:00Z');
    const exactlyOneMinute: AccuracySample = {
      confidence: 'MEDIUM',
      predictionSource: 'TELEMETRY',
      predictionTimestamp: t0,
      predictedArrivalAt: new Date(t0.getTime() + 60_000),
      actualArrivalAt: t0,
      signedErrorSeconds: 60,
      absoluteErrorSeconds: 60,
    };
    const metrics = computeAccuracyMetrics([exactlyOneMinute]);
    expect(metrics.bands[0].sampleCount).toBe(1); // withinSeconds=60, absoluteError=60 -> included
  });
});

// ---------------------------------------------------------------------------
// Snapshot capture (the write path, called from GpsSimulationEngine ticks and
// TelemetryIngestionService.ingestObservation — never from a GET handler).
// ---------------------------------------------------------------------------

describe('captureEtaAccuracySnapshot — never throws, only captures a calculable estimate (spec §7/§8)', () => {
  it('never throws for a bus with no location at all (UNKNOWN estimate — nothing to snapshot)', () => {
    const bus = busRepository.findAll()[0];
    expect(() => captureEtaAccuracySnapshot(bus.id)).not.toThrow();
    expect(etaAccuracyRepository.findForMetrics({}).length).toBe(0);
  });

  it('never captures a STALE estimate — reuses Phase 4C freshness unchanged, not a new threshold', () => {
    const bus = busRepository.findAll()[0];
    const staleReceivedAt = new Date(Date.now() - 10 * 60_000); // 10 min old, past the 60s threshold
    processObservation(makeObservation(bus.id, { occurredAt: staleReceivedAt, receivedAt: staleReceivedAt }));
    captureEtaAccuracySnapshot(bus.id);
    expect(etaAccuracyRepository.findForMetrics({}).length).toBe(0);
  });

  it('never throws for a nonexistent bus id', () => {
    expect(() => captureEtaAccuracySnapshot('does-not-exist')).not.toThrow();
  });

  it('captures a real snapshot from a live GPS simulation tick, tagged as SIMULATION', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const session = startGpsSimulation(trip.id, 'admin-test', { speedProfile: 'NORMAL', tickSeconds: 10 });
    advanceGpsSimulation(session.id);

    const rows = etaAccuracyRepository.findForMetrics({ tripId: trip.id });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].predictionSource).toBe('SIMULATION');
    expect(rows[0].stopId).toBeTruthy();
    expect(rows[0].actualArrivalAt).toBeNull(); // not reconciled yet
  });

  it('captures a real snapshot from a real device ingest, tagged as TELEMETRY', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const { device } = registerDevice(trip.busId, 'TEST DEVICE — accuracy capture', 'DEVICE');
    ingestObservation(
      { id: device.id, busId: device.busId, providerType: 'DEVICE' },
      { sourceEventId: `evt-${crypto.randomUUID()}`, tripId: trip.id, occurredAt: new Date().toISOString(), latitude: 23.599, longitude: 58.409, speedKmh: 30 }
    );
    const rows = etaAccuracyRepository.findForMetrics({ tripId: trip.id });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].predictionSource).toBe('TELEMETRY');
  });
});

// ---------------------------------------------------------------------------
// Duplicate-record rejection — a real DB-level constraint, not app dedup.
// ---------------------------------------------------------------------------

describe('Duplicate-inflated-sample prevention (DB-level unique constraint, spec mandatory)', () => {
  it('two snapshots in the same (trip, stop, 60s bucket) collapse into one row', () => {
    const trip = tripRepository.findAll()[0];
    const stop = routeRepository.findStopsByRouteId(trip.routeId)[0];
    const t0 = new Date('2026-01-01T10:00:10Z'); // same minute bucket as t0b below

    etaAccuracyRepository.insertSnapshotIfAbsent({
      tripId: trip.id,
      busId: trip.busId,
      stopId: stop.id,
      predictionTimestamp: t0,
      predictedArrivalAt: new Date(t0.getTime() + 120_000),
      confidence: 'HIGH',
      predictionSource: 'TELEMETRY',
    });
    const t0b = new Date('2026-01-01T10:00:45Z'); // same 60s bucket (10:00:00-10:00:59)
    etaAccuracyRepository.insertSnapshotIfAbsent({
      tripId: trip.id,
      busId: trip.busId,
      stopId: stop.id,
      predictionTimestamp: t0b,
      predictedArrivalAt: new Date(t0b.getTime() + 90_000),
      confidence: 'LOW',
      predictionSource: 'SIMULATION',
    });

    const rows = etaAccuracyRepository.findForMetrics({ tripId: trip.id });
    expect(rows.length).toBe(1);
    expect(rows[0].confidence).toBe('HIGH'); // the FIRST snapshot in the bucket wins, never overwritten
  });

  it('a snapshot in the NEXT minute bucket is a separate row', () => {
    const trip = tripRepository.findAll()[0];
    const stop = routeRepository.findStopsByRouteId(trip.routeId)[0];
    etaAccuracyRepository.insertSnapshotIfAbsent({
      tripId: trip.id,
      busId: trip.busId,
      stopId: stop.id,
      predictionTimestamp: new Date('2026-01-01T10:00:10Z'),
      predictedArrivalAt: new Date('2026-01-01T10:02:10Z'),
      confidence: 'HIGH',
      predictionSource: 'TELEMETRY',
    });
    etaAccuracyRepository.insertSnapshotIfAbsent({
      tripId: trip.id,
      busId: trip.busId,
      stopId: stop.id,
      predictionTimestamp: new Date('2026-01-01T10:01:10Z'), // next 60s bucket
      predictedArrivalAt: new Date('2026-01-01T10:03:10Z'),
      confidence: 'HIGH',
      predictionSource: 'TELEMETRY',
    });
    expect(etaAccuracyRepository.findForMetrics({ tripId: trip.id }).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Reconciliation — ground truth is journeys.droppedOffAt ONLY.
// ---------------------------------------------------------------------------

describe('reconcileTripAccuracy — ground truth from journeys.droppedOffAt only (spec mandatory)', () => {
  it('correctly computes signed/absolute error against the real Journey drop-off timestamp', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const student = studentRepository.findByBusId(trip.busId)[0];
    const stop = routeRepository.findStopsByRouteId(trip.routeId)[0];

    let journey = createJourney(student.id, trip.id, SYSTEM);
    journey = startJourney(journey.id, SYSTEM);
    startBoarding(journey.id, SYSTEM);
    boardStudent(journey.id, SYSTEM);
    startTransit(journey.id, SYSTEM);
    approachStop(journey.id, stop.id, SYSTEM);
    const dropped = dropOffStudent(journey.id, stop.id, SYSTEM);
    const actualArrivalAt = dropped.droppedOffAt!;

    // ETA had predicted arrival 4 minutes LATER than the bus actually arrived.
    const predictedArrivalAt = new Date(actualArrivalAt.getTime() + 240_000);
    etaAccuracyRepository.insertSnapshotIfAbsent({
      tripId: trip.id,
      busId: trip.busId,
      stopId: stop.id,
      predictionTimestamp: new Date(actualArrivalAt.getTime() - 300_000),
      predictedArrivalAt,
      confidence: 'HIGH',
      predictionSource: 'TELEMETRY',
    });

    const reconciledCount = reconcileTripAccuracy(trip.id);
    expect(reconciledCount).toBe(1);

    const rows = etaAccuracyRepository.findForMetrics({ tripId: trip.id });
    expect(rows).toHaveLength(1);
    expect(rows[0].actualArrivalAt!.getTime()).toBe(actualArrivalAt.getTime());
    expect(rows[0].actualSource).toBe('JOURNEY_DROPOFF');
    expect(rows[0].signedErrorSeconds).toBe(240);
    expect(rows[0].absoluteErrorSeconds).toBe(240);
  });

  it('when two students are dropped at the same stop, the EARLIEST drop-off is the ground truth', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const students = studentRepository.findByBusId(trip.busId);
    const stop = routeRepository.findStopsByRouteId(trip.routeId)[0];

    function runToDropoff(studentId: string) {
      let j = createJourney(studentId, trip.id, SYSTEM);
      j = startJourney(j.id, SYSTEM);
      startBoarding(j.id, SYSTEM);
      boardStudent(j.id, SYSTEM);
      startTransit(j.id, SYSTEM);
      approachStop(j.id, stop.id, SYSTEM);
      return dropOffStudent(j.id, stop.id, SYSTEM);
    }

    const droppedA = runToDropoff(students[1].id);
    const droppedB = runToDropoff(students[2].id);
    // Force B to have recorded EARLIER than A (real-world: whichever student's dropoff was logged first).
    const earlier = new Date(droppedA.droppedOffAt!.getTime() - 60_000);
    journeyRepository.update(droppedB.id, { droppedOffAt: earlier });

    etaAccuracyRepository.insertSnapshotIfAbsent({
      tripId: trip.id,
      busId: trip.busId,
      stopId: stop.id,
      predictionTimestamp: new Date(earlier.getTime() - 60_000),
      predictedArrivalAt: earlier, // predicts exactly the earlier (correct ground truth) time
      confidence: 'HIGH',
      predictionSource: 'TELEMETRY',
    });

    reconcileTripAccuracy(trip.id);
    const row = etaAccuracyRepository.findForMetrics({ tripId: trip.id })[0];
    expect(row.actualArrivalAt!.getTime()).toBe(earlier.getTime());
    expect(row.signedErrorSeconds).toBe(0);
  });

  it('a pending snapshot for a stop with no matching drop-off yet stays unreconciled', () => {
    // The spare-bus trip (no students ever assigned to it in the seed data) — guaranteed no Journey can ever reach this stop.
    const trip = tripRepository.findAll()[2];
    const stop = routeRepository.findStopsByRouteId(trip.routeId)[0];
    etaAccuracyRepository.insertSnapshotIfAbsent({
      tripId: trip.id,
      busId: trip.busId,
      stopId: stop.id,
      predictionTimestamp: new Date(),
      predictedArrivalAt: new Date(Date.now() + 120_000),
      confidence: 'MEDIUM',
      predictionSource: 'SIMULATION',
    });
    expect(reconcileTripAccuracy(trip.id)).toBe(0);
    const row = etaAccuracyRepository.findForMetrics({ tripId: trip.id })[0];
    expect(row.actualArrivalAt).toBeNull();
  });

  it('reconcileAllPendingAccuracy sweeps across multiple trips (bounded)', () => {
    const trips = tripRepository.findAll();
    for (const trip of trips) {
      const stop = routeRepository.findStopsByRouteId(trip.routeId)[0];
      if (!stop) continue;
      etaAccuracyRepository.insertSnapshotIfAbsent({
        tripId: trip.id,
        busId: trip.busId,
        stopId: stop.id,
        predictionTimestamp: new Date(),
        predictedArrivalAt: new Date(Date.now() + 60_000),
        confidence: 'MEDIUM',
        predictionSource: 'SIMULATION',
      });
    }
    expect(() => reconcileAllPendingAccuracy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Simulation vs. real distinguishability — simulation must never masquerade
// as real-world accuracy.
// ---------------------------------------------------------------------------

describe('sourceMix — LIVE/SIMULATION/MIXED distinguishability (spec mandatory)', () => {
  it('reports NONE with no snapshots at all, TELEMETRY/SIMULATION/MIXED otherwise', () => {
    expect(getSummaryEtaAccuracy().sourceMix).toBe('NONE');

    const trip = tripRepository.findAll()[0];
    const stop = routeRepository.findStopsByRouteId(trip.routeId)[0];
    etaAccuracyRepository.insertSnapshotIfAbsent({
      tripId: trip.id,
      busId: trip.busId,
      stopId: stop.id,
      predictionTimestamp: new Date(),
      predictedArrivalAt: new Date(Date.now() + 60_000),
      confidence: 'HIGH',
      predictionSource: 'SIMULATION',
    });
    expect(getSummaryEtaAccuracy().sourceMix).toBe('SIMULATION');

    const trip2 = tripRepository.findAll()[1];
    const stop2 = routeRepository.findStopsByRouteId(trip2.routeId)[0];
    etaAccuracyRepository.insertSnapshotIfAbsent({
      tripId: trip2.id,
      busId: trip2.busId,
      stopId: stop2.id,
      predictionTimestamp: new Date(),
      predictedArrivalAt: new Date(Date.now() + 60_000),
      confidence: 'HIGH',
      predictionSource: 'TELEMETRY',
    });
    expect(getSummaryEtaAccuracy().sourceMix).toBe('MIXED');
  });
});

// ---------------------------------------------------------------------------
// getTripEtaAccuracy / getSummaryEtaAccuracy — the read entry points the
// route handlers call. Empty-state must never fabricate a 0%.
// ---------------------------------------------------------------------------

describe('getTripEtaAccuracy / getSummaryEtaAccuracy — honest empty state', () => {
  it('a trip with zero snapshots returns measurableSamples 0, not a fabricated accuracy', () => {
    const trip = tripRepository.findAll()[0];
    const view = getTripEtaAccuracy(trip.id);
    expect(view.metrics.measurableSamples).toBe(0);
    expect(view.metrics.maeSeconds).toBeNull();
    expect(view.sourceMix).toBe('NONE');
  });

  it('a nonexistent trip id returns an honest empty view, never a throw', () => {
    const view = getTripEtaAccuracy('does-not-exist');
    expect(view.metrics.totalCandidates).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Authorization matrix — reuses requireOperationalUser/requireTelemetryReader
// completely unchanged (byte-identical guard functions to Phase 4B-4D).
// ---------------------------------------------------------------------------

describe('Authorization matrix for the new accuracy endpoints (spec mandatory)', () => {
  it('admin and school pass requireOperationalUser (fleet summary access)', () => {
    const admin = userRepository.findAll().find((u) => u.role === 'admin')!;
    const school = userRepository.findAll().find((u) => u.role === 'school')!;
    expect(requireOperationalUser(admin.email).ok).toBe(true);
    expect(requireOperationalUser(school.email).ok).toBe(true);
  });

  it('a driver can read accuracy for their OWN trip', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const driver = driverRepository.findById(trip.driverId!)!;
    const driverUser = userRepository.findById(driver.userId!)!;
    expect(requireTelemetryReader(driverUser.email, { tripId: trip.id }).ok).toBe(true);
  });

  it('a driver reading ANOTHER driver\'s trip accuracy is rejected — 403 (mandatory)', () => {
    const trips = tripRepository.findAll().filter((t) => t.driverId);
    const tripA = trips[0];
    const tripB = trips.find((t) => t.driverId !== tripA.driverId)!;
    const driverOfA = driverRepository.findById(tripA.driverId!)!;
    const userOfA = userRepository.findById(driverOfA.userId!)!;

    const guard = requireTelemetryReader(userOfA.email, { tripId: tripB.id });
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(403);
  });

  it('a driver has no unscoped fleet-summary access (requireOperationalUser rejects drivers)', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const driver = driverRepository.findById(trip.driverId!)!;
    const driverUser = userRepository.findById(driver.userId!)!;
    const guard = requireOperationalUser(driverUser.email);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(403);
  });

  it('parent has no accuracy read access', () => {
    const parentEmail = 'eta-accuracy-parent-test@masara.om';
    const admin = userRepository.findAll().find((u) => u.role === 'admin')!;
    db.insert(users).values({ id: crypto.randomUUID(), schoolId: admin.schoolId, name: 'Parent', email: parentEmail, passwordHash: 'x', role: 'parent' }).run();
    expect(requireOperationalUser(parentEmail).ok).toBe(false);
    expect(requireTelemetryReader(parentEmail).ok).toBe(false);
  });

  it('unauthenticated (missing email) and unknown user are rejected', () => {
    expect(requireOperationalUser(undefined).ok).toBe(false);
    expect(requireTelemetryReader(undefined).ok).toBe(false);
    expect(requireOperationalUser('nobody@masara.om').ok).toBe(false);
    expect(requireTelemetryReader('nobody@masara.om').ok).toBe(false);
  });

  it('a device credential used as userEmail is rejected — a device is not a human user', () => {
    const bus = busRepository.findAll()[0];
    const { device } = registerDevice(bus.id, 'TEST DEVICE — accuracy-guard-mismatch', 'DEVICE');
    expect(requireOperationalUser(device.id).ok).toBe(false);
    expect(requireTelemetryReader(device.id).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Mandatory isolation snapshot — accuracy read/reconciliation must never
// mutate any other table.
// ---------------------------------------------------------------------------

describe('Isolation — accuracy reads/reconciliation touch nothing else (spec mandatory)', () => {
  it('audit_logs, journeys, trips, buses, routes, recommendations, telemetry_observations, current_location_projection are all unchanged', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const student = studentRepository.findByBusId(trip.busId)[3];
    const stop = routeRepository.findStopsByRouteId(trip.routeId)[0];

    let journey = createJourney(student.id, trip.id, SYSTEM);
    journey = startJourney(journey.id, SYSTEM);
    startBoarding(journey.id, SYSTEM);
    boardStudent(journey.id, SYSTEM);
    startTransit(journey.id, SYSTEM);
    approachStop(journey.id, stop.id, SYSTEM);
    dropOffStudent(journey.id, stop.id, SYSTEM);

    etaAccuracyRepository.insertSnapshotIfAbsent({
      tripId: trip.id,
      busId: trip.busId,
      stopId: stop.id,
      predictionTimestamp: new Date(Date.now() - 120_000),
      predictedArrivalAt: new Date(),
      confidence: 'HIGH',
      predictionSource: 'TELEMETRY',
    });

    const before = {
      auditCount: auditRepository.findAll().length,
      journeys: JSON.stringify(journeyRepository.findByTripId(trip.id)),
      trips: JSON.stringify(tripRepository.findAll()),
      buses: JSON.stringify(busRepository.findAll()),
      routes: JSON.stringify(routeRepository.findAll()),
      recommendations: JSON.stringify(recommendationRepository.findAll()),
      telemetry: JSON.stringify(telemetryObservationRepository.findFiltered({ limit: 500 })),
      projection: JSON.stringify(currentLocationProjectionRepository.findAll()),
    };

    getTripEtaAccuracy(trip.id);
    getSummaryEtaAccuracy();

    expect(auditRepository.findAll().length).toBe(before.auditCount);
    expect(JSON.stringify(journeyRepository.findByTripId(trip.id))).toBe(before.journeys);
    expect(JSON.stringify(tripRepository.findAll())).toBe(before.trips);
    expect(JSON.stringify(busRepository.findAll())).toBe(before.buses);
    expect(JSON.stringify(routeRepository.findAll())).toBe(before.routes);
    expect(JSON.stringify(recommendationRepository.findAll())).toBe(before.recommendations);
    expect(JSON.stringify(telemetryObservationRepository.findFiltered({ limit: 500 }))).toBe(before.telemetry);
    expect(JSON.stringify(currentLocationProjectionRepository.findAll())).toBe(before.projection);
  });
});

// ---------------------------------------------------------------------------
// Source-scan governance guards — no AI/ML call, no mutation import, no
// client-supplied actualArrivalAt, no unguarded route.
// ---------------------------------------------------------------------------

describe('Source-scan governance guards (spec mandatory) — accuracy cannot mutate anything or bypass governance', () => {
  const serviceSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/EtaAccuracyService.ts'), 'utf8');
  const repoSource = fs.readFileSync(path.resolve(__dirname, '../../server/repositories/etaAccuracyRepository.ts'), 'utf8');
  const routesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/etaRoutes.ts'), 'utf8');
  const forbiddenImports = /from ['"].*\/(JourneyService|JourneyStateMachine|ActionExecutor|PolicyEngine|MasaraOperationsAgent|PredictionEngine)['"]/;
  const forbiddenAi = /(GoogleGenAI|generateContent|LLMProvider|MockProvider)/;

  it('EtaAccuracyService.ts imports no Journey/governance mutation module and no AI/LLM provider', () => {
    expect(serviceSource).not.toMatch(forbiddenImports);
    expect(serviceSource).not.toMatch(forbiddenAi);
  });

  it('EtaAccuracyService.ts never writes audit_logs', () => {
    expect(serviceSource).not.toMatch(/from ['"].*auditRepository['"]/);
  });

  it('etaAccuracyRepository.ts never accepts a client-supplied actualArrivalAt field name from a payload', () => {
    expect(repoSource).not.toMatch(/req\.(body|query)/);
  });

  it('the accuracy routes never trust req.body/req.query for actualArrivalAt, actorId, or role', () => {
    const accuracyBlockStart = routesSource.indexOf('/api/eta/accuracy/summary');
    const accuracyBlock = routesSource.slice(accuracyBlockStart);
    expect(accuracyBlock).not.toMatch(/req\.(body|query)\??\.(actualArrivalAt|actorId|role)\b/);
  });

  it('no POST/PUT/PATCH/DELETE handler exists for the accuracy endpoints — read-only', () => {
    expect(routesSource).not.toMatch(/etaRouter\.(post|put|patch|delete)\(\s*['"]\/api\/eta\/accuracy/);
  });

  it('both new accuracy routes are guarded (requireOperationalUser for summary, requireTelemetryReader for the trip endpoint)', () => {
    const summaryStart = routesSource.indexOf("'/api/eta/accuracy/summary'");
    const summaryBlock = routesSource.slice(summaryStart, routesSource.indexOf('});', summaryStart));
    expect(summaryBlock).toMatch(/requireOperationalUser\(/);

    const tripStart = routesSource.indexOf("'/api/eta/accuracy/trips/:tripId'");
    const tripBlock = routesSource.slice(tripStart, routesSource.indexOf('});', tripStart));
    expect(tripBlock).toMatch(/requireTelemetryReader\(/);
  });
});
