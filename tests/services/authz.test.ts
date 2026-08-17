import { describe, it, expect, beforeAll } from 'vitest';
import { requireOperationalUser, requireJourneyActor, requireJourneyReader, requireDriverIdentity } from '../../server/services/authz';
import { userRepository } from '../../server/repositories/userRepository';
import { driverRepository } from '../../server/repositories/driverRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { db } from '../../database/client';
import { users } from '../../database/schema';

describe('requireOperationalUser (shared authz guard, spec Phase 2B §16/§43)', () => {
  it('allows an admin', () => {
    const admin = userRepository.findAll().find((u) => u.role === 'admin')!;
    const guard = requireOperationalUser(admin.email);
    expect(guard.ok).toBe(true);
  });

  it('allows a school operator', () => {
    const school = userRepository.findAll().find((u) => u.role === 'school')!;
    const guard = requireOperationalUser(school.email);
    expect(guard.ok).toBe(true);
  });

  it('rejects a driver — 403', () => {
    const driver = userRepository.findAll().find((u) => u.role === 'driver')!;
    const guard = requireOperationalUser(driver.email);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(403);
  });

  it('rejects a missing email — 400', () => {
    const guard = requireOperationalUser(undefined);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(400);
  });

  it('rejects an unknown email — 404', () => {
    const guard = requireOperationalUser('nobody@masara.om');
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(404);
  });
});

// Phase 3A — a throwaway parent user, inserted directly (no seeded parent
// exists in the governed `users` table — Phase 1's seed only created
// admin/school/driver accounts there). Self-contained to this file; the next
// test file gets a fresh database per tests/setup.ts, so this leaves nothing behind.
let parentEmail: string;

beforeAll(() => {
  parentEmail = 'parent-authz-test@masara.om';
  const admin = userRepository.findAll().find((u) => u.role === 'admin')!;
  db.insert(users)
    .values({
      id: crypto.randomUUID(),
      schoolId: admin.schoolId,
      name: 'Parent Authz Test',
      email: parentEmail,
      passwordHash: 'not-a-real-hash',
      role: 'parent',
    })
    .run();
});

describe('requireJourneyActor (spec Phase 3A §19/§20/§21, AC-15/16)', () => {
  it('allows admin for any trip', () => {
    const admin = userRepository.findAll().find((u) => u.role === 'admin')!;
    const trip = tripRepository.findAll()[0];
    const guard = requireJourneyActor(admin.email, trip.id);
    expect(guard.ok).toBe(true);
    if (guard.ok) expect(guard.actorType).toBe('admin');
  });

  it('allows school for any trip', () => {
    const school = userRepository.findAll().find((u) => u.role === 'school')!;
    const trip = tripRepository.findAll()[0];
    const guard = requireJourneyActor(school.email, trip.id);
    expect(guard.ok).toBe(true);
    if (guard.ok) expect(guard.actorType).toBe('school');
  });

  it('allows a driver assigned to the trip', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const driver = driverRepository.findById(trip.driverId!)!;
    const driverUser = userRepository.findById(driver.userId!)!;
    const guard = requireJourneyActor(driverUser.email, trip.id);
    expect(guard.ok).toBe(true);
    if (guard.ok) expect(guard.actorType).toBe('driver');
  });

  it('rejects a driver NOT assigned to this trip — 403, real end-to-end identity check (spec §19)', () => {
    const trips = tripRepository.findAll().filter((t) => t.driverId);
    const tripA = trips[0];
    const tripB = trips.find((t) => t.driverId !== tripA.driverId);
    expect(tripB).toBeTruthy(); // seed has >1 distinct driver

    const driverOfA = driverRepository.findById(tripA.driverId!)!;
    const userOfA = userRepository.findById(driverOfA.userId!)!;

    const guard = requireJourneyActor(userOfA.email, tripB!.id);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(403);
  });

  it('rejects a parent outright — no write path in Phase 3A (spec §21/AC-16)', () => {
    const trip = tripRepository.findAll()[0];
    const guard = requireJourneyActor(parentEmail, trip.id);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(403);
  });

  it('rejects a missing email — 400', () => {
    const trip = tripRepository.findAll()[0];
    const guard = requireJourneyActor(undefined, trip.id);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(400);
  });

  it('rejects an unknown email — 404', () => {
    const trip = tripRepository.findAll()[0];
    const guard = requireJourneyActor('nobody@masara.om', trip.id);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(404);
  });
});

describe('requireJourneyReader (spec §21/§49)', () => {
  it('allows admin, school, and driver to read', () => {
    const admin = userRepository.findAll().find((u) => u.role === 'admin')!;
    const school = userRepository.findAll().find((u) => u.role === 'school')!;
    const driver = userRepository.findAll().find((u) => u.role === 'driver')!;
    expect(requireJourneyReader(admin.email).ok).toBe(true);
    expect(requireJourneyReader(school.email).ok).toBe(true);
    expect(requireJourneyReader(driver.email).ok).toBe(true);
  });

  it('rejects a parent — no read access built in Phase 3A (spec §21/AC-16)', () => {
    const guard = requireJourneyReader(parentEmail);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(403);
  });
});

// Phase 3B §49 mandatory security tests — the read-side gap this phase closes:
// a driver could previously read ANY trip's roster/journeys by guessing a
// tripId, since requireJourneyReader only checked role, never trip ownership.
describe('requireJourneyReader trip-scoping (spec Phase 3B §17/§49 — mandatory security test)', () => {
  it('allows a driver to read data scoped to their OWN trip', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const driver = driverRepository.findById(trip.driverId!)!;
    const driverUser = userRepository.findById(driver.userId!)!;
    const guard = requireJourneyReader(driverUser.email, trip.id);
    expect(guard.ok).toBe(true);
  });

  it('REJECTS a driver reading a trip assigned to a DIFFERENT driver — 403 (the core mandatory security case)', () => {
    const trips = tripRepository.findAll().filter((t) => t.driverId);
    const tripA = trips[0];
    const tripB = trips.find((t) => t.driverId !== tripA.driverId);
    expect(tripB).toBeTruthy();

    const driverOfA = driverRepository.findById(tripA.driverId!)!;
    const userOfA = userRepository.findById(driverOfA.userId!)!;

    const guard = requireJourneyReader(userOfA.email, tripB!.id);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(403);
  });

  it('admin and school stay unscoped — tripId does not restrict them', () => {
    const admin = userRepository.findAll().find((u) => u.role === 'admin')!;
    const school = userRepository.findAll().find((u) => u.role === 'school')!;
    const trip = tripRepository.findAll()[0];
    expect(requireJourneyReader(admin.email, trip.id).ok).toBe(true);
    expect(requireJourneyReader(school.email, trip.id).ok).toBe(true);
  });

  it('a driver with no governed driver record is rejected even with a tripId', () => {
    const trip = tripRepository.findAll()[0];
    const guard = requireJourneyReader(parentEmail, trip.id); // parent role already rejected before the trip check runs
    expect(guard.ok).toBe(false);
  });
});

describe('requireDriverIdentity (spec Phase 3B §40 — Driver Journey Console self-lookup, never a client-submitted driverId)', () => {
  it('resolves a driver to their own governed driver record', () => {
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const driver = driverRepository.findById(trip.driverId!)!;
    const driverUser = userRepository.findById(driver.userId!)!;
    const guard = requireDriverIdentity(driverUser.email);
    expect(guard.ok).toBe(true);
    if (guard.ok) expect(guard.driver.id).toBe(driver.id);
  });

  it('rejects admin — 403 (this endpoint is driver-only, not general operational access)', () => {
    const admin = userRepository.findAll().find((u) => u.role === 'admin')!;
    const guard = requireDriverIdentity(admin.email);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(403);
  });

  it('rejects school — 403', () => {
    const school = userRepository.findAll().find((u) => u.role === 'school')!;
    const guard = requireDriverIdentity(school.email);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(403);
  });

  it('rejects a parent — 403', () => {
    const guard = requireDriverIdentity(parentEmail);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(403);
  });

  it('rejects a missing email — 400', () => {
    const guard = requireDriverIdentity(undefined);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(400);
  });

  it('rejects an unknown email — 404', () => {
    const guard = requireDriverIdentity('nobody@masara.om');
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(404);
  });
});
