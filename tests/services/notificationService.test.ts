import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../../database/client';
import { students, users } from '../../database/schema';
import {
  isEligibleForNotification,
  resolvePriority,
  resolveCategory,
  formatNotificationContent,
} from '../../server/services/NotificationPolicy';
import {
  processPendingNotificationsForParent,
  getNotificationsForParent,
  getUnreadCountForParent,
  markNotificationRead,
  NotificationAccessDeniedError,
  NotificationNotFoundError,
} from '../../server/services/NotificationService';
import { notificationRepository } from '../../server/repositories/notificationRepository';
import { resolveAuthorizedStudents } from '../../server/services/ParentAccessService';
import { DEMO_PARENT_PHONE_BY_EMAIL } from '../../server/domain/parentAccessContract';
import { PARENT_NOTIFICATION_EVENT_TYPES } from '../../server/domain/notificationContract';
import { OPERATIONAL_EVENT_TYPES, INTELLIGENCE_EVENT_TYPES, GOVERNANCE_EVENT_TYPES, TELEMETRY_EVENT_TYPES } from '../../server/domain/eventTaxonomy';
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
import { createJourney, startJourney, startBoarding, boardStudent, startTransit, approachStop, dropOffStudent, markMissed, cancelJourney, markIncident, type JourneyActor } from '../../server/services/JourneyService';

const SYSTEM: JourneyActor = { actorId: null, actorType: 'system' };

beforeEach(() => {
  currentLocationProjectionRepository.clear();
});

let freshCounter = 0;
/** Same isolated-fixture pattern as tests/services/parentJourneyService.test.ts — a brand-new (parent, child) pair per test avoids the (studentId, tripId) unique-constraint collisions real journeys persisting for the whole test FILE would otherwise cause. */
function createFreshAuthorizedChild() {
  freshCounter += 1;
  const admin = userRepository.findByEmail('admin@masara.om')!;
  const bus = busRepository.findAll()[0];
  const phone = `+968 9800 ${String(freshCounter).padStart(4, '0')}`;
  const email = `notif-fresh-parent-${freshCounter}-test@masara.om`;

  db.insert(students)
    .values({
      id: crypto.randomUUID(),
      schoolId: admin.schoolId!,
      name: `طالب اختبار إشعارات ${freshCounter}`,
      grade: 'الأول',
      busId: bus.id,
      pickupLat: 23.6,
      pickupLng: 58.4,
      pickupAddress: 'test',
      parentPhone: phone,
    })
    .run();
  db.insert(users).values({ id: crypto.randomUUID(), schoolId: admin.schoolId, name: `Notif Fresh Parent ${freshCounter}`, email, passwordHash: 'x', role: 'parent' }).run();
  (DEMO_PARENT_PHONE_BY_EMAIL as Record<string, string>)[email] = phone;

  const parentUser = userRepository.findByEmail(email)!;
  const student = resolveAuthorizedStudents(parentUser)[0];
  const trip = tripRepository.findAll().find((t) => t.busId === student.busId)!;
  return { parentUser, student, trip };
}

function driveToState(studentId: string, tripId: string, state: 'on_bus' | 'approaching_stop' | 'dropped_off' | 'missed' | 'cancelled' | 'incident') {
  let journey = createJourney(studentId, tripId, SYSTEM);
  journey = startJourney(journey.id, SYSTEM);
  if (state === 'missed') {
    return markMissed(journey.id, 'اختبار', SYSTEM);
  }
  if (state === 'cancelled') {
    return cancelJourney(journey.id, 'اختبار', SYSTEM);
  }
  startBoarding(journey.id, SYSTEM);
  journey = boardStudent(journey.id, SYSTEM);
  if (state === 'on_bus') return journey;
  journey = startTransit(journey.id, SYSTEM);
  if (state === 'incident') {
    return markIncident(journey.id, 'اختبار', SYSTEM);
  }
  const trip = tripRepository.findById(tripId)!;
  const stops = routeRepository.findStopsByRouteId(trip.routeId);
  journey = approachStop(journey.id, stops[0].id, SYSTEM);
  if (state === 'approaching_stop') return journey;
  journey = dropOffStudent(journey.id, stops[0].id, SYSTEM);
  return journey;
}

// ---------------------------------------------------------------------------
// A. NotificationPolicy — pure, deterministic (spec §25.A)
// ---------------------------------------------------------------------------

describe('NotificationPolicy.isEligibleForNotification — the parent-visible allow-list (spec §8/§20 mandatory)', () => {
  it('all 6 eligible event types return true', () => {
    for (const eventType of Object.keys(PARENT_NOTIFICATION_EVENT_TYPES)) {
      expect(isEligibleForNotification(eventType)).toBe(true);
    }
    expect(Object.keys(PARENT_NOTIFICATION_EVENT_TYPES)).toHaveLength(6);
  });

  it('the 5 deliberately-suppressed real Journey event types all return false', () => {
    const suppressed = ['JOURNEY_CREATED', 'JOURNEY_STARTED', 'BOARDING_STARTED', 'TRANSIT_STARTED', 'JOURNEY_COMPLETED'];
    for (const eventType of suppressed) {
      expect(isEligibleForNotification(eventType)).toBe(false);
    }
  });

  it('every real OPERATIONAL_EVENT_TYPES entry is accounted for — either eligible or a Journey event this test knows is suppressed (regression guard against a silently-added new event type)', () => {
    const known = new Set([...Object.keys(PARENT_NOTIFICATION_EVENT_TYPES), 'JOURNEY_CREATED', 'JOURNEY_STARTED', 'BOARDING_STARTED', 'TRANSIT_STARTED', 'JOURNEY_COMPLETED']);
    const journeyEventTypes = OPERATIONAL_EVENT_TYPES.filter((t) => t.startsWith('JOURNEY_') || t.startsWith('STUDENT_') || t === 'BOARDING_STARTED' || t === 'STOP_APPROACHING' || t === 'TRANSIT_STARTED');
    for (const t of journeyEventTypes) {
      expect(known.has(t)).toBe(true);
    }
  });

  it('unknown event types are suppressed (default-deny — spec §8 security requirement)', () => {
    expect(isEligibleForNotification('SOME_MADE_UP_EVENT')).toBe(false);
    expect(isEligibleForNotification('')).toBe(false);
  });

  it('every AI/INTELLIGENCE event type is suppressed', () => {
    for (const t of INTELLIGENCE_EVENT_TYPES) expect(isEligibleForNotification(t)).toBe(false);
  });

  it('every GOVERNANCE event type is suppressed', () => {
    for (const t of GOVERNANCE_EVENT_TYPES) expect(isEligibleForNotification(t)).toBe(false);
  });

  it('every reserved TELEMETRY event type is suppressed', () => {
    for (const t of TELEMETRY_EVENT_TYPES) expect(isEligibleForNotification(t)).toBe(false);
  });

  it('non-Journey OPERATIONAL events (trip/bus/simulation-level) are suppressed too — this domain is Journey-scoped only', () => {
    for (const t of ['TRIP_STARTED', 'BUS_MOVING', 'TRIP_COMPLETED', 'SAFETY_INCIDENT', 'SIMULATION_STARTED', 'SIMULATION_COMPLETED', 'SIMULATION_FAILED', 'SIMULATION_CANCELLED']) {
      expect(isEligibleForNotification(t)).toBe(false);
    }
  });
});

describe('NotificationPolicy priority/category resolution (spec §9/§15/§25.E mandatory)', () => {
  it('normal Journey facts resolve to NORMAL priority', () => {
    expect(resolvePriority('STUDENT_BOARDED')).toBe('NORMAL');
    expect(resolvePriority('STOP_APPROACHING')).toBe('NORMAL');
    expect(resolvePriority('STUDENT_DROPPED_OFF')).toBe('NORMAL');
  });

  it('missed/cancelled resolve to HIGH priority', () => {
    expect(resolvePriority('STUDENT_MISSED')).toBe('HIGH');
    expect(resolvePriority('JOURNEY_CANCELLED')).toBe('HIGH');
  });

  it('incident resolves to CRITICAL priority', () => {
    expect(resolvePriority('JOURNEY_INCIDENT')).toBe('CRITICAL');
  });

  it('an ineligible event type resolves priority/category to null, never a fabricated default', () => {
    expect(resolvePriority('JOURNEY_CREATED')).toBeNull();
    expect(resolveCategory('JOURNEY_CREATED')).toBeNull();
  });

  it('category mapping is deterministic and exhaustive for all 6 eligible types', () => {
    expect(resolveCategory('STUDENT_BOARDED')).toBe('BOARDING');
    expect(resolveCategory('STOP_APPROACHING')).toBe('ARRIVAL');
    expect(resolveCategory('STUDENT_DROPPED_OFF')).toBe('DROPPED_OFF');
    expect(resolveCategory('STUDENT_MISSED')).toBe('STATUS');
    expect(resolveCategory('JOURNEY_CANCELLED')).toBe('STATUS');
    expect(resolveCategory('JOURNEY_INCIDENT')).toBe('INCIDENT');
  });
});

describe('NotificationPolicy.formatNotificationContent — deterministic content, never AI-generated (spec §14/§25.D mandatory)', () => {
  const ctx = { studentName: 'محمد', busLabel: 'حافلة 101', stopName: 'نقطة توقف حي القرم' };

  it('produces non-empty title/body for every eligible event, embedding the student name', () => {
    for (const eventType of Object.keys(PARENT_NOTIFICATION_EVENT_TYPES)) {
      const content = formatNotificationContent(eventType, ctx);
      expect(content).not.toBeNull();
      expect(content!.title.length).toBeGreaterThan(0);
      expect(content!.body).toContain('محمد');
    }
  });

  it('returns null for an ineligible/unknown event type', () => {
    expect(formatNotificationContent('JOURNEY_CREATED', ctx)).toBeNull();
    expect(formatNotificationContent('RECOMMENDATION_CREATED', ctx)).toBeNull();
  });

  it('never includes GPS-coordinate-shaped content, internal ids, or policy/AI vocabulary', () => {
    for (const eventType of Object.keys(PARENT_NOTIFICATION_EVENT_TYPES)) {
      const content = formatNotificationContent(eventType, ctx)!;
      const text = `${content.title} ${content.body}`;
      expect(text).not.toMatch(/-?\d{1,3}\.\d{4,}/); // lat/lng-shaped decimal
      expect(text.toLowerCase()).not.toMatch(/recommendation|policy|confidence|prediction|agentrun|deviceid/);
    }
  });

  it('JOURNEY_INCIDENT content is a safe generic prompt, never the raw operator-entered incidentReason text', () => {
    const content = formatNotificationContent('JOURNEY_INCIDENT', ctx)!;
    expect(content.body).not.toContain('اختبار'); // the test's own incidentReason value must never leak through — the formatter doesn't even accept it as input
    expect(content.body).toContain('إدارة المدرسة');
  });
});

// ---------------------------------------------------------------------------
// B. Deduplication (spec §10/§25.B mandatory)
// ---------------------------------------------------------------------------

describe('Deduplication — database-enforced, never timestamp-based (spec §10 mandatory)', () => {
  it('inserting the same (recipient, sourceEventId) twice at the repository level creates exactly one row', () => {
    const { parentUser, student, trip } = createFreshAuthorizedChild();
    const journey = journeyRepository.create({ studentId: student.id, tripId: trip.id, state: 'scheduled' });
    const candidate = {
      recipientUserId: parentUser.id,
      studentId: student.id,
      journeyId: journey.id,
      tripId: trip.id,
      eventType: 'STUDENT_BOARDED',
      sourceEventId: 'dedup-test-source-event-1',
      category: 'BOARDING',
      title: 't',
      body: 'b',
      priority: 'NORMAL',
    };
    const first = notificationRepository.insertIfAbsent(candidate);
    const second = notificationRepository.insertIfAbsent(candidate);
    const third = notificationRepository.insertIfAbsent(candidate);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(third).toBeNull();
    expect(notificationRepository.findByRecipient(parentUser.id).filter((n) => n.sourceEventId === candidate.sourceEventId)).toHaveLength(1);
  });

  it('a real STUDENT_BOARDED Journey event processed twice via the full service produces exactly one notification', async () => {
    const { parentUser, student, trip } = createFreshAuthorizedChild();
    driveToState(student.id, trip.id, 'on_bus');

    await processPendingNotificationsForParent(parentUser);
    const afterFirst = (await getNotificationsForParent(parentUser)).filter((n) => n.studentId === student.id);
    expect(afterFirst).toHaveLength(1);

    await processPendingNotificationsForParent(parentUser); // second processing pass — same underlying audit_logs row
    await processPendingNotificationsForParent(parentUser); // third
    const afterThird = (await getNotificationsForParent(parentUser)).filter((n) => n.studentId === student.id);
    expect(afterThird).toHaveLength(1);
    expect(afterThird[0].id).toBe(afterFirst[0].id);
  });

  it('different source events for the same student produce separate notifications', async () => {
    const { parentUser, student, trip } = createFreshAuthorizedChild();
    driveToState(student.id, trip.id, 'dropped_off'); // passes through STUDENT_BOARDED, STOP_APPROACHING, STUDENT_DROPPED_OFF — 3 eligible events

    await processPendingNotificationsForParent(parentUser);
    const notifications = (await getNotificationsForParent(parentUser)).filter((n) => n.studentId === student.id);
    expect(notifications).toHaveLength(3);
    const uniqueIds = new Set(notifications.map((n) => n.id));
    expect(uniqueIds.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// C. Recipient isolation (spec §13/§21/§25.C mandatory)
// ---------------------------------------------------------------------------

describe('Recipient isolation — reuses ParentAccessService exclusively (spec §13/§21 mandatory)', () => {
  it('Parent A sees only their own notifications; Parent B sees only theirs', async () => {
    const a = createFreshAuthorizedChild();
    const b = createFreshAuthorizedChild();
    driveToState(a.student.id, a.trip.id, 'on_bus');
    driveToState(b.student.id, b.trip.id, 'on_bus');

    await processPendingNotificationsForParent(a.parentUser);
    await processPendingNotificationsForParent(b.parentUser);

    const viewsA = await getNotificationsForParent(a.parentUser);
    const viewsB = await getNotificationsForParent(b.parentUser);
    expect(viewsA.every((n) => n.studentId === a.student.id)).toBe(true);
    expect(viewsB.every((n) => n.studentId === b.student.id)).toBe(true);
    expect(viewsA.some((n) => n.studentId === b.student.id)).toBe(false);
  });

  it('Parent A cannot mark Parent B\'s notification as read by guessing its ID — 403', async () => {
    const a = createFreshAuthorizedChild();
    const b = createFreshAuthorizedChild();
    driveToState(b.student.id, b.trip.id, 'on_bus');
    await processPendingNotificationsForParent(b.parentUser);
    const bNotification = (await getNotificationsForParent(b.parentUser))[0];

    expect(() => markNotificationRead(a.parentUser, bNotification.id)).toThrow(NotificationAccessDeniedError);
  });

  it('marking a nonexistent notification id read returns a not-found error, never a fabricated success', () => {
    const { parentUser } = createFreshAuthorizedChild();
    expect(() => markNotificationRead(parentUser, 'does-not-exist')).toThrow(NotificationNotFoundError);
  });

  it('a user with no entry in the demo parent map gets zero notifications and zero unread count', async () => {
    const admin = userRepository.findByEmail('admin@masara.om')!;
    expect((await getNotificationsForParent(admin)).length).toBe(0);
    expect(await getUnreadCountForParent(admin)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// E/F. Priority end-to-end + delivery states (spec §25.E/§25.F mandatory)
// ---------------------------------------------------------------------------

describe('Priority + delivery, end to end through real Journey transitions', () => {
  it('STUDENT_MISSED and JOURNEY_CANCELLED produce HIGH-priority, SENT notifications', async () => {
    const missedFixture = createFreshAuthorizedChild();
    driveToState(missedFixture.student.id, missedFixture.trip.id, 'missed');
    await processPendingNotificationsForParent(missedFixture.parentUser);
    const missedNotif = (await getNotificationsForParent(missedFixture.parentUser)).find((n) => n.studentId === missedFixture.student.id)!;
    expect(missedNotif.priority).toBe('HIGH');
    expect(missedNotif.status).toBe('SENT');
    expect(missedNotif.sentAt).not.toBeNull();

    const cancelledFixture = createFreshAuthorizedChild();
    driveToState(cancelledFixture.student.id, cancelledFixture.trip.id, 'cancelled');
    await processPendingNotificationsForParent(cancelledFixture.parentUser);
    const cancelledNotif = (await getNotificationsForParent(cancelledFixture.parentUser)).find((n) => n.studentId === cancelledFixture.student.id)!;
    expect(cancelledNotif.priority).toBe('HIGH');
  });

  it('JOURNEY_INCIDENT produces a CRITICAL-priority notification (the drive-to-incident path also passes through STUDENT_BOARDED, so this specifically finds the INCIDENT-category row, not just the first match)', async () => {
    const { parentUser, student, trip } = createFreshAuthorizedChild();
    driveToState(student.id, trip.id, 'incident');
    await processPendingNotificationsForParent(parentUser);
    const notifs = (await getNotificationsForParent(parentUser)).filter((n) => n.studentId === student.id);
    const incidentNotif = notifs.find((n) => n.category === 'INCIDENT')!;
    expect(incidentNotif).toBeDefined();
    expect(incidentNotif.priority).toBe('CRITICAL');
    // And the earlier STUDENT_BOARDED fact this same drive-to-incident path produced is still its own, separately-priced NORMAL notification.
    expect(notifs.some((n) => n.category === 'BOARDING' && n.priority === 'NORMAL')).toBe(true);
  });

  it('read state is separate from delivery status — a SENT notification starts with readAt null, then gets a readAt once marked read, status unchanged', async () => {
    const { parentUser, student, trip } = createFreshAuthorizedChild();
    driveToState(student.id, trip.id, 'on_bus');
    await processPendingNotificationsForParent(parentUser);
    const notif = (await getNotificationsForParent(parentUser)).find((n) => n.studentId === student.id)!;
    expect(notif.status).toBe('SENT');
    expect(notif.readAt).toBeNull();

    const read = markNotificationRead(parentUser, notif.id);
    expect(read.status).toBe('SENT'); // delivery status never changes on read
    expect(read.readAt).not.toBeNull();
  });

  it('unread count decreases after marking a notification read', async () => {
    const { parentUser, student, trip } = createFreshAuthorizedChild();
    driveToState(student.id, trip.id, 'on_bus');
    await processPendingNotificationsForParent(parentUser);
    const before = await getUnreadCountForParent(parentUser);
    expect(before).toBeGreaterThan(0);
    const notif = (await getNotificationsForParent(parentUser)).find((n) => n.studentId === student.id)!;
    markNotificationRead(parentUser, notif.id);
    expect(await getUnreadCountForParent(parentUser)).toBe(before - 1);
  });
});

// ---------------------------------------------------------------------------
// D. Content safety on the public DTO itself (spec §25.D mandatory)
// ---------------------------------------------------------------------------

describe('Content safety on the public NotificationView (spec §14/§23 mandatory)', () => {
  it('the DTO never carries eventType, sourceEventId, journeyId, tripId, or failureReason', async () => {
    const { parentUser, student, trip } = createFreshAuthorizedChild();
    driveToState(student.id, trip.id, 'on_bus');
    await processPendingNotificationsForParent(parentUser);
    const notif = (await getNotificationsForParent(parentUser)).find((n) => n.studentId === student.id)! as unknown as Record<string, unknown>;
    for (const forbiddenKey of ['eventType', 'sourceEventId', 'journeyId', 'tripId', 'failureReason', 'recipientUserId']) {
      expect(Object.prototype.hasOwnProperty.call(notif, forbiddenKey)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// I. Isolation — notification processing/reads mutate nothing operational (spec §21/§27 mandatory)
// ---------------------------------------------------------------------------

describe('Isolation — notification processing and reads touch nothing operational (spec §21/§27 mandatory)', () => {
  it('journeys, trips, buses, students, routes, telemetry_observations, current_location_projection, recommendations, audit_logs are all unchanged', async () => {
    const { parentUser, student, trip } = createFreshAuthorizedChild();
    driveToState(student.id, trip.id, 'on_bus');

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
    };

    await processPendingNotificationsForParent(parentUser);
    await getNotificationsForParent(parentUser);
    await getUnreadCountForParent(parentUser);
    const notif = (await getNotificationsForParent(parentUser)).find((n) => n.studentId === student.id)!;
    markNotificationRead(parentUser, notif.id);

    expect(auditRepository.findAll().length).toBe(before.auditCount);
    expect(JSON.stringify(journeyRepository.findByStudentId(student.id))).toBe(before.journeys);
    expect(JSON.stringify(tripRepository.findAll())).toBe(before.trips);
    expect(JSON.stringify(busRepository.findAll())).toBe(before.buses);
    expect(JSON.stringify(studentRepository.findAll())).toBe(before.students);
    expect(JSON.stringify(routeRepository.findAll())).toBe(before.routes);
    expect(JSON.stringify(recommendationRepository.findAll())).toBe(before.recommendations);
    expect(JSON.stringify(telemetryObservationRepository.findFiltered({ limit: 500 }))).toBe(before.telemetry);
    expect(JSON.stringify(currentLocationProjectionRepository.findAll())).toBe(before.projection);
  });
});

// ---------------------------------------------------------------------------
// J. Source-scan governance guards (spec §28 mandatory)
// ---------------------------------------------------------------------------

describe('Source-scan governance guards (spec §28 mandatory) — Notification domain is demonstrably a communication projection only', () => {
  const serviceSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/NotificationService.ts'), 'utf8');
  const policySource = fs.readFileSync(path.resolve(__dirname, '../../server/services/NotificationPolicy.ts'), 'utf8');
  const deliverySource = fs.readFileSync(path.resolve(__dirname, '../../server/services/NotificationDeliveryProvider.ts'), 'utf8');
  const repoSource = fs.readFileSync(path.resolve(__dirname, '../../server/repositories/notificationRepository.ts'), 'utf8');
  const routesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/parentRoutes.ts'), 'utf8');
  const forbiddenImports =
    /from ['"].*\/(JourneyService|JourneyStateMachine|ActionExecutor|PolicyEngine|MasaraOperationsAgent|PredictionEngine|TelemetryIngestionService|EtaService|ApprovalCenter)['"]/;
  const forbiddenAi = /(GoogleGenAI|generateContent|LLMProvider|MockProvider)/;

  it('NotificationService.ts imports no mutation module and no AI/LLM provider', () => {
    expect(serviceSource).not.toMatch(forbiddenImports);
    expect(serviceSource).not.toMatch(forbiddenAi);
  });

  it('NotificationPolicy.ts and NotificationDeliveryProvider.ts import no AI/LLM provider and no mutation module', () => {
    expect(policySource).not.toMatch(forbiddenAi);
    expect(policySource).not.toMatch(forbiddenImports);
    expect(deliverySource).not.toMatch(forbiddenAi);
  });

  it('NotificationService.ts never writes audit_logs (no auditRepository.create usage)', () => {
    expect(serviceSource).not.toMatch(/auditRepository\.create/);
  });

  it('NotificationService.ts imports no CurrentLocationProjectionService WRITE function', () => {
    expect(serviceSource).not.toMatch(/\bprocessObservation\b/);
    expect(serviceSource).not.toMatch(/\bupsertIfNewer\b/);
  });

  it('no /api/events endpoint and no generic notification-creation endpoint exists anywhere in parentRoutes.ts', () => {
    expect(routesSource).not.toMatch(/['"]\/api\/events['"]/);
    expect(routesSource).not.toMatch(/parentRouter\.post\(\s*['"]\/api\/parent\/notifications['"]/);
  });

  it('the notification mark-read route never trusts req.body for eventType, studentId, tripId, journeyId, recipientId, priority, or sourceEventId', () => {
    const start = routesSource.indexOf("'/api/parent/notifications/:id/read'");
    const block = routesSource.slice(start, routesSource.indexOf('});', start));
    expect(block).not.toMatch(/req\.body\??\.(eventType|studentId|tripId|journeyId|recipientId|priority|sourceEventId)\b/);
  });

  it('the notification list/unread-count routes never trust req.query for identity-bearing fields beyond userEmail/limit', () => {
    expect(routesSource).not.toMatch(/req\.query\??\.(studentId|tripId|journeyId|recipientId|priority|sourceEventId|eventType)\b/);
  });

  it('notificationRepository.ts never accepts req.body/req.query directly (candidate is always server-constructed)', () => {
    expect(repoSource).not.toMatch(/req\.(body|query)/);
  });
});
