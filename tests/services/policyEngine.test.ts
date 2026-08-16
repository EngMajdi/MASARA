import { describe, it, expect, beforeAll } from 'vitest';
import { evaluateRecommendation } from '../../server/services/PolicyEngine';
import { tripRepository } from '../../server/repositories/tripRepository';
import { routeRepository } from '../../server/repositories/routeRepository';
import { busRepository } from '../../server/repositories/busRepository';

describe('PolicyEngine', () => {
  let activeTripId: string;
  let sameSchoolRouteId: string;

  beforeAll(() => {
    const active = tripRepository.findAll().find((t) => t.status === 'active')!;
    activeTripId = active.id;
    const bus = busRepository.findById(active.busId)!;
    sameSchoolRouteId = routeRepository.findBySchoolId(bus.schoolId).find((r) => r.id !== active.routeId)!.id;
  });

  it('allows a CHANGE_ROUTE recommendation targeting a valid same-school route', () => {
    const result = evaluateRecommendation(
      { action: 'CHANGE_ROUTE', targetId: sameSchoolRouteId, requiresApproval: true },
      activeTripId
    );
    expect(result.allowed).toBe(true);
  });

  it('rejects CHANGE_ROUTE with a missing targetId', () => {
    const result = evaluateRecommendation(
      { action: 'CHANGE_ROUTE', targetId: null, requiresApproval: true },
      activeTripId
    );
    expect(result.allowed).toBe(false);
  });

  it('rejects CHANGE_ROUTE targeting a route that does not exist', () => {
    const result = evaluateRecommendation(
      { action: 'CHANGE_ROUTE', targetId: 'nonexistent-route', requiresApproval: true },
      activeTripId
    );
    expect(result.allowed).toBe(false);
  });

  it('rejects an unknown action outright', () => {
    const result = evaluateRecommendation(
      { action: 'DELETE_EVERYTHING', targetId: null, requiresApproval: true },
      activeTripId
    );
    expect(result.allowed).toBe(false);
  });

  it('rejects a mutating action that claims it does not require approval (no hidden bypass)', () => {
    const result = evaluateRecommendation(
      { action: 'NOTIFY_SCHOOL', targetId: activeTripId, requiresApproval: false },
      activeTripId
    );
    expect(result.allowed).toBe(false);
  });

  it('rejects recommendations for a trip that does not exist', () => {
    const result = evaluateRecommendation(
      { action: 'NOTIFY_SCHOOL', targetId: null, requiresApproval: true },
      'nonexistent-trip'
    );
    expect(result.allowed).toBe(false);
  });
});
