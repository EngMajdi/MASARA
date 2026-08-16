import { tripRepository } from '../repositories/tripRepository';
import { busRepository } from '../repositories/busRepository';
import { driverRepository } from '../repositories/driverRepository';
import { routeRepository } from '../repositories/routeRepository';
import { incidentRepository } from '../repositories/incidentRepository';
import { predictionRepository } from '../repositories/predictionRepository';
import { recommendationRepository } from '../repositories/recommendationRepository';
import { auditRepository } from '../repositories/auditRepository';
import { predictDelay, type EffectiveRiskLevel } from '../engines/PredictionEngine';
import { getLLMProvider } from './llm';
import { safeParseStructuredRecommendation } from './llm/recommendationSchema';
import { evaluateRecommendation } from '../services/PolicyEngine';
import { cancelRecommendation } from '../services/ActionExecutor';

export type AgentRunStatus = 'pending_approval' | 'no_action' | 'policy_rejected';

export interface AgentRunResult {
  agentRunId: string;
  predictionId: string;
  recommendationId: string | null;
  status: AgentRunStatus;
  reason?: string;
}

// How long a pending recommendation stays actionable before it's considered
// stale (spec §19) — an operational recommendation from 15 minutes ago is no
// longer trustworthy against live traffic/trip conditions.
const APPROVAL_WINDOW_MINUTES = 15;

// Incident types severe enough to force CRITICAL risk regardless of ETA math —
// a safety event outranks a delay probability (spec §7 policy table).
const SAFETY_INCIDENT_TYPES = new Set(['ACCIDENT', 'BREAKDOWN']);

// Orchestrates one full pass of the MASARA intelligence loop for a single trip:
// inspect -> detect -> predict -> request route options -> recommend -> explain
// -> (persist as pending, wait for a human) -> log. It never mutates trip/route
// state itself — that only happens later, in ActionExecutor, after approval.
export async function runForTrip(tripId: string): Promise<AgentRunResult> {
  const agentRunId = crypto.randomUUID();

  const trip = tripRepository.findById(tripId);
  if (!trip) throw new Error('الرحلة غير موجودة.');
  if (!trip.currentEtaAt || !trip.targetArrivalAt) {
    throw new Error('لا تتوفر بيانات وقت وصول كافية لتحليل هذه الرحلة.');
  }

  const bus = busRepository.findById(trip.busId);
  if (!bus) throw new Error('الحافلة غير موجودة.');
  const driver = trip.driverId ? driverRepository.findById(trip.driverId) : undefined;
  const openIncidents = incidentRepository.findOpenByTripId(tripId);

  // A fresh analysis supersedes whatever this trip was previously waiting on —
  // never let two pending recommendations stack for the same trip.
  for (const stale of recommendationRepository.findPendingByTripId(tripId)) {
    cancelRecommendation(stale.id, `Superseded by new agent run ${agentRunId}`);
  }

  // 1. Predict — deterministic, not LLM-derived.
  const prediction = predictDelay({
    currentEtaAt: trip.currentEtaAt,
    targetArrivalAt: trip.targetArrivalAt,
    openIncidentCount: openIncidents.length,
  });

  const predictionRow = predictionRepository.create({
    tripId,
    currentEtaAt: trip.currentEtaAt,
    targetArrivalAt: trip.targetArrivalAt,
    delayMinutes: prediction.delayMinutes,
    delayProbability: prediction.delayProbability,
    riskLevel: prediction.riskLevel,
    createdBy: agentRunId,
  });

  // A safety incident overrides the ETA-derived risk level entirely.
  const hasSafetyIncident = openIncidents.some((i) => SAFETY_INCIDENT_TYPES.has(i.type));
  const effectiveRiskLevel: EffectiveRiskLevel = hasSafetyIncident ? 'critical' : prediction.riskLevel;

  // 2. Route options — pick the fastest alternative route in the same school, if any.
  const currentRoute = routeRepository.findById(trip.routeId);
  const alternative = currentRoute
    ? routeRepository
        .findBySchoolId(bus.schoolId)
        .filter((r) => r.id !== currentRoute.id)
        .map((r) => ({ route: r, improvement: currentRoute.estimatedDurationMins - r.estimatedDurationMins }))
        .filter((r) => r.improvement > 0)
        .sort((a, b) => b.improvement - a.improvement)[0]
    : undefined;

  const problem = hasSafetyIncident
    ? `حادثة سلامة مفتوحة على رحلة الحافلة ${bus.busNumber} (${openIncidents.map((i) => i.type).join('، ')}).`
    : prediction.delayMinutes > 0
      ? `الحافلة ${bus.busNumber} متوقع وصولها متأخرة ${prediction.delayMinutes} دقيقة عن الوقت المستهدف.`
      : openIncidents.length > 0
        ? `توجد ${openIncidents.length} حادثة مفتوحة على رحلة الحافلة ${bus.busNumber}.`
        : `رحلة الحافلة ${bus.busNumber} ضمن الوقت المستهدف.`;

  // 3. Recommend + explain (LLM — mock by default, Gemini if AI_MODE=gemini).
  const llmProvider = getLLMProvider();
  const rawRecommendation = await llmProvider.generateRecommendation({
    tripId,
    problem,
    busNumber: bus.busNumber,
    driverName: driver?.name ?? 'غير محدد',
    delayMinutes: prediction.delayMinutes,
    delayProbability: prediction.delayProbability,
    riskLevel: effectiveRiskLevel,
    alternativeRouteId: alternative?.route.id,
    alternativeRouteName: alternative?.route.name,
    alternativeImprovementMins: alternative?.improvement,
    openIncidentDescriptions: openIncidents.map((i) => i.description),
    hasSafetyIncident,
  });

  // 4. Validate structure — malformed AI output never reaches application logic.
  const parsed = safeParseStructuredRecommendation(rawRecommendation);
  if (!parsed.success) {
    auditRepository.create({
      eventType: 'AI_OUTPUT_REJECTED',
      entityType: 'trip',
      entityId: tripId,
      agentRunId,
      inputSummary: `Agent run for trip ${tripId}`,
      detectedProblem: problem,
      predictionId: predictionRow.id,
      operatorDecision: null,
    });
    throw new Error(`مخرجات الذكاء الاصطناعي غير صالحة ولم تجتز التحقق من المخطط: ${parsed.error.message}`);
  }
  const structured = parsed.data;

  const expiresAt = new Date(Date.now() + APPROVAL_WINDOW_MINUTES * 60_000);
  const baseRecommendationFields = {
    tripId,
    busId: bus.id,
    sourceRouteId: currentRoute?.id ?? null,
    agentRunId,
    type: structured.type,
    title: structured.title,
    severity: structured.severity,
    problem: structured.problem,
    predictionId: predictionRow.id,
    confidence: structured.confidence,
    action: structured.recommendation.action,
    targetId: structured.recommendation.targetId,
    reason: structured.recommendation.reason,
    expectedOutcome: structured.recommendation.expectedOutcome,
    requiresApproval: structured.requiresApproval,
    expiresAt,
  };

  if (structured.recommendation.action === 'NO_ACTION') {
    auditRepository.create({
      eventType: 'RECOMMENDATION_CREATED',
      entityType: 'trip',
      entityId: tripId,
      newState: 'no_action',
      agentRunId,
      inputSummary: `Agent run for trip ${tripId}`,
      detectedProblem: structured.problem,
      predictionId: predictionRow.id,
      operatorDecision: 'no_action',
    });
    return { agentRunId, predictionId: predictionRow.id, recommendationId: null, status: 'no_action' };
  }

  // 5. Policy check — decides whether this is even allowed to reach a human.
  auditRepository.create({
    eventType: 'POLICY_EVALUATED',
    entityType: 'trip',
    entityId: tripId,
    agentRunId,
    inputSummary: `Agent run for trip ${tripId}`,
    detectedProblem: structured.problem,
    predictionId: predictionRow.id,
  });

  const policyResult = evaluateRecommendation(
    {
      action: structured.recommendation.action,
      targetId: structured.recommendation.targetId,
      requiresApproval: structured.requiresApproval,
    },
    tripId
  );

  if (!policyResult.allowed) {
    const rejectedRow = recommendationRepository.create({
      ...baseRecommendationFields,
      status: 'rejected',
      decidedAt: new Date(),
      rejectionReason: `PolicyEngine: ${policyResult.reason}`,
    });

    auditRepository.create({
      eventType: 'REJECTED',
      entityType: 'ai_recommendation',
      entityId: rejectedRow.id,
      previousState: 'pending',
      newState: 'rejected',
      agentRunId,
      inputSummary: `Agent run for trip ${tripId}`,
      detectedProblem: structured.problem,
      predictionId: predictionRow.id,
      recommendationId: rejectedRow.id,
      operatorDecision: 'policy_rejected',
    });

    return {
      agentRunId,
      predictionId: predictionRow.id,
      recommendationId: rejectedRow.id,
      status: 'policy_rejected',
      reason: policyResult.reason,
    };
  }

  // 6. Persist as pending — the agent stops here and waits for a human.
  const recommendationRow = recommendationRepository.create({
    ...baseRecommendationFields,
    status: 'pending',
  });

  auditRepository.create({
    eventType: 'RECOMMENDATION_CREATED',
    entityType: 'ai_recommendation',
    entityId: recommendationRow.id,
    newState: 'pending',
    agentRunId,
    inputSummary: `Agent run for trip ${tripId}`,
    detectedProblem: structured.problem,
    predictionId: predictionRow.id,
    recommendationId: recommendationRow.id,
    operatorDecision: null,
  });

  return {
    agentRunId,
    predictionId: predictionRow.id,
    recommendationId: recommendationRow.id,
    status: 'pending_approval',
  };
}

export const MasaraOperationsAgent = { runForTrip };
