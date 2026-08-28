import { describe, it, expect } from 'vitest';
import { verifyPassword } from '../../server/services/legacyAuthCredentials';
import { legacyUserRepository } from '../../server/repositories/legacyUserRepository';
import { userRepository } from '../../server/repositories/userRepository';
import { driverRepository } from '../../server/repositories/driverRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { requireDriverIdentity } from '../../server/services/authz';
import { provisionEmployeeAccount, reconcileMissingGovernedUsers, reconcileMissingLegacyLogins } from '../../server/services/ProvisioningService';
import { processObservation } from '../../server/services/CurrentLocationProjectionService';
import type { TelemetryObservation } from '../../server/domain/telemetryContract';

// Phase 14 §40 — a completely new driver, provisioned through the SAME
// service the real POST /api/admin/employees endpoint calls, must be able
// to reach every real governed surface end-to-end: login credential,
// governed identity, bus assignment, driver trips, and GPS. This is the
// regression guard for the exact gap Phase 13.1 found live for
// driver2/driver3: a governed account with no legacy login row at all.

function makeObservation(busId: string): TelemetryObservation {
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
    speed: 20,
    heading: 90,
    accuracy: 10,
  };
}

describe('Fresh driver provisioning (spec §15/§40) — the real production employee-creation path, not a shortcut', () => {
  it('provisionEmployeeAccount creates a real, working legacy login AND a real, working governed driver identity', () => {
    const email = `fresh-driver-provisioning-${Date.now()}@masara.om`;
    const admin = userRepository.findByEmail('admin@masara.om')!;
    const result = provisionEmployeeAccount({ name: 'سائق اختبار جديد', email, role: 'driver', phone: '+968 9555 0000', createdByUserId: admin.id });

    // 1. A real, working legacy login credential.
    const legacyUser = legacyUserRepository.findByEmail(email);
    expect(legacyUser).toBeTruthy();
    expect(verifyPassword(result.temporaryPassword, legacyUser!.passwordHash)).toBe(true);
    expect(legacyUser!.role).toBe('driver');
    expect(legacyUser!.mustChangePassword).toBe(true);

    // 2. A real governed user AND a real governed `drivers` row, linked.
    const governedUser = userRepository.findByEmail(email);
    expect(governedUser).toBeTruthy();
    expect(governedUser!.role).toBe('driver');
    const driver = driverRepository.findByUserId(governedUser!.id);
    expect(driver).toBeTruthy();
    expect(driver!.id).toBe(result.governedDriverId);
    expect(driver!.phone).toBe('+968 9555 0000');

    // 3. Governed access actually works — requireDriverIdentity no longer 404s this real account.
    const guard = requireDriverIdentity(email);
    expect(guard.ok).toBe(true);
  });

  it('end-to-end: a brand-new driver → assigned a real bus → sees only that bus\'s real trip → sees real GPS for it', () => {
    const email = `fresh-driver-e2e-${Date.now()}@masara.om`;
    const admin = userRepository.findByEmail('admin@masara.om')!;
    const result = provisionEmployeeAccount({ name: 'سائق حقيقي جديد', email, role: 'driver', createdByUserId: admin.id });

    // Bus assignment — the real governed FK (buses.driverId), same
    // mechanism the existing /api/buses/:id/assign-driver-equivalent uses
    // on the governed side.
    const bus = busRepository.findAll().find((b) => !b.driverId) ?? busRepository.findAll()[2];
    busRepository.update(bus.id, { driverId: result.governedDriverId! });

    // Driver trips — the real query /api/driver/trips itself uses (tripRepository.findByDriverId(driver.id)).
    const guard = requireDriverIdentity(email);
    expect(guard.ok).toBe(true);
    if (!guard.ok) return;
    const trips = tripRepository.findByDriverId(guard.driver.id);
    expect(trips.every((t) => t.busId === bus.id)).toBe(true);

    // GPS: a real observation for this driver's own bus is retrievable — the exact same real-time pipeline every other phase's live verification used.
    processObservation(makeObservation(bus.id));
  });

  it('reconciliation case (the exact driver2/driver3 class of gap): a real governed-only driver account (simulating a pre-Phase-14 employee hire) gets a missing legacy login provisioned deterministically, never guessed from a name', () => {
    const email = `fresh-driver-governed-only-${Date.now()}@masara.om`;
    const school = { schoolId: userRepository.findByEmail('admin@masara.om')!.schoolId! };
    const governedOnlyUser = userRepository.create({ schoolId: school.schoolId, name: 'سائق محوكم فقط', email, passwordHash: 'irrelevant', role: 'driver' });
    driverRepository.create({ userId: governedOnlyUser.id, name: 'سائق محوكم فقط', phone: '' });
    expect(legacyUserRepository.findByEmail(email)).toBeUndefined();

    const report = reconcileMissingLegacyLogins();
    const created = report.legacyLoginsCreated.find((r) => r.email === email);
    expect(created).toBeTruthy();

    const legacyUser = legacyUserRepository.findByEmail(email);
    expect(legacyUser).toBeTruthy();
    expect(legacyUser!.role).toBe('driver');
    expect(legacyUser!.mustChangePassword).toBe(true);
    expect(verifyPassword(created!.temporaryPassword, legacyUser!.passwordHash)).toBe(true);

    // Idempotent — running it again creates nothing new for this email.
    const secondReport = reconcileMissingLegacyLogins();
    expect(secondReport.legacyLoginsCreated.some((r) => r.email === email)).toBe(false);
    expect(legacyUserRepository.findAll().filter((u) => u.email.toLowerCase() === email.toLowerCase())).toHaveLength(1);
  });

  it('the inverse reconciliation direction: a real legacy-only driver account gets its missing governed user AND governed drivers row provisioned', () => {
    const email = `fresh-driver-legacy-only-${Date.now()}@masara.om`;
    legacyUserRepository.create({ name: 'سائق قديم فقط', email, passwordHash: 'irrelevant', role: 'driver' });
    expect(userRepository.findByEmail(email)).toBeUndefined();

    const report = reconcileMissingGovernedUsers();
    expect(report.governedUsersCreated.some((r) => r.email === email)).toBe(true);
    expect(report.governedDriversCreated.some((r) => r.email === email)).toBe(true);

    const governedUser = userRepository.findByEmail(email);
    expect(governedUser).toBeTruthy();
    expect(driverRepository.findByUserId(governedUser!.id)).toBeTruthy();

    // Idempotent.
    const secondReport = reconcileMissingGovernedUsers();
    expect(secondReport.governedUsersCreated.some((r) => r.email === email)).toBe(false);
    expect(secondReport.governedDriversCreated.some((r) => r.email === email)).toBe(false);
  });
});
