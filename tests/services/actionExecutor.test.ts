import { describe, it, expect } from 'vitest';
import { approveRecommendation, rejectRecommendation } from '../../server/services/ActionExecutor';
import { recommendationRepository } from '../../server/repositories/recommendationRepository';
import { tripRepository } from '../../server/repositories/tripRepository';
import { busRepository } from '../../server/repositories/busRepository';
import { routeRepository } from '../../server/repositories/routeRepository';
import { auditRepository } from '../../server/repositories/auditRepository';
import { userRepository } from '../../server/repositories/userRepository';

function findActiveTrip() {
  return tripRepository.findAll().find((t) => t.status === 'active')!;
}

describe('ActionExecutor', () => {
  it('approving a CHANGE_ROUTE recommendation mutates the trip, verifies success, and records action + audit', () => {
    const trip = findActiveTrip();
    const bus = busRepository.findById(trip.busId)!;
    const currentRoute = routeRepository.findById(trip.routeId)!;
    // Pick a genuinely faster alternative so the outcome should verify as a success.
    const altRoute = routeRepository
      .findBySchoolId(bus.schoolId)
      .filter((r) => r.id !== trip.routeId)
      .sort((a, b) => a.estimatedDurationMins - b.estimatedDurationMins)[0]!;
    expect(altRoute.estimatedDurationMins).toBeLessThan(currentRoute.estimatedDurationMins);
    const expectedImprovementMins = currentRoute.estimatedDurationMins - altRoute.estimatedDurationMins;

    const admin = userRepository.findAll().find((u) => u.role === 'admin')!;

    const rec = recommendationRepository.create({
      tripId: trip.id,
      agentRunId: 'test-run-approve',
      severity: 'high',
      problem: 'test problem',
      action: 'CHANGE_ROUTE',
      targetId: altRoute.id,
      reason: 'test reason',
      requiresApproval: true,
      status: 'pending',
    });

    const auditCountBefore = auditRepository.findAll().length;
    const result = approveRecommendation(rec.id, admin.id);

    expect(result.recommendation.status).toBe('approved');
    expect(result.action.actionType).toBe('CHANGE_ROUTE');
    expect(result.verification.status).toBe('success');
    expect(result.verification.improvementMins).toBe(expectedImprovementMins);

    const updatedTrip = tripRepository.findById(trip.id)!;
    expect(updatedTrip.routeId).toBe(altRoute.id);

    expect(auditRepository.findAll().length).toBe(auditCountBefore + 1);
  });

  it('rejecting a recommendation does NOT mutate trip state, only records the decision', () => {
    const trip = findActiveTrip();
    const routeBefore = trip.routeId;
    const admin = userRepository.findAll().find((u) => u.role === 'admin')!;

    const rec = recommendationRepository.create({
      tripId: trip.id,
      agentRunId: 'test-run-reject',
      severity: 'medium',
      problem: 'test problem',
      action: 'NOTIFY_SCHOOL',
      targetId: trip.id,
      reason: 'test reason',
      requiresApproval: true,
      status: 'pending',
    });

    const result = rejectRecommendation(rec.id, admin.id, 'not needed right now');
    expect(result.status).toBe('rejected');
    expect(result.rejectionReason).toBe('not needed right now');

    const tripAfter = tripRepository.findById(trip.id)!;
    expect(tripAfter.routeId).toBe(routeBefore);
  });

  it('cannot approve the same recommendation twice', () => {
    const trip = findActiveTrip();
    const admin = userRepository.findAll().find((u) => u.role === 'admin')!;
    const rec = recommendationRepository.create({
      tripId: trip.id,
      agentRunId: 'test-run-double',
      severity: 'low',
      problem: 'test',
      action: 'NOTIFY_SCHOOL',
      targetId: trip.id,
      reason: 'x',
      requiresApproval: true,
      status: 'pending',
    });
    approveRecommendation(rec.id, admin.id);
    expect(() => approveRecommendation(rec.id, admin.id)).toThrow();
  });

  it('a policy-invalid recommendation is refused at approval time, even if somehow persisted as pending', () => {
    const trip = findActiveTrip();
    const admin = userRepository.findAll().find((u) => u.role === 'admin')!;
    const rec = recommendationRepository.create({
      tripId: trip.id,
      agentRunId: 'test-run-invalid',
      severity: 'high',
      problem: 'test',
      action: 'CHANGE_ROUTE',
      targetId: 'route-does-not-exist',
      reason: 'x',
      requiresApproval: true,
      status: 'pending',
    });
    expect(() => approveRecommendation(rec.id, admin.id)).toThrow();
  });
});
