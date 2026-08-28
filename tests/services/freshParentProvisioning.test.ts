import { describe, it, expect } from 'vitest';
import { verifyPassword } from '../../server/services/legacyAuthCredentials';
import { legacyUserRepository } from '../../server/repositories/legacyUserRepository';
import { userRepository } from '../../server/repositories/userRepository';
import { legacyStudentRepository } from '../../server/repositories/legacyStudentRepository';
import { studentRepository } from '../../server/repositories/studentRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { requireParentUser } from '../../server/services/authz';
import { provisionParentAccount } from '../../server/services/ProvisioningService';
import { resolveAuthorizedStudents } from '../../server/services/ParentAccessService';
import { getParentJourneys } from '../../server/services/ParentJourneyService';
import { processPendingNotificationsForParent, getNotificationsForParent } from '../../server/services/NotificationService';
import { createJourney, startJourney, startBoarding, boardStudent, type JourneyActor } from '../../server/services/JourneyService';

// Phase 14 §39 — a completely new parent, provisioned through the SAME
// service the real POST /api/auth/register endpoint calls (never a direct
// governed-user insert as a shortcut), must be able to reach every real
// governed surface end-to-end: login credential, governed identity,
// child assignment, Parent Live Journey, and notifications. This is the
// regression guard for the exact gap Phase 13.1 found live: a
// self-registered parent used to get 404 from every /api/parent/* route
// because no governed `users` row was ever created for them.

const SYSTEM: JourneyActor = { actorId: null, actorType: 'system' };

describe('Fresh parent provisioning (spec §9/§39) — the real production registration path, not a shortcut', () => {
  it('provisionParentAccount creates a real, working legacy login AND a real, working governed identity', () => {
    const email = `fresh-parent-provisioning-${Date.now()}@masara.om`;
    const result = provisionParentAccount({ name: 'ولي أمر اختبار التسجيل', email, password: 'RealPassword!123' });
    expect(result.status).toBe('CREATED');
    if (result.status !== 'CREATED') return;

    // 1. A real, working legacy login credential — the same one /api/auth/login checks.
    const legacyUser = legacyUserRepository.findByEmail(email);
    expect(legacyUser).toBeTruthy();
    expect(verifyPassword('RealPassword!123', legacyUser!.passwordHash)).toBe(true);
    expect(legacyUser!.role).toBe('parent');

    // 2. A real governed counterpart — the exact thing that was missing before Phase 14.
    const governedUser = userRepository.findByEmail(email);
    expect(governedUser).toBeTruthy();
    expect(governedUser!.role).toBe('parent');
    expect(governedUser!.id).toBe(result.governedUser.id);

    // 3. Governed access actually works now — requireParentUser no longer 404s this real account.
    const guard = requireParentUser(email);
    expect(guard.ok).toBe(true);
  });

  it('registering twice with the same email is rejected, never a duplicate account on either side', () => {
    const email = `fresh-parent-dup-${Date.now()}@masara.om`;
    const first = provisionParentAccount({ name: 'ولي أمر', email, password: 'RealPassword!123' });
    expect(first.status).toBe('CREATED');

    const second = provisionParentAccount({ name: 'ولي أمر آخر', email, password: 'DifferentPassword!456' });
    expect(second.status).toBe('ALREADY_REGISTERED');

    expect(legacyUserRepository.findAll().filter((u) => u.email.toLowerCase() === email.toLowerCase())).toHaveLength(1);
    expect(userRepository.findAll().filter((u) => u.email === email.toLowerCase())).toHaveLength(1);
  });

  it('reconciliation case: a real legacy-only account (simulating a pre-Phase-14 registration) gets its missing governed counterpart provisioned in place, never a second legacy account', () => {
    // Simulates the exact pre-Phase-14 bug directly: a legacy user with
    // genuinely no governed counterpart, created the OLD way (bypassing
    // provisionParentAccount) — exactly what every registration produced
    // before this phase.
    const email = `fresh-parent-legacy-only-${Date.now()}@masara.om`;
    const legacyOnly = legacyUserRepository.create({ name: 'حساب قديم', email, passwordHash: 'irrelevant-for-this-test', role: 'parent' });
    expect(userRepository.findByEmail(email)).toBeUndefined();

    const result = provisionParentAccount({ name: 'محاولة تسجيل ثانية', email, password: 'AnotherPassword!789' });
    expect(result.status).toBe('ALREADY_REGISTERED');

    const healedGovernedUser = userRepository.findByEmail(email);
    expect(healedGovernedUser).toBeTruthy();
    expect(healedGovernedUser!.role).toBe('parent');
    expect(legacyUserRepository.findAll().filter((u) => u.email.toLowerCase() === email.toLowerCase())).toHaveLength(1);
    expect(legacyUserRepository.findById(legacyOnly.id)?.passwordHash).toBe('irrelevant-for-this-test'); // the original legacy row's password was never touched
  });

  it('end-to-end: a brand-new parent (real registration) → assigned a brand-new real child → sees a real Parent Live Journey → gets a real notification', async () => {
    const email = `fresh-parent-e2e-${Date.now()}@masara.om`;
    const result = provisionParentAccount({ name: 'ولي أمر حقيقي جديد', email, password: 'RealPassword!123' });
    expect(result.status).toBe('CREATED');
    if (result.status !== 'CREATED') return;

    // Admin/school-style student creation + parent assignment — the real,
    // existing legacy student flow (POST /api/students, PATCH
    // /api/students/:id/assign-parent), never a direct DB shortcut for the
    // legacy side.
    const bus = busRepository.findAll()[0];
    const legacyStudent = legacyStudentRepository.create({
      name: 'طالب جديد بالكامل',
      grade: 'الأول',
      avatar: 'https://example.test/avatar.png',
      schoolId: 'sch-1',
      schoolName: 'مدرسة الاختبار',
      parentName: 'placeholder',
      parentPhone: '+968 9000 0000',
      busId: bus.id,
      busNumber: bus.busNumber,
      pickupPoint: { lat: 23.6, lng: 58.4, address: 'test', nameAr: 'test' },
      status: 'at_home',
      pickupTimePlanned: '06:00 ص',
      seatNumber: '50A',
    });
    legacyStudentRepository.updateParentId(legacyStudent.id, result.legacyUser.id, result.legacyUser.name);

    // The one new Phase 14 step — POST /api/students/:id/provision-governed's
    // underlying logic: link a real governed student to this real legacy
    // student, on a real governed bus.
    const governedStudent = studentRepository.create({
      schoolId: bus.schoolId,
      name: legacyStudent.name,
      grade: legacyStudent.grade,
      busId: bus.id,
      pickupLat: legacyStudent.pickupPoint.lat,
      pickupLng: legacyStudent.pickupPoint.lng,
      pickupAddress: legacyStudent.pickupPoint.address,
      seatNumber: legacyStudent.seatNumber,
      legacyStudentId: legacyStudent.id,
    });

    // Governed access: resolveAuthorizedStudents (the real Phase 13 identity
    // bridge) now resolves this brand-new parent to this brand-new child —
    // by ID only, never a name/phone guess.
    const governedParentUser = userRepository.findByEmail(email)!;
    const authorized = resolveAuthorizedStudents(governedParentUser);
    expect(authorized.map((s) => s.id)).toEqual([governedStudent.id]);

    // Parent Live Journey: drive a real journey through the real state machine.
    const trip = tripRepository.findAll().find((t) => t.busId === bus.id)!;
    let journey = createJourney(governedStudent.id, trip.id, SYSTEM);
    journey = startJourney(journey.id, SYSTEM);
    startBoarding(journey.id, SYSTEM);
    boardStudent(journey.id, SYSTEM);

    const views = getParentJourneys(governedParentUser);
    expect(views).toHaveLength(1);
    expect(views[0].child.id).toBe(governedStudent.id);
    expect(views[0].child.legacyStudentId).toBe(legacyStudent.id);
    expect(views[0].journey?.state).toBe('on_bus');

    // Notifications: a real STUDENT_BOARDED event reaches this brand-new parent.
    await processPendingNotificationsForParent(governedParentUser);
    const notifs = (await getNotificationsForParent(governedParentUser)).filter((n) => n.studentId === governedStudent.id);
    expect(notifs.length).toBeGreaterThan(0);
  });
});
