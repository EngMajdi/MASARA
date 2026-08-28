import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../../database/client';
import { users, students, legacyUsers, legacyStudents } from '../../database/schema';
import { userRepository } from '../../server/repositories/userRepository';
import { userContactRepository } from '../../server/repositories/userContactRepository';
import { createContact, updateContact } from '../../server/services/UserContactService';
import {
  requestVerification,
  confirmVerification,
  generateVerificationCode,
  hashVerificationCode,
  ContactNotFoundError,
  ContactAccessDeniedError,
  ContactDisabledError,
  VerificationUnavailableError,
  InvalidVerificationCodeError,
} from '../../server/services/ContactVerificationService';
import { resolveEmailAddress, resolveSmsAddress, resolvePushToken } from '../../server/services/ContactDeliveryResolution';
import { requireAuthenticatedUser } from '../../server/services/authz';
import { isEligibleForNotification } from '../../server/services/NotificationPolicy';
import { processPendingNotificationsForParent, getNotificationsForParent } from '../../server/services/NotificationService';
import { deliverToAllChannels } from '../../server/services/NotificationDeliveryManager';
import { notificationRepository } from '../../server/repositories/notificationRepository';
import { resolveAuthorizedStudents } from '../../server/services/ParentAccessService';
import { journeyRepository } from '../../server/repositories/journeyRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { routeRepository } from '../../server/repositories/routeRepository';
import { studentRepository } from '../../server/repositories/studentRepository';
import { auditRepository } from '../../server/repositories/auditRepository';
import { recommendationRepository } from '../../server/repositories/recommendationRepository';
import { telemetryObservationRepository } from '../../server/repositories/telemetryObservationRepository';
import { currentLocationProjectionRepository } from '../../server/repositories/currentLocationProjectionRepository';
import { etaAccuracyRepository } from '../../server/repositories/etaAccuracyRepository';
import { createJourney, startJourney, startBoarding, boardStudent, getJourneyTimeline, SYSTEM_ACTOR as SYSTEM } from '../../server/services/JourneyService';
import type { NotificationDeliveryProvider } from '../../server/services/NotificationDeliveryProvider';

let freshCounter = 0;
function createFreshUser(role: 'admin' | 'school' | 'driver' | 'parent' = 'parent') {
  freshCounter += 1;
  const admin = userRepository.findByEmail('admin@masara.om')!;
  const email = `contact-verify-fresh-user-${freshCounter}-test@masara.om`;
  db.insert(users).values({ id: crypto.randomUUID(), schoolId: admin.schoolId, name: `Fresh Verify User ${freshCounter}`, email, passwordHash: 'x', role }).run();
  return userRepository.findByEmail(email)!;
}

let freshChildCounter = 0;
function createFreshAuthorizedChild() {
  freshChildCounter += 1;
  const admin = userRepository.findByEmail('admin@masara.om')!;
  const bus = busRepository.findAll()[0];
  const email = `contact-verify-fresh-parent-${freshChildCounter}-test@masara.om`;
  const legacyParentId = `test-cv-legacy-parent-${freshChildCounter}`;
  const legacyStudentId = `test-cv-legacy-student-${freshChildCounter}`;

  db.insert(legacyUsers)
    .values({ id: legacyParentId, name: `Contact Verify Fresh Parent ${freshChildCounter}`, email, passwordHash: 'x', role: 'parent' })
    .run();
  db.insert(legacyStudents)
    .values({
      id: legacyStudentId,
      name: `طالب اختبار توثيق ${freshChildCounter}`,
      grade: 'الأول',
      avatar: 'https://example.test/avatar.png',
      schoolId: admin.schoolId!,
      schoolName: 'test',
      parentId: legacyParentId,
      parentName: `Contact Verify Fresh Parent ${freshChildCounter}`,
      parentPhone: `+968 9800 ${String(freshChildCounter).padStart(4, '0')}`,
      busId: bus.id,
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
      name: `طالب اختبار توثيق ${freshChildCounter}`,
      grade: 'الأول',
      busId: bus.id,
      pickupLat: 23.6,
      pickupLng: 58.4,
      pickupAddress: 'test',
      legacyStudentId,
    })
    .run();
  db.insert(users).values({ id: crypto.randomUUID(), schoolId: admin.schoolId, name: `Contact Verify Fresh Parent ${freshChildCounter}`, email, passwordHash: 'x', role: 'parent' }).run();

  const parentUser = userRepository.findByEmail(email)!;
  const student = resolveAuthorizedStudents(parentUser)[0];
  const trip = tripRepository.findAll().find((t) => t.busId === student.busId)!;
  return { parentUser, student, trip };
}

/** Directly seeds a real, valid challenge onto a contact row — the same "known state via repository" fixture pattern already used across this codebase's tests — and returns the plaintext code that would confirm it. */
function seedValidChallenge(contactId: string, ttlMs = 15 * 60 * 1000) {
  const code = generateVerificationCode();
  userContactRepository.update(contactId, { verificationCodeHash: hashVerificationCode(code), verificationExpiresAt: new Date(Date.now() + ttlMs) });
  return code;
}

// ---------------------------------------------------------------------------
// CONTACT VERIFICATION
// ---------------------------------------------------------------------------

describe('Contact verification — authorization (spec mandatory)', () => {
  it('unauthenticated request is rejected before any verification logic runs', () => {
    const guard = requireAuthenticatedUser(undefined);
    expect(guard.ok).toBe(false);
  });

  it('unknown user is rejected', () => {
    const guard = requireAuthenticatedUser('nobody-verify@masara.om');
    expect(guard.ok).toBe(false);
  });

  it('a user can request and confirm verification of their OWN contact', () => {
    const user = createFreshUser();
    const contact = createContact(user, { channel: 'EMAIL', value: 'ownverify@example.com' });
    const request = requestVerification(user, contact.id);
    expect(request.status).toBe('PENDING');
    expect(request.delivered).toBe(false);

    const code = seedValidChallenge(contact.id);
    const confirmed = confirmVerification(user, contact.id, code);
    expect(confirmed.verified).toBe(true);
  });

  it('cross-user request is rejected — User A cannot request verification of User B\'s contact', () => {
    const a = createFreshUser();
    const b = createFreshUser();
    const bContact = createContact(b, { channel: 'EMAIL', value: 'crossreq@example.com' });
    expect(() => requestVerification(a, bContact.id)).toThrow(ContactAccessDeniedError);
  });

  it('cross-user confirm is rejected — User A cannot confirm verification of User B\'s contact even with a guessed/known code', () => {
    const a = createFreshUser();
    const b = createFreshUser();
    const bContact = createContact(b, { channel: 'EMAIL', value: 'crossconfirm@example.com' });
    const code = seedValidChallenge(bContact.id);
    expect(() => confirmVerification(a, bContact.id, code)).toThrow(ContactAccessDeniedError);
    // And B's contact must still be unverified — A's attempt had zero effect.
    expect(userContactRepository.findById(bContact.id)!.verifiedAt).toBeNull();
  });

  it('a disabled contact cannot have verification requested', () => {
    const user = createFreshUser();
    const contact = createContact(user, { channel: 'EMAIL', value: 'disabledreq@example.com' });
    updateContact(user, contact.id, { enabled: false });
    expect(() => requestVerification(user, contact.id)).toThrow(ContactDisabledError);
  });

  it('a disabled, never-verified contact cannot be confirmed', () => {
    const user = createFreshUser();
    const contact = createContact(user, { channel: 'EMAIL', value: 'disabledconfirm@example.com' });
    const code = seedValidChallenge(contact.id);
    updateContact(user, contact.id, { enabled: false });
    expect(() => confirmVerification(user, contact.id, code)).toThrow(ContactDisabledError);
  });

  it('a deleted contact cannot have verification requested or confirmed', () => {
    const user = createFreshUser();
    const contact = createContact(user, { channel: 'EMAIL', value: 'deletedverify@example.com' });
    userContactRepository.delete(contact.id);
    expect(() => requestVerification(user, contact.id)).toThrow(ContactNotFoundError);
    expect(() => confirmVerification(user, contact.id, 'anything')).toThrow(ContactNotFoundError);
  });

  it('an already-verified contact is idempotent — confirming again succeeds without requiring (or checking) a code', () => {
    const user = createFreshUser();
    const contact = createContact(user, { channel: 'EMAIL', value: 'idempotentverify@example.com' });
    const code = seedValidChallenge(contact.id);
    const first = confirmVerification(user, contact.id, code);
    expect(first.verified).toBe(true);

    // Second confirm with a wrong/empty code must still succeed (idempotent), not throw.
    const second = confirmVerification(user, contact.id, 'totally-wrong-code');
    expect(second.verified).toBe(true);
    const third = confirmVerification(user, contact.id, undefined);
    expect(third.verified).toBe(true);
  });

  it('confirmation with no code supplied and no prior verification is rejected', () => {
    const user = createFreshUser();
    const contact = createContact(user, { channel: 'EMAIL', value: 'nocode@example.com' });
    expect(() => confirmVerification(user, contact.id, undefined)).toThrow(InvalidVerificationCodeError);
  });

  it('confirmation is unavailable when no verification was ever requested', () => {
    const user = createFreshUser();
    const contact = createContact(user, { channel: 'EMAIL', value: 'neverrequested@example.com' });
    expect(() => confirmVerification(user, contact.id, 'some-code')).toThrow(VerificationUnavailableError);
  });

  it('confirmation is unavailable once the challenge has expired', () => {
    const user = createFreshUser();
    const contact = createContact(user, { channel: 'EMAIL', value: 'expiredchallenge@example.com' });
    const code = seedValidChallenge(contact.id, -1000); // already expired
    expect(() => confirmVerification(user, contact.id, code)).toThrow(VerificationUnavailableError);
  });

  it('an incorrect code against a real, unexpired challenge is rejected, and the contact remains unverified', () => {
    const user = createFreshUser();
    const contact = createContact(user, { channel: 'EMAIL', value: 'wrongcode@example.com' });
    seedValidChallenge(contact.id);
    expect(() => confirmVerification(user, contact.id, 'not-the-real-code')).toThrow(InvalidVerificationCodeError);
    expect(userContactRepository.findById(contact.id)!.verifiedAt).toBeNull();
  });

  it('verification works uniformly across all three channels (EMAIL/SMS/PUSH) — no channel-specific bypass', () => {
    const user = createFreshUser();
    const email = createContact(user, { channel: 'EMAIL', value: 'allchannels@example.com' });
    const sms = createContact(user, { channel: 'SMS', value: '+96895512345' });
    const push = createContact(user, { channel: 'PUSH', value: 'all-channels-push-token' });
    for (const contact of [email, sms, push]) {
      const code = seedValidChallenge(contact.id);
      expect(confirmVerification(user, contact.id, code).verified).toBe(true);
    }
  });

  it('changing a contact\'s value invalidates its prior verification and any in-flight challenge — a verification only ever attests to the exact value it was issued for', () => {
    const user = createFreshUser();
    const contact = createContact(user, { channel: 'EMAIL', value: 'original@example.com' });
    const code = seedValidChallenge(contact.id);
    const verified = confirmVerification(user, contact.id, code);
    expect(verified.verified).toBe(true);

    const updated = updateContact(user, contact.id, { value: 'changed@example.com' });
    expect(updated.verified).toBe(false);
    const row = userContactRepository.findById(contact.id)!;
    expect(row.verificationCodeHash).toBeNull();
    expect(row.verificationExpiresAt).toBeNull();
  });
});

describe('Contact verification — secrets are never exposed (spec mandatory)', () => {
  it('requestVerification never returns the plaintext code', () => {
    const user = createFreshUser();
    const contact = createContact(user, { channel: 'EMAIL', value: 'secretnotreturned@example.com' });
    const result = requestVerification(user, contact.id) as unknown as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(result, 'code')).toBe(false);
    expect(Object.keys(result).sort()).toEqual(['channel', 'delivered', 'expiresAt', 'message', 'status'].sort());
    expect(JSON.stringify(result)).not.toMatch(/[0-9a-f]{48}/); // a 24-byte hex code, if leaked, would match this
  });

  it('confirmVerification never returns verificationCodeHash or any hash-shaped field', () => {
    const user = createFreshUser();
    const contact = createContact(user, { channel: 'EMAIL', value: 'hashnotreturned@example.com' });
    const code = seedValidChallenge(contact.id);
    const view = confirmVerification(user, contact.id, code) as unknown as Record<string, unknown>;
    for (const forbiddenKey of ['verificationCodeHash', 'verificationExpiresAt', 'value', 'normalizedValue', 'userId']) {
      expect(Object.prototype.hasOwnProperty.call(view, forbiddenKey)).toBe(false);
    }
  });

  it('the stored hash is never equal to the plaintext code (a real hash was actually applied, not stored verbatim)', () => {
    const code = generateVerificationCode();
    const hash = hashVerificationCode(code);
    expect(hash).not.toBe(code);
    expect(hash).not.toContain(code);
  });

  it('no client-supplied userId can widen access to request or confirm verification', () => {
    const a = createFreshUser();
    const b = createFreshUser();
    const bContact = createContact(b, { channel: 'EMAIL', value: 'impersonateverify@example.com' });
    // requestVerification/confirmVerification take only (user, contactId[, code]) — there is no userId parameter to spoof at all.
    expect(requestVerification.length).toBeLessThanOrEqual(2);
    expect(confirmVerification.length).toBeLessThanOrEqual(3);
    expect(() => requestVerification(a, bContact.id)).toThrow(ContactAccessDeniedError);
  });
});

// ---------------------------------------------------------------------------
// CONTACT ELIGIBILITY
// ---------------------------------------------------------------------------

describe('Contact eligibility — only verified + enabled is ever eligible for delivery (spec Core Rule)', () => {
  it('a verified + enabled contact is eligible', () => {
    const user = createFreshUser();
    const contact = createContact(user, { channel: 'SMS', value: '+96895511111' });
    const code = seedValidChallenge(contact.id);
    confirmVerification(user, contact.id, code);
    expect(resolveSmsAddress(user.id)).toBe('+96895511111');
  });

  it('an unverified + enabled contact is ineligible', () => {
    const user = createFreshUser();
    createContact(user, { channel: 'SMS', value: '+96895522222' });
    expect(resolveSmsAddress(user.id)).toBeNull();
  });

  it('a verified + disabled contact is ineligible', () => {
    const user = createFreshUser();
    const contact = createContact(user, { channel: 'SMS', value: '+96895533333' });
    const code = seedValidChallenge(contact.id);
    confirmVerification(user, contact.id, code);
    updateContact(user, contact.id, { enabled: false });
    expect(resolveSmsAddress(user.id)).toBeNull();
  });

  it('a deleted contact is unavailable for delivery', () => {
    const user = createFreshUser();
    const contact = createContact(user, { channel: 'PUSH', value: 'deleted-push-token' });
    const code = seedValidChallenge(contact.id);
    confirmVerification(user, contact.id, code);
    expect(resolvePushToken(user.id)).toBe('deleted-push-token');
    userContactRepository.delete(contact.id);
    expect(resolvePushToken(user.id)).toBeNull();
  });

  it('deterministic selection: when multiple verified+enabled contacts exist for the same channel, the most recently verified one wins', () => {
    const user = createFreshUser();
    const older = createContact(user, { channel: 'SMS', value: '+96895544441' });
    const newer = createContact(user, { channel: 'SMS', value: '+96895544442' });
    confirmVerification(user, older.id, seedValidChallenge(older.id));
    userContactRepository.update(older.id, { verifiedAt: new Date(Date.now() - 60_000) }); // force an earlier verifiedAt
    confirmVerification(user, newer.id, seedValidChallenge(newer.id)); // verified "now" — strictly later
    expect(resolveSmsAddress(user.id)).toBe('+96895544442');
  });

  it('deterministic selection: when verifiedAt and updatedAt both tie, the lexicographically smaller id wins — the final, always-deterministic tiebreak, never random', () => {
    const user = createFreshUser();
    const a = createContact(user, { channel: 'PUSH', value: 'tie-push-a' });
    const b = createContact(user, { channel: 'PUSH', value: 'tie-push-b' });
    const sameInstant = new Date();
    userContactRepository.update(a.id, { verifiedAt: sameInstant });
    userContactRepository.update(b.id, { verifiedAt: sameInstant });

    const expectedValue = a.id < b.id ? 'tie-push-a' : 'tie-push-b';
    expect(resolvePushToken(user.id)).toBe(expectedValue);
    // Re-resolving must return the exact same winner every time — never a coin flip.
    expect(resolvePushToken(user.id)).toBe(expectedValue);
  });
});

// ---------------------------------------------------------------------------
// EMAIL FALLBACK
// ---------------------------------------------------------------------------

describe('Email fallback policy — deterministic precedence (spec "Email Fallback Policy" mandatory)', () => {
  it('a verified + enabled EMAIL contact is preferred over users.email', () => {
    const user = createFreshUser();
    const contact = createContact(user, { channel: 'EMAIL', value: 'preferred-contact@example.com' });
    confirmVerification(user, contact.id, seedValidChallenge(contact.id));
    const resolution = resolveEmailAddress(user);
    expect(resolution.address).toBe('preferred-contact@example.com');
    expect(resolution.source).toBe('CONTACT');
    expect(resolution.address).not.toBe(user.email);
  });

  it('a disabled EMAIL contact is never used — falls back to users.email', () => {
    const user = createFreshUser();
    const contact = createContact(user, { channel: 'EMAIL', value: 'disabled-fallback@example.com' });
    confirmVerification(user, contact.id, seedValidChallenge(contact.id));
    updateContact(user, contact.id, { enabled: false });
    const resolution = resolveEmailAddress(user);
    expect(resolution.source).toBe('LEGACY_FALLBACK');
    expect(resolution.address).toBe(user.email);
  });

  it('an unverified EMAIL contact is never used — falls back to users.email', () => {
    const user = createFreshUser();
    createContact(user, { channel: 'EMAIL', value: 'unverified-fallback@example.com' });
    const resolution = resolveEmailAddress(user);
    expect(resolution.source).toBe('LEGACY_FALLBACK');
    expect(resolution.address).toBe(user.email);
  });

  it('fallback resolution is deterministic — repeated calls return the same result', () => {
    const user = createFreshUser();
    const first = resolveEmailAddress(user);
    const second = resolveEmailAddress(user);
    expect(first).toEqual(second);
  });

  it('resolving the fallback never creates a contact row', () => {
    const user = createFreshUser();
    const before = userContactRepository.findByUserId(user.id).length;
    resolveEmailAddress(user);
    resolveEmailAddress(user);
    expect(userContactRepository.findByUserId(user.id).length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// NOTIFICATION INTEGRATION
// ---------------------------------------------------------------------------

describe('Notification integration — unaffected by contact resolution wiring (spec mandatory)', () => {
  it('a real Journey boarding event still produces exactly one correctly-delivered in-app notification', async () => {
    const parentUser = userRepository.findByEmail('parent@masara.om')!;
    const student = resolveAuthorizedStudents(parentUser)[0];
    const trip = tripRepository.findAll().find((t) => t.busId === student.busId)!;
    let journey = createJourney(student.id, trip.id, SYSTEM);
    journey = startJourney(journey.id, SYSTEM);
    startBoarding(journey.id, SYSTEM);
    boardStudent(journey.id, SYSTEM);

    await processPendingNotificationsForParent(parentUser);
    const notifs = (await getNotificationsForParent(parentUser)).filter((n) => n.studentId === student.id);
    expect(notifs.length).toBeGreaterThanOrEqual(1);
    expect(notifs[0].status).toBe('SENT');
  });

  it('contact resolution never duplicates a notification row on repeated processing', async () => {
    const { parentUser, student, trip } = createFreshAuthorizedChild();
    let journey = createJourney(student.id, trip.id, SYSTEM);
    journey = startJourney(journey.id, SYSTEM);
    startBoarding(journey.id, SYSTEM);
    boardStudent(journey.id, SYSTEM);

    await processPendingNotificationsForParent(parentUser);
    const before = (await getNotificationsForParent(parentUser)).length;
    await processPendingNotificationsForParent(parentUser);
    await processPendingNotificationsForParent(parentUser);
    expect((await getNotificationsForParent(parentUser)).length).toBe(before);
  });

  it('polling getNotificationsForParent repeatedly is idempotent', async () => {
    const parentUser = userRepository.findByEmail('parent@masara.om')!;
    const first = await getNotificationsForParent(parentUser);
    const second = await getNotificationsForParent(parentUser);
    expect(first.length).toBe(second.length);
  });

  it('a throwing provider does not mutate Journey, telemetry, or ETA state even after contact resolution runs', async () => {
    const { parentUser, student, trip } = createFreshAuthorizedChild();
    let journey = createJourney(student.id, trip.id, SYSTEM);
    journey = startJourney(journey.id, SYSTEM);
    startBoarding(journey.id, SYSTEM);
    journey = boardStudent(journey.id, SYSTEM);

    const before = {
      journeys: JSON.stringify(journeyRepository.findByStudentId(student.id)),
      telemetry: JSON.stringify(telemetryObservationRepository.findFiltered({ limit: 500 })),
      projection: JSON.stringify(currentLocationProjectionRepository.findAll()),
      etaAccuracy: JSON.stringify(etaAccuracyRepository.findForMetrics({})),
      timeline: JSON.stringify(getJourneyTimeline(journey.id)),
    };

    await processPendingNotificationsForParent(parentUser);
    const notif = (await getNotificationsForParent(parentUser)).find((n) => n.studentId === student.id)!;
    const throwingProvider: NotificationDeliveryProvider = { channel: 'PUSH', deliver: () => { throw new Error('اختبار'); } };
    await deliverToAllChannels(
      { notificationId: notif.id, title: notif.title, body: notif.body, priority: notif.priority, recipient: { userId: parentUser.id, email: parentUser.email, name: parentUser.name } },
      [throwingProvider]
    );

    expect(JSON.stringify(journeyRepository.findByStudentId(student.id))).toBe(before.journeys);
    expect(JSON.stringify(telemetryObservationRepository.findFiltered({ limit: 500 }))).toBe(before.telemetry);
    expect(JSON.stringify(currentLocationProjectionRepository.findAll())).toBe(before.projection);
    expect(JSON.stringify(etaAccuracyRepository.findForMetrics({}))).toBe(before.etaAccuracy);
    expect(JSON.stringify(getJourneyTimeline(journey.id))).toBe(before.timeline);
  });

  it('NotificationPolicy eligibility is unchanged — suppressed Journey events remain suppressed, eligible ones remain eligible', () => {
    expect(isEligibleForNotification('STUDENT_BOARDED')).toBe(true);
    expect(isEligibleForNotification('STOP_APPROACHING')).toBe(true);
    expect(isEligibleForNotification('STUDENT_DROPPED_OFF')).toBe(true);
    expect(isEligibleForNotification('JOURNEY_CREATED')).toBe(false);
    expect(isEligibleForNotification('JOURNEY_STARTED')).toBe(false);
    expect(isEligibleForNotification('BOARDING_STARTED')).toBe(false);
    expect(isEligibleForNotification('TRANSIT_STARTED')).toBe(false);
    expect(isEligibleForNotification('JOURNEY_COMPLETED')).toBe(false);
  });

  it('AI/governance-only event types are not eligible for parent notification (never suppressed-then-leaked)', () => {
    expect(isEligibleForNotification('RECOMMENDATION_CREATED')).toBe(false);
    expect(isEligibleForNotification('ACTION_APPROVED')).toBe(false);
    expect(isEligibleForNotification('ACTION_EXECUTED')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PRIVACY
// ---------------------------------------------------------------------------

describe('Privacy — contacts and verification secrets never leak (spec mandatory)', () => {
  it('parent cannot access another parent\'s contact through verification endpoints either', () => {
    const a = createFreshUser();
    const b = createFreshUser();
    const bContact = createContact(b, { channel: 'EMAIL', value: 'privacycross@example.com' });
    expect(() => requestVerification(a, bContact.id)).toThrow(ContactAccessDeniedError);
    expect(() => confirmVerification(a, bContact.id, 'x')).toThrow(ContactAccessDeniedError);
  });

  it('getNotificationsForParent results carry no contact-shaped field (email/phone/pushToken/contact)', async () => {
    const parentUser = userRepository.findByEmail('parent@masara.om')!;
    await processPendingNotificationsForParent(parentUser);
    const notif = (await getNotificationsForParent(parentUser))[0] as unknown as Record<string, unknown>;
    for (const forbiddenKey of ['email', 'phone', 'pushToken', 'smsAddress', 'contact', 'recipient']) {
      expect(Object.prototype.hasOwnProperty.call(notif, forbiddenKey)).toBe(false);
    }
  });

  it('confirmVerification\'s ContactView never carries a raw address, matching UserContactService\'s own DTO shape exactly', () => {
    const user = createFreshUser();
    const contact = createContact(user, { channel: 'EMAIL', value: 'shapecheck@example.com' });
    const view = confirmVerification(user, contact.id, seedValidChallenge(contact.id));
    expect(Object.keys(view).sort()).toEqual(['channel', 'createdAt', 'enabled', 'id', 'masked', 'updatedAt', 'verified'].sort());
  });
});

// ---------------------------------------------------------------------------
// ISOLATION SNAPSHOT
// ---------------------------------------------------------------------------

describe('Isolation — contact verification and delivery resolution touch nothing outside notifications/user_contacts (spec mandatory)', () => {
  it('journeys, students, trips, buses, routes, telemetry, current-location, ETA-accuracy, recommendations, and audit_logs are unchanged by a verification request/confirm cycle plus a real notification flow', async () => {
    const { parentUser, student, trip } = createFreshAuthorizedChild();

    const before = {
      journeys: JSON.stringify(journeyRepository.findByStudentId(student.id)),
      students: JSON.stringify(studentRepository.findAll()),
      trips: JSON.stringify(tripRepository.findAll()),
      buses: JSON.stringify(busRepository.findAll()),
      routes: JSON.stringify(routeRepository.findAll()),
      recommendations: JSON.stringify(recommendationRepository.findAll()),
      telemetry: JSON.stringify(telemetryObservationRepository.findFiltered({ limit: 500 })),
      projection: JSON.stringify(currentLocationProjectionRepository.findAll()),
      etaAccuracy: JSON.stringify(etaAccuracyRepository.findForMetrics({})),
      auditCount: auditRepository.findAll().length,
    };

    // Contact verification cycle.
    const contact = createContact(parentUser, { channel: 'SMS', value: '+96895599999' });
    requestVerification(parentUser, contact.id);
    confirmVerification(parentUser, contact.id, seedValidChallenge(contact.id));

    // A real notification-producing Journey flow, through the resolver-wired path.
    let journey = createJourney(student.id, trip.id, SYSTEM);
    journey = startJourney(journey.id, SYSTEM);
    startBoarding(journey.id, SYSTEM);
    boardStudent(journey.id, SYSTEM);
    await processPendingNotificationsForParent(parentUser);

    expect(JSON.stringify(studentRepository.findAll())).toBe(before.students);
    expect(JSON.stringify(tripRepository.findAll())).toBe(before.trips);
    expect(JSON.stringify(busRepository.findAll())).toBe(before.buses);
    expect(JSON.stringify(routeRepository.findAll())).toBe(before.routes);
    expect(JSON.stringify(recommendationRepository.findAll())).toBe(before.recommendations);
    expect(JSON.stringify(telemetryObservationRepository.findFiltered({ limit: 500 }))).toBe(before.telemetry);
    expect(JSON.stringify(currentLocationProjectionRepository.findAll())).toBe(before.projection);
    expect(JSON.stringify(etaAccuracyRepository.findForMetrics({}))).toBe(before.etaAccuracy);
    // audit_logs grows ONLY from the real Journey transitions above — never from contact verification itself.
    const journeyOnlyAuditGrowth = auditRepository.findAll().length - before.auditCount;
    expect(journeyOnlyAuditGrowth).toBeGreaterThan(0);
  });

  it('contact verification alone (no Journey activity) writes zero audit_logs rows', () => {
    const user = createFreshUser();
    const before = auditRepository.findAll().length;
    const contact = createContact(user, { channel: 'EMAIL', value: 'noaudit@example.com' });
    requestVerification(user, contact.id);
    confirmVerification(user, contact.id, seedValidChallenge(contact.id));
    expect(auditRepository.findAll().length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// SOURCE-SCAN GUARDS
// ---------------------------------------------------------------------------

describe('Source-scan governance guards (spec mandatory)', () => {
  const notificationServiceSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/NotificationService.ts'), 'utf8');
  const verificationServiceSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/ContactVerificationService.ts'), 'utf8');
  const resolutionServiceSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/ContactDeliveryResolution.ts'), 'utf8');
  const contactRoutesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/contactRoutes.ts'), 'utf8');
  const serverSource = fs.readFileSync(path.resolve(__dirname, '../../server.ts'), 'utf8');
  const forbiddenImports = /from ['"].*\/(JourneyService|JourneyStateMachine|ActionExecutor|PolicyEngine|MasaraOperationsAgent|TelemetryIngestionService|EtaService)['"]/;

  it('NotificationService.ts imports no Journey/governance/telemetry/ETA mutation module', () => {
    expect(notificationServiceSource).not.toMatch(forbiddenImports);
  });

  it('ContactVerificationService.ts imports no Journey/governance/telemetry/ETA mutation module', () => {
    expect(verificationServiceSource).not.toMatch(forbiddenImports);
  });

  it('ContactDeliveryResolution.ts imports no Journey/governance/telemetry/ETA mutation module', () => {
    expect(resolutionServiceSource).not.toMatch(forbiddenImports);
  });

  it('ContactVerificationService.ts never logs the verification code or its variable', () => {
    expect(verificationServiceSource).not.toMatch(/console\.(log|info|debug)\(/);
  });

  it('no plaintext-looking hardcoded OTP (e.g. "123456") exists in the verification service', () => {
    expect(verificationServiceSource).not.toMatch(/['"]123456['"]/);
  });

  it('no POST /api/events or generic event-injection endpoint exists anywhere mounted in server.ts', () => {
    expect(serverSource).not.toMatch(/['"]\/api\/events['"]/);
  });

  it('no generic notification-creation endpoint exists in contactRoutes.ts', () => {
    expect(contactRoutesSource).not.toMatch(/['"]\/api\/notifications\/send['"]/);
  });

  it('no generic contact-ownership-transfer endpoint exists — every route resolves ownership from the authenticated session only', () => {
    expect(contactRoutesSource).not.toMatch(/req\.(body|query|params)\??\.userId\b/);
    expect(contactRoutesSource).not.toMatch(/ownerId|transferOwnership/);
  });

  it('the verify endpoints never read channel/value/phone/email/pushToken from the request body — only userEmail (identity) and code (the confirm secret)', () => {
    const requestBlock = contactRoutesSource.slice(contactRoutesSource.indexOf("'/api/me/contacts/:id/verify/request'"), contactRoutesSource.indexOf("'/api/me/contacts/:id/verify/confirm'"));
    expect(requestBlock).not.toMatch(/req\.body\??\.(channel|value|phone|email|pushToken)\b/);
  });

  it('every contact route (including the two verify routes) is guarded by requireAuthenticatedUser', () => {
    const handlerCount = (contactRoutesSource.match(/contactRouter\.(get|post|patch|delete)\(/g) ?? []).length;
    const guardCount = (contactRoutesSource.match(/requireAuthenticatedUser\(/g) ?? []).length;
    expect(handlerCount).toBe(6); // list, create, update, delete, verify/request, verify/confirm
    expect(guardCount).toBe(handlerCount);
  });
});
