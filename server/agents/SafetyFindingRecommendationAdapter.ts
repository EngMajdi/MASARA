import { getTripSafetyFinding, type SafetyFinding, type FindingConfidence } from '../services/SafetyFindingService';
import { evaluateRecommendation } from '../services/PolicyEngine';
import { recommendationRepository } from '../repositories/recommendationRepository';
import { auditRepository } from '../repositories/auditRepository';
import { busRepository } from '../repositories/busRepository';

// Phase 7C — the ONLY place a Phase 7B SafetyFinding is ever turned into a
// governed recommendation. Deliberately a SEPARATE, independent lane from
// MasaraOperationsAgent's existing LLM-authored recommendation logic (spec:
// "existing traffic/safety/normal recommendations remain unchanged") — this
// file never modifies that logic, it adds one additional, fully
// deterministic recommendation path that shares the exact same
// aiRecommendations table, PolicyEngine, audit event taxonomy, and
// approval/execution lifecycle. Not a second governance system.
//
// No LLM call anywhere in this file — every field of the recommendation is
// either copied verbatim from the SafetyFinding or built with a fixed
// Arabic template string. Nothing here is generated, guessed, or inferred.
//
// SafetyFindingService remains read-only: this file calls
// getTripSafetyFinding (a pure read), and nothing in SafetyFindingService
// calls back into this file or anything downstream of it.
//
// This file imports no ActionExecutor, JourneyService, JourneyStateMachine,
// TelemetryIngestionService, NotificationService, or NotificationPolicy — it
// creates a 'pending' (or policy-'rejected') recommendation row and stops.
// Approval, execution, and verification remain exactly the existing,
// untouched, human-gated ActionExecutor path.
//
// Called only from MasaraOperationsAgent.runForTrip, after its own existing
// stale-pending-recommendation cancellation step. Deduplication is NOT
// reimplemented here — it relies entirely on that existing, unchanged
// "cancel every pending recommendation for this trip before creating a new
// one" behavior, so repeated agent runs against an unchanged condition
// never stack more than one pending safety recommendation per trip.

export type SafetyRecommendationOutcome = 'created' | 'policy_rejected' | 'not_eligible';

export interface SafetyRecommendationResult {
  recommendationId: string | null;
  outcome: SafetyRecommendationOutcome;
  reason?: string;
}

/** Only SIGNIFICANT_DELAY_RISK is eligible — the only Phase 7B finding type that exists today. Explicit allow-list, not a default-true branch, so a future Phase 7B finding type never silently becomes recommendation-eligible without a deliberate decision here. */
const ELIGIBLE_FINDING_TYPES: ReadonlySet<string> = new Set(['SIGNIFICANT_DELAY_RISK']);

/**
 * Fixed, documented tier -> number mapping — NOT a machine-learned
 * probability and not a fabricated statistic. The existing
 * ai_recommendations.confidence column is a NOT NULL real number inherited
 * from the LLM-authored recommendation contract (Phase 2A); this mapping
 * exists only to satisfy that structural constraint without a migration.
 * The real, honest confidence signal is the qualitative HIGH/MEDIUM/LOW
 * value itself, preserved verbatim in `reason` below for any human/UI
 * consumer — no statistical meaning should ever be read into this number.
 */
const CONFIDENCE_TO_LEGACY_NUMBER: Record<FindingConfidence, number> = {
  HIGH: 0.9,
  MEDIUM: 0.6,
  LOW: 0.3,
};

/** Informational action — reusing PolicyEngine's existing KNOWN_ACTIONS vocabulary unchanged. A delay is not a route decision and not an incident, so CHANGE_ROUTE/FLAG_INCIDENT are deliberately not used here. */
const DELAY_NOTIFICATION_ACTION = 'NOTIFY_SCHOOL';

function buildDeterministicContent(finding: SafetyFinding, busNumber: string | null) {
  const busLabel = busNumber ?? finding.busId;
  const delayMinutes = Math.round(finding.delaySeconds / 60);
  return {
    title: `تنبيه تأخير كبير — الحافلة ${busLabel}`,
    problem: `الحافلة ${busLabel} متأخرة ${delayMinutes} دقيقة عن وقت الوصول المستهدف وفق تحليل ETA اللحظي (مستوى الثقة: ${finding.confidence}).`,
    reason: `تحليل ETA الحتمي (Phase 7B) رصد تأخيراً كبيراً — السرعة الحالية: ${finding.evidence.currentSpeedKmh ?? 'غير معروفة'} كم/س، المسافة المتبقية: ${finding.evidence.remainingDistanceMeters ?? 'غير معروفة'} م، حداثة الموقع: ${finding.evidence.freshness === 'FRESH' ? 'حديث' : 'غير حديث'}، ثقة النتيجة: ${finding.confidence}.`,
    expectedOutcome: 'إبلاغ إدارة المدرسة بالتأخير لتنسيق الاستجابة المناسبة.',
  };
}

/**
 * Turns the trip's CURRENT Phase 7B SafetyFinding (a fresh, ephemeral
 * read — never a second ETA/location calculation) into a governed
 * recommendation, if eligible. Returns 'not_eligible' silently (no audit
 * entry, no repository write) when there is no SafetyFinding or it is not
 * SIGNIFICANT_DELAY_RISK — never manufactures a recommendation from
 * missing/invalid/stale evidence.
 */
export function createSafetyFindingRecommendation(
  tripId: string,
  agentRunId: string,
  expiresAt: Date
): SafetyRecommendationResult {
  const finding = getTripSafetyFinding(tripId);
  if (!finding || !ELIGIBLE_FINDING_TYPES.has(finding.findingType)) {
    return { recommendationId: null, outcome: 'not_eligible' };
  }

  // finding.tripId/finding.busId/finding.routeId are already resolved by the
  // same evidence chain (EtaService) — reused verbatim, never re-derived.
  const bus = busRepository.findById(finding.busId);
  const content = buildDeterministicContent(finding, bus?.busNumber ?? null);

  const policyResult = evaluateRecommendation(
    { action: DELAY_NOTIFICATION_ACTION, targetId: null, requiresApproval: true },
    tripId
  );

  const baseFields = {
    tripId,
    busId: finding.busId,
    sourceRouteId: finding.routeId,
    agentRunId,
    type: 'DELAY' as const,
    title: content.title,
    severity: finding.severity,
    problem: content.problem,
    predictionId: null,
    confidence: CONFIDENCE_TO_LEGACY_NUMBER[finding.confidence],
    action: DELAY_NOTIFICATION_ACTION,
    targetId: null,
    reason: content.reason,
    expectedOutcome: content.expectedOutcome,
    requiresApproval: true,
    expiresAt,
  };

  auditRepository.create({
    eventType: 'POLICY_EVALUATED',
    entityType: 'trip',
    entityId: tripId,
    tripId,
    agentRunId,
    inputSummary: `Safety finding evaluation for trip ${tripId}`,
    detectedProblem: content.problem,
    predictionId: null,
  });

  if (!policyResult.allowed) {
    const rejectedRow = recommendationRepository.create({
      ...baseFields,
      status: 'rejected',
      decidedAt: new Date(),
      rejectionReason: `PolicyEngine: ${policyResult.reason}`,
    });

    auditRepository.create({
      eventType: 'REJECTED',
      entityType: 'ai_recommendation',
      entityId: rejectedRow.id,
      tripId,
      previousState: 'pending',
      newState: 'rejected',
      agentRunId,
      inputSummary: `Safety finding evaluation for trip ${tripId}`,
      detectedProblem: content.problem,
      predictionId: null,
      recommendationId: rejectedRow.id,
      operatorDecision: 'policy_rejected',
    });

    return { recommendationId: rejectedRow.id, outcome: 'policy_rejected', reason: policyResult.reason };
  }

  const recommendationRow = recommendationRepository.create({
    ...baseFields,
    status: 'pending',
  });

  auditRepository.create({
    eventType: 'RECOMMENDATION_CREATED',
    entityType: 'ai_recommendation',
    entityId: recommendationRow.id,
    tripId,
    newState: 'pending',
    agentRunId,
    inputSummary: `Safety finding evaluation for trip ${tripId}`,
    detectedProblem: content.problem,
    predictionId: null,
    recommendationId: recommendationRow.id,
    operatorDecision: null,
  });

  return { recommendationId: recommendationRow.id, outcome: 'created' };
}
