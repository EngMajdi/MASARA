import { describe, it, expect, beforeEach } from 'vitest';
import {
  ingestObservation,
  TelemetryValidationError,
  TelemetryCorrelationError,
  TelemetryNotFoundError,
  TelemetryConflictError,
  FUTURE_TOLERANCE_MS,
  type AuthenticatedDevice,
} from '../../server/services/TelemetryIngestionService';
import { registerDevice } from '../../server/services/TelemetryDeviceService';
import { telemetryObservationRepository } from '../../server/repositories/telemetryObservationRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { routeRepository } from '../../server/repositories/routeRepository';
import { studentRepository } from '../../server/repositories/studentRepository';
import { journeyRepository } from '../../server/repositories/journeyRepository';
import { recommendationRepository } from '../../server/repositories/recommendationRepository';
import { auditRepository } from '../../server/repositories/auditRepository';
import { listOperationsEvents } from '../../server/services/OperationsFeed';
import { createJourney, getJourneyTimeline } from '../../server/services/JourneyService';
import { advanceGpsSimulation, startGpsSimulation, resetAllGpsSimulations } from '../../server/services/GpsSimulationEngine';

function registerDeviceForFirstBus(): { device: AuthenticatedDevice; busId: string; tripId: string } {
  const trip = tripRepository.findAll().find((t) => t.driverId)!;
  const { device } = registerDevice(trip.busId, 'TEST DEVICE — vitest', 'DEVICE');
  return { device: { id: device.id, busId: device.busId, providerType: 'DEVICE' }, busId: trip.busId, tripId: trip.id };
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    sourceEventId: `evt-${crypto.randomUUID()}`,
    occurredAt: new Date().toISOString(),
    latitude: 23.6,
    longitude: 58.4,
    speedKmh: 30,
    heading: 90,
    accuracyMeters: 10,
    sequence: 1,
    ...overrides,
  };
}

describe('TelemetryIngestionService — validation (spec §17/§18, AC-05..09)', () => {
  it('accepts a fully valid observation', () => {
    const { device } = registerDeviceForFirstBus();
    const result = ingestObservation(device, validPayload());
    expect(result.kind).toBe('created');
    expect(result.observation.source).toBe('DEVICE');
  });

  it('rejects missing sourceEventId', () => {
    const { device } = registerDeviceForFirstBus();
    expect(() => ingestObservation(device, validPayload({ sourceEventId: undefined }))).toThrow(TelemetryValidationError);
  });

  it('rejects missing/invalid occurredAt', () => {
    const { device } = registerDeviceForFirstBus();
    expect(() => ingestObservation(device, validPayload({ occurredAt: undefined }))).toThrow(TelemetryValidationError);
    expect(() => ingestObservation(device, validPayload({ occurredAt: 'not-a-date' }))).toThrow(TelemetryValidationError);
  });

  it('rejects out-of-range latitude/longitude', () => {
    const { device } = registerDeviceForFirstBus();
    expect(() => ingestObservation(device, validPayload({ latitude: 200 }))).toThrow(TelemetryValidationError);
    expect(() => ingestObservation(device, validPayload({ latitude: -91 }))).toThrow(TelemetryValidationError);
    expect(() => ingestObservation(device, validPayload({ longitude: -300 }))).toThrow(TelemetryValidationError);
    expect(() => ingestObservation(device, validPayload({ longitude: 181 }))).toThrow(TelemetryValidationError);
  });

  it('rejects negative speed', () => {
    const { device } = registerDeviceForFirstBus();
    expect(() => ingestObservation(device, validPayload({ speedKmh: -10 }))).toThrow(TelemetryValidationError);
  });

  it('rejects heading outside [0,360)', () => {
    const { device } = registerDeviceForFirstBus();
    expect(() => ingestObservation(device, validPayload({ heading: 500 }))).toThrow(TelemetryValidationError);
    expect(() => ingestObservation(device, validPayload({ heading: 360 }))).toThrow(TelemetryValidationError);
    expect(() => ingestObservation(device, validPayload({ heading: -1 }))).toThrow(TelemetryValidationError);
  });

  it('rejects non-positive accuracy', () => {
    const { device } = registerDeviceForFirstBus();
    expect(() => ingestObservation(device, validPayload({ accuracyMeters: 0 }))).toThrow(TelemetryValidationError);
    expect(() => ingestObservation(device, validPayload({ accuracyMeters: -5 }))).toThrow(TelemetryValidationError);
  });

  it('rejects a far-future timestamp beyond FUTURE_TOLERANCE_MS, without persisting anything', () => {
    const { device } = registerDeviceForFirstBus();
    const futureIso = new Date(Date.now() + FUTURE_TOLERANCE_MS + 60_000).toISOString();
    const evtId = `evt-${crypto.randomUUID()}`;
    expect(() => ingestObservation(device, validPayload({ sourceEventId: evtId, occurredAt: futureIso }))).toThrow(TelemetryValidationError);
    expect(telemetryObservationRepository.findByDeviceAndSourceEventId(device.id, evtId)).toBeUndefined();
  });

  it('accepts a genuinely old/late observation (spec §20 — late is not the same as invalid)', () => {
    const { device } = registerDeviceForFirstBus();
    const oldIso = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days old
    const result = ingestObservation(device, validPayload({ occurredAt: oldIso }));
    expect(result.kind).toBe('created');
    expect(result.observation.occurredAt.toISOString()).toBe(oldIso);
  });

  it('the server ignores/overrides any client-submitted receivedAt — it is always server "now" (spec §4/§67, AC-10)', () => {
    const { device } = registerDeviceForFirstBus();
    const fakeReceivedAt = '1999-01-01T00:00:00.000Z';
    const before = Date.now();
    // The field is not part of TelemetryIngestionPayload — sent anyway (as an untyped extra) to prove the server ignores it.
    const result = ingestObservation(device, validPayload({ receivedAt: fakeReceivedAt }));
    const after = Date.now();
    expect(result.observation.receivedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.observation.receivedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it('source is always server-derived from the authenticated device — never client-controlled (AC-11)', () => {
    const { device } = registerDeviceForFirstBus();
    const result = ingestObservation(device, validPayload({ source: 'GPS_PROVIDER' }));
    expect(result.observation.source).toBe('DEVICE'); // matches the registered device's real providerType, not the injected claim
  });

  it('eventType is always server-determined — GPS_LOCATION_RECEIVED, never client input (AC-12)', () => {
    const { device } = registerDeviceForFirstBus();
    const result = ingestObservation(device, validPayload({ eventType: 'ACTION_STARTED' }));
    const stored = telemetryObservationRepository.findByDeviceAndSourceEventId(device.id, result.observation.sourceEventId)!;
    expect(stored.eventType).toBe('GPS_LOCATION_RECEIVED');
  });
});

describe('TelemetryIngestionService — correlation (spec §7/§8/§51/§52/§53/§54, AC-13..15)', () => {
  it('resolves busId from the authenticated device — a matching claim is accepted', () => {
    const { device, busId } = registerDeviceForFirstBus();
    const result = ingestObservation(device, validPayload({ busId }));
    expect(result.observation.busId).toBe(busId);
  });

  it('rejects a busId claim that does not match the device — no mutation (spec §54/§55)', () => {
    const { device } = registerDeviceForFirstBus();
    const otherBus = busRepository.findAll().find((b) => b.id !== device.busId)!;
    const evtId = `evt-${crypto.randomUUID()}`;
    expect(() => ingestObservation(device, validPayload({ sourceEventId: evtId, busId: otherBus.id }))).toThrow(TelemetryCorrelationError);
    expect(telemetryObservationRepository.findByDeviceAndSourceEventId(device.id, evtId)).toBeUndefined();
  });

  it('rejects an unknown tripId — never creates a trip (spec §53)', () => {
    const { device } = registerDeviceForFirstBus();
    expect(() => ingestObservation(device, validPayload({ tripId: 'not-a-real-trip-id' }))).toThrow(TelemetryNotFoundError);
  });

  it('rejects a tripId that belongs to a different bus (spec §54/§56)', () => {
    const { device, busId } = registerDeviceForFirstBus();
    const otherTrip = tripRepository.findAll().find((t) => t.busId !== busId)!;
    expect(() => ingestObservation(device, validPayload({ tripId: otherTrip.id }))).toThrow(TelemetryCorrelationError);
  });

  it('accepts a tripId that genuinely belongs to the device\'s bus', () => {
    const { device, tripId } = registerDeviceForFirstBus();
    const result = ingestObservation(device, validPayload({ tripId }));
    expect(result.observation.tripId).toBe(tripId);
  });

  it('when no tripId is supplied, resolves the bus\'s active trip server-side (spec §8/§51)', () => {
    const { device, tripId } = registerDeviceForFirstBus();
    const result = ingestObservation(device, validPayload());
    expect(result.observation.tripId).toBe(tripId); // the seeded trip for this bus is 'active'
  });

  it('accepts bus-only telemetry (tripId null) when the bus has no active trip', () => {
    const spareBus = busRepository.findAll().find((b) => tripRepository.findByBusId(b.id).every((t) => t.status !== 'active'))!;
    const { device } = registerDevice(spareBus.id, 'TEST DEVICE — spare bus', 'DEVICE');
    const result = ingestObservation({ id: device.id, busId: device.busId, providerType: 'DEVICE' }, validPayload());
    expect(result.observation.tripId).toBeNull();
  });
});

describe('TelemetryIngestionService — idempotency, conflict, ordering (spec §22/§23/§24/§57..61, AC-16..21)', () => {
  it('duplicate exact submission is idempotent — one row, same content (AC-17/AC-18)', () => {
    const { device } = registerDeviceForFirstBus();
    const payload = validPayload();
    const first = ingestObservation(device, payload);
    expect(first.kind).toBe('created');
    const second = ingestObservation(device, payload);
    expect(second.kind).toBe('duplicate');
    expect(second.observation.observationId).toBe(first.observation.observationId);

    const rows = telemetryObservationRepository.findFiltered({ busId: device.busId, limit: 500 });
    expect(rows.filter((r) => r.sourceEventId === payload.sourceEventId).length).toBe(1); // exactly one row
  });

  it('conflicting duplicate (same sourceEventId, different coordinates) is rejected and never overwrites the original (AC-19)', () => {
    const { device } = registerDeviceForFirstBus();
    const sourceEventId = `evt-${crypto.randomUUID()}`;
    ingestObservation(device, validPayload({ sourceEventId, latitude: 23.6 }));

    expect(() => ingestObservation(device, validPayload({ sourceEventId, latitude: 23.7 }))).toThrow(TelemetryConflictError);

    const stored = telemetryObservationRepository.findByDeviceAndSourceEventId(device.id, sourceEventId)!;
    expect(stored.latitude).toBe(23.6); // unchanged
  });

  it('concurrent duplicate submissions produce exactly one persisted observation (spec §58, AC-20)', async () => {
    const { device } = registerDeviceForFirstBus();
    const payload = validPayload();

    const results = await Promise.allSettled([
      Promise.resolve().then(() => ingestObservation(device, payload)),
      Promise.resolve().then(() => ingestObservation(device, payload)),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true); // both succeed — one created, one idempotent-duplicate

    const rows = telemetryObservationRepository.findFiltered({ busId: device.busId, limit: 500 });
    expect(rows.filter((r) => r.sourceEventId === payload.sourceEventId).length).toBe(1);
  });

  it('out-of-order sequence numbers are both accepted and persisted independently (spec §21/§60, AC-21)', () => {
    const { device } = registerDeviceForFirstBus();
    const r2 = ingestObservation(device, validPayload({ sequence: 2 }));
    const r1 = ingestObservation(device, validPayload({ sequence: 1 }));
    expect(r2.kind).toBe('created');
    expect(r1.kind).toBe('created');
    expect(r1.observation.observationId).not.toBe(r2.observation.observationId);
  });

  it('a late-arriving observation (older occurredAt than one already stored) is accepted, not merged or overwritten (spec §61)', () => {
    const { device } = registerDeviceForFirstBus();
    const now = Date.now();
    const recent = ingestObservation(device, validPayload({ occurredAt: new Date(now).toISOString() }));
    const late = ingestObservation(device, validPayload({ occurredAt: new Date(now - 10 * 60_000).toISOString() }));
    expect(recent.kind).toBe('created');
    expect(late.kind).toBe('created');
    expect(late.observation.occurredAt.getTime()).toBeLessThan(recent.observation.occurredAt.getTime());
    // receivedAt reflects real ingestion order regardless of occurredAt (spec §4/§21).
    expect(late.observation.receivedAt.getTime()).toBeGreaterThanOrEqual(recent.observation.receivedAt.getTime());
  });
});

describe('MANDATORY: telemetry ingestion never mutates operational state (spec §34/§35/§36, AC-27..33)', () => {
  it('Journey/Student/Trip/Bus/Route/Recommendation/Approval state is unchanged after 100 valid observations', () => {
    const { device, busId, tripId } = registerDeviceForFirstBus();
    const trip = tripRepository.findById(tripId)!;
    const bus = busRepository.findById(busId)!;
    const route = routeRepository.findById(trip.routeId)!;
    const student = studentRepository.findByBusId(busId)[0];
    const journeysBefore = journeyRepository.findByTripId(tripId);
    const studentsBefore = studentRepository.findByBusId(busId);
    const recCountBefore = recommendationRepository.findAll().length;

    for (let i = 0; i < 100; i++) {
      ingestObservation(device, validPayload({ latitude: 23.6 + i * 0.0001 }));
    }

    expect(tripRepository.findById(tripId)).toEqual(trip);
    const busAfter = busRepository.findById(busId)!;
    expect(busAfter).toEqual(bus); // includes currentLat/currentLng/speedKmh — untouched (spec §36/§37, AC-30)
    expect(routeRepository.findById(trip.routeId)).toEqual(route);
    expect(journeyRepository.findByTripId(tripId)).toEqual(journeysBefore);
    expect(studentRepository.findByBusId(busId)).toEqual(studentsBefore);
    expect(studentRepository.findById(student.id)).toBeTruthy();
    expect(recommendationRepository.findAll().length).toBe(recCountBefore);
  });
});

describe('MANDATORY: telemetry does not pollute audit_logs, OperationsFeed, or JourneyTimeline (spec §30/§32/§33, AC-24..26)', () => {
  it('audit_logs row count unchanged after many observations', () => {
    const { device } = registerDeviceForFirstBus();
    const before = auditRepository.findAll().length;
    for (let i = 0; i < 50; i++) ingestObservation(device, validPayload());
    expect(auditRepository.findAll().length).toBe(before);
  });

  it('OperationsFeed output unaffected by telemetry ingestion on the same trip', () => {
    const { device, tripId } = registerDeviceForFirstBus();
    const before = listOperationsEvents({ tripId });
    for (let i = 0; i < 50; i++) ingestObservation(device, validPayload());
    expect(listOperationsEvents({ tripId })).toEqual(before);
  });

  it('an existing Journey timeline on the same trip is unaffected by telemetry', () => {
    const { device, tripId, busId } = registerDeviceForFirstBus();
    const student = studentRepository.findByBusId(busId)[0];
    const journey = createJourney(student.id, tripId, { actorId: null, actorType: 'system' });
    const before = getJourneyTimeline(journey.id);
    for (let i = 0; i < 50; i++) ingestObservation(device, validPayload());
    expect(getJourneyTimeline(journey.id)).toEqual(before);
  });
});

describe('Simulation -> ingestion compatibility (spec §97) — no unnecessary self-HTTP, shared normalization only', () => {
  beforeEach(() => resetAllGpsSimulations());

  it('a real GpsSimulationEngine observation is field-compatible with the ingestion boundary\'s own accepted shape', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const session = startGpsSimulation(trip.id, 'admin-test', { speedProfile: 'NORMAL', tickSeconds: 5 });
    const simObservation = advanceGpsSimulation(session.id);

    // Not routed through HTTP or the ingestion service (the simulator stays
    // source=SIMULATION, which is never a registrable device — spec §42) —
    // this proves the two producers share the same TelemetryObservation
    // field shape (spec §3/§97), not that the simulator is ingested.
    expect(simObservation.source).toBe('SIMULATION');
    expect(typeof simObservation.sourceEventId).toBe('string');
    expect(simObservation.latitude).toBeGreaterThanOrEqual(-90);
    expect(simObservation.latitude).toBeLessThanOrEqual(90);
    expect(simObservation.longitude).toBeGreaterThanOrEqual(-180);
    expect(simObservation.longitude).toBeLessThanOrEqual(180);
    expect(simObservation.occurredAt instanceof Date || typeof simObservation.occurredAt === 'string').toBe(true);
  });
});
