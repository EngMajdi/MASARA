import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  startGpsSimulation,
  advanceGpsSimulation,
  pauseGpsSimulation,
  resumeGpsSimulation,
  cancelGpsSimulation,
  getGpsSession,
  listGpsSessions,
  resetAllGpsSimulations,
  interpolatePosition,
  initialBearingDegrees,
  haversineMeters,
  validateObservation,
  GpsSimulationStateError,
  GpsRouteValidationError,
  GpsObservationValidationError,
} from '../../server/services/GpsSimulationEngine';
import { tripRepository } from '../../server/repositories/tripRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { routeRepository } from '../../server/repositories/routeRepository';
import { journeyRepository } from '../../server/repositories/journeyRepository';
import { recommendationRepository } from '../../server/repositories/recommendationRepository';
import { auditRepository } from '../../server/repositories/auditRepository';
import { listOperationsEvents } from '../../server/services/OperationsFeed';
import { getJourneyTimeline, createJourney } from '../../server/services/JourneyService';
import { studentRepository } from '../../server/repositories/studentRepository';
import { db } from '../../database/client';
import { routes, trips } from '../../database/schema';

function freshTrip() {
  return tripRepository.findAll()[0];
}

describe('Geometry primitives (spec Phase 4A §9/§12/§45/§46/§48)', () => {
  it('interpolatePosition at 0/25/50/75/100% matches expected fractional points, with exact endpoints', () => {
    const a = { lat: 10, lng: 20 }; // TEST fixture coordinates only, not real geography
    const b = { lat: 20, lng: 40 };
    expect(interpolatePosition(a, b, 0)).toEqual({ lat: 10, lng: 20 });
    expect(interpolatePosition(a, b, 1)).toEqual({ lat: 20, lng: 40 });
    const q25 = interpolatePosition(a, b, 0.25);
    expect(q25.lat).toBeCloseTo(12.5, 5);
    expect(q25.lng).toBeCloseTo(25, 5);
    const q50 = interpolatePosition(a, b, 0.5);
    expect(q50.lat).toBeCloseTo(15, 5);
    expect(q50.lng).toBeCloseTo(30, 5);
    const q75 = interpolatePosition(a, b, 0.75);
    expect(q75.lat).toBeCloseTo(17.5, 5);
    expect(q75.lng).toBeCloseTo(35, 5);
  });

  it('clamps interpolation fraction outside [0,1]', () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 10, lng: 10 };
    expect(interpolatePosition(a, b, -1)).toEqual({ lat: 0, lng: 0 });
    expect(interpolatePosition(a, b, 2)).toEqual({ lat: 10, lng: 10 });
  });

  it('heading is approximately east (~90°) for due-east movement, and null for zero movement (spec §12/§48)', () => {
    const west = { lat: 23.6, lng: 58.4 };
    const east = { lat: 23.6, lng: 58.5 }; // same latitude, greater longitude -> due east
    const bearing = initialBearingDegrees(west, east)!;
    expect(bearing).toBeGreaterThan(80);
    expect(bearing).toBeLessThan(100);
    expect(initialBearingDegrees(west, west)).toBeNull();
  });

  it('haversineMeters returns 0 for identical points and a positive value otherwise', () => {
    const p = { lat: 23.6, lng: 58.4 };
    expect(haversineMeters(p, p)).toBe(0);
    expect(haversineMeters(p, { lat: 23.7, lng: 58.4 })).toBeGreaterThan(0);
  });
});

describe('validateObservation (spec §24 — the same boundary a future real device must pass)', () => {
  const base = {
    observationId: 'obs-1',
    sourceEventId: 'SIM-x-1',
    source: 'SIMULATION' as const,
    busId: 'bus-1',
    tripId: 'trip-1',
    sequence: 1,
    occurredAt: new Date(),
    receivedAt: new Date(),
    latitude: 23.6,
    longitude: 58.4,
  };

  it('accepts a valid observation', () => {
    expect(() => validateObservation(base)).not.toThrow();
  });

  it('rejects out-of-range latitude/longitude', () => {
    expect(() => validateObservation({ ...base, latitude: 91 })).toThrow(GpsObservationValidationError);
    expect(() => validateObservation({ ...base, longitude: -181 })).toThrow(GpsObservationValidationError);
  });

  it('rejects a missing busId/observationId/sourceEventId', () => {
    expect(() => validateObservation({ ...base, busId: '' })).toThrow(GpsObservationValidationError);
    expect(() => validateObservation({ ...base, observationId: '' })).toThrow(GpsObservationValidationError);
    expect(() => validateObservation({ ...base, sourceEventId: '' })).toThrow(GpsObservationValidationError);
  });

  it('rejects negative speed and non-positive sequence', () => {
    expect(() => validateObservation({ ...base, speed: -5 })).toThrow(GpsObservationValidationError);
    expect(() => validateObservation({ ...base, sequence: 0 })).toThrow(GpsObservationValidationError);
  });
});

describe('GpsSimulationEngine session lifecycle (spec Phase 4A, AC-01..14)', () => {
  beforeEach(() => {
    resetAllGpsSimulations();
  });

  it('starts against a real seeded trip and resolves real route-stop + school coordinates as waypoints', () => {
    const trip = freshTrip();
    const session = startGpsSimulation(trip.id, 'admin-test');
    expect(session.status).toBe('RUNNING');
    expect(session.tripId).toBe(trip.id);
    expect(session.busId).toBe(trip.busId);
    expect(session.waypoints.length).toBeGreaterThanOrEqual(2); // at least 1 real stop + the school
    // Starting position is the first real waypoint, not an invented coordinate.
    expect(session.currentLat).toBe(session.waypoints[0].lat);
    expect(session.currentLng).toBe(session.waypoints[0].lng);
  });

  it('rejects starting a second GPS simulation on a trip that already has one running', () => {
    const trip = freshTrip();
    startGpsSimulation(trip.id, 'admin-test');
    expect(() => startGpsSimulation(trip.id, 'admin-test')).toThrow(GpsSimulationStateError);
  });

  it('fails safely when a route has zero usable stops, without creating a session (spec §7/§44)', () => {
    // Controlled fixture — a real trip pointing at a genuinely empty route,
    // inserted directly (same pattern as Phase 3A's authz.test.ts throwaway
    // parent user) since every seeded route has real stops.
    const anyTrip = freshTrip();
    const anyRoute = routeRepository.findById(anyTrip.routeId)!;
    const emptyRouteId = crypto.randomUUID();
    db.insert(routes)
      .values({ id: emptyRouteId, schoolId: anyRoute.schoolId, name: 'مسار اختبار بلا محطات (فارغ عمداً)', status: 'scheduled' })
      .run();
    const brokenTripId = crypto.randomUUID();
    db.insert(trips)
      .values({ id: brokenTripId, routeId: emptyRouteId, busId: anyTrip.busId, status: 'scheduled' })
      .run();

    expect(() => startGpsSimulation(brokenTripId, 'admin-test')).toThrow(GpsRouteValidationError);
    expect(listGpsSessions().length).toBe(0); // no partially-invalid session left behind
  });

  it('AC-05/AC-06/AC-07: every observation has a unique id, a deterministic sourceEventId, and monotonic sequence', () => {
    const trip = freshTrip();
    const session = startGpsSimulation(trip.id, 'admin-test', { speedProfile: 'FAST', tickSeconds: 5 });

    const o1 = advanceGpsSimulation(session.id);
    const o2 = advanceGpsSimulation(session.id);

    expect(o1.observationId).not.toBe(o2.observationId);
    expect(o1.sequence).toBe(1);
    expect(o2.sequence).toBe(2);
    expect(o1.sourceEventId).toBe(`SIM-${session.id}-1`);
    expect(o2.sourceEventId).toBe(`SIM-${session.id}-2`);
    // Deterministic — the same (session, sequence) pair always yields the
    // same id (spec §21/§49), which is exactly what Phase 4B dedup needs.
    expect(o1.sourceEventId).not.toBe(o2.sourceEventId);
  });

  it('AC-08/§47: STOPPED profile produces zero movement and a null heading despite ticking', () => {
    const trip = freshTrip();
    const session = startGpsSimulation(trip.id, 'admin-test', { speedProfile: 'STOPPED' });
    const before = { lat: session.currentLat, lng: session.currentLng };
    const obs = advanceGpsSimulation(session.id);
    expect(obs.latitude).toBe(before.lat);
    expect(obs.longitude).toBe(before.lng);
    expect(obs.speed).toBe(0);
    expect(obs.heading).toBeUndefined();
  });

  it('§47: distance covered per tick is consistent with speed × simulated time (mid-leg, NORMAL profile)', () => {
    const trip = freshTrip();
    const session = startGpsSimulation(trip.id, 'admin-test', { speedProfile: 'NORMAL', tickSeconds: 5 }); // 30 km/h
    const before = { lat: session.currentLat, lng: session.currentLng };
    const obs = advanceGpsSimulation(session.id);
    // Only valid while still inside the first leg (not clamped at a waypoint).
    const updated = getGpsSession(session.id);
    if (updated.legIndex === 0 && updated.status === 'RUNNING') {
      const expectedMeters = ((30 * 1000) / 3600) * 5; // ~41.67m
      const actualMeters = haversineMeters(before, { lat: obs.latitude, lng: obs.longitude });
      expect(actualMeters).toBeCloseTo(expectedMeters, 0);
    }
  });

  it('AC-09/AC-10/§51: pause freezes the simulation — no new observation while paused — resume continues from the same position/sequence', () => {
    const trip = freshTrip();
    const session = startGpsSimulation(trip.id, 'admin-test', { speedProfile: 'NORMAL' });
    advanceGpsSimulation(session.id);
    const beforePause = getGpsSession(session.id);
    expect(beforePause.sequence).toBe(1);

    const paused = pauseGpsSimulation(session.id);
    expect(paused.status).toBe('PAUSED');
    expect(() => advanceGpsSimulation(session.id)).toThrow(GpsSimulationStateError);
    const stillPaused = getGpsSession(session.id);
    expect(stillPaused.sequence).toBe(1); // unchanged — no observation generated while paused
    expect(stillPaused.observations.length).toBe(1);

    const resumed = resumeGpsSimulation(session.id);
    expect(resumed.status).toBe('RUNNING');
    expect(resumed.sequence).toBe(1); // resumed from where it was, not reset
    expect(resumed.currentLat).toBe(beforePause.currentLat);

    const nextObs = advanceGpsSimulation(session.id);
    expect(nextObs.sequence).toBe(2); // continues, never restarts
  });

  it('AC-11/§42/§52: reaching the final waypoint marks the session COMPLETED and stops generating further observations', () => {
    const trip = freshTrip();
    // FAST + a large tick guarantees covering the whole (short, seeded) route in one advance.
    const session = startGpsSimulation(trip.id, 'admin-test', { speedProfile: 'FAST', tickSeconds: 3600 });
    const obs = advanceGpsSimulation(session.id);
    const finished = getGpsSession(session.id);
    expect(finished.status).toBe('COMPLETED');
    const lastWaypoint = finished.waypoints[finished.waypoints.length - 1];
    expect(obs.latitude).toBeCloseTo(lastWaypoint.lat, 6);
    expect(obs.longitude).toBeCloseTo(lastWaypoint.lng, 6);
    expect(() => advanceGpsSimulation(session.id)).toThrow(GpsSimulationStateError); // no observations after completion
  });

  it('§41: cancel stops future observations but preserves already-generated ones', () => {
    const trip = freshTrip();
    const session = startGpsSimulation(trip.id, 'admin-test');
    advanceGpsSimulation(session.id);
    const cancelled = cancelGpsSimulation(session.id);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.observations.length).toBe(1); // preserved, not deleted
    expect(() => advanceGpsSimulation(session.id)).toThrow(GpsSimulationStateError);
  });

  it('cannot cancel an already-terminal session', () => {
    const trip = freshTrip();
    const session = startGpsSimulation(trip.id, 'admin-test', { speedProfile: 'FAST', tickSeconds: 3600 });
    advanceGpsSimulation(session.id);
    expect(getGpsSession(session.id).status).toBe('COMPLETED');
    expect(() => cancelGpsSimulation(session.id)).toThrow(GpsSimulationStateError);
  });

  it('resetAllGpsSimulations clears in-memory sessions', () => {
    const trip = freshTrip();
    const session = startGpsSimulation(trip.id, 'admin-test');
    resetAllGpsSimulations();
    expect(() => getGpsSession(session.id)).toThrow();
    expect(listGpsSessions().length).toBe(0);
  });
});

describe('MANDATORY: GPS simulation never mutates operational state (spec §54, AC-19..24)', () => {
  beforeEach(() => {
    resetAllGpsSimulations();
  });

  it('Journey/Trip/Bus/Route/Recommendation/Approval state is byte-for-byte unchanged after many GPS observations', async () => {
    const trip = freshTrip();
    const bus = busRepository.findById(trip.busId)!;
    const route = routeRepository.findById(trip.routeId)!;
    const journeysBefore = journeyRepository.findByTripId(trip.id);
    const recCountBefore = recommendationRepository.findAll().length;

    const session = startGpsSimulation(trip.id, 'admin-test', { speedProfile: 'NORMAL', tickSeconds: 5 });
    for (let i = 0; i < 20 && getGpsSession(session.id).status === 'RUNNING'; i++) {
      advanceGpsSimulation(session.id);
    }
    expect(getGpsSession(session.id).observations.length).toBeGreaterThan(0);

    const tripAfter = tripRepository.findById(trip.id)!;
    const busAfter = busRepository.findById(trip.busId)!;
    const routeAfter = routeRepository.findById(trip.routeId)!;
    const journeysAfter = journeyRepository.findByTripId(trip.id);
    const recCountAfter = recommendationRepository.findAll().length;

    expect(tripAfter).toEqual(trip); // full trip row unchanged
    // Bus location/speed fields specifically — the exact fields it would be
    // tempting to "conveniently" update, per spec §30 option B.
    expect(busAfter.currentLat).toBe(bus.currentLat);
    expect(busAfter.currentLng).toBe(bus.currentLng);
    expect(busAfter.speedKmh).toBe(bus.speedKmh);
    expect(busAfter).toEqual(bus);
    expect(routeAfter).toEqual(route);
    expect(journeysAfter).toEqual(journeysBefore);
    expect(recCountAfter).toBe(recCountBefore);
  });
});

describe('MANDATORY: raw GPS telemetry does not pollute audit_logs, OperationsFeed, or JourneyTimeline (spec §55/§56/§57, AC-16..18)', () => {
  beforeEach(() => {
    resetAllGpsSimulations();
  });

  it('audit_logs row count is unchanged after generating many observations', () => {
    const trip = freshTrip();
    const auditCountBefore = auditRepository.findAll().length;

    const session = startGpsSimulation(trip.id, 'admin-test', { speedProfile: 'NORMAL', tickSeconds: 5 });
    for (let i = 0; i < 15 && getGpsSession(session.id).status === 'RUNNING'; i++) {
      advanceGpsSimulation(session.id);
    }

    const auditCountAfter = auditRepository.findAll().length;
    expect(auditCountAfter).toBe(auditCountBefore);
  });

  it('OperationsFeed output is unaffected by a running GPS simulation', () => {
    const trip = freshTrip();
    const feedBefore = listOperationsEvents({ tripId: trip.id });

    const session = startGpsSimulation(trip.id, 'admin-test', { speedProfile: 'NORMAL', tickSeconds: 5 });
    for (let i = 0; i < 15 && getGpsSession(session.id).status === 'RUNNING'; i++) {
      advanceGpsSimulation(session.id);
    }

    const feedAfter = listOperationsEvents({ tripId: trip.id });
    expect(feedAfter).toEqual(feedBefore);
  });

  it('an existing Journey timeline on the same trip is unaffected by GPS observations', () => {
    const trip = freshTrip();
    const student = studentRepository.findByBusId(trip.busId)[0];
    const journey = createJourney(student.id, trip.id, { actorId: null, actorType: 'system' });
    const timelineBefore = getJourneyTimeline(journey.id);

    const session = startGpsSimulation(trip.id, 'admin-test', { speedProfile: 'NORMAL', tickSeconds: 5 });
    for (let i = 0; i < 15 && getGpsSession(session.id).status === 'RUNNING'; i++) {
      advanceGpsSimulation(session.id);
    }

    const timelineAfter = getJourneyTimeline(journey.id);
    expect(timelineAfter).toEqual(timelineBefore); // no raw GPS points appended
  });
});

describe('Security regression (spec §35/§53/§76/§77) — every GPS simulation route is operational-gated, source is never client-controlled', () => {
  const routeSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/gpsSimulationRoutes.ts'), 'utf8');

  it('every route handler calls requireOperationalUser (admin/school only — same reuse as Phase 2B simulation)', () => {
    const handlerCount = (routeSource.match(/gpsSimulationRouter\.(get|post)\(/g) ?? []).length;
    const guardCount = (routeSource.match(/requireOperationalUser\(/g) ?? []).length;
    expect(handlerCount).toBeGreaterThan(0);
    expect(guardCount).toBe(handlerCount); // one guard call per handler, no unguarded route
  });

  it('the server determines source = SIMULATION — no request field lets a client choose it', () => {
    expect(routeSource).not.toMatch(/req\.body\??\.source/);
    expect(routeSource).not.toMatch(/req\.query\??\.source/);
  });

  it('no request field lets a client submit an arbitrary eventType for GPS simulation', () => {
    expect(routeSource).not.toMatch(/req\.body\??\.eventType/);
  });
});
