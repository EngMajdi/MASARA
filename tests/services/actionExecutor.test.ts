import { describe, it, expect, vi } from 'vitest';
import {
  approveRecommendation,
  rejectRecommendation,
  requestReview,
  ValidationError,
  RecommendationExpiredError,
} from '../../server/services/ActionExecutor';
import { recommendationRepository } from '../../server/repositories/recommendationRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { routeRepository } from '../../server/repositories/routeRepository';
import { auditRepository } from '../../server/repositories/auditRepository';
import { userRepository } from '../../server/repositories/userRepository';

// NOTE on Phase 2A behavior changes vs Phase 1 (documented, not silently patched):
// - approveRecommendation's final status is now 'verified' (or 'execution_failed' /
//   'verification_failed'), not 'approved' — approve/execute/verify are three
//   distinct persisted transitions (spec Phase 2A §14/§17), not one collapsed step.
// - A single approve() call now emits multiple audit events (APPROVED,
//   ACTION_STARTED, ACTION_COMPLETED, VERIFICATION_STARTED, VERIFICATION_COMPLETED),
//   not one — AC-14 explicitly asks for events "throughout the lifecycle".
// - Double-approval throws RecommendationStateError once the first call has
//   already run to completion (the row is terminal by then); ConflictError
//   guards the narrower read-then-write gap within a single call — see the
//   dedicated "claimTransition is atomic" test below.
// - rejectRecommendation now requires a non-empty reason (throws ValidationError
//   if missing) — this closes a real Phase 1 gap (§11 "do not allow empty
//   rejection reasons"), it isn't new intentional-vs-accidental churn.

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
    confidence: 0.8,
    action: 'NOTIFY_SCHOOL',
    targetId: trip?.id ?? null,
    reason: 'test reason',
    expectedOutcome: null,
    requiresApproval: true,
    status: 'pending',
    ...overrides,
  });
}

describe('ActionExecutor — approve (execute + verify)', () => {
  it('approving a CHANGE_ROUTE recommendation mutates the trip, verifies success, and reaches "verified"', () => {
    const trip = findActiveTrip();
    const bus = busRepository.findById(trip.busId)!;
    const currentRoute = routeRepository.findById(trip.routeId)!;
    const altRoute = routeRepository
      .findBySchoolId(bus.schoolId)
      .filter((r) => r.id !== trip.routeId)
      .sort((a, b) => a.estimatedDurationMins - b.estimatedDurationMins)[0]!;
    expect(altRoute.estimatedDurationMins).toBeLessThan(currentRoute.estimatedDurationMins);
    const expectedImprovementMins = currentRoute.estimatedDurationMins - altRoute.estimatedDurationMins;

    const admin = findAdmin();
    const rec = makeRecommendation({ tripId: trip.id, action: 'CHANGE_ROUTE', targetId: altRoute.id });

    const auditCountBefore = auditRepository.findAll().length;
    const result = approveRecommendation(rec.id, admin.id);

    expect(result.recommendation.status).toBe('verified');
    expect(result.action!.actionType).toBe('CHANGE_ROUTE');
    expect(result.verification!.status).toBe('success');
    expect(result.verification!.improvementMins).toBe(expectedImprovementMins);

    const updatedTrip = tripRepository.findById(trip.id)!;
    expect(updatedTrip.routeId).toBe(altRoute.id);

    // APPROVED, ACTION_STARTED, ACTION_COMPLETED, VERIFICATION_STARTED, VERIFICATION_COMPLETED
    expect(auditRepository.findAll().length).toBe(auditCountBefore + 5);
  });

  it('an approved NOTIFY_SCHOOL recommendation executes and verifies as success without mutating the trip route', () => {
    const trip = findActiveTrip();
    const admin = findAdmin();
    const rec = makeRecommendation({ tripId: trip.id, action: 'NOTIFY_SCHOOL', targetId: trip.id });

    const result = approveRecommendation(rec.id, admin.id);

    expect(result.recommendation.status).toBe('verified');
    expect(result.verification!.status).toBe('success');
    expect(tripRepository.findById(trip.id)!.routeId).toBe(trip.routeId);
  });

  it('cannot approve the same recommendation twice', () => {
    // approveRecommendation runs fully synchronously through
    // pending->approved->executed->verified in one call, so by the time a
    // second call runs, the row is already terminal ('verified') — caught by
    // the state-machine check as RecommendationStateError. ConflictError is
    // reserved for the narrower read-then-write race *within* a single call;
    // see 'claimTransition is atomic' below for a direct test of that guard.
    const trip = findActiveTrip();
    const admin = findAdmin();
    const rec = makeRecommendation({ tripId: trip.id });

    approveRecommendation(rec.id, admin.id);
    expect(() => approveRecommendation(rec.id, admin.id)).toThrow();
    expect(recommendationRepository.findById(rec.id)!.status).toBe('verified');
  });

  it('claimTransition is atomic — only the first of two conditional claims on the same fromStatus succeeds', () => {
    const trip = findActiveTrip();
    const rec = makeRecommendation({ tripId: trip.id });

    const first = recommendationRepository.claimTransition(rec.id, 'pending', 'approved');
    const second = recommendationRepository.claimTransition(rec.id, 'pending', 'approved');

    expect(first).toBe(true);
    expect(second).toBe(false); // lost the race — row was no longer 'pending'
    expect(recommendationRepository.findById(rec.id)!.status).toBe('approved');
  });

  it('a policy-invalid recommendation (missing target route) is refused at approval time', () => {
    const trip = findActiveTrip();
    const admin = findAdmin();
    const rec = makeRecommendation({ tripId: trip.id, action: 'CHANGE_ROUTE', targetId: 'route-does-not-exist' });
    expect(() => approveRecommendation(rec.id, admin.id)).toThrow();
    expect(recommendationRepository.findById(rec.id)!.status).toBe('pending');
  });

  it('an expired pending recommendation cannot be approved, and is transitioned to expired', () => {
    const trip = findActiveTrip();
    const admin = findAdmin();
    const rec = makeRecommendation({ tripId: trip.id, expiresAt: new Date(Date.now() - 60_000) });

    expect(() => approveRecommendation(rec.id, admin.id)).toThrow(RecommendationExpiredError);
    expect(recommendationRepository.findById(rec.id)!.status).toBe('expired');
  });

  it('execution failure lands the recommendation on execution_failed, not executed/verified', () => {
    const trip = findActiveTrip();
    const admin = findAdmin();
    const rec = makeRecommendation({ tripId: trip.id, action: 'NOTIFY_SCHOOL', targetId: trip.id });

    // The 1st tripRepository.findById call is PolicyEngine's re-validation (must
    // succeed, or we'd get a PolicyRejectionError instead of reaching execution).
    // The 2nd call is executeApprovedAction's own lookup — that's the one we
    // want to fail, to exercise the execution-failure path specifically.
    const realFindById = tripRepository.findById.bind(tripRepository);
    let callCount = 0;
    const spy = vi.spyOn(tripRepository, 'findById').mockImplementation((id: string) => {
      callCount += 1;
      return callCount === 2 ? undefined : realFindById(id);
    });

    const result = approveRecommendation(rec.id, admin.id);
    spy.mockRestore();

    expect(result.action).toBeNull();
    expect(result.verification).toBeNull();
    expect(result.recommendation.status).toBe('execution_failed');
  });
});

describe('ActionExecutor — reject', () => {
  it('rejecting a recommendation does NOT mutate trip state, only records the decision', () => {
    const trip = findActiveTrip();
    const routeBefore = trip.routeId;
    const admin = findAdmin();
    const rec = makeRecommendation({ tripId: trip.id });

    const result = rejectRecommendation(rec.id, admin.id, 'not needed right now');
    expect(result.status).toBe('rejected');
    expect(result.rejectionReason).toBe('not needed right now');
    expect(tripRepository.findById(trip.id)!.routeId).toBe(routeBefore);
  });

  it('rejects with an empty reason — 422 ValidationError, not allowed', () => {
    const trip = findActiveTrip();
    const admin = findAdmin();
    const rec = makeRecommendation({ tripId: trip.id });

    expect(() => rejectRecommendation(rec.id, admin.id, '')).toThrow(ValidationError);
    expect(() => rejectRecommendation(rec.id, admin.id, '   ')).toThrow(ValidationError);
    expect(recommendationRepository.findById(rec.id)!.status).toBe('pending');
  });

  it('cannot reject an already-decided recommendation', () => {
    const trip = findActiveTrip();
    const admin = findAdmin();
    const rec = makeRecommendation({ tripId: trip.id });

    rejectRecommendation(rec.id, admin.id, 'first reason');
    expect(() => rejectRecommendation(rec.id, admin.id, 'second reason')).toThrow();
  });
});

describe('ActionExecutor — request review', () => {
  it('logs a review request without changing the recommendation status', () => {
    const trip = findActiveTrip();
    const admin = findAdmin();
    const rec = makeRecommendation({ tripId: trip.id });

    const result = requestReview(rec.id, admin.id, 'need a second opinion');
    expect(result.status).toBe('pending');
  });
});
