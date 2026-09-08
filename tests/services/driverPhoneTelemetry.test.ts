import { describe, it, expect } from 'vitest';
import {
  ingestDriverPhoneObservation,
  TelemetryValidationError,
  TelemetryNotFoundError,
  TelemetryCorrelationError,
} from '../../server/services/TelemetryIngestionService';
import { getOrCreateDriverPhoneDevice, registerDevice } from '../../server/services/TelemetryDeviceService';
import { telemetryDeviceRepository } from '../../server/repositories/telemetryDeviceRepository';
import { telemetryObservationRepository } from '../../server/repositories/telemetryObservationRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { getCurrentLocation } from '../../server/services/CurrentLocationProjectionService';

// Real-pilot GPS without dedicated hardware: a driver's own phone becomes
// just another authenticated telemetry producer, funneled through the
// exact same ingestObservation pipeline every device/GPS-provider already
// uses. These tests cover the two things genuinely new here — ownership
// verification (never trust a client-claimed tripId) and idempotent
// device provisioning (never a second DRIVER_PHONE row per bus) — not the
// coordinate/timestamp validation already covered exhaustively in
// telemetryIngestionService.test.ts, which this path reuses unchanged.

function realTripWithDriver() {
  const trip = tripRepository.findAll().find((t) => t.driverId);
  if (!trip) throw new Error('no seeded trip with a driver — fixture assumption broken');
  return trip;
}

function validPayload(tripId: string, overrides: Record<string, unknown> = {}) {
  return {
    tripId,
    sourceEventId: `phone-evt-${crypto.randomUUID()}`,
    latitude: 23.59,
    longitude: 58.38,
    speedKmh: 25,
    heading: 120,
    accuracyMeters: 12,
    ...overrides,
  };
}

describe('ingestDriverPhoneObservation — driver-phone GPS sharing (real pilot, no hardware device)', () => {
  it('accepts a valid submission for a trip the driver genuinely owns, tagged with source DRIVER_PHONE', () => {
    const trip = realTripWithDriver();
    const result = ingestDriverPhoneObservation(trip.driverId!, validPayload(trip.id));
    expect(result.kind).toBe('created');
    expect(result.observation.source).toBe('DRIVER_PHONE');
    expect(result.observation.tripId).toBe(trip.id);
    expect(result.observation.busId).toBe(trip.busId);
  });

  it('rejects a tripId that does not belong to this driver — never trusts the client claim', () => {
    const trip = realTripWithDriver();
    const someoneElsesDriverId = 'not-this-trips-driver';
    expect(() => ingestDriverPhoneObservation(someoneElsesDriverId, validPayload(trip.id))).toThrow(TelemetryCorrelationError);
  });

  it('rejects a nonexistent tripId', () => {
    expect(() => ingestDriverPhoneObservation('any-driver', validPayload('no-such-trip'))).toThrow(TelemetryNotFoundError);
  });

  it('rejects a missing tripId', () => {
    const trip = realTripWithDriver();
    const payload = validPayload(trip.id, { tripId: undefined });
    expect(() => ingestDriverPhoneObservation(trip.driverId!, payload as never)).toThrow(TelemetryValidationError);
  });

  it('still enforces coordinate validation through this path (reuses the same pipeline, not a parallel one)', () => {
    const trip = realTripWithDriver();
    expect(() => ingestDriverPhoneObservation(trip.driverId!, validPayload(trip.id, { latitude: 200 }))).toThrow(TelemetryValidationError);
  });

  it('feeds the current-location projection exactly like any other producer', () => {
    const trip = realTripWithDriver();
    // An earlier test in this file already ingested an observation for
    // this same bus — SQLite's timestamp columns round to second
    // precision on read (a documented, recurring gotcha in this codebase,
    // see TelemetryIngestionService.ts's isSamePayload comment), so two
    // calls made within the same wall-clock second can tie. An explicit,
    // unambiguously-later occurredAt avoids depending on that timing.
    const occurredAt = new Date(Date.now() + 60_000).toISOString();
    ingestDriverPhoneObservation(trip.driverId!, validPayload(trip.id, { latitude: 23.5, longitude: 58.5, occurredAt }));
    const current = getCurrentLocation(trip.busId);
    expect(current).not.toBeNull();
    expect(current!.latitude).toBe(23.5);
    expect(current!.source).toBe('DRIVER_PHONE');
  });
});

describe('getOrCreateDriverPhoneDevice — idempotent per bus, never a second row', () => {
  it('creates exactly one DRIVER_PHONE device for a bus, reused on every later call', () => {
    // Other tests in this file share the same on-disk DB (reset per file,
    // not per test — see vitest.config.ts) and may have already created
    // this bus's driver-phone device, so the invariant checked here is
    // "still exactly one after N calls", never "started at zero".
    const trip = realTripWithDriver();

    const first = getOrCreateDriverPhoneDevice(trip.busId);
    const afterFirstCall = telemetryDeviceRepository.findByBusId(trip.busId).filter((d) => d.providerType === 'DRIVER_PHONE').length;

    const second = getOrCreateDriverPhoneDevice(trip.busId);
    const afterSecondCall = telemetryDeviceRepository.findByBusId(trip.busId).filter((d) => d.providerType === 'DRIVER_PHONE').length;

    expect(second.id).toBe(first.id);
    expect(afterSecondCall).toBe(afterFirstCall);
  });

  it('never exposes a secret for a driver-phone device the way a real hardware device registration does', () => {
    const trip = realTripWithDriver();
    const device = getOrCreateDriverPhoneDevice(trip.busId);
    expect(device).not.toHaveProperty('secret');
    expect(device).not.toHaveProperty('secretHash');
  });
});

describe('registerDevice — DRIVER_PHONE is a valid provider type, still rejects invented ones', () => {
  it('accepts DRIVER_PHONE explicitly', () => {
    const trip = realTripWithDriver();
    const { device } = registerDevice(trip.busId, 'test phone device', 'DRIVER_PHONE');
    expect(device.providerType).toBe('DRIVER_PHONE');
  });

  it('still rejects an invented provider type (e.g. the simulator masquerading as a device)', () => {
    const trip = realTripWithDriver();
    expect(() => registerDevice(trip.busId, 'fake', 'SIMULATION' as never)).toThrow();
  });
});
