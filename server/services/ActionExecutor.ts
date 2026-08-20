import { recommendationRepository } from '../repositories/recommendationRepository';
import { tripRepository } from '../repositories/tripRepository';
import { routeRepository } from '../repositories/routeRepository';
import { actionRepository } from '../repositories/actionRepository';
import { actionVerificationRepository } from '../repositories/actionVerificationRepository';
import { auditRepository } from '../repositories/auditRepository';
import { evaluateRecommendation, isExpired } from './PolicyEngine';
import { canTransition, type RecommendationStatus } from '../domain/StateMachine';
import { notifySchoolOfSignificantDelay, type SchoolNotificationOutcome } from './SchoolRecommendationNotifier';
import type { NotificationPriority } from '../domain/notificationContract';

// The ONLY component allowed to mutate trip/route state as a consequence of an
// AI recommendation, and only after a human has approved it (spec §10/§29).
// Approve, execute, and verify are three distinct, separately persisted state
// transitions (Phase 2A §14/§17) — never assume "executed" implies "successful",
// and never skip straight to a final status without passing through each step:
//
//   pending -> approved -> executed|execution_failed -> verified|verification_failed
//                    \-> rejected | expired | cancelled

export class RecommendationStateError extends Error {}
export class PolicyRejectionError extends Error {}
export class RecommendationExpiredError extends Error {}
export class ValidationError extends Error {}
export class ConflictError extends Error {}

type RecommendationRow = NonNullable<ReturnType<typeof recommendationRepository.findById>>;

function logEvent(
  rec: RecommendationRow,
  eventType: string,
  opts: {
    actorId?: string | null;
    actorType?: 'system' | 'agent' | 'user';
    previousState?: string | null;
    newState?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  } = {}
) {
  auditRepository.create({
    eventType,
    actorId: opts.actorId ?? null,
    actorType: opts.actorType ?? 'system',
    entityType: 'ai_recommendation',
    entityId: rec.id,
    previousState: opts.previousState ?? null,
    newState: opts.newState ?? null,
    metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
    agentRunId: rec.agentRunId,
    tripId: rec.tripId,
    inputSummary: `${eventType} — recommendation ${rec.id} (trip ${rec.tripId})`,
    detectedProblem: rec.problem,
    predictionId: rec.predictionId,
    recommendationId: rec.id,
    operatorDecision: opts.reason ?? null,
  });
}

/** Lazily expires a still-pending recommendation that's past its `expiresAt`, recording the transition. */
function expireIfPastDue(rec: RecommendationRow): boolean {
  if (rec.status !== 'pending' || !isExpired(rec.expiresAt)) return false;
  const claimed = recommendationRepository.claimTransition(rec.id, 'pending', 'expired');
  if (claimed) {
    logEvent(rec, 'EXPIRED', { previousState: 'pending', newState: 'expired' });
  }
  return true;
}

/** Reuses the exact NotificationPriority vocabulary already defined in notificationContract.ts — no new vocabulary. */
const SEVERITY_TO_NOTIFICATION_PRIORITY: Record<string, NotificationPriority> = {
  low: 'LOW',
  medium: 'NORMAL',
  high: 'HIGH',
  critical: 'CRITICAL',
};

async function executeApprovedAction(rec: RecommendationRow, actorId: string) {
  logEvent(rec, 'ACTION_STARTED', { actorType: 'system', previousState: 'approved', newState: 'approved' });

  try {
    const trip = tripRepository.findById(rec.tripId);
    if (!trip) throw new Error('الرحلة المرتبطة بالتوصية غير موجودة.');

    const etaBefore = trip.currentEtaAt;
    let etaAfter = etaBefore;
    const payload: Record<string, unknown> = {};
    let schoolNotification: SchoolNotificationOutcome | undefined;

    if (rec.action === 'CHANGE_ROUTE' && rec.targetId) {
      const targetRoute = routeRepository.findById(rec.targetId);
      if (!targetRoute) throw new Error('المسار المستهدف غير موجود.');
      const currentRoute = routeRepository.findById(trip.routeId);

      // Apply the route-duration delta to the existing ETA rather than
      // recomputing from wall-clock "now" — keeps verification consistent
      // with the recommendation's own promised improvement.
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
      // Phase 7D — a real call into the existing notification delivery
      // boundary (SchoolRecommendationNotifier -> the same provider/contact
      // primitives Phase 5C/5D/6B/6C already built), replacing the previous
      // purely informational `{notified: true}` placeholder. Content is
      // entirely server-derived from the already-approved recommendation
      // row (rec.title/rec.problem) — never regenerated, never client-supplied.
      schoolNotification = await notifySchoolOfSignificantDelay({
        busId: rec.busId,
        recommendationId: rec.id,
        title: rec.title,
        body: rec.problem,
        priority: SEVERITY_TO_NOTIFICATION_PRIORITY[rec.severity] ?? 'NORMAL',
      });
      payload.notified = schoolNotification.attempted;
      payload.recipientUserId = schoolNotification.recipientUserId;
      payload.channelResults = schoolNotification.channelResults;
    } else if (rec.action === 'FLAG_INCIDENT') {
      payload.flagged = true;
    }

    const action = actionRepository.create({
      recommendationId: rec.id,
      actionType: rec.action,
      payload: JSON.stringify(payload),
      executedAt: new Date(),
      executedByUserId: actorId,
    });

    const claimed = recommendationRepository.claimTransition(rec.id, 'approved', 'executed');
    if (!claimed) throw new Error('تعذر تسجيل حالة التنفيذ للتوصية.');

    logEvent(rec, 'ACTION_COMPLETED', { previousState: 'approved', newState: 'executed', metadata: payload });
    return { success: true as const, action, etaBefore: etaBefore ?? null, etaAfter: etaAfter ?? null, schoolNotification };
  } catch (err) {
    recommendationRepository.claimTransition(rec.id, 'approved', 'execution_failed');
    logEvent(rec, 'ACTION_FAILED', {
      previousState: 'approved',
      newState: 'execution_failed',
      reason: (err as Error).message,
    });
    return { success: false as const, error: (err as Error).message };
  }
}

function verifyExecutedAction(
  rec: RecommendationRow,
  execution: {
    action: ReturnType<typeof actionRepository.create>;
    etaBefore: Date | null;
    etaAfter: Date | null;
    schoolNotification?: SchoolNotificationOutcome;
  }
) {
  logEvent(rec, 'VERIFICATION_STARTED', { previousState: 'executed', newState: 'executed' });

  try {
    const { action, etaBefore, etaAfter, schoolNotification } = execution;
    const improvementMins =
      etaBefore && etaAfter ? Math.round((etaBefore.getTime() - etaAfter.getTime()) / 60_000) : null;

    // SUCCESS / PARTIAL_SUCCESS / FAILED (spec §14) — the outcome quality is
    // separate from whether the verification process itself could run at all.
    //
    // NOTIFY_SCHOOL (Phase 7D): reflects the REAL delivery outcome, never a
    // blanket "success" — 'success' only if a real channel actually
    // delivered; 'partial_success' when the recipient was correctly
    // resolved and every provider was honestly attempted but none could
    // achieve real delivery (no vendor configured — the current state of
    // every channel in this deployment, exactly as already true for parent
    // notifications); 'failed' when no school recipient could even be
    // resolved (nothing to attempt at all).
    const status =
      rec.action === 'CHANGE_ROUTE'
        ? improvementMins !== null && improvementMins > 0
          ? 'success'
          : improvementMins === 0
            ? 'partial_success'
            : 'failed'
        : rec.action === 'NOTIFY_SCHOOL'
          ? !schoolNotification || !schoolNotification.attempted
            ? 'failed'
            : schoolNotification.channelResults.some((r) => r.outcome === 'SUCCESS')
              ? 'success'
              : 'partial_success'
          : 'success'; // FLAG_INCIDENT and any other informational action verify as successful once recorded — unchanged

    const verification = actionVerificationRepository.create({
      actionId: action.id,
      etaBefore,
      etaAfter,
      improvementMins,
      status,
    });

    const claimed = recommendationRepository.claimTransition(rec.id, 'executed', 'verified');
    if (!claimed) throw new Error('تعذر تسجيل حالة التحقق للتوصية.');

    logEvent(rec, 'VERIFICATION_COMPLETED', {
      previousState: 'executed',
      newState: 'verified',
      metadata: { status, improvementMins },
    });
    return verification;
  } catch (err) {
    recommendationRepository.claimTransition(rec.id, 'executed', 'verification_failed');
    logEvent(rec, 'VERIFICATION_FAILED', {
      previousState: 'executed',
      newState: 'verification_failed',
      reason: (err as Error).message,
    });
    return null;
  }
}

export async function approveRecommendation(recommendationId: string, approvedByUserId: string) {
  const rec = recommendationRepository.findById(recommendationId);
  if (!rec) throw new RecommendationStateError('التوصية غير موجودة.');

  if (expireIfPastDue(rec)) {
    throw new RecommendationExpiredError('انتهت صلاحية هذه التوصية ولم تعد قابلة للتنفيذ.');
  }
  if (!canTransition(rec.status as RecommendationStatus, 'approved')) {
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

  const claimed = recommendationRepository.claimTransition(rec.id, 'pending', 'approved', {
    decidedByUserId: approvedByUserId,
    decidedAt: new Date(),
  });
  if (!claimed) {
    throw new ConflictError('تم اتخاذ قرار على هذه التوصية بالفعل من قبل مستخدم آخر.');
  }
  logEvent(rec, 'APPROVED', {
    actorId: approvedByUserId,
    actorType: 'user',
    previousState: 'pending',
    newState: 'approved',
    reason: 'approved',
  });

  const approvedRec = recommendationRepository.findById(rec.id)!;
  const executionResult = await executeApprovedAction(approvedRec, approvedByUserId);

  if (!executionResult.success) {
    return {
      recommendation: recommendationRepository.findById(rec.id)!,
      action: null,
      verification: null,
    };
  }

  const verification = verifyExecutedAction(approvedRec, executionResult);

  return {
    recommendation: recommendationRepository.findById(rec.id)!,
    action: executionResult.action,
    verification,
  };
}

export function rejectRecommendation(recommendationId: string, rejectedByUserId: string, reason: string) {
  if (!reason || !reason.trim()) {
    throw new ValidationError('سبب الرفض مطلوب ولا يمكن أن يكون فارغاً.');
  }

  const rec = recommendationRepository.findById(recommendationId);
  if (!rec) throw new RecommendationStateError('التوصية غير موجودة.');

  if (expireIfPastDue(rec)) {
    throw new RecommendationExpiredError('انتهت صلاحية هذه التوصية.');
  }
  if (!canTransition(rec.status as RecommendationStatus, 'rejected')) {
    throw new RecommendationStateError(`لا يمكن رفض توصية بحالة "${rec.status}".`);
  }

  const claimed = recommendationRepository.claimTransition(rec.id, 'pending', 'rejected', {
    decidedByUserId: rejectedByUserId,
    decidedAt: new Date(),
    rejectionReason: reason.trim(),
  });
  if (!claimed) {
    throw new ConflictError('تم اتخاذ قرار على هذه التوصية بالفعل من قبل مستخدم آخر.');
  }

  logEvent(rec, 'REJECTED', {
    actorId: rejectedByUserId,
    actorType: 'user',
    previousState: 'pending',
    newState: 'rejected',
    reason: reason.trim(),
  });

  return recommendationRepository.findById(rec.id)!;
}

export function requestReview(recommendationId: string, requestedByUserId: string, note?: string) {
  const rec = recommendationRepository.findById(recommendationId);
  if (!rec) throw new RecommendationStateError('التوصية غير موجودة.');

  if (expireIfPastDue(rec)) {
    throw new RecommendationExpiredError('انتهت صلاحية هذه التوصية.');
  }
  if (rec.status !== 'pending') {
    throw new RecommendationStateError(`لا يمكن طلب مراجعة على توصية بحالة "${rec.status}".`);
  }

  // Does not change status — the recommendation stays pending, awaiting a
  // firmer decision. Purely a logged request for a second opinion.
  logEvent(rec, 'REVIEW_REQUESTED', {
    actorId: requestedByUserId,
    actorType: 'user',
    previousState: 'pending',
    newState: 'pending',
    reason: note ?? null,
  });

  return recommendationRepository.findById(rec.id)!;
}

/** System-initiated cancellation — used when a newer agent run supersedes an existing pending recommendation for the same trip. */
export function cancelRecommendation(recommendationId: string, reason: string) {
  const rec = recommendationRepository.findById(recommendationId);
  if (!rec || !canTransition(rec.status as RecommendationStatus, 'cancelled')) return;

  const claimed = recommendationRepository.claimTransition(rec.id, 'pending', 'cancelled');
  if (claimed) {
    logEvent(rec, 'RECOMMENDATION_CANCELLED', {
      actorType: 'system',
      previousState: 'pending',
      newState: 'cancelled',
      reason,
    });
  }
}
