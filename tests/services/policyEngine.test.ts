import { describe, it, expect, beforeAll } from 'vitest';
import {
  evaluateRecommendation,
  requiresApprovalForRisk,
  requiresElevatedVisibility,
  isExpired,
} from '../../server/services/PolicyEngine';
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

// Spec Phase 2A §7 policy table: LOW may skip approval; MEDIUM/HIGH/CRITICAL always require it.
describe('PolicyEngine — risk-based approval requirement', () => {
  it('LOW does not require approval', () => {
    expect(requiresApprovalForRisk('low')).toBe(false);
  });

  it('MEDIUM, HIGH, and CRITICAL all require approval', () => {
    expect(requiresApprovalForRisk('medium')).toBe(true);
    expect(requiresApprovalForRisk('high')).toBe(true);
    expect(requiresApprovalForRisk('critical')).toBe(true);
  });

  it('only CRITICAL gets elevated visibility', () => {
    expect(requiresElevatedVisibility('critical')).toBe(true);
    expect(requiresElevatedVisibility('high')).toBe(false);
    expect(requiresElevatedVisibility('medium')).toBe(false);
    expect(requiresElevatedVisibility('low')).toBe(false);
  });
});

describe('PolicyEngine — expiration (spec §19, AC-09)', () => {
  it('treats a past expiresAt as expired', () => {
    expect(isExpired(new Date(Date.now() - 1000))).toBe(true);
  });

  it('treats a future expiresAt as not expired', () => {
    expect(isExpired(new Date(Date.now() + 60_000))).toBe(false);
  });

  it('treats a null/undefined expiresAt as never expiring', () => {
    expect(isExpired(null)).toBe(false);
    expect(isExpired(undefined)).toBe(false);
  });
});
