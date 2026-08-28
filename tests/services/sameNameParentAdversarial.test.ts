import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../database/client';
import { students, users, legacyUsers, legacyStudents } from '../../database/schema';
import { userRepository } from '../../server/repositories/userRepository';
import { legacyUserRepository } from '../../server/repositories/legacyUserRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { routeRepository } from '../../server/repositories/routeRepository';
import { currentLocationProjectionRepository } from '../../server/repositories/currentLocationProjectionRepository';
import { resolveAuthorizedStudents, isStudentAuthorized } from '../../server/services/ParentAccessService';
import { getParentJourneys, getParentJourneyEvents, ParentAccessDeniedError } from '../../server/services/ParentJourneyService';
import { processPendingNotificationsForParent, getNotificationsForParent, markNotificationRead, NotificationAccessDeniedError } from '../../server/services/NotificationService';
import { processObservation } from '../../server/services/CurrentLocationProjectionService';
import { createJourney, startJourney, startBoarding, boardStudent, type JourneyActor } from '../../server/services/JourneyService';
import type { TelemetryObservation } from '../../server/domain/telemetryContract';

// Phase 13.1 — Same-Name Parent Adversarial Verification (spec §20 mandatory
// regression test). Proves the real legacy-FK identity bridge
// (server/services/ParentAccessService.ts, database/schema.ts's
// students.legacyStudentId) never confuses two independent households whose
// PARENTS share an identical first name AND whose CHILDREN also share an
// identical first name — the strongest adversarial case for any bridge that
// might (incorrectly) fall back to name comparison. Every assertion here
// checks a real, independently-created database row via its real stable ID
// — never a name equality.

const SYSTEM: JourneyActor = { actorId: null, actorType: 'system' };

beforeEach(() => {
  currentLocationProjectionRepository.clear();
});

/**
 * Builds one fully independent household: a real legacy parent (with a
 * real parentId-owned legacy student) plus a real governed user/student
 * pair bridged via legacyStudentId — the same shape
 * database/seed/seed.ts uses for the one real pilot household, but built
 * fresh per household so two households can be compared in the same test.
 */
let householdCounter = 0;
function createHousehold(parentFirstName: string, studentFirstName: string, busIndex: number) {
  householdCounter += 1;
  const n = householdCounter;
  const admin = userRepository.findByEmail('admin@masara.om')!;
  const bus = busRepository.findAll()[busIndex];
  const email = `same-name-parent-${n}-test@masara.om`;
  const legacyParentId = `test-samename-legacy-parent-${n}`;
  const legacyStudentId = `test-samename-legacy-student-${n}`;
  const parentFullName = `${parentFirstName} بن اختبار ${n} العائلة`;
  const studentFullName = `${studentFirstName} بن اختبار ${n} العائلة`;

  db.insert(legacyUsers)
    .values({ id: legacyParentId, name: parentFullName, email, passwordHash: 'x', role: 'parent' })
    .run();
  db.insert(legacyStudents)
    .values({
      id: legacyStudentId,
      name: studentFullName,
      grade: 'الأول',
      avatar: 'https://example.test/avatar.png',
      schoolId: admin.schoolId!,
      schoolName: 'test',
      parentId: legacyParentId,
      parentName: parentFullName,
      parentPhone: `+968 9${800 + n} ${String(1000 + n).slice(0, 4)}`,
      busId: bus.id,
      busNumber: bus.busNumber,
      pickupLat: 23.6,
      pickupLng: 58.4,
      pickupAddress: 'test',
      pickupNameAr: 'test',
      pickupTimePlanned: '06:00',
      seatNumber: '01A',
    })
    .run();
  const governedStudentId = crypto.randomUUID();
  db.insert(students)
    .values({
      id: governedStudentId,
      schoolId: admin.schoolId!,
      name: studentFullName,
      grade: 'الأول',
      busId: bus.id,
      pickupLat: 23.6,
      pickupLng: 58.4,
      pickupAddress: 'test',
      legacyStudentId,
    })
    .run();
  const governedUserId = crypto.randomUUID();
  db.insert(users).values({ id: governedUserId, schoolId: admin.schoolId, name: parentFullName, email, passwordHash: 'x', role: 'parent' }).run();

  const parentUser = userRepository.findByEmail(email)!;
  const student = resolveAuthorizedStudents(parentUser)[0];
  const trip = tripRepository.findAll().find((t) => t.busId === bus.id)!;
  return { legacyParentId, legacyStudentId, parentUser, student, trip, bus, parentFullName, studentFullName };
}

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

describe('Phase 13.1 — same first name (parent) AND same first name (child), two fully independent households', () => {
  it('sanity check: the two households really do share both first names, and are still two distinct sets of rows', () => {
    const a = createHousehold('أحمد', 'محمد', 0);
    const b = createHousehold('أحمد', 'محمد', 1);

    // The adversarial condition this whole file exists to test — confirmed, not assumed.
    expect(a.parentFullName.split(' ')[0]).toBe('أحمد');
    expect(b.parentFullName.split(' ')[0]).toBe('أحمد');
    expect(a.studentFullName.split(' ')[0]).toBe('محمد');
    expect(b.studentFullName.split(' ')[0]).toBe('محمد');

    // Never the same row.
    expect(a.legacyParentId).not.toBe(b.legacyParentId);
    expect(a.legacyStudentId).not.toBe(b.legacyStudentId);
    expect(a.student.id).not.toBe(b.student.id);
    expect(a.parentUser.id).not.toBe(b.parentUser.id);
  });

  it('database ownership is correct and exclusive on both sides — never crossed', () => {
    const a = createHousehold('أحمد', 'محمد', 0);
    const b = createHousehold('أحمد', 'محمد', 1);

    const legacyStudentA = db.select().from(legacyStudents).all().find((s) => s.id === a.legacyStudentId)!;
    const legacyStudentB = db.select().from(legacyStudents).all().find((s) => s.id === b.legacyStudentId)!;
    expect(legacyStudentA.parentId).toBe(a.legacyParentId);
    expect(legacyStudentB.parentId).toBe(b.legacyParentId);
    expect(legacyStudentA.parentId).not.toBe(b.legacyParentId);
    expect(legacyStudentB.parentId).not.toBe(a.legacyParentId);

    expect(a.student.legacyStudentId).toBe(a.legacyStudentId);
    expect(b.student.legacyStudentId).toBe(b.legacyStudentId);
  });

  it('resolveAuthorizedStudents never merges, swaps, or unions the two same-named households', () => {
    const a = createHousehold('أحمد', 'محمد', 0);
    const b = createHousehold('أحمد', 'محمد', 1);

    const authorizedA = resolveAuthorizedStudents(a.parentUser);
    const authorizedB = resolveAuthorizedStudents(b.parentUser);

    expect(authorizedA.map((s) => s.id)).toEqual([a.student.id]);
    expect(authorizedB.map((s) => s.id)).toEqual([b.student.id]);
    expect(authorizedA.some((s) => s.id === b.student.id)).toBe(false);
    expect(authorizedB.some((s) => s.id === a.student.id)).toBe(false);
  });

  it('direct student-ID attack: Parent A -> Student B denied, Parent B -> Student A denied', () => {
    const a = createHousehold('أحمد', 'محمد', 0);
    const b = createHousehold('أحمد', 'محمد', 1);

    expect(isStudentAuthorized(a.parentUser, a.student.id)).toBe(true);
    expect(isStudentAuthorized(b.parentUser, b.student.id)).toBe(true);
    expect(isStudentAuthorized(a.parentUser, b.student.id)).toBe(false);
    expect(isStudentAuthorized(b.parentUser, a.student.id)).toBe(false);
  });

  it('Parent Live Journey: each parent sees only their own child, on the correct real bus/route, never the other household\'s', () => {
    const a = createHousehold('أحمد', 'محمد', 0);
    const b = createHousehold('أحمد', 'محمد', 1);

    createJourney(a.student.id, a.trip.id, SYSTEM);
    createJourney(b.student.id, b.trip.id, SYSTEM);

    const viewsA = getParentJourneys(a.parentUser);
    const viewsB = getParentJourneys(b.parentUser);

    expect(viewsA).toHaveLength(1);
    expect(viewsB).toHaveLength(1);
    expect(viewsA[0].child.id).toBe(a.student.id);
    expect(viewsB[0].child.id).toBe(b.student.id);
    expect(viewsA[0].child.legacyStudentId).toBe(a.legacyStudentId);
    expect(viewsB[0].child.legacyStudentId).toBe(b.legacyStudentId);
    expect(viewsA[0].bus?.id).toBe(a.bus.id);
    expect(viewsB[0].bus?.id).toBe(b.bus.id);
    expect(viewsA[0].bus?.id).not.toBe(viewsB[0].bus?.id);
  });

  it('journey-ID attack: Parent A -> Journey B denied, Parent B -> Journey A denied', () => {
    const a = createHousehold('أحمد', 'محمد', 0);
    const b = createHousehold('أحمد', 'محمد', 1);

    const journeyA = createJourney(a.student.id, a.trip.id, SYSTEM);
    const journeyB = createJourney(b.student.id, b.trip.id, SYSTEM);

    expect(() => getParentJourneyEvents(a.parentUser, journeyB.id)).toThrow(ParentAccessDeniedError);
    expect(() => getParentJourneyEvents(b.parentUser, journeyA.id)).toThrow(ParentAccessDeniedError);
    // Each parent can still read their own journey's events without error.
    expect(() => getParentJourneyEvents(a.parentUser, journeyA.id)).not.toThrow();
    expect(() => getParentJourneyEvents(b.parentUser, journeyB.id)).not.toThrow();
  });

  it('GPS/bus isolation: Parent A sees only Bus A\'s real coordinates, Parent B only Bus B\'s — never swapped, never leaked', () => {
    const a = createHousehold('أحمد', 'محمد', 0);
    const b = createHousehold('أحمد', 'محمد', 1);

    createJourney(a.student.id, a.trip.id, SYSTEM);
    createJourney(b.student.id, b.trip.id, SYSTEM);

    processObservation(makeObservation(a.bus.id, { latitude: 23.701, longitude: 58.501 }));
    processObservation(makeObservation(b.bus.id, { latitude: 23.199, longitude: 58.099 }));

    const viewA = getParentJourneys(a.parentUser)[0];
    const viewB = getParentJourneys(b.parentUser)[0];

    expect(viewA.location?.latitude).toBeCloseTo(23.701, 3);
    expect(viewA.location?.longitude).toBeCloseTo(58.501, 3);
    expect(viewB.location?.latitude).toBeCloseTo(23.199, 3);
    expect(viewB.location?.longitude).toBeCloseTo(58.099, 3);

    // Never the other household's coordinates.
    expect(viewA.location?.latitude).not.toBeCloseTo(23.199, 3);
    expect(viewB.location?.latitude).not.toBeCloseTo(23.701, 3);
  });

  it('notification isolation: a real STUDENT_BOARDED event for Student A never reaches Parent B, and vice versa', async () => {
    const a = createHousehold('أحمد', 'محمد', 0);
    const b = createHousehold('أحمد', 'محمد', 1);

    let journeyA = createJourney(a.student.id, a.trip.id, SYSTEM);
    journeyA = startJourney(journeyA.id, SYSTEM);
    startBoarding(journeyA.id, SYSTEM);
    boardStudent(journeyA.id, SYSTEM);

    await processPendingNotificationsForParent(a.parentUser);
    await processPendingNotificationsForParent(b.parentUser);

    const notifsA = (await getNotificationsForParent(a.parentUser)).filter((n) => n.studentId === a.student.id);
    const notifsB = await getNotificationsForParent(b.parentUser);

    expect(notifsA.length).toBeGreaterThan(0);
    expect(notifsB.some((n) => n.studentId === a.student.id)).toBe(false);
    expect(notifsB).toHaveLength(0);

    // Parent B cannot mark Parent A's notification read by guessing its ID.
    expect(() => markNotificationRead(b.parentUser, notifsA[0].id)).toThrow(NotificationAccessDeniedError);
  });
});

// Identity-smuggling protection (spec §14: "Parent B token + Parent A
// email -> ignored") is NOT re-tested in this file: it is enforced at the
// route layer (requireVerifiedEmail derives identity exclusively from the
// verified session token, never from a client-supplied email/query/body
// field — see server/services/authz.ts), not inside
// ParentAccessService.resolveAuthorizedStudents itself, which trusts
// whatever GovernedUser object it is handed by design (that object is
// always the session-derived one in every real caller). That route-layer
// contract already has dedicated coverage in
// tests/services/governedApiAuthentication.test.ts, and was additionally
// live-verified against the running dev server in this phase (see the
// Phase 13.1 report section) — a real registered account's session token
// with `?email=...&userEmail=...` query parameters attached produced a
// byte-identical response with and without those parameters.
