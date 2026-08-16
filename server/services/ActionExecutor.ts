import { recommendationRepository } from '../repositories/recommendationRepository';
import { tripRepository } from '../repositories/tripRepository';
import { routeRepository } from '../repositories/routeRepository';
import { actionRepository } from '../repositories/actionRepository';
import { actionVerificationRepository } from '../repositories/actionVerificationRepository';
import { auditRepository } from '../repositories/auditRepository';
import { evaluateRecommendation } from './PolicyEngine';

// The ONLY component allowed to mutate trip/route state as a consequence of an
// AI recommendation, and only after a human has approved it (spec §10/§29):
//
//   AI Recommendation -> PolicyEngine -> Human Approval -> ActionExecutor -> DB -> Verification -> Audit

export class RecommendationStateError extends Error {}
export class PolicyRejectionError extends Error {}

export function approveRecommendation(recommendationId: string, approvedByUserId: string) {
  const rec = recommendationRepository.findById(recommendationId);
  if (!rec) throw new RecommendationStateError('التوصية غير موجودة.');
  if (rec.status !== 'pending') {
    throw new RecommendationStateError(`لا يمكن الموافقة على توصية بحالة "${rec.status}".`);
  }

  // Re-validate at the moment of approval — trip/bus/route state may have
  // changed since the recommendation was generated.
  const policyResult = evaluateRecommendation(
    { action: rec.action, targetId: rec.targetId, requiresApproval: rec.requiresApproval },
    rec.tripId
  );
  if (!policyResult.allowed) {
    throw new PolicyRejectionError(policyResult.reason ?? 'رفض محرك السياسات هذا الإجراء.');
  }

  const trip = tripRepository.findById(rec.tripId);
  if (!trip) throw new RecommendationStateError('الرحلة المرتبطة بالتوصية غير موجودة.');

  const etaBefore = trip.currentEtaAt;
  let etaAfter = etaBefore;
  const payload: Record<string, unknown> = {};

  if (rec.action === 'CHANGE_ROUTE' && rec.targetId) {
    const targetRoute = routeRepository.findById(rec.targetId);
    if (!targetRoute) throw new RecommendationStateError('المسار المستهدف غير موجود.');
    const currentRoute = routeRepository.findById(trip.routeId);

    // Apply the route-duration delta to the trip's existing ETA rather than
    // recomputing from wall-clock "now" — the latter ignores how close the
    // bus already was and can contradict the recommendation's own promised
    // improvement (verification must be judged against the same numbers the
    // recommendation was built on).
    const durationDeltaMins = currentRoute
      ? currentRoute.estimatedDurationMins - targetRoute.estimatedDurationMins
      : 0;

    tripRepository.update(trip.id, { routeId: targetRoute.id });
    etaAfter = etaBefore
      ? new Date(etaBefore.getTime() - durationDeltaMins * 60_000)
      : new Date(Date.now() + targetRoute.estimatedDurationMins * 60_000);
    tripRepository.update(trip.id, { currentEtaAt: etaAfter });

    payload.routeId = targetRoute.id;
    payload.routeName = targetRoute.name;
  } else if (rec.action === 'NOTIFY_SCHOOL') {
    payload.notified = true;
  } else if (rec.action === 'FLAG_INCIDENT') {
    payload.flagged = true;
  }

  const action = actionRepository.create({
    recommendationId: rec.id,
    actionType: rec.action,
    payload: JSON.stringify(payload),
    executedAt: new Date(),
    executedByUserId: approvedByUserId,
  });

  const improvementMins =
    etaBefore && etaAfter ? Math.round((etaBefore.getTime() - etaAfter.getTime()) / 60_000) : null;

  const verificationStatus =
    rec.action === 'CHANGE_ROUTE'
      ? improvementMins !== null && improvementMins > 0
        ? 'success'
        : improvementMins === 0
          ? 'partial'
          : 'failed'
      : 'success'; // informational actions (NOTIFY_SCHOOL / FLAG_INCIDENT) verify as successful once recorded

  const verification = actionVerificationRepository.create({
    actionId: action.id,
    etaBefore: etaBefore ?? null,
    etaAfter: etaAfter ?? null,
    improvementMins,
    status: verificationStatus,
  });

  recommendationRepository.update(rec.id, {
    status: 'approved',
    decidedByUserId: approvedByUserId,
    decidedAt: new Date(),
  });

  auditRepository.create({
    agentRunId: rec.agentRunId,
    inputSummary: `Approve recommendation ${rec.id} for trip ${rec.tripId}`,
    detectedProblem: rec.problem,
    predictionId: rec.predictionId,
    recommendationId: rec.id,
    operatorDecision: 'approved',
    actionId: action.id,
    verificationId: verification.id,
  });

  return {
    recommendation: recommendationRepository.findById(rec.id)!,
    action,
    verification,
  };
}

export function rejectRecommendation(recommendationId: string, rejectedByUserId: string, reason?: string) {
  const rec = recommendationRepository.findById(recommendationId);
  if (!rec) throw new RecommendationStateError('التوصية غير موجودة.');
  if (rec.status !== 'pending') {
    throw new RecommendationStateError(`لا يمكن رفض توصية بحالة "${rec.status}".`);
  }

  recommendationRepository.update(rec.id, {
    status: 'rejected',
    decidedByUserId: rejectedByUserId,
    decidedAt: new Date(),
    rejectionReason: reason ?? null,
  });

  auditRepository.create({
    agentRunId: rec.agentRunId,
    inputSummary: `Reject recommendation ${rec.id} for trip ${rec.tripId}`,
    detectedProblem: rec.problem,
    predictionId: rec.predictionId,
    recommendationId: rec.id,
    operatorDecision: 'rejected',
  });

  return recommendationRepository.findById(rec.id)!;
}
