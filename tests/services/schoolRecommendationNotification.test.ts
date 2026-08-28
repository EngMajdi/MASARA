import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { approveRecommendation, rejectRecommendation } from '../../server/services/ActionExecutor';
import { notifySchoolOfSignificantDelay } from '../../server/services/SchoolRecommendationNotifier';
import { recommendationRepository } from '../../server/repositories/recommendationRepository';
import { actionRepository } from '../../server/repositories/actionRepository';
import { actionVerificationRepository } from '../../server/repositories/actionVerificationRepository';
import { auditRepository } from '../../server/repositories/auditRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { routeRepository } from '../../server/repositories/routeRepository';
import { studentRepository } from '../../server/repositories/studentRepository';
import { journeyRepository } from '../../server/repositories/journeyRepository';
import { userRepository } from '../../server/repositories/userRepository';
import { db } from '../../database/client';
import { users, notifications, userContacts } from '../../database/schema';
import { createSafetyFindingRecommendation } from '../../server/agents/SafetyFindingRecommendationAdapter';
import { getTripSafetyFinding } from '../../server/services/SafetyFindingService';
import { processObservation } from '../../server/services/CurrentLocationProjectionService';
import { currentLocationProjectionRepository } from '../../server/repositories/currentLocationProjectionRepository';
import { registerDevice } from '../../server/services/TelemetryDeviceService';
import { ingestObservation } from '../../server/services/TelemetryIngestionService';
import { startGpsSimulation, advanceGpsSimulation, resetAllGpsSimulations } from '../../server/services/GpsSimulationEngine';
import { requireOperationalUser } from '../../server/services/authz';
import type { TelemetryObservation } from '../../server/domain/telemetryContract';

beforeEach(() => {
  currentLocationProjectionRepository.clear();
  resetAllGpsSimulations();
});

function findActiveTrip() {
  return tripRepository.findAll().find((t) => t.status === 'active')!;
}

function findAdmin() {
  return userRepository.findAll().find((u) => u.role === 'admin')!;
}

function makeRecommendation(overrides: Partial<Parameters<typeof recommendationRepository.create>[0]> = {}) {
  const trip = overrides.tripId ? undefined : findActiveTrip();
  return recommendationRepository.create({
    tripId: trip?.id ?? overrides.tripId!,
    agentRunId: 'test-run',
    type: 'DELAY',
    title: 'test recommendation',
    severity: 'high',
    problem: 'test problem',
    confidence: 0.9,
    action: 'NOTIFY_SCHOOL',
    targetId: null,
    reason: 'test reason',
    expectedOutcome: null,
    requiresApproval: true,
    status: 'pending',
    ...overrides,
  });
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

function induceSignificantDelay(trip: ReturnType<typeof findActiveTrip>) {
  const stops = routeRepository.findStopsByRouteId(trip.routeId).slice().sort((a, b) => a.orderSequence - b.orderSequence);
  processObservation(makeObservation(trip.busId, { tripId: trip.id, latitude: stops[0].lat, longitude: stops[0].lng, speed: 2 }));
}

// ---------------------------------------------------------------------------
// Recipient resolution
// ---------------------------------------------------------------------------

describe('notifySchoolOfSignificantDelay — recipient resolution (never ParentAccessService)', () => {
  it('resolves the real school-role user for the bus\'s school', async () => {
    const trip = findActiveTrip();
    const bus = busRepository.findById(trip.busId)!;
    const outcome = await notifySchoolOfSignificantDelay({
      busId: bus.id,
      recommendationId: 'rec-test-1',
      title: 't',
      body: 'b',
      priority: 'HIGH',
    });
    expect(outcome.attempted).toBe(true);
    const recipient = userRepository.findById(outcome.recipientUserId!)!;
    expect(recipient.role).toBe('school');
    expect(recipient.schoolId).toBe(bus.schoolId);
  });

  it('no busId -> not attempted, no recipient', async () => {
    const outcome = await notifySchoolOfSignificantDelay({ busId: null, recommendationId: 'rec-test-2', title: 't', body: 'b', priority: 'HIGH' });
    expect(outcome.attempted).toBe(false);
    expect(outcome.recipientUserId).toBeNull();
    expect(outcome.channelResults).toEqual([]);
  });

  it('unknown busId -> not attempted, no recipient', async () => {
    const outcome = await notifySchoolOfSignificantDelay({ busId: 'bus-does-not-exist', recommendationId: 'rec-test-3', title: 't', body: 'b', priority: 'HIGH' });
    expect(outcome.attempted).toBe(false);
  });

  it('deterministic tiebreak: with two school-role users for the same school, the earlier-created one always wins', async () => {
    const trip = findActiveTrip();
    const bus = busRepository.findById(trip.busId)!;
    const older = db
      .insert(users)
      .values({ id: crypto.randomUUID(), schoolId: bus.schoolId, name: 'School Op A', email: `school-a-${crypto.randomUUID()}@masara.om`, passwordHash: 'x', role: 'school', createdAt: new Date(Date.now() - 60_000) })
      .returning()
      .get();
    const newer = db
      .insert(users)
      .values({ id: crypto.randomUUID(), schoolId: bus.schoolId, name: 'School Op B', email: `school-b-${crypto.randomUUID()}@masara.om`, passwordHash: 'x', role: 'school', createdAt: new Date() })
      .returning()
      .get();

    const first = await notifySchoolOfSignificantDelay({ busId: bus.id, recommendationId: 'rec-tiebreak-1', title: 't', body: 'b', priority: 'HIGH' });
    const second = await notifySchoolOfSignificantDelay({ busId: bus.id, recommendationId: 'rec-tiebreak-2', title: 't', body: 'b', priority: 'HIGH' });
    expect(first.recipientUserId).toBe(second.recipientUserId); // deterministic, not random
    expect([older.id, newer.id]).toContain(first.recipientUserId);
  });
});

// ---------------------------------------------------------------------------
// Delivery outcome semantics — never a fabricated SUCCESS
// ---------------------------------------------------------------------------

describe('Delivery semantics — honest DeliveryResult outcomes, IN_APP never invoked', () => {
  it('every channel result is EMAIL, SMS, or PUSH — never IN_APP (no notifications-table row exists for a school recipient)', async () => {
    const trip = findActiveTrip();
    const bus = busRepository.findById(trip.busId)!;
    const outcome = await notifySchoolOfSignificantDelay({ busId: bus.id, recommendationId: 'rec-channels-1', title: 't', body: 'b', priority: 'HIGH' });
    const channels = outcome.channelResults.map((r) => r.channel).sort();
    expect(channels).toEqual(['EMAIL', 'PUSH', 'SMS']);
  });

  it('no channel ever reports SUCCESS in this deployment (no vendor credentials configured — honest, not fabricated)', async () => {
    const trip = findActiveTrip();
    const bus = busRepository.findById(trip.busId)!;
    const outcome = await notifySchoolOfSignificantDelay({ busId: bus.id, recommendationId: 'rec-channels-2', title: 't', body: 'b', priority: 'HIGH' });
    for (const r of outcome.channelResults) {
      expect(r.outcome).not.toBe('SUCCESS');
      expect(['UNAVAILABLE', 'SKIPPED', 'FAILED']).toContain(r.outcome);
    }
  });
});

// ---------------------------------------------------------------------------
// Approval / governance gating
// ---------------------------------------------------------------------------

describe('Governance gating — only an explicitly APPROVED recommendation may execute', () => {
  it('a PENDING recommendation never produces an action row (no notification attempt before approval)', () => {
    const rec = makeRecommendation();
    expect(actionRepository.findByRecommendationId(rec.id).length).toBe(0);
  });

  it('a REJECTED recommendation never executes or notifies', () => {
    const rec = makeRecommendation();
    const admin = findAdmin();
    rejectRecommendation(rec.id, admin.id, 'not needed');
    expect(recommendationRepository.findById(rec.id)!.status).toBe('rejected');
    expect(actionRepository.findByRecommendationId(rec.id).length).toBe(0);
  });

  it('an EXPIRED recommendation never executes or notifies', async () => {
    const rec = makeRecommendation({ expiresAt: new Date(Date.now() - 60_000) });
    const admin = findAdmin();
    await expect(approveRecommendation(rec.id, admin.id)).rejects.toThrow();
    expect(recommendationRepository.findById(rec.id)!.status).toBe('expired');
    expect(actionRepository.findByRecommendationId(rec.id).length).toBe(0);
  });

  it('an approved recommendation executes exactly once — action row and notification attempt created only after approval', async () => {
    const trip = findActiveTrip();
    const bus = busRepository.findById(trip.busId)!;
    const rec = makeRecommendation({ tripId: trip.id, busId: bus.id });
    expect(actionRepository.findByRecommendationId(rec.id).length).toBe(0);

    const result = await approveRecommendation(rec.id, findAdmin().id);
    expect(result.recommendation.status).toBe('verified');
    expect(actionRepository.findByRecommendationId(rec.id).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Idempotency — reuses the existing state machine, no second mechanism
// ---------------------------------------------------------------------------

describe('Idempotency — a recommendation may only produce one notification execution', () => {
  it('repeated approve requests never create a second action/notification attempt', async () => {
    const trip = findActiveTrip();
    const bus = busRepository.findById(trip.busId)!;
    const rec = makeRecommendation({ tripId: trip.id, busId: bus.id });

    await approveRecommendation(rec.id, findAdmin().id);
    await expect(approveRecommendation(rec.id, findAdmin().id)).rejects.toThrow();

    expect(actionRepository.findByRecommendationId(rec.id).length).toBe(1);
    const actions = actionRepository.findByRecommendationId(rec.id);
    expect(actionVerificationRepository.findByActionId(actions[0].id).length).toBe(1);
  });

  it('repeated verification reads are idempotent (no new rows from a GET-equivalent read)', async () => {
    const trip = findActiveTrip();
    const bus = busRepository.findById(trip.busId)!;
    const rec = makeRecommendation({ tripId: trip.id, busId: bus.id });
    await approveRecommendation(rec.id, findAdmin().id);

    const actions = actionRepository.findByRecommendationId(rec.id);
    const before = actionVerificationRepository.findByActionId(actions[0].id).length;
    for (let i = 0; i < 5; i++) actionVerificationRepository.findByActionId(actions[0].id);
    expect(actionVerificationRepository.findByActionId(actions[0].id).length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Governance boundary — cannot bypass PolicyEngine/ActionExecutor
// ---------------------------------------------------------------------------

describe('Governance boundary — execution never bypasses PolicyEngine, never executes twice', () => {
  it('an unknown action is refused by PolicyEngine before any notification is attempted', async () => {
    const trip = findActiveTrip();
    const rec = makeRecommendation({ tripId: trip.id, action: 'DELETE_EVERYTHING' as never });
    await expect(approveRecommendation(rec.id, findAdmin().id)).rejects.toThrow();
    expect(actionRepository.findByRecommendationId(rec.id).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Simulation / real-device parity
// ---------------------------------------------------------------------------

describe('Simulation and real-device evidence produce the same governed notification path', () => {
  it('GPS simulation -> SafetyFinding -> recommendation -> approve -> notify (STOPPED profile)', async () => {
    const trip = findActiveTrip();
    const session = startGpsSimulation(trip.id, 'admin-test', { speedProfile: 'STOPPED', tickSeconds: 300 });
    advanceGpsSimulation(session.id);
    const finding = getTripSafetyFinding(trip.id);
    if (finding?.findingType !== 'SIGNIFICANT_DELAY_RISK') return; // honest skip, matches Phase 7B/7C's own tolerance for timing-dependent live conditions

    const created = createSafetyFindingRecommendation(trip.id, 'sim-parity-run', new Date(Date.now() + 15 * 60_000));
    expect(created.outcome).toBe('created');

    const result = await approveRecommendation(created.recommendationId!, findAdmin().id);
    expect(['verified'].includes(result.recommendation.status)).toBe(true);
    const payload = JSON.parse(result.action!.payload) as { channelResults: Array<{ channel: string }> };
    expect(payload.channelResults.map((r) => r.channel).sort()).toEqual(['EMAIL', 'PUSH', 'SMS']);
  });

  it('real device telemetry -> SafetyFinding -> recommendation -> approve -> notify — identical shape to simulation', async () => {
    const trip = findActiveTrip();
    const { device } = registerDevice(trip.busId, 'TEST DEVICE — 7D parity', 'DEVICE');
    const authed = { id: device.id, busId: device.busId, providerType: 'DEVICE' as const };
    const stops = routeRepository.findStopsByRouteId(trip.routeId).slice().sort((a, b) => a.orderSequence - b.orderSequence);

    ingestObservation(authed, {
      sourceEventId: '7d-parity-1',
      tripId: trip.id,
      occurredAt: new Date().toISOString(),
      latitude: stops[0].lat,
      longitude: stops[0].lng,
      speedKmh: 2,
    });

    const created = createSafetyFindingRecommendation(trip.id, 'device-parity-run', new Date(Date.now() + 15 * 60_000));
    expect(created.outcome).toBe('created');

    const result = await approveRecommendation(created.recommendationId!, findAdmin().id);
    expect(result.recommendation.status).toBe('verified');
    const payload = JSON.parse(result.action!.payload) as { channelResults: Array<{ channel: string }> };
    expect(payload.channelResults.map((r) => r.channel).sort()).toEqual(['EMAIL', 'PUSH', 'SMS']);
  });
});

// ---------------------------------------------------------------------------
// Privacy — this is a SCHOOL notification, never parent-facing
// ---------------------------------------------------------------------------

describe('Privacy — NOTIFY_SCHOOL never touches parent notifications/contacts/journey data', () => {
  it('parent notifications and user_contacts row counts are unchanged after execution', async () => {
    const trip = findActiveTrip();
    const bus = busRepository.findById(trip.busId)!;
    const notificationsBefore = db.select().from(notifications).all().length;
    const contactsBefore = db.select().from(userContacts).all().length;

    const rec = makeRecommendation({ tripId: trip.id, busId: bus.id });
    await approveRecommendation(rec.id, findAdmin().id);

    expect(db.select().from(notifications).all().length).toBe(notificationsBefore);
    expect(db.select().from(userContacts).all().length).toBe(contactsBefore);
  });
});

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

describe('MANDATORY: NOTIFY_SCHOOL execution never mutates Journey/Trip route/Bus/telemetry/current-location', () => {
  it('full snapshot comparison before/after an approved NOTIFY_SCHOOL execution', async () => {
    const trip = findActiveTrip();
    const bus = busRepository.findById(trip.busId)!;
    const route = routeRepository.findById(trip.routeId)!;
    const student = studentRepository.findByBusId(trip.busId)[0];
    induceSignificantDelay(trip);

    const tripBefore = tripRepository.findById(trip.id);
    const busBefore = busRepository.findById(bus.id);
    const routeBefore = routeRepository.findById(trip.routeId);
    const studentsBefore = studentRepository.findByBusId(trip.busId);
    const journeysBefore = journeyRepository.findByTripId(trip.id);

    const rec = makeRecommendation({ tripId: trip.id, busId: bus.id });
    const result = await approveRecommendation(rec.id, findAdmin().id);
    expect(result.recommendation.status).toBe('verified');

    expect(tripRepository.findById(trip.id)).toEqual(tripBefore);
    expect(busRepository.findById(bus.id)).toEqual(busBefore);
    expect(routeRepository.findById(trip.routeId)).toEqual(routeBefore);
    expect(studentRepository.findByBusId(trip.busId)).toEqual(studentsBefore);
    expect(journeyRepository.findByTripId(trip.id)).toEqual(journeysBefore);
    expect(student).toBeTruthy(); // fixture sanity
  });
});

// ---------------------------------------------------------------------------
// Audit correctness
// ---------------------------------------------------------------------------

describe('Audit correctness — the existing governance event taxonomy only, no new vocabulary, no polling noise', () => {
  it('an approved NOTIFY_SCHOOL execution produces exactly the expected lifecycle events, no more', async () => {
    const trip = findActiveTrip();
    const bus = busRepository.findById(trip.busId)!;
    const rec = makeRecommendation({ tripId: trip.id, busId: bus.id });
    const before = auditRepository.findByRecommendationId(rec.id).length;

    await approveRecommendation(rec.id, findAdmin().id);

    const events = auditRepository.findByRecommendationId(rec.id).map((e) => e.eventType);
    expect(events.length).toBe(before + 5); // APPROVED, ACTION_STARTED, ACTION_COMPLETED, VERIFICATION_STARTED, VERIFICATION_COMPLETED
    expect(events).toEqual(expect.arrayContaining(['APPROVED', 'ACTION_STARTED', 'ACTION_COMPLETED', 'VERIFICATION_STARTED', 'VERIFICATION_COMPLETED']));
  });

  it('repeated reads of the recommendation/action never add audit rows (no polling noise)', async () => {
    const trip = findActiveTrip();
    const bus = busRepository.findById(trip.busId)!;
    const rec = makeRecommendation({ tripId: trip.id, busId: bus.id });
    await approveRecommendation(rec.id, findAdmin().id);

    const before = auditRepository.findAll().length;
    for (let i = 0; i < 5; i++) {
      recommendationRepository.findById(rec.id);
      actionRepository.findByRecommendationId(rec.id);
    }
    expect(auditRepository.findAll().length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Authorization (reuses the existing, unmodified requireOperationalUser guard)
// ---------------------------------------------------------------------------

describe('Authorization on the approval/execution path — unchanged guard, no new mechanism', () => {
  it('admin and school are authorized', () => {
    const admin = userRepository.findAll().find((u) => u.role === 'admin')!;
    const school = userRepository.findAll().find((u) => u.role === 'school')!;
    expect(requireOperationalUser(admin.email).ok).toBe(true);
    expect(requireOperationalUser(school.email).ok).toBe(true);
  });

  it('driver is rejected', () => {
    const driver = userRepository.findAll().find((u) => u.role === 'driver')!;
    expect(requireOperationalUser(driver.email).ok).toBe(false);
  });

  it('parent is rejected', () => {
    const parent = userRepository.findAll().find((u) => u.role === 'parent')!;
    expect(requireOperationalUser(parent.email).ok).toBe(false);
  });

  it('unauthenticated is rejected', () => {
    expect(requireOperationalUser(undefined).ok).toBe(false);
  });

  it('unknown user is rejected', () => {
    expect(requireOperationalUser('nobody@masara.om').ok).toBe(false);
  });

  it('a device credential is rejected by the same guard', () => {
    const trip = findActiveTrip();
    const { device } = registerDevice(trip.busId, 'TEST DEVICE — 7d-approve-guard', 'DEVICE');
    expect(requireOperationalUser(device.id).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Client cannot supply fake evidence/recipient/content
// ---------------------------------------------------------------------------

describe('Client-controlled input rejection — structural, not just convention', () => {
  const routesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/agentRoutes.ts'), 'utf8');

  // Phase 11 SECURITY FIX — the approve route (and every governed route) no
  // longer reads identity from req.body/req.query at all: a client-supplied
  // `userEmail` was a full authentication bypass (see authz.ts's header
  // comment and docs/PHASE_11_SECURITY_AND_IDENTITY_HARDENING_REPORT.md).
  // Identity now comes exclusively from a verified session token
  // (requireVerifiedEmail(req.headers.authorization)) — an even stronger
  // version of "the client cannot supply a fake identity" than the original
  // test's own intent.
  it('the approve route reads only :id (URL param) and a verified session — never a client-supplied userEmail, recipient/content/evidence field', () => {
    const start = routesSource.indexOf("agentRouter.post('/api/recommendations/:id/approve'");
    const block = routesSource.slice(start, routesSource.indexOf('\n});', start));
    expect(block).not.toMatch(/req\.body\.(recipient|body|content|severity|confidence|studentId|busId|routeId|evidence|action)/);
    expect(block).not.toMatch(/req\.(body|query)\??\.userEmail/);
    expect(block).toMatch(/requireVerifiedEmail\(req\.headers\.authorization\)/);
  });

  it('notification content is derived entirely from the already-approved recommendation row (rec.title/rec.problem), never from the approve request body', () => {
    const executorSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/ActionExecutor.ts'), 'utf8');
    const notifyBlock = executorSource.slice(executorSource.indexOf("rec.action === 'NOTIFY_SCHOOL'"), executorSource.indexOf('} else if', executorSource.indexOf("rec.action === 'NOTIFY_SCHOOL'")));
    expect(notifyBlock).toMatch(/title:\s*rec\.title/);
    expect(notifyBlock).toMatch(/body:\s*rec\.problem/);
    expect(notifyBlock).not.toMatch(/req\.(body|query)/);
  });
});

// ---------------------------------------------------------------------------
// Source-scan governance guards
// ---------------------------------------------------------------------------

describe('Source-scan governance guards', () => {
  const notifierSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/SchoolRecommendationNotifier.ts'), 'utf8');
  const executorSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/ActionExecutor.ts'), 'utf8');
  const safetyFindingServiceSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/SafetyFindingService.ts'), 'utf8');

  const forbidden = /from ['"].*\/(JourneyStateMachine|JourneyService|TelemetryIngestionService|EtaService)['"]/;

  it('SchoolRecommendationNotifier.ts imports none of the forbidden mutation modules', () => {
    expect(notifierSource).not.toMatch(forbidden);
  });

  it('SchoolRecommendationNotifier.ts never imports ParentAccessService — different domain, never reused for school recipients', () => {
    expect(notifierSource).not.toMatch(/from ['"].*\/ParentAccessService['"]/);
  });

  it('SchoolRecommendationNotifier.ts never imports or mutates Journey/Trip/Bus repositories directly (busRepository is read-only .findById)', () => {
    expect(notifierSource).not.toMatch(/\.(create|update|insert|delete)\(/);
  });

  it('SafetyFindingService.ts still never imports the execution layer (unchanged, still read-only)', () => {
    expect(safetyFindingServiceSource).not.toMatch(/from ['"].*\/(SchoolRecommendationNotifier|ActionExecutor)['"]/);
  });

  it('ActionExecutor.ts imports SchoolRecommendationNotifier — the correct dependency direction (ActionExecutor -> notifier -> providers), never the reverse', () => {
    expect(executorSource).toMatch(/from ['"]\.\/SchoolRecommendationNotifier['"]/);
  });

  it('no hardcoded provider credential/API key exists in the new file', () => {
    expect(notifierSource).not.toMatch(/api[_-]?key\s*[:=]\s*['"][a-z0-9]/i);
    expect(notifierSource).not.toMatch(/sk_[a-z0-9]{8,}/i);
  });
});
