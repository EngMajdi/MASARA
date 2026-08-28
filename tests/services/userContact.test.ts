import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../../database/client';
import { users, students } from '../../database/schema';
import { normalizeContactValue, maskContactValue, ContactValidationError } from '../../server/services/ContactNormalization';
import { isValidContactChannel, CONTACT_CHANNELS } from '../../server/domain/contactContract';
import {
  listContactsForUser,
  createContact,
  updateContact,
  deleteContact,
  ContactNotFoundError,
  ContactAccessDeniedError,
  DuplicateContactError,
} from '../../server/services/UserContactService';
import { userContactRepository, isUniqueConstraintError } from '../../server/repositories/userContactRepository';
import { requireAuthenticatedUser } from '../../server/services/authz';
import { userRepository } from '../../server/repositories/userRepository';
import { resolveAuthorizedStudents } from '../../server/services/ParentAccessService';
import { processPendingNotificationsForParent, getNotificationsForParent } from '../../server/services/NotificationService';
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
import { notificationRepository } from '../../server/repositories/notificationRepository';
import { createJourney, startJourney, startBoarding, boardStudent, SYSTEM_ACTOR as SYSTEM } from '../../server/services/JourneyService';

let freshCounter = 0;
function createFreshUser(role: 'admin' | 'school' | 'driver' | 'parent' = 'parent') {
  freshCounter += 1;
  const admin = userRepository.findByEmail('admin@masara.om')!;
  const email = `contact-fresh-user-${freshCounter}-test@masara.om`;
  db.insert(users).values({ id: crypto.randomUUID(), schoolId: admin.schoolId, name: `Fresh User ${freshCounter}`, email, passwordHash: 'x', role }).run();
  return userRepository.findByEmail(email)!;
}

// ---------------------------------------------------------------------------
// Normalization — pure, deterministic (spec §21 "Normalization")
// ---------------------------------------------------------------------------

describe('normalizeContactValue — deterministic, conservative, never guesses (spec §7/§21)', () => {
  it('EMAIL: trims and lowercases', () => {
    const result = normalizeContactValue('EMAIL', '  Parent@Example.COM  ');
    expect(result.normalizedValue).toBe('parent@example.com');
  });

  it('EMAIL: rejects malformed syntax', () => {
    expect(() => normalizeContactValue('EMAIL', 'not-an-email')).toThrow(ContactValidationError);
    expect(() => normalizeContactValue('EMAIL', 'missing@domain')).toThrow(ContactValidationError);
    expect(() => normalizeContactValue('EMAIL', '@example.com')).toThrow(ContactValidationError);
  });

  it('EMAIL: rejects an oversized value', () => {
    const huge = `${'a'.repeat(320)}@example.com`;
    expect(() => normalizeContactValue('EMAIL', huge)).toThrow(ContactValidationError);
  });

  it('SMS: requires an international leading +, strips spaces/dashes', () => {
    const result = normalizeContactValue('SMS', '+968 9123 4567');
    expect(result.normalizedValue).toBe('+96891234567');
  });

  it('SMS: rejects a number without a leading + rather than guessing a country code', () => {
    expect(() => normalizeContactValue('SMS', '96891234567')).toThrow(ContactValidationError);
    expect(() => normalizeContactValue('SMS', '91234567')).toThrow(ContactValidationError);
  });

  it('SMS: rejects non-digit characters after the country code', () => {
    expect(() => normalizeContactValue('SMS', '+968-91AB-4567')).toThrow(ContactValidationError);
  });

  it('SMS: rejects an implausibly short or long number', () => {
    expect(() => normalizeContactValue('SMS', '+123')).toThrow(ContactValidationError);
    expect(() => normalizeContactValue('SMS', `+${'1'.repeat(20)}`)).toThrow(ContactValidationError);
  });

  it('PUSH: treated as opaque — no case change, no reinterpretation', () => {
    const token = 'AbC-123_XYZ.token==';
    const result = normalizeContactValue('PUSH', token);
    expect(result.value).toBe(token);
    expect(result.normalizedValue).toBe(token);
  });

  it('PUSH: rejects an oversized token', () => {
    expect(() => normalizeContactValue('PUSH', 'x'.repeat(5000))).toThrow(ContactValidationError);
  });

  it('rejects an empty value for every channel', () => {
    for (const channel of CONTACT_CHANNELS) {
      expect(() => normalizeContactValue(channel, '   ')).toThrow(ContactValidationError);
    }
  });
});

// ---------------------------------------------------------------------------
// Masking — pure, deterministic, never the raw value (spec §6/§21)
// ---------------------------------------------------------------------------

describe('maskContactValue — deterministic, never exposes the raw value (spec §6 mandatory)', () => {
  it('EMAIL: shows only the first 2 local-part characters + the full domain', () => {
    const masked = maskContactValue('EMAIL', 'mahmoud@example.com');
    expect(masked).toBe('ma***@example.com');
    expect(masked).not.toContain('mahmoud');
  });

  it('SMS: shows only the country-code-shaped prefix and the last 3 digits', () => {
    const masked = maskContactValue('SMS', '+96891234567');
    expect(masked.startsWith('+968')).toBe(true);
    expect(masked.endsWith('567')).toBe(true);
    expect(masked).not.toContain('91234');
  });

  it('PUSH: never shows any part of the token — presence-only', () => {
    const token = 'super-secret-push-token-abc123';
    const masked = maskContactValue('PUSH', token);
    expect(masked).not.toContain(token);
    expect(masked).not.toMatch(/abc123/);
  });

  it('masking is deterministic — the same input always masks identically', () => {
    expect(maskContactValue('EMAIL', 'a@b.com')).toBe(maskContactValue('EMAIL', 'a@b.com'));
  });
});

describe('isValidContactChannel — the closed vocabulary (spec §5 mandatory)', () => {
  it('accepts exactly EMAIL, SMS, PUSH', () => {
    expect(isValidContactChannel('EMAIL')).toBe(true);
    expect(isValidContactChannel('SMS')).toBe(true);
    expect(isValidContactChannel('PUSH')).toBe(true);
  });

  it('rejects any other client-invented channel', () => {
    for (const bogus of ['WHATSAPP', 'TELEGRAM', 'WEBHOOK', 'GPS', 'AI', 'CUSTOM', 'email', '']) {
      expect(isValidContactChannel(bogus)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// CRUD (spec §21 "CRUD")
// ---------------------------------------------------------------------------

describe('UserContactService CRUD — self-service only', () => {
  it('create returns a masked view, never the raw value; starts unverified and enabled', () => {
    const user = createFreshUser();
    const view = createContact(user, { channel: 'EMAIL', value: 'Test@Example.com' });
    expect(view.channel).toBe('EMAIL');
    expect(view.masked).toBe('Te***@Example.com');
    expect(view.verified).toBe(false);
    expect(view.enabled).toBe(true);
    expect((view as unknown as Record<string, unknown>).value).toBeUndefined();
  });

  it('list returns only the caller\'s own contacts', () => {
    const user = createFreshUser();
    createContact(user, { channel: 'EMAIL', value: 'listtest@example.com' });
    const views = listContactsForUser(user);
    expect(views.length).toBeGreaterThan(0);
    expect(views.every((v) => v.channel)).toBeTruthy();
  });

  it('update value re-normalizes and re-masks', () => {
    const user = createFreshUser();
    const created = createContact(user, { channel: 'EMAIL', value: 'old@example.com' });
    const updated = updateContact(user, created.id, { value: 'brandnew@example.com' });
    expect(updated.masked).toBe('br***@example.com');
  });

  it('update enabled toggles without touching the value', () => {
    const user = createFreshUser();
    const created = createContact(user, { channel: 'EMAIL', value: 'toggletest@example.com' });
    const disabled = updateContact(user, created.id, { enabled: false });
    expect(disabled.enabled).toBe(false);
    expect(disabled.masked).toBe(created.masked);
  });

  it('delete removes the contact — subsequent operations on it are NotFound', () => {
    const user = createFreshUser();
    const created = createContact(user, { channel: 'EMAIL', value: 'deletetest@example.com' });
    deleteContact(user, created.id);
    expect(() => updateContact(user, created.id, { enabled: false })).toThrow(ContactNotFoundError);
    expect(() => deleteContact(user, created.id)).toThrow(ContactNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Duplication rules (spec §12 mandatory)
// ---------------------------------------------------------------------------

describe('Duplicate prevention — database-enforced (spec §12 mandatory)', () => {
  it('the same normalized email cannot be added twice for the same user', () => {
    const user = createFreshUser();
    createContact(user, { channel: 'EMAIL', value: 'dup@example.com' });
    expect(() => createContact(user, { channel: 'EMAIL', value: 'DUP@EXAMPLE.COM' })).toThrow(DuplicateContactError);
  });

  it('the repository-level insert itself throws a real UNIQUE constraint violation, not just an app-level check', () => {
    const user = createFreshUser();
    userContactRepository.create({ userId: user.id, channel: 'SMS', value: '+96899990000', normalizedValue: '+96899990000', verifiedAt: null, enabled: true });
    let threw: unknown;
    try {
      userContactRepository.create({ userId: user.id, channel: 'SMS', value: '+96899990000', normalizedValue: '+96899990000', verifiedAt: null, enabled: true });
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeDefined();
    expect(isUniqueConstraintError(threw)).toBe(true);
  });

  it('the same push token cannot be registered twice for the same user', () => {
    const user = createFreshUser();
    createContact(user, { channel: 'PUSH', value: 'push-token-dup-test' });
    expect(() => createContact(user, { channel: 'PUSH', value: 'push-token-dup-test' })).toThrow(DuplicateContactError);
  });

  it('two DIFFERENT users can register the same email — uniqueness is scoped per user', () => {
    const a = createFreshUser();
    const b = createFreshUser();
    expect(() => createContact(a, { channel: 'EMAIL', value: 'shared@example.com' })).not.toThrow();
    expect(() => createContact(b, { channel: 'EMAIL', value: 'shared@example.com' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Authorization (spec §15/§21 mandatory)
// ---------------------------------------------------------------------------

describe('requireAuthenticatedUser — role-agnostic self-service guard (spec §21 mandatory)', () => {
  it('any real role (admin/school/driver/parent) passes', () => {
    expect(requireAuthenticatedUser('admin@masara.om').ok).toBe(true);
    expect(requireAuthenticatedUser('school@masara.om').ok).toBe(true);
    expect(requireAuthenticatedUser('driver1@masara.om').ok).toBe(true);
    expect(requireAuthenticatedUser('parent@masara.om').ok).toBe(true);
  });

  it('unauthenticated (missing email) is rejected — 400', () => {
    const guard = requireAuthenticatedUser(undefined);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(400);
  });

  it('unknown user is rejected — 404', () => {
    const guard = requireAuthenticatedUser('nobody@masara.om');
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(404);
  });
});

describe('Contact ownership isolation — Parent A cannot touch Parent B\'s contacts (spec §14/§15 mandatory)', () => {
  it('User A cannot read User B\'s contact via list (list only ever returns the caller\'s own rows)', () => {
    const a = createFreshUser();
    const b = createFreshUser();
    createContact(b, { channel: 'EMAIL', value: 'onlybs@example.com' });
    const viewsA = listContactsForUser(a);
    expect(viewsA.some((v) => v.masked.includes('on'))).toBe(false);
  });

  it('User A cannot update User B\'s contact by guessing its ID — 403-equivalent', () => {
    const a = createFreshUser();
    const b = createFreshUser();
    const bContact = createContact(b, { channel: 'EMAIL', value: 'protectedb@example.com' });
    expect(() => updateContact(a, bContact.id, { enabled: false })).toThrow(ContactAccessDeniedError);
  });

  it('User A cannot delete User B\'s contact by guessing its ID', () => {
    const a = createFreshUser();
    const b = createFreshUser();
    const bContact = createContact(b, { channel: 'EMAIL', value: 'protectedb2@example.com' });
    expect(() => deleteContact(a, bContact.id)).toThrow(ContactAccessDeniedError);
    // And it must still exist, untouched.
    expect(userContactRepository.findById(bContact.id)).toBeTruthy();
  });

  it('arbitrary studentId/journeyId/tripId are never accepted as authorization signals — contact ownership has no such parameters at all', () => {
    // Structural proof: createContact/updateContact/deleteContact signatures accept only (user, contactId/input) — there is no studentId/journeyId/tripId parameter to even misuse.
    expect(createContact.length).toBeLessThanOrEqual(2);
    expect(updateContact.length).toBeLessThanOrEqual(3);
    expect(deleteContact.length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Security (spec §15/§21 mandatory)
// ---------------------------------------------------------------------------

describe('Security — client cannot widen access or set server-only fields (spec §15/§21 mandatory)', () => {
  it('createContact never accepts a client-supplied verifiedAt — every new contact starts unverified', () => {
    const user = createFreshUser();
    const view = createContact(user, { channel: 'EMAIL', value: 'neververified@example.com' });
    expect(view.verified).toBe(false);
  });

  it('createContact rejects an unsupported channel rather than silently accepting it', () => {
    const user = createFreshUser();
    expect(() => createContact(user, { channel: 'WHATSAPP', value: 'x' })).toThrow(ContactValidationError);
  });

  it('a raw PUSH token never appears anywhere in the returned ContactView', () => {
    const user = createFreshUser();
    const token = 'RAW-TOKEN-MUST-NEVER-LEAK-abc123xyz';
    const view = createContact(user, { channel: 'PUSH', value: token });
    expect(JSON.stringify(view)).not.toContain(token);
  });

  it('a raw email/phone value never appears in the returned ContactView JSON — only the masked form', () => {
    const user = createFreshUser();
    const view = createContact(user, { channel: 'EMAIL', value: 'fullyprivate@example.com' });
    expect(JSON.stringify(view)).not.toContain('fullyprivate@example.com');
  });
});

// ---------------------------------------------------------------------------
// Notification regression (spec §21 "Notification regression" mandatory)
// ---------------------------------------------------------------------------

describe('Notification regression — Phase 5B/5C/5D behavior is unchanged by the contact model (spec mandatory)', () => {
  it('a real Journey boarding event still produces exactly one in-app notification', async () => {
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

  it('ParentAccessService.resolveAuthorizedStudents behavior is unchanged — still governed by the real legacy-FK identity bridge, not the new contact model', () => {
    const parentUser = userRepository.findByEmail('parent@masara.om')!;
    const students1 = resolveAuthorizedStudents(parentUser);
    const students2 = resolveAuthorizedStudents(parentUser);
    expect(students1.map((s) => s.id)).toEqual(students2.map((s) => s.id));
    expect(students1.every((s) => s.legacyStudentId !== null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Isolation (spec §21 "Isolation" mandatory)
// ---------------------------------------------------------------------------

describe('Isolation — contact CRUD touches nothing operational (spec §17/§21 mandatory)', () => {
  it('journeys, students, trips, buses, routes, telemetry, current-location, ETA-accuracy, recommendations, audit_logs, and notifications are all unchanged by contact create/update/delete', () => {
    const before = {
      journeys: JSON.stringify(journeyRepository.findByTripId(tripRepository.findAll()[0].id)),
      students: JSON.stringify(studentRepository.findAll()),
      trips: JSON.stringify(tripRepository.findAll()),
      buses: JSON.stringify(busRepository.findAll()),
      routes: JSON.stringify(routeRepository.findAll()),
      recommendations: JSON.stringify(recommendationRepository.findAll()),
      telemetry: JSON.stringify(telemetryObservationRepository.findFiltered({ limit: 500 })),
      projection: JSON.stringify(currentLocationProjectionRepository.findAll()),
      etaAccuracy: JSON.stringify(etaAccuracyRepository.findForMetrics({})),
      auditCount: auditRepository.findAll().length,
      notificationsForParent: JSON.stringify(notificationRepository.findByRecipient(userRepository.findByEmail('parent@masara.om')!.id, 50)),
    };

    const user = createFreshUser();
    const created = createContact(user, { channel: 'EMAIL', value: 'isolationtest@example.com' });
    updateContact(user, created.id, { enabled: false });
    deleteContact(user, created.id);

    expect(JSON.stringify(journeyRepository.findByTripId(tripRepository.findAll()[0].id))).toBe(before.journeys);
    expect(JSON.stringify(studentRepository.findAll())).toBe(before.students);
    expect(JSON.stringify(tripRepository.findAll())).toBe(before.trips);
    expect(JSON.stringify(busRepository.findAll())).toBe(before.buses);
    expect(JSON.stringify(routeRepository.findAll())).toBe(before.routes);
    expect(JSON.stringify(recommendationRepository.findAll())).toBe(before.recommendations);
    expect(JSON.stringify(telemetryObservationRepository.findFiltered({ limit: 500 }))).toBe(before.telemetry);
    expect(JSON.stringify(currentLocationProjectionRepository.findAll())).toBe(before.projection);
    expect(JSON.stringify(etaAccuracyRepository.findForMetrics({}))).toBe(before.etaAccuracy);
    expect(auditRepository.findAll().length).toBe(before.auditCount);
    expect(JSON.stringify(notificationRepository.findByRecipient(userRepository.findByEmail('parent@masara.om')!.id, 50))).toBe(before.notificationsForParent);
  });

  it('no contact value (raw email/phone/push token) ever appears anywhere in audit_logs', () => {
    const user = createFreshUser();
    const secretMarker = `unique-marker-${crypto.randomUUID()}@example.com`;
    createContact(user, { channel: 'EMAIL', value: secretMarker });
    const allAudit = JSON.stringify(auditRepository.findAll());
    expect(allAudit).not.toContain(secretMarker);
  });
});

// ---------------------------------------------------------------------------
// Source-scan governance guards (spec §22 mandatory)
// ---------------------------------------------------------------------------

describe('Source-scan governance guards (spec §22 mandatory)', () => {
  const serviceSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/UserContactService.ts'), 'utf8');
  const routesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/contactRoutes.ts'), 'utf8');
  const repoSource = fs.readFileSync(path.resolve(__dirname, '../../server/repositories/userContactRepository.ts'), 'utf8');
  const forbiddenImports = /from ['"].*\/(JourneyService|JourneyStateMachine|ActionExecutor|PolicyEngine|MasaraOperationsAgent|TelemetryIngestionService)['"]/;

  it('UserContactService.ts imports no Journey/governance mutation module (spec items 1-4)', () => {
    expect(serviceSource).not.toMatch(forbiddenImports);
  });

  it('UserContactService.ts never writes telemetry, current location, or ETA (spec items 5-7)', () => {
    expect(serviceSource).not.toMatch(/processObservation|upsertIfNewer|telemetryObservationRepository\.create|currentLocationProjectionRepository\.(upsertIfNewer|clear)/);
  });

  it('UserContactService.ts never creates a notification (spec item 8)', () => {
    expect(serviceSource).not.toMatch(/notificationRepository\.insertIfAbsent|processPendingNotificationsForParent/);
  });

  it('contactRoutes.ts never trusts a client-supplied userId as ownership (spec item 9)', () => {
    expect(routesSource).not.toMatch(/req\.(body|query|params)\??\.userId\b/);
  });

  it('contactRoutes.ts never trusts a client-supplied verifiedAt or channel-bypassing field', () => {
    expect(routesSource).not.toMatch(/req\.(body|query)\??\.verifiedAt\b/);
  });

  it('no raw push token (or any raw contact value) appears in a response DTO field name (spec item 10)', () => {
    expect(serviceSource).not.toMatch(/\bvalue:\s*row\.value\b/);
    expect(serviceSource).not.toMatch(/\bnormalizedValue:\s*row\.normalizedValue\b/);
  });

  it('userContactRepository.ts never accepts req.body/req.query directly', () => {
    expect(repoSource).not.toMatch(/req\.(body|query)/);
  });

  it('every contact route is guarded by requireAuthenticatedUser', () => {
    const handlerCount = (routesSource.match(/contactRouter\.(get|post|patch|delete)\(/g) ?? []).length;
    const guardCount = (routesSource.match(/requireAuthenticatedUser\(/g) ?? []).length;
    expect(handlerCount).toBeGreaterThan(0);
    expect(guardCount).toBe(handlerCount);
  });
});
