import { describe, it, expect } from 'vitest';
import { runForTrip } from '../../server/agents/MasaraOperationsAgent';
import { approveRecommendation } from '../../server/services/ActionExecutor';
import { tripRepository } from '../../server/repositories/tripRepository';
import { incidentRepository } from '../../server/repositories/incidentRepository';
import { recommendationRepository } from '../../server/repositories/recommendationRepository';
import { auditRepository } from '../../server/repositories/auditRepository';
import { predictionRepository } from '../../server/repositories/predictionRepository';
import { userRepository } from '../../server/repositories/userRepository';

function findTripByBusIndex(index: number) {
  const trips = tripRepository.findAll();
  return trips[index];
}

describe('MasaraOperationsAgent — full detect->predict->recommend loop (spec Phase 2A §21/§23, AC-01..04/16)', () => {
  it('produces a pending, schema-valid, richly-populated recommendation for a delayed trip', async () => {
    const trip = findTripByBusIndex(1); // seeded ~9 min behind target
    const result = await runForTrip(trip.id);

    expect(result.status).toBe('pending_approval');
    expect(result.recommendationId).toBeTruthy();

    const rec = recommendationRepository.findById(result.recommendationId!)!;
    expect(rec.status).toBe('pending');
    expect(rec.title).toBeTruthy();
    expect(rec.type).toBeTruthy();
    expect(rec.confidence).toBeGreaterThan(0);
    expect(rec.busId).toBe(trip.busId);
    expect(rec.sourceRouteId).toBe(trip.routeId);
    expect(rec.expiresAt).toBeTruthy();
    expect(new Date(rec.expiresAt!).getTime()).toBeGreaterThan(Date.now());

    const prediction = predictionRepository.findById(result.predictionId)!;
    expect(prediction.delayMinutes).toBeGreaterThan(0);
  });

  it('a trip with no meaningful delay and no incidents yields no_action and no recommendation row', async () => {
    const trip = findTripByBusIndex(0);
    tripRepository.update(trip.id, {
      currentEtaAt: trip.targetArrivalAt, // arriving exactly on time
    });

    const result = await runForTrip(trip.id);
    expect(result.status).toBe('no_action');
    expect(result.recommendationId).toBeNull();
  });

  it('supersedes a stale pending recommendation when the agent re-runs for the same trip', async () => {
    const trip = findTripByBusIndex(1);
    const first = await runForTrip(trip.id);
    expect(first.status).toBe('pending_approval');

    const second = await runForTrip(trip.id);
    expect(second.status).toBe('pending_approval');
    expect(second.recommendationId).not.toBe(first.recommendationId);

    const firstRec = recommendationRepository.findById(first.recommendationId!)!;
    expect(firstRec.status).toBe('cancelled');

    // Never more than one pending recommendation stacked for the same trip.
    expect(recommendationRepository.findPendingByTripId(trip.id).length).toBe(1);
  });

  it('an open ACCIDENT incident forces CRITICAL severity + FLAG_INCIDENT, overriding a low ETA-based risk', async () => {
    const trip = findTripByBusIndex(0);
    tripRepository.update(trip.id, { currentEtaAt: trip.targetArrivalAt }); // otherwise low risk
    incidentRepository.create({
      tripId: trip.id,
      busId: trip.busId,
      type: 'ACCIDENT',
      severity: 'high',
      description: 'Minor collision reported near the school gate',
      status: 'open',
    });

    const result = await runForTrip(trip.id);
    expect(result.status).toBe('pending_approval');

    const rec = recommendationRepository.findById(result.recommendationId!)!;
    expect(rec.severity).toBe('critical');
    expect(rec.type).toBe('SAFETY_ALERT');
    expect(rec.action).toBe('FLAG_INCIDENT');
    expect(rec.requiresApproval).toBe(true);
  });
});

describe('MasaraOperationsAgent + ActionExecutor — end-to-end approval flow (AC-17)', () => {
  it('runs the full chain: detect -> predict -> recommend -> policy -> pending -> approve -> execute -> verify -> audit', async () => {
    const trip = findTripByBusIndex(1);
    const admin = userRepository.findAll().find((u) => u.role === 'admin')!;

    const agentResult = await runForTrip(trip.id);
    expect(agentResult.status).toBe('pending_approval');

    const auditBeforeApproval = auditRepository.findByRecommendationId(agentResult.recommendationId!).length;
    expect(auditBeforeApproval).toBeGreaterThan(0); // RECOMMENDATION_CREATED already logged

    const approval = approveRecommendation(agentResult.recommendationId!, admin.id);
    expect(['verified', 'execution_failed', 'verification_failed']).toContain(approval.recommendation.status);
    expect(approval.recommendation.status).toBe('verified');
    expect(approval.verification).toBeTruthy();

    const auditTrail = auditRepository.findByRecommendationId(agentResult.recommendationId!);
    const eventTypes = auditTrail.map((e) => e.eventType);
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        'RECOMMENDATION_CREATED',
        'APPROVED',
        'ACTION_STARTED',
        'ACTION_COMPLETED',
        'VERIFICATION_STARTED',
        'VERIFICATION_COMPLETED',
      ])
    );
  });
});
