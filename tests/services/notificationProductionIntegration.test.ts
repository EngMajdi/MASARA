import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../../database/client';
import { students, users } from '../../database/schema';
import {
  EmailNotificationProvider,
  classifyEmailProviderResponse,
  classifyEmailProviderError,
  isRetryableFailure,
  type EmailProviderResponse,
} from '../../server/services/EmailNotificationProvider';
import { sanitizeProviderErrorMessage } from '../../server/services/NotificationDeliveryProvider';
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
import { etaAccuracyRepository } from '../../server/repositories/etaAccuracyRepository';
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
  const phone = `+968 9600 ${String(freshCounter).padStart(4, '0')}`;
  const email = `prod-integration-fresh-parent-${freshCounter}-test@masara.om`;

  db.insert(students)
    .values({
      id: crypto.randomUUID(),
      schoolId: admin.schoolId!,
      name: `طالب اختبار تكامل إنتاجي ${freshCounter}`,
      grade: 'الأول',
      busId: bus.id,
      pickupLat: 23.6,
      pickupLng: 58.4,
      pickupAddress: 'test',
      parentPhone: phone,
    })
    .run();
  db.insert(users).values({ id: crypto.randomUUID(), schoolId: admin.schoolId, name: `Prod Integration Fresh Parent ${freshCounter}`, email, passwordHash: 'x', role: 'parent' }).run();
  (DEMO_PARENT_PHONE_BY_EMAIL as Record<string, string>)[email] = phone;

  const parentUser = userRepository.findByEmail(email)!;
  const student = resolveAuthorizedStudents(parentUser)[0];
  const trip = tripRepository.findAll().find((t) => t.busId === student.busId)!;
  return { parentUser, student, trip };
}

// ---------------------------------------------------------------------------
// 4-8. Response/error classification — pure, deterministic, directly tested
// (spec mandatory items 4, 5, 6, 7, 8)
// ---------------------------------------------------------------------------

describe('classifyEmailProviderResponse — never converts an error into SUCCESS (spec mandatory items 4, 6, 7)', () => {
  it('a genuine 2xx response classifies as SUCCESS and surfaces providerMessageId (spec mandatory item 4)', () => {
    const response: EmailProviderResponse = { httpStatus: 200, providerMessageId: 'vendor-msg-abc123' };
    const result = classifyEmailProviderResponse(response);
    expect(result.outcome).toBe('SUCCESS');
    expect(result.providerMessageId).toBe('vendor-msg-abc123');
  });

  it('202 Accepted (a common async-email-vendor pattern) also classifies as SUCCESS', () => {
    expect(classifyEmailProviderResponse({ httpStatus: 202 }).outcome).toBe('SUCCESS');
  });

  it('a 4xx response classifies as FAILED, never SUCCESS (spec mandatory item 6)', () => {
    for (const status of [400, 401, 403, 404, 422, 429]) {
      const result = classifyEmailProviderResponse({ httpStatus: status });
      expect(result.outcome).toBe('FAILED');
    }
  });

  it('a 5xx response classifies as FAILED, never SUCCESS (spec mandatory item 7)', () => {
    for (const status of [500, 502, 503, 504]) {
      const result = classifyEmailProviderResponse({ httpStatus: status });
      expect(result.outcome).toBe('FAILED');
    }
  });

  it('never converts a missing/malformed status into SUCCESS', () => {
    expect(classifyEmailProviderResponse({ httpStatus: 0 }).outcome).toBe('FAILED');
    expect(classifyEmailProviderResponse({ httpStatus: 599 }).outcome).toBe('FAILED');
  });
});

describe('isRetryableFailure — the retry POLICY, never an automatic retry loop (spec mandatory item 7, "Retry" section)', () => {
  it('a 4xx is never retryable — a permanent client error', () => {
    expect(isRetryableFailure({ httpStatus: 400 })).toBe(false);
    expect(isRetryableFailure({ httpStatus: 401 })).toBe(false);
    expect(isRetryableFailure({ httpStatus: 422 })).toBe(false);
  });

  it('a 5xx is retryable-in-principle', () => {
    expect(isRetryableFailure({ httpStatus: 500 })).toBe(true);
    expect(isRetryableFailure({ httpStatus: 503 })).toBe(true);
  });

  it('a timeout is retryable-in-principle', () => {
    expect(isRetryableFailure({ timedOut: true })).toBe(true);
  });

  it('classification alone never triggers an actual retry — no queue/worker exists in this prototype (documented limitation, not invented infrastructure)', () => {
    // Calling the classifier twice must never itself create side effects — it's a pure function.
    const before = JSON.stringify(classifyEmailProviderResponse({ httpStatus: 503 }));
    const after = JSON.stringify(classifyEmailProviderResponse({ httpStatus: 503 }));
    expect(before).toBe(after);
  });
});

describe('classifyEmailProviderError — timeout and exception handling, always FAILED, always sanitized (spec mandatory items 5, 8, 28)', () => {
  it('a timeout classifies as FAILED (spec mandatory item 5)', () => {
    const result = classifyEmailProviderError(new Error('ECONNABORTED'), true);
    expect(result.outcome).toBe('FAILED');
  });

  it('a thrown exception classifies as FAILED (spec mandatory item 8)', () => {
    const result = classifyEmailProviderError(new Error('network unreachable'));
    expect(result.outcome).toBe('FAILED');
  });

  it('a non-Error thrown value still classifies as FAILED, never throws further', () => {
    expect(() => classifyEmailProviderError('a raw string was thrown')).not.toThrow();
    expect(classifyEmailProviderError('a raw string was thrown').outcome).toBe('FAILED');
  });

  it('an exception message containing an apparent secret is redacted before becoming a failureReason (spec mandatory item 28, "no secrets in logs")', () => {
    const result = classifyEmailProviderError(new Error('Request failed: Authorization: Bearer sk_live_abcdef1234567890'));
    expect(result.failureReason).not.toContain('sk_live_abcdef1234567890');
    expect(result.failureReason).not.toMatch(/bearer\s+sk_live/i);
  });
});

describe('sanitizeProviderErrorMessage — the shared redaction utility (spec mandatory item 28, "External Provider Security")', () => {
  it('redacts a Bearer token', () => {
    expect(sanitizeProviderErrorMessage('failed: Authorization Bearer abc123XYZ.token')).not.toContain('abc123XYZ');
  });

  it('redacts an api_key=... style credential', () => {
    expect(sanitizeProviderErrorMessage('error, api_key=sk_test_1234567890abcdef')).not.toContain('sk_test_1234567890abcdef');
  });

  it('leaves an ordinary, non-credential error message untouched', () => {
    const msg = 'مزود البريد الإلكتروني رفض الطلب (HTTP 401) — خطأ دائم لا داعي لإعادة المحاولة.';
    expect(sanitizeProviderErrorMessage(msg)).toBe(msg);
  });
});

// ---------------------------------------------------------------------------
// EmailNotificationProvider.deliver — still honest, still never SUCCESS in
// this deployment (spec mandatory items 1-3, unchanged runtime behavior)
// ---------------------------------------------------------------------------

describe('EmailNotificationProvider.deliver — the runtime boundary remains honest (spec mandatory items 2, 3)', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const KEYS = ['NOTIFICATION_EMAIL_ENABLED', 'EMAIL_PROVIDER_API_KEY'];
  beforeEach(() => {
    for (const k of KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  const payload = { notificationId: 'x', title: 't', body: 'b', priority: 'NORMAL' as const, recipient: { userId: 'u', email: 'parent@masara.om', name: 'n' } };

  it('disabled -> SKIPPED', async () => {
    expect((await EmailNotificationProvider.deliver(payload)).outcome).toBe('SKIPPED');
  });
  it('enabled, no credentials -> UNAVAILABLE (spec mandatory item 2)', async () => {
    process.env.NOTIFICATION_EMAIL_ENABLED = 'true';
    expect((await EmailNotificationProvider.deliver(payload)).outcome).toBe('UNAVAILABLE');
  });
  it('enabled + credentials present -> still UNAVAILABLE, never SUCCESS — no real transport exists (spec mandatory item 3)', async () => {
    process.env.NOTIFICATION_EMAIL_ENABLED = 'true';
    process.env.EMAIL_PROVIDER_API_KEY = 'fake-test-key-never-real';
    const result = await EmailNotificationProvider.deliver(payload);
    expect(result.outcome).toBe('UNAVAILABLE');
    expect(result.outcome).not.toBe('SUCCESS');
  });
});

// ---------------------------------------------------------------------------
// providerMessageId never leaks to the parent-facing API (spec mandatory
// item 29, "no provider credentials in API responses")
// ---------------------------------------------------------------------------

describe('The parent-facing NotificationView never carries provider internals (spec mandatory item 29)', () => {
  it('getNotificationsForParent results have no providerMessageId, no channel, no failureReason field at all', async () => {
    const { parentUser, student, trip } = createFreshAuthorizedChild();
    let journey = createJourney(student.id, trip.id, SYSTEM);
    journey = startJourney(journey.id, SYSTEM);
    startBoarding(journey.id, SYSTEM);
    boardStudent(journey.id, SYSTEM);
    await processPendingNotificationsForParent(parentUser);

    const notif = (await getNotificationsForParent(parentUser)).find((n) => n.studentId === student.id)! as unknown as Record<string, unknown>;
    for (const forbiddenKey of ['providerMessageId', 'channel', 'failureReason', 'recipientUserId', 'eventType', 'sourceEventId']) {
      expect(Object.prototype.hasOwnProperty.call(notif, forbiddenKey)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Isolation — extended to explicitly include ETA / ETA accuracy state
// (spec "Isolation" section explicitly names ETA and ETA Accuracy)
// ---------------------------------------------------------------------------

describe('Isolation — extended to ETA and ETA Accuracy state (spec mandatory items 21-26, "Isolation" section)', () => {
  it('journeys, trips, buses, students, routes, telemetry, current-location, ETA-accuracy observations, recommendations, audit_logs, and Journey Timeline are all unchanged by notification processing and delivery attempts', async () => {
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
      etaAccuracy: JSON.stringify(etaAccuracyRepository.findForMetrics({})),
      timeline: JSON.stringify(getJourneyTimeline(journey.id)),
    };

    await processPendingNotificationsForParent(parentUser);
    const notif = (await getNotificationsForParent(parentUser)).find((n) => n.studentId === student.id)!;
    // Also exercise the EMAIL provider explicitly (still UNAVAILABLE/SKIPPED at runtime) as part of this same isolation pass.
    await deliverToAllChannels({ notificationId: notif.id, title: notif.title, body: notif.body, priority: notif.priority, recipient: { userId: parentUser.id, email: parentUser.email, name: parentUser.name } });

    expect(auditRepository.findAll().length).toBe(before.auditCount);
    expect(JSON.stringify(journeyRepository.findByStudentId(student.id))).toBe(before.journeys);
    expect(JSON.stringify(tripRepository.findAll())).toBe(before.trips);
    expect(JSON.stringify(busRepository.findAll())).toBe(before.buses);
    expect(JSON.stringify(studentRepository.findAll())).toBe(before.students);
    expect(JSON.stringify(routeRepository.findAll())).toBe(before.routes);
    expect(JSON.stringify(recommendationRepository.findAll())).toBe(before.recommendations);
    expect(JSON.stringify(telemetryObservationRepository.findFiltered({ limit: 500 }))).toBe(before.telemetry);
    expect(JSON.stringify(currentLocationProjectionRepository.findAll())).toBe(before.projection);
    expect(JSON.stringify(etaAccuracyRepository.findForMetrics({}))).toBe(before.etaAccuracy);
    expect(JSON.stringify(getJourneyTimeline(journey.id))).toBe(before.timeline);
  });
});

// ---------------------------------------------------------------------------
// Security matrix re-confirmed (spec mandatory items 9-19)
// ---------------------------------------------------------------------------

describe('Security matrix remains enforced (spec mandatory items 9-19)', () => {
  it('parent authorization / driver / device / unauthenticated / unknown-user are all still correctly gated', () => {
    expect(requireParentUser('parent@masara.om').ok).toBe(true);
    expect(requireParentUser('driver1@masara.om').ok).toBe(false);
    expect(requireParentUser(undefined).ok).toBe(false);
    expect(requireParentUser('nobody@masara.om').ok).toBe(false);
  });

  it('Parent A still cannot receive Parent B\'s notifications', async () => {
    const a = createFreshAuthorizedChild();
    const b = createFreshAuthorizedChild();
    for (const { parentUser, student, trip } of [a, b]) {
      let j = createJourney(student.id, trip.id, SYSTEM);
      j = startJourney(j.id, SYSTEM);
      startBoarding(j.id, SYSTEM);
      boardStudent(j.id, SYSTEM);
      await processPendingNotificationsForParent(parentUser);
    }
    const viewsA = await getNotificationsForParent(a.parentUser);
    expect(viewsA.every((n) => n.studentId === a.student.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Source-scan governance guards
// ---------------------------------------------------------------------------

describe('Source-scan governance guards (spec "Source-Scan Guards" section)', () => {
  const emailSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/EmailNotificationProvider.ts'), 'utf8');
  const providerContractSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/NotificationDeliveryProvider.ts'), 'utf8');
  const routesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/parentRoutes.ts'), 'utf8');
  const forbiddenImports =
    /from ['"].*\/(JourneyService|JourneyStateMachine|ActionExecutor|PolicyEngine|MasaraOperationsAgent|PredictionEngine|TelemetryIngestionService|EtaService|ApprovalCenter)['"]/;

  it('EmailNotificationProvider.ts imports no Journey/governance mutation module', () => {
    expect(emailSource).not.toMatch(forbiddenImports);
  });

  it('EmailNotificationProvider.ts never imports notificationRepository — it cannot touch notification rows', () => {
    expect(emailSource).not.toMatch(/notificationRepository/);
  });

  it('no hard-coded credential-shaped literal exists in EmailNotificationProvider.ts (only process.env reads)', () => {
    expect(emailSource).not.toMatch(/["'](sk_|AIza|AKIA)[a-z0-9]{10,}["']/i);
  });

  it('still no /api/notifications/send or generic notification-creation endpoint', () => {
    expect(routesSource).not.toMatch(/['"]\/api\/(notifications\/send|events)['"]/);
    expect(routesSource).not.toMatch(/parentRouter\.post\(\s*['"]\/api\/parent\/notifications['"]/);
  });

  it('no route accepts a client-controlled eventType/studentId/recipientUserId/priority/body for notification creation', () => {
    expect(routesSource).not.toMatch(/req\.(query|body|params)\??\.(eventType|studentId|recipientUserId|priority|body|title)\b/);
  });

  it('the provider contract file itself imports no Journey/governance mutation module', () => {
    expect(providerContractSource).not.toMatch(forbiddenImports);
  });
});
