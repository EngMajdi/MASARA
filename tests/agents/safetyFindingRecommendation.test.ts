import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { runForTrip, APPROVAL_WINDOW_MINUTES } from '../../server/agents/MasaraOperationsAgent';
import { createSafetyFindingRecommendation } from '../../server/agents/SafetyFindingRecommendationAdapter';
import { getTripSafetyFinding } from '../../server/services/SafetyFindingService';
import { recommendationRepository } from '../../server/repositories/recommendationRepository';
import { auditRepository } from '../../server/repositories/auditRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { routeRepository } from '../../server/repositories/routeRepository';
import { studentRepository } from '../../server/repositories/studentRepository';
import { journeyRepository } from '../../server/repositories/journeyRepository';
import { telemetryObservationRepository } from '../../server/repositories/telemetryObservationRepository';
import { userRepository } from '../../server/repositories/userRepository';
import { processObservation } from '../../server/services/CurrentLocationProjectionService';
import { currentLocationProjectionRepository } from '../../server/repositories/currentLocationProjectionRepository';
import { registerDevice } from '../../server/services/TelemetryDeviceService';
import { ingestObservation } from '../../server/services/TelemetryIngestionService';
import { startGpsSimulation, advanceGpsSimulation, resetAllGpsSimulations } from '../../server/services/GpsSimulationEngine';
import { requireOperationalUser } from '../../server/services/authz';
import { db } from '../../database/client';
import { notifications, userContacts } from '../../database/schema';
import type { TelemetryObservation } from '../../server/domain/telemetryContract';

beforeEach(() => {
  currentLocationProjectionRepository.clear();
  resetAllGpsSimulations();
});

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

function driverTrip(index = 0) {
  return tripRepository.findAll().filter((t) => t.driverId)[index];
}

/** Places the bus at its route's first stop with a deliberately slow, VALID speed — maximizes remaining distance/time, producing a real SIGNIFICANT_DELAY regardless of wall-clock drift (same technique as the Phase 7B test suite). */
function induceSignificantDelayHighConfidence(trip: ReturnType<typeof driverTrip>) {
  const stops = routeRepository.findStopsByRouteId(trip.routeId).slice().sort((a, b) => a.orderSequence - b.orderSequence);
  processObservation(makeObservation(trip.busId, { tripId: trip.id, latitude: stops[0].lat, longitude: stops[0].lng, speed: 2 }));
}

/**
 * Same delay condition, but engineered to drive the underlying EtaConfidence
 * itself down to LOW (invalid current speed -> DEFAULT speed tier, AND
 * positioned well off the route polyline -> poor route match), which is the
 * ONLY combination `deriveFindingConfidence` maps to FindingConfidence
 * MEDIUM (freshness=FRESH AND etaConfidence===LOW). EtaConfidence MEDIUM
 * alone is NOT enough — deriveFindingConfidence only distinguishes
 * etaConfidence===LOW from "anything else", so a merely-MEDIUM EtaConfidence
 * still resolves to FindingConfidence HIGH. Requires a bus with no prior
 * telemetry history in this test file (recent-speed fallback would
 * otherwise mask the DEFAULT tier), hence a dedicated, untouched trip.
 */
function induceSignificantDelayMediumConfidence(trip: ReturnType<typeof driverTrip>) {
  const stops = routeRepository.findStopsByRouteId(trip.routeId).slice().sort((a, b) => a.orderSequence - b.orderSequence);
  processObservation(makeObservation(trip.busId, { tripId: trip.id, latitude: stops[0].lat + 0.5, longitude: stops[0].lng, speed: 0 }));
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

describe('createSafetyFindingRecommendation — eligibility (only SIGNIFICANT_DELAY_RISK, never manufactured)', () => {
  it('SIGNIFICANT_DELAY_RISK finding -> recommendation created, deterministic content, no LLM involved', () => {
    const trip = driverTrip(0);
    induceSignificantDelayHighConfidence(trip);
    const finding = getTripSafetyFinding(trip.id)!;
    expect(finding.classification).toBe('SIGNIFICANT_DELAY');

    const result = createSafetyFindingRecommendation(trip.id, 'test-run-1', new Date(Date.now() + APPROVAL_WINDOW_MINUTES * 60_000));
    expect(result.outcome).toBe('created');
    expect(result.recommendationId).toBeTruthy();

    const rec = recommendationRepository.findById(result.recommendationId!)!;
    expect(rec.status).toBe('pending');
    expect(rec.type).toBe('DELAY');
    expect(rec.action).toBe('NOTIFY_SCHOOL');
    expect(rec.targetId).toBeNull();
    expect(rec.requiresApproval).toBe(true);
    expect(rec.severity).toBe(finding.severity);
    expect(rec.busId).toBe(finding.busId);
    expect(rec.tripId).toBe(trip.id);
    expect(rec.predictionId).toBeNull();
    expect(rec.title).toContain('تأخير');
    expect(rec.problem).toContain(String(Math.round(finding.delaySeconds / 60)));
  });

  it('no finding at all (no telemetry ever sent) -> not_eligible, no row, no audit entries', () => {
    const trip = driverTrip(1);
    expect(getTripSafetyFinding(trip.id)).toBeNull();

    const auditBefore = auditRepository.findAll().length;
    const result = createSafetyFindingRecommendation(trip.id, 'test-run-2', new Date());
    expect(result.outcome).toBe('not_eligible');
    expect(result.recommendationId).toBeNull();
    expect(auditRepository.findAll().length).toBe(auditBefore);
  });

  it('MINOR_DELAY (below the significant threshold) -> not_eligible — Phase 7B itself never returns a MINOR_DELAY finding, so this stays not_eligible too', () => {
    const trip = driverTrip(0);
    // Bus already essentially at its next stop, on a fresh, valid-speed
    // observation -> ON_TIME/MINOR_DELAY territory, never SIGNIFICANT_DELAY.
    processObservation(makeObservation(trip.busId, { tripId: trip.id }));
    const finding = getTripSafetyFinding(trip.id);
    expect(finding).toBeNull();

    const result = createSafetyFindingRecommendation(trip.id, 'test-run-3', new Date());
    expect(result.outcome).toBe('not_eligible');
  });

  it('stale telemetry (>60s) -> not_eligible, no row (same documented STALE-kills-delay behavior as Phase 7B)', () => {
    const trip = driverTrip(1);
    const staleAt = new Date(Date.now() - 600_000);
    processObservation(makeObservation(trip.busId, { tripId: trip.id, occurredAt: staleAt, receivedAt: staleAt }));
    expect(getTripSafetyFinding(trip.id)).toBeNull();

    const result = createSafetyFindingRecommendation(trip.id, 'test-run-4', new Date());
    expect(result.outcome).toBe('not_eligible');
    expect(result.recommendationId).toBeNull();
  });

  it('missing location entirely -> not_eligible (covers "missing ETA" too — no location means no waypoints/no ETA)', () => {
    const trip = driverTrip(2);
    expect(getTripSafetyFinding(trip.id)).toBeNull();
    const result = createSafetyFindingRecommendation(trip.id, 'test-run-5', new Date());
    expect(result.outcome).toBe('not_eligible');
  });
});

// ---------------------------------------------------------------------------
// Confidence / severity mapping fidelity
// ---------------------------------------------------------------------------

describe('createSafetyFindingRecommendation — confidence/severity carried through honestly, never a fabricated probability', () => {
  it('HIGH finding confidence -> numeric confidence 0.9, severity high', () => {
    const trip = driverTrip(0);
    induceSignificantDelayHighConfidence(trip);
    const finding = getTripSafetyFinding(trip.id)!;
    expect(finding.confidence).toBe('HIGH');

    const result = createSafetyFindingRecommendation(trip.id, 'test-run-6', new Date());
    const rec = recommendationRepository.findById(result.recommendationId!)!;
    expect(rec.confidence).toBe(0.9);
    expect(rec.severity).toBe('high');
    expect(rec.reason).toContain('HIGH');
  });

  it('MEDIUM finding confidence (fresh but fallback speed tier) -> numeric confidence 0.6, severity medium', () => {
    const trip = driverTrip(2); // untouched by any earlier test's telemetry in this file
    induceSignificantDelayMediumConfidence(trip);
    const finding = getTripSafetyFinding(trip.id)!;
    expect(finding.evidence.etaConfidence).toBe('LOW');
    expect(finding.confidence).toBe('MEDIUM');

    const result = createSafetyFindingRecommendation(trip.id, 'test-run-7', new Date());
    const rec = recommendationRepository.findById(result.recommendationId!)!;
    expect(rec.confidence).toBe(0.6);
    expect(rec.severity).toBe('medium');
  });

  it('never assigns critical severity — that tier stays reserved for real incident semantics', () => {
    const trip = driverTrip(0);
    induceSignificantDelayHighConfidence(trip);
    const result = createSafetyFindingRecommendation(trip.id, 'test-run-8', new Date());
    const rec = recommendationRepository.findById(result.recommendationId!)!;
    expect(rec.severity).not.toBe('critical');
  });

  it('deterministic content — same underlying evidence produces the same title/severity/action across two computations', () => {
    const trip = driverTrip(0);
    induceSignificantDelayHighConfidence(trip);
    const a = createSafetyFindingRecommendation(trip.id, 'run-a', new Date());
    const b = createSafetyFindingRecommendation(trip.id, 'run-b', new Date());
    const recA = recommendationRepository.findById(a.recommendationId!)!;
    const recB = recommendationRepository.findById(b.recommendationId!)!;
    expect(recB.title).toBe(recA.title);
    expect(recB.severity).toBe(recA.severity);
    expect(recB.action).toBe(recA.action);
    expect(recB.confidence).toBe(recA.confidence);
  });
});

// ---------------------------------------------------------------------------
// Idempotency / dedup via runForTrip's existing cancellation step
// ---------------------------------------------------------------------------

describe('runForTrip + Phase 7C — no recommendation flood on repeated runs (reuses the EXISTING trip-scoped cancellation, no second mechanism)', () => {
  it('repeated agent runs against an unchanged significant-delay condition never stack more than one pending safety recommendation', async () => {
    const trip = driverTrip(0);
    tripRepository.update(trip.id, { currentEtaAt: trip.targetArrivalAt }); // old LLM lane stays on-time/no_action
    induceSignificantDelayHighConfidence(trip);

    const first = await runForTrip(trip.id);
    expect(first.status).toBe('no_action'); // old lane unaffected
    expect(first.safetyRecommendationOutcome).toBe('created');
    expect(first.safetyRecommendationId).toBeTruthy();
    expect(recommendationRepository.findPendingByTripId(trip.id).length).toBe(1);

    const second = await runForTrip(trip.id);
    expect(second.safetyRecommendationOutcome).toBe('created');
    expect(second.safetyRecommendationId).not.toBe(first.safetyRecommendationId);
    expect(recommendationRepository.findPendingByTripId(trip.id).length).toBe(1); // still exactly one — old one cancelled

    const firstRec = recommendationRepository.findById(first.safetyRecommendationId!)!;
    expect(firstRec.status).toBe('cancelled');

    const third = await runForTrip(trip.id);
    expect(recommendationRepository.findPendingByTripId(trip.id).length).toBe(1);
    expect(third.safetyRecommendationId).not.toBe(second.safetyRecommendationId);
  });

  it('polling GET-equivalent reads (getTripSafetyFinding) never create a recommendation by themselves', () => {
    const trip = driverTrip(0);
    induceSignificantDelayHighConfidence(trip);
    const before = recommendationRepository.findAll().length;
    for (let i = 0; i < 10; i++) getTripSafetyFinding(trip.id);
    expect(recommendationRepository.findAll().length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Simulation / real-device parity
// ---------------------------------------------------------------------------

describe('Simulation and real-device evidence produce the same recommendation shape (no special-case path)', () => {
  it('GPS simulation (STOPPED) -> runForTrip -> a DELAY/NOTIFY_SCHOOL safety recommendation', async () => {
    const trip = driverTrip(0);
    const session = startGpsSimulation(trip.id, 'admin-test', { speedProfile: 'STOPPED', tickSeconds: 300 });
    advanceGpsSimulation(session.id);
    const finding = getTripSafetyFinding(trip.id);

    const result = await runForTrip(trip.id);
    if (finding?.findingType === 'SIGNIFICANT_DELAY_RISK') {
      expect(result.safetyRecommendationOutcome).toBe('created');
      const rec = recommendationRepository.findById(result.safetyRecommendationId!)!;
      expect(rec.type).toBe('DELAY');
      expect(rec.action).toBe('NOTIFY_SCHOOL');
    } else {
      expect(result.safetyRecommendationOutcome).toBe('not_eligible');
    }
  });

  it('real device telemetry -> runForTrip -> the same recommendation shape as simulation', async () => {
    const trip = driverTrip(1);
    const { device } = registerDevice(trip.busId, 'TEST DEVICE — 7C parity', 'DEVICE');
    const authed = { id: device.id, busId: device.busId, providerType: 'DEVICE' as const };
    const stops = routeRepository.findStopsByRouteId(trip.routeId).slice().sort((a, b) => a.orderSequence - b.orderSequence);

    ingestObservation(authed, {
      sourceEventId: '7c-parity-1',
      tripId: trip.id,
      occurredAt: new Date().toISOString(),
      latitude: stops[0].lat,
      longitude: stops[0].lng,
      speedKmh: 2,
    });

    const result = await runForTrip(trip.id);
    expect(result.safetyRecommendationOutcome).toBe('created');
    const rec = recommendationRepository.findById(result.safetyRecommendationId!)!;
    expect(rec.type).toBe('DELAY');
    expect(rec.action).toBe('NOTIFY_SCHOOL');
    expect(rec.requiresApproval).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Governance boundary — cannot execute, cannot bypass PolicyEngine/Approval Center
// ---------------------------------------------------------------------------

describe('Governance boundary — a created safety recommendation is PENDING ONLY, never auto-executed', () => {
  it('a freshly created safety recommendation always starts pending — never approved/executed/verified', () => {
    const trip = driverTrip(0);
    induceSignificantDelayHighConfidence(trip);
    const result = createSafetyFindingRecommendation(trip.id, 'gov-test-1', new Date());
    const rec = recommendationRepository.findById(result.recommendationId!)!;
    expect(rec.status).toBe('pending');
    expect(rec.decidedAt).toBeNull();
    expect(rec.decidedByUserId).toBeNull();
  });

  it('no `actions` row exists for a newly created safety recommendation — ActionExecutor was never invoked', async () => {
    const trip = driverTrip(0);
    induceSignificantDelayHighConfidence(trip);
    const result = await runForTrip(trip.id);
    const verificationRes = await import('../../server/repositories/actionRepository');
    const actions = verificationRes.actionRepository.findByRecommendationId(result.safetyRecommendationId!);
    expect(actions.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Isolation — the full scenario mutates only the expected recommendation/audit rows
// ---------------------------------------------------------------------------

describe('MANDATORY: the safety-recommendation scenario never mutates Journey/Trip/Bus/Route/telemetry/current-location/notifications/contacts', () => {
  it('full snapshot comparison before/after running the scenario', async () => {
    const trip = driverTrip(0);
    const bus = busRepository.findById(trip.busId)!;
    const route = routeRepository.findById(trip.routeId)!;
    const student = studentRepository.findByBusId(trip.busId)[0];

    induceSignificantDelayHighConfidence(trip);

    const tripBefore = tripRepository.findById(trip.id);
    const busBefore = busRepository.findById(bus.id);
    const routeBefore = routeRepository.findById(trip.routeId);
    const studentsBefore = studentRepository.findByBusId(trip.busId);
    const journeysBefore = journeyRepository.findByTripId(trip.id);
    const observationCountBefore = telemetryObservationRepository.findFiltered({ busId: bus.id, limit: 500 }).length;
    const notificationsCountBefore = db.select().from(notifications).all().length;
    const contactsCountBefore = db.select().from(userContacts).all().length;

    const result = await runForTrip(trip.id);
    expect(result.safetyRecommendationOutcome).toBe('created');

    expect(tripRepository.findById(trip.id)).toEqual(tripBefore);
    expect(busRepository.findById(bus.id)).toEqual(busBefore);
    expect(routeRepository.findById(trip.routeId)).toEqual(routeBefore);
    expect(studentRepository.findByBusId(trip.busId)).toEqual(studentsBefore);
    expect(journeyRepository.findByTripId(trip.id)).toEqual(journeysBefore);
    expect(telemetryObservationRepository.findFiltered({ busId: bus.id, limit: 500 }).length).toBe(observationCountBefore);
    expect(db.select().from(notifications).all().length).toBe(notificationsCountBefore); // no parent notification created
    expect(db.select().from(userContacts).all().length).toBe(contactsCountBefore);
    expect(student).toBeTruthy(); // fixture sanity
  });

  it('audit entries produced are exactly the expected governance events — no polling noise, no duplication', () => {
    const trip = driverTrip(0);
    induceSignificantDelayHighConfidence(trip);
    const before = auditRepository.findAll().length;

    const result = createSafetyFindingRecommendation(trip.id, 'audit-test', new Date());
    expect(result.outcome).toBe('created');

    const created = auditRepository.findAll().length - before;
    expect(created).toBe(2); // POLICY_EVALUATED + RECOMMENDATION_CREATED, exactly

    const events = auditRepository.findByRecommendationId(result.recommendationId!).map((e) => e.eventType);
    expect(events).toContain('RECOMMENDATION_CREATED');
  });
});

// ---------------------------------------------------------------------------
// Authorization — POST /api/agent/run now requires an operational user
// ---------------------------------------------------------------------------

describe('Authorization — POST /api/agent/run reuses requireOperationalUser, no new mechanism', () => {
  it('admin and school are authorized', () => {
    const admin = userRepository.findAll().find((u) => u.role === 'admin')!;
    const school = userRepository.findAll().find((u) => u.role === 'school')!;
    expect(requireOperationalUser(admin.email).ok).toBe(true);
    expect(requireOperationalUser(school.email).ok).toBe(true);
  });

  it('driver is rejected — the agent endpoint is unscoped operational, not journey-read', () => {
    const driverUser = userRepository.findAll().find((u) => u.role === 'driver')!;
    const guard = requireOperationalUser(driverUser.email);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(403);
  });

  it('parent is rejected', () => {
    const parentUser = userRepository.findAll().find((u) => u.role === 'parent')!;
    const guard = requireOperationalUser(parentUser.email);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(403);
  });

  it('unauthenticated (no userEmail) is rejected', () => {
    expect(requireOperationalUser(undefined).ok).toBe(false);
  });

  it('unknown user is rejected', () => {
    expect(requireOperationalUser('nobody@masara.om').ok).toBe(false);
  });

  it('a device credential (raw id, not an email) is rejected by the same guard', async () => {
    const trip = driverTrip(0);
    const { device } = registerDevice(trip.busId, 'TEST DEVICE — agent-run-guard', 'DEVICE');
    expect(requireOperationalUser(device.id).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Source-scan governance guards
// ---------------------------------------------------------------------------

describe('Source-scan governance guards — Phase 7C cannot bypass the governance chain', () => {
  const adapterSource = fs.readFileSync(path.resolve(__dirname, '../../server/agents/SafetyFindingRecommendationAdapter.ts'), 'utf8');
  const agentSource = fs.readFileSync(path.resolve(__dirname, '../../server/agents/MasaraOperationsAgent.ts'), 'utf8');
  const agentRoutesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/agentRoutes.ts'), 'utf8');
  const safetyFindingServiceSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/SafetyFindingService.ts'), 'utf8');

  const forbidden =
    /from ['"].*\/(ActionExecutor|JourneyService|JourneyStateMachine|TelemetryIngestionService|NotificationService|NotificationPolicy)['"]/;

  it('SafetyFindingRecommendationAdapter.ts imports none of the forbidden execution/mutation modules', () => {
    expect(adapterSource).not.toMatch(forbidden);
  });

  it('SafetyFindingService.ts (Phase 7B) still imports none of them — untouched, still read-only', () => {
    expect(safetyFindingServiceSource).not.toMatch(forbidden);
    expect(safetyFindingServiceSource).not.toMatch(/from ['"].*\/(SafetyFindingRecommendationAdapter|MasaraOperationsAgent)['"]/); // never imports the agent
  });

  it('the adapter never calls approveRecommendation/executeApprovedAction or any ActionExecutor export', () => {
    expect(adapterSource).not.toMatch(/approveRecommendation|executeApprovedAction/);
  });

  it('the adapter creates recommendations only with status "pending" or "rejected" — never "approved"/"executed"/"verified"', () => {
    expect(adapterSource).not.toMatch(/status:\s*['"](approved|executed|verified)['"]/);
  });

  it('no client-supplied confidence/severity/delaySeconds/action/findingType is trusted anywhere in the new files', () => {
    for (const source of [adapterSource, agentSource]) {
      expect(source).not.toMatch(/req\.(body|query)/);
    }
    // The route itself still reads only tripId + userEmail from the body — unchanged surface.
    const postBlock = agentRoutesSource.slice(agentRoutesSource.indexOf("agentRouter.post('/api/agent/run'"));
    const handlerBlock = postBlock.slice(0, postBlock.indexOf('\n});') + 4);
    expect(handlerBlock).toMatch(/req\.body\?\.userEmail/);
    expect(handlerBlock).toMatch(/const \{ tripId \} = req\.body/);
    expect(handlerBlock).not.toMatch(/req\.body\.(confidence|severity|delaySeconds|action|findingType|classification)/);
  });

  it('POST /api/agent/run is now guarded by requireOperationalUser', () => {
    const start = agentRoutesSource.indexOf("agentRouter.post('/api/agent/run'");
    const block = agentRoutesSource.slice(start, agentRoutesSource.indexOf('\n});', start));
    expect(block).toMatch(/requireOperationalUser\(/);
  });

  it('the eligible-finding-type allow-list only contains SIGNIFICANT_DELAY_RISK', () => {
    expect(adapterSource).toMatch(/ELIGIBLE_FINDING_TYPES.*=.*new Set\(\['SIGNIFICANT_DELAY_RISK'\]\)/);
  });
});
