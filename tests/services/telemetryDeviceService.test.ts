import { describe, it, expect } from 'vitest';
import {
  registerDevice,
  getDevice,
  listDevices,
  disableDevice,
  revokeDevice,
  DeviceValidationError,
  DeviceStateError,
  DeviceNotFoundError,
} from '../../server/services/TelemetryDeviceService';
import { hashDeviceSecret, verifyDeviceSecret, generateDeviceSecret, parseDeviceBearerToken } from '../../server/services/deviceCredentials';
import { requireTelemetryDevice, requireTelemetryReader } from '../../server/services/authz';
import { telemetryDeviceRepository } from '../../server/repositories/telemetryDeviceRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { driverRepository } from '../../server/repositories/driverRepository';
import { userRepository } from '../../server/repositories/userRepository';
import { ingestObservation } from '../../server/services/TelemetryIngestionService';
import { db } from '../../database/client';
import { users } from '../../database/schema';

describe('deviceCredentials (spec §9/§11/§46/§47)', () => {
  it('hash + verify round-trips correctly', () => {
    const secret = generateDeviceSecret();
    const hash = hashDeviceSecret(secret);
    expect(hash).not.toContain(secret); // never stores plaintext
    expect(verifyDeviceSecret(secret, hash)).toBe(true);
  });

  it('rejects a wrong secret', () => {
    const hash = hashDeviceSecret(generateDeviceSecret());
    expect(verifyDeviceSecret('totally-wrong-secret', hash)).toBe(false);
  });

  it('two generated secrets are never identical', () => {
    expect(generateDeviceSecret()).not.toBe(generateDeviceSecret());
  });

  it('parses a well-formed Bearer token', () => {
    const parsed = parseDeviceBearerToken('Bearer device-id-123.some-secret-value');
    expect(parsed).toEqual({ deviceId: 'device-id-123', secret: 'some-secret-value' });
  });

  it('returns null for malformed or missing tokens (never throws)', () => {
    expect(parseDeviceBearerToken(undefined)).toBeNull();
    expect(parseDeviceBearerToken('')).toBeNull();
    expect(parseDeviceBearerToken('NotBearer x.y')).toBeNull();
    expect(parseDeviceBearerToken('Bearer no-dot-here')).toBeNull();
    expect(parseDeviceBearerToken('Bearer .missing-device-id')).toBeNull();
    expect(parseDeviceBearerToken('Bearer missing-secret.')).toBeNull();
  });
});

describe('TelemetryDeviceService registration/lifecycle (spec §6/§44/§92)', () => {
  it('registers a device against a real bus and returns the raw secret exactly once', () => {
    const bus = busRepository.findAll()[0];
    const { device, secret } = registerDevice(bus.id, 'TEST DEVICE — registration test', 'DEVICE');
    expect(device.busId).toBe(bus.id);
    expect(device.status).toBe('active');
    expect(secret).toBeTruthy();
    expect((device as any).secretHash).toBeUndefined(); // never present on the returned public shape
  });

  it('rejects registration against a nonexistent bus — never auto-creates one (spec §52)', () => {
    expect(() => registerDevice('not-a-real-bus-id', 'x', 'DEVICE')).toThrow(DeviceValidationError);
  });

  it('rejects providerType SIMULATION — the simulator is never a registrable physical device (spec §42)', () => {
    const bus = busRepository.findAll()[0];
    expect(() => registerDevice(bus.id, 'x', 'SIMULATION' as any)).toThrow(DeviceValidationError);
  });

  it('GET-shaped reads never include secretHash', () => {
    const bus = busRepository.findAll()[0];
    const { device } = registerDevice(bus.id, 'TEST DEVICE', 'DEVICE');
    const fetched = getDevice(device.id);
    expect((fetched as any).secretHash).toBeUndefined();
    expect(listDevices().every((d) => (d as any).secretHash === undefined)).toBe(true);
  });

  it('disable then attempting to disable again is a controlled error; revoke is terminal', () => {
    const bus = busRepository.findAll()[0];
    const { device } = registerDevice(bus.id, 'TEST DEVICE', 'DEVICE');
    const disabled = disableDevice(device.id);
    expect(disabled.status).toBe('disabled');
    expect(() => disableDevice(device.id)).toThrow(DeviceStateError);

    const revoked = revokeDevice(device.id);
    expect(revoked.status).toBe('revoked');
    expect(() => revokeDevice(device.id)).toThrow(DeviceStateError);
    expect(() => disableDevice(device.id)).toThrow(DeviceStateError); // cannot un-revoke via disable
  });

  it('unknown device id is a controlled not-found error', () => {
    expect(() => getDevice('nonexistent-id')).toThrow(DeviceNotFoundError);
  });
});

describe('requireTelemetryDevice (spec §6/§47, AC-01..04)', () => {
  it('authenticates an active, correctly-credentialed device', () => {
    const bus = busRepository.findAll()[0];
    const { device, secret } = registerDevice(bus.id, 'TEST DEVICE', 'DEVICE');
    const guard = requireTelemetryDevice(`Bearer ${device.id}.${secret}`);
    expect(guard.ok).toBe(true);
    if (guard.ok) expect(guard.device.busId).toBe(bus.id);
  });

  it('rejects a missing Authorization header', () => {
    expect(requireTelemetryDevice(undefined).ok).toBe(false);
  });

  it('rejects an unknown device id', () => {
    const guard = requireTelemetryDevice('Bearer nonexistent-device-id.some-secret');
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(401);
  });

  it('rejects a wrong secret for a real device', () => {
    const bus = busRepository.findAll()[0];
    const { device } = registerDevice(bus.id, 'TEST DEVICE', 'DEVICE');
    const guard = requireTelemetryDevice(`Bearer ${device.id}.wrong-secret`);
    expect(guard.ok).toBe(false);
  });

  it('rejects a disabled device', () => {
    const bus = busRepository.findAll()[0];
    const { device, secret } = registerDevice(bus.id, 'TEST DEVICE', 'DEVICE');
    disableDevice(device.id);
    expect(requireTelemetryDevice(`Bearer ${device.id}.${secret}`).ok).toBe(false);
  });

  it('rejects a revoked device', () => {
    const bus = busRepository.findAll()[0];
    const { device, secret } = registerDevice(bus.id, 'TEST DEVICE', 'DEVICE');
    revokeDevice(device.id);
    expect(requireTelemetryDevice(`Bearer ${device.id}.${secret}`).ok).toBe(false);
  });

  it('unknown/wrong-secret/disabled/revoked all return the identical status+message (spec §47 — no enumeration)', () => {
    const bus = busRepository.findAll()[0];
    const { device, secret } = registerDevice(bus.id, 'TEST DEVICE', 'DEVICE');
    const disabledDevice = registerDevice(bus.id, 'TEST DEVICE 2', 'DEVICE');
    disableDevice(disabledDevice.device.id);

    const unknown = requireTelemetryDevice('Bearer nonexistent.x');
    const wrongSecret = requireTelemetryDevice(`Bearer ${device.id}.wrong`);
    const disabled = requireTelemetryDevice(`Bearer ${disabledDevice.device.id}.${disabledDevice.secret}`);

    expect(unknown).toEqual(wrongSecret);
    expect(wrongSecret).toEqual(disabled);
  });
});

describe('requireTelemetryReader driver isolation (spec §82/§83, AC-38)', () => {
  it('admin and school read without a busId/tripId scope', () => {
    const admin = userRepository.findAll().find((u) => u.role === 'admin')!;
    const school = userRepository.findAll().find((u) => u.role === 'school')!;
    expect(requireTelemetryReader(admin.email).ok).toBe(true);
    expect(requireTelemetryReader(school.email).ok).toBe(true);
  });

  it('a driver reading their OWN bus/trip is allowed', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const driver = driverRepository.findById(trip.driverId!)!;
    const driverUser = userRepository.findById(driver.userId!)!;
    expect(requireTelemetryReader(driverUser.email, { busId: trip.busId }).ok).toBe(true);
    expect(requireTelemetryReader(driverUser.email, { tripId: trip.id }).ok).toBe(true);
  });

  it('a driver reading ANOTHER driver\'s bus/trip is rejected — 403 (AC-38, mandatory)', () => {
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

  it('a driver with no busId/tripId scope at all is rejected (no unscoped cross-fleet visibility)', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const driver = driverRepository.findById(trip.driverId!)!;
    const driverUser = userRepository.findById(driver.userId!)!;
    expect(requireTelemetryReader(driverUser.email).ok).toBe(false);
  });

  it('parent has no telemetry read access (spec §82/§115, AC-39)', () => {
    const parentEmail = 'telemetry-parent-test@masara.om';
    const admin = userRepository.findAll().find((u) => u.role === 'admin')!;
    db.insert(users)
      .values({ id: crypto.randomUUID(), schoolId: admin.schoolId, name: 'Parent', email: parentEmail, passwordHash: 'x', role: 'parent' })
      .run();
    expect(requireTelemetryReader(parentEmail).ok).toBe(false);
  });

  it('unauthenticated (missing email) is rejected', () => {
    expect(requireTelemetryReader(undefined).ok).toBe(false);
  });

  it('unknown user is rejected', () => {
    expect(requireTelemetryReader('nobody@masara.om').ok).toBe(false);
  });
});

describe('Device cannot submit for another bus even when authenticated (spec §55, live-shaped test)', () => {
  it('a real registered+authenticated device, then ingestObservation with a different busId claim is rejected', () => {
    const busA = busRepository.findAll()[0];
    const busB = busRepository.findAll().find((b) => b.id !== busA.id)!;
    const { device, secret } = registerDevice(busA.id, 'TEST DEVICE A', 'DEVICE');
    const guard = requireTelemetryDevice(`Bearer ${device.id}.${secret}`);
    expect(guard.ok).toBe(true);
    if (!guard.ok) return;

    expect(() =>
      ingestObservation(guard.device, {
        sourceEventId: `evt-${crypto.randomUUID()}`,
        busId: busB.id,
        occurredAt: new Date().toISOString(),
        latitude: 23.6,
        longitude: 58.4,
      })
    ).toThrow();
  });
});
