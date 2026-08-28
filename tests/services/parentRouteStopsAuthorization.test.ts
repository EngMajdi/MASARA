import { describe, it, expect } from 'vitest';
import { db } from '../../database/client';
import { students, users, legacyUsers, legacyStudents } from '../../database/schema';
import { userRepository } from '../../server/repositories/userRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { isRouteAuthorizedForParent } from '../../server/services/ParentAccessService';

// Phase 15 §9 — the parent-role 403 on GET /api/routes/:id/stops (flagged
// as a known pre-existing gap in the Phase 14 report) is fixed by scoping
// access to routes the parent's own real, authorized child actually has a
// trip on — never a blanket grant. This test exercises the real
// authorization function the route handler calls
// (server/routes/agentRoutes.ts), using the same real-fixture pattern
// established in Phase 13/13.1/14's own test files.

let counter = 0;
function createHouseholdOnBus(busId: string) {
  counter += 1;
  const admin = userRepository.findByEmail('admin@masara.om')!;
  const email = `route-stops-parent-${counter}-${Date.now()}@masara.om`;
  const legacyParentId = `test-route-stops-parent-${counter}`;
  const legacyStudentId = `test-route-stops-student-${counter}`;

  db.insert(legacyUsers).values({ id: legacyParentId, name: `Route Stops Parent ${counter}`, email, passwordHash: 'x', role: 'parent' }).run();
  db.insert(legacyStudents)
    .values({
      id: legacyStudentId,
      name: `طالب اختبار نقاط التوقف ${counter}`,
      grade: 'الأول',
      avatar: 'https://example.test/avatar.png',
      schoolId: admin.schoolId!,
      schoolName: 'test',
      parentId: legacyParentId,
      parentName: `Route Stops Parent ${counter}`,
      parentPhone: `+968 9700 ${String(counter).padStart(4, '0')}`,
      busId,
      busNumber: 'test',
      pickupLat: 23.6,
      pickupLng: 58.4,
      pickupAddress: 'test',
      pickupNameAr: 'test',
      pickupTimePlanned: '06:00',
      seatNumber: '01A',
    })
    .run();
  db.insert(students)
    .values({
      id: crypto.randomUUID(),
      schoolId: admin.schoolId!,
      name: `طالب اختبار نقاط التوقف ${counter}`,
      grade: 'الأول',
      busId,
      pickupLat: 23.6,
      pickupLng: 58.4,
      pickupAddress: 'test',
      legacyStudentId,
    })
    .run();
  db.insert(users).values({ id: crypto.randomUUID(), schoolId: admin.schoolId, name: `Route Stops Parent ${counter}`, email, passwordHash: 'x', role: 'parent' }).run();

  return userRepository.findByEmail(email)!;
}

describe('isRouteAuthorizedForParent (spec §9) — ownership-scoped, never a blanket grant', () => {
  it('a parent whose authorized child is on a bus with a trip on route R is authorized for route R', () => {
    const bus = busRepository.findAll()[0];
    const trip = tripRepository.findByBusId(bus.id)[0];
    const parent = createHouseholdOnBus(bus.id);
    expect(isRouteAuthorizedForParent(parent, trip.routeId)).toBe(true);
  });

  it('a parent whose child is on a DIFFERENT bus is NOT authorized for this route — never a broad grant', () => {
    const busA = busRepository.findAll()[0];
    const busB = busRepository.findAll()[1];
    const tripA = tripRepository.findByBusId(busA.id)[0];
    const parentOnBusB = createHouseholdOnBus(busB.id);
    expect(isRouteAuthorizedForParent(parentOnBusB, tripA.routeId)).toBe(false);
  });

  it('a parent with no children at all is never authorized for any route', () => {
    const admin = userRepository.findByEmail('admin@masara.om')!;
    const bus = busRepository.findAll()[0];
    const trip = tripRepository.findByBusId(bus.id)[0];
    expect(isRouteAuthorizedForParent(admin, trip.routeId)).toBe(false);
  });

  it('two parents on the same bus (siblings\' households) are each independently authorized for that one real route — no cross-leak of unrelated routes', () => {
    const busA = busRepository.findAll()[0];
    const busB = busRepository.findAll()[1];
    const tripA = tripRepository.findByBusId(busA.id)[0];
    const tripB = tripRepository.findByBusId(busB.id)[0];
    const parentA = createHouseholdOnBus(busA.id);
    const parentB = createHouseholdOnBus(busB.id);

    expect(isRouteAuthorizedForParent(parentA, tripA.routeId)).toBe(true);
    expect(isRouteAuthorizedForParent(parentA, tripB.routeId)).toBe(false);
    expect(isRouteAuthorizedForParent(parentB, tripB.routeId)).toBe(true);
    expect(isRouteAuthorizedForParent(parentB, tripA.routeId)).toBe(false);
  });
});
