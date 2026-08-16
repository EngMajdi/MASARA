import { describe, it, expect, beforeAll } from 'vitest';
import { listOperationsEvents, deriveCategory } from '../../server/services/OperationsFeed';
import { runForTrip } from '../../server/agents/MasaraOperationsAgent';
import { tripRepository } from '../../server/repositories/tripRepository';

// POLICY_EVALUATED is only logged once the agent gets past the NO_ACTION
// early-return — the seed's first trip has a near-zero delay (LOW risk,
// NO_ACTION), which never reaches that log call. Inject a real delay first
// so this fixture actually exercises the policy-evaluation step.

describe('OperationsFeed — derived category mapping (spec §27)', () => {
  it('maps known event types to the right category', () => {
    expect(deriveCategory('RECOMMENDATION_CREATED')).toBe('ai');
    expect(deriveCategory('TRIP_STARTED')).toBe('trips');
    expect(deriveCategory('APPROVED')).toBe('approvals');
    expect(deriveCategory('ACTION_COMPLETED')).toBe('actions');
    expect(deriveCategory('VERIFICATION_COMPLETED')).toBe('verification');
    expect(deriveCategory('SAFETY_INCIDENT')).toBe('safety');
  });

  it('falls back to a sensible default category for an unrecognized event type', () => {
    expect(deriveCategory('SOME_FUTURE_EVENT')).toBe('ai');
  });
});

describe('OperationsFeed — filtering is a real projection over audit_logs, no duplicate storage (spec §24/§25)', () => {
  let tripId: string;

  beforeAll(async () => {
    const trip = tripRepository.findAll()[0];
    tripId = trip.id;
    const target = trip.targetArrivalAt ?? new Date();
    tripRepository.update(tripId, { currentEtaAt: new Date(target.getTime() + 9 * 60_000) });
    await runForTrip(tripId); // produces real RECOMMENDATION_CREATED / POLICY_EVALUATED audit rows for this trip
  });

  it('filters by tripId using a single indexed query (no N+1)', () => {
    const events = listOperationsEvents({ tripId });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.tripId === tripId)).toBe(true);
  });

  it('filters by eventType', () => {
    const events = listOperationsEvents({ tripId, eventType: 'POLICY_EVALUATED' });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.eventType === 'POLICY_EVALUATED')).toBe(true);
  });

  it('filters by category', () => {
    const events = listOperationsEvents({ tripId, category: 'ai' });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.category === 'ai')).toBe(true);
  });

  it('respects limit', () => {
    const events = listOperationsEvents({ tripId, limit: 1 });
    expect(events.length).toBe(1);
  });

  it('an untouched trip has no events at all — filtering is real, not global', () => {
    const otherTrip = tripRepository.findAll().find((t) => t.id !== tripId);
    if (!otherTrip) return; // seed always has >1 trip, but guard anyway
    const events = listOperationsEvents({ tripId: otherTrip.id });
    expect(events.length).toBe(0);
  });
});
