import { describe, it, expect, beforeEach } from 'vitest';
import { requireVerifiedEmail, requireTelemetryReader } from '../../server/services/authz';
import { createSession, clearAllSessions } from '../../server/services/legacySessionService';
import { legacyUserRepository } from '../../server/repositories/legacyUserRepository';
import { legacyBusRepository } from '../../server/repositories/legacyBusRepository';
import { userRepository } from '../../server/repositories/userRepository';
import { driverRepository } from '../../server/repositories/driverRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { busRepository } from '../../server/repositories/busRepository';

// Phase 12 — regression coverage for the driver/bus/GPS ID consistency issue
// traced (not guessed around) in this phase: DriverPortal.tsx's own-bus GPS
// panel used to pass the LEGACY `Bus.id` (e.g. "bus-101") straight into
// `requireTelemetryReader`'s ownership check, which looks up trips by the
// GOVERNED bus UUID — these are two different ID spaces that were never
// bridged for this one panel (School/Admin already bridge them correctly
// via `busNumber`). The result was a silently-masked 403 (the frontend
// treats any telemetry error identically to "no data yet"), confirmed via
// git history to predate this phase, not a regression it introduced.
//
// The fix (src/components/DriverPortal.tsx's new useOwnGovernedBusId hook):
// resolve the driver's own GOVERNED busId via GET /api/driver/trips (a route
// the driver is already authorized to call, requireDriverIdentity), matching
// on `busNumber` — the one field already confirmed identical across both
// stores — then use THAT id for the telemetry call. This test proves the
// chain the fix depends on actually holds for real seeded data: a driver's
// own governed trip's busId is precisely the id `requireTelemetryReader`
// will accept for that driver, and its busNumber matches a real legacy bus.

beforeEach(() => {
  clearAllSessions();
});

describe('Driver -> own trip -> governed busId -> GPS: the full chain a real driver session can traverse', () => {
  it('a real driver has at least one trip whose busId resolves to a real busNumber matching a real legacy bus', () => {
    const legacyDriver = legacyUserRepository.findAll().find((u) => u.role === 'driver');
    expect(legacyDriver, 'seed must include a legacy driver').toBeTruthy();

    const governedUser = userRepository.findByEmail(legacyDriver!.email);
    expect(governedUser, 'the legacy driver must also exist as a governed user (email-joined)').toBeTruthy();

    const governedDriver = driverRepository.findByUserId(governedUser!.id);
    expect(governedDriver, 'the governed user must have a driver record').toBeTruthy();

    const trips = tripRepository.findByDriverId(governedDriver!.id);
    expect(trips.length, 'the driver must have at least one real trip in the seed').toBeGreaterThan(0);

    const trip = trips[0];
    const governedBus = busRepository.findById(trip.busId);
    expect(governedBus, "the trip's busId must resolve to a real governed bus row").toBeTruthy();

    const legacyBus = legacyBusRepository.findAll().find((b) => b.busNumber === governedBus!.busNumber);
    expect(legacyBus, 'the governed bus busNumber must match a real legacy bus — the confirmed-safe bridge field').toBeTruthy();
  });

  it('requireTelemetryReader accepts the driver-scoped call using the GOVERNED busId resolved via their own trip — the exact call DriverPortal.tsx now makes', () => {
    const legacyDriver = legacyUserRepository.findAll().find((u) => u.role === 'driver')!;
    const session = createSession({ id: legacyDriver.id, email: legacyDriver.email, role: legacyDriver.role });
    const identity = requireVerifiedEmail(`Bearer ${session.token}`);
    expect(identity.ok).toBe(true);
    if (!identity.ok) return;

    const governedUser = userRepository.findByEmail(legacyDriver.email)!;
    const governedDriver = driverRepository.findByUserId(governedUser.id)!;
    const trip = tripRepository.findByDriverId(governedDriver.id)[0];

    // This is the fix under test: using the GOVERNED trip.busId (not the legacy Bus.id) succeeds.
    const correctGuard = requireTelemetryReader(identity.email, { busId: trip.busId });
    expect(correctGuard.ok).toBe(true);
  });

  it('confirms the ORIGINAL bug: requireTelemetryReader rejects the same driver when a LEGACY bus id is used instead of the governed one', () => {
    const legacyDriver = legacyUserRepository.findAll().find((u) => u.role === 'driver')!;
    const session = createSession({ id: legacyDriver.id, email: legacyDriver.email, role: legacyDriver.role });
    const identity = requireVerifiedEmail(`Bearer ${session.token}`);
    expect(identity.ok).toBe(true);
    if (!identity.ok) return;

    const legacyBus = legacyBusRepository.findAll()[0]; // e.g. 'bus-101' — a legacy-namespaced id, never a real governed uuid
    const wrongGuard = requireTelemetryReader(identity.email, { busId: legacyBus.id });
    expect(wrongGuard.ok).toBe(false); // documents why the old DriverPortal.tsx call silently 403'd
  });
});
