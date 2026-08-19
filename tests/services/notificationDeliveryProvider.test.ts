import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../../database/client';
import { students, users } from '../../database/schema';
import { InAppNotificationProvider, type NotificationDeliveryPayload, type NotificationDeliveryProvider } from '../../server/services/NotificationDeliveryProvider';
import { PushNotificationProvider } from '../../server/services/PushNotificationProvider';
import { SmsNotificationProvider } from '../../server/services/SmsNotificationProvider';
import { EmailNotificationProvider } from '../../server/services/EmailNotificationProvider';
import { deliverToAllChannels } from '../../server/services/NotificationDeliveryManager';
import { processPendingNotificationsForParent, getNotificationsForParent } from '../../server/services/NotificationService';
import { notificationRepository } from '../../server/repositories/notificationRepository';
import { resolveAuthorizedStudents } from '../../server/services/ParentAccessService';
import { DEMO_PARENT_PHONE_BY_EMAIL } from '../../server/domain/parentAccessContract';
import { requireParentUser } from '../../server/services/authz';
import { userRepository } from '../../server/repositories/userRepository';
import { journeyRepository } from '../../server/repositories/journeyRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { routeRepository } from '../../server/repositories/routeRepository';
import { studentRepository } from '../../server/repositories/studentRepository';
import { auditRepository } from '../../server/repositories/auditRepository';
import { recommendationRepository } from '../../server/repositories/recommendationRepository';
import { telemetryObservationRepository } from '../../server/repositories/telemetryObservationRepository';
import { currentLocationProjectionRepository } from '../../server/repositories/currentLocationProjectionRepository';
import { getJourneyTimeline, createJourney, startJourney, startBoarding, boardStudent, type JourneyActor } from '../../server/services/JourneyService';

const SYSTEM: JourneyActor = { actorId: null, actorType: 'system' };

beforeEach(() => {
  currentLocationProjectionRepository.clear();
});

let freshCounter = 0;
function createFreshAuthorizedChild() {
  freshCounter += 1;
  const admin = userRepository.findByEmail('admin@masara.om')!;
  const bus = busRepository.findAll()[0];
  const phone = `+968 9700 ${String(freshCounter).padStart(4, '0')}`;
  const email = `delivery-fresh-parent-${freshCounter}-test@masara.om`;

  db.insert(students)
    .values({
      id: crypto.randomUUID(),
      schoolId: admin.schoolId!,
      name: `طالب اختبار تسليم ${freshCounter}`,
      grade: 'الأول',
      busId: bus.id,
      pickupLat: 23.6,
      pickupLng: 58.4,
      pickupAddress: 'test',
      parentPhone: phone,
    })
    .run();
  db.insert(users).values({ id: crypto.randomUUID(), schoolId: admin.schoolId, name: `Delivery Fresh Parent ${freshCounter}`, email, passwordHash: 'x', role: 'parent' }).run();
  (DEMO_PARENT_PHONE_BY_EMAIL as Record<string, string>)[email] = phone;

  const parentUser = userRepository.findByEmail(email)!;
  const student = resolveAuthorizedStudents(parentUser)[0];
  const trip = tripRepository.findAll().find((t) => t.busId === student.busId)!;
  return { parentUser, student, trip };
}

function makePayload(notificationId: string, recipient: { userId: string; email: string; name: string }): NotificationDeliveryPayload {
  return { notificationId, title: 'عنوان اختبار', body: 'نص اختبار', priority: 'NORMAL', recipient };
}

// ---------------------------------------------------------------------------
// 1. InAppNotificationProvider — the one real provider (spec mandatory #1)
// ---------------------------------------------------------------------------

describe('InAppNotificationProvider — the one real provider (spec mandatory item 1)', () => {
  it('delivering a real notification row succeeds and marks it SENT', async () => {
    const { parentUser, student, trip } = createFreshAuthorizedChild();
    const journey = journeyRepository.create({ studentId: student.id, tripId: trip.id, state: 'scheduled' });
    const id = notificationRepository.insertIfAbsent({
      recipientUserId: parentUser.id,
      studentId: student.id,
      journeyId: journey.id,
      tripId: trip.id,
      eventType: 'STUDENT_BOARDED',
      sourceEventId: 'inapp-provider-test-1',
      category: 'BOARDING',
      title: 't',
      body: 'b',
      priority: 'NORMAL',
    })!;

    const result = await InAppNotificationProvider.deliver(makePayload(id, { userId: parentUser.id, email: parentUser.email, name: parentUser.name }));
    expect(result.outcome).toBe('SUCCESS');
    const row = notificationRepository.findById(id)!;
    expect(row.status).toBe('SENT');
    expect(row.sentAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2/3/4. External providers are honest boundaries — never fabricate
// delivery (spec mandatory items 2, 3, 4, and the "never claim SUCCESS"
// architectural success criterion).
// ---------------------------------------------------------------------------

describe('External providers are honest boundaries — never fabricate delivery (spec mandatory)', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = ['NOTIFICATION_PUSH_ENABLED', 'PUSH_PROVIDER_API_KEY', 'NOTIFICATION_SMS_ENABLED', 'SMS_PROVIDER_API_KEY', 'NOTIFICATION_EMAIL_ENABLED', 'EMAIL_PROVIDER_API_KEY'];

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  const payload = makePayload('irrelevant-notification-id', { userId: 'u1', email: 'parent@masara.om', name: 'Test Parent' });

  it('PUSH: disabled by default -> SKIPPED (no attempt at all)', async () => {
    expect((await PushNotificationProvider.deliver(payload)).outcome).toBe('SKIPPED');
  });
  it('PUSH: enabled but no credentials -> UNAVAILABLE (spec mandatory item 2)', async () => {
    process.env.NOTIFICATION_PUSH_ENABLED = 'true';
    expect((await PushNotificationProvider.deliver(payload)).outcome).toBe('UNAVAILABLE');
  });
  it('PUSH: enabled + credentials present -> still UNAVAILABLE — no real vendor SDK is integrated', async () => {
    process.env.NOTIFICATION_PUSH_ENABLED = 'true';
    process.env.PUSH_PROVIDER_API_KEY = 'fake-test-key';
    expect((await PushNotificationProvider.deliver(payload)).outcome).toBe('UNAVAILABLE');
  });

  it('SMS: disabled by default -> SKIPPED', async () => {
    expect((await SmsNotificationProvider.deliver(payload)).outcome).toBe('SKIPPED');
  });
  it('SMS: enabled but no credentials -> UNAVAILABLE (spec mandatory item 3)', async () => {
    process.env.NOTIFICATION_SMS_ENABLED = 'true';
    expect((await SmsNotificationProvider.deliver(payload)).outcome).toBe('UNAVAILABLE');
  });

  it('EMAIL: disabled by default -> SKIPPED', async () => {
    expect((await EmailNotificationProvider.deliver(payload)).outcome).toBe('SKIPPED');
  });
  it('EMAIL: enabled but no credentials -> UNAVAILABLE (spec mandatory item 4)', async () => {
    process.env.NOTIFICATION_EMAIL_ENABLED = 'true';
    expect((await EmailNotificationProvider.deliver(payload)).outcome).toBe('UNAVAILABLE');
  });

  it('none of the three external providers ever return SUCCESS under any configuration', async () => {
    process.env.NOTIFICATION_PUSH_ENABLED = 'true';
    process.env.PUSH_PROVIDER_API_KEY = 'x';
    process.env.NOTIFICATION_SMS_ENABLED = 'true';
    process.env.SMS_PROVIDER_API_KEY = 'x';
    process.env.NOTIFICATION_EMAIL_ENABLED = 'true';
    process.env.EMAIL_PROVIDER_API_KEY = 'x';
    for (const provider of [PushNotificationProvider, SmsNotificationProvider, EmailNotificationProvider]) {
      expect((await provider.deliver(payload)).outcome).not.toBe('SUCCESS');
    }
  });

  it('external providers never touch the database at all (pure functions — cannot corrupt notification state)', async () => {
    const before = notificationRepository.findByRecipient('u1').length;
    await PushNotificationProvider.deliver(payload);
    await SmsNotificationProvider.deliver(payload);
    await EmailNotificationProvider.deliver(payload);
    expect(notificationRepository.findByRecipient('u1').length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// NotificationDeliveryManager — orchestration + failure isolation
// (spec mandatory item 5, and "Delivery Orchestration" / "Failure Behavior")
// ---------------------------------------------------------------------------

describe('NotificationDeliveryManager — orchestrates every channel, isolates failures (spec mandatory)', () => {
  it('deliverToAllChannels returns a result for exactly the 4 known channels, IN_APP succeeding, others SKIPPED by default', async () => {
    const { parentUser, student, trip } = createFreshAuthorizedChild();
    const journey = journeyRepository.create({ studentId: student.id, tripId: trip.id, state: 'scheduled' });
    const id = notificationRepository.insertIfAbsent({
      recipientUserId: parentUser.id,
      studentId: student.id,
      journeyId: journey.id,
      tripId: trip.id,
      eventType: 'STUDENT_BOARDED',
      sourceEventId: 'delivery-manager-test-1',
      category: 'BOARDING',
      title: 't',
      body: 'b',
      priority: 'NORMAL',
    })!;

    const results = await deliverToAllChannels(makePayload(id, { userId: parentUser.id, email: parentUser.email, name: parentUser.name }));
    expect(results.map((r) => r.channel).sort()).toEqual(['EMAIL', 'IN_APP', 'PUSH', 'SMS']);
    expect(results.find((r) => r.channel === 'IN_APP')!.outcome).toBe('SUCCESS');
    expect(results.find((r) => r.channel === 'PUSH')!.outcome).toBe('SKIPPED');
    expect(results.find((r) => r.channel === 'SMS')!.outcome).toBe('SKIPPED');
    expect(results.find((r) => r.channel === 'EMAIL')!.outcome).toBe('SKIPPED');
  });

  it('a throwing provider is caught and reported FAILED for that channel only — other channels still run (spec mandatory item 5, "fail safely")', async () => {
    const throwingProvider: NotificationDeliveryProvider = {
      channel: 'PUSH',
      deliver() {
        throw new Error('اختبار: مزود معطل عمداً');
      },
    };
    const okProvider: NotificationDeliveryProvider = { channel: 'EMAIL', deliver: async () => ({ outcome: 'SKIPPED' }) };

    const results = await deliverToAllChannels(makePayload('any-id', { userId: 'u', email: 'e', name: 'n' }), [throwingProvider, InAppNotificationProvider, okProvider]);
    expect(results.find((r) => r.channel === 'PUSH')!.outcome).toBe('FAILED');
    // InAppNotificationProvider still ran despite the earlier provider throwing.
    expect(results.some((r) => r.channel === 'IN_APP')).toBe(true);
    expect(results.find((r) => r.channel === 'EMAIL')!.outcome).toBe('SKIPPED');
  });

  it('provider failure never deletes or otherwise mutates the notification row (spec mandatory item 5)', async () => {
    const { parentUser, student, trip } = createFreshAuthorizedChild();
    const journey = journeyRepository.create({ studentId: student.id, tripId: trip.id, state: 'scheduled' });
    const id = notificationRepository.insertIfAbsent({
      recipientUserId: parentUser.id,
      studentId: student.id,
      journeyId: journey.id,
      tripId: trip.id,
      eventType: 'STUDENT_BOARDED',
      sourceEventId: 'delivery-manager-test-2',
      category: 'BOARDING',
      title: 't',
      body: 'b',
      priority: 'NORMAL',
    })!;
    const before = notificationRepository.findById(id)!;

    const throwingProvider: NotificationDeliveryProvider = {
      channel: 'PUSH',
      deliver() {
        throw new Error('اختبار');
      },
    };
    await deliverToAllChannels(makePayload(id, { userId: parentUser.id, email: parentUser.email, name: parentUser.name }), [throwingProvider]);

    const after = notificationRepository.findById(id)!;
    expect(after.id).toBe(before.id);
    expect(after.title).toBe(before.title);
    expect(after.body).toBe(before.body);
  });
});

// ---------------------------------------------------------------------------
// Retry / duplicate prevention (spec mandatory items 11, 12)
// ---------------------------------------------------------------------------

describe('Retry / idempotency — delivery never creates a second notification row (spec mandatory items 11, 12)', () => {
  it('calling deliverToAllChannels twice for the same notificationId never creates another notification row', async () => {
    const { parentUser, student, trip } = createFreshAuthorizedChild();
    const journey = journeyRepository.create({ studentId: student.id, tripId: trip.id, state: 'scheduled' });
    const id = notificationRepository.insertIfAbsent({
      recipientUserId: parentUser.id,
      studentId: student.id,
      journeyId: journey.id,
      tripId: trip.id,
      eventType: 'STUDENT_BOARDED',
      sourceEventId: 'retry-test-1',
      category: 'BOARDING',
      title: 't',
      body: 'b',
      priority: 'NORMAL',
    })!;
    const recipient = { userId: parentUser.id, email: parentUser.email, name: parentUser.name };

    await deliverToAllChannels(makePayload(id, recipient));
    await deliverToAllChannels(makePayload(id, recipient)); // retry
    await deliverToAllChannels(makePayload(id, recipient)); // retry again

    expect(notificationRepository.findByRecipient(parentUser.id).filter((n) => n.sourceEventId === 'retry-test-1')).toHaveLength(1);
  });

  it('full end-to-end: processing the same real Journey event three times produces exactly one notification, delivered once', async () => {
    const { parentUser, student, trip } = createFreshAuthorizedChild();
    let journey = createJourney(student.id, trip.id, SYSTEM);
    journey = startJourney(journey.id, SYSTEM);
    startBoarding(journey.id, SYSTEM);
    boardStudent(journey.id, SYSTEM);

    await processPendingNotificationsForParent(parentUser);
    await processPendingNotificationsForParent(parentUser);
    await processPendingNotificationsForParent(parentUser);

    const notifs = (await getNotificationsForParent(parentUser)).filter((n) => n.studentId === student.id);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].status).toBe('SENT');
  });
});

// ---------------------------------------------------------------------------
// Isolation — provider/delivery failure and normal delivery never touch
// operational state (spec mandatory items 6, 7, 8, 18, 19, 20)
// ---------------------------------------------------------------------------

describe('Isolation — delivery (including a failing provider) never mutates operational state (spec mandatory items 6, 7, 8, 18, 19, 20)', () => {
  it('journeys, trips, buses, students, routes, telemetry_observations, current_location_projection, recommendations, audit_logs, and Journey Timeline are all unchanged', async () => {
    const { parentUser, student, trip } = createFreshAuthorizedChild();
    let journey = createJourney(student.id, trip.id, SYSTEM);
    journey = startJourney(journey.id, SYSTEM);
    startBoarding(journey.id, SYSTEM);
    journey = boardStudent(journey.id, SYSTEM);

    const before = {
      auditCount: auditRepository.findAll().length,
      journeys: JSON.stringify(journeyRepository.findByStudentId(student.id)),
      trips: JSON.stringify(tripRepository.findAll()),
      buses: JSON.stringify(busRepository.findAll()),
      students: JSON.stringify(studentRepository.findAll()),
      routes: JSON.stringify(routeRepository.findAll()),
      recommendations: JSON.stringify(recommendationRepository.findAll()),
      telemetry: JSON.stringify(telemetryObservationRepository.findFiltered({ limit: 500 })),
      projection: JSON.stringify(currentLocationProjectionRepository.findAll()),
      timeline: JSON.stringify(getJourneyTimeline(journey.id)),
    };

    // Normal delivery path (real providers, including the always-unavailable external ones).
    await processPendingNotificationsForParent(parentUser);
    // And a delivery attempt with a throwing provider mixed in, for good measure.
    const notif = (await getNotificationsForParent(parentUser)).find((n) => n.studentId === student.id)!;
    const throwingProvider: NotificationDeliveryProvider = { channel: 'PUSH', deliver: () => { throw new Error('اختبار'); } };
    await deliverToAllChannels(makePayload(notif.id, { userId: parentUser.id, email: parentUser.email, name: parentUser.name }), [throwingProvider, InAppNotificationProvider]);

    expect(auditRepository.findAll().length).toBe(before.auditCount);
    expect(JSON.stringify(journeyRepository.findByStudentId(student.id))).toBe(before.journeys);
    expect(JSON.stringify(tripRepository.findAll())).toBe(before.trips);
    expect(JSON.stringify(busRepository.findAll())).toBe(before.buses);
    expect(JSON.stringify(studentRepository.findAll())).toBe(before.students);
    expect(JSON.stringify(routeRepository.findAll())).toBe(before.routes);
    expect(JSON.stringify(recommendationRepository.findAll())).toBe(before.recommendations); // item 8: no AI recommendation created
    expect(JSON.stringify(telemetryObservationRepository.findFiltered({ limit: 500 }))).toBe(before.telemetry); // item 7
    expect(JSON.stringify(currentLocationProjectionRepository.findAll())).toBe(before.projection);
    expect(JSON.stringify(getJourneyTimeline(journey.id))).toBe(before.timeline); // item 19: Journey Timeline unchanged
  });
});

// ---------------------------------------------------------------------------
// Security matrix re-confirmed through the new delivery-manager-wired path
// (spec mandatory items 9, 10, 13-16, 28-30 — the underlying guards are
// Phase 5B's own, unmodified; these confirm the Phase 5C wiring didn't
// weaken them)
// ---------------------------------------------------------------------------

describe('Security remains enforced through the Phase 5C delivery path (spec mandatory items 9, 10, 28-30)', () => {
  it('parent authorization is still enforced end-to-end after wiring the delivery manager', () => {
    expect(requireParentUser('parent@masara.om').ok).toBe(true);
    expect(requireParentUser('driver1@masara.om').ok).toBe(false);
    expect(requireParentUser(undefined).ok).toBe(false);
  });

  it('Parent A still cannot receive Parent B\'s notifications after Phase 5C wiring', async () => {
    const a = createFreshAuthorizedChild();
    const b = createFreshAuthorizedChild();
    let journeyA = createJourney(a.student.id, a.trip.id, SYSTEM);
    journeyA = startJourney(journeyA.id, SYSTEM);
    startBoarding(journeyA.id, SYSTEM);
    boardStudent(journeyA.id, SYSTEM);
    let journeyB = createJourney(b.student.id, b.trip.id, SYSTEM);
    journeyB = startJourney(journeyB.id, SYSTEM);
    startBoarding(journeyB.id, SYSTEM);
    boardStudent(journeyB.id, SYSTEM);

    await processPendingNotificationsForParent(a.parentUser);
    await processPendingNotificationsForParent(b.parentUser);

    const viewsA = await getNotificationsForParent(a.parentUser);
    expect(viewsA.every((n) => n.studentId === a.student.id)).toBe(true);
    expect(viewsA.some((n) => n.studentId === b.student.id)).toBe(false);
  });

  it('driver, unauthenticated, and unknown-user access to notification reads remain rejected (items 28, 30)', () => {
    expect(requireParentUser('driver2@masara.om').ok).toBe(false);
    expect(requireParentUser(undefined).ok).toBe(false);
    expect(requireParentUser('nobody@masara.om').ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Source-scan governance guards (spec mandatory "Source-Scan Security Guards")
// ---------------------------------------------------------------------------

describe('Source-scan governance guards (spec mandatory) — providers cannot touch Journey/governance state', () => {
  const managerSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/NotificationDeliveryManager.ts'), 'utf8');
  const pushSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/PushNotificationProvider.ts'), 'utf8');
  const smsSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/SmsNotificationProvider.ts'), 'utf8');
  const emailSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/EmailNotificationProvider.ts'), 'utf8');
  const inAppSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/NotificationDeliveryProvider.ts'), 'utf8');
  const routesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/parentRoutes.ts'), 'utf8');
  const forbiddenImports =
    /from ['"].*\/(JourneyService|JourneyStateMachine|ActionExecutor|PolicyEngine|MasaraOperationsAgent|PredictionEngine|TelemetryIngestionService|EtaService|ApprovalCenter)['"]/;
  const forbiddenAi = /(GoogleGenAI|generateContent|LLMProvider|MockProvider)/;

  it('no provider or the delivery manager imports a Journey/governance mutation module', () => {
    for (const source of [managerSource, pushSource, smsSource, emailSource, inAppSource]) {
      expect(source).not.toMatch(forbiddenImports);
    }
  });

  it('no provider or the delivery manager imports an AI/LLM provider', () => {
    for (const source of [managerSource, pushSource, smsSource, emailSource, inAppSource]) {
      expect(source).not.toMatch(forbiddenAi);
    }
  });

  it('PUSH/SMS/EMAIL providers never import notificationRepository — they cannot touch notification state at all, only IN_APP can', () => {
    expect(pushSource).not.toMatch(/notificationRepository/);
    expect(smsSource).not.toMatch(/notificationRepository/);
    expect(emailSource).not.toMatch(/notificationRepository/);
  });

  it('no /api/notifications/send or other generic notification-creation endpoint exists', () => {
    expect(routesSource).not.toMatch(/['"]\/api\/(notifications\/send|events)['"]/);
    expect(routesSource).not.toMatch(/parentRouter\.post\(\s*['"]\/api\/parent\/notifications['"]/);
  });

  it('no public endpoint accepts arbitrary eventType/studentId/recipientUserId to create or choose a notification/provider/channel', () => {
    expect(routesSource).not.toMatch(/req\.(query|body|params)\??\.(eventType|studentId|recipientUserId|channel|provider)\b/);
  });

  it('no new public provider-management endpoint was added for Phase 5C (spec: prefer no new public API)', () => {
    expect(routesSource).not.toMatch(/['"]\/api\/parent\/notifications\/(provider|channel|deliver)/);
  });
});
