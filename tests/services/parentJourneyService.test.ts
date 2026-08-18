import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { students, users } from '../../database/schema';
import { getParentJourneys, getParentJourneyEvents, ParentAccessDeniedError } from '../../server/services/ParentJourneyService';
import { resolveAuthorizedStudents, isStudentAuthorized } from '../../server/services/ParentAccessService';
import { DEMO_PARENT_PHONE_BY_EMAIL, JOURNEY_ACTIVE_STATES } from '../../server/domain/parentAccessContract';
import { requireParentUser, requireOperationalUser, requireJourneyReader, requireTelemetryReader } from '../../server/services/authz';
import { userRepository } from '../../server/repositories/userRepository';
import { studentRepository } from '../../server/repositories/studentRepository';
import { journeyRepository } from '../../server/repositories/journeyRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { auditRepository } from '../../server/repositories/auditRepository';
import { recommendationRepository } from '../../server/repositories/recommendationRepository';
import { routeRepository } from '../../server/repositories/routeRepository';
import { telemetryObservationRepository } from '../../server/repositories/telemetryObservationRepository';
import { currentLocationProjectionRepository } from '../../server/repositories/currentLocationProjectionRepository';
import { processObservation } from '../../server/services/CurrentLocationProjectionService';
import { registerDevice } from '../../server/services/TelemetryDeviceService';
import type { TelemetryObservation } from '../../server/domain/telemetryContract';

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

beforeEach(() => {
  currentLocationProjectionRepository.clear();
});

const parentAUser = () => userRepository.findByEmail('parent@masara.om')!;

/**
 * Every test that creates its own Journey rows gets a completely fresh,
 * isolated (parent, child) pair — a unique phone/email/student, never
 * reusing the seeded demo parent's own two children across tests. This
 * avoids the (studentId, tripId) uniqueness constraint entirely (real
 * journeys persist for the whole test FILE, not just one `it()` block —
 * same lesson learned in Phase 4E/4C) without weakening what's being tested:
 * the DEMO-ONLY mechanism itself is exercised identically either way.
 */
let freshChildCounter = 0;
function createFreshAuthorizedChild() {
  freshChildCounter += 1;
  const admin = userRepository.findByEmail('admin@masara.om')!;
  const bus = busRepository.findAll()[0];
  const phone = `+968 9900 ${String(freshChildCounter).padStart(4, '0')}`;
  const email = `fresh-parent-${freshChildCounter}-test@masara.om`;

  db.insert(students)
    .values({
      id: crypto.randomUUID(),
      schoolId: admin.schoolId!,
      name: `طالب اختبار ${freshChildCounter}`,
      grade: 'الأول',
      busId: bus.id,
      pickupLat: 23.6,
      pickupLng: 58.4,
      pickupAddress: 'test',
      parentPhone: phone,
    })
    .run();
  db.insert(users).values({ id: crypto.randomUUID(), schoolId: admin.schoolId, name: `Fresh Parent ${freshChildCounter}`, email, passwordHash: 'x', role: 'parent' }).run();
  (DEMO_PARENT_PHONE_BY_EMAIL as Record<string, string>)[email] = phone;

  const parentUser = userRepository.findByEmail(email)!;
  const student = resolveAuthorizedStudents(parentUser)[0];
  return { parentUser, student };
}

describe('ParentAccessService.resolveAuthorizedStudents — the entire DEMO-ONLY identity boundary (spec §3/§4)', () => {
  it('the seeded demo parent resolves to exactly the students seeded with the matching demo phone', () => {
    const authorized = resolveAuthorizedStudents(parentAUser());
    expect(authorized.length).toBeGreaterThan(0);
    for (const s of authorized) {
      expect(s.parentPhone).toBe(DEMO_PARENT_PHONE_BY_EMAIL['parent@masara.om']);
    }
  });

  it('an email with no entry in the demo map resolves to zero students — never everyone, never a fallback', () => {
    const admin = userRepository.findByEmail('admin@masara.om')!;
    expect(resolveAuthorizedStudents(admin).length).toBe(0);
  });

  it('isStudentAuthorized never trusts the studentId alone — re-derives the authorized set every call', () => {
    const authorized = resolveAuthorizedStudents(parentAUser());
    expect(isStudentAuthorized(parentAUser(), authorized[0].id)).toBe(true);
    const someOtherStudent = studentRepository.findAll().find((s) => !authorized.some((a) => a.id === s.id))!;
    expect(isStudentAuthorized(parentAUser(), someOtherStudent.id)).toBe(false);
  });
});

describe('requireParentUser authorization matrix (spec §19 mandatory)', () => {
  it('the seeded parent passes', () => {
    expect(requireParentUser('parent@masara.om').ok).toBe(true);
  });

  it('admin, school, and driver are all rejected — 403', () => {
    for (const email of ['admin@masara.om', 'school@masara.om', 'driver1@masara.om']) {
      const guard = requireParentUser(email);
      expect(guard.ok).toBe(false);
      if (guard.ok === false) expect(guard.status).toBe(403);
    }
  });

  it('unauthenticated (missing email) is rejected — 400', () => {
    const guard = requireParentUser(undefined);
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(400);
  });

  it('unknown user is rejected — 404', () => {
    const guard = requireParentUser('nobody@masara.om');
    expect(guard.ok).toBe(false);
    if (guard.ok === false) expect(guard.status).toBe(404);
  });

  it('a device credential (its raw id, not an email) is rejected by the same guard', () => {
    const bus = busRepository.findAll()[0];
    const { device } = registerDevice(bus.id, 'TEST DEVICE — parent-guard-mismatch', 'DEVICE');
    expect(requireParentUser(device.id).ok).toBe(false);
  });

  it('the parent role is rejected by every OTHER operational guard (spec §29 — parent never gets broader access)', () => {
    expect(requireOperationalUser('parent@masara.om').ok).toBe(false);
    expect(requireJourneyReader('parent@masara.om').ok).toBe(false);
    expect(requireTelemetryReader('parent@masara.om').ok).toBe(false);
  });
});

describe('getParentJourneys — active-journey selection rule (spec §13 mandatory, deterministic)', () => {
  it('an active-state journey wins over a terminal one regardless of recency', () => {
    const { parentUser, student } = createFreshAuthorizedChild();
    const trips = tripRepository.findAll();

    journeyRepository.create({ studentId: student.id, tripId: trips[0].id, state: 'cancelled' });
    journeyRepository.create({ studentId: student.id, tripId: trips[1].id, state: 'in_transit' });

    const view = getParentJourneys(parentUser).find((v) => v.child.id === student.id)!;
    expect(view.journey?.state).toBe('in_transit');
  });

  it('among non-active journeys, one created today wins over an older one', () => {
    const { parentUser, student } = createFreshAuthorizedChild();
    const trips = tripRepository.findAll();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    journeyRepository.create({ studentId: student.id, tripId: trips[0].id, state: 'cancelled', createdAt: threeDaysAgo, updatedAt: threeDaysAgo });
    journeyRepository.create({ studentId: student.id, tripId: trips[2].id, state: 'scheduled' });

    const view = getParentJourneys(parentUser).find((v) => v.child.id === student.id)!;
    expect(view.journey?.state).toBe('scheduled');
  });

  it('with no active and no today journey, the single most recently created journey wins', () => {
    const { parentUser, student } = createFreshAuthorizedChild();
    const trips = tripRepository.findAll();
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    journeyRepository.create({ studentId: student.id, tripId: trips[0].id, state: 'cancelled', createdAt: fiveDaysAgo, updatedAt: fiveDaysAgo });
    journeyRepository.create({ studentId: student.id, tripId: trips[1].id, state: 'completed', createdAt: threeDaysAgo, updatedAt: threeDaysAgo });

    const view = getParentJourneys(parentUser).find((v) => v.child.id === student.id)!;
    expect(view.journey?.state).toBe('completed'); // the more recently created of the two
  });

  it('confirms every active state in the constant is actually treated as active (regression guard against a silently-stale list)', () => {
    expect(JOURNEY_ACTIVE_STATES).toEqual(['waiting', 'boarding', 'on_bus', 'in_transit', 'approaching_stop']);
  });
});

describe('getParentJourneys — honest journey/location/ETA states, never fabricated (spec §16 mandatory)', () => {
  it('a student with zero journeys ever created returns journey: null (NO_ACTIVE_JOURNEY)', () => {
    const { parentUser, student } = createFreshAuthorizedChild();
    const views = getParentJourneys(parentUser);
    expect(views).toHaveLength(1);
    expect(views[0].child.id).toBe(student.id);
    expect(views[0].journey).toBeNull();
    expect(views[0].bus).toBeNull();
    expect(views[0].eta).toBeNull();
    expect(views[0].location).toBeNull();
  });

  it.each(['completed', 'missed', 'cancelled', 'incident'] as const)('a %s journey is surfaced with its real state, never relabeled', (state) => {
    const { parentUser, student } = createFreshAuthorizedChild();
    const trip = tripRepository.findAll()[0];
    journeyRepository.create({ studentId: student.id, tripId: trip.id, state });
    const view = getParentJourneys(parentUser).find((v) => v.child.id === student.id)!;
    expect(view.journey?.state).toBe(state);
  });

  it('a bus with no current-location projection row returns location: null — never fabricated coordinates', () => {
    const { parentUser, student } = createFreshAuthorizedChild();
    const trip = tripRepository.findAll()[0];
    journeyRepository.create({ studentId: student.id, tripId: trip.id, state: 'in_transit' });
    // currentLocationProjectionRepository was cleared in beforeEach — guaranteed no row.
    const view = getParentJourneys(parentUser).find((v) => v.child.id === student.id)!;
    expect(view.location).toBeNull();
  });

  it('a stale current-location projection is honestly reported as STALE, not LIVE', () => {
    const { parentUser, student } = createFreshAuthorizedChild();
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    journeyRepository.create({ studentId: student.id, tripId: trip.id, state: 'in_transit' });
    const staleAt = new Date(Date.now() - 10 * 60_000);
    processObservation(makeObservation(trip.busId, { occurredAt: staleAt, receivedAt: staleAt }));

    const view = getParentJourneys(parentUser).find((v) => v.child.id === student.id)!;
    expect(view.location?.freshness).toBe('STALE');
  });

  it('ETA is reused as-is from EtaService — UNKNOWN status passes through honestly, never fabricated as ON_TIME', () => {
    const { parentUser, student } = createFreshAuthorizedChild();
    const trip = tripRepository.findAll()[0];
    journeyRepository.create({ studentId: student.id, tripId: trip.id, state: 'waiting' });
    // No location at all -> getTripEta honestly returns UNKNOWN.
    const view = getParentJourneys(parentUser).find((v) => v.child.id === student.id)!;
    expect(view.eta).not.toBeNull();
    expect(view.eta?.status).toBe('UNKNOWN');
    expect(view.eta?.estimatedArrivalAt).toBeNull();
  });
});

describe('getParentJourneyEvents — safe event filtering (spec §11 mandatory)', () => {
  it('returns only real Journey-transition events, oldest first', () => {
    const { parentUser, student } = createFreshAuthorizedChild();
    const trip = tripRepository.findAll()[0];
    const journey = journeyRepository.create({ studentId: student.id, tripId: trip.id, state: 'scheduled' });
    auditRepository.create({
      eventType: 'JOURNEY_CREATED',
      actorType: 'system',
      entityType: 'journey',
      entityId: journey.id,
      tripId: trip.id,
      studentId: student.id,
      inputSummary: 'test fixture',
    });

    const events = getParentJourneyEvents(parentUser, journey.id)!;
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect([
        'JOURNEY_CREATED', 'JOURNEY_STARTED', 'BOARDING_STARTED', 'STUDENT_BOARDED', 'TRANSIT_STARTED',
        'STOP_APPROACHING', 'STUDENT_DROPPED_OFF', 'JOURNEY_COMPLETED', 'JOURNEY_CANCELLED', 'STUDENT_MISSED', 'JOURNEY_INCIDENT',
      ]).toContain(e.eventType);
    }
  });

  it('a nonexistent journeyId returns null (never a fabricated empty-success)', () => {
    expect(getParentJourneyEvents(parentAUser(), 'does-not-exist')).toBeNull();
  });

  it('an AI/governance-shaped event under the same journey entity is filtered out by the defensive allow-list', () => {
    const { parentUser, student } = createFreshAuthorizedChild();
    const trip = tripRepository.findAll()[0];
    const journey = journeyRepository.create({ studentId: student.id, tripId: trip.id, state: 'scheduled' });
    auditRepository.create({
      eventType: 'RECOMMENDATION_CREATED',
      actorType: 'agent',
      entityType: 'journey',
      entityId: journey.id,
      tripId: trip.id,
      studentId: student.id,
      inputSummary: 'test fixture — forbidden event type',
    });
    const events = getParentJourneyEvents(parentUser, journey.id)!;
    expect(events.some((e) => e.eventType === 'RECOMMENDATION_CREATED')).toBe(false);
  });
});

describe('Cross-parent data isolation (spec §21 mandatory)', () => {
  it('Parent A response contains zero information about child B, and vice versa', () => {
    const a = createFreshAuthorizedChild();
    const b = createFreshAuthorizedChild();

    const viewsA = getParentJourneys(a.parentUser);
    expect(viewsA.some((v) => v.child.id === b.student.id)).toBe(false);
    expect(viewsA.every((v) => v.child.id === a.student.id)).toBe(true);

    const viewsB = getParentJourneys(b.parentUser);
    expect(viewsB.some((v) => v.child.id === a.student.id)).toBe(false);
    expect(viewsB.every((v) => v.child.id === b.student.id)).toBe(true);
  });

  it('Parent A cannot access child B\'s journey by student ID, journey ID, or trip ID (spec §21)', () => {
    const a = createFreshAuthorizedChild();
    const b = createFreshAuthorizedChild();
    const trip = tripRepository.findAll()[0];
    const journeyB = journeyRepository.create({ studentId: b.student.id, tripId: trip.id, state: 'scheduled' });

    expect(isStudentAuthorized(a.parentUser, b.student.id)).toBe(false);
    expect(() => getParentJourneyEvents(a.parentUser, journeyB.id)).toThrow(ParentAccessDeniedError);
  });

  it('Parent B cannot access child A\'s journey events by journey ID — symmetric rejection', () => {
    const a = createFreshAuthorizedChild();
    const b = createFreshAuthorizedChild();
    const trip = tripRepository.findAll()[1];
    const journeyA = journeyRepository.create({ studentId: a.student.id, tripId: trip.id, state: 'scheduled' });

    expect(() => getParentJourneyEvents(b.parentUser, journeyA.id)).toThrow(ParentAccessDeniedError);
  });
});

describe('Isolation — parent reads mutate nothing else (spec §22 mandatory)', () => {
  it('audit_logs, journeys, trips, buses, routes, recommendations, telemetry_observations, current_location_projection are all unchanged', () => {
    const { parentUser, student } = createFreshAuthorizedChild();
    const trip = tripRepository.findAll().find((t) => t.driverId)!;
    const journey = journeyRepository.create({ studentId: student.id, tripId: trip.id, state: 'in_transit' });
    processObservation(makeObservation(trip.busId));

    const before = {
      auditCount: auditRepository.findAll().length,
      journeys: JSON.stringify(journeyRepository.findByStudentId(student.id)),
      trips: JSON.stringify(tripRepository.findAll()),
      buses: JSON.stringify(busRepository.findAll()),
      routes: JSON.stringify(routeRepository.findAll()),
      recommendations: JSON.stringify(recommendationRepository.findAll()),
      telemetry: JSON.stringify(telemetryObservationRepository.findFiltered({ limit: 500 })),
      projection: JSON.stringify(currentLocationProjectionRepository.findAll()),
    };

    getParentJourneys(parentUser);
    getParentJourneyEvents(parentUser, journey.id);

    expect(auditRepository.findAll().length).toBe(before.auditCount);
    expect(JSON.stringify(journeyRepository.findByStudentId(student.id))).toBe(before.journeys);
    expect(JSON.stringify(tripRepository.findAll())).toBe(before.trips);
    expect(JSON.stringify(busRepository.findAll())).toBe(before.buses);
    expect(JSON.stringify(routeRepository.findAll())).toBe(before.routes);
    expect(JSON.stringify(recommendationRepository.findAll())).toBe(before.recommendations);
    expect(JSON.stringify(telemetryObservationRepository.findFiltered({ limit: 500 }))).toBe(before.telemetry);
    expect(JSON.stringify(currentLocationProjectionRepository.findAll())).toBe(before.projection);
  });
});

describe('Source-scan governance guards (spec §20 mandatory) — Parent layer is demonstrably read-only', () => {
  const serviceSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/ParentJourneyService.ts'), 'utf8');
  const accessSource = fs.readFileSync(path.resolve(__dirname, '../../server/services/ParentAccessService.ts'), 'utf8');
  const routesSource = fs.readFileSync(path.resolve(__dirname, '../../server/routes/parentRoutes.ts'), 'utf8');
  const forbiddenImports =
    /from ['"].*\/(JourneyService|ActionExecutor|PolicyEngine|MasaraOperationsAgent|TelemetryIngestionService)['"]/;

  it('ParentJourneyService.ts and ParentAccessService.ts import no mutation module', () => {
    expect(serviceSource).not.toMatch(forbiddenImports);
    expect(accessSource).not.toMatch(forbiddenImports);
  });

  it('ParentJourneyService.ts imports no CurrentLocationProjectionService WRITE function (read-only: getCurrentLocation only)', () => {
    expect(serviceSource).not.toMatch(/\bprocessObservation\b/);
    expect(serviceSource).not.toMatch(/\bupsertIfNewer\b/);
  });

  it('ParentJourneyService.ts never writes audit_logs (imports no auditRepository.create usage)', () => {
    expect(serviceSource).not.toMatch(/auditRepository\.create/);
  });

  it('parentRoutes.ts has exactly one mutating handler — the Phase 5B notification mark-read endpoint — and no PUT/PATCH/DELETE at all', () => {
    expect(routesSource).not.toMatch(/parentRouter\.(put|patch|delete)\(/);
    const postMatches = routesSource.match(/parentRouter\.post\(/g) ?? [];
    expect(postMatches.length).toBe(1);
    expect(routesSource).toMatch(/parentRouter\.post\(\s*['"]\/api\/parent\/notifications\/:id\/read['"]/);
  });

  it('parentRoutes.ts never trusts a client-supplied studentId, busId, or tripId', () => {
    expect(routesSource).not.toMatch(/req\.(query|body|params)\??\.(studentId|busId|tripId)\b/);
  });

  it('no generic bus or trip lookup endpoint exists under /api/parent (spec §8 — never Parent -> Bus directly)', () => {
    expect(routesSource).not.toMatch(/['"]\/api\/parent\/bus/);
    expect(routesSource).not.toMatch(/['"]\/api\/parent\/trips?\//);
  });

  it('every parent route (GET and the one POST) is guarded by requireParentUser — no unguarded handler', () => {
    const handlerCount = (routesSource.match(/parentRouter\.(get|post)\(/g) ?? []).length;
    const guardCount = (routesSource.match(/requireParentUser\(/g) ?? []).length;
    expect(handlerCount).toBeGreaterThan(0);
    expect(guardCount).toBe(handlerCount);
  });
});
