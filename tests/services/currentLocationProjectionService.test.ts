import { describe, it, expect, beforeEach } from 'vitest';
import {
  processObservation,
  getCurrentLocation,
  listFleetCurrentLocations,
  rebuildCurrentLocationProjection,
  deriveFreshness,
  CURRENT_LOCATION_STALE_AFTER_SECONDS,
} from '../../server/services/CurrentLocationProjectionService';
import { currentLocationProjectionRepository } from '../../server/repositories/currentLocationProjectionRepository';
import { registerDevice } from '../../server/services/TelemetryDeviceService';
import { ingestObservation } from '../../server/services/TelemetryIngestionService';
import { startGpsSimulation, advanceGpsSimulation, resetAllGpsSimulations, getGpsSession } from '../../server/services/GpsSimulationEngine';
import { tripRepository } from '../../server/repositories/tripRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { routeRepository } from '../../server/repositories/routeRepository';
import { studentRepository } from '../../server/repositories/studentRepository';
import { journeyRepository } from '../../server/repositories/journeyRepository';
import { recommendationRepository } from '../../server/repositories/recommendationRepository';
import { auditRepository } from '../../server/repositories/auditRepository';
import { createJourney, getJourneyTimeline } from '../../server/services/JourneyService';
import { requireTelemetryReader, requireOperationalUser } from '../../server/services/authz';
import { userRepository } from '../../server/repositories/userRepository';
import { driverRepository } from '../../server/repositories/driverRepository';
import type { TelemetryObservation } from '../../server/domain/telemetryContract';

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

// Every test starts with a genuinely empty projection table — otherwise
// leftover rows from one test (which may use "now"-based dates) collide
// with fixed historical dates used by another, since these tests reuse the
// same handful of seeded buses across many `it()` blocks. This never
// touches telemetry_observations or any other table — a pure, safe
// projection-only reset.
beforeEach(() => {
  currentLocationProjectionRepository.clear();
});

describe('CurrentLocationProjectionService — ordering policy (spec §4/§5/§31)', () => {
  it('the first observation for a bus creates the projection', () => {
    const bus = busRepository.findAll()[0];
    const obs = makeObservation(bus.id);
    processObservation(obs);
    const loc = getCurrentLocation(bus.id)!;
    expect(loc.observationId).toBe(obs.observationId);
    expect(loc.latitude).toBe(obs.latitude);
  });

  it('a strictly newer occurredAt replaces the projection', () => {
    const bus = busRepository.findAll()[0];
    const t1 = new Date('2026-01-01T10:10:00.000Z');
    const t2 = new Date('2026-01-01T10:11:00.000Z');
    const first = makeObservation(bus.id, { occurredAt: t1, latitude: 23.6 });
    processObservation(first);
    const second = makeObservation(bus.id, { occurredAt: t2, latitude: 23.7 });
    processObservation(second);
    expect(getCurrentLocation(bus.id)!.observationId).toBe(second.observationId);
    expect(getCurrentLocation(bus.id)!.latitude).toBe(23.7);
  });

  it('an OLDER occurredAt arriving after a newer one does NOT regress the projection (spec §5 mandatory example)', () => {
    const bus = busRepository.findAll()[0];
    const newer = makeObservation(bus.id, { occurredAt: new Date('2026-01-01T10:10:00.000Z'), sequence: 10, latitude: 23.9 });
    processObservation(newer);
    const older = makeObservation(bus.id, { occurredAt: new Date('2026-01-01T10:09:00.000Z'), sequence: 9, latitude: 23.1 });
    processObservation(older);
    const loc = getCurrentLocation(bus.id)!;
    expect(loc.observationId).toBe(newer.observationId); // unchanged — projection remains the newer observation
    expect(loc.latitude).toBe(23.9);
  });

  it('tie-break: same occurredAt, receivedAt decides', () => {
    const bus = busRepository.findAll()[0];
    const occurredAt = new Date('2026-01-01T10:10:00.000Z');
    const first = makeObservation(bus.id, { occurredAt, receivedAt: new Date('2026-01-01T10:10:05.000Z'), latitude: 23.1 });
    processObservation(first);
    const second = makeObservation(bus.id, { occurredAt, receivedAt: new Date('2026-01-01T10:10:10.000Z'), latitude: 23.2 });
    processObservation(second);
    expect(getCurrentLocation(bus.id)!.latitude).toBe(23.2); // later receivedAt wins the tie
  });

  it('tie-break: same occurredAt+receivedAt, sequence decides', () => {
    const bus = busRepository.findAll()[0];
    const occurredAt = new Date('2026-01-01T10:10:00.000Z');
    const receivedAt = new Date('2026-01-01T10:10:05.000Z');
    const first = makeObservation(bus.id, { occurredAt, receivedAt, sequence: 5, latitude: 23.1 });
    processObservation(first);
    const second = makeObservation(bus.id, { occurredAt, receivedAt, sequence: 6, latitude: 23.2 });
    processObservation(second);
    expect(getCurrentLocation(bus.id)!.latitude).toBe(23.2);
  });

  it('tie-break: same occurredAt+receivedAt+sequence, observationId decides deterministically', () => {
    const bus = busRepository.findAll()[0];
    const occurredAt = new Date('2026-01-01T10:10:00.000Z');
    const receivedAt = new Date('2026-01-01T10:10:05.000Z');
    const a = makeObservation(bus.id, { observationId: 'aaa-observation', occurredAt, receivedAt, sequence: 1, latitude: 23.1 });
    const b = makeObservation(bus.id, { observationId: 'bbb-observation', occurredAt, receivedAt, sequence: 1, latitude: 23.2 });
    processObservation(a);
    processObservation(b);
    // 'bbb-observation' > 'aaa-observation' lexicographically -> b wins
    expect(getCurrentLocation(bus.id)!.observationId).toBe('bbb-observation');
    expect(getCurrentLocation(bus.id)!.latitude).toBe(23.2);

    processObservation(a); // re-processing the lexicographically-smaller one afterwards must not regress it
    expect(getCurrentLocation(bus.id)!.observationId).toBe('bbb-observation');
  });
});

describe('Freshness (spec §10/§30)', () => {
  it('a recent observation is FRESH', () => {
    const now = new Date('2026-01-01T10:00:00.000Z');
    const receivedAt = new Date(now.getTime() - (CURRENT_LOCATION_STALE_AFTER_SECONDS - 5) * 1000);
    expect(deriveFreshness(receivedAt, now)).toBe('FRESH');
  });

  it('an old observation is STALE', () => {
    const now = new Date('2026-01-01T10:00:00.000Z');
    const receivedAt = new Date(now.getTime() - (CURRENT_LOCATION_STALE_AFTER_SECONDS + 30) * 1000);
    expect(deriveFreshness(receivedAt, now)).toBe('STALE');
  });

  it('the exact boundary is deterministic (inclusive FRESH)', () => {
    const now = new Date('2026-01-01T10:00:00.000Z');
    const receivedAt = new Date(now.getTime() - CURRENT_LOCATION_STALE_AFTER_SECONDS * 1000);
    expect(deriveFreshness(receivedAt, now)).toBe('FRESH');
    const oneOver = new Date(now.getTime() - (CURRENT_LOCATION_STALE_AFTER_SECONDS + 1) * 1000);
    expect(deriveFreshness(oneOver, now)).toBe('STALE');
  });
});

describe('Idempotency (spec §6/§33)', () => {
  it('processing the identical observation twice produces exactly the same projection, no corruption', () => {
    const bus = busRepository.findAll()[0];
    const obs = makeObservation(bus.id);
    processObservation(obs);
    const first = getCurrentLocation(bus.id)!;
    processObservation(obs);
    const second = getCurrentLocation(bus.id)!;
    expect(second.observationId).toBe(first.observationId);
    expect(second.latitude).toBe(first.latitude);
    expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime());
  });

  it('there is exactly one row for this bus after repeated processing (PK = busId)', () => {
    const bus = busRepository.findAll()[1];
    for (let i = 0; i < 5; i++) processObservation(makeObservation(bus.id, { occurredAt: new Date(Date.now() + i * 1000) }));
    const rows = currentLocationProjectionRepository.findAll().filter((r) => r.busId === bus.id);
    expect(rows.length).toBe(1);
  });
});

describe('Concurrent update race-safety (spec §8/§32)', () => {
  it('final projection is the newer observation regardless of processing order', async () => {
    const bus = busRepository.findAll()[0];
    const older = makeObservation(bus.id, { occurredAt: new Date('2026-01-01T10:09:00.000Z'), latitude: 20 });
    const newer = makeObservation(bus.id, { occurredAt: new Date('2026-01-01T10:11:00.000Z'), latitude: 30 });

    // Fire with the OLDER one resolving "after" the newer in the promise
    // array — the DB-level WHERE guard, not call order, must decide.
    await Promise.allSettled([
      Promise.resolve().then(() => processObservation(newer)),
      Promise.resolve().then(() => processObservation(older)),
    ]);
    expect(getCurrentLocation(bus.id)!.latitude).toBe(30);

    // And the reverse submission order — same guaranteed outcome.
    const bus2 = busRepository.findAll()[1];
    const olderB = makeObservation(bus2.id, { occurredAt: new Date('2026-01-01T10:09:00.000Z'), latitude: 20 });
    const newerB = makeObservation(bus2.id, { occurredAt: new Date('2026-01-01T10:11:00.000Z'), latitude: 30 });
    await Promise.allSettled([
      Promise.resolve().then(() => processObservation(olderB)),
      Promise.resolve().then(() => processObservation(newerB)),
    ]);
    expect(getCurrentLocation(bus2.id)!.latitude).toBe(30);
  });
});

describe('Multi-bus isolation (spec §34)', () => {
  it('three buses interleaved never inherit each other\'s coordinates', () => {
    const [busA, busB, busC] = busRepository.findAll();
    processObservation(makeObservation(busA.id, { latitude: 10, longitude: 10, occurredAt: new Date('2026-01-01T10:00:00Z') }));
    processObservation(makeObservation(busB.id, { latitude: 20, longitude: 20, occurredAt: new Date('2026-01-01T10:00:00Z') }));
    processObservation(makeObservation(busC.id, { latitude: 30, longitude: 30, occurredAt: new Date('2026-01-01T10:00:00Z') }));
    processObservation(makeObservation(busA.id, { latitude: 11, longitude: 11, occurredAt: new Date('2026-01-01T10:01:00Z') }));
    processObservation(makeObservation(busB.id, { latitude: 21, longitude: 21, occurredAt: new Date('2026-01-01T10:01:00Z') }));

    expect(getCurrentLocation(busA.id)!.latitude).toBe(11);
    expect(getCurrentLocation(busB.id)!.latitude).toBe(21);
    expect(getCurrentLocation(busC.id)!.latitude).toBe(30);
  });
});

describe('Trip switch (spec §9/§35)', () => {
  it('the projection reflects the latest observation\'s tripId without modifying either trip', () => {
    const trips = tripRepository.findAll().filter((t) => t.driverId);
    const bus = busRepository.findById(trips[0].busId)!;
    const tripsForBus = tripRepository.findByBusId(bus.id);
    const tripA = tripsForBus[0];
    const tripBefore = { ...tripA };

    processObservation(makeObservation(bus.id, { tripId: tripA.id, occurredAt: new Date('2026-01-01T09:00:00Z') }));
    expect(getCurrentLocation(bus.id)!.tripId).toBe(tripA.id);

    // Simulate the bus later reporting bus-only telemetry (tripId null) — projection follows.
    processObservation(makeObservation(bus.id, { tripId: null, occurredAt: new Date('2026-01-01T09:05:00Z') }));
    expect(getCurrentLocation(bus.id)!.tripId).toBeNull();

    expect(tripRepository.findById(tripA.id)).toEqual(tripBefore); // trip itself never modified
  });
});

describe('Rebuild + rebuild determinism (spec §21/§22)', () => {
  it('rebuilding from telemetry_observations produces the identical projection as incremental processing', () => {
    const busA = busRepository.findAll()[0];
    const busB = busRepository.findAll()[1];
    const { device: deviceA } = registerDevice(busA.id, 'TEST DEVICE — rebuild A', 'DEVICE');
    const { device: deviceB } = registerDevice(busB.id, 'TEST DEVICE — rebuild B', 'DEVICE');

    ingestObservation({ id: deviceA.id, busId: deviceA.busId, providerType: 'DEVICE' }, {
      sourceEventId: 'rb-a-1', occurredAt: '2026-01-01T09:00:00.000Z', latitude: 23.1, longitude: 58.1,
    });
    ingestObservation({ id: deviceA.id, busId: deviceA.busId, providerType: 'DEVICE' }, {
      sourceEventId: 'rb-a-2', occurredAt: '2026-01-01T09:05:00.000Z', latitude: 23.2, longitude: 58.2,
    });
    ingestObservation({ id: deviceA.id, busId: deviceA.busId, providerType: 'DEVICE' }, {
      sourceEventId: 'rb-a-3', occurredAt: '2026-01-01T09:10:00.000Z', latitude: 23.3, longitude: 58.3,
    });
    ingestObservation({ id: deviceB.id, busId: deviceB.busId, providerType: 'DEVICE' }, {
      sourceEventId: 'rb-b-1', occurredAt: '2026-01-01T09:00:00.000Z', latitude: 24.1, longitude: 59.1,
    });
    ingestObservation({ id: deviceB.id, busId: deviceB.busId, providerType: 'DEVICE' }, {
      sourceEventId: 'rb-b-2', occurredAt: '2026-01-01T09:07:00.000Z', latitude: 24.2, longitude: 59.2,
    });

    const incremental = {
      a: getCurrentLocation(busA.id)!,
      b: getCurrentLocation(busB.id)!,
    };

    // Reinitialize ONLY the projection — telemetry_observations is untouched.
    currentLocationProjectionRepository.clear();
    expect(getCurrentLocation(busA.id)).toBeNull();

    rebuildCurrentLocationProjection();

    const rebuilt = {
      a: getCurrentLocation(busA.id)!,
      b: getCurrentLocation(busB.id)!,
    };

    expect(rebuilt.a.observationId).toBe(incremental.a.observationId);
    expect(rebuilt.a.latitude).toBe(incremental.a.latitude);
    expect(rebuilt.a.longitude).toBe(incremental.a.longitude);
    expect(rebuilt.b.observationId).toBe(incremental.b.observationId);
    expect(rebuilt.b.latitude).toBe(incremental.b.latitude);
  });
});

describe('MANDATORY: projection processing never mutates operational state (spec §26/§27, real device + simulation + out-of-order)', () => {
  beforeEach(() => resetAllGpsSimulations());

  it('Journey/Student/Trip/Bus/Route/Recommendation state is unchanged after device, simulation, and out-of-order telemetry', async () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const bus = busRepository.findById(trip.busId)!;
    const route = routeRepository.findById(trip.routeId)!;
    const student = studentRepository.findByBusId(trip.busId)[0];
    // Establish the baseline journey FIRST (legitimate test setup — not
    // something telemetry does), THEN snapshot — otherwise the snapshot
    // would wrongly expect this setup journey/audit row not to exist.
    const journey = createJourney(student.id, trip.id, { actorId: null, actorType: 'system' });
    const journeysBefore = journeyRepository.findByTripId(trip.id);
    const studentsBefore = studentRepository.findByBusId(trip.busId);
    const recCountBefore = recommendationRepository.findAll().length;
    const auditCountBefore = auditRepository.findAll().length;
    const timelineBefore = getJourneyTimeline(journey.id);

    // Real device telemetry.
    const { device } = registerDevice(bus.id, 'TEST DEVICE — isolation', 'DEVICE');
    for (let i = 0; i < 30; i++) {
      ingestObservation({ id: device.id, busId: device.busId, providerType: 'DEVICE' }, {
        sourceEventId: `iso-${i}`,
        occurredAt: new Date(Date.now() - (30 - i) * 1000).toISOString(),
        latitude: 23.6 + i * 0.0001,
        longitude: 58.4,
      });
    }
    // Out-of-order telemetry.
    ingestObservation({ id: device.id, busId: device.busId, providerType: 'DEVICE' }, {
      sourceEventId: 'iso-late', occurredAt: new Date(Date.now() - 5 * 60_000).toISOString(), latitude: 23.5, longitude: 58.3,
    });
    // GPS simulation.
    const session = startGpsSimulation(trip.id, 'admin-test', { speedProfile: 'NORMAL', tickSeconds: 5 });
    for (let i = 0; i < 10 && getGpsSession(session.id).status === 'RUNNING'; i++) advanceGpsSimulation(session.id);

    expect(tripRepository.findById(trip.id)).toEqual(trip);
    expect(busRepository.findById(bus.id)).toEqual(bus); // includes currentLat/currentLng/speedKmh
    expect(routeRepository.findById(trip.routeId)).toEqual(route);
    expect(journeyRepository.findByTripId(trip.id)).toEqual(journeysBefore);
    expect(studentRepository.findByBusId(trip.busId)).toEqual(studentsBefore);
    expect(recommendationRepository.findAll().length).toBe(recCountBefore);
    expect(auditRepository.findAll().length).toBe(auditCountBefore); // zero audit rows from telemetry OR projection processing
    expect(getJourneyTimeline(journey.id)).toEqual(timelineBefore);
  });
});

describe('Security matrix for the read APIs (spec §28 mandatory list, end-to-end via the real guard + service)', () => {
  it('admin and school are authorized for the fleet read', () => {
    const admin = userRepository.findAll().find((u) => u.role === 'admin')!;
    const school = userRepository.findAll().find((u) => u.role === 'school')!;
    expect(requireOperationalUser(admin.email).ok).toBe(true);
    expect(requireOperationalUser(school.email).ok).toBe(true);
  });

  it('an authorized driver reading their OWN bus succeeds end-to-end', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const driver = driverRepository.findById(trip.driverId!)!;
    const driverUser = userRepository.findById(driver.userId!)!;
    processObservation(makeObservation(trip.busId));

    const guard = requireTelemetryReader(driverUser.email, { busId: trip.busId });
    expect(guard.ok).toBe(true);
    expect(getCurrentLocation(trip.busId)).toBeTruthy();
  });

  it('a driver reading ANOTHER driver\'s bus is rejected — 403, mandatory', () => {
    const trips = tripRepository.findAll().filter((t) => t.driverId);
    const tripA = trips[0];
    const tripB = trips.find((t) => t.driverId !== tripA.driverId)!;
    const driverOfA = driverRepository.findById(tripA.driverId!)!;
    const userOfA = userRepository.findById(driverOfA.userId!)!;

    const guard = requireTelemetryReader(userOfA.email, { busId: tripB.busId });
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(403);
  });

  it('a device credential cannot authenticate against the read guard at all — structurally a different guard (requireTelemetryReader expects a user email, never a device Bearer token)', () => {
    const bus = busRepository.findAll()[0];
    const { device } = registerDevice(bus.id, 'TEST DEVICE — read-guard-mismatch', 'DEVICE');
    // A device id is not a governed user email — requireTelemetryReader
    // resolves by email lookup only, so this is rejected the same way any
    // unknown identity would be.
    const guard = requireTelemetryReader(device.id, { busId: bus.id });
    expect(guard.ok).toBe(false);
  });

  it('unauthenticated (no email) and unknown user are both rejected', () => {
    expect(requireTelemetryReader(undefined).ok).toBe(false);
    expect(requireTelemetryReader('nobody@masara.om').ok).toBe(false);
  });

  it('an unknown busId returns null (no fabricated coordinates, no leak) for an authorized reader', () => {
    expect(getCurrentLocation('not-a-real-bus-id')).toBeNull();
  });
});

describe('Fleet listing is a single bounded query (spec §16/§40)', () => {
  it('listFleetCurrentLocations returns one entry per bus with a projection, no N+1 shape issue observable at this layer', () => {
    const buses = busRepository.findAll();
    for (const bus of buses) processObservation(makeObservation(bus.id));
    const fleet = listFleetCurrentLocations();
    expect(fleet.length).toBeGreaterThanOrEqual(buses.length);
    const busIds = new Set(fleet.map((f) => f.busId));
    for (const bus of buses) expect(busIds.has(bus.id)).toBe(true);
  });
});
